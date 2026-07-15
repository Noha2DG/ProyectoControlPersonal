import { Router, Request, Response } from "express";
import prisma from "../lib/prisma.ts";

const router = Router();

// GET /api/bodega-virtual — catálogo de bodegas virtuales por área (Túnel, Masterizado, Reempaque...),
// usado para el selector al crear un Pallet. Solo lectura por ahora (sin CRUD admin todavía) — igual
// que Origen/UnidadesCongelacion, sin auth: es un catálogo chico, no expone nada sensible.
router.get("/", async (_req: Request, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT Codigo, Nombre, Letra, AreaCodigo, Activo FROM BodegaVirtual ORDER BY Nombre
    `;
    res.json(rows.map(r => ({ ...r, Activo: Number(r.Activo) === 1 })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
