import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm, AuthRequest } from "../middleware/auth.ts";
import { MASTER_SELECT, formatearMaster } from "../lib/masters.ts";

// Salida de bodega = Remisión (ver createRemisiones.ts para el modelo y las decisiones de diseño).
//
// Ciclo de vida:  Borrador ──confirmar──> Confirmada ──anular──> Anulada
//                    └──eliminar──> (borrada, no deja rastro: nunca tocó inventario)
//
// El inventario SOLO se mueve al confirmar. Mientras es Borrador, agregar/quitar líneas no cambia el
// Estatus de ningún master — pero sí los "reserva" vía el UNIQUE (MasterId, Vigente) de
// RemisionDetalle, así dos remisiones en borrador no pueden pelearse el mismo master.
const router = Router();

// Mismo patrón que pallets.ts / bodegaFisica.ts: error de negocio lanzado dentro de la transacción,
// traducido a su status HTTP por el catch de la ruta en vez de un 500 genérico.
class ErrorNegocio extends Error {
  status: number;
  constructor(status: number, mensaje: string) {
    super(mensaje);
    this.status = status;
  }
}

function getOperador(req: Request): string {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return "Sistema";
    const payload: any = jwt.verify(header.slice(7), process.env.JWT_SECRET!);
    return payload.nombre ?? payload.username ?? "Sistema";
  } catch {
    return "Sistema";
  }
}

