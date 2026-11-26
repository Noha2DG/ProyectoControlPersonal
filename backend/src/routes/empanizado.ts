import { Router, Response } from "express";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm, requireAnyPerm, AuthRequest } from "../middleware/auth.ts";
import { hoyGT } from "../lib/dateGT.ts";
import {
  ErrorEmpanizado, saldoPiso, tomarDelPiso, listarLotes, detalleLote, bajarAlPiso, registrarDescarte,
  deshacerMovimiento, cerrarLote, reabrirLote, reporteProduccion, tiemposProduccion,
} from "../lib/empanizado.ts";
import { ErrorPosicion, asignarPosicion, quitarPosicion, deshacerPosicion, validarFecha } from "../lib/posicionEmpanizado.ts";

// Empanizado (#/empanizado y Catálogos → Mesas de Empanizado). Lógica en lib/empanizado.ts y
// lib/posicionEmpanizado.ts; esquema en scripts/createEmpanizado.ts.
//
// Permisos propios, aparte de Destajo y de Mesas de Pelado:
//   empanizado.ver       ver el piso, los lotes y sus números
//   empanizado.editar    tomar del piso, bajar, descartar, deshacer, cerrar y reabrir lotes
//   empanizado.reporte   reporte de producción por persona (base del pago de Empanizado)
//   mesas_empanizado.ver / editar   catálogo de mesas y bandas y quién está en cada posición
const router = Router();
router.use(requireAuth);

const OPCIONES_TX = { maxWait: 10_000, timeout: 30_000 };
const usuarioDe = (req: AuthRequest) => req.user?.nombre || req.user?.username || "Sistema";
function responder(res: Response, err: any) {
  if (err instanceof ErrorEmpanizado || err instanceof ErrorPosicion) res.status(err.status).json({ error: err.message });
  else res.status(500).json({ error: err.message });
}
function rango(req: AuthRequest, maxDias: number) {
  const hasta = req.query.hasta ? validarFecha(req.query.hasta) : hoyGT();
  const desde = req.query.desde ? validarFecha(req.query.desde) : hasta;
  if (desde > hasta) throw new ErrorEmpanizado(400, "La fecha inicial es posterior a la final");
  if ((Date.parse(hasta) - Date.parse(desde)) / 86400000 > maxDias) throw new ErrorEmpanizado(400, `El rango no puede pasar de ${maxDias} días`);
  return { desde, hasta };
}

// ── Piso y lotes ────────────────────────────────────────────────────────────────────────────────

// GET /api/empanizado/piso — lo que hay al piso de Empanizado (lo que mandó Tratamiento).
router.get("/piso", requirePerm("empanizado", "ver"), async (_req: AuthRequest, res: Response) => {
  try { res.json(await saldoPiso(prisma, undefined, undefined, hoyGT())); } catch (err) { responder(res, err); }
});

// POST /api/empanizado/tomar { lineas: [{ RemisionId, Lote, Clase, Talla, FechaLote, Kg }] }
router.post("/tomar", requirePerm("empanizado", "editar"), async (req: AuthRequest, res: Response) => {
  try {
    const r = await prisma.$transaction(tx => tomarDelPiso(tx, { lineas: req.body?.lineas ?? [], fecha: hoyGT(), operador: usuarioDe(req) }), OPCIONES_TX);
    res.status(201).json(r);
  } catch (err) { responder(res, err); }
});

// GET /api/empanizado/lotes?estado=Abierto | ?estado=Cerrado&desde&hasta (cerrados en ese rango, máx. 62 días)
router.get("/lotes", requirePerm("empanizado", "ver"), async (req: AuthRequest, res: Response) => {
  try {
    if (String(req.query.estado) === "Cerrado") res.json(await listarLotes(prisma, { estado: "Cerrado", ...rango(req, 62) }));
    else res.json(await listarLotes(prisma, { estado: "Abierto" }));
  } catch (err) { responder(res, err); }
});

