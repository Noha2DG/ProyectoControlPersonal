import { Router, Request, Response } from "express";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";

const router = Router();

// GET /api/tipos-permiso
router.get("/", requireAuth, requirePerm("tipos_permiso", "ver"), async (_req: Request, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT codigoPermiso, descripcion, Activo FROM TipoPermiso ORDER BY descripcion ASC
    `;
    res.json(rows.map(r => ({ ...r, Activo: Number(r.Activo) === 1 })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tipos-permiso
router.post("/", requireAuth, requirePerm("tipos_permiso", "crear"), async (req: Request, res: Response) => {
  try {
    const { codigoPermiso, descripcion } = req.body;
    if (!codigoPermiso || !descripcion) { res.status(400).json({ error: "Código y descripción son requeridos" }); return; }
    await prisma.$executeRaw`
      INSERT INTO TipoPermiso (codigoPermiso, descripcion) VALUES (${codigoPermiso.toUpperCase()}, ${descripcion})
    `;
    res.status(201).json({ ok: true });
  } catch (err: any) {
    if (err.message?.includes("Duplicate")) {
      res.status(400).json({ error: "Ya existe un tipo de permiso con ese código" });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// PUT /api/tipos-permiso/:codigo
router.put("/:codigo", requireAuth, requirePerm("tipos_permiso", "editar"), async (req: Request, res: Response) => {
  try {
    const codigo = req.params.codigo;
    const { descripcion, Activo } = req.body;
    const activo = Activo === false || Activo === 0 ? 0 : 1;
    await prisma.$executeRaw`
      UPDATE TipoPermiso SET descripcion = ${descripcion}, Activo = ${activo}
      WHERE codigoPermiso = ${codigo}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tipos-permiso/:codigo → desactivar lógico
router.delete("/:codigo", requireAuth, requirePerm("tipos_permiso", "eliminar"), async (req: Request, res: Response) => {
  try {
    const codigo = req.params.codigo;
    await prisma.$executeRaw`UPDATE TipoPermiso SET Activo = 0 WHERE codigoPermiso = ${codigo}`;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
