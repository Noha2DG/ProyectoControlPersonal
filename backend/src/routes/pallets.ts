import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";
import { buscarMasterPorEtiqueta, calcularTechoLinea, MASTER_SELECT, formatearMaster } from "../lib/masters.ts";

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

// Cuadre = meta de referencia, no bloquea el escaneo (decisión jul 2026): compara lo realmente
// escaneado contra CantidadMaster (la cantidad que se planeó que llevaría el polín al crearlo).
// Mismo patrón que el cierre de captura de Etiquetado. Si el pallet no tiene CantidadMaster (los
// creados antes de esta decisión) no aplica.
function calcularCuadre(cantidadMaster: number | null, escaneados: number): string | null {
  if (cantidadMaster == null) return null;
  if (escaneados === cantidadMaster) return "Completo";
  return escaneados < cantidadMaster ? "Incompleto" : "Sobrante";
}

async function obtenerMastersDePallet(palletId: number) {
  const rows: any[] = await prisma.$queryRawUnsafe(`${MASTER_SELECT} WHERE m.PalletId = ? ORDER BY m.MasterId ASC`, palletId);
  return rows.map(formatearMaster);
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
      SELECT p.PalletId, p.Codigo, p.Estatus, p.Origen, org.Descripcion AS DescripcionOrigen, p.CantidadMaster,
             p.BodegaVirtualCodigo, bv.Nombre AS NombreBodegaVirtual,
             p.PosicionId, po.Codigo AS PosicionCodigo,
             p.CreadoPor, p.CreadoEn, p.CerradoPor, p.CerradoEn,
             (SELECT COUNT(*) FROM Masters m WHERE m.PalletId = p.PalletId) AS CantidadMasters
      FROM Pallets p
      LEFT JOIN Origen org ON p.Origen = org.Codigo
      LEFT JOIN BodegaVirtual bv ON p.BodegaVirtualCodigo = bv.Codigo
      LEFT JOIN Posiciones po ON p.PosicionId = po.PosicionId
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
      SELECT p.*, org.Descripcion AS DescripcionOrigen, bv.Nombre AS NombreBodegaVirtual,
             po.Codigo AS PosicionCodigo
      FROM Pallets p
      LEFT JOIN Origen org ON p.Origen = org.Codigo
      LEFT JOIN BodegaVirtual bv ON p.BodegaVirtualCodigo = bv.Codigo
      LEFT JOIN Posiciones po ON p.PosicionId = po.PosicionId
      WHERE p.PalletId = ${palletId} LIMIT 1
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

// POST /api/pallets  { Origen, CantidadMaster, AreaCodigo }
// Crea un pallet vacío y Abierto. Sin Pedido/Cliente/línea de pedido: se arma solo con lo que se
// escanee después — pero SÍ requiere Origen (informativo, no filtra qué se puede escanear ahí),
// CantidadMaster (meta de referencia, no bloquea el escaneo) y AreaCodigo — el área REAL donde se
// está trabajando (Túnel, Masterizado...), no un tipo de bodega elegido a mano. De ahí el sistema
// resuelve solo la bodega virtual correspondiente (BodegaVirtual.AreaCodigo) y su letra de código
// (ej. "T0001" para Túnel) — el pallet queda en esa bodega virtual antes de pasar a la bodega
// física real (asignación de posición + hoja física impresa — todavía no existe ese siguiente paso).
router.post("/", requireAuth, requirePerm("bodega", "escanear"), async (req: Request, res: Response) => {
  try {
    const { Origen, CantidadMaster, AreaCodigo } = req.body;
    if (!Origen) { res.status(400).json({ error: "El origen es requerido" }); return; }
    if (!AreaCodigo) { res.status(400).json({ error: "El área es requerida" }); return; }
    const cantidad = Number(CantidadMaster);
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      res.status(400).json({ error: "La cantidad de masters del pallet debe ser un entero positivo" });
      return;
    }

    const operador = getOperador(req);
    let nuevoPalletId = 0;
    let codigo = "";
    // El secuencial de la bodega virtual se incrementa dentro de la transacción (UPDATE ...
    // SET x = x + 1 bloquea la fila hasta el commit) — dos pallets creados a la vez en la misma
    // bodega virtual no pueden terminar con el mismo código.
    await prisma.$transaction(async (tx) => {
      const bvRows: any[] = await tx.$queryRaw`SELECT Codigo, Letra, Activo FROM BodegaVirtual WHERE AreaCodigo = ${AreaCodigo} FOR UPDATE`;
      if (!bvRows.length) throw new ErrorNegocio(404, "Esta área todavía no tiene bodega virtual asignada");
      if (!Number(bvRows[0].Activo)) throw new ErrorNegocio(400, "La bodega virtual de esta área está inactiva");
      const bodegaVirtualCodigo = String(bvRows[0].Codigo);

      await tx.$executeRaw`UPDATE BodegaVirtual SET UltimoSecuencial = UltimoSecuencial + 1 WHERE Codigo = ${bodegaVirtualCodigo}`;
      const secRows: any[] = await tx.$queryRaw`SELECT UltimoSecuencial FROM BodegaVirtual WHERE Codigo = ${bodegaVirtualCodigo}`;
      codigo = String(bvRows[0].Letra) + String(Number(secRows[0].UltimoSecuencial)).padStart(4, "0");

      await tx.$executeRaw`
        INSERT INTO Pallets (Codigo, Origen, CantidadMaster, BodegaVirtualCodigo, CreadoPor)
        VALUES (${codigo}, ${Origen}, ${cantidad}, ${bodegaVirtualCodigo}, ${operador})
      `;
      const fila: any[] = await tx.$queryRaw`SELECT LAST_INSERT_ID() AS id`;
      nuevoPalletId = Number(fila[0].id);
    });

    res.status(201).json({ ok: true, PalletId: nuevoPalletId, Codigo: codigo });
  } catch (err: any) {
    if (err instanceof ErrorNegocio) { res.status(err.status).json({ error: err.message }); return; }
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

      const yaEscaneado = await buscarMasterPorEtiqueta(tx, etiquetaId);
      if (yaEscaneado) {
        const fecha = new Date(yaEscaneado.FechaIngreso).toLocaleString("es-GT");
        throw new ErrorNegocio(400, `Este master ya fue escaneado (pallet ${yaEscaneado.PalletCodigo}, ${fecha})`);
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
      // Objetivo null = pedido general/de almacenaje: no hay cantidad comprometida, así que no hay
      // techo que romper y el pallet recibe cuanto se produzca (ver project_pedido_general_design).
      // Este es el único punto de bodega que cambia; el flujo de entrada es el mismo de siempre.
      if (techo.Objetivo !== null && techo.Escaneado + 1 > techo.Objetivo) {
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
// Este es el cerrojo maestro del candado de posicionamiento: un pallet con posición física NUNCA
// se reabre — al quedar Cerrado para siempre, quitar/escanear masters y (transitivamente) anular
// sus etiquetas quedan sellados. La única salida es la des-ubicación administrativa en Bodega.
router.put("/:id/reabrir", requireAuth, requirePerm("bodega", "editar"), async (req: Request, res: Response) => {
  try {
    const palletId = Number(req.params.id);
    const rows: any[] = await prisma.$queryRaw`
      SELECT p.Estatus, p.PosicionId, po.Codigo AS PosicionCodigo
      FROM Pallets p LEFT JOIN Posiciones po ON p.PosicionId = po.PosicionId
      WHERE p.PalletId = ${palletId} LIMIT 1
    `;
    if (!rows.length) { res.status(404).json({ error: "Pallet no encontrado" }); return; }
    if (rows[0].PosicionId != null) {
      res.status(400).json({
        error: `Este pallet ya está posicionado en la bodega física (${rows[0].PosicionCodigo}) — su contenido está sellado y no se puede reabrir. Si es una corrección, primero des-ubícalo desde Bodega — Ubicaciones.`,
      });
      return;
    }
    if (rows[0].Estatus !== "Cerrado") { res.status(400).json({ error: "Este pallet no está cerrado" }); return; }

    await prisma.$executeRaw`
      UPDATE Pallets SET Estatus = 'Abierto', CerradoPor = NULL, CerradoEn = NULL WHERE PalletId = ${palletId}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pallets/:id/desarmar  { Motivo } — el polín se rompe DE VERDAD.
// Ya NO es un requisito para remisionar (revisado 6 ago 2026): una remisión puede tomar cajas de un
// polín armado y posicionado, dejándolo en su lugar con el resto — sacar 10 de 50 no destruye nada.
// Esto queda solo para cuando el polín efectivamente deja de existir como unidad: suelta su posición,
// sus masters quedan sueltos y no se puede volver a armar; el sobrante se consolida escaneándolo en
// un polín nuevo, que sí se reubica.
// No confundir con "reabrir": reabrir devuelve el polín a la fila de escaneo de ENTRADA (y por eso
// está prohibido si ya se posicionó). Desarmar deja el polín cerrado para siempre.
router.post("/:id/desarmar", requireAuth, requirePerm("bodega", "editar"), async (req: Request, res: Response) => {
  try {
    const palletId = Number(req.params.id);
    const motivo = String(req.body.Motivo ?? "").trim();
    if (!motivo) { res.status(400).json({ error: "El motivo del desarme es requerido" }); return; }

    const operador = getOperador(req);
    let respuesta: any = null;
    await prisma.$transaction(async (tx) => {
      const rows: any[] = await tx.$queryRaw`
        SELECT PalletId, Codigo, Estatus, PosicionId FROM Pallets WHERE PalletId = ${palletId} LIMIT 1 FOR UPDATE
      `;
      if (!rows.length) throw new ErrorNegocio(404, "Pallet no encontrado");
      const pallet = rows[0];
      if (pallet.Estatus === "Abierto") throw new ErrorNegocio(400, `El polín ${pallet.Codigo} sigue abierto — si quieres sacarle un master, quítalo desde el panel de escaneo`);
      if (pallet.Estatus === "Desarmado") throw new ErrorNegocio(400, `El polín ${pallet.Codigo} ya está desarmado`);
      if (pallet.Estatus !== "Cerrado") throw new ErrorNegocio(400, `El polín ${pallet.Codigo} está ${String(pallet.Estatus).toLowerCase()} — no se puede desarmar`);

      const masters: any[] = await tx.$queryRaw`SELECT MasterId FROM Masters WHERE PalletId = ${palletId} AND Estatus = 'EnBodega' FOR UPDATE`;
      if (!masters.length) throw new ErrorNegocio(400, `El polín ${pallet.Codigo} no tiene masters en bodega que desarmar`);

      // Un polín ya comprometido en una remisión en borrador se agregó ENTERO; desarmarlo a media
      // captura dejaría ese documento con líneas que ya no corresponden a un polín existente.
      const enRemision: any[] = await tx.$queryRaw`
        SELECT r.Folio FROM RemisionDetalle rd
        JOIN Remisiones r ON rd.RemisionId = r.RemisionId
        JOIN Masters m ON rd.MasterId = m.MasterId
        WHERE m.PalletId = ${palletId} AND rd.Vigente = 1 LIMIT 1
      `;
      if (enRemision.length) throw new ErrorNegocio(400, `El polín ${pallet.Codigo} ya está en la remisión ${enRemision[0].Folio} — quítalo de ahí antes de desarmarlo`);

      await tx.$executeRaw`UPDATE Masters SET Estatus = 'Suelto' WHERE PalletId = ${palletId} AND Estatus = 'EnBodega'`;
      await tx.$executeRaw`UPDATE Pallets SET Estatus = 'Desarmado', PosicionId = NULL WHERE PalletId = ${palletId}`;
      await tx.$executeRaw`
        INSERT INTO MovimientosBodega (PalletId, Tipo, PosicionOrigenId, PosicionDestinoId, Usuario, Motivo)
        VALUES (${palletId}, 'DESARME', ${pallet.PosicionId == null ? null : Number(pallet.PosicionId)}, NULL, ${operador}, ${motivo})
      `;
      respuesta = { ok: true, PalletCodigo: pallet.Codigo, MastersLiberados: masters.length };
    }, { timeout: 30_000 });

    res.json(respuesta);
  } catch (err: any) {
    if (err instanceof ErrorNegocio) { res.status(err.status).json({ error: err.message }); return; }
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
