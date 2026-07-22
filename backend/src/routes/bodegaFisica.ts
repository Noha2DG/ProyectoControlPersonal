import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";

// Bodega física: posiciones en racks para pallets Cerrados (ver createBodegaFisica.ts para el
// modelo y las decisiones). La ocupación vive en Pallets.PosicionId (UNIQUE = candado real);
// MovimientosBodega es el kardex inmutable — aquí solo se insertan filas, nunca se tocan.
const router = Router();

// Mismo patrón que pallets.ts/etiquetaImpresa.ts: error de negocio lanzado dentro de la
// transacción, traducido a su status HTTP por el catch de la ruta.
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

// Cuadre = misma regla de referencia que usa pallets.ts (meta vs escaneado, no bloquea nada).
function calcularCuadre(cantidadMaster: number | null, escaneados: number): string | null {
  if (cantidadMaster == null) return null;
  if (escaneados === cantidadMaster) return "Completo";
  return escaneados < cantidadMaster ? "Incompleto" : "Sobrante";
}

// GET /api/bodega-fisica/mapa — el plano completo en una sola llamada: catálogo de racks + las 640
// posiciones con su estado derivado (pallet que la ocupa, o bloqueo). El detalle del pallet ocupante
// (masters, pesos) NO viaja aquí — el frontend lo pide bajo demanda a GET /api/pallets/:id.
router.get("/mapa", requireAuth, requirePerm("bodega", "ver"), async (_req: Request, res: Response) => {
  try {
    const racks: any[] = await prisma.$queryRaw`
      SELECT RackId, Nombre, Niveles, PosicionesPorNivel, Orden FROM Racks WHERE Activo = 1 ORDER BY Orden ASC
    `;
    const posiciones: any[] = await prisma.$queryRaw`
      SELECT pos.PosicionId, pos.RackId, pos.Nivel, pos.Posicion, pos.Codigo,
             pos.Bloqueada, pos.MotivoBloqueo, pos.BloqueadaPor, pos.BloqueadaEn,
             p.PalletId, p.Codigo AS PalletCodigo,
             (SELECT mb.Fecha FROM MovimientosBodega mb
              WHERE mb.PalletId = p.PalletId AND mb.Tipo = 'INGRESO'
              ORDER BY mb.MovimientoId DESC LIMIT 1) AS UbicadoEn,
             (SELECT mb.Usuario FROM MovimientosBodega mb
              WHERE mb.PalletId = p.PalletId AND mb.Tipo = 'INGRESO'
              ORDER BY mb.MovimientoId DESC LIMIT 1) AS UbicadoPor
      FROM Posiciones pos
      LEFT JOIN Pallets p ON p.PosicionId = pos.PosicionId
      ORDER BY pos.RackId ASC, pos.Nivel ASC, pos.Posicion ASC
    `;
    res.json({
      Racks: racks.map(r => ({
        RackId: Number(r.RackId), Nombre: r.Nombre,
        Niveles: Number(r.Niveles), PosicionesPorNivel: Number(r.PosicionesPorNivel), Orden: Number(r.Orden),
      })),
      Posiciones: posiciones.map(r => ({
        PosicionId: Number(r.PosicionId), RackId: Number(r.RackId),
        Nivel: Number(r.Nivel), Posicion: Number(r.Posicion), Codigo: r.Codigo,
        Bloqueada: Number(r.Bloqueada) === 1, MotivoBloqueo: r.MotivoBloqueo,
        BloqueadaPor: r.BloqueadaPor, BloqueadaEn: r.BloqueadaEn,
        PalletId: r.PalletId == null ? null : Number(r.PalletId),
        PalletCodigo: r.PalletCodigo ?? null,
        UbicadoEn: r.UbicadoEn ?? null, UbicadoPor: r.UbicadoPor ?? null,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bodega-fisica/pendientes — la cola de recepción: pallets Cerrados que todavía no tienen
// posición, con su contenido resumido (los agregados salen del mismo join Masters→…→Pedidos que ya
// usa pallets.ts, aquí colapsado por pallet). Orden: el cerrado hace más tiempo primero.
router.get("/pendientes", requireAuth, requirePerm("bodega", "ver"), async (_req: Request, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT p.PalletId, p.Codigo, p.CantidadMaster, p.CerradoPor, p.CerradoEn,
             org.Descripcion AS DescripcionOrigen, bv.Nombre AS NombreBodegaVirtual,
             COUNT(m.MasterId) AS CantidadMasters,
             COALESCE(SUM(pr.PesoKG * pr.CajasXMaster), 0) AS PesoKg,
             COALESCE(SUM(pr.PesoLb * pr.CajasXMaster), 0) AS PesoLb,
             GROUP_CONCAT(DISTINCT oe.Lote ORDER BY oe.Lote SEPARATOR ', ') AS Lotes,
             GROUP_CONCAT(DISTINCT cli.RazonSocial ORDER BY cli.RazonSocial SEPARATOR ', ') AS Clientes,
             GROUP_CONCAT(DISTINCT CONCAT(pc.Descripcion, ' ', ta.Descripcion, ' ', pr.Descripcion) SEPARATOR ' · ') AS Productos
      FROM Pallets p
      LEFT JOIN Origen org ON p.Origen = org.Codigo
      LEFT JOIN BodegaVirtual bv ON p.BodegaVirtualCodigo = bv.Codigo
      LEFT JOIN Masters m ON m.PalletId = p.PalletId
      LEFT JOIN EtiquetaImpresa ei ON m.EtiquetaId = ei.EtiquetaId
      LEFT JOIN OrdenEtiquetado oe ON ei.OrdenId = oe.OrdenId
      LEFT JOIN DetallePedido dp ON oe.DetalleId = dp.DetalleId
      LEFT JOIN Clase cl ON dp.Clase = cl.Clase
      LEFT JOIN Procesos pc ON cl.Proceso = pc.Proceso
      LEFT JOIN Tallas ta ON dp.Talla = ta.Codigo
      LEFT JOIN Presentacion pr ON dp.Presentacion = pr.Codigo
      LEFT JOIN Pedidos ped ON dp.CodigoPedido = ped.CodigoPedido
      LEFT JOIN Clientes cli ON ped.CodigoCliente = cli.Codigo
      WHERE p.Estatus = 'Cerrado' AND p.PosicionId IS NULL
      GROUP BY p.PalletId, p.Codigo, p.CantidadMaster, p.CerradoPor, p.CerradoEn, org.Descripcion, bv.Nombre
      ORDER BY p.CerradoEn ASC
    `;
    res.json(rows.map(r => {
      const cantidadMaster = r.CantidadMaster == null ? null : Number(r.CantidadMaster);
      const cantidadMasters = Number(r.CantidadMasters);
      return {
        PalletId: Number(r.PalletId), Codigo: r.Codigo,
        CantidadMaster: cantidadMaster, CantidadMasters: cantidadMasters,
        Cuadre: calcularCuadre(cantidadMaster, cantidadMasters),
        PesoKg: Number(r.PesoKg), PesoLb: Number(r.PesoLb),
        Lotes: r.Lotes, Clientes: r.Clientes, Productos: r.Productos,
        DescripcionOrigen: r.DescripcionOrigen, NombreBodegaVirtual: r.NombreBodegaVirtual,
        CerradoPor: r.CerradoPor, CerradoEn: r.CerradoEn,
      };
    }));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bodega-fisica/existencias — TODO lo que ya está escaneado (tiene Masters), esté o no
// posicionado: pallets Abiertos/Cerrados en su área (Túnel, Masterizado, etc.) Y pallets Cerrados ya
// ubicados en bodega física. Es la foto completa de "qué hay escaneado en la planta ahora mismo";
// Estatus + PosicionCodigo son la columna que separa ambos casos (ver duda del área: oe.AreaCodigo
// es el área de ORIGEN y no cambia al ubicar — Estatus/Posición es lo que sí distingue dónde está
// FÍSICAMENTE cada polín hoy). Una fila por Polín × línea de pedido, mismo grano que la hoja cruda
// del equipo de producción. Al no depender de PosicionId para incluir la fila (solo para calcular
// Estatus/Posición), el día que exista la salida por remisión esta vista se sigue actualizando sola.
router.get("/existencias", requireAuth, requirePerm("bodega", "ver"), async (_req: Request, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT ped.CodigoPedido AS Pedido, cli.RazonSocial AS Cliente, sub.RazonSocial AS Subcliente,
             pc.Descripcion AS Clase, ta.Descripcion AS Talla,
             p.PalletId, p.Codigo AS Polin, p.Estatus, pr.Descripcion AS Presentacion,
             oe.FechaProduccion, oe.Lote, oe.AreaCodigo, ar.Nombre AS NombreArea,
             p.PosicionId, pos.Codigo AS PosicionCodigo,
             COUNT(m.MasterId) AS Master,
             SUM(pr.CajasXMaster) AS Cajas,
             SUM(pr.PesoKG * pr.CajasXMaster) AS KilosBrutos,
             SUM(pr.PesoLb * pr.CajasXMaster) AS Libras
      FROM Pallets p
      JOIN Masters m ON m.PalletId = p.PalletId
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
      LEFT JOIN Posiciones pos ON p.PosicionId = pos.PosicionId
      GROUP BY ped.CodigoPedido, cli.RazonSocial, sub.RazonSocial, pc.Descripcion, ta.Descripcion,
               p.PalletId, p.Codigo, p.Estatus, pr.Descripcion, oe.FechaProduccion, oe.Lote, oe.AreaCodigo, ar.Nombre,
               p.PosicionId, pos.Codigo
      ORDER BY cli.RazonSocial ASC, oe.Lote ASC, p.Codigo ASC
    `;
    res.json(rows.map(r => ({
      Pedido: r.Pedido, Cliente: r.Cliente, Subcliente: r.Subcliente,
      Clase: r.Clase, Talla: r.Talla,
      PalletId: Number(r.PalletId), Polin: r.Polin, Estatus: r.Estatus, Presentacion: r.Presentacion,
      Fecha: r.FechaProduccion ? new Date(r.FechaProduccion).toISOString().slice(0, 10) : null,
      Lote: r.Lote, AreaCodigo: r.AreaCodigo, NombreArea: r.NombreArea,
      PosicionId: r.PosicionId == null ? null : Number(r.PosicionId), PosicionCodigo: r.PosicionCodigo ?? null,
      Master: Number(r.Master), Cajas: Number(r.Cajas),
      KilosBrutos: Number(r.KilosBrutos), Libras: Number(r.Libras),
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bodega-fisica/ubicar  { Codigo | PalletId, PosicionId }
// El paso 7 del flujo: asigna la posición y registra el INGRESO en el kardex, todo en una
// transacción. Acepta el Codigo tal como sale del QR de la hoja del pallet (o el PalletId si la
// pantalla ya lo tiene). La pantalla valida contra su mapa, pero la validación REAL es esta —
// el mapa del cliente puede estar viejo; el UNIQUE de Pallets.PosicionId es el candado final
// contra dos operarios confirmando la misma posición al mismo tiempo.
router.post("/ubicar", requireAuth, requirePerm("bodega", "escanear"), async (req: Request, res: Response) => {
  try {
    const posicionId = Number(req.body.PosicionId);
    if (!Number.isInteger(posicionId) || posicionId <= 0) {
      res.status(400).json({ error: "PosicionId inválido" });
      return;
    }
    const palletId = req.body.PalletId != null ? Number(req.body.PalletId) : null;
    const codigo = String(req.body.Codigo ?? "").trim().toUpperCase();
    if (palletId == null && !codigo) {
      res.status(400).json({ error: "Se requiere el Codigo escaneado o el PalletId" });
      return;
    }

    const operador = getOperador(req);
    let respuesta: any = null;
    await prisma.$transaction(async (tx) => {
      const palletRows: any[] = palletId != null
        ? await tx.$queryRaw`SELECT PalletId, Codigo, Estatus, PosicionId FROM Pallets WHERE PalletId = ${palletId} LIMIT 1 FOR UPDATE`
        : await tx.$queryRaw`SELECT PalletId, Codigo, Estatus, PosicionId FROM Pallets WHERE Codigo = ${codigo} LIMIT 1 FOR UPDATE`;
      if (!palletRows.length) throw new ErrorNegocio(404, "QR no reconocido — no corresponde a ningún pallet");
      const pallet = palletRows[0];
      if (pallet.Estatus === "Abierto") throw new ErrorNegocio(400, `El pallet ${pallet.Codigo} sigue abierto — ciérralo antes de ubicarlo en bodega`);
      if (pallet.Estatus !== "Cerrado") throw new ErrorNegocio(400, `El pallet ${pallet.Codigo} está ${String(pallet.Estatus).toLowerCase()} — no puede ubicarse`);
      if (pallet.PosicionId != null) {
        const actual: any[] = await tx.$queryRaw`SELECT Codigo FROM Posiciones WHERE PosicionId = ${Number(pallet.PosicionId)} LIMIT 1`;
        throw new ErrorNegocio(400, `El pallet ${pallet.Codigo} ya está ubicado en ${actual[0]?.Codigo ?? "otra posición"}`);
      }

      const posRows: any[] = await tx.$queryRaw`
        SELECT PosicionId, Codigo, Bloqueada, MotivoBloqueo FROM Posiciones WHERE PosicionId = ${posicionId} LIMIT 1 FOR UPDATE
      `;
      if (!posRows.length) throw new ErrorNegocio(404, "Posición no encontrada");
      const posicion = posRows[0];
      if (Number(posicion.Bloqueada) === 1) {
        throw new ErrorNegocio(400, `La posición ${posicion.Codigo} está bloqueada${posicion.MotivoBloqueo ? ` (${posicion.MotivoBloqueo})` : ""} — elige otra`);
      }
      const ocupante: any[] = await tx.$queryRaw`SELECT Codigo FROM Pallets WHERE PosicionId = ${posicionId} LIMIT 1 FOR UPDATE`;
      if (ocupante.length) {
        throw new ErrorNegocio(400, `La posición ${posicion.Codigo} ya está ocupada por el pallet ${ocupante[0].Codigo} — elige otra`);
      }

      await tx.$executeRaw`UPDATE Pallets SET PosicionId = ${posicionId} WHERE PalletId = ${Number(pallet.PalletId)}`;
      await tx.$executeRaw`
        INSERT INTO MovimientosBodega (PalletId, Tipo, PosicionOrigenId, PosicionDestinoId, Usuario)
        VALUES (${Number(pallet.PalletId)}, 'INGRESO', NULL, ${posicionId}, ${operador})
      `;
      respuesta = { ok: true, PalletId: Number(pallet.PalletId), PalletCodigo: pallet.Codigo, PosicionId: posicionId, PosicionCodigo: posicion.Codigo };
    }, { timeout: 30_000 });

    res.status(201).json(respuesta);
  } catch (err: any) {
    if (err instanceof ErrorNegocio) { res.status(err.status).json({ error: err.message }); return; }
    if (err.message?.includes("Duplicate")) { res.status(400).json({ error: "Esa posición acaba de ser ocupada por otro pallet — elige otra" }); return; }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bodega-fisica/desubicar  { PalletId, Motivo }
// La única puerta de escape del candado de posicionamiento (corrección administrativa): libera la
// posición dejando el movimiento en el kardex — nunca se borra historia. Tras esto el pallet vuelve
// a ser un "Cerrado sin posición" (reaparece en pendientes y ya puede reabrirse si hace falta).
router.post("/desubicar", requireAuth, requirePerm("bodega", "editar"), async (req: Request, res: Response) => {
  try {
    const palletId = Number(req.body.PalletId);
    const motivo = String(req.body.Motivo ?? "").trim();
    if (!Number.isInteger(palletId) || palletId <= 0) { res.status(400).json({ error: "PalletId inválido" }); return; }
    if (!motivo) { res.status(400).json({ error: "El motivo de la des-ubicación es requerido" }); return; }

    const operador = getOperador(req);
    let respuesta: any = null;
    await prisma.$transaction(async (tx) => {
      const rows: any[] = await tx.$queryRaw`
        SELECT p.PalletId, p.Codigo, p.PosicionId, po.Codigo AS PosicionCodigo
        FROM Pallets p LEFT JOIN Posiciones po ON p.PosicionId = po.PosicionId
        WHERE p.PalletId = ${palletId} LIMIT 1 FOR UPDATE
      `;
      if (!rows.length) throw new ErrorNegocio(404, "Pallet no encontrado");
      if (rows[0].PosicionId == null) throw new ErrorNegocio(400, `El pallet ${rows[0].Codigo} no está ubicado en ninguna posición`);

      await tx.$executeRaw`UPDATE Pallets SET PosicionId = NULL WHERE PalletId = ${palletId}`;
      await tx.$executeRaw`
        INSERT INTO MovimientosBodega (PalletId, Tipo, PosicionOrigenId, PosicionDestinoId, Usuario, Motivo)
        VALUES (${palletId}, 'DESUBICACION', ${Number(rows[0].PosicionId)}, NULL, ${operador}, ${motivo})
      `;
      respuesta = { ok: true, PalletCodigo: rows[0].Codigo, PosicionCodigo: rows[0].PosicionCodigo };
    }, { timeout: 30_000 });

    res.json(respuesta);
  } catch (err: any) {
    if (err instanceof ErrorNegocio) { res.status(err.status).json({ error: err.message }); return; }
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bodega-fisica/movimientos?limit=30 — kardex reciente para el panel de historial.
router.get("/movimientos", requireAuth, requirePerm("bodega", "ver"), async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 200);
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT mb.MovimientoId, mb.Tipo, mb.Fecha, mb.Usuario, mb.Motivo,
             p.Codigo AS PalletCodigo, bv.Nombre AS NombreBodegaVirtual,
             poO.Codigo AS PosicionOrigen, poD.Codigo AS PosicionDestino
      FROM MovimientosBodega mb
      JOIN Pallets p ON mb.PalletId = p.PalletId
      LEFT JOIN BodegaVirtual bv ON p.BodegaVirtualCodigo = bv.Codigo
      LEFT JOIN Posiciones poO ON mb.PosicionOrigenId = poO.PosicionId
      LEFT JOIN Posiciones poD ON mb.PosicionDestinoId = poD.PosicionId
      ORDER BY mb.MovimientoId DESC LIMIT ?
    `, limit);
    res.json(rows.map(r => ({ ...r, MovimientoId: Number(r.MovimientoId) })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bodega-fisica/posiciones/:id/bloquear  { Motivo }
// Solo posiciones libres: bloquear una ocupada no tiene sentido operativo (el pallet ya está ahí).
// La auditoría del bloqueo vive en las columnas de la posición (no en el kardex, que es por pallet).
router.post("/posiciones/:id/bloquear", requireAuth, requirePerm("bodega", "editar"), async (req: Request, res: Response) => {
  try {
    const posicionId = Number(req.params.id);
    const motivo = String(req.body.Motivo ?? "").trim();
    if (!motivo) { res.status(400).json({ error: "El motivo del bloqueo es requerido" }); return; }

    const operador = getOperador(req);
    await prisma.$transaction(async (tx) => {
      const rows: any[] = await tx.$queryRaw`
        SELECT PosicionId, Codigo, Bloqueada FROM Posiciones WHERE PosicionId = ${posicionId} LIMIT 1 FOR UPDATE
      `;
      if (!rows.length) throw new ErrorNegocio(404, "Posición no encontrada");
      if (Number(rows[0].Bloqueada) === 1) throw new ErrorNegocio(400, `La posición ${rows[0].Codigo} ya está bloqueada`);
      const ocupante: any[] = await tx.$queryRaw`SELECT Codigo FROM Pallets WHERE PosicionId = ${posicionId} LIMIT 1`;
      if (ocupante.length) throw new ErrorNegocio(400, `La posición ${rows[0].Codigo} está ocupada por el pallet ${ocupante[0].Codigo} — no se puede bloquear`);

      await tx.$executeRaw`
        UPDATE Posiciones SET Bloqueada = 1, MotivoBloqueo = ${motivo}, BloqueadaPor = ${operador}, BloqueadaEn = NOW()
        WHERE PosicionId = ${posicionId}
      `;
    });
    res.json({ ok: true });
  } catch (err: any) {
    if (err instanceof ErrorNegocio) { res.status(err.status).json({ error: err.message }); return; }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bodega-fisica/posiciones/:id/desbloquear — corrección puntual: limpia los datos del
// bloqueo en vez de conservar ciclos (mismo criterio que reabrir pallet / reactivar etiqueta).
router.post("/posiciones/:id/desbloquear", requireAuth, requirePerm("bodega", "editar"), async (req: Request, res: Response) => {
  try {
    const posicionId = Number(req.params.id);
    const rows: any[] = await prisma.$queryRaw`SELECT Codigo, Bloqueada FROM Posiciones WHERE PosicionId = ${posicionId} LIMIT 1`;
    if (!rows.length) { res.status(404).json({ error: "Posición no encontrada" }); return; }
    if (Number(rows[0].Bloqueada) !== 1) { res.status(400).json({ error: `La posición ${rows[0].Codigo} no está bloqueada` }); return; }

    await prisma.$executeRaw`
      UPDATE Posiciones SET Bloqueada = 0, MotivoBloqueo = NULL, BloqueadaPor = NULL, BloqueadaEn = NULL
      WHERE PosicionId = ${posicionId}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
