import { Router, Request, Response } from "express";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";

const router = Router();

function formatear(rows: any[]) {
  return rows.map(r => ({ ...r, Codigo: Number(r.Codigo), Activo: r.Estatus === "Activo" }));
}

// Local = se vende dentro del país · Exportacion = se embarca al exterior. Es del CLIENTE, no del
// pedido (ver alterClienteTipo.ts): lo usa el selector de la remisión para no ofrecer un cliente de
// exportación en una venta local, ni al revés.
const TIPOS_CLIENTE = ["Local", "Exportacion"];

function normalizarTipo(valor: any): string {
  const t = String(valor ?? "").trim();
  return TIPOS_CLIENTE.includes(t) ? t : "Local";
}

// GET /api/clientes?tipo=Local  (público — lo usan pantallas de pedidos)
router.get("/", async (req: Request, res: Response) => {
  try {
    const tipo = TIPOS_CLIENTE.includes(String(req.query.tipo ?? "")) ? String(req.query.tipo) : null;
    const rows: any[] = tipo
      ? await prisma.$queryRaw`
          SELECT Codigo, RazonSocial, Pais, Tipo, Estatus FROM Clientes WHERE Tipo = ${tipo} ORDER BY RazonSocial ASC`
      : await prisma.$queryRaw`
          SELECT Codigo, RazonSocial, Pais, Tipo, Estatus FROM Clientes ORDER BY RazonSocial ASC`;
    res.json(formatear(rows));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clientes
router.post("/", requireAuth, requirePerm("pedidos", "crear"), async (req: Request, res: Response) => {
  try {
    const { Codigo, RazonSocial, Pais } = req.body;
    if (!Codigo || !RazonSocial || !Pais) { res.status(400).json({ error: "Codigo, RazonSocial y Pais son requeridos" }); return; }
    await prisma.$executeRaw`
      INSERT INTO Clientes (Codigo, RazonSocial, Pais, Tipo)
      VALUES (${Number(Codigo)}, ${RazonSocial}, ${Pais}, ${normalizarTipo(req.body.Tipo)})
    `;
    res.status(201).json({ ok: true });
  } catch (err: any) {
    if (err.message?.includes("Duplicate")) res.status(400).json({ error: "Ese código de cliente ya existe" });
    else res.status(500).json({ error: err.message });
  }
});

// PUT /api/clientes/:codigo
router.put("/:codigo", requireAuth, requirePerm("pedidos", "editar"), async (req: Request, res: Response) => {
  try {
    const { RazonSocial, Pais, Activo } = req.body;
    const estatus = Activo === false || Activo === 0 ? "Inactivo" : "Activo";
    await prisma.$executeRaw`
      UPDATE Clientes SET RazonSocial = ${RazonSocial}, Pais = ${Pais}, Tipo = ${normalizarTipo(req.body.Tipo)}, Estatus = ${estatus}
      WHERE Codigo = ${Number(req.params.codigo)}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/clientes/:codigo → baja lógica
router.delete("/:codigo", requireAuth, requirePerm("pedidos", "eliminar"), async (req: Request, res: Response) => {
  try {
    await prisma.$executeRaw`UPDATE Clientes SET Estatus = 'Inactivo' WHERE Codigo = ${Number(req.params.codigo)}`;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
