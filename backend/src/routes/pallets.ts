import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";

const router = Router();

// Error de negocio lanzado DENTRO de una transacción — el catch de la ruta lo traduce a su
// status HTTP en vez de un 500 genérico (mismo patrón que etiquetaImpresa.ts).
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

// Un master trae toda su descripción (Pedido/Cliente/Lote/Proceso+Talla+Presentación/Área) resuelta
// al vuelo desde EtiquetaImpresa→OrdenEtiquetado→DetallePedido — el Pallet no guarda nada de esto
// (ver project_ordenetiquetado_design: "no está ligado a pedido o cliente, se le cargan los datos
// de cada master").
const MASTER_SELECT = `
  SELECT m.MasterId, m.PalletId, m.EtiquetaId, m.IngresadoPor, m.FechaIngreso,
         oe.OrdenId, oe.Lote, oe.FechaProduccion, oe.AreaCodigo, ar.Nombre AS NombreArea,
         dp.DetalleId, dp.CodigoPedido, dp.Clase, pc.Descripcion AS DescripcionProceso,
         dp.Talla, ta.Descripcion AS DescripcionTalla,
         dp.Presentacion, pr.Descripcion AS DescripcionPresentacion,
         cli.RazonSocial AS NombreCliente, sub.RazonSocial AS NombreSubcliente
  FROM Masters m
  JOIN EtiquetaImpresa ei ON m.EtiquetaId = ei.EtiquetaId
  JOIN OrdenEtiquetado oe ON ei.OrdenId = oe.OrdenId
  JOIN DetallePedido dp ON oe.DetalleId = dp.DetalleId
  JOIN Clase cl ON dp.Clase = cl.Clase
  JOIN Procesos pc ON cl.Proceso = pc.Proceso
  JOIN Tallas ta ON dp.Talla = ta.Codigo
  JOIN Presentacion pr ON dp.Presentacion = pr.Codigo
  JOIN Pedidos ped ON dp.CodigoPedido = ped.CodigoPedido
  JOIN Clientes cli ON ped.CodigoCliente = cli.Codigo
  LEFT JOIN Subcliente sub ON ped.CodigoCliente = sub.CodigoCliente AND ped.CodigoSubcliente = sub.CodigoSubcliente
  LEFT JOIN Areas ar ON oe.AreaCodigo = ar.Codigo
`;

// Cuadre = meta de referencia, no bloquea el escaneo (decisión jul 2026): compara lo realmente
// escaneado contra CantidadMaster (la cantidad que se planeó que llevaría el polín al crearlo).
// Mismo patrón que el cierre de captura de Etiquetado. Si el pallet no tiene CantidadMaster (los
// creados antes de esta decisión) no aplica.
function calcularCuadre(cantidadMaster: number | null, escaneados: number): string | null {
  if (cantidadMaster == null) return null;
  if (escaneados === cantidadMaster) return "Completo";
  return escaneados < cantidadMaster ? "Incompleto" : "Sobrante";
}

function formatearMaster(r: any) {
  return {
    ...r,
    MasterId: Number(r.MasterId), PalletId: Number(r.PalletId), EtiquetaId: Number(r.EtiquetaId),
    OrdenId: Number(r.OrdenId), DetalleId: Number(r.DetalleId), Talla: Number(r.Talla),
    Correlativo: "E" + Number(r.EtiquetaId),
    FechaProduccion: r.FechaProduccion ? new Date(r.FechaProduccion).toISOString().slice(0, 10) : null,
  };
}

async function obtenerMastersDePallet(palletId: number) {
  const rows: any[] = await prisma.$queryRawUnsafe(`${MASTER_SELECT} WHERE m.PalletId = ? ORDER BY m.MasterId ASC`, palletId);
  return rows.map(formatearMaster);
}

