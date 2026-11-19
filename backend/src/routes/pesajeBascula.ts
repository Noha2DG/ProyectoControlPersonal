import { Router, Response } from "express";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm, AuthRequest } from "../middleware/auth.ts";
import { hoyGT } from "../lib/dateGT.ts";

// Pantalla de pesaje en báscula (#/pesaje). Permiso propio `pesaje_bascula` — separado de
// `basculas` (configuración) para dárselo a quien pesa sin darle la configuración.
//
// Flujo: el equipo entra con un usuario que tiene `pesaje_bascula.usar`; la pesadora pasa su carnet
// (POST /sesion) y de su área de hoy salen la bodega y el modo; pesa; cada caja dentro del rango se
// guarda al retirarla (POST /pesadas). La sesión se cierra al salir, con 15 min sin pesar, si la
// pesadora ya no está en su área (marcó salida o la cambiaron) o al cambiar el día.
//
// Fechas y horas se calculan en SQL o con hoyGT(): la hora del cabezal no es confiable.

const router = Router();
router.use(requireAuth);

const MIN_INACTIVIDAD = 15;
// PPV (19 nov 2026, prueba): solo control de peso. Lote escrito a mano (no está amarrado al piso),
// talla, tipo de empaque CON rango y pedido de referencia (no toca el avance del pedido). Una sola
// persona pesa todo: sin carnet por caja. Va a su propia tabla, PesadaPrueba, para no mezclarse con
// Pesada mientras sea prueba; ahí también quedan los intentos fuera de rango (Resultado BAJO/SOBRE).
const MODOS = ["PERSONA", "PRODUCTO", "PPV"];

class ErrorNegocio extends Error { constructor(public status: number, msg: string, public extra?: any) { super(msg); } }
const responder = (res: Response, err: any) =>
  err instanceof ErrorNegocio ? res.status(err.status).json({ error: err.message, ...(err.extra ?? {}) }) : res.status(500).json({ error: err.message });

async function empleadoActivo(tx: any, codigo: string) {
  const [e]: any[] = await tx.$queryRaw`
    SELECT Codigo, CONCAT_WS(' ', PrimerNombre, SegundoNombre, PrimerApellido, SegundoApellido) AS NombreCompleto
      FROM Empleados WHERE Codigo = ${codigo} AND Estado = 'Activo' LIMIT 1`;
  return e ?? null;
}

/** Área donde está hoy la persona: su transferencia abierta (kiosco de áreas). */
async function areaActual(tx: any, codigo: string) {
  const [a]: any[] = await tx.$queryRaw`
    SELECT t.CodigoArea, a.Nombre AS NombreArea, a.EsPesadora, a.ModoPesaje, a.PideCarrito, a.BodegaVirtualCodigo, bv.Nombre AS BodegaNombre
      FROM Transferencias t
      JOIN Areas a ON a.Codigo = t.CodigoArea
      LEFT JOIN BodegaVirtual bv ON bv.Codigo = a.BodegaVirtualCodigo
     WHERE t.Codigo = ${codigo} AND t.FechaSalida IS NULL
     ORDER BY t.FechaHora DESC LIMIT 1`;
  return a ?? null;
}

async function datosSesion(tx: any, id: number) {
  const [s]: any[] = await tx.$queryRaw`
    SELECT s.SesionId, s.BalanzaCodigo, s.OperadoraCodigo, s.AreaCodigo, a.Nombre AS NombreArea,
           s.BodegaVirtualCodigo, bv.Nombre AS BodegaNombre, s.Modo, s.PideCarrito,
           DATE_FORMAT(s.FechaProduccion, '%Y-%m-%d') AS FechaProduccion,
           DATE_FORMAT(s.Inicio, '%H:%i') AS Inicio, s.Fin, s.MotivoFin,
           TIMESTAMPDIFF(MINUTE, s.UltimaActividad, NOW()) AS MinSinActividad,
           CONCAT_WS(' ', e.PrimerNombre, e.PrimerApellido) AS Operadora
      FROM SesionBascula s
      JOIN Areas a ON a.Codigo = s.AreaCodigo
      LEFT JOIN BodegaVirtual bv ON bv.Codigo = s.BodegaVirtualCodigo
      LEFT JOIN Empleados e ON e.Codigo = s.OperadoraCodigo
     WHERE s.SesionId = ${id}`;
  if (!s) return null;
  // TIMESTAMPDIFF y otros enteros calculados llegan como BigInt, que JSON no sabe mandar
  // ("Do not know how to serialize a BigInt" en la pantalla de la báscula, 17 nov 2026).
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v])) as any;
}

