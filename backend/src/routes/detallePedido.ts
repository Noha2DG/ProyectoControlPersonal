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
      // Objetivo null en pedidos generales (perpetuos, sin cantidad planificada) y en líneas de
      // granel (no están en la proforma). Sin objetivo tampoco hay diferencia — el granel se mide en
      // el cuadre por (Proceso, Talla), no aquí.
      const objetivo = objetivoDeLinea(l);
      return {
        DetalleId: detalleId,
        Clase: l.Clase, Proceso: Number(l.Proceso), Talla: Number(l.Talla), Presentacion: l.Presentacion,
        CantidadCajas: Number(l.CantidadCajas),
        CajasXMaster: Number(l.CajasXMaster),
        EsGranel: Number(l.EsGranel) === 1,
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

// GET /api/detalle-pedido/cuadre?pedido=016-2026 — el cuadre general, por (Proceso, Talla) y en kg.
//
// El avance por línea mide master contra master, y eso deja de servir en cuanto el mismo producto
// sale en dos empaques: 429 master de 20/375 gr (7.5 kg) y 12 de granel 1/20 lb (9.07 kg) no se
// pueden sumar. En kg sí, y kg es la unidad de la proforma.
//
// El compromiso con el cliente es por PRODUCTO y TALLA —"3,217.50 kg de 21/25 P&D"—, no por empaque:
// cómo se empaque es decisión de planta. Por eso el techo vive en el par (Proceso, Talla) y no en la
// línea. Se agrupa por Proceso y no por Clase porque es la llave del UNIQUE de la tabla y porque la
// etiqueta imprime el Proceso: dos master del mismo proceso son indistinguibles en bodega.
//
// Las líneas de granel suman al avance y NO al objetivo: ahí es donde el producto empacado a granel
// aparece como progreso sin inventarse un techo propio.
router.get("/cuadre", requireAuth, requireAnyPerm([["pedidos", "ver"], ["etiquetado", "ver"], ["remisiones", "ver"]]), async (req: Request, res: Response) => {
  try {
    const pedido = req.query.pedido as string | undefined;
    if (!pedido) { res.status(400).json({ error: "Falta el pedido" }); return; }

    const gen: any[] = await prisma.$queryRaw`SELECT EsGeneral FROM Pedidos WHERE CodigoPedido = ${pedido} LIMIT 1`;
    if (!gen.length) { res.status(404).json({ error: "Pedido no encontrado" }); return; }
    const esGeneral = Number(gen[0].EsGeneral) === 1;

    // Los dos derivados se acotan a los DetalleId del pedido en vez de agregar las tablas enteras:
    // OrdenEtiquetado y Masters crecen con toda la planta, y sin ese IN la consulta se degrada a
    // medida que avanza la temporada (ver project_rendimiento_consultas_destajo).
    // Empacado y granel se separan en las TRES etapas, no solo al final: si solo se partiera
    // Despachado, un pedido con 3000 kg empacados + 200 kg a granel todavía en Agrupación se vería
    // igual que uno sin nada de granel hasta que saliera por bodega — justo cuando ya no sirve para
    // decidir si hace falta más material de empaque.
    const filas: any[] = await prisma.$queryRaw`
      SELECT dp.Proceso,
             MIN(dp.Clase) AS Clase,
             dp.Talla,
             SUM(CASE WHEN dp.EsGranel = 0 THEN dp.KgPedido ELSE 0 END) AS ObjetivoKg,

             SUM(CASE WHEN dp.EsGranel = 0 THEN COALESCE(d.n, 0) ELSE 0 END * pr.PesoKG * pr.CajasXMaster) AS EmpacadoDeclaradoKg,
             SUM(CASE WHEN dp.EsGranel = 1 THEN COALESCE(d.n, 0) ELSE 0 END * pr.PesoKG * pr.CajasXMaster) AS GranelDeclaradoKg,

             SUM(CASE WHEN dp.EsGranel = 0 THEN COALESCE(f.enBodega, 0) ELSE 0 END * pr.PesoKG * pr.CajasXMaster) AS EmpacadoEnBodegaKg,
             SUM(CASE WHEN dp.EsGranel = 1 THEN COALESCE(f.enBodega, 0) ELSE 0 END * pr.PesoKG * pr.CajasXMaster) AS GranelEnBodegaKg,

             SUM(CASE WHEN dp.EsGranel = 0 THEN COALESCE(f.despachado, 0) ELSE 0 END * pr.PesoKG * pr.CajasXMaster) AS EmpacadoDespachadoKg,
             SUM(CASE WHEN dp.EsGranel = 1 THEN COALESCE(f.despachado, 0) ELSE 0 END * pr.PesoKG * pr.CajasXMaster) AS GranelDespachadoKg,

             SUM(dp.EsGranel) AS LineasGranel
      FROM DetallePedido dp
      JOIN Presentacion pr ON pr.Codigo = dp.Presentacion
      LEFT JOIN (
        SELECT DetalleId, SUM(CantidadMaster) AS n
        FROM OrdenEtiquetado
        WHERE Estatus <> 'Cancelada'
          AND DetalleId IN (SELECT DetalleId FROM DetallePedido WHERE CodigoPedido = ${pedido})
        GROUP BY DetalleId
      ) d ON d.DetalleId = dp.DetalleId
      LEFT JOIN (
        SELECT oe.DetalleId,
               SUM(CASE WHEN m.Estatus <> 'Salido' THEN 1 ELSE 0 END) AS enBodega,
               SUM(CASE WHEN m.Estatus =  'Salido' THEN 1 ELSE 0 END) AS despachado
        FROM Masters m
        JOIN EtiquetaImpresa ei ON ei.EtiquetaId = m.EtiquetaId
        JOIN OrdenEtiquetado oe ON oe.OrdenId = ei.OrdenId
        WHERE oe.DetalleId IN (SELECT DetalleId FROM DetallePedido WHERE CodigoPedido = ${pedido})
        GROUP BY oe.DetalleId
      ) f ON f.DetalleId = dp.DetalleId
      WHERE dp.CodigoPedido = ${pedido}
      GROUP BY dp.Proceso, dp.Talla
      ORDER BY dp.Proceso ASC, dp.Talla ASC
      LIMIT 2000
    `;

    const r3 = (v: any) => Math.round(Number(v || 0) * 1000) / 1000;
    res.json(filas.map(r => {
      // En un pedido general todas las líneas llevan el centinela de 1 caja, así que la suma de
      // KgPedido sería el peso de una caja por línea — un número sin significado. Mejor null.
      const objetivo = esGeneral ? null : r3(r.ObjetivoKg);
      const empacadoDespachado = r3(r.EmpacadoDespachadoKg);
      const granelDespachado = r3(r.GranelDespachadoKg);
      const despachado = r3(empacadoDespachado + granelDespachado);
      return {
        Proceso: Number(r.Proceso),
        Clase: r.Clase,
        Talla: Number(r.Talla),
        ObjetivoKg: objetivo,
        Declarado: { EmpacadoKg: r3(r.EmpacadoDeclaradoKg), GranelKg: r3(r.GranelDeclaradoKg) },
        EnBodega: { EmpacadoKg: r3(r.EmpacadoEnBodegaKg), GranelKg: r3(r.GranelEnBodegaKg) },
        Despachado: { EmpacadoKg: empacadoDespachado, GranelKg: granelDespachado },
        LineasGranel: Number(r.LineasGranel || 0),
        DiferenciaKg: objetivo === null ? null : r3(despachado - objetivo),
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