// Objetivo = CEILING(CantidadCajas / CajasXMaster) de la línea de pedido (mismo cálculo que ya usa
// ordenEtiquetado.ts). Escaneado = masters YA confirmados en bodega de esa línea, en cualquier
// pallet — es el "segundo techo" que quedó pendiente en el diseño de Etiquetado hasta que existiera
// este evento de escaneo real.
async function calcularTechoLinea(tx: any, detalleId: number) {
  const detalle: any[] = await tx.$queryRaw`
    SELECT dp.CantidadCajas, pr.CajasXMaster
    FROM DetallePedido dp JOIN Presentacion pr ON dp.Presentacion = pr.Codigo
    WHERE dp.DetalleId = ${detalleId} LIMIT 1
  `;
  if (!detalle.length) return null;
  const objetivo = Math.ceil(Number(detalle[0].CantidadCajas) / Number(detalle[0].CajasXMaster));
  const escaneadoRows: any[] = await tx.$queryRaw`
    SELECT COUNT(*) AS n FROM Masters m
    JOIN EtiquetaImpresa ei ON m.EtiquetaId = ei.EtiquetaId
    JOIN OrdenEtiquetado oe ON ei.OrdenId = oe.OrdenId
    WHERE oe.DetalleId = ${detalleId}
  `;
  return { Objetivo: objetivo, Escaneado: Number(escaneadoRows[0].n) };
}