async function cerrar(tx: any, id: number, motivo: string) {
  await tx.$executeRaw`UPDATE SesionBascula SET Fin = NOW(), MotivoFin = ${motivo} WHERE SesionId = ${id} AND Fin IS NULL`;
}

/** La sesión sigue válida? Si no, la cierra con su motivo y lanza 409 (la pantalla vuelve al carnet). */
async function exigirSesionAbierta(tx: any, id: number) {
  const s = await datosSesion(tx, id);
  if (!s) throw new ErrorNegocio(404, "La sesión no existe");
  if (s.Fin) throw new ErrorNegocio(409, `La sesión ya se cerró (${s.MotivoFin ?? "cerrada"}). Pase su carnet otra vez.`, { sesionCerrada: true });
  let motivo: string | null = null;
  if (s.FechaProduccion !== hoyGT()) motivo = "cambio de día";
  else if (Number(s.MinSinActividad) >= MIN_INACTIVIDAD) motivo = `${MIN_INACTIVIDAD} min sin pesar`;
  else {
    const a = await areaActual(tx, s.OperadoraCodigo);
    if (!a || a.CodigoArea !== s.AreaCodigo) motivo = a ? `la pesadora pasó al área ${a.NombreArea}` : "la pesadora marcó salida";
  }
  if (motivo) {
    // Con `prisma`, no con `tx`: el error de abajo revierte la transacción y se llevaría el cierre.
    await cerrar(prisma, id, motivo);
    throw new ErrorNegocio(409, `Se cerró la sesión: ${motivo}. Pase su carnet otra vez.`, { sesionCerrada: true });
  }
  return s;
}

// GET /api/pesaje-bascula/persona/:codigo — para mostrar el nombre del carnet escaneado.
router.get("/persona/:codigo", requirePerm("pesaje_bascula", "usar"), async (req: AuthRequest, res: Response) => {
  try {
    const e = await empleadoActivo(prisma, String(req.params.codigo).trim().toUpperCase());
    if (!e) { res.status(404).json({ error: "Carnet no encontrado o empleado de baja" }); return; }
    res.json(e);
  } catch (err: any) { responder(res, err); }
});

