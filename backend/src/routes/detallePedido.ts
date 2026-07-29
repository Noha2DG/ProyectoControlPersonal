import { Router, Request, Response } from "express";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm, requireAnyPerm } from "../middleware/auth.ts";

const router = Router();

function formatear(rows: any[]) {
  return rows.map(r => ({
    ...r,
    DetalleId: Number(r.DetalleId),
    Proceso: Number(r.Proceso),
    Talla: Number(r.Talla),
    CantidadCajas: Number(r.CantidadCajas),
    KgPedido: Number(r.KgPedido),
    LibrasPedido: Number(r.LibrasPedido),
  }));
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

// Resuelve de un tiro los tres datos que la línea necesita del catálogo: si el pedido es general, el
// Proceso que corresponde a la Clase (denormalizado en la tabla porque la regla de unicidad es sobre
// Proceso y no sobre Clase — ver alterPedidoGeneral.ts), y el peso de la presentación. Devuelve null
// si alguno de los tres no existe, lo que se traduce en un 400 en vez de reventar contra la FK.
async function obtenerContextoLinea(codigoPedido: string, clase: string, presentacion: string) {
  const rows: any[] = await prisma.$queryRaw`
    SELECT ped.EsGeneral, cl.Proceso, pr.PesoKG, pr.PesoLb
    FROM Pedidos ped
    JOIN Clase cl ON cl.Clase = ${clase}
    JOIN Presentacion pr ON pr.Codigo = ${presentacion}
    WHERE ped.CodigoPedido = ${codigoPedido} LIMIT 1
  `;
  if (!rows.length) return null;
  return {
    EsGeneral: Number(rows[0].EsGeneral) === 1,
    Proceso: Number(rows[0].Proceso),
    PesoKG: Number(rows[0].PesoKG),
    PesoLb: Number(rows[0].PesoLb),
  };
}

// En un pedido general las cantidades no se planifican: la línea se programa con 1 caja de centinela
// y el peso sale de la presentación. Se fuerza en el backend (no solo en la UI) para que el centinela
// quede uniforme aunque alguien llame la API directo — con el Objetivo desactivado por EsGeneral, un
// número distinto ahí no sería un techo real, solo un dato engañoso en pantalla y en reportes.
function resolverCantidades(esGeneral: boolean, ctx: { PesoKG: number; PesoLb: number },
                            body: { CantidadCajas?: any; KgPedido?: any; LibrasPedido?: any }) {
  if (esGeneral) return { cajas: 1, kg: round3(ctx.PesoKG), lb: round3(ctx.PesoLb) };
  return { cajas: Number(body.CantidadCajas), kg: Number(body.KgPedido), lb: Number(body.LibrasPedido) };
}

function errorLinea(err: any, res: Response) {
  if (err.message?.includes("uq_detalle_producto")) {
    res.status(400).json({ error: "Ya existe una línea con ese proceso, talla y presentación en este pedido — esa combinación no se puede repetir." });
  } else if (err.message?.includes("foreign key")) {
    res.status(400).json({ error: "Pedido, clase, talla, presentación o empaque no existen" });
  } else {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/detalle-pedido?pedido=2025004
router.get("/", requireAuth, requireAnyPerm([["catalogos", "ver"], ["etiquetado", "ver"]]), async (req: Request, res: Response) => {
  try {
    const pedido = req.query.pedido as string | undefined;
    // El tope de 2000 en la rama por pedido es una red de seguridad, no paginación: un pedido general
    // es perpetuo y va sumando una línea por cada proceso+talla+presentación que aparezca. Se deja
    // holgado a propósito porque truncar líneas aquí dejaría al operador sin poder capturar contra una
    // que sí existe (a diferencia de las capturas, donde ver las últimas alcanza).
    const rows: any[] = pedido
      ? await prisma.$queryRaw`
          SELECT DetalleId, CodigoPedido, Clase, Proceso, Talla, Presentacion, EmpaqueMaster, EmpaqueAccesorio, CantidadCajas, KgPedido, LibrasPedido
          FROM DetallePedido WHERE CodigoPedido = ${pedido} ORDER BY DetalleId ASC LIMIT 2000
        `
      : await prisma.$queryRaw`
          SELECT DetalleId, CodigoPedido, Clase, Proceso, Talla, Presentacion, EmpaqueMaster, EmpaqueAccesorio, CantidadCajas, KgPedido, LibrasPedido
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
    if (!CodigoPedido || !Clase || !Talla || !Presentacion || !EmpaqueMaster) {
      res.status(400).json({ error: "Faltan campos requeridos" });
      return;
    }

    const ctx = await obtenerContextoLinea(CodigoPedido, Clase, Presentacion);
    if (!ctx) { res.status(400).json({ error: "Pedido, clase o presentación no existen" }); return; }

    // Las cantidades solo se exigen en pedidos de cliente; en los generales se ignoran y se fuerza
    // el centinela de 1 caja.
    if (!ctx.EsGeneral && (!CantidadCajas || !KgPedido || !LibrasPedido)) {
      res.status(400).json({ error: "Cajas, Kg y Lb son requeridos" });
      return;
    }
    const { cajas, kg, lb } = resolverCantidades(ctx.EsGeneral, ctx, { CantidadCajas, KgPedido, LibrasPedido });

    await prisma.$executeRaw`
      INSERT INTO DetallePedido (CodigoPedido, Clase, Proceso, Talla, Presentacion, EmpaqueMaster, EmpaqueAccesorio, CantidadCajas, KgPedido, LibrasPedido)
      VALUES (${CodigoPedido}, ${Clase}, ${ctx.Proceso}, ${Number(Talla)}, ${Presentacion}, ${EmpaqueMaster}, ${EmpaqueAccesorio || null}, ${cajas}, ${kg}, ${lb})
    `;
    res.status(201).json({ ok: true });
  } catch (err: any) {
    errorLinea(err, res);
  }
});

// PUT /api/detalle-pedido/:id
router.put("/:id", requireAuth, requirePerm("catalogos", "editar"), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { Clase, Talla, Presentacion, EmpaqueMaster, EmpaqueAccesorio, CantidadCajas, KgPedido, LibrasPedido } = req.body;
    if (!Clase || !Talla || !Presentacion || !EmpaqueMaster) {
      res.status(400).json({ error: "Faltan campos requeridos" });
      return;
    }

    // El pedido de la línea no viaja en el body: se lee de la fila, que es la única fuente confiable
    // (y es lo que determina si aplica el centinela de 1 caja).
    const actuales: any[] = await prisma.$queryRaw`
      SELECT CodigoPedido FROM DetallePedido WHERE DetalleId = ${id} LIMIT 1
    `;
    if (!actuales.length) { res.status(404).json({ error: "Línea de pedido no encontrada" }); return; }

    const ctx = await obtenerContextoLinea(String(actuales[0].CodigoPedido), Clase, Presentacion);
    if (!ctx) { res.status(400).json({ error: "Clase o presentación no existen" }); return; }

    if (!ctx.EsGeneral && (!CantidadCajas || !KgPedido || !LibrasPedido)) {
      res.status(400).json({ error: "Cajas, Kg y Lb son requeridos" });
      return;
    }
    const { cajas, kg, lb } = resolverCantidades(ctx.EsGeneral, ctx, { CantidadCajas, KgPedido, LibrasPedido });

    // Proceso se recalcula desde la Clase en cada edición: si se cambia la Clase, el denormalizado
    // tiene que seguirla o el UNIQUE dejaría de reflejar la realidad.
    await prisma.$executeRaw`
      UPDATE DetallePedido SET Clase = ${Clase}, Proceso = ${ctx.Proceso}, Talla = ${Number(Talla)}, Presentacion = ${Presentacion},
        EmpaqueMaster = ${EmpaqueMaster}, EmpaqueAccesorio = ${EmpaqueAccesorio || null},
        CantidadCajas = ${cajas}, KgPedido = ${kg}, LibrasPedido = ${lb}
      WHERE DetalleId = ${id}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    errorLinea(err, res);
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