// GET /api/empanizado/lotes/:id — salidas, movimientos y lo pesado por persona.
router.get("/lotes/:id", requirePerm("empanizado", "ver"), async (req: AuthRequest, res: Response) => {
  try { res.json(await detalleLote(prisma, Number(req.params.id))); } catch (err) { responder(res, err); }
});

// POST /api/empanizado/lotes/:id/bajar { Kg, Talla, Termo, Motivo } — lo que no se trabajó vuelve al
// piso de Empanizado, en el termo indicado.
router.post("/lotes/:id/bajar", requirePerm("empanizado", "editar"), async (req: AuthRequest, res: Response) => {
  try {
    res.json(await prisma.$transaction(tx => bajarAlPiso(tx, Number(req.params.id),
      { kg: req.body?.Kg, talla: req.body?.Talla, termo: req.body?.Termo, motivo: req.body?.Motivo, fecha: hoyGT(), operador: usuarioDe(req) }), OPCIONES_TX));
  } catch (err) { responder(res, err); }
});

// POST /api/empanizado/lotes/:id/descarte { Kg, Motivo }
router.post("/lotes/:id/descarte", requirePerm("empanizado", "editar"), async (req: AuthRequest, res: Response) => {
  try {
    res.json(await prisma.$transaction(tx => registrarDescarte(tx, Number(req.params.id),
      { kg: req.body?.Kg, motivo: req.body?.Motivo, fecha: hoyGT(), operador: usuarioDe(req) }), OPCIONES_TX));
  } catch (err) { responder(res, err); }
});

// DELETE /api/empanizado/movimientos/:id — deshace una toma, un bajado o un descarte.
router.delete("/movimientos/:id", requirePerm("empanizado", "editar"), async (req: AuthRequest, res: Response) => {
  try { res.json(await prisma.$transaction(tx => deshacerMovimiento(tx, Number(req.params.id)), OPCIONES_TX)); }
  catch (err) { responder(res, err); }
});

// POST /api/empanizado/lotes/:id/cerrar — lo pesado pasa al piso de Túnel.
router.post("/lotes/:id/cerrar", requirePerm("empanizado", "editar"), async (req: AuthRequest, res: Response) => {
  try { res.json(await prisma.$transaction(tx => cerrarLote(tx, Number(req.params.id), hoyGT(), usuarioDe(req)), OPCIONES_TX)); }
  catch (err) { responder(res, err); }
});

// POST /api/empanizado/lotes/:id/reabrir — saca de Túnel lo trasladado, si Túnel no lo usó.
router.post("/lotes/:id/reabrir", requirePerm("empanizado", "editar"), async (req: AuthRequest, res: Response) => {
  try { res.json(await prisma.$transaction(tx => reabrirLote(tx, Number(req.params.id)), OPCIONES_TX)); }
  catch (err) { responder(res, err); }
});

// GET /api/empanizado/reporte?desde&hasta — producción por persona (máx. 62 días).
router.get("/reporte", requirePerm("empanizado", "reporte"), async (req: AuthRequest, res: Response) => {
  try {
    const { desde, hasta } = rango(req, 62);
    const [filas, tiempos] = await Promise.all([reporteProduccion(prisma, desde, hasta), tiemposProduccion(prisma, desde, hasta)]);
    res.json({ desde, hasta, filas, tiempos });
  } catch (err) { responder(res, err); }
});

// ── Mesas y bandas (Catálogos → Mesas de Empanizado) ────────────────────────────────────────────
const TIPOS_MESA = ["MESA", "BANDA"];
const verMesas = requireAnyPerm([["mesas_empanizado", "ver"], ["empanizado", "reporte"]]);

function validarMesa(b: any): string | null {
  if (!String(b.Nombre ?? "").trim()) return "El nombre es requerido";
  if (!TIPOS_MESA.includes(b.Tipo)) return "Tipo inválido (mesa o banda)";
  const p = Number(b.Posiciones);
  if (!Number.isInteger(p) || p < 1 || p > 200) return "Las posiciones van de 1 a 200";
  if (b.Orden === "" || b.Orden == null || isNaN(Number(b.Orden))) return "El orden es requerido";
  return null;
}

