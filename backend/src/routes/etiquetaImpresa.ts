import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";
import { construirZPL, TAMANOS_ETIQUETA, TAMANO_DEFECTO, type Posiciones, type TamanoId } from "../lib/zpl.ts";
import { obtenerPosiciones } from "./disenoEtiqueta.ts";

const router = Router();

function tamanoValido(tamano: any): tamano is TamanoId {
  return typeof tamano === "string" && tamano in TAMANOS_ETIQUETA;
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

// Datos de la orden + línea de pedido necesarios para armar el ZPL de una etiqueta.
// El Proceso (no la Clase completa) es lo que se imprime — mismo criterio ya usado en la lista
// de Líneas de EtiquetadoPage ("quitar la familia, dejar solo proceso y talla").
async function obtenerDatosOrden(ordenId: number) {
  const rows: any[] = await prisma.$queryRaw`
    SELECT oe.OrdenId, oe.Lote, oe.CantidadMaster, oe.Estatus AS EstatusOrden, oe.Color, oe.FechaProduccion,
           dp.CodigoPedido, pc.Descripcion AS DescripcionProceso, ta.Descripcion AS DescripcionTalla,
           pr.Descripcion AS DescripcionPresentacion,
           cli.RazonSocial AS NombreCliente, sub.RazonSocial AS NombreSubcliente,
           org.Descripcion AS DescripcionOrigen, cong.Descripcion AS DescripcionCongelacion, ar.Nombre AS NombreArea
    FROM OrdenEtiquetado oe
    JOIN DetallePedido dp ON oe.DetalleId = dp.DetalleId
    JOIN Clase cl ON dp.Clase = cl.Clase
    JOIN Procesos pc ON cl.Proceso = pc.Proceso
    JOIN Tallas ta ON dp.Talla = ta.Codigo
    JOIN Presentacion pr ON dp.Presentacion = pr.Codigo
    JOIN Pedidos ped ON dp.CodigoPedido = ped.CodigoPedido
    JOIN Clientes cli ON ped.CodigoCliente = cli.Codigo
    LEFT JOIN Subcliente sub ON ped.CodigoCliente = sub.CodigoCliente AND ped.CodigoSubcliente = sub.CodigoSubcliente
    JOIN Origen org ON oe.Origen = org.Codigo
    JOIN UnidadesCongelacion cong ON oe.Congelacion = cong.Codigo
    LEFT JOIN Areas ar ON oe.AreaCodigo = ar.Codigo
    WHERE oe.OrdenId = ${ordenId} LIMIT 1
  `;
  return rows[0] ?? null;
}

function datosDesdeOrden(orden: any, correlativo: string) {
  return {
    correlativo,
    codigoPedido: orden.CodigoPedido,
    cliente: orden.NombreCliente,
    subcliente: orden.NombreSubcliente,
    proceso: orden.DescripcionProceso,
    talla: orden.DescripcionTalla,
    presentacion: orden.DescripcionPresentacion,
    lote: orden.Lote,
    color: orden.Color,
    origen: orden.DescripcionOrigen,
    congelacion: orden.DescripcionCongelacion,
    area: orden.NombreArea,
    fechaProduccion: orden.FechaProduccion ? new Date(orden.FechaProduccion).toISOString().slice(0, 10) : null,
  };
}

function armarZPL(orden: any, correlativo: string, posiciones: Posiciones, tamano: TamanoId) {
  return construirZPL(datosDesdeOrden(orden, correlativo), posiciones, tamano);
}

// GET /api/etiqueta-impresa?orden=123 — histórico de etiquetas impresas de una captura
router.get("/", requireAuth, requirePerm("etiquetado", "imprimir"), async (req: Request, res: Response) => {
  try {
    const ordenId = req.query.orden ? Number(req.query.orden) : undefined;
    if (!ordenId) { res.status(400).json({ error: "Parámetro 'orden' requerido" }); return; }
    const rows: any[] = await prisma.$queryRaw`
      SELECT ei.EtiquetaId, ei.OrdenId, ei.Tamano, ei.Estatus, ei.RegistradoPor, ei.CreadoEn,
             (SELECT COUNT(*) FROM ImpresionLog il WHERE il.EtiquetaId = ei.EtiquetaId) AS VecesImpresa
      FROM EtiquetaImpresa ei
      WHERE ei.OrdenId = ${ordenId}
      ORDER BY ei.EtiquetaId ASC
    `;
    res.json(rows.map(r => ({
      ...r, EtiquetaId: Number(r.EtiquetaId), OrdenId: Number(r.OrdenId), VecesImpresa: Number(r.VecesImpresa),
      Correlativo: "E" + r.EtiquetaId,
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/etiqueta-impresa/vista-previa/:ordenId?tamano=4x2
// Mismos datos que se van a imprimir, SIN crear una EtiquetaImpresa ni consumir cupo — para
// mostrar en el frontend antes de confirmar la impresión física. El tamaño lo elige el operador
// en pantalla según el rollo físico que tenga cargado en ese momento (no se detecta solo).
router.get("/vista-previa/:ordenId", requireAuth, requirePerm("etiquetado", "imprimir"), async (req: Request, res: Response) => {
  try {
    const ordenId = Number(req.params.ordenId);
    const tamano = tamanoValido(req.query.tamano) ? req.query.tamano : TAMANO_DEFECTO;
    const orden = await obtenerDatosOrden(ordenId);
    if (!orden) { res.status(404).json({ error: "Orden de etiquetado no encontrada" }); return; }
    const posiciones = await obtenerPosiciones(tamano);

    res.json({
      Tamano: tamano,
      AnchoPuntos: TAMANOS_ETIQUETA[tamano].AnchoPuntos,
      AltoPuntos: TAMANOS_ETIQUETA[tamano].AltoPuntos,
      Posiciones: posiciones,
      Datos: datosDesdeOrden(orden, "(pendiente)"),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/etiqueta-impresa  { OrdenId }
// Crea TODAS las etiquetas pendientes de esa captura (CantidadMaster - Impresas) de una vez —
// revisado jul 2026: ya no es una por una bajo demanda, se declara e imprime en bloque al confirmar.
// Cada una es su propia EtiquetaImpresa con su propio correlativo/QR; el ZPL de todas se concatena
// (varios bloques ^XA...^XZ) en un solo envío a Browser Print, que la impresora imprime en secuencia.
router.post("/", requireAuth, requirePerm("etiquetado", "imprimir"), async (req: Request, res: Response) => {
  try {
    const { OrdenId, Tamano } = req.body;
    if (!OrdenId) { res.status(400).json({ error: "OrdenId es requerido" }); return; }
    if (!tamanoValido(Tamano)) { res.status(400).json({ error: "Tamano de etiqueta inválido" }); return; }

    const orden = await obtenerDatosOrden(Number(OrdenId));
    if (!orden) { res.status(404).json({ error: "Orden de etiquetado no encontrada" }); return; }
    if (orden.EstatusOrden === "Cancelada") { res.status(400).json({ error: "Esta captura está cancelada, no se puede imprimir" }); return; }

    const impresasRows: any[] = await prisma.$queryRaw`
      SELECT COUNT(*) AS n FROM EtiquetaImpresa WHERE OrdenId = ${Number(OrdenId)} AND Estatus = 'Activa'
    `;
    const impresas = Number(impresasRows[0].n);
    const pendientes = Number(orden.CantidadMaster) - impresas;
    if (pendientes <= 0) {
      res.status(400).json({ error: `Ya se imprimieron las ${orden.CantidadMaster} etiquetas declaradas para esta captura` });
      return;
    }

    const operador = getOperador(req);
    const posiciones = await obtenerPosiciones(Tamano);
    const correlativos: string[] = [];

    // LAST_INSERT_ID() es por conexión — debe leerse en la misma transacción que el INSERT,
    // si no el pool de conexiones puede devolver el id de otra sesión concurrente.
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < pendientes; i++) {
        await tx.$executeRaw`INSERT INTO EtiquetaImpresa (OrdenId, Tamano, RegistradoPor) VALUES (${Number(OrdenId)}, ${Tamano}, ${operador})`;
        const fila: any[] = await tx.$queryRaw`SELECT LAST_INSERT_ID() AS id`;
        const id = Number(fila[0].id);
        await tx.$executeRaw`INSERT INTO ImpresionLog (EtiquetaId, Motivo, ImpresoPor) VALUES (${id}, ${"Impresión inicial"}, ${operador})`;
        correlativos.push("E" + id);
      }
    });

    const zpl = correlativos.map(correlativo => armarZPL(orden, correlativo, posiciones, Tamano)).join("\n");
    res.status(201).json({
      ok: true, Cantidad: pendientes, Correlativos: correlativos, Zpl: zpl,
      Impresas: impresas + pendientes, CantidadMaster: Number(orden.CantidadMaster),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/etiqueta-impresa/:id/reimprimir  { Motivo }
// Repite el mismo correlativo/QR — no crea una etiqueta nueva ni consume cupo, solo audita el reimpreso.
router.post("/:id/reimprimir", requireAuth, requirePerm("etiquetado", "imprimir"), async (req: Request, res: Response) => {
  try {
    const etiquetaId = Number(req.params.id);
    const { Motivo } = req.body;
    if (!Motivo || !String(Motivo).trim()) { res.status(400).json({ error: "El motivo de la reimpresión es requerido" }); return; }

    const etiquetaRows: any[] = await prisma.$queryRaw`
      SELECT EtiquetaId, OrdenId, Tamano, Estatus FROM EtiquetaImpresa WHERE EtiquetaId = ${etiquetaId} LIMIT 1
    `;
    if (!etiquetaRows.length) { res.status(404).json({ error: "Etiqueta no encontrada" }); return; }
    if (etiquetaRows[0].Estatus !== "Activa") { res.status(400).json({ error: "Esta etiqueta está anulada, no se puede reimprimir" }); return; }

    const orden = await obtenerDatosOrden(Number(etiquetaRows[0].OrdenId));
    if (!orden) { res.status(404).json({ error: "Orden de etiquetado no encontrada" }); return; }

    // El tamaño se toma de la propia etiqueta (el que se usó al imprimirla la primera vez), no de
    // lo que esté seleccionado en pantalla ahora mismo — una reimpresión debe respetar el rollo con
    // el que se generó originalmente esa etiqueta.
    const tamano: TamanoId = tamanoValido(etiquetaRows[0].Tamano) ? etiquetaRows[0].Tamano : TAMANO_DEFECTO;

    const operador = getOperador(req);
    await prisma.$executeRaw`
      INSERT INTO ImpresionLog (EtiquetaId, Motivo, ImpresoPor) VALUES (${etiquetaId}, ${String(Motivo).trim()}, ${operador})
    `;

    const correlativo = "E" + etiquetaId;
    const zpl = armarZPL(orden, correlativo, await obtenerPosiciones(tamano), tamano);
    res.json({ ok: true, EtiquetaId: etiquetaId, Correlativo: correlativo, Tamano: tamano, Zpl: zpl });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
