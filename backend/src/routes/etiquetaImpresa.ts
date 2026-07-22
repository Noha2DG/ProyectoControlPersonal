import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm, requireAnyPerm, tienePermiso } from "../middleware/auth.ts";
import { construirZPL, TAMANOS_ETIQUETA, TAMANO_DEFECTO, type Posiciones, type TamanoId } from "../lib/zpl.ts";
import { obtenerPosiciones } from "./disenoEtiqueta.ts";
import { buscarMasterPorEtiqueta, buscarMastersEnRango, calcularTechoLinea } from "../lib/masters.ts";

const router = Router();

function tamanoValido(tamano: any): tamano is TamanoId {
  return typeof tamano === "string" && tamano in TAMANOS_ETIQUETA;
}

// Error de negocio lanzado DENTRO de una transacción (donde no se puede responder directo al
// cliente) — el catch de la ruta lo traduce a su status HTTP en vez de un 500 genérico.
class ErrorNegocio extends Error {
  status: number;
  constructor(status: number, mensaje: string) {
    super(mensaje);
    this.status = status;
  }
}

// Acepta el correlativo tal como lo ve el operador ("E120") o el número pelado (120).
function parseCorrelativo(valor: any): number | null {
  const n = Number(String(valor ?? "").trim().replace(/^[eE]/, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
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
    SELECT oe.OrdenId, oe.DetalleId, oe.Lote, oe.CantidadMaster, oe.Estatus AS EstatusOrden, oe.Color, oe.FechaProduccion,
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
    const { OrdenId, Tamano, ConfirmarLineaCompleta } = req.body;
    if (!OrdenId) { res.status(400).json({ error: "OrdenId es requerido" }); return; }
    if (!tamanoValido(Tamano)) { res.status(400).json({ error: "Tamano de etiqueta inválido" }); return; }

    const orden = await obtenerDatosOrden(Number(OrdenId));
    if (!orden) { res.status(404).json({ error: "Orden de etiquetado no encontrada" }); return; }

    // Respaldo de servidor del aviso "línea ya completa" — antes solo vivía como confirm() en el
    // frontend, sin nada que lo respaldara si alguien llamaba la API directo. Mismo criterio
    // "advertir, no bloquear" de siempre: se detiene con 409 salvo que venga
    // ConfirmarLineaCompleta=true (el frontend ya lo manda así una vez que el usuario confirmó en
    // pantalla). No necesita candado de concurrencia — es informativo, no un cupo que proteger.
    if (!ConfirmarLineaCompleta) {
      const techo = await calcularTechoLinea(prisma, Number(orden.DetalleId));
      if (techo && techo.Escaneado >= techo.Objetivo) {
        res.status(409).json({
          error: `La línea de este pedido ya tiene ${techo.Escaneado}/${techo.Objetivo} masters escaneados en bodega — ya alcanzó su objetivo.`,
          LineaCompleta: true, Objetivo: techo.Objetivo, Escaneado: techo.Escaneado,
        });
        return;
      }
    }

    const operador = getOperador(req);
    const posiciones = await obtenerPosiciones(Tamano);
    const correlativos: string[] = [];
    let impresas = 0;
    let pendientes = 0;

    // Estatus + cupo + creación en la MISMA transacción, con la fila de la captura bloqueada
    // (FOR UPDATE): antes el conteo se hacía fuera y dos estaciones confirmando la misma captura
    // a la vez leían ambas el mismo "pendientes" y duplicaban la tanda completa. Con el candado,
    // la segunda espera el commit de la primera y ya ve el cupo consumido.
    // LAST_INSERT_ID() es por conexión — debe leerse en la misma transacción que el INSERT,
    // si no el pool de conexiones puede devolver el id de otra sesión concurrente.
    await prisma.$transaction(async (tx) => {
      const capturaRows: any[] = await tx.$queryRaw`
        SELECT CantidadMaster, Estatus FROM OrdenEtiquetado WHERE OrdenId = ${Number(OrdenId)} FOR UPDATE
      `;
      if (!capturaRows.length) throw new ErrorNegocio(404, "Orden de etiquetado no encontrada");
      if (capturaRows[0].Estatus === "Cancelada") throw new ErrorNegocio(400, "Esta captura está cancelada, no se puede imprimir");

      const impresasRows: any[] = await tx.$queryRaw`
        SELECT COUNT(*) AS n FROM EtiquetaImpresa WHERE OrdenId = ${Number(OrdenId)} AND Estatus = 'Activa'
      `;
      impresas = Number(impresasRows[0].n);
      const cantidadMaster = Number(capturaRows[0].CantidadMaster);
      pendientes = cantidadMaster - impresas;
      if (pendientes <= 0) throw new ErrorNegocio(400, `Ya se imprimieron las ${cantidadMaster} etiquetas declaradas para esta captura`);

      for (let i = 0; i < pendientes; i++) {
        await tx.$executeRaw`INSERT INTO EtiquetaImpresa (OrdenId, Tamano, RegistradoPor) VALUES (${Number(OrdenId)}, ${Tamano}, ${operador})`;
        const fila: any[] = await tx.$queryRaw`SELECT LAST_INSERT_ID() AS id`;
        const id = Number(fila[0].id);
        await tx.$executeRaw`INSERT INTO ImpresionLog (EtiquetaId, Motivo, ImpresoPor) VALUES (${id}, ${"Impresión inicial"}, ${operador})`;
        correlativos.push("E" + id);
      }
    }, { timeout: 60_000 });

    // Bloques individuales (no un solo string concatenado): el frontend los envía a la impresora
    // en tandas con progreso, y si el envío falla a medias sabe exactamente qué correlativos
    // faltaron para reintentar solo esos.
    const bloques = correlativos.map(correlativo => ({
      Correlativo: correlativo,
      Zpl: armarZPL(orden, correlativo, posiciones, Tamano),
    }));
    res.status(201).json({
      ok: true, Cantidad: pendientes, Correlativos: correlativos, Bloques: bloques,
      Impresas: impresas + pendientes, CantidadMaster: Number(orden.CantidadMaster),
    });
  } catch (err: any) {
    if (err instanceof ErrorNegocio) { res.status(err.status).json({ error: err.message }); return; }
    res.status(500).json({ error: err.message });
  }
});