// Acepta el correlativo tal como lo ve el operador ("E120") o el número pelado (120) — misma función
// que pallets.ts usa al escanear la entrada.
function parseCorrelativo(valor: any): number | null {
  const n = Number(String(valor ?? "").trim().replace(/^[eE]/, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
}

function esFechaValida(valor: any): boolean {
  return typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor) && !Number.isNaN(Date.parse(valor));
}

// Traduce un choque de llave foránea al campo concreto que falló. El nombre del constraint viene en
// el mensaje de MySQL, y es el único dato que distingue cuál de los tres campos con FK reventó —
// un mensaje que enumera "cliente, subcliente o área" obliga al operador a adivinar.
function mensajeLlaveForanea(mensaje: string): string {
  if (mensaje.includes("fk_remision_subcliente")) return "Ese subcliente no pertenece al cliente seleccionado";
  if (mensaje.includes("fk_remision_cliente")) return "El cliente indicado no existe";
  if (mensaje.includes("fk_remision_area")) return "El área de destino indicada no existe";
  return "Uno de los datos indicados no existe en su catálogo";
}

// Valida y normaliza los campos de destino según lo que declare la SERIE (columna Destino), no
// según una lista de tipos escrita aquí: los destinos son catálogo, y agregar uno nuevo no debe
// obligar a tocar esta función. Devuelve exactamente lo que va a la BD, con los campos del otro
// destino forzados a null — así no sobrevive un AreaDestino colgado si una remisión se corrige.
interface Serie { Tipo: string; Nombre: string; Destino: string; TipoCliente: string | null; PidePedido: number; PideEmbarque: number }

// Contenedor y sello/marchamo son obligatorios en las series con PideEmbarque = 1 (Exportación):
// sin ellos el documento no sirve para el embarque. En las demás ni siquiera se guardan — si una
// venta local trae esos campos por error, se descartan en vez de dejar datos sueltos en la tabla.
function resolverEmbarque(serie: Serie, body: any) {
  if (Number(serie.PideEmbarque) !== 1) return { Contenedor: null, Sello: null };
  const contenedor = String(body.Contenedor ?? "").trim();
  const sello = String(body.Sello ?? "").trim();
  if (!contenedor) throw new ErrorNegocio(400, `El número de contenedor es requerido para una remisión de ${serie.Nombre.toLowerCase()}`);
  if (!sello) throw new ErrorNegocio(400, `El sello / marchamo es requerido para una remisión de ${serie.Nombre.toLowerCase()}`);
  return { Contenedor: contenedor, Sello: sello };
}

// Resuelve el destino del documento a partir de lo que declara la SERIE, no de una lista de tipos
// escrita aquí. Tres formas, en orden de precedencia:
//   1. Destino 'Area'   → traslado interno: se exige AreaDestino y no hay cliente.
//   2. PidePedido = 1   → la remisión nace DE UN PEDIDO (Exportación): se exige CodigoPedido y el
//                         cliente/subcliente se HEREDAN de él; lo que venga en el body se ignora.
//   3. resto            → se elige el cliente a mano (venta local, maquila).
//
// En el caso 2 el cliente igual se GUARDA en la remisión en vez de leerse siempre del pedido: es una
// foto del momento. Si mañana alguien corrige el cliente del pedido, un documento ya impreso y
// entregado no puede cambiar de destinatario retroactivamente.
async function resolverDestino(client: any, serie: Serie, body: any) {
  if (serie.Destino === "Area") {
    const area = String(body.AreaDestino ?? "").trim();
    if (!area) throw new ErrorNegocio(400, `El área de destino es requerida para una remisión de ${serie.Nombre.toLowerCase()}`);
    return { CodigoCliente: null, CodigoSubcliente: null, AreaDestino: area, CodigoPedido: null };
  }

  if (Number(serie.PidePedido) === 1) {
    const codigoPedido = String(body.CodigoPedido ?? "").trim();
    if (!codigoPedido) throw new ErrorNegocio(400, `El pedido es requerido para una remisión de ${serie.Nombre.toLowerCase()}`);
    const rows: any[] = await client.$queryRaw`
      SELECT CodigoPedido, CodigoCliente, CodigoSubcliente FROM Pedidos WHERE CodigoPedido = ${codigoPedido} LIMIT 1
    `;
    if (!rows.length) throw new ErrorNegocio(400, `El pedido ${codigoPedido} no existe`);
    return {
      CodigoCliente: Number(rows[0].CodigoCliente),
      CodigoSubcliente: rows[0].CodigoSubcliente ?? null,
      AreaDestino: null,
      CodigoPedido: rows[0].CodigoPedido,
    };
  }

  const codigoCliente = Number(body.CodigoCliente);
  if (!Number.isInteger(codigoCliente) || codigoCliente <= 0) {
    throw new ErrorNegocio(400, `El cliente es requerido para una remisión de ${serie.Nombre.toLowerCase()}`);
  }
  const sub = String(body.CodigoSubcliente ?? "").trim();
  return { CodigoCliente: codigoCliente, CodigoSubcliente: sub || null, AreaDestino: null, CodigoPedido: null };
}

// Que la pantalla filtre el desplegable no basta: el filtro es una comodidad, esto es el candado.
// Sin esto, un POST armado a mano (o una pantalla con el catálogo cacheado viejo) podría mandar una
// venta local a un cliente de exportación. `TipoCliente` null en la serie = no aplica restricción.
// También cubre el caso del pedido: si se elige un pedido cuyo cliente es local, una exportación lo
// rechaza aquí — el cliente llega heredado, pero no por eso deja de validarse.
async function validarTipoCliente(client: any, serie: { Nombre: string; TipoCliente: string | null }, codigoCliente: number | null) {
  if (!serie.TipoCliente || codigoCliente == null) return;
  const rows: any[] = await client.$queryRaw`
    SELECT RazonSocial, Tipo FROM Clientes WHERE Codigo = ${codigoCliente} LIMIT 1
  `;
  if (!rows.length) throw new ErrorNegocio(400, "El cliente indicado no existe");
  if (rows[0].Tipo !== serie.TipoCliente) {
    const esperado = serie.TipoCliente === "Local" ? "local" : "de exportación";
    const real = rows[0].Tipo === "Local" ? "local" : "de exportación";
    throw new ErrorNegocio(400,
      `${rows[0].RazonSocial} es un cliente ${real} y una remisión de ${serie.Nombre.toLowerCase()} requiere un cliente ${esperado}. ` +
      `Si está mal clasificado, corrígelo en Catálogos → Clientes.`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Lecturas
// ─────────────────────────────────────────────────────────────────────────────────────────────────

// GET /api/remisiones/series — catálogo para el selector de Tipo del formulario.
router.get("/series", requireAuth, requirePerm("remisiones", "ver"), async (_req: Request, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT Tipo, Prefijo, Nombre, Destino, TipoCliente, PideEmbarque, PidePedido, PideLinea
      FROM SerieRemision WHERE Activo = 1 ORDER BY Orden ASC, Nombre ASC
    `;
    // Destino/PideEmbarque/PidePedido viajan al frontend para que el formulario sepa qué campos
    // mostrar sin repetir la regla en JS — misma fuente de verdad que usa la validación del backend.
    res.json(rows.map(r => ({
      ...r,
      PideEmbarque: Number(r.PideEmbarque) === 1,
      PidePedido: Number(r.PidePedido) === 1,
      PideLinea: Number(r.PideLinea) === 1,
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/remisiones?tipo=&estatus=&fecha= — lista con los agregados de su contenido.
// Los totales salen del mismo join de siempre, colapsado por remisión: nada de esto se guarda
// denormalizado en la cabecera (se recalcula solo si se agrega o quita una línea).
router.get("/", requireAuth, requirePerm("remisiones", "ver"), async (req: Request, res: Response) => {
  try {
    const condiciones: string[] = [];
    const params: any[] = [];
    if (req.query.tipo)    { condiciones.push("r.Tipo = ?");    params.push(req.query.tipo); }
    if (req.query.estatus) { condiciones.push("r.Estatus = ?"); params.push(req.query.estatus); }
    if (req.query.fecha)   { condiciones.push("r.Fecha = ?");   params.push(req.query.fecha); }
    const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT r.RemisionId, r.Folio, r.Tipo, r.Estatus, r.Fecha,
             r.CodigoCliente, r.CodigoSubcliente, r.AreaDestino, r.CodigoPedido, r.EsMixta,
             r.Contenedor, r.Sello, r.Observaciones,
             r.CreadoPor, r.CreadoEn, r.ConfirmadaPor, r.ConfirmadaEn,
             r.AnuladaPor, r.AnuladaEn, r.MotivoAnulacion,
             se.Nombre AS NombreTipo, se.Destino,
             cli.RazonSocial AS NombreCliente, sub.RazonSocial AS NombreSubcliente,
             ar.Nombre AS NombreAreaDestino,
             COUNT(rd.DetalleId) AS CantidadMasters,
             COALESCE(SUM(pr.PesoKG * pr.CajasXMaster), 0) AS PesoKg,
             COALESCE(SUM(pr.PesoLb * pr.CajasXMaster), 0) AS PesoLb
      FROM Remisiones r
      JOIN SerieRemision se ON r.Tipo = se.Tipo
      LEFT JOIN Clientes cli ON r.CodigoCliente = cli.Codigo
      LEFT JOIN Subcliente sub ON r.CodigoCliente = sub.CodigoCliente AND r.CodigoSubcliente = sub.CodigoSubcliente
      LEFT JOIN Areas ar ON r.AreaDestino = ar.Codigo
      LEFT JOIN RemisionDetalle rd ON rd.RemisionId = r.RemisionId AND rd.Vigente = 1
      LEFT JOIN Masters m ON rd.MasterId = m.MasterId
      LEFT JOIN EtiquetaImpresa ei ON m.EtiquetaId = ei.EtiquetaId
      LEFT JOIN OrdenEtiquetado oe ON ei.OrdenId = oe.OrdenId
      LEFT JOIN DetallePedido dp ON oe.DetalleId = dp.DetalleId
      LEFT JOIN Presentacion pr ON dp.Presentacion = pr.Codigo
      ${where}
      GROUP BY r.RemisionId
      ORDER BY r.RemisionId DESC LIMIT 500
    `, ...params);

    res.json(rows.map(r => ({
      ...r,
      RemisionId: Number(r.RemisionId),
      CodigoCliente: r.CodigoCliente == null ? null : Number(r.CodigoCliente),
      EsMixta: Number(r.EsMixta) === 1,
      CantidadMasters: Number(r.CantidadMasters),
      PesoKg: Number(r.PesoKg), PesoLb: Number(r.PesoLb),
      Fecha: r.Fecha ? new Date(r.Fecha).toISOString().slice(0, 10) : null,
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/remisiones/disponibles/pallets — polines completos que se pueden despachar tal cual.
// Solo Cerrados: un pallet Abierto sigue armándose en su área, y uno Despachado ya no
// existe como unidad. Se excluyen los que tengan CUALQUIER master ya tomado por otra remisión
// vigente — un polín se agrega entero o no se agrega.
router.get("/disponibles/pallets", requireAuth, requirePerm("remisiones", "ver"), async (_req: Request, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT p.PalletId, p.Codigo, p.CerradoEn, po.Codigo AS PosicionCodigo,
             bv.Nombre AS NombreBodegaVirtual, org.Descripcion AS DescripcionOrigen,
             COUNT(m.MasterId) AS CantidadMasters,
             COALESCE(SUM(pr.PesoKG * pr.CajasXMaster), 0) AS PesoKg,
             COALESCE(SUM(pr.PesoLb * pr.CajasXMaster), 0) AS PesoLb,
             GROUP_CONCAT(DISTINCT cli.RazonSocial ORDER BY cli.RazonSocial SEPARATOR ', ') AS Clientes,
             GROUP_CONCAT(DISTINCT ped.CodigoPedido ORDER BY ped.CodigoPedido SEPARATOR ', ') AS Pedidos,
             GROUP_CONCAT(DISTINCT oe.Lote ORDER BY oe.Lote SEPARATOR ', ') AS Lotes,
             GROUP_CONCAT(DISTINCT CONCAT(pc.Descripcion, ' ', ta.Descripcion, ' ', pr.Descripcion) SEPARATOR ' · ') AS Productos
      FROM Pallets p
      JOIN Masters m ON m.PalletId = p.PalletId AND m.Estatus = 'EnBodega'
      JOIN EtiquetaImpresa ei ON m.EtiquetaId = ei.EtiquetaId
      JOIN OrdenEtiquetado oe ON ei.OrdenId = oe.OrdenId
      JOIN DetallePedido dp ON oe.DetalleId = dp.DetalleId
      JOIN Clase cl ON dp.Clase = cl.Clase
      JOIN Procesos pc ON cl.Proceso = pc.Proceso
      JOIN Tallas ta ON dp.Talla = ta.Codigo
      JOIN Presentacion pr ON dp.Presentacion = pr.Codigo
      JOIN Pedidos ped ON dp.CodigoPedido = ped.CodigoPedido
      JOIN Clientes cli ON ped.CodigoCliente = cli.Codigo
      LEFT JOIN Posiciones po ON p.PosicionId = po.PosicionId
      LEFT JOIN BodegaVirtual bv ON p.BodegaVirtualCodigo = bv.Codigo
      LEFT JOIN Origen org ON p.Origen = org.Codigo
      WHERE p.Estatus = 'Cerrado'
        AND NOT EXISTS (
          SELECT 1 FROM RemisionDetalle rd
          JOIN Masters m2 ON rd.MasterId = m2.MasterId
          WHERE m2.PalletId = p.PalletId AND rd.Vigente = 1
        )
      GROUP BY p.PalletId
      ORDER BY p.CerradoEn ASC
    `;
    res.json(rows.map(r => ({
      ...r,
      PalletId: Number(r.PalletId), CantidadMasters: Number(r.CantidadMasters),
      PesoKg: Number(r.PesoKg), PesoLb: Number(r.PesoLb),
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/remisiones/disponibles/masters?q= — todo master que siga en bodega y no esté tomado por
// otra remisión, esté armado en su polín o suelto. Filtrable por texto libre sobre
// correlativo/pedido/cliente/lote/producto.
router.get("/disponibles/masters", requireAuth, requirePerm("remisiones", "ver"), async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const filtro = q
      ? `AND (CONCAT('E', m.EtiquetaId) LIKE ? OR dp.CodigoPedido LIKE ? OR cli.RazonSocial LIKE ?
              OR oe.Lote LIKE ? OR pc.Descripcion LIKE ? OR ta.Descripcion LIKE ?)`
      : "";
    const like = `%${q}%`;
    const params = q ? [like, like, like, like, like, like] : [];

    const rows: any[] = await prisma.$queryRawUnsafe(`
      ${MASTER_SELECT}
      WHERE m.Estatus <> 'Salido'
        AND NOT EXISTS (SELECT 1 FROM RemisionDetalle rd WHERE rd.MasterId = m.MasterId AND rd.Vigente = 1)
        ${filtro}
      ORDER BY m.MasterId ASC LIMIT 300
    `, ...params);
    res.json(rows.map(formatearMaster));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/remisiones/:id — cabecera + líneas con el detalle completo de cada master.
router.get("/:id", requireAuth, requirePerm("remisiones", "ver"), async (req: Request, res: Response) => {
  try {
    const remisionId = Number(req.params.id);
    const rows: any[] = await prisma.$queryRaw`
      SELECT r.*, se.Nombre AS NombreTipo, se.Destino, se.PideEmbarque, se.PidePedido, se.PideLinea,
             cli.RazonSocial AS NombreCliente, sub.RazonSocial AS NombreSubcliente,
             ar.Nombre AS NombreAreaDestino, ped.Descripcion AS DescripcionPedido
      FROM Remisiones r
      JOIN SerieRemision se ON r.Tipo = se.Tipo
      LEFT JOIN Clientes cli ON r.CodigoCliente = cli.Codigo
      LEFT JOIN Subcliente sub ON r.CodigoCliente = sub.CodigoCliente AND r.CodigoSubcliente = sub.CodigoSubcliente
      LEFT JOIN Areas ar ON r.AreaDestino = ar.Codigo
      LEFT JOIN Pedidos ped ON r.CodigoPedido = ped.CodigoPedido
      WHERE r.RemisionId = ${remisionId} LIMIT 1
    `;
    if (!rows.length) { res.status(404).json({ error: "Remisión no encontrada" }); return; }
    const remision = rows[0];

    const detalle: any[] = await prisma.$queryRawUnsafe(`
      SELECT rd.DetalleId AS RemisionDetalleId, rd.LineaContenedor, rd.AgregadoPor, rd.AgregadoEn, sub2.*
      FROM RemisionDetalle rd
      JOIN (${MASTER_SELECT}) sub2 ON rd.MasterId = sub2.MasterId
      WHERE rd.RemisionId = ? AND rd.Vigente = 1
      ORDER BY rd.LineaContenedor ASC, rd.DetalleId ASC
    `, remisionId);

    // "Calza" = el cliente real de ese master (el que dice su etiqueta, vía su pedido) coincide con
    // el destino de la remisión. Se calcula al vuelo y NO se guarda: es un aviso visual para quien
    // arma el documento, no una restricción — mandarle a un cliente lo que sobró de otro pedido, sin
    // cambiar la etiqueta, es un escenario real y válido de carga.
    const lineas = detalle.map(d => {
      const m = formatearMaster(d);
      return {
        ...m,
        RemisionDetalleId: Number(d.RemisionDetalleId),
        LineaContenedor: d.LineaContenedor == null ? null : Number(d.LineaContenedor),
        CalzaConDestino: remision.CodigoCliente == null ? null : Number(remision.CodigoCliente) === m.CodigoCliente,
      };
    });

    res.json({
      ...remision,
      RemisionId: Number(remision.RemisionId),
      PideEmbarque: Number(remision.PideEmbarque) === 1,
      PidePedido: Number(remision.PidePedido) === 1,
      PideLinea: Number(remision.PideLinea) === 1,
      EsMixta: Number(remision.EsMixta) === 1,
      CodigoCliente: remision.CodigoCliente == null ? null : Number(remision.CodigoCliente),
      Fecha: remision.Fecha ? new Date(remision.Fecha).toISOString().slice(0, 10) : null,
      // La pantalla no recalcula el plazo: lo recibe resuelto para no tener el número 4 escrito en
      // dos lados que se puedan desincronizar.
      DiasParaAnular: DIAS_PARA_ANULAR,
      DiasDesdeConfirmada: diasDesdeConfirmada(remision.ConfirmadaEn),
      AnulacionVencida: anulacionVencida(remision.ConfirmadaEn),
      Lineas: lineas,
      CantidadMasters: lineas.length,
      PesoKg: lineas.reduce((acc, l) => acc + l.PesoMasterKG, 0),
      PesoLb: lineas.reduce((acc, l) => acc + l.PesoMasterLb, 0),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Cabecera
// ─────────────────────────────────────────────────────────────────────────────────────────────────

// POST /api/remisiones — crea la remisión en Borrador y le asigna folio de su serie.
router.post("/", requireAuth, requirePerm("remisiones", "crear"), async (req: Request, res: Response) => {
  try {
    const tipo = String(req.body.Tipo ?? "").trim();
    if (!tipo) { res.status(400).json({ error: "El tipo de remisión es requerido" }); return; }
    const fecha = String(req.body.Fecha ?? "").trim();
    if (!esFechaValida(fecha)) { res.status(400).json({ error: "La fecha es requerida (formato YYYY-MM-DD)" }); return; }

    const operador = getOperador(req);
    let respuesta: any = null;
    await prisma.$transaction(async (tx) => {
      // El secuencial se incrementa dentro de la transacción (UPDATE ... SET x = x + 1 bloquea la
      // fila hasta el commit) — dos remisiones creadas a la vez en la misma serie no pueden terminar
      // con el mismo folio. Mismo patrón que el código de pallet en pallets.ts.
      const serieRows: any[] = await tx.$queryRaw`
        SELECT Tipo, Prefijo, Nombre, Destino, TipoCliente, PidePedido, PideEmbarque, Activo
        FROM SerieRemision WHERE Tipo = ${tipo} FOR UPDATE
      `;
      if (!serieRows.length) throw new ErrorNegocio(400, "Tipo de remisión no válido");
      if (!Number(serieRows[0].Activo)) throw new ErrorNegocio(400, "Esta serie de remisión está inactiva");

      // Todo se valida contra la serie ya leída, y ANTES de consumir el folio: si falta el pedido,
      // el cliente, el área o los datos de embarque, la transacción revienta sin haber gastado un
      // número de la serie.
      const destino = await resolverDestino(tx, serieRows[0], req.body);
      await validarTipoCliente(tx, serieRows[0], destino.CodigoCliente);
      const embarque = resolverEmbarque(serieRows[0], req.body);

      await tx.$executeRaw`UPDATE SerieRemision SET UltimoSecuencial = UltimoSecuencial + 1 WHERE Tipo = ${tipo}`;
      const secRows: any[] = await tx.$queryRaw`SELECT UltimoSecuencial FROM SerieRemision WHERE Tipo = ${tipo}`;
      const folio = `${serieRows[0].Prefijo}-${String(Number(secRows[0].UltimoSecuencial)).padStart(4, "0")}`;

      await tx.$executeRaw`
        INSERT INTO Remisiones (Folio, Tipo, Fecha, CodigoCliente, CodigoSubcliente, AreaDestino, CodigoPedido,
                                EsMixta, Contenedor, Sello, Observaciones, CreadoPor)
        VALUES (${folio}, ${tipo}, ${fecha}, ${destino.CodigoCliente}, ${destino.CodigoSubcliente},
                ${destino.AreaDestino}, ${destino.CodigoPedido},
                ${Number(serieRows[0].PidePedido) === 1 && !!req.body.EsMixta ? 1 : 0},
                ${embarque.Contenedor}, ${embarque.Sello},
                ${String(req.body.Observaciones ?? "").trim() || null}, ${operador})
      `;
      const fila: any[] = await tx.$queryRaw`SELECT LAST_INSERT_ID() AS id`;
      respuesta = { ok: true, RemisionId: Number(fila[0].id), Folio: folio };
    }, { timeout: 30_000 });

    res.status(201).json(respuesta);
  } catch (err: any) {
    if (err instanceof ErrorNegocio) { res.status(err.status).json({ error: err.message }); return; }
    if (err.message?.includes("foreign key")) { res.status(400).json({ error: mensajeLlaveForanea(err.message) }); return; }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/remisiones/:id — edita la cabecera. Solo en Borrador: una vez confirmada, el documento ya
// se imprimió y se entregó, y cambiarle el destino reescribiría un movimiento de inventario ya hecho.
// El Tipo tampoco se puede cambiar ni en Borrador — el folio ya salió de esa serie.
router.put("/:id", requireAuth, requirePerm("remisiones", "editar"), async (req: Request, res: Response) => {
  try {
    const remisionId = Number(req.params.id);
    const rows: any[] = await prisma.$queryRaw`
      SELECT r.Tipo, r.Estatus, se.Nombre, se.Destino, se.TipoCliente, se.PidePedido, se.PideEmbarque
      FROM Remisiones r JOIN SerieRemision se ON r.Tipo = se.Tipo
      WHERE r.RemisionId = ${remisionId} LIMIT 1
    `;
    if (!rows.length) { res.status(404).json({ error: "Remisión no encontrada" }); return; }
    if (rows[0].Estatus !== "Borrador") {
      res.status(400).json({ error: `Esta remisión está ${String(rows[0].Estatus).toLowerCase()} — solo se puede editar mientras es borrador` });
      return;
    }
    const fecha = String(req.body.Fecha ?? "").trim();
    if (!esFechaValida(fecha)) { res.status(400).json({ error: "La fecha es requerida (formato YYYY-MM-DD)" }); return; }
    const destino = await resolverDestino(prisma, rows[0], req.body);
    await validarTipoCliente(prisma, rows[0], destino.CodigoCliente);
    const embarque = resolverEmbarque(rows[0], req.body);
    // Solo tiene sentido marcar mixta donde hay una proforma de cabecera contra la cual mezclar.
    const esMixta = Number(rows[0].PidePedido) === 1 && !!req.body.EsMixta;

    // Apagar la casilla con líneas de otras proformas ya adentro dejaría el documento en un estado
    // que confirmar rechazaría después. Se avisa acá, que es donde el usuario puede entenderlo.
    if (!esMixta && destino.CodigoPedido) {
      const ajenos: any[] = await prisma.$queryRaw`
        SELECT DISTINCT dp.CodigoPedido
        FROM RemisionDetalle rd
        JOIN Masters m ON rd.MasterId = m.MasterId
        JOIN EtiquetaImpresa ei ON m.EtiquetaId = ei.EtiquetaId
        JOIN OrdenEtiquetado oe ON ei.OrdenId = oe.OrdenId
        JOIN DetallePedido dp ON oe.DetalleId = dp.DetalleId
        WHERE rd.RemisionId = ${remisionId} AND rd.Vigente = 1 AND dp.CodigoPedido <> ${destino.CodigoPedido}
      `;
      if (ajenos.length) {
        res.status(400).json({
          error: `Esta remisión ya tiene producto de ${ajenos.map(a => a.CodigoPedido).join(", ")}. ` +
                 `Quita esas líneas antes de dejar de marcarla como mixta, o cambia la proforma de la cabecera.`,
        });
        return;
      }
    }

    await prisma.$executeRaw`
      UPDATE Remisiones SET
        Fecha = ${fecha},
        CodigoCliente = ${destino.CodigoCliente},
        CodigoSubcliente = ${destino.CodigoSubcliente},
        AreaDestino = ${destino.AreaDestino},
        CodigoPedido = ${destino.CodigoPedido},
        EsMixta = ${esMixta ? 1 : 0},
        Contenedor = ${embarque.Contenedor},
        Sello = ${embarque.Sello},
        Observaciones = ${String(req.body.Observaciones ?? "").trim() || null}
      WHERE RemisionId = ${remisionId}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    if (err instanceof ErrorNegocio) { res.status(err.status).json({ error: err.message }); return; }
    if (err.message?.includes("foreign key")) { res.status(400).json({ error: mensajeLlaveForanea(err.message) }); return; }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/remisiones/:id — solo en Borrador. Un borrador nunca tocó inventario, así que se borra
// de verdad (líneas incluidas); el folio consumido de la serie NO se recicla, igual que un talonario.
// Una remisión Confirmada no se elimina: se anula (deja rastro en el kardex).
router.delete("/:id", requireAuth, requirePerm("remisiones", "eliminar"), async (req: Request, res: Response) => {
  try {
    const remisionId = Number(req.params.id);
    const rows: any[] = await prisma.$queryRaw`SELECT Estatus, Folio FROM Remisiones WHERE RemisionId = ${remisionId} LIMIT 1`;
    if (!rows.length) { res.status(404).json({ error: "Remisión no encontrada" }); return; }
    if (rows[0].Estatus !== "Borrador") {
      res.status(400).json({ error: `La remisión ${rows[0].Folio} está ${String(rows[0].Estatus).toLowerCase()} — no se puede eliminar. Si fue un error, anúlala.` });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`DELETE FROM RemisionDetalle WHERE RemisionId = ${remisionId}`;
      await tx.$executeRaw`DELETE FROM Remisiones WHERE RemisionId = ${remisionId}`;
    }, { timeout: 30_000 });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Líneas
// ─────────────────────────────────────────────────────────────────────────────────────────────────

// Toda alta/baja de líneas exige Borrador. Se resuelve aquí para no repetir el mismo chequeo (y el
// mismo mensaje) en los cuatro endpoints de abajo. Devuelve además el contexto de la proforma
// (CodigoPedido + EsMixta) que necesitan los dos endpoints de alta.
async function exigirBorrador(tx: any, remisionId: number) {
  const rows: any[] = await tx.$queryRaw`
    SELECT r.RemisionId, r.Folio, r.Estatus, r.CodigoPedido, r.EsMixta, se.PideLinea
    FROM Remisiones r JOIN SerieRemision se ON r.Tipo = se.Tipo
    WHERE r.RemisionId = ${remisionId} LIMIT 1 FOR UPDATE
  `;
  if (!rows.length) throw new ErrorNegocio(404, "Remisión no encontrada");
  if (rows[0].Estatus !== "Borrador") {
    throw new ErrorNegocio(400, `La remisión ${rows[0].Folio} está ${String(rows[0].Estatus).toLowerCase()} — ya no se le pueden cambiar las líneas`);
  }
  return rows[0];
}

// Número de línea dentro del contenedor donde se estiba lo que se está escaneando. Solo lo exigen
// las series con PideLinea = 1 (Exportación); en las demás se ignora aunque venga, para no dejar
// datos de estiba colgados en documentos que no cargan contenedor.
function resolverLinea(remision: { Folio: string; PideLinea: number }, valor: any): number | null {
  if (Number(remision.PideLinea) !== 1) return null;
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ErrorNegocio(400, "Indica el número de línea dentro del contenedor antes de escanear");
  }
  return n;
}

// El amarre con la proforma: salvo que la remisión sea mixta, todo lo que entre tiene que ser del
// mismo pedido de la cabecera. Recibe los pedidos DISTINTOS que trae lo que se está agregando
// (un master trae uno; un polín puede traer varios) y rechaza los que no correspondan.
// Si la remisión no tiene pedido de cabecera (venta local, maquila) no hay contra qué comparar.
// Ventana para anular sin ser administrador. Anular devuelve producto ya despachado al inventario, y
// pasada una semana de trabajo el papel ya circuló (el cliente lo recibió, contabilidad lo tomó): a
// esa altura la corrección deja de ser "me equivoqué al capturar" y pasa a ser una decisión que
// alguien tiene que autorizar. Se cuenta desde ConfirmadaEn —cuándo se movió el inventario de
// verdad— y no desde Fecha, que es la del documento y el usuario la escribe a mano.
const DIAS_PARA_ANULAR = 4;

export function diasDesdeConfirmada(confirmadaEn: Date | string | null): number | null {
  if (!confirmadaEn) return null;
  const ms = Date.now() - new Date(confirmadaEn).getTime();
  return Math.floor(ms / 86_400_000);
}

export function anulacionVencida(confirmadaEn: Date | string | null): boolean {
  const dias = diasDesdeConfirmada(confirmadaEn);
  return dias != null && dias > DIAS_PARA_ANULAR;
}

function validarProforma(remision: { Folio: string; CodigoPedido: string | null; EsMixta: number }, pedidos: string[]) {
  if (!remision.CodigoPedido || Number(remision.EsMixta) === 1) return;
  const ajenos = [...new Set(pedidos.filter(p => p !== remision.CodigoPedido))];
  if (!ajenos.length) return;
  throw new ErrorNegocio(400,
    `La remisión ${remision.Folio} va contra la proforma ${remision.CodigoPedido} y esto es del pedido ${ajenos.join(", ")}. ` +
    `Si necesitas mezclar sobrantes de varias proformas, marca la remisión como mixta al editarla.`);
}

// POST /api/remisiones/:id/agregar-pallet  { Codigo | PalletId }
// Atajo para el caso normal: se embarca el polín entero. Agrega una línea por cada master del pallet
// en un solo golpe — a 40+ masters, hacerlo uno por uno con el lector no es viable.
// Acepta el `Codigo` tal como sale del QR de la hoja del polín (ej. "T0012"), que es la vía normal:
// escanear lo que uno tiene físicamente enfrente evita el error de elegir el polín equivocado de una
// lista. `PalletId` se sigue aceptando para llamadas internas.
router.post("/:id/agregar-pallet", requireAuth, requirePerm("remisiones", "editar"), async (req: Request, res: Response) => {
  try {
    const remisionId = Number(req.params.id);
    const codigo = String(req.body.Codigo ?? "").trim().toUpperCase();
    const palletIdBody = req.body.PalletId != null ? Number(req.body.PalletId) : null;
    if (!codigo && (!Number.isInteger(palletIdBody) || (palletIdBody ?? 0) <= 0)) {
      res.status(400).json({ error: "Se requiere el código escaneado del polín" });
      return;
    }

    const operador = getOperador(req);
    let respuesta: any = null;
    await prisma.$transaction(async (tx) => {
      const remision = await exigirBorrador(tx, remisionId);
      const linea = resolverLinea(remision, req.body.Linea);

      const palletRows: any[] = codigo
        ? await tx.$queryRaw`SELECT PalletId, Codigo, Estatus FROM Pallets WHERE Codigo = ${codigo} LIMIT 1 FOR UPDATE`
        : await tx.$queryRaw`SELECT PalletId, Codigo, Estatus FROM Pallets WHERE PalletId = ${palletIdBody} LIMIT 1 FOR UPDATE`;
      if (!palletRows.length) throw new ErrorNegocio(404, codigo ? `QR no reconocido — no existe el polín ${codigo}` : "Polín no encontrado");
      const pallet = palletRows[0];
      const palletId = Number(pallet.PalletId);
      if (pallet.Estatus === "Abierto") throw new ErrorNegocio(400, `El polín ${pallet.Codigo} sigue abierto — ciérralo antes de despacharlo`);
      if (pallet.Estatus !== "Cerrado") throw new ErrorNegocio(400, `El polín ${pallet.Codigo} está ${String(pallet.Estatus).toLowerCase()} — no se puede despachar`);

      // Se toman los masters DISPONIBLES, no "todos o ninguno": desde que se permite el picking caja
      // por caja, un polín puede tener parte de su contenido ya comprometido en otro documento y el
      // resto libre. Lo que queda físicamente en el polín es justo lo disponible.
      const masters: any[] = await tx.$queryRaw`
        SELECT m.MasterId FROM Masters m
        WHERE m.PalletId = ${palletId}
          AND m.Estatus <> 'Salido'
          AND NOT EXISTS (SELECT 1 FROM RemisionDetalle rd WHERE rd.MasterId = m.MasterId AND rd.Vigente = 1)
        FOR UPDATE
      `;
      if (!masters.length) {
        const total: any[] = await tx.$queryRaw`SELECT COUNT(*) AS n FROM Masters WHERE PalletId = ${palletId}`;
        throw new ErrorNegocio(400, Number(total[0].n) === 0
          ? `El polín ${pallet.Codigo} no tiene masters escaneados`
          : `El polín ${pallet.Codigo} ya no tiene masters disponibles — todos salieron o ya están en otra remisión`);
      }

      // Solo los pedidos de lo que REALMENTE va a entrar: si el polín mezcla proformas pero la parte
      // ajena ya se fue en otro documento, no tiene sentido bloquear por ella.
      const pedidosDelPallet: any[] = await tx.$queryRawUnsafe(`
        SELECT DISTINCT dp.CodigoPedido
        FROM Masters m
        JOIN EtiquetaImpresa ei ON m.EtiquetaId = ei.EtiquetaId
        JOIN OrdenEtiquetado oe ON ei.OrdenId = oe.OrdenId
        JOIN DetallePedido dp ON oe.DetalleId = dp.DetalleId
        WHERE m.MasterId IN (${masters.map(() => "?").join(",")})
      `, ...masters.map(m => Number(m.MasterId)));
      validarProforma(remision, pedidosDelPallet.map(r => r.CodigoPedido));

      // Un solo INSERT con todas las filas, no uno por master: un polín normal trae 50+ y contra una
      // base remota eso son 50 viajes de ida y vuelta — segundos de espera con el operador parado
      // frente al lector. Agrupado es un viaje.
      const valores = masters.map(() => "(?, ?, ?, ?)").join(", ");
      const params = masters.flatMap(m => [remisionId, Number(m.MasterId), linea, operador]);
      await tx.$executeRawUnsafe(
        `INSERT INTO RemisionDetalle (RemisionId, MasterId, LineaContenedor, AgregadoPor) VALUES ${valores}`,
        ...params
      );
      respuesta = { ok: true, PalletCodigo: pallet.Codigo, Agregados: masters.length, Linea: linea };
    }, { timeout: 30_000 });

    res.status(201).json(respuesta);
  } catch (err: any) {
    if (err instanceof ErrorNegocio) { res.status(err.status).json({ error: err.message }); return; }
    if (err.message?.includes("Duplicate")) { res.status(400).json({ error: "Alguno de estos masters ya está en otra remisión" }); return; }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/remisiones/:id/agregar-master  { Correlativo }
// Picking caja por caja. Se toma el master ESTÉ O NO armado en su polín: sacar 10 cajas de un polín
// de 50 no lo destruye — las otras 40 siguen en su posición, y obligar a "desarmar" para eso hacía
// declarar en el sistema una destrucción que no ocurre en la bodega (revisado con el usuario 6 ago
// 2026, revierte la regla original de "desarmar antes").
// El candado de sellado NO se toca: sigue bloqueando reimprimir, anular y quitar un master "por
// error" (eso exige polín Abierto). Sellado impide EDITAR, no impide DESPACHAR — son cosas distintas.
router.post("/:id/agregar-master", requireAuth, requirePerm("remisiones", "editar"), async (req: Request, res: Response) => {
  try {
    const remisionId = Number(req.params.id);
    const etiquetaId = parseCorrelativo(req.body.Correlativo);
    if (!etiquetaId) { res.status(400).json({ error: "Correlativo inválido" }); return; }

    const operador = getOperador(req);
    let masterId = 0;
    let lineaAsignada: number | null = null;
    await prisma.$transaction(async (tx) => {
      const remision = await exigirBorrador(tx, remisionId);
      const linea = resolverLinea(remision, req.body.Linea);

      const rows: any[] = await tx.$queryRaw`
        SELECT m.MasterId, m.Estatus, p.Codigo AS PalletCodigo, dp.CodigoPedido
        FROM Masters m
        JOIN Pallets p ON m.PalletId = p.PalletId
        JOIN EtiquetaImpresa ei ON m.EtiquetaId = ei.EtiquetaId
        JOIN OrdenEtiquetado oe ON ei.OrdenId = oe.OrdenId
        JOIN DetallePedido dp ON oe.DetalleId = dp.DetalleId
        WHERE m.EtiquetaId = ${etiquetaId} LIMIT 1 FOR UPDATE
      `;
      if (!rows.length) throw new ErrorNegocio(404, `El correlativo E${etiquetaId} no está escaneado en bodega`);
      const master = rows[0];
      validarProforma(remision, [master.CodigoPedido]);
      if (master.Estatus === "Salido") throw new ErrorNegocio(400, "Este master ya salió de bodega en otra remisión");

      const tomado: any[] = await tx.$queryRaw`
        SELECT r.Folio FROM RemisionDetalle rd
        JOIN Remisiones r ON rd.RemisionId = r.RemisionId
        WHERE rd.MasterId = ${Number(master.MasterId)} AND rd.Vigente = 1 LIMIT 1
      `;
      if (tomado.length) throw new ErrorNegocio(400, `Este master ya está en la remisión ${tomado[0].Folio}`);

      masterId = Number(master.MasterId);
      lineaAsignada = linea;
      await tx.$executeRaw`
        INSERT INTO RemisionDetalle (RemisionId, MasterId, LineaContenedor, AgregadoPor)
        VALUES (${remisionId}, ${masterId}, ${linea}, ${operador})
      `;
    }, { timeout: 30_000 });

    const filas: any[] = await prisma.$queryRawUnsafe(`${MASTER_SELECT} WHERE m.MasterId = ? LIMIT 1`, masterId);
    res.status(201).json({ ok: true, Master: formatearMaster(filas[0]), Linea: lineaAsignada });
  } catch (err: any) {
    if (err instanceof ErrorNegocio) { res.status(err.status).json({ error: err.message }); return; }
    if (err.message?.includes("Duplicate")) { res.status(400).json({ error: "Este master ya está en otra remisión" }); return; }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/remisiones/:id/detalle/:detalleId — quita una línea suelta del borrador.
router.delete("/:id/detalle/:detalleId", requireAuth, requirePerm("remisiones", "editar"), async (req: Request, res: Response) => {
  try {
    const remisionId = Number(req.params.id);
    const detalleId = Number(req.params.detalleId);
    let quitadas = 0;
    await prisma.$transaction(async (tx) => {
      await exigirBorrador(tx, remisionId);
      quitadas = Number(await tx.$executeRaw`
        DELETE FROM RemisionDetalle WHERE DetalleId = ${detalleId} AND RemisionId = ${remisionId}
      `);
    }, { timeout: 30_000 });
    if (!quitadas) { res.status(404).json({ error: "Línea no encontrada en esta remisión" }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    if (err instanceof ErrorNegocio) { res.status(err.status).json({ error: err.message }); return; }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/remisiones/:id/quitar-pallet  { PalletId } — contraparte de agregar-pallet: sacar a mano
// las 40 líneas de un polín agregado por error sería absurdo.
router.post("/:id/quitar-pallet", requireAuth, requirePerm("remisiones", "editar"), async (req: Request, res: Response) => {
  try {
    const remisionId = Number(req.params.id);
    const palletId = Number(req.body.PalletId);
    if (!Number.isInteger(palletId) || palletId <= 0) { res.status(400).json({ error: "PalletId inválido" }); return; }

    let quitadas = 0;
    await prisma.$transaction(async (tx) => {
      await exigirBorrador(tx, remisionId);
      quitadas = Number(await tx.$executeRaw`
        DELETE rd FROM RemisionDetalle rd
        JOIN Masters m ON rd.MasterId = m.MasterId
        WHERE rd.RemisionId = ${remisionId} AND m.PalletId = ${palletId}
      `);
    }, { timeout: 30_000 });
    if (!quitadas) { res.status(404).json({ error: "Ese polín no tiene líneas en esta remisión" }); return; }
    res.json({ ok: true, Quitadas: quitadas });
  } catch (err: any) {
    if (err instanceof ErrorNegocio) { res.status(err.status).json({ error: err.message }); return; }
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Confirmar / anular — los únicos dos puntos donde se mueve inventario
// ─────────────────────────────────────────────────────────────────────────────────────────────────

// POST /api/remisiones/:id/confirmar
// Todo en una transacción: baja los masters, libera la posición de los polines que quedan vacíos y
// escribe el kardex. Un polín queda "Despachado" solo si TODOS sus masters se van en esta remisión;
// si salió parcial, el polín conserva su posición y las cajas que no se llevaron.
router.post("/:id/confirmar", requireAuth, requirePerm("remisiones", "editar"), async (req: Request, res: Response) => {
  try {
    const remisionId = Number(req.params.id);
    const operador = getOperador(req);
    let respuesta: any = null;

    await prisma.$transaction(async (tx) => {
      const remision = await exigirBorrador(tx, remisionId);

      const lineas: any[] = await tx.$queryRaw`
        SELECT rd.MasterId, m.PalletId, m.Estatus, p.PosicionId
        FROM RemisionDetalle rd
        JOIN Masters m ON rd.MasterId = m.MasterId
        JOIN Pallets p ON m.PalletId = p.PalletId
        WHERE rd.RemisionId = ${remisionId} AND rd.Vigente = 1
        FOR UPDATE
      `;
      if (!lineas.length) throw new ErrorNegocio(400, "Esta remisión no tiene líneas — agrega al menos un master antes de confirmarla");

      // Relectura del Estatus con las filas ya bloqueadas: entre que se armó el borrador y este
      // momento, otro usuario pudo haber despachado alguno de estos masters en otra remisión.
      const yaSalidos = lineas.filter(l => l.Estatus === "Salido");
      if (yaSalidos.length) {
        throw new ErrorNegocio(400, `${yaSalidos.length} master(s) de esta remisión ya salieron de bodega en otro documento — quítalos y vuelve a confirmar`);
      }

      // Último respaldo del amarre con la proforma: las líneas se validan al agregarse, pero entre
      // medio se pudo haber apagado la casilla de mixta. Revalidar aquí evita confirmar un documento
      // que dice ir contra una proforma y lleva producto de otra.
      const pedidosDeLineas: any[] = await tx.$queryRaw`
        SELECT DISTINCT dp.CodigoPedido
        FROM RemisionDetalle rd
        JOIN Masters m ON rd.MasterId = m.MasterId
        JOIN EtiquetaImpresa ei ON m.EtiquetaId = ei.EtiquetaId
        JOIN OrdenEtiquetado oe ON ei.OrdenId = oe.OrdenId
        JOIN DetallePedido dp ON oe.DetalleId = dp.DetalleId
        WHERE rd.RemisionId = ${remisionId} AND rd.Vigente = 1
      `;
      validarProforma(remision, pedidosDeLineas.map(r => r.CodigoPedido));

      // Agrupado en dos consultas en vez de 2×N: una remisión de 3 polines son 150 masters, y uno
      // por uno contra una base remota son 300 viajes de ida y vuelta dentro de la transacción
      // (con los candados tomados todo ese rato).
      const masterIds = lineas.map(l => Number(l.MasterId));
      await tx.$executeRawUnsafe(
        `UPDATE Masters SET Estatus = 'Salido' WHERE MasterId IN (${masterIds.map(() => "?").join(",")})`,
        ...masterIds
      );
      const motivoSalida = `Remisión ${remision.Folio}`;
      await tx.$executeRawUnsafe(
        `INSERT INTO MovimientosBodega (PalletId, MasterId, RemisionId, Tipo, PosicionOrigenId, PosicionDestinoId, Usuario, Motivo)
         VALUES ${lineas.map(() => "(?, ?, ?, 'SALIDA', ?, NULL, ?, ?)").join(", ")}`,
        ...lineas.flatMap(l => [
          Number(l.PalletId), Number(l.MasterId), remisionId,
          l.PosicionId == null ? null : Number(l.PosicionId), operador, motivoSalida,
        ])
      );

      // Polines que quedaron sin un solo master en bodega → se despachan enteros y sueltan su
      // posición física. El UPDATE es condicional en la propia consulta (NOT EXISTS) para no
      // depender de haber contado bien en JS lo que la BD acaba de cambiar.
      const palletIds = [...new Set(lineas.map(l => Number(l.PalletId)))];
      let despachados = 0;
      for (const palletId of palletIds) {
        const afectadas = Number(await tx.$executeRaw`
          UPDATE Pallets SET Estatus = 'Despachado', PosicionId = NULL
          WHERE PalletId = ${palletId}
            AND Estatus = 'Cerrado'
            AND NOT EXISTS (SELECT 1 FROM Masters m WHERE m.PalletId = ${palletId} AND m.Estatus <> 'Salido')
        `);
        despachados += afectadas;
      }

      await tx.$executeRaw`
        UPDATE Remisiones SET Estatus = 'Confirmada', ConfirmadaPor = ${operador}, ConfirmadaEn = NOW()
        WHERE RemisionId = ${remisionId}
      `;
      respuesta = { ok: true, Folio: remision.Folio, Masters: lineas.length, PolinesDespachados: despachados };
    }, { timeout: 60_000 });

    res.json(respuesta);
  } catch (err: any) {
    if (err instanceof ErrorNegocio) { res.status(err.status).json({ error: err.message }); return; }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/remisiones/:id/anular  { Motivo }
// Reversa de confirmar. NO borra nada: las líneas quedan con Vigente = NULL (fuera del UNIQUE, pero
// visibles para auditoría) y el kardex gana un movimiento de reversa por master.
// La posición física NO se restaura aunque el polín se despachara entero: otro polín pudo haberla
// ocupado mientras tanto. El polín reaparece como "Cerrado sin posición", listo para reubicarse —
// mismo criterio que ya usa la des-ubicación administrativa de bodega física.
router.post("/:id/anular", requireAuth, requirePerm("remisiones", "anular"), async (req: AuthRequest, res: Response) => {
  try {
    const remisionId = Number(req.params.id);
    const motivo = String(req.body.Motivo ?? "").trim();
    if (!motivo) { res.status(400).json({ error: "El motivo de la anulación es requerido" }); return; }
    // Opcional: polín al que vuelve la carga cuando NO regresó a la tarima de la que salió.
    const palletDestinoId = req.body.PalletDestinoId != null && req.body.PalletDestinoId !== ""
      ? Number(req.body.PalletDestinoId) : null;
    if (palletDestinoId != null && (!Number.isInteger(palletDestinoId) || palletDestinoId <= 0)) {
      res.status(400).json({ error: "Polín de retorno inválido" });
      return;
    }

    const operador = getOperador(req);
    let respuesta: any = null;
    await prisma.$transaction(async (tx) => {
      const rows: any[] = await tx.$queryRaw`SELECT RemisionId, Folio, Estatus, ConfirmadaEn FROM Remisiones WHERE RemisionId = ${remisionId} LIMIT 1 FOR UPDATE`;
      if (!rows.length) throw new ErrorNegocio(404, "Remisión no encontrada");
      if (rows[0].Estatus === "Borrador") throw new ErrorNegocio(400, "Esta remisión todavía es un borrador — elimínala en vez de anularla");
      if (rows[0].Estatus !== "Confirmada") throw new ErrorNegocio(400, "Esta remisión ya está anulada");

      // Pasados los días de gracia solo el administrador puede anular. Se valida acá dentro, con la
      // fila ya bloqueada, y no en un middleware: el permiso 'remisiones:anular' sigue siendo el que
      // habilita la acción, esto es un límite de TIEMPO encima de ese permiso.
      if (anulacionVencida(rows[0].ConfirmadaEn) && req.user?.rol !== "admin") {
        const dias = diasDesdeConfirmada(rows[0].ConfirmadaEn);
        throw new ErrorNegocio(403,
          `La remisión ${rows[0].Folio} se confirmó hace ${dias} días y el plazo para anularla es de ${DIAS_PARA_ANULAR}. ` +
          `Pasado ese plazo solo un administrador puede anularla.`);
      }

      const lineas: any[] = await tx.$queryRaw`
        SELECT rd.MasterId, m.PalletId, p.Estatus AS PalletEstatus
        FROM RemisionDetalle rd
        JOIN Masters m ON rd.MasterId = m.MasterId
        JOIN Pallets p ON m.PalletId = p.PalletId
        WHERE rd.RemisionId = ${remisionId} AND rd.Vigente = 1
        FOR UPDATE
      `;

      // El polín vuelve primero a 'Cerrado' si se había despachado entero; recién ahí sus masters
      // vuelven a ser carga normal suya.
      const palletIds = [...new Set(lineas.map(l => Number(l.PalletId)))];
      for (const palletId of palletIds) {
        await tx.$executeRaw`UPDATE Pallets SET Estatus = 'Cerrado' WHERE PalletId = ${palletId} AND Estatus = 'Despachado'`;
      }

      // Anular tiene DOS naturalezas y hasta ago 2026 solo se contemplaba una. Si fue un error
      // administrativo, la carga nunca se movió y vuelve a su polín de origen (destino = null, el
      // comportamiento de siempre). Pero cuando el producto sí salió y volvió, las cajas rara vez
      // regresan a la misma tarima: quedan sueltas y hay que montarlas en otro polín. Para ese caso
      // se pasa un polín de retorno y el traslado ocurre acá, en la misma transacción — así el
      // inventario nunca llega a afirmar que las cajas están en un rack donde no están, y el polín
      // de origen no hay que des-ubicarlo ni reabrirlo para mover tres cajas.
      let destino: any = null;
      if (palletDestinoId != null) {
        const dest: any[] = await tx.$queryRaw`
          SELECT PalletId, Codigo, Estatus, CantidadMaster FROM Pallets WHERE PalletId = ${palletDestinoId} LIMIT 1 FOR UPDATE
        `;
        if (!dest.length) throw new ErrorNegocio(404, "El polín de retorno no existe");
        if (dest[0].Estatus !== "Abierto") {
          throw new ErrorNegocio(400,
            `El polín ${dest[0].Codigo} está ${String(dest[0].Estatus).toLowerCase()} — solo un polín abierto puede recibir producto devuelto.`);
        }
        // Mismo tope que frena el escaneo normal: si se declaró capacidad, se respeta. El FOR UPDATE
        // de arriba serializa contra un escaneo simultáneo al mismo polín.
        const capacidad = dest[0].CantidadMaster == null ? null : Number(dest[0].CantidadMaster);
        if (capacidad != null) {
          const carga: any[] = await tx.$queryRaw`
            SELECT COUNT(*) AS n FROM Masters WHERE PalletId = ${palletDestinoId} AND Estatus <> 'Salido'
          `;
          const libre = capacidad - Number(carga[0].n);
          if (lineas.length > libre) {
            throw new ErrorNegocio(400,
              `En el polín ${dest[0].Codigo} caben ${libre} master(s) más y esta remisión devuelve ${lineas.length}. Elige otro polín o crea uno nuevo.`);
          }
        }
        destino = dest[0];
      }

      // Todos vuelven a 'EnBodega': el master siempre pertenece a un polín — el suyo de origen, o el
      // de retorno si se eligió uno. (Antes había un caso 'Suelto' para polines desarmados; esa
      // operación se eliminó el 8 ago 2026.)
      const masterIdsAnular = lineas.map(l => Number(l.MasterId));
      if (masterIdsAnular.length) {
        const marcadores = masterIdsAnular.map(() => "?").join(",");
        await tx.$executeRawUnsafe(
          destino
            ? `UPDATE Masters SET Estatus = 'EnBodega', PalletId = ? WHERE MasterId IN (${marcadores})`
            : `UPDATE Masters SET Estatus = 'EnBodega' WHERE MasterId IN (${marcadores})`,
          ...(destino ? [Number(destino.PalletId), ...masterIdsAnular] : masterIdsAnular)
        );
      }
      if (lineas.length) {
        // La reversa se anota SIEMPRE contra el polín del que salió: es el que registró la SALIDA y
        // es lo que hace que el kardex cuadre por polín.
        await tx.$executeRawUnsafe(
          `INSERT INTO MovimientosBodega (PalletId, MasterId, RemisionId, Tipo, PosicionOrigenId, PosicionDestinoId, Usuario, Motivo)
           VALUES ${lineas.map(() => "(?, ?, ?, 'REVERSA_SALIDA', NULL, NULL, ?, ?)").join(", ")}`,
          ...lineas.flatMap(l => [Number(l.PalletId), Number(l.MasterId), remisionId, operador, motivo])
        );
        // El cambio de tarima va como TRASLADO aparte, igual que una consolidación normal: dos
        // hechos distintos (volvió del despacho / cambió de polín) son dos renglones distintos.
        if (destino) {
          await tx.$executeRawUnsafe(
            `INSERT INTO MovimientosBodega (PalletId, PalletOrigenId, MasterId, RemisionId, Tipo, PosicionOrigenId, PosicionDestinoId, Usuario, Motivo)
             VALUES ${lineas.map(() => "(?, ?, ?, ?, 'TRASLADO', NULL, NULL, ?, ?)").join(", ")}`,
            ...lineas.flatMap(l => [
              Number(destino.PalletId), Number(l.PalletId), Number(l.MasterId), remisionId, operador,
              `Retorno de la remisión ${rows[0].Folio} — no volvió a su polín`,
            ])
          );
        }
      }

      // Vigente = NULL (no 0): así el master queda libre para una remisión nueva sin que su línea
      // vieja desaparezca ni choque contra el UNIQUE si se vuelve a anular otra vez más adelante.
      await tx.$executeRaw`UPDATE RemisionDetalle SET Vigente = NULL WHERE RemisionId = ${remisionId}`;
      await tx.$executeRaw`
        UPDATE Remisiones SET Estatus = 'Anulada', AnuladaPor = ${operador}, AnuladaEn = NOW(), MotivoAnulacion = ${motivo}
        WHERE RemisionId = ${remisionId}
      `;
      respuesta = {
        ok: true, Folio: rows[0].Folio, MastersDevueltos: lineas.length,
        PalletDestino: destino ? destino.Codigo : null,
      };
    }, { timeout: 60_000 });

    res.json(respuesta);
  } catch (err: any) {
    if (err instanceof ErrorNegocio) { res.status(err.status).json({ error: err.message }); return; }
    res.status(500).json({ error: err.message });
  }
});

export default router;