// GET /api/empanizado/mesas
router.get("/mesas", verMesas, async (_req: AuthRequest, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT m.Codigo, m.Nombre, m.Tipo, m.Posiciones, m.Orden, m.Activa,
             (SELECT COUNT(*) FROM PosicionEmpanizado pe WHERE pe.MesaCodigo = m.Codigo AND pe.FechaFin IS NULL) AS Personas
        FROM MesasEmpanizado m ORDER BY m.Orden, m.Codigo`);
    res.json(rows.map(r => ({ ...r, Posiciones: Number(r.Posiciones), Orden: Number(r.Orden), Activa: Number(r.Activa) === 1, Personas: Number(r.Personas) })));
  } catch (err) { responder(res, err); }
});

// POST /api/empanizado/mesas { Codigo, Nombre, Tipo, Posiciones, Orden }
router.post("/mesas", requirePerm("mesas_empanizado", "editar"), async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body ?? {};
    const codigo = String(b.Codigo ?? "").trim().toUpperCase();
    if (!codigo) throw new ErrorEmpanizado(400, "El código es requerido");
    const e = validarMesa(b);
    if (e) throw new ErrorEmpanizado(400, e);
    await prisma.$executeRawUnsafe(`INSERT INTO MesasEmpanizado (Codigo, Nombre, Tipo, Posiciones, Orden) VALUES (?, ?, ?, ?, ?)`,
      codigo, String(b.Nombre).trim().toUpperCase(), b.Tipo, Number(b.Posiciones), Number(b.Orden));
    res.status(201).json({ ok: true });
  } catch (err: any) {
    if (String(err.message).includes("Duplicate")) res.status(400).json({ error: "Ya existe una mesa con ese código o nombre" });
    else responder(res, err);
  }
});

// PUT /api/empanizado/mesas/:codigo { Nombre, Tipo, Posiciones, Orden, Activa } — el Codigo no cambia.
// No se puede bajar el número de posiciones por debajo de una posición ocupada, ni desactivarla con gente.
router.put("/mesas/:codigo", requirePerm("mesas_empanizado", "editar"), async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body ?? {};
    const e = validarMesa(b);
    if (e) throw new ErrorEmpanizado(400, e);
    const activa = b.Activa === false || b.Activa === 0 ? 0 : 1;
    const [o]: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS n, COALESCE(MAX(Posicion), 0) AS maxPos FROM PosicionEmpanizado WHERE MesaCodigo = ? AND FechaFin IS NULL`, req.params.codigo);
    if (!activa && Number(o.n) > 0) throw new ErrorEmpanizado(400, "La mesa tiene personas asignadas: muévalas antes de desactivarla");
    if (Number(b.Posiciones) < Number(o.maxPos)) throw new ErrorEmpanizado(400, `La posición ${Number(o.maxPos)} está ocupada: no puede dejar menos posiciones`);
    await prisma.$executeRawUnsafe(`UPDATE MesasEmpanizado SET Nombre = ?, Tipo = ?, Posiciones = ?, Orden = ?, Activa = ? WHERE Codigo = ?`,
      String(b.Nombre).trim().toUpperCase(), b.Tipo, Number(b.Posiciones), Number(b.Orden), activa, req.params.codigo);
    res.json({ ok: true });
  } catch (err: any) {
    if (String(err.message).includes("Duplicate")) res.status(400).json({ error: "Ya existe una mesa con ese nombre" });
    else responder(res, err);
  }
});

