import { Router, Request, Response } from "express";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm, AuthRequest } from "../middleware/auth.ts";
import { hoyGT, nowGT } from "../lib/dateGT.ts";
import { asignarMesa, quitarDeMesa, deshacerAsignacion, validarFecha, ErrorMesa } from "../lib/mesaAsignacion.ts";
// El cálculo de Lb/Hora vive en el frontend (utils/destajo.js es el ÚNICO
// cálculo de Lb/Hora: lo usan el Reporte, el kiosco y la vista de mesas). El servidor importa ese
// mismo archivo para los días anteriores de la gráfica en vez de copiarlo: dos copias terminarían
// dando dos números distintos para la misma mesa. Son JS puro, sin nada del navegador.
import { resumenDelDia } from "../../../frontend/src/utils/mesas.js";

// Mesas de pelado: catálogo (backend/scripts/createMesas.ts), personas asignadas a cada mesa
// (backend/scripts/createMesaAsignacion.ts) y la producción del día por mesa.
//
// Permisos, todos del módulo `mesas` y no de `catalogos` ni `destajo`:
//   ver / crear / editar / eliminar → la supervisora de pelado administra mesas y personas.
//   reporte → supervisores que consultan la producción del día por mesa (pestaña de Destajo y QR).
const router = Router();

const TIPOS = ["PELADORAS", "APRENDIZAJE", "BANDA"];
// Áreas que cuentan para mesas y Banda: solo Pelado y Devenado y Descabezado. Reproceso y Pinchado
// son otra gente y otro ritmo (igual criterio que el ranking de pared, que también los separa).
const AREAS_MESA = ["DS", "DU"];
// Las operaciones de asignación hacen 6-10 consultas seguidas dentro de una transacción. El límite
// por defecto de Prisma (5 s) se agotaba con la base lejos (desde una PC de desarrollo cada consulta
// tarda cientos de ms) y la asignación fallaba con "Transaction already closed".
const OPCIONES_TX = { maxWait: 10_000, timeout: 30_000 };

function aNumero(rows: any[]) {
  return rows.map(r => ({ ...r, Orden: Number(r.Orden), Activa: Number(r.Activa) === 1 }));
}

function validar(body: any): string | null {
  if (!body.Nombre?.trim()) return "El nombre es requerido";
  if (!TIPOS.includes(body.Tipo)) return "Tipo de mesa inválido";
  if (body.Orden === "" || body.Orden == null || isNaN(Number(body.Orden))) return "El orden es requerido";
  return null;
}

function usuarioDe(req: Request): string {
  const u = (req as AuthRequest).user;
  return u?.nombre || u?.username || "Sistema";
}

function responderError(res: Response, err: any) {
  if (err instanceof ErrorMesa) res.status(err.status).json({ error: err.message });
  else res.status(500).json({ error: err.message });
}

async function personasVigentesEn(mesa: string): Promise<number> {
  const r: any[] = await prisma.$queryRaw`SELECT COUNT(*) AS n FROM MesaAsignacion WHERE MesaCodigo = ${mesa} AND FechaFin IS NULL`;
  return Number(r[0].n);
}

// ── Catálogo ─────────────────────────────────────────────────────────

