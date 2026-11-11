import { Router, Response } from "express";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm, AuthRequest } from "../middleware/auth.ts";

// Liberar materia prima: lista de contenedores importados bajo control y la decisión de liberarlos o
// rechazarlos, siempre el contenedor COMPLETO (ver lib/liberacionMP.ts y
// scripts/createLiberacionMateriaPrima.ts). El permiso es `liberar_mp`: lo hace quien lo tenga, no
// una persona fija.
const router = Router();

const operador = (req: AuthRequest) => req.user?.nombre ?? req.user?.username ?? "Sistema";

// GET /api/liberacion-mp — los contenedores bajo control, primero los pendientes, con lo que tienen
// en bodega y lo que salió como muestra para análisis.
router.get("/", requireAuth, requirePerm("liberar_mp", "ver"), async (_req: AuthRequest, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT l.PiscinaId, pi.Nombre AS Contenedor, l.Estado,
             DATE_FORMAT(l.CreadoEn, '%Y-%m-%d %H:%i') AS CreadoEn, l.CreadoPor,
             l.ResueltoPor, DATE_FORMAT(l.ResueltoEn, '%Y-%m-%d %H:%i') AS ResueltoEn, l.Observacion,
             COALESCE(b.EnBodega, 0) AS EnBodega, COALESCE(b.KgEnBodega, 0) AS KgEnBodega,
             COALESCE(b.Salidos, 0) AS Salidos, COALESCE(mu.Muestras, 0) AS Muestras,
             b.PrimerIngreso, b.Lotes
        FROM LiberacionMateriaPrima l
        JOIN Piscina pi ON pi.PiscinaId = l.PiscinaId
        LEFT JOIN (
          SELECT oe.PiscinaId,
                 SUM(m.Estatus <> 'Salido') AS EnBodega,
                 SUM(CASE WHEN m.Estatus <> 'Salido' THEN pr.PesoKG * pr.CajasXMaster ELSE 0 END) AS KgEnBodega,
                 SUM(m.Estatus = 'Salido') AS Salidos,
                 DATE_FORMAT(MIN(m.FechaIngreso), '%Y-%m-%d %H:%i') AS PrimerIngreso,
                 GROUP_CONCAT(DISTINCT oe.Lote ORDER BY oe.Lote SEPARATOR ', ') AS Lotes
            FROM Masters m
            JOIN EtiquetaImpresa ei ON ei.EtiquetaId = m.EtiquetaId
            JOIN OrdenEtiquetado oe ON oe.OrdenId = ei.OrdenId
            JOIN DetallePedido dp ON dp.DetalleId = oe.DetalleId
            JOIN Presentacion pr ON pr.Codigo = dp.Presentacion
           WHERE oe.PiscinaId IN (SELECT PiscinaId FROM LiberacionMateriaPrima)
           GROUP BY oe.PiscinaId
        ) b ON b.PiscinaId = l.PiscinaId
        LEFT JOIN (
          SELECT oe.PiscinaId, COUNT(*) AS Muestras
            FROM RemisionDetalle rd
            JOIN Remisiones r ON r.RemisionId = rd.RemisionId
            JOIN SerieRemision se ON se.Tipo = r.Tipo AND se.Destino = 'Muestra'
            JOIN Masters m ON m.MasterId = rd.MasterId
            JOIN EtiquetaImpresa ei ON ei.EtiquetaId = m.EtiquetaId
            JOIN OrdenEtiquetado oe ON oe.OrdenId = ei.OrdenId
           WHERE rd.Vigente = 1 AND r.Estatus <> 'Anulada'
           GROUP BY oe.PiscinaId
        ) mu ON mu.PiscinaId = l.PiscinaId
       ORDER BY l.Estado = 'PENDIENTE' DESC, l.CreadoEn DESC`);
    res.json(rows.map(r => ({
      ...r,
      PiscinaId: Number(r.PiscinaId),
      EnBodega: Number(r.EnBodega), KgEnBodega: Number(r.KgEnBodega),
      Salidos: Number(r.Salidos), Muestras: Number(r.Muestras),
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/liberacion-mp/:piscinaId/liberar   { Observacion? }
// POST /api/liberacion-mp/:piscinaId/rechazar  { Observacion }  (el motivo es obligatorio)
// Liberar vale desde Pendiente o Rechazado (quien decide puede cambiar de opinión después de otro
// análisis); rechazar solo desde Pendiente. Liberado es definitivo: el producto ya pudo salir.
async function resolver(req: AuthRequest, res: Response, estado: "LIBERADO" | "RECHAZADO") {
  try {
    const piscinaId = Number(req.params.piscinaId);
    const observacion = String(req.body?.Observacion ?? "").trim().slice(0, 500);
    if (estado === "RECHAZADO" && !observacion) { res.status(400).json({ error: "Escriba el motivo del rechazo" }); return; }
    const desde = estado === "LIBERADO" ? ["PENDIENTE", "RECHAZADO"] : ["PENDIENTE"];

    const rows: any[] = await prisma.$queryRaw`
      SELECT l.Estado, pi.Nombre FROM LiberacionMateriaPrima l JOIN Piscina pi ON pi.PiscinaId = l.PiscinaId
       WHERE l.PiscinaId = ${piscinaId} LIMIT 1`;
    if (!rows.length) { res.status(404).json({ error: "Ese contenedor no está bajo control de liberación" }); return; }
    if (!desde.includes(String(rows[0].Estado))) {
      res.status(400).json({ error: `El contenedor ${rows[0].Nombre} ya está ${String(rows[0].Estado).toLowerCase()}` }); return;
    }

    // El UPDATE repite la condición de estado: si dos personas resuelven a la vez, solo una gana.
    const n = Number(await prisma.$executeRawUnsafe(`
      UPDATE LiberacionMateriaPrima SET Estado = ?, ResueltoPor = ?, ResueltoEn = NOW(), Observacion = ?
       WHERE PiscinaId = ? AND Estado IN (${desde.map(() => "?").join(",")})`,
      estado, operador(req), observacion || null, piscinaId, ...desde));
    if (!n) { res.status(409).json({ error: "Otra persona acaba de resolver este contenedor. Recargue la página." }); return; }
    res.json({ ok: true, Contenedor: rows[0].Nombre, Estado: estado });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

// Sin ruta de rechazar (usuario, 11 nov 2026: se quitó el botón). Lo que no se libera sigue pendiente;
// el estado RECHAZADO y resolver(…, "RECHAZADO") quedan por si se vuelve a pedir.
router.post("/:piscinaId/liberar", requireAuth, requirePerm("liberar_mp", "liberar"), (req: AuthRequest, res: Response) => resolver(req, res, "LIBERADO"));

export default router;
