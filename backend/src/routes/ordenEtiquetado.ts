import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";
import { componerCodigoLote, piscinaRequiereCiclo } from "../lib/codigoLote.ts";
import { calcularTechoLinea, calcularTechoLineaBatch } from "../lib/masters.ts";

const router = Router();

// Etiquetado es un área independiente de Destajo: lo que se etiqueta hoy puede corresponder a
// producción de hasta 3 días atrás, y no siempre existe ya una fila en Lotes para esa combinación.
// Por eso NO se referencia Lotes.Lote — el código de lote se compone aquí mismo (Piscina + Fecha +
// Ciclo capturado a mano), con el mismo formato que usa Destajo, pero sin exigir que esa fila exista.
async function obtenerPiscina(piscinaId: number) {
  const rows: any[] = await prisma.$queryRaw`SELECT Nombre, CodigoFinca FROM Piscina WHERE PiscinaId = ${piscinaId} AND Activo = 1 LIMIT 1`;
  return rows[0] ?? null;
}

function getOperador(req: Request): string {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return "Sistema";
    const payload: any = jwt.verify(header.slice(7), process.env.JWT_SECRET!);
    return payload.nombre ?? payload.username ?? "Sistema";
  } catch {
    return "Sistema";
  }
}

function formatear(rows: any[]) {
  return rows.map(r => ({
    ...r,
    OrdenId: Number(r.OrdenId),
    PiscinaId: Number(r.PiscinaId),
    DetalleId: Number(r.DetalleId),
    Talla: Number(r.Talla),
    CantidadMaster: Number(r.CantidadMaster),
    Impresas: Number(r.Impresas),
    Anuladas: Number(r.Anuladas),
    Escaneadas: Number(r.Escaneadas),
  }));
}

// Objetivo/Escaneado de la LÍNEA de pedido (no de esta captura puntual) — se agrega aparte porque
// varias capturas pueden compartir el mismo DetalleId; un solo batch evita repetir la consulta por
// cada fila que caiga en la misma línea. Ver calcularTechoLineaBatch en lib/masters.ts.
async function agregarTechoLinea(rows: any[]) {
  const techos = await calcularTechoLineaBatch(prisma, rows.map(r => Number(r.DetalleId)));
  return rows.map(r => {
    const techo = techos.get(Number(r.DetalleId));
    return { ...r, ObjetivoLinea: techo?.Objetivo ?? null, EscaneadoLinea: techo?.Escaneado ?? null };
  });
}

const SELECT_ORDEN = `
  SELECT oe.OrdenId, oe.Lote, oe.PiscinaId, oe.Ciclo, oe.DetalleId, oe.AreaCodigo,
         ar.Nombre AS NombreArea, oe.FechaProduccion, oe.Color,
         oe.Origen, org.Descripcion AS DescripcionOrigen,
         oe.Congelacion, cong.Descripcion AS DescripcionCongelacion,
         oe.CantidadMaster, oe.Estatus, oe.RegistradoPor, oe.CreadoEn,
         dp.CodigoPedido, dp.Clase, cl.Descripcion AS DescripcionClase, pc.Descripcion AS DescripcionProceso,
         dp.Talla, ta.Descripcion AS DescripcionTalla,
         dp.Presentacion, pr.Descripcion AS DescripcionPresentacion,
         emM.Descripcion AS DescripcionEmpaqueMaster, emA.Descripcion AS DescripcionEmpaqueAccesorio,
         f.Codigo AS CodigoFinca, f.Descripcion AS NombreFinca, pi.Nombre AS NombrePiscina,
         cli.RazonSocial AS NombreCliente, sub.RazonSocial AS NombreSubcliente,
         (SELECT COUNT(*) FROM EtiquetaImpresa ei WHERE ei.OrdenId = oe.OrdenId AND ei.Estatus = 'Activa') AS Impresas,
         (SELECT COUNT(*) FROM EtiquetaImpresa ei WHERE ei.OrdenId = oe.OrdenId AND ei.Estatus = 'Anulada') AS Anuladas,
         (SELECT COUNT(*) FROM Masters m JOIN EtiquetaImpresa ei ON m.EtiquetaId = ei.EtiquetaId WHERE ei.OrdenId = oe.OrdenId) AS Escaneadas
  FROM OrdenEtiquetado oe
  JOIN DetallePedido dp ON oe.DetalleId = dp.DetalleId
  JOIN Clase cl ON dp.Clase = cl.Clase
  JOIN Procesos pc ON cl.Proceso = pc.Proceso
  JOIN Tallas ta ON dp.Talla = ta.Codigo
  JOIN Presentacion pr ON dp.Presentacion = pr.Codigo
  JOIN Empaques emM ON dp.EmpaqueMaster = emM.Codigo
  LEFT JOIN Empaques emA ON dp.EmpaqueAccesorio = emA.Codigo
  JOIN Origen org ON oe.Origen = org.Codigo
  JOIN UnidadesCongelacion cong ON oe.Congelacion = cong.Codigo
  JOIN Piscina pi ON oe.PiscinaId = pi.PiscinaId
  JOIN Finca f ON pi.CodigoFinca = f.Codigo
  LEFT JOIN Areas ar ON oe.AreaCodigo = ar.Codigo
  JOIN Pedidos ped ON dp.CodigoPedido = ped.CodigoPedido
  JOIN Clientes cli ON ped.CodigoCliente = cli.Codigo
  LEFT JOIN Subcliente sub ON ped.CodigoCliente = sub.CodigoCliente AND ped.CodigoSubcliente = sub.CodigoSubcliente
`;