// POST /api/pesaje-bascula/sesion — { balanza, carnet, modo?, bodega? }
// Sin modo responde { menu, opciones }: la pantalla muestra el menú de pesadas en botones grandes.
// Opciones: el modo del área (o los dos de inventario si el área no lo define) más "Pesar PPV".
// Con modo de inventario y sin bodega (ni en el área), responde { necesita } y la pantalla pregunta.
router.post("/sesion", requirePerm("pesaje_bascula", "usar"), async (req: AuthRequest, res: Response) => {
  try {
    const balanza = String(req.body?.balanza ?? "").trim().toUpperCase();
    const carnet = String(req.body?.carnet ?? "").trim().toUpperCase();
    if (!balanza) throw new ErrorNegocio(400, "La pantalla no sabe en qué báscula está: revise la app Báscula Puente");
    if (!carnet) throw new ErrorNegocio(400, "Pase su carnet");
    const resultado = await prisma.$transaction(async (tx: any) => {
      const [b]: any[] = await tx.$queryRaw`SELECT Codigo, Activa FROM Balanza WHERE Codigo = ${balanza} FOR UPDATE`;
      if (!b) throw new ErrorNegocio(400, `La báscula ${balanza} no está registrada en el sistema`);
      if (Number(b.Activa) !== 1) throw new ErrorNegocio(400, `La báscula ${balanza} está desactivada`);
      const e = await empleadoActivo(tx, carnet);
      if (!e) throw new ErrorNegocio(400, `${carnet}: carnet no encontrado o empleado de baja`);
      const a = await areaActual(tx, carnet);
      if (!a) throw new ErrorNegocio(400, `${e.NombreCompleto}: hoy no tiene entrada en un área. Pase primero por el kiosco de áreas.`);
      if (Number(a.EsPesadora) !== 1) throw new ErrorNegocio(400, `${e.NombreCompleto} está en ${a.NombreArea}, que no usa básculas.`);

      const modoArea = MODOS.includes(a.ModoPesaje) && a.ModoPesaje !== "PPV" ? a.ModoPesaje : null;
      const opciones = [...(modoArea ? [modoArea] : ["PERSONA", "PRODUCTO"]), "PPV"];
      const modo = String(req.body?.modo ?? "").toUpperCase();
      if (!opciones.includes(modo)) return { menu: true, opciones, operadora: e.NombreCompleto, area: a.NombreArea };

      // PPV no toca el inventario al piso: no necesita bodega.
      let bodega: string | null = modo === "PPV" ? null : (a.BodegaVirtualCodigo ?? null);
      if (modo !== "PPV" && !bodega && req.body?.bodega) {
        const [bv]: any[] = await tx.$queryRaw`SELECT Codigo FROM BodegaVirtual WHERE Codigo = ${String(req.body.bodega)} AND Activo = 1`;
        if (bv) bodega = bv.Codigo;
      }
      if (modo !== "PPV" && !bodega) {
        const bodegas: any[] = await tx.$queryRawUnsafe(`SELECT Codigo, Nombre FROM BodegaVirtual WHERE Activo = 1 ORDER BY Orden, Nombre`);
        return { necesita: { bodega: true }, modo, bodegas, operadora: e.NombreCompleto, area: a.NombreArea };
      }

      // Una báscula, una sesión: la que estuviera abierta se cierra.
      await tx.$executeRaw`
        UPDATE SesionBascula SET Fin = NOW(), MotivoFin = 'entró otra persona'
         WHERE BalanzaCodigo = ${balanza} AND Fin IS NULL`;
      await tx.$executeRaw`
        INSERT INTO SesionBascula (BalanzaCodigo, OperadoraCodigo, AreaCodigo, BodegaVirtualCodigo, Modo, PideCarrito, FechaProduccion, Usuario)
        VALUES (${balanza}, ${carnet}, ${a.CodigoArea}, ${bodega}, ${modo}, ${modo === "PERSONA" && Number(a.PideCarrito) === 1 ? 1 : 0}, ${hoyGT()}, ${req.user!.username})`;
      const [{ id }]: any[] = await tx.$queryRaw`SELECT LAST_INSERT_ID() AS id`;
      return { sesion: await datosSesion(tx, Number(id)) };
    });
    res.json(resultado);
  } catch (err: any) { responder(res, err); }
});

// GET /api/pesaje-bascula/sesion/:id — al recargar la pantalla, retoma la sesión si sigue válida.
router.get("/sesion/:id", requirePerm("pesaje_bascula", "usar"), async (req: AuthRequest, res: Response) => {
  try {
    const s = await prisma.$transaction((tx: any) => exigirSesionAbierta(tx, Number(req.params.id)));
    res.json(s);
  } catch (err: any) { responder(res, err); }
});

// POST /api/pesaje-bascula/sesion/:id/cerrar — { motivo }
router.post("/sesion/:id/cerrar", requirePerm("pesaje_bascula", "usar"), async (req: AuthRequest, res: Response) => {
  try {
    await cerrar(prisma, Number(req.params.id), String(req.body?.motivo ?? "salió").slice(0, 100));
    res.json({ ok: true });
  } catch (err: any) { responder(res, err); }
});

