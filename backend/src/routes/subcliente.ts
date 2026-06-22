import { Router, Request, Response } from "express";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";

const router = Router();

function formatear(rows: any[]) {
  return rows.map(r => ({ ...r, CodigoCliente: Number(r.CodigoCliente), Activo: r.Estatus === "Activo" }));
}

// GET /api/subcliente?cliente=10  (público — lo usan pantallas de pedidos)
router.get("/", async (req: Request, res: Response) => {
  try {
    const cliente = req.query.cliente ? Number(req.query.cliente) : undefined;
    const rows: any[] = cliente
      ? await prisma.$queryRaw`SELECT CodigoCliente, CodigoSubcliente, RazonSocial, Estatus FROM Subcliente WHERE CodigoCliente = ${cliente} ORDER BY RazonSocial ASC`
      : await prisma.$queryRaw`SELECT CodigoCliente, CodigoSubcliente, RazonSocial, Estatus FROM Subcliente ORDER BY CodigoCliente ASC, RazonSocial ASC`;
    res.json(formatear(rows));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/subcliente  { CodigoCliente, CodigoSubcliente, RazonSocial }
router.post("/", requireAuth, requirePerm("catalogos", "crear"), async (req: Request, res: Response) => {
  try {
    const { CodigoCliente, CodigoSubcliente, RazonSocial } = req.body;
    if (!CodigoCliente || !CodigoSubcliente || !RazonSocial) {
      res.status(400).json({ error: "CodigoCliente, CodigoSubcliente y RazonSocial son requeridos" });
      return;
    }
    await prisma.$executeRaw`
      INSERT INTO Subcliente (CodigoCliente, CodigoSubcliente, RazonSocial) VALUES (${Number(CodigoCliente)}, ${CodigoSubcliente}, ${RazonSocial})
    `;
    res.status(201).json({ ok: true });
  } catch (err: any) {
    if (err.message?.includes("Duplicate")) res.status(400).json({ error: "Ese subcliente ya existe para este cliente" });
    else if (err.message?.includes("foreign key")) res.status(400).json({ error: "El cliente no existe" });
    else res.status(500).json({ error: err.message });
  }
});

// PUT /api/subcliente/:cliente/:sub
router.put("/:cliente/:sub", requireAuth, requirePerm("catalogos", "editar"), async (req: Request, res: Response) => {
  try {
    const { RazonSocial, Activo } = req.body;
    const estatus = Activo === false || Activo === 0 ? "Inactivo" : "Activo";
    await prisma.$executeRaw`
      UPDATE Subcliente SET RazonSocial = ${RazonSocial}, Estatus = ${estatus}
      WHERE CodigoCliente = ${Number(req.params.cliente)} AND CodigoSubcliente = ${req.params.sub}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/subcliente/:cliente/:sub → baja lógica
router.delete("/:cliente/:sub", requireAuth, requirePerm("catalogos", "eliminar"), async (req: Request, res: Response) => {
  try {
    await prisma.$executeRaw`
      UPDATE Subcliente SET Estatus = 'Inactivo' WHERE CodigoCliente = ${Number(req.params.cliente)} AND CodigoSubcliente = ${req.params.sub}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
