import { Router, Request, Response } from "express";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";

const router = Router();

function formatear(rows: any[]) {
  return rows.map(r => ({
    ...r,
    TermoId: Number(r.TermoId),
    TransaccionId: Number(r.TransaccionId),
    Capacidad: r.Capacidad != null ? Number(r.Capacidad) : null,
    PesoAcumulado: Number(r.PesoAcumulado),
    KgTermo: Number(r.KgTermo),
    EnTratamiento: r.TratamientoHora ? { Hora: r.TratamientoHora, HojaId: r.TratamientoHoja == null ? null : Number(r.TratamientoHoja) } : null,
  }));
}

// GET /api/termos?transaccion=ID
// EnTratamiento: si Tratamiento ya se llevó el termo (lib/tratamiento.ts, tomarTermoDePelado), la hora y
// la hoja. Queda cerrado para Pelado y la pantalla de pesaje lo avisa.
// Los termos se crean automáticamente al registrar el primer pesaje con un NumeroTermo nuevo (ver /api/pesaje).
router.get("/", requireAuth, requirePerm("destajo", "ver"), async (req: Request, res: Response) => {
  try {
    const transaccionId = req.query.transaccion ? Number(req.query.transaccion) : undefined;
    if (!transaccionId) { res.status(400).json({ error: "transaccion es requerido" }); return; }
    const rows: any[] = await prisma.$queryRaw`
      SELECT t.TermoId, t.TransaccionId, t.NumeroTermo, t.Capacidad, t.AlmacenActual, t.FechaCreacion,
             COALESCE((
               SELECT SUM(pd2.Peso)
               FROM PesajeDetalle pd2
               JOIN Termos t2 ON pd2.TermoId = t2.TermoId
               WHERE t2.NumeroTermo = t.NumeroTermo
                 AND DATE(pd2.FechaHora) = CURDATE()
             ), 0) AS PesoAcumulado,
             COALESCE((SELECT SUM(pd3.Peso) FROM PesajeDetalle pd3 WHERE pd3.TermoId = t.TermoId), 0) AS KgTermo,
             (SELECT DATE_FORMAT(p.FechaHora, '%H:%i') FROM MovimientoPiso p
               WHERE p.Tipo = 'PROCESADO' AND p.TransaccionId = t.TransaccionId AND p.NumeroTermo = t.NumeroTermo LIMIT 1) AS TratamientoHora,
             (SELECT c.HojaDestinoId FROM MovimientoPiso c
               WHERE c.Tipo = 'CONSUMO' AND c.TransaccionId = t.TransaccionId AND c.NumeroTermo = t.NumeroTermo LIMIT 1) AS TratamientoHoja
      FROM Termos t
      WHERE t.TransaccionId = ${transaccionId}
      ORDER BY t.NumeroTermo ASC
    `;
    res.json(formatear(rows));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/termos/:id  { Capacidad }  — define o corrige la capacidad máxima de ese termo (ej. en lb o kg, según UM del lote)
router.put("/:id", requireAuth, requirePerm("destajo", "editar"), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { Capacidad } = req.body;
    await prisma.$executeRaw`UPDATE Termos SET Capacidad = ${Capacidad === "" || Capacidad == null ? null : Number(Capacidad)} WHERE TermoId = ${id}`;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