// GET /api/pesaje-bascula/sesion/:id/catalogos — tipos de empaque, tallas y lotes al piso de la bodega.
router.get("/sesion/:id/catalogos", requirePerm("pesaje_bascula", "usar"), async (req: AuthRequest, res: Response) => {
  try {
    const s = await datosSesion(prisma, Number(req.params.id));
    if (!s) throw new ErrorNegocio(404, "La sesión no existe");
    if (s.Modo === "PPV") {
      // Solo empaques con rango (es control de peso) y todos los pedidos en proceso, de cualquier
      // cliente, con su descripción: el pedido es solo referencia.
      const [empaques, tallas, pedidos] = await Promise.all([
        prisma.$queryRawUnsafe(`
          SELECT Codigo, Nombre, Unidad, PesoNetoG, TaraG, PesoBrutoG, MinG, MaxG, ConRango
            FROM EmpaquePesaje WHERE Activo = 1 AND ConRango = 1 ORDER BY Nombre`),
        prisma.$queryRawUnsafe(`SELECT Codigo, Descripcion FROM Tallas WHERE Activo = 1 ORDER BY Codigo`),
        prisma.$queryRawUnsafe(`
          SELECT p.CodigoPedido, p.Descripcion, c.RazonSocial AS Cliente
            FROM Pedidos p JOIN Clientes c ON c.Codigo = p.CodigoCliente
           WHERE p.Estatus = 'Proceso'
           ORDER BY c.RazonSocial, p.CodigoPedido`),
      ]);
      res.json({
        empaques: (empaques as any[]).map(e => ({ ...e, ConRango: true })),
        tallas, pedidos, lotes: [], clases: [],
      });
      return;
    }
    const [empaques, tallas, lotes, clases, pedidos] = await Promise.all([
      prisma.$queryRawUnsafe(`
        SELECT Codigo, Nombre, Unidad, PesoNetoG, TaraG, DeshidratacionG, PesoBrutoG, MinG, MaxG, ConRango
          FROM EmpaquePesaje WHERE Activo = 1 ORDER BY Nombre`),
      prisma.$queryRawUnsafe(`SELECT Codigo, Descripcion FROM Tallas WHERE Activo = 1 ORDER BY Codigo`),
      // Inventario al piso de la bodega: lo que entró menos lo que salió, por Lote/Clase/Talla.
      prisma.$queryRawUnsafe(`
        SELECT t.Lote, t.Clase, c.Descripcion AS ClaseDesc, t.Talla, ta.Descripcion AS TallaDesc, ROUND(SUM(t.Kg), 2) AS Kg
          FROM (SELECT Lote, Clase, Talla, PesoKg AS Kg FROM MovimientoPiso WHERE BodegaDestino = ?
                UNION ALL
                SELECT Lote, Clase, Talla, -PesoKg FROM MovimientoPiso WHERE BodegaOrigen = ?) t
          LEFT JOIN Tallas ta ON ta.Codigo = t.Talla
          LEFT JOIN Clase c ON c.Clase = t.Clase
         GROUP BY t.Lote, t.Clase, c.Descripcion, t.Talla, ta.Descripcion
        HAVING SUM(t.Kg) > 0.01
         ORDER BY t.Lote, t.Clase`, s.BodegaVirtualCodigo, s.BodegaVirtualCodigo),
      // Producto que sale (producto terminado): el lote se conserva, el producto cambia (BF T-ON → coco).
      prisma.$queryRawUnsafe(`SELECT Clase, Descripcion FROM Clase WHERE Activo = 1 ORDER BY Clase`),
      // Exportación: los pedidos en Proceso de clientes de exportación (venta local no lleva pedido).
      prisma.$queryRawUnsafe(`
        SELECT p.CodigoPedido, p.Descripcion, c.RazonSocial AS Cliente
          FROM Pedidos p JOIN Clientes c ON c.Codigo = p.CodigoCliente
         WHERE p.Estatus = 'Proceso' AND c.Tipo = 'Exportacion'
         ORDER BY c.RazonSocial, p.CodigoPedido`),
    ]);
    res.json({
      empaques: (empaques as any[]).map(e => ({ ...e, ConRango: Number(e.ConRango) === 1 })),
      tallas, clases, pedidos,
      lotes: (lotes as any[]).map(l => ({ ...l, Kg: Number(l.Kg) })),
    });
  } catch (err: any) { responder(res, err); }
});

// GET /api/pesaje-bascula/lotes?q= — buscar un lote que no aparece al piso (se pesa igual).
router.get("/lotes", requirePerm("pesaje_bascula", "usar"), async (req: AuthRequest, res: Response) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) { res.json([]); return; }
    const rows: any[] = await prisma.$queryRaw`
      SELECT l.Lote, l.Clase, c.Descripcion AS ClaseDesc
        FROM Lotes l LEFT JOIN Clase c ON c.Clase = l.Clase
       WHERE l.Activo = 1 AND l.Lote LIKE ${"%" + q + "%"} ORDER BY l.Fecha DESC LIMIT 20`;
    res.json(rows);
  } catch (err: any) { responder(res, err); }
});

