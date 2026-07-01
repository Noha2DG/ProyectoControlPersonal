import { Router, Request, Response } from "express";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";

const router = Router();

function formatear(rows: any[]) {
  return rows.map(r => ({
    ...r,
    CicloId: Number(r.CicloId),
    PiscinaId: Number(r.PiscinaId),
    Anio: Number(r.Anio),
    Ciclo: Number(r.Ciclo),
    Activo: Number(r.Activo) === 1,
  }));
}

// GET /api/ciclo?piscinaId=123
router.get("/", async (req: Request, res: Response) => {
  try {
    const piscinaId = req.query.piscinaId ? Number(req.query.piscinaId) : undefined;
    const rows: any[] = piscinaId
      ? await prisma.$queryRaw`
          SELECT CicloId, PiscinaId, Anio, Ciclo, Activo
          FROM Ciclo WHERE PiscinaId = ${piscinaId} ORDER BY Anio DESC, Ciclo DESC
        `
      : await prisma.$queryRaw`
          SELECT CicloId, PiscinaId, Anio, Ciclo, Activo
          FROM Ciclo ORDER BY Anio DESC, Ciclo DESC
        `;
    res.json(formatear(rows));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ciclo  { PiscinaId, Anio, Ciclo, FechaInicio, FechaCierre }
router.post("/", requireAuth, requirePerm("catalogos", "crear"), async (req: Request, res: Response) => {
  try {
    const { PiscinaId, Anio, Ciclo } = req.body;
    if (!PiscinaId || !Anio || !Ciclo) { res.status(400).json({ error: "PiscinaId, Anio y Ciclo son requeridos" }); return; }
    await prisma.$executeRaw`
      INSERT INTO Ciclo (PiscinaId, Anio, Ciclo)
      VALUES (${Number(PiscinaId)}, ${Number(Anio)}, ${Number(Ciclo)})
    `;
    res.status(201).json({ ok: true });
  } catch (err: any) {
    if (err.message?.includes("Duplicate")) res.status(400).json({ error: "Ese ciclo ya existe para esta piscina" });
    else if (err.message?.includes("foreign key")) res.status(400).json({ error: "La piscina no existe" });
    else res.status(500).json({ error: err.message });
  }
});

// PUT /api/ciclo/:id  { Activo }
router.put("/:id", requireAuth, requirePerm("catalogos", "editar"), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { Activo } = req.body;
    const activo = Activo === false || Activo === 0 ? 0 : 1;
    await prisma.$executeRaw`UPDATE Ciclo SET Activo = ${activo} WHERE CicloId = ${id}`;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/ciclo/:id → baja lógica
router.delete("/:id", requireAuth, requirePerm("catalogos", "eliminar"), async (req: Request, res: Response) => {
  try {
    await prisma.$executeRaw`UPDATE Ciclo SET Activo = 0 WHERE CicloId = ${Number(req.params.id)}`;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
