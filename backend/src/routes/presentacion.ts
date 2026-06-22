import { Router, Request, Response } from "express";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";

const router = Router();

function aNumero(rows: any[]) {
  return rows.map(r => ({
    ...r,
    PesoKG: Number(r.PesoKG),
    PesoLb: Number(r.PesoLb),
    CajasXMaster: Number(r.CajasXMaster),
    Activo: Number(r.Activo) === 1,
  }));
}

// GET /api/presentacion  (público — lo usan pantallas de captura y pedidos)
router.get("/", async (_req: Request, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT Codigo, Descripcion, Abreviatura, TipoMedida, PesoKG, PesoLb, CajasXMaster, Activo
      FROM Presentacion ORDER BY Descripcion ASC
    `;
    res.json(aNumero(rows));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/presentacion
router.post("/", requireAuth, requirePerm("catalogos", "crear"), async (req: Request, res: Response) => {
  try {
    const { Codigo, Descripcion, Abreviatura, TipoMedida, PesoKG, PesoLb, CajasXMaster } = req.body;
    if (!Codigo || !Descripcion || !Abreviatura || !TipoMedida || !PesoKG || !PesoLb || !CajasXMaster) {
      res.status(400).json({ error: "Todos los campos son requeridos" });
      return;
    }
    await prisma.$executeRaw`
      INSERT INTO Presentacion (Codigo, Descripcion, Abreviatura, TipoMedida, PesoKG, PesoLb, CajasXMaster)
      VALUES (${Codigo.toUpperCase()}, ${Descripcion}, ${Abreviatura}, ${TipoMedida}, ${Number(PesoKG)}, ${Number(PesoLb)}, ${Number(CajasXMaster)})
    `;
    res.status(201).json({ ok: true });
  } catch (err: any) {
    if (err.message?.includes("Duplicate")) res.status(400).json({ error: "Ese código ya existe" });
    else res.status(500).json({ error: err.message });
  }
});

// PUT /api/presentacion/:codigo
router.put("/:codigo", requireAuth, requirePerm("catalogos", "editar"), async (req: Request, res: Response) => {
  try {
    const { Descripcion, Abreviatura, TipoMedida, PesoKG, PesoLb, CajasXMaster, Activo } = req.body;
    const activo = Activo === false || Activo === 0 ? 0 : 1;
    await prisma.$executeRaw`
      UPDATE Presentacion SET Descripcion = ${Descripcion}, Abreviatura = ${Abreviatura}, TipoMedida = ${TipoMedida},
        PesoKG = ${Number(PesoKG)}, PesoLb = ${Number(PesoLb)}, CajasXMaster = ${Number(CajasXMaster)}, Activo = ${activo}
      WHERE Codigo = ${req.params.codigo}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/presentacion/:codigo → baja lógica
router.delete("/:codigo", requireAuth, requirePerm("catalogos", "eliminar"), async (req: Request, res: Response) => {
  try {
    await prisma.$executeRaw`UPDATE Presentacion SET Activo = 0 WHERE Codigo = ${req.params.codigo}`;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