// POST /api/pesaje-bascula/pesadas — { Uuid, SesionId, EmpaqueCodigo?, Lote, Clase, Talla, PersonaCodigo?, PesoBrutoG,
//                                       Carrito?, ClaseSalida?, Destino?, CodigoPedido? }
// Si el tipo de empaque tiene rango, solo dentro del rango: fuera NO se guarda (lo exige el servidor, no
// solo la pantalla). Mismo Uuid = misma pesada: un reintento no la duplica.
router.post("/pesadas", requirePerm("pesaje_bascula", "usar"), async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body ?? {};
    const uuid = String(b.Uuid ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(uuid)) throw new ErrorNegocio(400, "Identificador de pesada inválido");
    const r = await prisma.$transaction(async (tx: any) => {
      const [ya]: any[] = await tx.$queryRaw`SELECT PesadaId FROM Pesada WHERE Uuid = ${uuid}`;
      if (ya) return { PesadaId: Number(ya.PesadaId), repetida: true };

      const s = await exigirSesionAbierta(tx, Number(b.SesionId));
      if (s.Modo === "PPV") throw new ErrorNegocio(400, "Esta sesión es de prueba PPV: sus pesadas van a /pruebas");
      const pt = s.Modo === "PERSONA"; // producto terminado: carnet por bandeja, producto que sale y destino
      const peso = Number(b.PesoBrutoG);
      if (!Number.isInteger(peso) || peso <= 0) throw new ErrorNegocio(400, "Peso inválido");

      // Tipo de empaque: obligatorio en "por producto"; opcional en producto terminado (peso libre).
      // Con rango, solo se guarda dentro; "sin rango", cualquier peso estable.
      const empCodigo = String(b.EmpaqueCodigo ?? "").trim();
      let emp: any = null;
      if (empCodigo) {
        [emp] = await tx.$queryRaw`
          SELECT Codigo, PesoBrutoG, TaraG, MinG, MaxG, ConRango FROM EmpaquePesaje WHERE Codigo = ${empCodigo} AND Activo = 1`;
        if (!emp) throw new ErrorNegocio(400, "Ese tipo de empaque ya no está activo");
      } else if (!pt) {
        throw new ErrorNegocio(400, "Elija el tipo de empaque");
      }
      const conRango = emp && Number(emp.ConRango) === 1;
      if (conRango && (peso < Number(emp.MinG) || peso > Number(emp.MaxG))) {
        throw new ErrorNegocio(400, `${peso} g está fuera del rango ${emp.MinG}–${emp.MaxG} g: no se guarda`);
      }

      // Carrito: obligatorio donde el área lo pide (Empanizado), como el termo en Pelado.
      const carrito = String(b.Carrito ?? "").trim().toUpperCase().slice(0, 20) || null;
      // Solo en producto terminado: "por producto" no lleva carrito (usuario, 17 nov 2026).
      if (pt && Number(s.PideCarrito) === 1 && !carrito) throw new ErrorNegocio(400, "Escriba el número de carrito");

      // Producto terminado: producto que sale y destino (exportación con pedido en Proceso, o venta local).
      let claseSalida: string | null = null, destino: string | null = null, pedido: string | null = null;
      if (pt) {
        claseSalida = String(b.ClaseSalida ?? "").trim() || null;
        if (!claseSalida) throw new ErrorNegocio(400, "Elija el producto que sale");
        const [cs]: any[] = await tx.$queryRaw`SELECT Clase FROM Clase WHERE Clase = ${claseSalida}`;
        if (!cs) throw new ErrorNegocio(400, `No existe el producto ${claseSalida}`);
        destino = String(b.Destino ?? "").toUpperCase();
        if (destino !== "EXPORTACION" && destino !== "LOCAL") throw new ErrorNegocio(400, "Elija el destino: exportación o venta local");
        if (destino === "EXPORTACION") {
          pedido = String(b.CodigoPedido ?? "").trim() || null;
          if (!pedido) throw new ErrorNegocio(400, "Elija el pedido de exportación");
          const [pe]: any[] = await tx.$queryRaw`
            SELECT p.CodigoPedido FROM Pedidos p JOIN Clientes c ON c.Codigo = p.CodigoCliente
             WHERE p.CodigoPedido = ${pedido} AND p.Estatus = 'Proceso' AND c.Tipo = 'Exportacion'`;
          if (!pe) throw new ErrorNegocio(400, `El pedido ${pedido} no está en proceso o no es de exportación`);
        }
      }
      // El lote del piso trae la clase del producto ya procesado (E53, E92…), mientras que en Lotes está
      // con la de materia prima (D30, D31): exigir el par (Lote, Clase) en Lotes rechazaba todo lo del
      // piso (17 nov 2026, "Elija el lote" en BAL-01). Basta con que el lote exista —en Lotes o al piso—
      // y la clase exista en el catálogo.
      const loteTxt = String(b.Lote ?? "").trim(), claseTxt = String(b.Clase ?? "").trim();
      if (!loteTxt) throw new ErrorNegocio(400, "Elija el lote");
      if (!claseTxt) throw new ErrorNegocio(400, "Elija el tipo de producto");
      const [lote]: any[] = await tx.$queryRaw`
        SELECT 1 AS ok FROM Lotes WHERE Lote = ${loteTxt}
        UNION ALL SELECT 1 FROM MovimientoPiso WHERE Lote = ${loteTxt} LIMIT 1`;
      if (!lote) throw new ErrorNegocio(400, `No existe el lote ${loteTxt}`);
      const [clase]: any[] = await tx.$queryRaw`SELECT Clase FROM Clase WHERE Clase = ${claseTxt}`;
      if (!clase) throw new ErrorNegocio(400, `No existe el tipo de producto ${claseTxt}`);
      const [talla]: any[] = await tx.$queryRaw`SELECT Codigo FROM Tallas WHERE Codigo = ${Number(b.Talla)}`;
      if (!talla) throw new ErrorNegocio(400, "Elija la talla");
      let persona: string | null = null;
      if (pt) {
        persona = String(b.PersonaCodigo ?? "").trim().toUpperCase();
        if (!persona) throw new ErrorNegocio(400, "Escanee el carnet de quien armó esta bandeja");
        if (!(await empleadoActivo(tx, persona))) throw new ErrorNegocio(400, `${persona}: carnet no encontrado o de baja`);
      }

      await tx.$executeRaw`
        INSERT INTO Pesada (Uuid, SesionId, BalanzaCodigo, OperadoraCodigo, AreaCodigo, BodegaVirtualCodigo, Modo,
                            EmpaqueCodigo, Lote, Clase, Talla, PersonaCodigo, PesoBrutoG, PesoNetoG,
                            ObjetivoG, MinG, MaxG, FechaProduccion, ClaseSalida, Destino, CodigoPedido, Carrito)
        VALUES (${uuid}, ${s.SesionId}, ${s.BalanzaCodigo}, ${s.OperadoraCodigo}, ${s.AreaCodigo}, ${s.BodegaVirtualCodigo},
                ${s.Modo}, ${emp ? emp.Codigo : null}, ${loteTxt}, ${claseTxt}, ${Number(b.Talla)}, ${persona},
                ${peso}, ${peso - (emp ? Number(emp.TaraG) : 0)},
                ${conRango ? Number(emp.PesoBrutoG) : null}, ${conRango ? Number(emp.MinG) : null}, ${conRango ? Number(emp.MaxG) : null},
                ${s.FechaProduccion}, ${claseSalida}, ${destino}, ${pedido}, ${carrito})`;
      const [{ id }]: any[] = await tx.$queryRaw`SELECT LAST_INSERT_ID() AS id`;
      await tx.$executeRaw`UPDATE SesionBascula SET UltimaActividad = NOW() WHERE SesionId = ${s.SesionId}`;
      const [{ n }]: any[] = await tx.$queryRaw`
        SELECT COUNT(*) AS n FROM Pesada WHERE BalanzaCodigo = ${s.BalanzaCodigo} AND FechaProduccion = ${s.FechaProduccion} AND Anulada = 0`;
      return { PesadaId: Number(id), Numero: Number(n) };
    });
    res.status(201).json(r);
  } catch (err: any) { responder(res, err); }
});

