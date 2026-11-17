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
const MODOS = ["PERSONA", "PRODUCTO"];

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
    SELECT t.CodigoArea, a.Nombre AS NombreArea, a.EsPesadora, a.ModoPesaje, a.BodegaVirtualCodigo, bv.Nombre AS BodegaNombre
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
           s.BodegaVirtualCodigo, bv.Nombre AS BodegaNombre, s.Modo,
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

// POST /api/pesaje-bascula/sesion — { balanza, carnet, bodega?, modo? }
// Si el área no define bodega o modo, responde { necesita } con las opciones y la pantalla pregunta.
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

      let bodega: string | null = a.BodegaVirtualCodigo ?? null;
      let modo: string | null = a.ModoPesaje ?? null;
      if (!bodega && req.body?.bodega) {
        const [bv]: any[] = await tx.$queryRaw`SELECT Codigo FROM BodegaVirtual WHERE Codigo = ${String(req.body.bodega)} AND Activo = 1`;
        if (bv) bodega = bv.Codigo;
      }
      if (!modo && MODOS.includes(String(req.body?.modo ?? "").toUpperCase())) modo = String(req.body.modo).toUpperCase();
      if (!bodega || !modo) {
        const bodegas: any[] = !bodega
          ? await tx.$queryRawUnsafe(`SELECT Codigo, Nombre FROM BodegaVirtual WHERE Activo = 1 ORDER BY Orden, Nombre`)
          : [];
        return { necesita: { bodega: !bodega, modo: !modo }, bodegas, operadora: e.NombreCompleto, area: a.NombreArea };
      }

      // Una báscula, una sesión: la que estuviera abierta se cierra.
      await tx.$executeRaw`
        UPDATE SesionBascula SET Fin = NOW(), MotivoFin = 'entró otra persona'
         WHERE BalanzaCodigo = ${balanza} AND Fin IS NULL`;
      await tx.$executeRaw`
        INSERT INTO SesionBascula (BalanzaCodigo, OperadoraCodigo, AreaCodigo, BodegaVirtualCodigo, Modo, FechaProduccion, Usuario)
        VALUES (${balanza}, ${carnet}, ${a.CodigoArea}, ${bodega}, ${modo}, ${hoyGT()}, ${req.user!.username})`;
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
    const [empaques, tallas, lotes] = await Promise.all([
      prisma.$queryRawUnsafe(`
        SELECT Codigo, Nombre, Unidad, PesoNetoG, TaraG, DeshidratacionG, PesoBrutoG, MinG, MaxG
          FROM EmpaquePesaje WHERE Activo = 1 ORDER BY Nombre`),
      prisma.$queryRawUnsafe(`SELECT Codigo, Descripcion FROM Tallas WHERE Activo = 1 ORDER BY Codigo`),
      // Inventario al piso de la bodega: lo que entró menos lo que salió, por Lote/Clase/Talla.
      prisma.$queryRawUnsafe(`
        SELECT t.Lote, t.Clase, t.Talla, ta.Descripcion AS TallaDesc, ROUND(SUM(t.Kg), 2) AS Kg
          FROM (SELECT Lote, Clase, Talla, PesoKg AS Kg FROM MovimientoPiso WHERE BodegaDestino = ?
                UNION ALL
                SELECT Lote, Clase, Talla, -PesoKg FROM MovimientoPiso WHERE BodegaOrigen = ?) t
          LEFT JOIN Tallas ta ON ta.Codigo = t.Talla
         GROUP BY t.Lote, t.Clase, t.Talla, ta.Descripcion
        HAVING SUM(t.Kg) > 0.01
         ORDER BY t.Lote, t.Clase`, s.BodegaVirtualCodigo, s.BodegaVirtualCodigo),
    ]);
    res.json({ empaques, tallas, lotes: (lotes as any[]).map(l => ({ ...l, Kg: Number(l.Kg) })) });
  } catch (err: any) { responder(res, err); }
});

// GET /api/pesaje-bascula/lotes?q= — buscar un lote que no aparece al piso (se pesa igual).
router.get("/lotes", requirePerm("pesaje_bascula", "usar"), async (req: AuthRequest, res: Response) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) { res.json([]); return; }
    const rows: any[] = await prisma.$queryRaw`
      SELECT Lote, Clase FROM Lotes WHERE Activo = 1 AND Lote LIKE ${"%" + q + "%"} ORDER BY Fecha DESC LIMIT 20`;
    res.json(rows);
  } catch (err: any) { responder(res, err); }
});

// POST /api/pesaje-bascula/pesadas — { Uuid, SesionId, EmpaqueCodigo, Lote, Clase, Talla, PersonaCodigo?, PesoBrutoG }
// Solo dentro del rango del tipo de empaque: fuera de rango NO se guarda (lo exige el servidor, no
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
      const [emp]: any[] = await tx.$queryRaw`
        SELECT Codigo, PesoBrutoG, TaraG, MinG, MaxG FROM EmpaquePesaje WHERE Codigo = ${String(b.EmpaqueCodigo ?? "")} AND Activo = 1`;
      if (!emp) throw new ErrorNegocio(400, "Elija un tipo de empaque activo");
      const peso = Number(b.PesoBrutoG);
      if (!Number.isInteger(peso)) throw new ErrorNegocio(400, "Peso inválido");
      if (peso < Number(emp.MinG) || peso > Number(emp.MaxG)) {
        throw new ErrorNegocio(400, `${peso} g está fuera del rango ${emp.MinG}–${emp.MaxG} g: no se guarda`);
      }
      const [lote]: any[] = await tx.$queryRaw`
        SELECT Lote FROM Lotes WHERE Lote = ${String(b.Lote ?? "")} AND Clase = ${String(b.Clase ?? "")}`;
      if (!lote) throw new ErrorNegocio(400, "Elija el lote");
      const [talla]: any[] = await tx.$queryRaw`SELECT Codigo FROM Tallas WHERE Codigo = ${Number(b.Talla)}`;
      if (!talla) throw new ErrorNegocio(400, "Elija la talla");
      let persona: string | null = null;
      if (s.Modo === "PERSONA") {
        persona = String(b.PersonaCodigo ?? "").trim().toUpperCase();
        if (!persona) throw new ErrorNegocio(400, "Escanee el carnet de quien armó esta caja");
        if (!(await empleadoActivo(tx, persona))) throw new ErrorNegocio(400, `${persona}: carnet no encontrado o de baja`);
      }

      await tx.$executeRaw`
        INSERT INTO Pesada (Uuid, SesionId, BalanzaCodigo, OperadoraCodigo, AreaCodigo, BodegaVirtualCodigo, Modo,
                            EmpaqueCodigo, Lote, Clase, Talla, PersonaCodigo, PesoBrutoG, PesoNetoG,
                            ObjetivoG, MinG, MaxG, FechaProduccion)
        VALUES (${uuid}, ${s.SesionId}, ${s.BalanzaCodigo}, ${s.OperadoraCodigo}, ${s.AreaCodigo}, ${s.BodegaVirtualCodigo},
                ${s.Modo}, ${emp.Codigo}, ${String(b.Lote)}, ${String(b.Clase)}, ${Number(b.Talla)}, ${persona},
                ${peso}, ${peso - Number(emp.TaraG)}, ${Number(emp.PesoBrutoG)}, ${Number(emp.MinG)}, ${Number(emp.MaxG)},
                ${s.FechaProduccion})`;
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

export default router;
