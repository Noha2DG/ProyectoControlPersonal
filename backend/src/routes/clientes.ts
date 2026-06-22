import { Router, Request, Response } from "express";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";

const router = Router();

function formatear(rows: any[]) {
  return rows.map(r => ({ ...r, Codigo: Number(r.Codigo), Activo: r.Estatus === "Activo" }));
}

// GET /api/clientes  (público — lo usan pantallas de pedidos)
router.get("/", async (_req: Request, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT Codigo, RazonSocial, Pais, Estatus FROM Clientes ORDER BY RazonSocial ASC
    `;
    res.json(formatear(rows));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clientes
router.post("/", requireAuth, requirePerm("catalogos", "crear"), async (req: Request, res: Response) => {
  try {
    const { Codigo, RazonSocial, Pais } = req.body;
    if (!Codigo || !RazonSocial || !Pais) { res.status(400).json({ error: "Codigo, RazonSocial y Pais son requeridos" }); return; }
    await prisma.$executeRaw`INSERT INTO Clientes (Codigo, RazonSocial, Pais) VALUES (${Number(Codigo)}, ${RazonSocial}, ${Pais})`;
    res.status(201).json({ ok: true });
  } catch (err: any) {
    if (err.message?.includes("Duplicate")) res.status(400).json({ error: "Ese código de cliente ya existe" });
    else res.status(500).json({ error: err.message });
  }
});

// PUT /api/clientes/:codigo
router.put("/:codigo", requireAuth, requirePerm("catalogos", "editar"), async (req: Request, res: Response) => {
  try {
    const { RazonSocial, Pais, Activo } = req.body;
    const estatus = Activo === false || Activo === 0 ? "Inactivo" : "Activo";
    await prisma.$executeRaw`
      UPDATE Clientes SET RazonSocial = ${RazonSocial}, Pais = ${Pais}, Estatus = ${estatus} WHERE Codigo = ${Number(req.params.codigo)}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/clientes/:codigo → baja lógica
router.delete("/:codigo", requireAuth, requirePerm("catalogos", "eliminar"), async (req: Request, res: Response) => {
  try {
    await prisma.$executeRaw`UPDATE Clientes SET Estatus = 'Inactivo' WHERE Codigo = ${Number(req.params.codigo)}`;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