// GET /api/pallets?estatus=Abierto&fecha=2026-07-14
router.get("/", requireAuth, requirePerm("bodega", "ver"), async (req: Request, res: Response) => {
  try {
    const estatus = req.query.estatus as string | undefined;
    const fecha = req.query.fecha as string | undefined;
    const condiciones: string[] = [];
    const params: any[] = [];
    if (estatus) { condiciones.push("p.Estatus = ?"); params.push(estatus); }
    if (fecha) { condiciones.push("DATE(p.CreadoEn) = ?"); params.push(fecha); }
    const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT p.PalletId, p.Estatus, p.Origen, org.Descripcion AS DescripcionOrigen, p.CantidadMaster,
             p.CreadoPor, p.CreadoEn, p.CerradoPor, p.CerradoEn,
             (SELECT COUNT(*) FROM Masters m WHERE m.PalletId = p.PalletId) AS CantidadMasters
      FROM Pallets p LEFT JOIN Origen org ON p.Origen = org.Codigo
      ${where} ORDER BY p.PalletId DESC LIMIT 500
    `, ...params);
    res.json(rows.map(r => {
      const cantidadMaster = r.CantidadMaster == null ? null : Number(r.CantidadMaster);
      const cantidadMasters = Number(r.CantidadMasters);
      return { ...r, PalletId: Number(r.PalletId), CantidadMaster: cantidadMaster, CantidadMasters: cantidadMasters, Cuadre: calcularCuadre(cantidadMaster, cantidadMasters) };
    }));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pallets/:id — cabecera + sus masters (con datos derivados)
router.get("/:id", requireAuth, requirePerm("bodega", "ver"), async (req: Request, res: Response) => {
  try {
    const palletId = Number(req.params.id);
    const rows: any[] = await prisma.$queryRaw`
      SELECT p.*, org.Descripcion AS DescripcionOrigen FROM Pallets p
      LEFT JOIN Origen org ON p.Origen = org.Codigo WHERE p.PalletId = ${palletId} LIMIT 1
    `;
    if (!rows.length) { res.status(404).json({ error: "Pallet no encontrado" }); return; }
    const masters = await obtenerMastersDePallet(palletId);
    const cantidadMaster = rows[0].CantidadMaster == null ? null : Number(rows[0].CantidadMaster);
    res.json({
      ...rows[0], PalletId: Number(rows[0].PalletId), CantidadMaster: cantidadMaster,
      Masters: masters, Cuadre: calcularCuadre(cantidadMaster, masters.length),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pallets  { Origen, CantidadMaster }
// Crea un pallet vacío y Abierto. Sin Pedido/Cliente/Área: se arma solo con lo que se escanee
// después — pero SÍ requiere Origen (informativo, no filtra qué se puede escanear ahí) y
// CantidadMaster (meta de referencia de cuántos masters llevará el polín, no bloquea el escaneo).
router.post("/", requireAuth, requirePerm("bodega", "escanear"), async (req: Request, res: Response) => {
  try {
    const { Origen, CantidadMaster } = req.body;
    if (!Origen) { res.status(400).json({ error: "El origen es requerido" }); return; }
    const cantidad = Number(CantidadMaster);
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      res.status(400).json({ error: "La cantidad de masters del pallet debe ser un entero positivo" });
      return;
    }

    const operador = getOperador(req);
    await prisma.$executeRaw`INSERT INTO Pallets (Origen, CantidadMaster, CreadoPor) VALUES (${Origen}, ${cantidad}, ${operador})`;
    const fila: any[] = await prisma.$queryRaw`SELECT LAST_INSERT_ID() AS id`;
    res.status(201).json({ ok: true, PalletId: Number(fila[0].id) });
  } catch (err: any) {
    if (err.message?.includes("foreign key")) { res.status(400).json({ error: "El origen no existe" }); return; }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pallets/:id/escanear  { Correlativo }
// Ingresa un master físico a este pallet. Válido solo si: el correlativo existe, su EtiquetaImpresa
// no está Anulada, no fue escaneado antes (candado real = UNIQUE en Masters.EtiquetaId, no solo la
// verificación previa) y no rompe el techo de su línea de pedido.
router.post("/:id/escanear", requireAuth, requirePerm("bodega", "escanear"), async (req: Request, res: Response) => {
  try {
    const palletId = Number(req.params.id);
    const etiquetaId = parseCorrelativo(req.body.Correlativo);
    if (!etiquetaId) { res.status(400).json({ error: "Correlativo inválido" }); return; }
    const operador = getOperador(req);

    await prisma.$transaction(async (tx) => {
      const palletRows: any[] = await tx.$queryRaw`SELECT Estatus FROM Pallets WHERE PalletId = ${palletId} FOR UPDATE`;
      if (!palletRows.length) throw new ErrorNegocio(404, "Pallet no encontrado");
      if (palletRows[0].Estatus !== "Abierto") throw new ErrorNegocio(400, "Este pallet no está abierto");

      const etiquetaRows: any[] = await tx.$queryRaw`
        SELECT EtiquetaId, OrdenId, Estatus FROM EtiquetaImpresa WHERE EtiquetaId = ${etiquetaId} LIMIT 1
      `;
      if (!etiquetaRows.length) throw new ErrorNegocio(404, "QR no reconocido");
      if (etiquetaRows[0].Estatus !== "Activa") throw new ErrorNegocio(400, "Esta etiqueta está anulada, no se puede ingresar a bodega");

      const yaEscaneado: any[] = await tx.$queryRaw`
        SELECT PalletId, FechaIngreso FROM Masters WHERE EtiquetaId = ${etiquetaId} LIMIT 1
      `;
      if (yaEscaneado.length) {
        const fecha = new Date(yaEscaneado[0].FechaIngreso).toLocaleString("es-GT");
        throw new ErrorNegocio(400, `Este master ya fue escaneado (pallet ${Number(yaEscaneado[0].PalletId)}, ${fecha})`);
      }

      const ordenRows: any[] = await tx.$queryRaw`SELECT DetalleId FROM OrdenEtiquetado WHERE OrdenId = ${Number(etiquetaRows[0].OrdenId)} LIMIT 1`;
      if (!ordenRows.length) throw new ErrorNegocio(404, "Orden de etiquetado no encontrada");
      const detalleId = Number(ordenRows[0].DetalleId);

      // Bloquea las filas de OrdenEtiquetado de esta línea para serializar el techo contra
      // escaneos concurrentes de otros masters de la misma línea (mismo patrón de candado que ya
      // usa etiquetaImpresa.ts para el cupo de impresión).
      await tx.$queryRaw`SELECT OrdenId FROM OrdenEtiquetado WHERE DetalleId = ${detalleId} FOR UPDATE`;
      const techo = await calcularTechoLinea(tx, detalleId);
      if (!techo) throw new ErrorNegocio(404, "Línea de pedido no encontrada");
      if (techo.Escaneado + 1 > techo.Objetivo) {
        throw new ErrorNegocio(400, `Esta línea de pedido ya tiene ${techo.Escaneado} de ${techo.Objetivo} masters escaneados en bodega — no se puede escanear otro más.`);
      }

      await tx.$executeRaw`INSERT INTO Masters (PalletId, EtiquetaId, IngresadoPor) VALUES (${palletId}, ${etiquetaId}, ${operador})`;
    }, { timeout: 30_000 });

    const masterRows: any[] = await prisma.$queryRawUnsafe(`${MASTER_SELECT} WHERE m.PalletId = ? AND m.EtiquetaId = ? LIMIT 1`, palletId, etiquetaId);
    const cantidadRows: any[] = await prisma.$queryRaw`SELECT COUNT(*) AS n FROM Masters WHERE PalletId = ${palletId}`;
    res.status(201).json({ ok: true, Master: formatearMaster(masterRows[0]), CantidadMasters: Number(cantidadRows[0].n) });
  } catch (err: any) {
    if (err instanceof ErrorNegocio) { res.status(err.status).json({ error: err.message }); return; }
    if (err.message?.includes("Duplicate")) { res.status(400).json({ error: "Este master ya fue escaneado" }); return; }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pallets/:id/cerrar — congela el conteo, bloquea más escaneos en este pallet.
router.post("/:id/cerrar", requireAuth, requirePerm("bodega", "escanear"), async (req: Request, res: Response) => {
  try {
    const palletId = Number(req.params.id);
    const rows: any[] = await prisma.$queryRaw`SELECT Estatus FROM Pallets WHERE PalletId = ${palletId} LIMIT 1`;
    if (!rows.length) { res.status(404).json({ error: "Pallet no encontrado" }); return; }
    if (rows[0].Estatus !== "Abierto") { res.status(400).json({ error: "Este pallet no está abierto" }); return; }

    const operador = getOperador(req);
    await prisma.$executeRaw`
      UPDATE Pallets SET Estatus = 'Cerrado', CerradoPor = ${operador}, CerradoEn = NOW() WHERE PalletId = ${palletId}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/pallets/:id/reabrir — corrección administrativa (ej. se cerró por error).
router.put("/:id/reabrir", requireAuth, requirePerm("bodega", "editar"), async (req: Request, res: Response) => {
  try {
    const palletId = Number(req.params.id);
    const rows: any[] = await prisma.$queryRaw`SELECT Estatus FROM Pallets WHERE PalletId = ${palletId} LIMIT 1`;
    if (!rows.length) { res.status(404).json({ error: "Pallet no encontrado" }); return; }
    if (rows[0].Estatus !== "Cerrado") { res.status(400).json({ error: "Este pallet no está cerrado" }); return; }

    await prisma.$executeRaw`
      UPDATE Pallets SET Estatus = 'Abierto', CerradoPor = NULL, CerradoEn = NULL WHERE PalletId = ${palletId}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/pallets/:id/masters/:masterId — quita un master mal escaneado del pallet (libera el
// correlativo para poder re-escanearse). Solo mientras el pallet siga Abierto.
router.delete("/:id/masters/:masterId", requireAuth, requirePerm("bodega", "editar"), async (req: Request, res: Response) => {
  try {
    const palletId = Number(req.params.id);
    const masterId = Number(req.params.masterId);
    const palletRows: any[] = await prisma.$queryRaw`SELECT Estatus FROM Pallets WHERE PalletId = ${palletId} LIMIT 1`;
    if (!palletRows.length) { res.status(404).json({ error: "Pallet no encontrado" }); return; }
    if (palletRows[0].Estatus !== "Abierto") { res.status(400).json({ error: "Este pallet no está abierto, no se pueden quitar masters" }); return; }

    const result = await prisma.$executeRaw`DELETE FROM Masters WHERE MasterId = ${masterId} AND PalletId = ${palletId}`;
    if (!result) { res.status(404).json({ error: "Master no encontrado en este pallet" }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/pallets/:id — solo si está Abierto y sin masters.
router.delete("/:id", requireAuth, requirePerm("bodega", "eliminar"), async (req: Request, res: Response) => {
  try {
    const palletId = Number(req.params.id);
    const rows: any[] = await prisma.$queryRaw`
      SELECT p.Estatus, (SELECT COUNT(*) FROM Masters m WHERE m.PalletId = p.PalletId) AS n
      FROM Pallets p WHERE p.PalletId = ${palletId} LIMIT 1
    `;
    if (!rows.length) { res.status(404).json({ error: "Pallet no encontrado" }); return; }
    if (rows[0].Estatus !== "Abierto") { res.status(400).json({ error: "Solo se puede eliminar un pallet Abierto" }); return; }
    if (Number(rows[0].n) > 0) { res.status(400).json({ error: "Este pallet ya tiene masters escaneados, no se puede eliminar" }); return; }

    await prisma.$executeRaw`DELETE FROM Pallets WHERE PalletId = ${palletId}`;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