// GET /api/pesaje-bascula/sesion/:id/resumen — contadores del día de la báscula y últimas pesadas.
router.get("/sesion/:id/resumen", requirePerm("pesaje_bascula", "usar"), async (req: AuthRequest, res: Response) => {
  try {
    const s = await datosSesion(prisma, Number(req.params.id));
    if (!s) throw new ErrorNegocio(404, "La sesión no existe");
    if (s.Modo === "PPV") {
      const [t]: any[] = await prisma.$queryRaw`
        SELECT COALESCE(SUM(Resultado = 'OK'), 0) AS Cajas,
               COALESCE(SUM(CASE WHEN Resultado = 'OK' THEN PesoNetoG END), 0) AS NetoG,
               COALESCE(SUM(Resultado <> 'OK'), 0) AS Fuera
          FROM PesadaPrueba
         WHERE BalanzaCodigo = ${s.BalanzaCodigo} AND FechaProduccion = ${s.FechaProduccion} AND Anulada = 0`;
      const ult: any[] = await prisma.$queryRaw`
        SELECT PesadaId, PesoBrutoG, Lote, DATE_FORMAT(CreadoEn, '%H:%i:%s') AS Hora
          FROM PesadaPrueba
         WHERE SesionId = ${s.SesionId} AND Resultado = 'OK' AND Anulada = 0 ORDER BY PesadaId DESC LIMIT 8`;
      res.json({
        Cajas: Number(t.Cajas), NetoG: Number(t.NetoG), Fuera: Number(t.Fuera),
        ultimas: ult.map(u => ({ ...u, PesadaId: Number(u.PesadaId), PersonaCodigo: null })),
      });
      return;
    }
    const [tot]: any[] = await prisma.$queryRaw`
      SELECT COUNT(*) AS Cajas, COALESCE(SUM(PesoNetoG), 0) AS NetoG FROM Pesada
       WHERE BalanzaCodigo = ${s.BalanzaCodigo} AND FechaProduccion = ${s.FechaProduccion} AND Anulada = 0`;
    const ultimas: any[] = await prisma.$queryRaw`
      SELECT p.PesadaId, p.PesoBrutoG, p.PersonaCodigo, p.Lote, DATE_FORMAT(p.CreadoEn, '%H:%i:%s') AS Hora,
             CONCAT_WS(' ', e.PrimerNombre, e.PrimerApellido) AS Persona
        FROM Pesada p LEFT JOIN Empleados e ON e.Codigo = p.PersonaCodigo
       WHERE p.SesionId = ${s.SesionId} AND p.Anulada = 0 ORDER BY p.PesadaId DESC LIMIT 8`;
    res.json({ Cajas: Number(tot.Cajas), NetoG: Number(tot.NetoG), ultimas: ultimas.map(u => ({ ...u, PesadaId: Number(u.PesadaId) })) });
  } catch (err: any) { responder(res, err); }
});

