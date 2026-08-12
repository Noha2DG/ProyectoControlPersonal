import { Router, Request, Response } from "express";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm, requireAnyPerm, AuthRequest } from "../middleware/auth.ts";

const router = Router();

// requireAuth ya validó el token y dejó el payload en req.user, así que no hace falta volver a
// verificarlo. Se prefiere el nombre sobre el usuario porque el historial se lee como bitácora.
const operadorDe = (req: AuthRequest) => req.user?.nombre ?? req.user?.username ?? "Sistema";

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

// Deja constancia del estado de la línea DESPUÉS del cambio (foto completa, no delta). La proforma
// se modifica seguido, y sin este rastro no hay forma de saber qué decía el día que se despachó
// —ver crearHistorialDetallePedido.ts—. Nunca debe tumbar la operación: si el historial falla, el
// cambio de la línea ya ocurrió y bloquearlo dejaría al usuario sin poder capturar. Se registra el
// fallo y se sigue.
async function registrarHistorial(
  client: any,
  datos: {
    DetalleId: number; CodigoPedido: string; Accion: "Alta" | "Cambio" | "Baja";
    Clase: string; Proceso: number; Talla: number; Presentacion: string;
    EmpaqueMaster: string; EmpaqueAccesorio: string | null;
    CantidadCajas: number; KgPedido: number; LibrasPedido: number;
  },
  usuario?: string,
) {
  try {
    await client.$executeRaw`
      INSERT INTO DetallePedidoHistorial
        (DetalleId, CodigoPedido, Accion, Clase, Proceso, Talla, Presentacion,
         EmpaqueMaster, EmpaqueAccesorio, CantidadCajas, KgPedido, LibrasPedido, RegistradoPor)
      VALUES (${datos.DetalleId}, ${datos.CodigoPedido}, ${datos.Accion}, ${datos.Clase}, ${datos.Proceso},
              ${datos.Talla}, ${datos.Presentacion}, ${datos.EmpaqueMaster}, ${datos.EmpaqueAccesorio},
              ${datos.CantidadCajas}, ${datos.KgPedido}, ${datos.LibrasPedido}, ${usuario || null})
    `;
  } catch (err: any) {
    console.error("No se pudo registrar el historial de la línea de pedido:", err.message);
  }
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
router.get("/", requireAuth, requireAnyPerm([["pedidos", "ver"], ["etiquetado", "ver"]]), async (req: Request, res: Response) => {
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
router.post("/", requireAuth, requirePerm("pedidos", "crear"), async (req: AuthRequest, res: Response) => {
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

    // El INSERT y la lectura del id van en la misma transacción: LAST_INSERT_ID() es por conexión, y
    // fuera de la transacción el pool podría devolver otra y traer el id de un insert ajeno.
    const detalleId = await prisma.$transaction(async tx => {
      await tx.$executeRaw`
        INSERT INTO DetallePedido (CodigoPedido, Clase, Proceso, Talla, Presentacion, EmpaqueMaster, EmpaqueAccesorio, CantidadCajas, KgPedido, LibrasPedido)
        VALUES (${CodigoPedido}, ${Clase}, ${ctx.Proceso}, ${Number(Talla)}, ${Presentacion}, ${EmpaqueMaster}, ${EmpaqueAccesorio || null}, ${cajas}, ${kg}, ${lb})
      `;
      const filas: any[] = await tx.$queryRaw`SELECT LAST_INSERT_ID() AS id`;
      return Number(filas[0].id);
    }, { timeout: 30_000 });

    await registrarHistorial(prisma, {
      DetalleId: detalleId, CodigoPedido: String(CodigoPedido), Accion: "Alta",
      Clase, Proceso: ctx.Proceso, Talla: Number(Talla), Presentacion,
      EmpaqueMaster, EmpaqueAccesorio: EmpaqueAccesorio || null,
      CantidadCajas: cajas, KgPedido: kg, LibrasPedido: lb,
    }, operadorDe(req));

    res.status(201).json({ ok: true, DetalleId: detalleId });
  } catch (err: any) {
    errorLinea(err, res);
  }
});

// PUT /api/detalle-pedido/:id
router.put("/:id", requireAuth, requirePerm("pedidos", "editar"), async (req: AuthRequest, res: Response) => {
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

    await registrarHistorial(prisma, {
      DetalleId: id, CodigoPedido: String(actuales[0].CodigoPedido), Accion: "Cambio",
      Clase, Proceso: ctx.Proceso, Talla: Number(Talla), Presentacion,
      EmpaqueMaster, EmpaqueAccesorio: EmpaqueAccesorio || null,
      CantidadCajas: cajas, KgPedido: kg, LibrasPedido: lb,
    }, operadorDe(req));

    res.json({ ok: true });
  } catch (err: any) {
    errorLinea(err, res);
  }
});

// DELETE /api/detalle-pedido/:id  (elimina la línea, igual que correcciones de captura)
router.delete("/:id", requireAuth, requirePerm("pedidos", "eliminar"), async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    // Se lee ANTES de borrar: el historial guarda el último estado conocido, que es justo lo que
    // hace falta si más adelante aparece producto despachado contra una línea que ya no existe.
    const previas: any[] = await prisma.$queryRaw`
      SELECT CodigoPedido, Clase, Proceso, Talla, Presentacion, EmpaqueMaster, EmpaqueAccesorio,
             CantidadCajas, KgPedido, LibrasPedido
      FROM DetallePedido WHERE DetalleId = ${id} LIMIT 1
    `;
    if (!previas.length) { res.status(404).json({ error: "Línea de pedido no encontrada" }); return; }
    const p = previas[0];

    await prisma.$executeRaw`DELETE FROM DetallePedido WHERE DetalleId = ${id}`;

    await registrarHistorial(prisma, {
      DetalleId: id, CodigoPedido: String(p.CodigoPedido), Accion: "Baja",
      Clase: String(p.Clase), Proceso: Number(p.Proceso), Talla: Number(p.Talla),
      Presentacion: String(p.Presentacion), EmpaqueMaster: String(p.EmpaqueMaster),
      EmpaqueAccesorio: p.EmpaqueAccesorio ?? null, CantidadCajas: Number(p.CantidadCajas),
      KgPedido: Number(p.KgPedido), LibrasPedido: Number(p.LibrasPedido),
    }, operadorDe(req));

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/detalle-pedido/avance?pedido=2026-016
//
// Cierra la cadena del pedido, que hasta ahora llegaba solo hasta "agrupado" y ahí se cortaba:
//   Objetivo → Declarado → EnBodega → Despachado
//
// Es MEDICIÓN, no candado. La proforma se mueve (se agregan productos en plena carga), así que topar
// el despacho contra ella frenaría contenedores legítimos en el andén. Diferencia > 0 se muestra en
// ámbar y el bodeguero decide — el candado duro sigue siendo el de Agrupación (declarado), que sí
// tiene sentido porque ahí todavía no hay producto físico comprometido.
router.get("/avance", requireAuth, requireAnyPerm([["pedidos", "ver"], ["etiquetado", "ver"], ["remisiones", "ver"]]), async (req: Request, res: Response) => {
  try {
    const pedido = req.query.pedido as string | undefined;
    if (!pedido) { res.status(400).json({ error: "Falta el pedido" }); return; }

    const lineas: any[] = await prisma.$queryRaw`
      SELECT dp.DetalleId, dp.Clase, dp.Proceso, dp.Talla, dp.Presentacion,
             dp.CantidadCajas, dp.KgPedido, dp.LibrasPedido, pr.CajasXMaster, ped.EsGeneral
      FROM DetallePedido dp
      JOIN Presentacion pr ON pr.Codigo = dp.Presentacion
      JOIN Pedidos ped ON ped.CodigoPedido = dp.CodigoPedido
      WHERE dp.CodigoPedido = ${pedido}
      ORDER BY dp.DetalleId ASC LIMIT 2000
    `;
    if (!lineas.length) { res.json([]); return; }

    const ids = lineas.map(l => Number(l.DetalleId));
    const marcas = ids.map(() => "?").join(",");

    // Dos consultas agrupadas en vez de subconsultas por fila: un pedido general acumula cientos de
    // líneas y ahí las correlacionadas se vuelven lentas (mismo patrón que calcularTechoLineaBatch).
    const declarados: any[] = await prisma.$queryRawUnsafe(`
      SELECT DetalleId, COALESCE(SUM(CantidadMaster), 0) AS n
      FROM OrdenEtiquetado
      WHERE DetalleId IN (${marcas}) AND Estatus <> 'Cancelada'
      GROUP BY DetalleId`, ...ids);

    const fisicos: any[] = await prisma.$queryRawUnsafe(`
      SELECT oe.DetalleId,
             SUM(CASE WHEN m.Estatus <> 'Salido' THEN 1 ELSE 0 END) AS enBodega,
             SUM(CASE WHEN m.Estatus =  'Salido' THEN 1 ELSE 0 END) AS despachado
      FROM Masters m
      JOIN EtiquetaImpresa ei ON ei.EtiquetaId = m.EtiquetaId
      JOIN OrdenEtiquetado oe ON oe.OrdenId = ei.OrdenId
      WHERE oe.DetalleId IN (${marcas})
      GROUP BY oe.DetalleId`, ...ids);

    const porDeclarado = new Map(declarados.map((r: any) => [Number(r.DetalleId), Number(r.n)]));
    const porFisico = new Map(fisicos.map((r: any) => [Number(r.DetalleId), r]));

    res.json(lineas.map(l => {
      const detalleId = Number(l.DetalleId);
      const f = porFisico.get(detalleId);
      const despachado = f ? Number(f.despachado) : 0;
      // Objetivo null en pedidos generales: son perpetuos, no hay cantidad planificada contra la
      // cual comparar (ver project_pedido_general_design). Sin objetivo tampoco hay diferencia.
      const objetivo = Number(l.EsGeneral) === 1
        ? null
        : Math.ceil(Number(l.CantidadCajas) / Number(l.CajasXMaster));
      return {
        DetalleId: detalleId,
        Clase: l.Clase, Proceso: Number(l.Proceso), Talla: Number(l.Talla), Presentacion: l.Presentacion,
        CantidadCajas: Number(l.CantidadCajas),
        CajasXMaster: Number(l.CajasXMaster),
        Objetivo: objetivo,
        Declarado: porDeclarado.get(detalleId) ?? 0,
        EnBodega: f ? Number(f.enBodega) : 0,
        Despachado: despachado,
        Diferencia: objetivo === null ? null : despachado - objetivo,
      };
    }));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/detalle-pedido/:id/historial — cómo se ha movido esa línea de la proforma en el tiempo.
router.get("/:id/historial", requireAuth, requireAnyPerm([["pedidos", "ver"], ["remisiones", "ver"]]), async (req: Request, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT HistorialId, DetalleId, CodigoPedido, Accion, Clase, Proceso, Talla, Presentacion,
             EmpaqueMaster, EmpaqueAccesorio, CantidadCajas, KgPedido, LibrasPedido,
             RegistradoPor, CreadoEn
      FROM DetallePedidoHistorial
      WHERE DetalleId = ${Number(req.params.id)}
      ORDER BY HistorialId ASC
    `;
    res.json(rows.map(r => ({
      ...r,
      HistorialId: Number(r.HistorialId), DetalleId: Number(r.DetalleId),
      Proceso: Number(r.Proceso), Talla: Number(r.Talla),
      CantidadCajas: Number(r.CantidadCajas),
      KgPedido: Number(r.KgPedido), LibrasPedido: Number(r.LibrasPedido),
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
