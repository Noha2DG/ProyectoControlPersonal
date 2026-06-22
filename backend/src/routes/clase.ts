import { Router, Request, Response } from "express";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";

const router = Router();

// GET /api/clase  (público — lo usan pantallas de captura para llenar combos)
router.get("/", async (_req: Request, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT Clase, Familia, Proceso, Descripcion, TipoClase, Activo FROM Clase ORDER BY Descripcion ASC
    `;
    res.json(rows.map(r => ({ ...r, Proceso: Number(r.Proceso), Activo: Number(r.Activo) === 1 })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clase
router.post("/", requireAuth, requirePerm("catalogos", "crear"), async (req: Request, res: Response) => {
  try {
    const { Clase, Familia, Proceso, Descripcion, TipoClase } = req.body;
    if (!Clase || !Familia || !Proceso || !Descripcion) {
      res.status(400).json({ error: "Clase, Familia, Proceso y Descripcion son requeridos" });
      return;
    }
    await prisma.$executeRaw`
      INSERT INTO Clase (Clase, Familia, Proceso, Descripcion, TipoClase)
      VALUES (${Clase.toUpperCase()}, ${Familia.toUpperCase()}, ${Number(Proceso)}, ${Descripcion}, ${TipoClase || "PRODUCTO FINAL"})
    `;
    res.status(201).json({ ok: true });
  } catch (err: any) {
    if (err.message?.includes("Duplicate")) res.status(400).json({ error: "Esa clase ya existe" });
    else if (err.message?.includes("foreign key")) res.status(400).json({ error: "Familia o Proceso no existen en sus catálogos" });
    else res.status(500).json({ error: err.message });
  }
});

// PUT /api/clase/:clase
router.put("/:clase", requireAuth, requirePerm("catalogos", "editar"), async (req: Request, res: Response) => {
  try {
    const clase = req.params.clase;
    const { Familia, Proceso, Descripcion, TipoClase, Activo } = req.body;
    const activo = Activo === false || Activo === 0 ? 0 : 1;
    await prisma.$executeRaw`
      UPDATE Clase SET Familia = ${Familia}, Proceso = ${Number(Proceso)}, Descripcion = ${Descripcion},
        TipoClase = ${TipoClase || "PRODUCTO FINAL"}, Activo = ${activo}
      WHERE Clase = ${clase}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    if (err.message?.includes("foreign key")) res.status(400).json({ error: "Familia o Proceso no existen en sus catálogos" });
    else res.status(500).json({ error: err.message });
  }
});

// DELETE /api/clase/:clase → baja lógica
router.delete("/:clase", requireAuth, requirePerm("catalogos", "eliminar"), async (req: Request, res: Response) => {
  try {
    await prisma.$executeRaw`UPDATE Clase SET Activo = 0 WHERE Clase = ${req.params.clase}`;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