// Un rango de recuperación (atasco a medio camino) puede mezclar correlativos ya confirmados en
// bodega con otros que no — a diferencia de la reimpresión individual, aquí NO se pide forzar: los
// ya escaneados simplemente se excluyen del lote y se reportan aparte, porque su master físico ya
// llegó a destino y no tiene sentido forzarlos desde una recuperación masiva. Compartida entre el
// chequeo liviano (GET /rango-estado, sin escribir nada) y el commit real (POST /reimprimir-bloque)
// — mismo criterio que buscarMasterPorEtiqueta/consultar para la reimpresión individual.
async function resolverRangoReimpresion(ordenId: number, desde: number, hasta: number) {
  // Solo etiquetas activas de ESTA captura dentro del rango — correlativos de otras capturas que
  // caigan en el rango numérico se ignoran, no se pueden reimprimir desde aquí.
  const etiquetas: any[] = await prisma.$queryRaw`
    SELECT EtiquetaId, Tamano FROM EtiquetaImpresa
    WHERE OrdenId = ${ordenId} AND EtiquetaId BETWEEN ${desde} AND ${hasta} AND Estatus = 'Activa'
    ORDER BY EtiquetaId ASC
  `;
  const yaEscaneados = await buscarMastersEnRango(prisma, desde, hasta);
  const paraReimprimir = etiquetas.filter(e => !yaEscaneados.has(Number(e.EtiquetaId)));
  const saltadas = etiquetas
    .filter(e => yaEscaneados.has(Number(e.EtiquetaId)))
    .map(e => {
      const info = yaEscaneados.get(Number(e.EtiquetaId))!;
      return { Correlativo: "E" + Number(e.EtiquetaId), ...info };
    });
  return { etiquetas, paraReimprimir, saltadas };
}

