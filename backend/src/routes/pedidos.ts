import { Router, Request, Response } from "express";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm, requireAnyPerm } from "../middleware/auth.ts";

const router = Router();

// GET /api/pedidos?cliente=10&tipoCliente=Exportacion
// `remisiones.ver` se agregó a la lista porque el formulario de remisión de exportación se arma A
// PARTIR de un pedido: sin esto, un usuario que solo despacha no podría ni ver la lista para elegir.
router.get("/", requireAuth, requireAnyPerm([["pedidos", "ver"], ["etiquetado", "ver"], ["remisiones", "ver"]]), async (req: Request, res: Response) => {
  try {
    const condiciones: string[] = [];
    const params: any[] = [];
    if (req.query.cliente) { condiciones.push("p.CodigoCliente = ?"); params.push(Number(req.query.cliente)); }
    // Filtra por el tipo del CLIENTE del pedido (Local/Exportacion) — así el selector de una
    // remisión de exportación no ofrece pedidos de clientes locales, que el backend rechazaría igual.
    if (req.query.tipoCliente === "Local" || req.query.tipoCliente === "Exportacion") {
      condiciones.push("c.Tipo = ?"); params.push(req.query.tipoCliente);
    }
    const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT p.CodigoPedido, p.CodigoCliente, p.CodigoSubcliente, p.Descripcion, p.FechaInicio, p.Estatus, p.EsGeneral,
             c.RazonSocial AS NombreCliente, s.RazonSocial AS NombreSubcliente
      FROM Pedidos p
      JOIN Clientes c ON p.CodigoCliente = c.Codigo
      LEFT JOIN Subcliente s ON p.CodigoCliente = s.CodigoCliente AND p.CodigoSubcliente = s.CodigoSubcliente
      ${where} ORDER BY p.CodigoPedido DESC LIMIT 500
    `, ...params);
    res.json(rows.map(r => ({ ...r, CodigoCliente: Number(r.CodigoCliente), EsGeneral: Number(r.EsGeneral) === 1 })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pedidos  { CodigoPedido, CodigoCliente, CodigoSubcliente, Descripcion, FechaInicio }
router.post("/", requireAuth, requirePerm("pedidos", "crear"), async (req: Request, res: Response) => {
  try {
    const { CodigoPedido, CodigoCliente, CodigoSubcliente, Descripcion, FechaInicio, EsGeneral } = req.body;
    if (!CodigoPedido || !CodigoCliente || !Descripcion) {
      res.status(400).json({ error: "CodigoPedido, CodigoCliente y Descripcion son requeridos" });
      return;
    }
    await prisma.$executeRaw`
      INSERT INTO Pedidos (CodigoPedido, CodigoCliente, CodigoSubcliente, Descripcion, FechaInicio, EsGeneral)
      VALUES (${CodigoPedido}, ${Number(CodigoCliente)}, ${CodigoSubcliente || null}, ${Descripcion}, ${FechaInicio || null}, ${EsGeneral ? 1 : 0})
    `;
    res.status(201).json({ ok: true });
  } catch (err: any) {
    if (err.message?.includes("Duplicate")) res.status(400).json({ error: "Ese código de pedido ya existe" });
    else if (err.message?.includes("foreign key")) res.status(400).json({ error: "Cliente o subcliente no existen" });
    else res.status(500).json({ error: err.message });
  }
});

// PUT /api/pedidos/:codigo
router.put("/:codigo", requireAuth, requirePerm("pedidos", "editar"), async (req: Request, res: Response) => {
  try {
    const { Descripcion, FechaInicio, Estatus, EsGeneral } = req.body;

    const actuales: any[] = await prisma.$queryRaw`
      SELECT EsGeneral FROM Pedidos WHERE CodigoPedido = ${req.params.codigo} LIMIT 1
    `;
    if (!actuales.length) { res.status(404).json({ error: "Pedido no encontrado" }); return; }
    const esGeneralActual = Number(actuales[0].EsGeneral) === 1;
    const esGeneralNuevo = EsGeneral === undefined ? esGeneralActual : !!EsGeneral;

    // "Pedido general" se define al crear. Cambiarlo después reinterpretaría retroactivamente los
    // techos que ya se aplicaron a las capturas existentes: un pedido de cliente que pasa a general
    // perdería su límite, y uno general que pasa a cliente quedaría con techo 1 (el centinela de
    // CantidadCajas) y bloquearía todo lo ya declarado. Se permite corregir la casilla solo mientras
    // el pedido siga vacío — sin líneas no puede haber capturas (ver project_pedido_general_design).
    if (esGeneralNuevo !== esGeneralActual) {
      const lineas: any[] = await prisma.$queryRaw`
        SELECT COUNT(*) AS n FROM DetallePedido WHERE CodigoPedido = ${req.params.codigo}
      `;
      if (Number(lineas[0].n) > 0) {
        res.status(400).json({
          error: `No se puede cambiar "pedido general": este pedido ya tiene ${Number(lineas[0].n)} línea(s). Se define al crear el pedido.`,
        });
        return;
      }
    }

    await prisma.$executeRaw`
      UPDATE Pedidos SET Descripcion = ${Descripcion}, FechaInicio = ${FechaInicio || null},
        Estatus = ${Estatus || "Proceso"}, EsGeneral = ${esGeneralNuevo ? 1 : 0}
      WHERE CodigoPedido = ${req.params.codigo}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
