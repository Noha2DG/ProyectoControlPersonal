import { Router, Request, Response } from "express";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";

const router = Router();

// GET /api/piscina?finca=E0001  (público — filtra por finca para drill-down)
router.get("/", async (req: Request, res: Response) => {
  try {
    const finca = req.query.finca as string | undefined;
    const rows: any[] = finca
      ? await prisma.$queryRaw`
          SELECT PiscinaId, CodigoFinca, Nombre, Activo FROM Piscina WHERE CodigoFinca = ${finca} ORDER BY Nombre ASC
        `
      : await prisma.$queryRaw`
          SELECT PiscinaId, CodigoFinca, Nombre, Activo FROM Piscina ORDER BY CodigoFinca ASC, Nombre ASC
        `;
    res.json(rows.map(r => ({ ...r, PiscinaId: Number(r.PiscinaId), Activo: Number(r.Activo) === 1 })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/piscina  { CodigoFinca, Nombre }
router.post("/", requireAuth, requirePerm("catalogos", "crear"), async (req: Request, res: Response) => {
  try {
    const { CodigoFinca, Nombre } = req.body;
    if (!CodigoFinca || !Nombre) { res.status(400).json({ error: "CodigoFinca y Nombre son requeridos" }); return; }
    await prisma.$executeRaw`INSERT INTO Piscina (CodigoFinca, Nombre) VALUES (${CodigoFinca}, ${Nombre})`;
    res.status(201).json({ ok: true });
  } catch (err: any) {
    if (err.message?.includes("Duplicate")) res.status(400).json({ error: "Esa piscina ya existe en esta finca" });
    else if (err.message?.includes("foreign key")) res.status(400).json({ error: "La finca no existe" });
    else res.status(500).json({ error: err.message });
  }
});

// PUT /api/piscina/:id
router.put("/:id", requireAuth, requirePerm("catalogos", "editar"), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { Nombre, Activo } = req.body;
    const activo = Activo === false || Activo === 0 ? 0 : 1;
    await prisma.$executeRaw`UPDATE Piscina SET Nombre = ${Nombre}, Activo = ${activo} WHERE PiscinaId = ${id}`;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/piscina/:id → baja lógica
router.delete("/:id", requireAuth, requirePerm("catalogos", "eliminar"), async (req: Request, res: Response) => {
  try {
    await prisma.$executeRaw`UPDATE Piscina SET Activo = 0 WHERE PiscinaId = ${Number(req.params.id)}`;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