// GET /api/etiqueta-impresa/rango-estado?ordenId=6&desde=E47&hasta=E50
// Dry-run de reimprimir-bloque: qué se reimprimiría y qué se saltaría por ya escaneado, SIN escribir
// nada. Se usa ANTES de tocar la impresora física — mismo motivo que consultar individual: si
// TODO el rango ya está escaneado no hay nada que hacer, y no tiene sentido (ni es justo) que un
// problema de Browser Print tape esa información.
router.get("/rango-estado", requireAuth, requirePerm("etiquetado", "imprimir"), async (req: Request, res: Response) => {
  try {
    const ordenId = Number(req.query.ordenId);
    const desde = parseCorrelativo(req.query.desde);
    const hasta = parseCorrelativo(req.query.hasta);
    if (!ordenId) { res.status(400).json({ error: "ordenId es requerido" }); return; }
    if (!desde || !hasta || desde > hasta) { res.status(400).json({ error: "Rango de correlativos inválido" }); return; }
    if (hasta - desde + 1 > 1000) { res.status(400).json({ error: "Rango demasiado grande (máximo 1000 etiquetas por bloque)" }); return; }

    const { paraReimprimir, saltadas } = await resolverRangoReimpresion(ordenId, desde, hasta);
    res.json({ ParaReimprimir: paraReimprimir.map(e => "E" + Number(e.EtiquetaId)), Saltadas: saltadas });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/etiqueta-impresa/reimprimir-bloque  { OrdenId, Desde, Hasta, Motivo }
// Recuperación de una tanda que falló a medias camino a la impresora (atasco, rollo agotado,
// Browser Print caído): reimprime en bloque un rango de correlativos YA registrados de esa
// captura. No crea etiquetas nuevas ni consume cupo — solo audita un ImpresionLog por etiqueta,
// igual que la reimpresión individual. Cada etiqueta respeta el tamaño con el que se registró.
router.post("/reimprimir-bloque", requireAuth, requirePerm("etiquetado", "imprimir"), async (req: Request, res: Response) => {
  try {
    const { OrdenId, Desde, Hasta, Motivo } = req.body;
    if (!OrdenId) { res.status(400).json({ error: "OrdenId es requerido" }); return; }
    const desde = parseCorrelativo(Desde);
    const hasta = parseCorrelativo(Hasta);
    if (!desde || !hasta || desde > hasta) { res.status(400).json({ error: "Rango de correlativos inválido (ej. Desde E120, Hasta E180)" }); return; }
    if (hasta - desde + 1 > 1000) { res.status(400).json({ error: "Rango demasiado grande (máximo 1000 etiquetas por bloque)" }); return; }
    if (!Motivo || !String(Motivo).trim()) { res.status(400).json({ error: "El motivo de la reimpresión es requerido" }); return; }

    const orden = await obtenerDatosOrden(Number(OrdenId));
    if (!orden) { res.status(404).json({ error: "Orden de etiquetado no encontrada" }); return; }
    if (orden.EstatusOrden === "Cancelada") {
      res.status(400).json({ error: "Esta captura está cancelada, no se puede reimprimir." });
      return;
    }

    const { etiquetas, paraReimprimir, saltadas } = await resolverRangoReimpresion(Number(OrdenId), desde, hasta);
    if (!etiquetas.length) { res.status(400).json({ error: "No hay etiquetas activas de esta captura en ese rango de correlativos" }); return; }
    if (!paraReimprimir.length) {
      res.status(400).json({
        error: "Todas las etiquetas de este rango ya fueron escaneadas en bodega — no hay nada que reimprimir.",
        Saltadas: saltadas,
      });
      return;
    }

    const operador = getOperador(req);
    const motivo = String(Motivo).trim();
    await prisma.$transaction(async (tx) => {
      for (const e of paraReimprimir) {
        await tx.$executeRaw`INSERT INTO ImpresionLog (EtiquetaId, Motivo, ImpresoPor) VALUES (${Number(e.EtiquetaId)}, ${motivo}, ${operador})`;
      }
    }, { timeout: 60_000 });

    const posPorTamano = new Map<TamanoId, Posiciones>();
    const bloques: { Correlativo: string; Zpl: string }[] = [];
    for (const e of paraReimprimir) {
      const tamano: TamanoId = tamanoValido(e.Tamano) ? e.Tamano : TAMANO_DEFECTO;
      if (!posPorTamano.has(tamano)) posPorTamano.set(tamano, await obtenerPosiciones(tamano));
      const correlativo = "E" + Number(e.EtiquetaId);
      bloques.push({ Correlativo: correlativo, Zpl: armarZPL(orden, correlativo, posPorTamano.get(tamano)!, tamano) });
    }
    res.json({
      ok: true, Cantidad: bloques.length,
      Desde: bloques[0].Correlativo, Hasta: bloques[bloques.length - 1].Correlativo,
      Bloques: bloques, Saltadas: saltadas,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/etiqueta-impresa/:id/consultar  (acepta "E47" o "47" en :id)
// Consulta completa de un correlativo: existencia/Estatus, qué producto lleva, historial completo
// de impresión/reimpresión (ImpresionLog), y si ya está escaneado en bodega (y dónde). Sirve en dos
// lugares: en Impresión, ANTES de tocar la impresora al reimprimir (reemplaza al extinto
// estado-escaneo — mismo motivo: no gastar la verificación de Browser Print en algo que de todas
// formas se va a advertir, y no dejar que un problema de impresora tape esa advertencia); y en
// Bodega, para investigar un escaneo rechazado o una caja que aparece sin explicación — por eso
// acepta también el permiso bodega.ver, no solo etiquetado.imprimir.
router.get("/:id/consultar", requireAuth, requireAnyPerm([["etiquetado", "imprimir"], ["bodega", "ver"]]), async (req: Request, res: Response) => {
  try {
    const etiquetaId = parseCorrelativo(req.params.id);
    if (!etiquetaId) { res.status(400).json({ error: "Correlativo inválido" }); return; }

    const etiquetaRows: any[] = await prisma.$queryRaw`
      SELECT EtiquetaId, OrdenId, Tamano, Estatus, RegistradoPor, CreadoEn, AnuladoPor, AnuladoEn, MotivoAnulacion
      FROM EtiquetaImpresa WHERE EtiquetaId = ${etiquetaId} LIMIT 1
    `;
    if (!etiquetaRows.length) { res.status(404).json({ error: `No existe ninguna etiqueta con el correlativo E${etiquetaId}` }); return; }
    const etiqueta = etiquetaRows[0];

    const [orden, historialRows, master] = await Promise.all([
      obtenerDatosOrden(Number(etiqueta.OrdenId)),
      prisma.$queryRaw`
        SELECT LogId, Motivo, ReimpresionForzada, ImpresoPor, FechaHora
        FROM ImpresionLog WHERE EtiquetaId = ${etiquetaId} ORDER BY FechaHora ASC, LogId ASC
      ` as Promise<any[]>,
      buscarMasterPorEtiqueta(prisma, etiquetaId),
    ]);

    res.json({
      EtiquetaId: etiquetaId,
      Correlativo: "E" + etiquetaId,
      Estatus: etiqueta.Estatus,
      Tamano: etiqueta.Tamano,
      Anulacion: etiqueta.Estatus === "Anulada"
        ? { AnuladoPor: etiqueta.AnuladoPor, AnuladoEn: etiqueta.AnuladoEn, Motivo: etiqueta.MotivoAnulacion }
        : null,
      CapturaEstatus: orden?.EstatusOrden ?? null,
      Producto: orden ? datosDesdeOrden(orden, "E" + etiquetaId) : null,
      VecesImpresa: historialRows.length,
      Historial: historialRows.map(h => ({
        LogId: Number(h.LogId), Motivo: h.Motivo, ReimpresionForzada: Boolean(Number(h.ReimpresionForzada)),
        ImpresoPor: h.ImpresoPor, FechaHora: h.FechaHora,
      })),
      YaEscaneado: Boolean(master),
      Master: master,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/etiqueta-impresa/:id/anular  { Motivo }
// Cierra el hueco real que tenía el estatus 'Anulada': existía en el schema y se validaba en
// reimprimir/escanear, pero no había ninguna ruta que lo estableciera. Para una etiqueta cuyo master
// físico se dañó, se reprocesó o se descartó ANTES de llegar a bodega — sin esto, esa etiqueta queda
// "Activa" para siempre: cuenta como impresa pero nunca se va a poder escanear, y cualquier reporte
// de Declarado/Impreso/Escaneado muestra un faltante fantasma permanente. Requiere etiquetado.editar
// (no solo imprimir) — misma barrera que ya se usa para forzar una reimpresión, es una corrección
// administrativa, no la operación diaria.
router.put("/:id/anular", requireAuth, requirePerm("etiquetado", "editar"), async (req: Request, res: Response) => {
  try {
    const etiquetaId = Number(req.params.id);
    const { Motivo } = req.body;
    if (!Motivo || !String(Motivo).trim()) { res.status(400).json({ error: "El motivo de la anulación es requerido" }); return; }

    const etiquetaRows: any[] = await prisma.$queryRaw`SELECT EtiquetaId, Estatus FROM EtiquetaImpresa WHERE EtiquetaId = ${etiquetaId} LIMIT 1`;
    if (!etiquetaRows.length) { res.status(404).json({ error: "Etiqueta no encontrada" }); return; }
    if (etiquetaRows[0].Estatus !== "Activa") { res.status(400).json({ error: "Esta etiqueta ya está anulada" }); return; }

    // A propósito NO se rechaza aquí si la captura padre está Cancelada — al revés que reimprimir y
    // reactivar, anular es exactamente la herramienta correcta para cerrar una etiqueta huérfana de
    // una captura cancelada (nunca va a escanearse), así que bloquearla dejaría esas etiquetas sin
    // ninguna salida posible.

    // Si el master ya está en bodega, anularla no tiene sentido — la corrección correcta es quitarlo
    // del pallet (libera el correlativo), no anular una etiqueta que ya cumplió su propósito.
    // Y si el pallet ya está POSICIONADO en bodega física, ni siquiera existe esa corrección: el
    // contenido está sellado (candado de posicionamiento) — solo una des-ubicación administrativa
    // lo reabre.
    const master = await buscarMasterPorEtiqueta(prisma, etiquetaId);
    if (master) {
      if (master.PosicionCodigo) {
        res.status(400).json({
          error: `Este master está en el pallet ${master.PalletCodigo}, ya posicionado en bodega física (${master.PosicionCodigo}) — su contenido está sellado y no se puede anular.`,
        });
        return;
      }
      res.status(400).json({
        error: `Este master ya está escaneado en bodega (pallet ${master.PalletCodigo}) — no se puede anular. Si es una corrección, quítalo del pallet primero.`,
      });
      return;
    }

    const operador = getOperador(req);
    await prisma.$executeRaw`
      UPDATE EtiquetaImpresa SET Estatus = 'Anulada', AnuladoPor = ${operador}, AnuladoEn = NOW(), MotivoAnulacion = ${String(Motivo).trim()}
      WHERE EtiquetaId = ${etiquetaId}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/etiqueta-impresa/:id/reactivar — corrección administrativa (ej. se anuló por error).
// Mismo criterio que Pallets.reabrir: limpia los datos de la anulación en vez de conservar un
// historial de ciclos, porque es una corrección puntual, no una operación frecuente.
router.put("/:id/reactivar", requireAuth, requirePerm("etiquetado", "editar"), async (req: Request, res: Response) => {
  try {
    const etiquetaId = Number(req.params.id);
    const etiquetaRows: any[] = await prisma.$queryRaw`SELECT EtiquetaId, OrdenId, Estatus FROM EtiquetaImpresa WHERE EtiquetaId = ${etiquetaId} LIMIT 1`;
    if (!etiquetaRows.length) { res.status(404).json({ error: "Etiqueta no encontrada" }); return; }
    if (etiquetaRows[0].Estatus !== "Anulada") { res.status(400).json({ error: "Esta etiqueta no está anulada" }); return; }

    // A diferencia de anular, reactivar SÍ se bloquea si la captura padre está cancelada — no tiene
    // sentido devolver una etiqueta a Activa bajo una captura que ya no es válida.
    const capturaRows: any[] = await prisma.$queryRaw`SELECT Estatus FROM OrdenEtiquetado WHERE OrdenId = ${Number(etiquetaRows[0].OrdenId)} LIMIT 1`;
    if (capturaRows.length && capturaRows[0].Estatus === "Cancelada") {
      res.status(400).json({ error: "La captura de esta etiqueta está cancelada, no se puede reactivar." });
      return;
    }

    await prisma.$executeRaw`
      UPDATE EtiquetaImpresa SET Estatus = 'Activa', AnuladoPor = NULL, AnuladoEn = NULL, MotivoAnulacion = NULL
      WHERE EtiquetaId = ${etiquetaId}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/etiqueta-impresa/atascadas?horas=24
// Alerta operativa: etiquetas impresas hace más de N horas (default 24) que todavía no tienen master
// correspondiente en bodega. Es la señal más temprana posible de una etiqueta perdida, pegada a la
// caja equivocada, o simplemente olvidada en algún rincón de planta — detectarlo aquí evita que el
// hueco se descubra recién cuando el pallet ya está en la bodega física real, donde es más caro
// corregirlo. Excluye Anuladas a propósito: una etiqueta anulada nunca va a escanearse y eso es lo
// esperado, no una alerta. También excluye las de una captura Cancelada — esas tampoco van a
// escanearse nunca (no es que estén "perdidas", su captura ya no es válida); la corrección ahí es
// anularlas desde el historial, no investigarlas como si fueran un extravío real.
router.get("/atascadas", requireAuth, requirePerm("etiquetado", "imprimir"), async (req: Request, res: Response) => {
  try {
    const horas = Number(req.query.horas) > 0 ? Number(req.query.horas) : 24;
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT ei.EtiquetaId, ei.CreadoEn, ei.RegistradoPor, TIMESTAMPDIFF(HOUR, ei.CreadoEn, NOW()) AS HorasDesdeImpresion,
             dp.CodigoPedido, cli.RazonSocial AS NombreCliente, sub.RazonSocial AS NombreSubcliente,
             oe.Lote, pc.Descripcion AS DescripcionProceso, ta.Descripcion AS DescripcionTalla, pr.Descripcion AS DescripcionPresentacion
      FROM EtiquetaImpresa ei
      JOIN OrdenEtiquetado oe ON ei.OrdenId = oe.OrdenId
      JOIN DetallePedido dp ON oe.DetalleId = dp.DetalleId
      JOIN Clase cl ON dp.Clase = cl.Clase
      JOIN Procesos pc ON cl.Proceso = pc.Proceso
      JOIN Tallas ta ON dp.Talla = ta.Codigo
      JOIN Presentacion pr ON dp.Presentacion = pr.Codigo
      JOIN Pedidos ped ON dp.CodigoPedido = ped.CodigoPedido
      JOIN Clientes cli ON ped.CodigoCliente = cli.Codigo
      LEFT JOIN Subcliente sub ON ped.CodigoCliente = sub.CodigoCliente AND ped.CodigoSubcliente = sub.CodigoSubcliente
      LEFT JOIN Masters m ON ei.EtiquetaId = m.EtiquetaId
      WHERE ei.Estatus = 'Activa' AND oe.Estatus != 'Cancelada' AND m.MasterId IS NULL AND ei.CreadoEn < (NOW() - INTERVAL ? HOUR)
      ORDER BY ei.CreadoEn ASC
      LIMIT 500
    `, horas);
    res.json(rows.map(r => ({
      ...r,
      EtiquetaId: Number(r.EtiquetaId),
      Correlativo: "E" + Number(r.EtiquetaId),
      HorasDesdeImpresion: Number(r.HorasDesdeImpresion),
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/etiqueta-impresa/:id/reimprimir  { Motivo, Forzar? }
// Repite el mismo correlativo/QR — no crea una etiqueta nueva ni consume cupo, solo audita el reimpreso.
// Si el master de esta etiqueta ya está confirmado en bodega (existe en Masters), reimprimir casi
// siempre es un error operativo (el master físico ya viajó) — se detiene con 409 y los datos de
// dónde quedó, en vez de dejar salir una segunda etiqueta física con el mismo QR sin aviso.
// Forzar=true la permite de todas formas, pero exige además el permiso etiquetado.editar (no solo
// imprimir) y queda marcada en ImpresionLog.ReimpresionForzada para poder auditarla después.
router.post("/:id/reimprimir", requireAuth, requirePerm("etiquetado", "imprimir"), async (req: Request, res: Response) => {
  try {
    const etiquetaId = Number(req.params.id);
    const { Motivo, Forzar } = req.body;
    if (!Motivo || !String(Motivo).trim()) { res.status(400).json({ error: "El motivo de la reimpresión es requerido" }); return; }

    const etiquetaRows: any[] = await prisma.$queryRaw`
      SELECT EtiquetaId, OrdenId, Tamano, Estatus FROM EtiquetaImpresa WHERE EtiquetaId = ${etiquetaId} LIMIT 1
    `;
    if (!etiquetaRows.length) { res.status(404).json({ error: "Etiqueta no encontrada" }); return; }
    if (etiquetaRows[0].Estatus !== "Activa") { res.status(400).json({ error: "Esta etiqueta está anulada, no se puede reimprimir" }); return; }

    const masterExistente = await buscarMasterPorEtiqueta(prisma, etiquetaId);
    // Candado de posicionamiento: si el pallet del master ya tiene posición física, la reimpresión
    // se bloquea en seco — sin opción de Forzar (a diferencia del caso "escaneado pero aún en
    // bodega virtual", donde forzar con permiso de edición sigue permitido).
    if (masterExistente?.PosicionCodigo) {
      res.status(400).json({
        error: `Este master está en el pallet ${masterExistente.PalletCodigo}, ya posicionado en bodega física (${masterExistente.PosicionCodigo}) — su contenido está sellado y no se puede reimprimir.`,
      });
      return;
    }
    if (masterExistente && !Forzar) {
      res.status(409).json({
        error: `Este master ya fue escaneado en bodega — pallet ${masterExistente.PalletCodigo}` +
          `${masterExistente.NombreArea ? " (" + masterExistente.NombreArea + ")" : ""}, ` +
          `${new Date(masterExistente.FechaIngreso).toLocaleString("es-GT")}. Reimprimir puede generar una etiqueta física duplicada.`,
        YaEscaneado: true,
        Master: masterExistente,
      });
      return;
    }
    if (masterExistente && Forzar && !tienePermiso(req as any, "etiquetado", "editar")) {
      res.status(403).json({ error: "Reimprimir la etiqueta de un master ya escaneado requiere permiso de edición en Etiquetado." });
      return;
    }

    const orden = await obtenerDatosOrden(Number(etiquetaRows[0].OrdenId));
    if (!orden) { res.status(404).json({ error: "Orden de etiquetado no encontrada" }); return; }
    if (orden.EstatusOrden === "Cancelada") {
      res.status(400).json({ error: "La captura de esta etiqueta está cancelada, no se puede reimprimir." });
      return;
    }

    // El tamaño se toma de la propia etiqueta (el que se usó al imprimirla la primera vez), no de
    // lo que esté seleccionado en pantalla ahora mismo — una reimpresión debe respetar el rollo con
    // el que se generó originalmente esa etiqueta.
    const tamano: TamanoId = tamanoValido(etiquetaRows[0].Tamano) ? etiquetaRows[0].Tamano : TAMANO_DEFECTO;

    const operador = getOperador(req);
    await prisma.$executeRaw`
      INSERT INTO ImpresionLog (EtiquetaId, Motivo, ReimpresionForzada, ImpresoPor)
      VALUES (${etiquetaId}, ${String(Motivo).trim()}, ${masterExistente ? 1 : 0}, ${operador})
    `;

    const correlativo = "E" + etiquetaId;
    const zpl = armarZPL(orden, correlativo, await obtenerPosiciones(tamano), tamano);
    res.json({ ok: true, EtiquetaId: etiquetaId, Correlativo: correlativo, Tamano: tamano, Zpl: zpl });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