// GET /api/mesas
router.get("/", requireAuth, requirePerm("mesas", "ver"), async (_req: Request, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT m.Codigo, m.Nombre, m.Tipo, m.Orden, m.Activa,
             (SELECT COUNT(*) FROM MesaAsignacion ma WHERE ma.MesaCodigo = m.Codigo AND ma.FechaFin IS NULL) AS Personas
      FROM Mesas m ORDER BY m.Orden ASC, m.Codigo ASC
    `;
    res.json(aNumero(rows).map(r => ({ ...r, Personas: Number(r.Personas) })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/mesas
router.post("/", requireAuth, requirePerm("mesas", "crear"), async (req: Request, res: Response) => {
  try {
    const { Codigo, Nombre, Tipo, Orden } = req.body;
    const codigo = String(Codigo ?? "").trim().toUpperCase();
    if (!codigo) { res.status(400).json({ error: "El código es requerido" }); return; }
    const error = validar(req.body);
    if (error) { res.status(400).json({ error }); return; }
    await prisma.$executeRaw`
      INSERT INTO Mesas (Codigo, Nombre, Tipo, Orden)
      VALUES (${codigo}, ${Nombre.trim().toUpperCase()}, ${Tipo}, ${Number(Orden)})
    `;
    limpiarCacheHoy();
    res.status(201).json({ ok: true });
  } catch (err: any) {
    if (err.message?.includes("Duplicate")) res.status(400).json({ error: "Ya existe una mesa con ese código o nombre" });
    else res.status(500).json({ error: err.message });
  }
});

// PUT /api/mesas/:codigo — el Codigo no se edita: es la llave de la mesa y lo referencian las
// asignaciones y el QR impreso.
router.put("/:codigo", requireAuth, requirePerm("mesas", "editar"), async (req: Request, res: Response) => {
  try {
    const { Nombre, Tipo, Orden, Activa } = req.body;
    const error = validar(req.body);
    if (error) { res.status(400).json({ error }); return; }
    const activa = Activa === false || Activa === 0 ? 0 : 1;
    if (!activa && await personasVigentesEn(req.params.codigo) > 0) {
      res.status(400).json({ error: "La mesa tiene personas asignadas: muévelas antes de desactivarla" });
      return;
    }
    await prisma.$executeRaw`
      UPDATE Mesas SET Nombre = ${Nombre.trim().toUpperCase()}, Tipo = ${Tipo}, Orden = ${Number(Orden)}, Activa = ${activa}
      WHERE Codigo = ${req.params.codigo}
    `;
    limpiarCacheHoy();
    res.json({ ok: true });
  } catch (err: any) {
    if (err.message?.includes("Duplicate")) res.status(400).json({ error: "Ya existe una mesa con ese nombre" });
    else res.status(500).json({ error: err.message });
  }
});

// DELETE /api/mesas/:codigo → baja lógica; no se permite con personas asignadas.
router.delete("/:codigo", requireAuth, requirePerm("mesas", "eliminar"), async (req: Request, res: Response) => {
  try {
    if (await personasVigentesEn(req.params.codigo) > 0) {
      res.status(400).json({ error: "La mesa tiene personas asignadas: muévelas antes de desactivarla" });
      return;
    }
    await prisma.$executeRaw`UPDATE Mesas SET Activa = 0 WHERE Codigo = ${req.params.codigo}`;
    limpiarCacheHoy();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Personas por mesa ────────────────────────────────────────────────

// GET /api/mesas/asignaciones?fecha=YYYY-MM-DD — quién está en cada mesa ese día (hoy por defecto).
router.get("/asignaciones", requireAuth, requirePerm("mesas", "ver"), async (req: Request, res: Response) => {
  try {
    const fecha = req.query.fecha ? validarFecha(req.query.fecha) : hoyGT();
    const rows: any[] = await prisma.$queryRaw`
      SELECT ma.AsignacionId, ma.Codigo, ma.MesaCodigo, ma.EsLider, ma.Motivo,
             DATE_FORMAT(ma.FechaInicio, '%Y-%m-%d') AS FechaInicio, DATE_FORMAT(ma.FechaFin, '%Y-%m-%d') AS FechaFin,
             CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido) AS Nombre,
             e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido
      FROM MesaAsignacion ma
      JOIN Empleados e ON e.Codigo = ma.Codigo
      WHERE ma.FechaInicio <= ${fecha} AND (ma.FechaFin IS NULL OR ma.FechaFin >= ${fecha})
      ORDER BY ma.MesaCodigo, ma.EsLider DESC, e.PrimerNombre
    `;
    res.json({ fecha, asignaciones: rows.map(r => ({ ...r, AsignacionId: Number(r.AsignacionId), EsLider: Number(r.EsLider) === 1 })) });
  } catch (err: any) {
    responderError(res, err);
  }
});

// GET /api/mesas/sin-mesa?dias=14 — la franja "Banda temporal" del tablero: activos que pesaron en Pelado o
// Descabezado en los últimos N días (incluido hoy) y hoy no tienen mesa. Es de donde la supervisora
// saca a quién asignar; también delata a quien se quedó fuera de la carga por olvido.
router.get("/sin-mesa", requireAuth, requirePerm("mesas", "ver"), async (req: Request, res: Response) => {
  try {
    const dias = Math.min(Math.max(Number(req.query.dias) || 14, 1), 60);
    const hoy = hoyGT();
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT x.Codigo, e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido,
             CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido) AS Nombre,
             COUNT(*) AS Pesadas, DATE_FORMAT(MAX(x.FechaHora), '%Y-%m-%d') AS UltimoDia,
             SUM(x.FechaHora >= ?) AS PesadasHoy
      FROM (
        SELECT pd.Codigo, pd.FechaHora,
               (SELECT tr.CodigoArea FROM Transferencias tr
                WHERE tr.Codigo = pd.Codigo AND tr.FechaHora <= pd.FechaHora
                  AND (tr.FechaSalida IS NULL OR tr.FechaSalida >= pd.FechaHora)
                ORDER BY tr.FechaHora DESC LIMIT 1) AS CodigoArea
        FROM PesajeDetalle pd
        WHERE pd.FechaHora >= DATE_SUB(?, INTERVAL ? DAY) AND pd.FechaHora < DATE_ADD(?, INTERVAL 1 DAY)
      ) x
      JOIN Empleados e ON e.Codigo = x.Codigo AND e.Estado = 'Activo'
      WHERE x.CodigoArea IN (${AREAS_MESA.map(() => "?").join(",")})
        AND NOT EXISTS (SELECT 1 FROM MesaAsignacion ma
                        WHERE ma.Codigo = x.Codigo AND (ma.FechaFin IS NULL OR ma.FechaFin >= ?))
      GROUP BY x.Codigo
      ORDER BY UltimoDia DESC, Pesadas DESC
    `, hoy, hoy, dias - 1, hoy, ...AREAS_MESA, hoy);
    res.json(rows.map(r => ({ ...r, Pesadas: Number(r.Pesadas), PesadasHoy: Number(r.PesadasHoy) })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/mesas/personas — activos con su mesa vigente (si tiene), para el buscador de "Asignar".
// Endpoint propio en vez de /api/empleados: este solo devuelve código y nombre, no DPI ni teléfonos.
router.get("/personas", requireAuth, requirePerm("mesas", "ver"), async (_req: Request, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT e.Codigo, CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido) AS Nombre,
             ma.MesaCodigo
      FROM Empleados e
      LEFT JOIN MesaAsignacion ma ON ma.Codigo = e.Codigo AND ma.FechaFin IS NULL
      WHERE e.Estado = 'Activo'
      ORDER BY e.PrimerNombre, e.PrimerApellido
    `;
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/mesas/asignaciones/empleado/:codigo — historial de mesas de una persona.
router.get("/asignaciones/empleado/:codigo", requireAuth, requirePerm("mesas", "ver"), async (req: Request, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT ma.AsignacionId, ma.MesaCodigo, m.Nombre AS MesaNombre, ma.EsLider, ma.Motivo, ma.MotivoCierre,
             DATE_FORMAT(ma.FechaInicio, '%Y-%m-%d') AS FechaInicio, DATE_FORMAT(ma.FechaFin, '%Y-%m-%d') AS FechaFin,
             ma.RegistradoPor, DATE_FORMAT(ma.CreadoEn, '%Y-%m-%d %H:%i') AS CreadoEn
      FROM MesaAsignacion ma JOIN Mesas m ON m.Codigo = ma.MesaCodigo
      WHERE ma.Codigo = ${String(req.params.codigo).toUpperCase()}
      ORDER BY ma.FechaInicio DESC, ma.AsignacionId DESC
    `;
    res.json(rows.map(r => ({ ...r, AsignacionId: Number(r.AsignacionId), EsLider: Number(r.EsLider) === 1 })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/mesas/asignaciones { Codigo, MesaCodigo, EsLider, Fecha, Motivo }
// Asigna, mueve o cambia el liderazgo desde Fecha (hoy por defecto). Reglas en lib/mesaAsignacion.ts.
router.post("/asignaciones", requireAuth, requirePerm("mesas", "editar"), async (req: Request, res: Response) => {
  try {
    const { Codigo, MesaCodigo, EsLider, Fecha, Motivo } = req.body;
    const r = await prisma.$transaction(tx => asignarMesa(tx, {
      codigo: Codigo, mesa: MesaCodigo, esLider: EsLider === true || EsLider === 1,
      fecha: Fecha || hoyGT(), motivo: Motivo, usuario: usuarioDe(req),
    }), OPCIONES_TX);
    limpiarCacheHoy();
    res.status(201).json({ ok: true, ...r });
  } catch (err: any) {
    responderError(res, err);
  }
});

// PUT /api/mesas/asignaciones/:codigo/cerrar { UltimoDia, Motivo } — saca a la persona de su mesa;
// UltimoDia es el último día que cuenta para esa mesa (hoy por defecto). Después, si pesa, es Banda temporal.
router.put("/asignaciones/:codigo/cerrar", requireAuth, requirePerm("mesas", "editar"), async (req: Request, res: Response) => {
  try {
    await prisma.$transaction(tx => quitarDeMesa(tx, {
      codigo: req.params.codigo, ultimoDia: req.body?.UltimoDia || hoyGT(), motivo: req.body?.Motivo,
    }), OPCIONES_TX);
    limpiarCacheHoy();
    res.json({ ok: true });
  } catch (err: any) {
    responderError(res, err);
  }
});

// DELETE /api/mesas/asignaciones/:id — deshace una asignación vigente capturada por error.
router.delete("/asignaciones/:id", requireAuth, requirePerm("mesas", "eliminar"), async (req: Request, res: Response) => {
  try {
    const r = await prisma.$transaction(tx => deshacerAsignacion(tx, Number(req.params.id)), OPCIONES_TX);
    limpiarCacheHoy();
    res.json({ ok: true, ...r });
  } catch (err: any) {
    responderError(res, err);
  }
});

// ── Producción del día por mesa ──────────────────────────────────────

// GET /api/mesas/hoy — todo lo necesario para la pestaña "Por Mesa" de Destajo y la página del QR
// (#/mesa/:codigo): mesas, integrantes del día, pesadas de hoy en Pelado/Descabezado con la mesa de
// cada persona (null = Banda temporal) y las pausas que no generan paga. La Lb/Hora la calcula el navegador
// con calcularLbHora (utils/destajo.js), la misma función del Reporte de Producción y del kiosco.
//
// Solo el día actual y la fecha la pone el servidor: no hay parámetro, así que nadie consulta otro
// día cambiando la dirección. Para rangos de fechas está el Reporte.
//
// Un solo resultado en memoria por día, compartido por todos (los QR y la pestaña refrescan cada
// 2 min): la base trabaja como mucho una vez por minuto sin importar cuántos lo tengan abierto.
// Se limpia al cambiar asignaciones o el catálogo para que la supervisora vea su cambio al instante.
const CACHE_HOY_MS = 60_000;
const cacheHoy = new Map<string, { en: number; datos?: any; vuelo?: Promise<any> }>();
// Días anteriores de la gráfica: ya no cambian (salvo una corrección de pesaje o de mesa con fecha
// pasada, que también limpia esta caché), así que se calculan una vez cada 30 min como mucho.
const CACHE_DIA_MS = 30 * 60_000;
const cacheDia = new Map<string, { en: number; datos: any }>();
function limpiarCacheHoy() { cacheHoy.clear(); cacheDia.clear(); }

// Pesadas de un día en Pelado/Descabezado con la mesa de cada persona ESE día, y sus pausas. Lo
// comparten el día de hoy (/hoy) y los días anteriores (/historial).
async function pesadasDelDia(fecha: string) {
  // El área de cada pesada es la Transferencia vigente en ese momento (mismo criterio que el
  // Reporte); se resuelve UNA vez por pesada (TrId) y se une afuera para sacar área y hora de entrada.
  // Las pesadas sin área (sin marcaje) se incluyen: suman libras pero no horas, y la vista lo avisa.
  const pesadas: any[] = await prisma.$queryRawUnsafe(`
    SELECT x.Codigo AS IdEmpleado, e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido,
           x.FechaHora, DATE_FORMAT(x.FechaHora, '%H:%i') AS Hora, x.Peso AS Kilos,
           a.Nombre AS Area, tr.FechaHora AS EntradaArea,
           tp.Talla, ta.Descripcion AS DescripcionTalla, cl.Descripcion AS Producto,
           ma.MesaCodigo, ma.EsLider
    FROM (
      SELECT pd.Codigo, pd.FechaHora, pd.Peso, pd.TransaccionId,
             (SELECT tr2.id FROM Transferencias tr2
              WHERE tr2.Codigo = pd.Codigo AND tr2.FechaHora <= pd.FechaHora
                AND (tr2.FechaSalida IS NULL OR tr2.FechaSalida >= pd.FechaHora)
              ORDER BY tr2.FechaHora DESC LIMIT 1) AS TrId
      FROM PesajeDetalle pd
      WHERE pd.FechaHora >= ? AND pd.FechaHora < DATE_ADD(?, INTERVAL 1 DAY)
    ) x
    JOIN Empleados e ON e.Codigo = x.Codigo
    JOIN TransaccionesProduccion tp ON tp.TransaccionId = x.TransaccionId
    JOIN Clase cl ON cl.Clase = tp.ClasePT
    JOIN Tallas ta ON ta.Codigo = tp.Talla
    LEFT JOIN Transferencias tr ON tr.id = x.TrId
    LEFT JOIN Areas a ON a.Codigo = tr.CodigoArea
    LEFT JOIN MesaAsignacion ma ON ma.Codigo = x.Codigo AND ma.FechaInicio <= ? AND (ma.FechaFin IS NULL OR ma.FechaFin >= ?)
    WHERE x.TrId IS NULL OR tr.CodigoArea IN (${AREAS_MESA.map(() => "?").join(",")})
    ORDER BY x.FechaHora
  `, fecha, fecha, fecha, fecha, ...AREAS_MESA);
  // Pausas solo de quien pesó ese día: las de toda la planta casi duplicaban el tamaño de la
  // respuesta (487 contra 277 el 6 oct) sin cambiar ningún número.
  const pausas: any[] = await prisma.$queryRaw`
    SELECT tr.Codigo AS IdEmpleado, tr.FechaHora, tr.FechaSalida
    FROM Transferencias tr JOIN Areas a ON tr.CodigoArea = a.Codigo
    WHERE a.FormaPago = 'No Genera Paga'
      AND tr.FechaHora < DATE_ADD(${fecha}, INTERVAL 1 DAY)
      AND (tr.FechaSalida IS NULL OR tr.FechaSalida >= ${fecha})
      AND tr.Codigo IN (SELECT DISTINCT Codigo FROM PesajeDetalle
                        WHERE FechaHora >= ${fecha} AND FechaHora < DATE_ADD(${fecha}, INTERVAL 1 DAY))
  `;
  return {
    pesadas: pesadas.map(p => ({ ...p, Kilos: Number(p.Kilos), Talla: p.Talla != null ? Number(p.Talla) : null, EsLider: Number(p.EsLider) === 1 })),
    pausas,
  };
}

async function consultarHoy(fecha: string) {
  const mesas: any[] = await prisma.$queryRaw`
    SELECT Codigo, Nombre, Tipo, Orden FROM Mesas WHERE Activa = 1 ORDER BY Orden, Codigo
  `;
  const integrantes: any[] = await prisma.$queryRaw`
    SELECT ma.Codigo, ma.MesaCodigo, ma.EsLider, e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido
    FROM MesaAsignacion ma JOIN Empleados e ON e.Codigo = ma.Codigo
    WHERE ma.FechaInicio <= ${fecha} AND (ma.FechaFin IS NULL OR ma.FechaFin >= ${fecha})
  `;
  const { pesadas, pausas } = await pesadasDelDia(fecha);
  return {
    fecha,
    generado: nowGT(),
    mesas: mesas.map(m => ({ ...m, Orden: Number(m.Orden) })),
    integrantes: integrantes.map(i => ({ ...i, EsLider: Number(i.EsLider) === 1 })),
    pesadas,
    pausas,
  };
}

router.get("/hoy", requireAuth, requirePerm("mesas", "reporte"), async (_req: Request, res: Response) => {
  try {
    const fecha = hoyGT();
    let hit = cacheHoy.get(fecha);
    if (hit?.datos && Date.now() - hit.en < CACHE_HOY_MS) { res.json(hit.datos); return; }
    if (!hit?.vuelo) {
      const vuelo = consultarHoy(fecha);
      hit = { en: hit?.en ?? 0, datos: hit?.datos, vuelo };
      cacheHoy.set(fecha, hit);
      vuelo.then(datos => cacheHoy.set(fecha, { en: Date.now(), datos }), () => cacheHoy.delete(fecha));
    }
    res.json(await hit.vuelo);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/mesas/historial — los 5 días ANTERIORES a hoy en que hubo pesaje, resumidos por mesa
// (libras, libra y hora válidas). El día de hoy NO va aquí: la gráfica lo
// toma de /hoy, el mismo cálculo de la parte de arriba, para que el punto de hoy y el % de arriba
// sean siempre el mismo número. Se saltan los días sin producción (domingos) para no dibujar ceros.
const DIAS_HISTORIAL = 5;
router.get("/historial", requireAuth, requirePerm("mesas", "reporte"), async (_req: Request, res: Response) => {
  try {
    const hoy = hoyGT();
    const fechas: any[] = await prisma.$queryRaw`
      SELECT DISTINCT DATE_FORMAT(FechaHora, '%Y-%m-%d') AS Dia FROM PesajeDetalle
      WHERE FechaHora >= DATE_SUB(${hoy}, INTERVAL 21 DAY) AND FechaHora < ${hoy}
      ORDER BY Dia DESC LIMIT ${DIAS_HISTORIAL}
    `;
    const dias = [];
    for (const { Dia } of fechas.reverse()) {
      let hit = cacheDia.get(Dia);
      if (!hit || Date.now() - hit.en > CACHE_DIA_MS) {
        const { pesadas, pausas } = await pesadasDelDia(Dia);
        hit = { en: Date.now(), datos: { fecha: Dia, mesas: resumenDelDia(pesadas, pausas) } };
        cacheDia.set(Dia, hit);
      }
      dias.push(hit.datos);
    }
    res.json({ hoy, dias });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