// POST /api/pesaje-bascula/pesadas/:id/anular — { motivo } · permiso aparte (supervisor).
router.post("/pesadas/:id/anular", requirePerm("pesaje_bascula", "anular_caja"), async (req: AuthRequest, res: Response) => {
  try {
    const motivo = String(req.body?.motivo ?? "").trim().slice(0, 200);
    if (!motivo) throw new ErrorNegocio(400, "Escriba por qué se anula");
    const n = await prisma.$executeRaw`
      UPDATE Pesada SET Anulada = 1, AnuladaPor = ${req.user!.username}, AnuladaEn = NOW(), MotivoAnulacion = ${motivo}
       WHERE PesadaId = ${Number(req.params.id)} AND Anulada = 0`;
    if (!n) throw new ErrorNegocio(404, "No existe o ya estaba anulada");
    res.json({ ok: true });
  } catch (err: any) { responder(res, err); }
});

// POST /api/pesaje-bascula/pruebas — { Uuid, SesionId, EmpaqueCodigo, Lote, Talla, CodigoPedido, PesoBrutoG }
// Pesada de la prueba PPV. Dentro del rango queda Resultado OK (es la caja); fuera queda como intento
// BAJO/SOBRE —para saber cuántas veces se pasaron del límite— y la pantalla dice "SIN GUARDAR".
// El pedido es solo referencia: no suma al avance ni al cuadre. Mismo Uuid = misma pesada.
router.post("/pruebas", requirePerm("pesaje_bascula", "usar"), async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body ?? {};
    const uuid = String(b.Uuid ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(uuid)) throw new ErrorNegocio(400, "Identificador de pesada inválido");
    const r = await prisma.$transaction(async (tx: any) => {
      const [ya]: any[] = await tx.$queryRaw`SELECT PesadaId, Resultado FROM PesadaPrueba WHERE Uuid = ${uuid}`;
      if (ya) return { PesadaId: Number(ya.PesadaId), repetida: true, guardada: ya.Resultado === "OK", Resultado: ya.Resultado };

      const s = await exigirSesionAbierta(tx, Number(b.SesionId));
      if (s.Modo !== "PPV") throw new ErrorNegocio(400, "Esta sesión no es de prueba PPV");
      const peso = Number(b.PesoBrutoG);
      if (!Number.isInteger(peso) || peso <= 0) throw new ErrorNegocio(400, "Peso inválido");
      const [emp]: any[] = await tx.$queryRaw`
        SELECT Codigo, PesoBrutoG, TaraG, MinG, MaxG FROM EmpaquePesaje
         WHERE Codigo = ${String(b.EmpaqueCodigo ?? "").trim()} AND Activo = 1 AND ConRango = 1`;
      if (!emp) throw new ErrorNegocio(400, "Elija un tipo de empaque con rango");
      const lote = String(b.Lote ?? "").trim().toUpperCase();
      if (!lote) throw new ErrorNegocio(400, "Escriba el lote");
      if (lote.length > 30) throw new ErrorNegocio(400, "El lote no puede pasar de 30 caracteres");
      const [talla]: any[] = await tx.$queryRaw`SELECT Codigo FROM Tallas WHERE Codigo = ${Number(b.Talla)}`;
      if (!talla) throw new ErrorNegocio(400, "Elija la talla");
      const pedido = String(b.CodigoPedido ?? "").trim();
      if (!pedido) throw new ErrorNegocio(400, "Elija el pedido");
      const [pe]: any[] = await tx.$queryRaw`SELECT CodigoPedido FROM Pedidos WHERE CodigoPedido = ${pedido} AND Estatus = 'Proceso'`;
      if (!pe) throw new ErrorNegocio(400, `El pedido ${pedido} no está en proceso`);

      const resultado = peso < Number(emp.MinG) ? "BAJO" : peso > Number(emp.MaxG) ? "SOBRE" : "OK";
      await tx.$executeRaw`
        INSERT INTO PesadaPrueba (Uuid, SesionId, BalanzaCodigo, OperadoraCodigo, AreaCodigo, Tipo, Resultado,
                                  EmpaqueCodigo, Lote, Talla, CodigoPedido, PesoBrutoG, PesoNetoG,
                                  ObjetivoG, MinG, MaxG, FechaProduccion)
        VALUES (${uuid}, ${s.SesionId}, ${s.BalanzaCodigo}, ${s.OperadoraCodigo}, ${s.AreaCodigo}, 'PPV', ${resultado},
                ${emp.Codigo}, ${lote}, ${Number(b.Talla)}, ${pedido}, ${peso}, ${peso - Number(emp.TaraG)},
                ${Number(emp.PesoBrutoG)}, ${Number(emp.MinG)}, ${Number(emp.MaxG)}, ${s.FechaProduccion})`;
      const [{ id }]: any[] = await tx.$queryRaw`SELECT LAST_INSERT_ID() AS id`;
      await tx.$executeRaw`UPDATE SesionBascula SET UltimaActividad = NOW() WHERE SesionId = ${s.SesionId}`;
      const [{ n }]: any[] = await tx.$queryRaw`
        SELECT COUNT(*) AS n FROM PesadaPrueba
         WHERE BalanzaCodigo = ${s.BalanzaCodigo} AND FechaProduccion = ${s.FechaProduccion} AND Resultado = 'OK' AND Anulada = 0`;
      return { PesadaId: Number(id), Numero: Number(n), guardada: resultado === "OK", Resultado: resultado };
    });
    res.status(201).json(r);
  } catch (err: any) { responder(res, err); }
});

// POST /api/pesaje-bascula/pruebas/:id/anular — { motivo } · mismo permiso de supervisor.
router.post("/pruebas/:id/anular", requirePerm("pesaje_bascula", "anular_caja"), async (req: AuthRequest, res: Response) => {
  try {
    const motivo = String(req.body?.motivo ?? "").trim().slice(0, 200);
    if (!motivo) throw new ErrorNegocio(400, "Escriba por qué se anula");
    const n = await prisma.$executeRaw`
      UPDATE PesadaPrueba SET Anulada = 1, AnuladaPor = ${req.user!.username}, AnuladaEn = NOW(), MotivoAnulacion = ${motivo}
       WHERE PesadaId = ${Number(req.params.id)} AND Anulada = 0`;
    if (!n) throw new ErrorNegocio(404, "No existe o ya estaba anulada");
    res.json({ ok: true });
  } catch (err: any) { responder(res, err); }
});

export default router;