// GET /api/orden-etiquetado?pedido=001-2026 | ?detalle=123 | ?fecha=2026-07-08
router.get("/", requireAuth, requirePerm("etiquetado", "ver"), async (req: Request, res: Response) => {
  try {
    const pedido = req.query.pedido as string | undefined;
    const detalle = req.query.detalle ? Number(req.query.detalle) : undefined;
    const fecha = req.query.fecha as string | undefined;
    let rows: any[];
    if (detalle) {
      rows = await prisma.$queryRawUnsafe(`${SELECT_ORDEN} WHERE oe.DetalleId = ? ORDER BY oe.OrdenId DESC`, detalle);
    } else if (pedido) {
      rows = await prisma.$queryRawUnsafe(`${SELECT_ORDEN} WHERE dp.CodigoPedido = ? ORDER BY oe.OrdenId DESC`, pedido);
    } else if (fecha) {
      rows = await prisma.$queryRawUnsafe(`${SELECT_ORDEN} WHERE oe.FechaProduccion = ? ORDER BY oe.OrdenId DESC`, fecha);
    } else {
      rows = await prisma.$queryRawUnsafe(`${SELECT_ORDEN} ORDER BY oe.OrdenId DESC LIMIT 500`);
    }
    res.json(formatear(await agregarTechoLinea(rows)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Objetivo = CEILING(CantidadCajas / CajasXMaster) de la línea de pedido.
// Acumulado = suma de CantidadMaster ya declarados en otras capturas de esa misma línea — el candado
// real que bloquea declarar de más SIGUE siendo este (declarado), sin cambios: revisado jul 2026 con
// el usuario y se dejó así a propósito, para no acoplar cuánto se puede trabajar cada día al ritmo de
// escaneo de bodega. Escaneado (Bodega ya existe, a diferencia de cuando se escribió este comentario
// originalmente) se agrega aparte, solo informativo — hoy lo consume la pantalla de captura para
// mostrar avance real, reusando el mismo cálculo que ya usa Bodega/el reporte de Impresión.
async function calcularResumen(detalleId: number, excluirOrdenId?: number) {
  const detalle: any[] = await prisma.$queryRaw`
    SELECT dp.CantidadCajas, pr.CajasXMaster
    FROM DetallePedido dp JOIN Presentacion pr ON dp.Presentacion = pr.Codigo
    WHERE dp.DetalleId = ${detalleId} LIMIT 1
  `;
  if (!detalle.length) return null;
  const objetivo = Math.ceil(Number(detalle[0].CantidadCajas) / Number(detalle[0].CajasXMaster));

  const acumRows: any[] = excluirOrdenId
    ? await prisma.$queryRaw`
        SELECT COALESCE(SUM(CantidadMaster), 0) AS acumulado FROM OrdenEtiquetado
        WHERE DetalleId = ${detalleId} AND Estatus != 'Cancelada' AND OrdenId != ${excluirOrdenId}
      `
    : await prisma.$queryRaw`
        SELECT COALESCE(SUM(CantidadMaster), 0) AS acumulado FROM OrdenEtiquetado
        WHERE DetalleId = ${detalleId} AND Estatus != 'Cancelada'
      `;
  const acumulado = Number(acumRows[0].acumulado);
  const techo = await calcularTechoLinea(prisma, detalleId);
  return { Objetivo: objetivo, Acumulado: acumulado, Pendiente: objetivo - acumulado, Escaneado: techo?.Escaneado ?? 0 };
}

// GET /api/orden-etiquetado/resumen/:detalleId
router.get("/resumen/:detalleId", requireAuth, requirePerm("etiquetado", "ver"), async (req: Request, res: Response) => {
  try {
    const resumen = await calcularResumen(Number(req.params.detalleId));
    if (!resumen) { res.status(404).json({ error: "Línea de pedido no encontrada" }); return; }
    res.json(resumen);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/orden-etiquetado  { PiscinaId, Ciclo, DetalleId, AreaCodigo, FechaProduccion, Color, Origen, Congelacion, CantidadMaster }
router.post("/", requireAuth, requirePerm("etiquetado", "crear"), async (req: Request, res: Response) => {
  try {
    const { PiscinaId, Ciclo, DetalleId, AreaCodigo, FechaProduccion, Color, Origen, Congelacion, CantidadMaster } = req.body;
    if (!PiscinaId || !DetalleId || !AreaCodigo || !FechaProduccion || !Origen || !Congelacion || !CantidadMaster) {
      res.status(400).json({ error: "Piscina, línea de pedido, área, fecha, origen, congelación y cantidad de master son requeridos" });
      return;
    }
    const cantidad = Number(CantidadMaster);
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      res.status(400).json({ error: "La cantidad de master debe ser un entero positivo" });
      return;
    }

    const areas: any[] = await prisma.$queryRaw`SELECT Codigo FROM Areas WHERE Codigo = ${AreaCodigo} AND Activa = 1 LIMIT 1`;
    if (!areas.length) { res.status(404).json({ error: "Área no encontrada o inactiva" }); return; }

    const piscina = await obtenerPiscina(Number(PiscinaId));
    if (!piscina) { res.status(404).json({ error: "Piscina no encontrada o inactiva" }); return; }
    const requiereCiclo = piscinaRequiereCiclo(String(piscina.Nombre), String(piscina.CodigoFinca));
    if (requiereCiclo && !Ciclo) { res.status(400).json({ error: "El ciclo es requerido para esta piscina" }); return; }
    const cicloEfectivo = requiereCiclo ? String(Ciclo) : "";
    const lote = componerCodigoLote(String(piscina.Nombre), FechaProduccion, cicloEfectivo);

    const pedidoRows: any[] = await prisma.$queryRaw`
      SELECT p.Estatus FROM DetallePedido dp JOIN Pedidos p ON dp.CodigoPedido = p.CodigoPedido
      WHERE dp.DetalleId = ${Number(DetalleId)} LIMIT 1
    `;
    if (!pedidoRows.length) { res.status(404).json({ error: "Línea de pedido no encontrada" }); return; }
    if (pedidoRows[0].Estatus !== "Proceso") {
      res.status(400).json({ error: "Ese pedido ya está Terminado, no se pueden agregar capturas nuevas" });
      return;
    }

    const resumen = await calcularResumen(Number(DetalleId));
    if (!resumen) { res.status(404).json({ error: "Línea de pedido no encontrada" }); return; }
    if (resumen.Acumulado + cantidad > resumen.Objetivo) {
      res.status(400).json({
        error: `Esta captura dejaría ${resumen.Acumulado + cantidad} masters declarados, pero la línea del pedido solo necesita ${resumen.Objetivo} (ya lleva ${resumen.Acumulado} en otras capturas).`,
      });
      return;
    }

    const operador = getOperador(req);
    await prisma.$executeRaw`
      INSERT INTO OrdenEtiquetado (Lote, PiscinaId, Ciclo, DetalleId, AreaCodigo, FechaProduccion, Color, Origen, Congelacion, CantidadMaster, RegistradoPor)
      VALUES (${lote}, ${Number(PiscinaId)}, ${cicloEfectivo}, ${Number(DetalleId)}, ${AreaCodigo}, ${FechaProduccion}, ${Color || null}, ${Origen}, ${Congelacion}, ${cantidad}, ${operador})
    `;
    res.status(201).json({ ok: true, Lote: lote });
  } catch (err: any) {
    if (err.message?.includes("foreign key")) res.status(400).json({ error: "Piscina, línea de pedido, área, origen o congelación no existen" });
    else res.status(500).json({ error: err.message });
  }
});

// PUT /api/orden-etiquetado/:id  { PiscinaId, Ciclo, AreaCodigo, FechaProduccion, Color, Origen, Congelacion, CantidadMaster, Estatus }
router.put("/:id", requireAuth, requirePerm("etiquetado", "editar"), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { PiscinaId, Ciclo, AreaCodigo, FechaProduccion, Color, Origen, Congelacion, CantidadMaster, Estatus } = req.body;

    const actuales: any[] = await prisma.$queryRaw`SELECT DetalleId FROM OrdenEtiquetado WHERE OrdenId = ${id} LIMIT 1`;
    if (!actuales.length) { res.status(404).json({ error: "Captura no encontrada" }); return; }

    if (!AreaCodigo) { res.status(400).json({ error: "El área es requerida" }); return; }
    const areas: any[] = await prisma.$queryRaw`SELECT Codigo FROM Areas WHERE Codigo = ${AreaCodigo} AND Activa = 1 LIMIT 1`;
    if (!areas.length) { res.status(404).json({ error: "Área no encontrada o inactiva" }); return; }

    const cantidad = Number(CantidadMaster);
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      res.status(400).json({ error: "La cantidad de master debe ser un entero positivo" });
      return;
    }

    // No se puede bajar la cantidad por debajo de lo que esta captura ya tiene impreso (Activas) —
    // sin este candado quedaría "Impresas" mostrando más que "Declarado" en la tabla, sin ninguna
    // razón real que lo justifique (mismo criterio que ya se usaba a nivel de línea completa).
    const impresasRows: any[] = await prisma.$queryRaw`SELECT COUNT(*) AS n FROM EtiquetaImpresa WHERE OrdenId = ${id} AND Estatus = 'Activa'`;
    const impresas = Number(impresasRows[0].n);
    if (cantidad < impresas) {
      res.status(400).json({ error: `No se puede bajar la cantidad a ${cantidad} — esta captura ya tiene ${impresas} etiquetas activas impresas.` });
      return;
    }

    if (Estatus && !["Pendiente", "Cancelada"].includes(Estatus)) {
      res.status(400).json({ error: "Estatus inválido" });
      return;
    }

    // Candado de posicionamiento: si algún master de esta captura ya está en un pallet con posición
    // física, cancelar la captura contradice ese sellado (todo el proceso anterior queda bloqueado
    // al posicionar) — misma regla que anular/reimprimir sus etiquetas.
    if (Estatus === "Cancelada") {
      const posicionados: any[] = await prisma.$queryRaw`
        SELECT p.Codigo AS PalletCodigo, po.Codigo AS PosicionCodigo
        FROM Masters m
        JOIN EtiquetaImpresa ei ON m.EtiquetaId = ei.EtiquetaId
        JOIN Pallets p ON m.PalletId = p.PalletId
        JOIN Posiciones po ON p.PosicionId = po.PosicionId
        WHERE ei.OrdenId = ${id} LIMIT 1
      `;
      if (posicionados.length) {
        res.status(400).json({
          error: `No se puede cancelar: esta captura tiene masters en el pallet ${posicionados[0].PalletCodigo}, ya posicionado en bodega física (${posicionados[0].PosicionCodigo}) — su contenido está sellado.`,
        });
        return;
      }
    }

    const piscina = await obtenerPiscina(Number(PiscinaId));
    if (!piscina) { res.status(404).json({ error: "Piscina no encontrada o inactiva" }); return; }
    const requiereCiclo = piscinaRequiereCiclo(String(piscina.Nombre), String(piscina.CodigoFinca));
    if (requiereCiclo && !Ciclo) { res.status(400).json({ error: "El ciclo es requerido para esta piscina" }); return; }
    const cicloEfectivo = requiereCiclo ? String(Ciclo) : "";
    const lote = componerCodigoLote(String(piscina.Nombre), FechaProduccion, cicloEfectivo);

    const resumen = await calcularResumen(Number(actuales[0].DetalleId), id);
    if (resumen && resumen.Acumulado + cantidad > resumen.Objetivo) {
      res.status(400).json({
        error: `Esta captura dejaría ${resumen.Acumulado + cantidad} masters declarados, pero la línea del pedido solo necesita ${resumen.Objetivo} (ya lleva ${resumen.Acumulado} en otras capturas).`,
      });
      return;
    }

    await prisma.$executeRaw`
      UPDATE OrdenEtiquetado SET Lote = ${lote}, PiscinaId = ${Number(PiscinaId)}, Ciclo = ${cicloEfectivo},
        AreaCodigo = ${AreaCodigo}, FechaProduccion = ${FechaProduccion}, Color = ${Color || null},
        Origen = ${Origen}, Congelacion = ${Congelacion}, CantidadMaster = ${cantidad}, Estatus = ${Estatus || "Pendiente"}
      WHERE OrdenId = ${id}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/orden-etiquetado/:id  (corrección de captura)
router.delete("/:id", requireAuth, requirePerm("etiquetado", "eliminar"), async (req: Request, res: Response) => {
  try {
    await prisma.$executeRaw`DELETE FROM OrdenEtiquetado WHERE OrdenId = ${Number(req.params.id)}`;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
