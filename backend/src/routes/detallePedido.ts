import { Router, Request, Response } from "express";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm, requireAnyPerm } from "../middleware/auth.ts";

const router = Router();

function formatear(rows: any[]) {
  return rows.map(r => ({
    ...r,
    DetalleId: Number(r.DetalleId),
    Talla: Number(r.Talla),
    CantidadCajas: Number(r.CantidadCajas),
    KgPedido: Number(r.KgPedido),
    LibrasPedido: Number(r.LibrasPedido),
  }));
}

// GET /api/detalle-pedido?pedido=2025004
router.get("/", requireAuth, requireAnyPerm([["catalogos", "ver"], ["etiquetado", "ver"]]), async (req: Request, res: Response) => {
  try {
    const pedido = req.query.pedido as string | undefined;
    const rows: any[] = pedido
      ? await prisma.$queryRaw`
          SELECT DetalleId, CodigoPedido, Clase, Talla, Presentacion, EmpaqueMaster, EmpaqueAccesorio, CantidadCajas, KgPedido, LibrasPedido
          FROM DetallePedido WHERE CodigoPedido = ${pedido} ORDER BY DetalleId ASC
        `
      : await prisma.$queryRaw`
          SELECT DetalleId, CodigoPedido, Clase, Talla, Presentacion, EmpaqueMaster, EmpaqueAccesorio, CantidadCajas, KgPedido, LibrasPedido
          FROM DetallePedido ORDER BY DetalleId DESC LIMIT 500
        `;
    res.json(formatear(rows));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/detalle-pedido
router.post("/", requireAuth, requirePerm("catalogos", "crear"), async (req: Request, res: Response) => {
  try {
    const { CodigoPedido, Clase, Talla, Presentacion, EmpaqueMaster, EmpaqueAccesorio, CantidadCajas, KgPedido, LibrasPedido } = req.body;
    if (!CodigoPedido || !Clase || !Talla || !Presentacion || !EmpaqueMaster || !CantidadCajas || !KgPedido || !LibrasPedido) {
      res.status(400).json({ error: "Faltan campos requeridos" });
      return;
    }
    await prisma.$executeRaw`
      INSERT INTO DetallePedido (CodigoPedido, Clase, Talla, Presentacion, EmpaqueMaster, EmpaqueAccesorio, CantidadCajas, KgPedido, LibrasPedido)
      VALUES (${CodigoPedido}, ${Clase}, ${Number(Talla)}, ${Presentacion}, ${EmpaqueMaster}, ${EmpaqueAccesorio || null}, ${Number(CantidadCajas)}, ${Number(KgPedido)}, ${Number(LibrasPedido)})
    `;
    res.status(201).json({ ok: true });
  } catch (err: any) {
    if (err.message?.includes("foreign key")) res.status(400).json({ error: "Pedido, clase, talla, presentación o empaque no existen" });
    else res.status(500).json({ error: err.message });
  }
});

// PUT /api/detalle-pedido/:id
router.put("/:id", requireAuth, requirePerm("catalogos", "editar"), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { Clase, Talla, Presentacion, EmpaqueMaster, EmpaqueAccesorio, CantidadCajas, KgPedido, LibrasPedido } = req.body;
    await prisma.$executeRaw`
      UPDATE DetallePedido SET Clase = ${Clase}, Talla = ${Number(Talla)}, Presentacion = ${Presentacion},
        EmpaqueMaster = ${EmpaqueMaster}, EmpaqueAccesorio = ${EmpaqueAccesorio || null},
        CantidadCajas = ${Number(CantidadCajas)}, KgPedido = ${Number(KgPedido)}, LibrasPedido = ${Number(LibrasPedido)}
      WHERE DetalleId = ${id}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    if (err.message?.includes("foreign key")) res.status(400).json({ error: "Clase, talla, presentación o empaque no existen" });
    else res.status(500).json({ error: err.message });
  }
});

// DELETE /api/detalle-pedido/:id  (elimina la línea, igual que correcciones de captura)
router.delete("/:id", requireAuth, requirePerm("catalogos", "eliminar"), async (req: Request, res: Response) => {
  try {
    await prisma.$executeRaw`DELETE FROM DetallePedido WHERE DetalleId = ${Number(req.params.id)}`;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