// GET /api/empanizado/posiciones?fecha= — quién está en cada posición ese día (hoy por omisión).
router.get("/posiciones", verMesas, async (req: AuthRequest, res: Response) => {
  try {
    const fecha = req.query.fecha ? validarFecha(req.query.fecha) : hoyGT();
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT pe.AsignacionId, pe.Codigo, pe.MesaCodigo, pe.Posicion, pe.Motivo,
             DATE_FORMAT(pe.FechaInicio, '%Y-%m-%d') AS FechaInicio, DATE_FORMAT(pe.FechaFin, '%Y-%m-%d') AS FechaFin,
             CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido) AS Nombre
        FROM PosicionEmpanizado pe JOIN Empleados e ON e.Codigo = pe.Codigo
       WHERE pe.FechaInicio <= ? AND (pe.FechaFin IS NULL OR pe.FechaFin >= ?)
       ORDER BY pe.MesaCodigo, pe.Posicion`, fecha, fecha);
    res.json({ fecha, posiciones: rows.map(r => ({ ...r, AsignacionId: Number(r.AsignacionId), Posicion: Number(r.Posicion) })) });
  } catch (err) { responder(res, err); }
});

// GET /api/empanizado/personas — activos con su posición vigente, para el buscador de "Asignar".
router.get("/personas", requirePerm("mesas_empanizado", "ver"), async (_req: AuthRequest, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT e.Codigo, CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido) AS Nombre,
             pe.MesaCodigo, pe.Posicion
        FROM Empleados e
        LEFT JOIN PosicionEmpanizado pe ON pe.Codigo = e.Codigo AND pe.FechaFin IS NULL
       WHERE e.Estado = 'Activo'
       ORDER BY e.PrimerNombre, e.PrimerApellido`);
    res.json(rows.map(r => ({ ...r, Posicion: r.Posicion == null ? null : Number(r.Posicion) })));
  } catch (err) { responder(res, err); }
});

// GET /api/empanizado/posiciones/empleado/:codigo — historial de una persona.
router.get("/posiciones/empleado/:codigo", requirePerm("mesas_empanizado", "ver"), async (req: AuthRequest, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT pe.AsignacionId, pe.MesaCodigo, m.Nombre AS MesaNombre, pe.Posicion, pe.Motivo, pe.MotivoCierre,
             DATE_FORMAT(pe.FechaInicio, '%Y-%m-%d') AS FechaInicio, DATE_FORMAT(pe.FechaFin, '%Y-%m-%d') AS FechaFin,
             pe.RegistradoPor, DATE_FORMAT(pe.CreadoEn, '%Y-%m-%d %H:%i') AS CreadoEn
        FROM PosicionEmpanizado pe JOIN MesasEmpanizado m ON m.Codigo = pe.MesaCodigo
       WHERE pe.Codigo = ? ORDER BY pe.FechaInicio DESC, pe.AsignacionId DESC`, String(req.params.codigo).toUpperCase());
    res.json(rows.map(r => ({ ...r, AsignacionId: Number(r.AsignacionId), Posicion: Number(r.Posicion) })));
  } catch (err) { responder(res, err); }
});

// POST /api/empanizado/posiciones { Codigo, MesaCodigo, Posicion, Fecha, Motivo } — asigna o mueve.
router.post("/posiciones", requirePerm("mesas_empanizado", "editar"), async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body ?? {};
    const r = await prisma.$transaction(tx => asignarPosicion(tx, {
      codigo: b.Codigo, mesa: b.MesaCodigo, posicion: Number(b.Posicion), fecha: b.Fecha || hoyGT(), motivo: b.Motivo, usuario: usuarioDe(req),
    }), OPCIONES_TX);
    res.status(201).json(r);
  } catch (err) { responder(res, err); }
});

// PUT /api/empanizado/posiciones/:codigo/quitar { UltimoDia, Motivo }
router.put("/posiciones/:codigo/quitar", requirePerm("mesas_empanizado", "editar"), async (req: AuthRequest, res: Response) => {
  try {
    res.json(await prisma.$transaction(tx => quitarPosicion(tx, {
      codigo: String(req.params.codigo), ultimoDia: req.body?.UltimoDia || hoyGT(), motivo: req.body?.Motivo,
    }), OPCIONES_TX));
  } catch (err) { responder(res, err); }
});

// DELETE /api/empanizado/posiciones/:id — deshace una asignación vigente capturada por error.
router.delete("/posiciones/:id", requirePerm("mesas_empanizado", "editar"), async (req: AuthRequest, res: Response) => {
  try { res.json(await prisma.$transaction(tx => deshacerPosicion(tx, Number(req.params.id)), OPCIONES_TX)); }
  catch (err) { responder(res, err); }
});

export default router;
