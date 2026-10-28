import { Router, Request, Response } from "express";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm, requireAnyPerm, requireAdmin, AuthRequest } from "../middleware/auth.ts";
import { objetivoDeLinea } from "../lib/masters.ts";

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
    EsGranel: Number(r.EsGranel) === 1,
    Activo: Number(r.Activo) === 1,
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

// Una línea sin techo —pedido general, o línea de granel abierta en planta— no tiene cantidad
// planificada: se programa con 1 caja de centinela y el peso sale de la presentación. Se fuerza en el
// backend (no solo en la UI) para que el centinela quede uniforme aunque alguien llame la API directo
// — con el Objetivo desactivado, un número distinto ahí no sería un techo real, solo un dato engañoso
// en pantalla y en reportes.
function resolverCantidades(sinTecho: boolean, ctx: { PesoKG: number; PesoLb: number },
                            body: { CantidadCajas?: any; KgPedido?: any; LibrasPedido?: any }) {
  if (sinTecho) return { cajas: 1, kg: round3(ctx.PesoKG), lb: round3(ctx.PesoLb) };
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
    CantidadCajas: number; KgPedido: number; LibrasPedido: number; EsGranel: boolean;
  },
  usuario?: string,
) {
  try {
    await client.$executeRaw`
      INSERT INTO DetallePedidoHistorial
        (DetalleId, CodigoPedido, Accion, Clase, Proceso, Talla, Presentacion,
         EmpaqueMaster, EmpaqueAccesorio, CantidadCajas, KgPedido, LibrasPedido, EsGranel, RegistradoPor)
      VALUES (${datos.DetalleId}, ${datos.CodigoPedido}, ${datos.Accion}, ${datos.Clase}, ${datos.Proceso},
              ${datos.Talla}, ${datos.Presentacion}, ${datos.EmpaqueMaster}, ${datos.EmpaqueAccesorio},
              ${datos.CantidadCajas}, ${datos.KgPedido}, ${datos.LibrasPedido},
              ${datos.EsGranel ? 1 : 0}, ${usuario || null})
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
          SELECT DetalleId, CodigoPedido, Clase, Proceso, Talla, Presentacion, EmpaqueMaster, EmpaqueAccesorio, CantidadCajas, KgPedido, LibrasPedido, EsGranel, Activo
          FROM DetallePedido WHERE CodigoPedido = ${pedido} ORDER BY DetalleId ASC LIMIT 2000
        `
      : await prisma.$queryRaw`
          SELECT DetalleId, CodigoPedido, Clase, Proceso, Talla, Presentacion, EmpaqueMaster, EmpaqueAccesorio, CantidadCajas, KgPedido, LibrasPedido, EsGranel, Activo
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
    const { CodigoPedido, Clase, Talla, Presentacion, EmpaqueMaster, EmpaqueAccesorio, CantidadCajas, KgPedido, LibrasPedido, EsGranel } = req.body;
    if (!CodigoPedido || !Clase || !Talla || !Presentacion || !EmpaqueMaster) {
      res.status(400).json({ error: "Faltan campos requeridos" });
      return;
    }
    const esGranel = !!EsGranel;

    const ctx = await obtenerContextoLinea(CodigoPedido, Clase, Presentacion);
    if (!ctx) { res.status(400).json({ error: "Pedido, clase o presentación no existen" }); return; }

    // Una línea de granel solo puede ir en una presentación de granel de verdad (una unidad por
    // master: 1/20 lb, 1/40 lb…) — si no, sería una línea de proforma normal disfrazada de granel.
    if (esGranel) {
      const pres: any[] = await prisma.$queryRaw`SELECT CajasXMaster FROM Presentacion WHERE Codigo = ${Presentacion} LIMIT 1`;
      if (!pres.length || Number(pres[0].CajasXMaster) !== 1) {
        res.status(400).json({ error: "Esa presentación no es de granel: el granel lleva una sola unidad por master (1/20 lb, 1/40 lb…)." });
        return;
      }
    }

    // Las cantidades solo se exigen en líneas con techo real: ni pedido general ni granel lo tienen,
    // así que ahí se ignoran y se fuerza el centinela de 1 caja.
    const sinTecho = ctx.EsGeneral || esGranel;
    if (!sinTecho && (!CantidadCajas || !KgPedido || !LibrasPedido)) {
      res.status(400).json({ error: "Cajas, Kg y Lb son requeridos" });
      return;
    }
    const { cajas, kg, lb } = resolverCantidades(sinTecho, ctx, { CantidadCajas, KgPedido, LibrasPedido });

    // El INSERT y la lectura del id van en la misma transacción: LAST_INSERT_ID() es por conexión, y
    // fuera de la transacción el pool podría devolver otra y traer el id de un insert ajeno.
    // Una línea de granel nace DESACTIVADA: nadie saca (imprime) etiquetas contra ella hasta que un
    // administrador la active a propósito. El granel es la excepción de una emergencia, no un atajo
    // — por eso no se acepta del body, se fuerza siempre en 0 aquí.
    const activo = esGranel ? 0 : 1;

    const detalleId = await prisma.$transaction(async tx => {
      await tx.$executeRaw`
        INSERT INTO DetallePedido (CodigoPedido, Clase, Proceso, Talla, Presentacion, EmpaqueMaster, EmpaqueAccesorio, CantidadCajas, KgPedido, LibrasPedido, EsGranel, Activo)
        VALUES (${CodigoPedido}, ${Clase}, ${ctx.Proceso}, ${Number(Talla)}, ${Presentacion}, ${EmpaqueMaster}, ${EmpaqueAccesorio || null}, ${cajas}, ${kg}, ${lb}, ${esGranel ? 1 : 0}, ${activo})
      `;
      const filas: any[] = await tx.$queryRaw`SELECT LAST_INSERT_ID() AS id`;
      return Number(filas[0].id);
    }, { timeout: 30_000 });

    await registrarHistorial(prisma, {
      DetalleId: detalleId, CodigoPedido: String(CodigoPedido), Accion: "Alta",
      Clase, Proceso: ctx.Proceso, Talla: Number(Talla), Presentacion,
      EmpaqueMaster, EmpaqueAccesorio: EmpaqueAccesorio || null,
      CantidadCajas: cajas, KgPedido: kg, LibrasPedido: lb, EsGranel: esGranel,
    }, operadorDe(req));

    res.status(201).json({ ok: true, DetalleId: detalleId, EsGranel: esGranel, Activo: !!activo });
  } catch (err: any) {
    errorLinea(err, res);
  }
});

// PUT /api/detalle-pedido/:id/activo — enciende o apaga una línea de granel. Solo un administrador:
// el granel es una excepción de emergencia y activarlo es la decisión que la mantiene excepcional.
// No toca líneas normales (EsGranel = 0): ahí Activo no tiene ningún efecto y habilitar esta ruta
// para ellas solo confundiría.
router.put("/:id/activo", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const activo = !!req.body?.Activo;

    const rows: any[] = await prisma.$queryRaw`SELECT EsGranel FROM DetallePedido WHERE DetalleId = ${id} LIMIT 1`;
    if (!rows.length) { res.status(404).json({ error: "Línea de pedido no encontrada" }); return; }
    if (Number(rows[0].EsGranel) !== 1) {
      res.status(400).json({ error: "Esta línea no es de granel — el candado de activación solo aplica ahí." });
      return;
    }

    await prisma.$executeRaw`
      UPDATE DetallePedido
      SET Activo = ${activo ? 1 : 0}, ActivoCambiadoPor = ${operadorDe(req)}, ActivoCambiadoEn = NOW()
      WHERE DetalleId = ${id}
    `;
    res.json({ ok: true, DetalleId: id, Activo: activo });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
      SELECT CodigoPedido, EsGranel FROM DetallePedido WHERE DetalleId = ${id} LIMIT 1
    `;
    if (!actuales.length) { res.status(404).json({ error: "Línea de pedido no encontrada" }); return; }
    // EsGranel sale de la fila y no del body a propósito: convertir una línea de proforma en granel
    // —o al revés— reinterpretaría retroactivamente el techo que ya se aplicó a lo declarado. Una
    // línea de granel se corrige o se borra, no se transforma. Misma regla que EsGeneral en Pedidos.
    const esGranel = Number(actuales[0].EsGranel) === 1;

    const ctx = await obtenerContextoLinea(String(actuales[0].CodigoPedido), Clase, Presentacion);
    if (!ctx) { res.status(400).json({ error: "Clase o presentación no existen" }); return; }

    // Igual que en el alta: una línea de granel no puede terminar apuntando a una presentación
    // empacada (Cajas x Master > 1) por una edición.
    if (esGranel) {
      const pres: any[] = await prisma.$queryRaw`SELECT CajasXMaster FROM Presentacion WHERE Codigo = ${Presentacion} LIMIT 1`;
      if (!pres.length || Number(pres[0].CajasXMaster) !== 1) {
        res.status(400).json({ error: "Esa presentación no es de granel: el granel lleva una sola unidad por master (1/20 lb, 1/40 lb…)." });
        return;
      }
    }

    const sinTecho = ctx.EsGeneral || esGranel;
    if (!sinTecho && (!CantidadCajas || !KgPedido || !LibrasPedido)) {
      res.status(400).json({ error: "Cajas, Kg y Lb son requeridos" });
      return;
    }
    const { cajas, kg, lb } = resolverCantidades(sinTecho, ctx, { CantidadCajas, KgPedido, LibrasPedido });

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
      CantidadCajas: cajas, KgPedido: kg, LibrasPedido: lb, EsGranel: esGranel,
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
             CantidadCajas, KgPedido, LibrasPedido, EsGranel, Activo
      FROM DetallePedido WHERE DetalleId = ${id} LIMIT 1
    `;
    if (!previas.length) { res.status(404).json({ error: "Línea de pedido no encontrada" }); return; }
    const p = previas[0];

    // OrdenEtiquetado cuelga de la línea por FK: sin este aviso el DELETE revienta con un 500 genérico.
    const ordenes: any[] = await prisma.$queryRaw`
      SELECT COUNT(*) AS n FROM OrdenEtiquetado WHERE DetalleId = ${id}
    `;
    const nOrdenes = Number(ordenes[0].n);
    if (nOrdenes > 0) {
      res.status(409).json({
        error: `La línea tiene ${nOrdenes} orden(es) de etiquetado. Elimina o anula esas órdenes antes de borrar la línea.`,
      });
      return;
    }

    await prisma.$executeRaw`DELETE FROM DetallePedido WHERE DetalleId = ${id}`;

    await registrarHistorial(prisma, {
      DetalleId: id, CodigoPedido: String(p.CodigoPedido), Accion: "Baja",
      Clase: String(p.Clase), Proceso: Number(p.Proceso), Talla: Number(p.Talla),
      Presentacion: String(p.Presentacion), EmpaqueMaster: String(p.EmpaqueMaster),
      EmpaqueAccesorio: p.EmpaqueAccesorio ?? null, CantidadCajas: Number(p.CantidadCajas),
      KgPedido: Number(p.KgPedido), LibrasPedido: Number(p.LibrasPedido),
      EsGranel: Number(p.EsGranel) === 1,
    }, operadorDe(req));

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/detalle-pedido/avance?pedido=2026-016
//
// Por línea y en master: lo que pide la proforma, lo que sigue en bodega y lo DESPACHADO al cliente
// (solo remisiones de una serie con Destino 'Cliente'). Desde el 28 oct 2026 la pestaña Avance de
// Pedidos ya no lo usa —pinta GET /cuadre, que trae kg y master en la misma vista—; lo consume el
// aviso de PanelRemision, que compara lo que va saliendo contra el objetivo.
//
// Es MEDICIÓN, no candado: nada se bloquea aquí. El techo del escaneo (calcularTechoLinea) sigue
// contando lo despachado al cliente, a propósito: si contara solo lo que está en bodega, cada
// contenedor despachado reabriría el cupo de la línea. Lo que salió en traslado interno sí libera
// cupo (ver SALIO_EN_TRASLADO en lib/masters.ts).
router.get("/avance", requireAuth, requireAnyPerm([["pedidos", "ver"], ["etiquetado", "ver"], ["remisiones", "ver"]]), async (req: Request, res: Response) => {
  try {
    const pedido = req.query.pedido as string | undefined;
    if (!pedido) { res.status(400).json({ error: "Falta el pedido" }); return; }

    const lineas: any[] = await prisma.$queryRaw`
      SELECT dp.DetalleId, dp.Clase, dp.Proceso, dp.Talla, dp.Presentacion,
             dp.CantidadCajas, dp.KgPedido, dp.LibrasPedido, dp.EsGranel, pr.CajasXMaster, ped.EsGeneral
      FROM DetallePedido dp
      JOIN Presentacion pr ON pr.Codigo = dp.Presentacion
      JOIN Pedidos ped ON ped.CodigoPedido = dp.CodigoPedido
      WHERE dp.CodigoPedido = ${pedido}
      ORDER BY dp.DetalleId ASC LIMIT 2000
    `;
    if (!lineas.length) { res.json([]); return; }

    const ids = lineas.map(l => Number(l.DetalleId));
    const marcas = ids.map(() => "?").join(",");

    // Una consulta agrupada en vez de subconsultas por fila: un pedido general acumula cientos de
    // líneas y ahí las correlacionadas se vuelven lentas (mismo patrón que calcularTechoLineaBatch).
    // La serie de la remisión separa el despacho al cliente del traslado interno. Hay a lo sumo una
    // remisión vigente por master (UNIQUE (MasterId, Vigente) en RemisionDetalle), así que el LEFT
    // JOIN no duplica filas. El borrador cuenta igual que la confirmada: el master sale de bodega al
    // escanearse en la remisión (28 oct 2026).
    const fisicos: any[] = await prisma.$queryRawUnsafe(`
      SELECT oe.DetalleId,
             SUM(CASE WHEN m.Estatus <> 'Salido' THEN 1 ELSE 0 END) AS enBodega,
             SUM(CASE WHEN m.Estatus = 'Salido' AND sv.Destino = 'Cliente' THEN 1 ELSE 0 END) AS despachado
      FROM Masters m
      JOIN EtiquetaImpresa ei ON ei.EtiquetaId = m.EtiquetaId
      JOIN OrdenEtiquetado oe ON oe.OrdenId = ei.OrdenId
      LEFT JOIN RemisionDetalle rdv ON rdv.MasterId = m.MasterId AND rdv.Vigente = 1
      LEFT JOIN Remisiones rv ON rv.RemisionId = rdv.RemisionId AND rv.Estatus IN ('Borrador', 'Confirmada')
      LEFT JOIN SerieRemision sv ON sv.Tipo = rv.Tipo
      WHERE oe.DetalleId IN (${marcas})
      GROUP BY oe.DetalleId`, ...ids);

    const porFisico = new Map(fisicos.map((r: any) => [Number(r.DetalleId), r]));

    res.json(lineas.map(l => {
      const detalleId = Number(l.DetalleId);
      const f = porFisico.get(detalleId);
      const enBodega = f ? Number(f.enBodega) : 0;
      // Objetivo null en pedidos generales (perpetuos, sin cantidad planificada) y en líneas de
      // granel (no están en la proforma). Sin objetivo tampoco hay diferencia.
      const objetivo = objetivoDeLinea(l);
      return {
        DetalleId: detalleId,
        Clase: l.Clase, Proceso: Number(l.Proceso), Talla: Number(l.Talla), Presentacion: l.Presentacion,
        CantidadCajas: Number(l.CantidadCajas),
        CajasXMaster: Number(l.CajasXMaster),
        EsGranel: Number(l.EsGranel) === 1,
        Objetivo: objetivo,
        EnBodega: enBodega,
        Despachado: f ? Number(f.despachado) : 0,
        Diferencia: objetivo === null ? null : enBodega - objetivo,
      };
    }));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/detalle-pedido/granel — abre una línea de granel desde Etiquetado.
//
// Cuando se acaba el material de empaque la producción no se detiene: se empaca a granel. Ese
// producto es del pedido y hay que poder capturarlo YA, sin esperar a que Catálogos abra la línea,
// que es justo la parada que se quiere evitar. Por eso vive aquí y no en el POST de arriba: otro
// permiso y otras reglas.
//
// El operador solo aporta lo que tiene enfrente: el pedido, la talla y la presentación a granel.
// Todo lo demás se deduce, porque pedírselo es pedirle que se equivoque:
//
//   - El PROCESO sale de la talla. Un pedido puede llevar dos productos (P&D y PPV, procesos 41 y
//     46 en 015-2026) y meter el granel en el equivocado descuadraría los dos. No se puede deducir
//     del área —de Pelado salen muchas tallas y varios procesos—, pero sí de la talla: en los
//     pedidos de cliente cada talla cae bajo un solo proceso. Si aun así hubiera dos, se exige que
//     el body diga cuál y se devuelven las opciones en el 409.
//   - La CLASE y el EMPAQUE MASTER se heredan de la línea de proforma de ese proceso+talla. La
//     Clase es Familia+Proceso, y la Familia la usa la validación Área↔Familia del pesaje:
//     deducirla mal rompería bastante más que el cuadre.
//
// La línea queda con EsGranel = 1: sin techo, sin candado en Agrupación, y suma al cuadre por
// (Proceso, Talla) sin sumar al objetivo.
router.post("/granel", requireAuth, requirePerm("etiquetado", "crear"), async (req: AuthRequest, res: Response) => {
  try {
    const { CodigoPedido, Talla, Presentacion, Proceso } = req.body;
    if (!CodigoPedido || !Talla || !Presentacion) {
      res.status(400).json({ error: "Pedido, talla y presentación son requeridos" });
      return;
    }
    const talla = Number(Talla);

    // La presentación tiene que ser de granel de verdad: una sola unidad por master. Es lo que
    // separa "1/20 lb" de "20/375 gr", y evita que por aquí entre una línea de proforma disfrazada.
    const pres: any[] = await prisma.$queryRaw`
      SELECT Codigo, PesoKG, PesoLb, CajasXMaster FROM Presentacion WHERE Codigo = ${Presentacion} LIMIT 1
    `;
    if (!pres.length) { res.status(400).json({ error: "La presentación no existe" }); return; }
    if (Number(pres[0].CajasXMaster) !== 1) {
      res.status(400).json({ error: "Esa presentación no es de granel: el granel lleva una sola unidad por master (1/20 lb, 1/40 lb…)." });
      return;
    }

    // Candidatos = líneas de PROFORMA (EsGranel = 0) de esa talla en ese pedido. Se excluyen las de
    // granel ya existentes para que una línea de granel no termine siendo el origen de otra.
    const candidatos: any[] = await prisma.$queryRaw`
      SELECT dp.Proceso, MIN(dp.Clase) AS Clase, MIN(dp.EmpaqueMaster) AS EmpaqueMaster,
             MIN(cl.Descripcion) AS Descripcion
      FROM DetallePedido dp
      LEFT JOIN Clase cl ON cl.Clase = dp.Clase
      WHERE dp.CodigoPedido = ${CodigoPedido} AND dp.Talla = ${talla} AND dp.EsGranel = 0
      GROUP BY dp.Proceso
    `;
    if (!candidatos.length) {
      res.status(400).json({ error: "Esa talla no está en el pedido. El granel no abre producto que el cliente no pidió." });
      return;
    }

    let elegido = candidatos[0];
    if (candidatos.length > 1) {
      // Hoy solo pasa en pedidos generales, pero nada impide que un cliente pida la misma talla en
      // dos procesos. Se pregunta con la lista acotada en vez de adivinar.
      if (Proceso === undefined || Proceso === null || Proceso === "") {
        res.status(409).json({
          error: "Esa talla está en el pedido bajo más de un producto. Indique cuál.",
          opciones: candidatos.map((c: any) => ({ Proceso: Number(c.Proceso), Clase: c.Clase, Descripcion: c.Descripcion })),
        });
        return;
      }
      const match = candidatos.find((c: any) => Number(c.Proceso) === Number(Proceso));
      if (!match) { res.status(400).json({ error: "Ese producto no corresponde a la talla en este pedido" }); return; }
      elegido = match;
    }

    const kg = round3(Number(pres[0].PesoKG));
    const lb = round3(Number(pres[0].PesoLb));

    // Nace desactivada — igual que por el alta manual: es la vía más rápida de crear una línea de
    // granel, así que el candado de emergencia importa más aquí que en ningún otro lado.
    const detalleId = await prisma.$transaction(async tx => {
      await tx.$executeRaw`
        INSERT INTO DetallePedido (CodigoPedido, Clase, Proceso, Talla, Presentacion, EmpaqueMaster, EmpaqueAccesorio, CantidadCajas, KgPedido, LibrasPedido, EsGranel, Activo)
        VALUES (${CodigoPedido}, ${elegido.Clase}, ${Number(elegido.Proceso)}, ${talla}, ${Presentacion},
                ${elegido.EmpaqueMaster}, ${null}, ${1}, ${kg}, ${lb}, ${1}, ${0})
      `;
      const filas: any[] = await tx.$queryRaw`SELECT LAST_INSERT_ID() AS id`;
      return Number(filas[0].id);
    }, { timeout: 30_000 });

    await registrarHistorial(prisma, {
      DetalleId: detalleId, CodigoPedido: String(CodigoPedido), Accion: "Alta",
      Clase: String(elegido.Clase), Proceso: Number(elegido.Proceso), Talla: talla,
      Presentacion: String(Presentacion), EmpaqueMaster: String(elegido.EmpaqueMaster),
      EmpaqueAccesorio: null, CantidadCajas: 1, KgPedido: kg, LibrasPedido: lb, EsGranel: true,
    }, operadorDe(req));

    res.status(201).json({ ok: true, DetalleId: detalleId, Clase: elegido.Clase, Proceso: Number(elegido.Proceso), Activo: false });
  } catch (err: any) {
    errorLinea(err, res);
  }
});

// GET /api/detalle-pedido/cuadre?pedido=016-2026 — la pestaña Avance de Pedidos: kg en bodega contra
// kg pedidos, por presentación, y los master que faltan por línea.
//
// Solo cuenta lo escaneado que sigue DENTRO de bodega: ni lo agrupado ni lo que ya salió (despachos
// y traslados) — decisión del usuario, 28 oct 2026. En kg se pueden sumar líneas de distinta
// presentación, y con eso sale el % de avance de todo el pedido; los master faltantes dicen cuánto
// hay que producir todavía en la unidad con que se trabaja en planta. El 28 oct se juntaron aquí
// las pestañas Avance (master) y Cuadre (kg), a pedido del usuario.
//
// Una fila por (Proceso, Talla, Presentación), que es la llave UNIQUE de DetallePedido: cada fila
// es una línea de la proforma. Hasta el 28 oct 2026 se agrupaba solo por (Proceso, Talla) para sumar
// el granel con su producto; el usuario pidió ver la presentación, así que el granel queda en su
// propia fila, sin pedido propio (ObjetivoKg null). Sus kg sí entran al total del pedido: es producto
// del pedido empacado distinto porque se acabó el material.
router.get("/cuadre", requireAuth, requireAnyPerm([["pedidos", "ver"], ["etiquetado", "ver"], ["remisiones", "ver"]]), async (req: Request, res: Response) => {
  try {
    const pedido = req.query.pedido as string | undefined;
    if (!pedido) { res.status(400).json({ error: "Falta el pedido" }); return; }

    const gen: any[] = await prisma.$queryRaw`SELECT EsGeneral FROM Pedidos WHERE CodigoPedido = ${pedido} LIMIT 1`;
    if (!gen.length) { res.status(404).json({ error: "Pedido no encontrado" }); return; }
    const esGeneral = Number(gen[0].EsGeneral) === 1;

    // El derivado se acota a los DetalleId del pedido en vez de agregar Masters entera: crece con
    // toda la planta, y sin ese IN la consulta se degrada a medida que avanza la temporada (ver
    // project_rendimiento_consultas_destajo).
    const filas: any[] = await prisma.$queryRaw`
      SELECT dp.DetalleId, dp.Proceso, dp.Clase, dp.Talla, dp.Presentacion, dp.EsGranel, dp.KgPedido,
             dp.CantidadCajas, pr.CajasXMaster,
             COALESCE(f.enBodega, 0) AS EnBodegaMaster,
             COALESCE(f.enBodega, 0) * pr.PesoKG * pr.CajasXMaster AS EnBodegaKg
      FROM DetallePedido dp
      JOIN Presentacion pr ON pr.Codigo = dp.Presentacion
      LEFT JOIN (
        SELECT oe.DetalleId, COUNT(*) AS enBodega
        FROM Masters m
        JOIN EtiquetaImpresa ei ON ei.EtiquetaId = m.EtiquetaId
        JOIN OrdenEtiquetado oe ON oe.OrdenId = ei.OrdenId
        WHERE m.Estatus <> 'Salido'
          AND oe.DetalleId IN (SELECT DetalleId FROM DetallePedido WHERE CodigoPedido = ${pedido})
        GROUP BY oe.DetalleId
      ) f ON f.DetalleId = dp.DetalleId
      WHERE dp.CodigoPedido = ${pedido}
      ORDER BY dp.Proceso ASC, dp.Talla ASC, dp.EsGranel ASC, dp.Presentacion ASC
      LIMIT 2000
    `;

    const r3 = (v: any) => Math.round(Number(v || 0) * 1000) / 1000;
    res.json(filas.map(r => {
      // En un pedido general todas las líneas llevan el centinela de 1 caja, así que KgPedido es el
      // peso de una caja — un número sin significado. Una línea de granel no está en la proforma.
      const objetivo = esGeneral || Number(r.EsGranel) === 1 ? null : r3(r.KgPedido);
      const enBodega = r3(r.EnBodegaKg);
      // En master el pedido es el mismo objetivo que topa el escaneo (cajas ÷ cajas por master,
      // redondeado hacia arriba). Lo que sobra no resta: una línea pasada no tapa lo que le falta a otra.
      const objetivoMaster = objetivoDeLinea({ ...r, EsGeneral: esGeneral ? 1 : 0 });
      const enBodegaMaster = Number(r.EnBodegaMaster);
      return {
        DetalleId: Number(r.DetalleId),
        Proceso: Number(r.Proceso),
        Clase: r.Clase,
        Talla: Number(r.Talla),
        Presentacion: r.Presentacion,
        EsGranel: Number(r.EsGranel) === 1,
        ObjetivoKg: objetivo,
        EnBodegaKg: enBodega,
        DiferenciaKg: objetivo === null ? null : r3(enBodega - objetivo),
        ObjetivoMaster: objetivoMaster,
        EnBodegaMaster: enBodegaMaster,
        FaltanMaster: objetivoMaster === null ? null : Math.max(0, objetivoMaster - enBodegaMaster),
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
