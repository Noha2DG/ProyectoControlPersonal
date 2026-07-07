import { Router, Request, Response } from "express";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm, requireAnyPerm } from "../middleware/auth.ts";

const router = Router();

// GET /api/pedidos?cliente=10
router.get("/", requireAuth, requireAnyPerm([["catalogos", "ver"], ["etiquetado", "ver"]]), async (req: Request, res: Response) => {
  try {
    const cliente = req.query.cliente ? Number(req.query.cliente) : undefined;
    const rows: any[] = cliente
      ? await prisma.$queryRaw`
          SELECT CodigoPedido, CodigoCliente, CodigoSubcliente, Descripcion, FechaInicio, Estatus
          FROM Pedidos WHERE CodigoCliente = ${cliente} ORDER BY CodigoPedido DESC
        `
      : await prisma.$queryRaw`
          SELECT CodigoPedido, CodigoCliente, CodigoSubcliente, Descripcion, FechaInicio, Estatus
          FROM Pedidos ORDER BY CodigoPedido DESC LIMIT 500
        `;
    res.json(rows.map(r => ({ ...r, CodigoCliente: Number(r.CodigoCliente) })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pedidos  { CodigoPedido, CodigoCliente, CodigoSubcliente, Descripcion, FechaInicio }
router.post("/", requireAuth, requirePerm("catalogos", "crear"), async (req: Request, res: Response) => {
  try {
    const { CodigoPedido, CodigoCliente, CodigoSubcliente, Descripcion, FechaInicio } = req.body;
    if (!CodigoPedido || !CodigoCliente || !Descripcion) {
      res.status(400).json({ error: "CodigoPedido, CodigoCliente y Descripcion son requeridos" });
      return;
    }
    await prisma.$executeRaw`
      INSERT INTO Pedidos (CodigoPedido, CodigoCliente, CodigoSubcliente, Descripcion, FechaInicio)
      VALUES (${CodigoPedido}, ${Number(CodigoCliente)}, ${CodigoSubcliente || null}, ${Descripcion}, ${FechaInicio || null})
    `;
    res.status(201).json({ ok: true });
  } catch (err: any) {
    if (err.message?.includes("Duplicate")) res.status(400).json({ error: "Ese código de pedido ya existe" });
    else if (err.message?.includes("foreign key")) res.status(400).json({ error: "Cliente o subcliente no existen" });
    else res.status(500).json({ error: err.message });
  }
});

// PUT /api/pedidos/:codigo
router.put("/:codigo", requireAuth, requirePerm("catalogos", "editar"), async (req: Request, res: Response) => {
  try {
    const { Descripcion, FechaInicio, Estatus } = req.body;
    await prisma.$executeRaw`
      UPDATE Pedidos SET Descripcion = ${Descripcion}, FechaInicio = ${FechaInicio || null}, Estatus = ${Estatus || "Proceso"}
      WHERE CodigoPedido = ${req.params.codigo}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
