import { Router, Request, Response } from "express";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm, AuthRequest } from "../middleware/auth.ts";
import { hoyGT } from "../lib/dateGT.ts";
import {
  ErrorTarifa, validarFecha, guardarBorrador, eliminarBorrador, aprobarVersion, anularVersion,
  asignarGrupo, cerrarGrupo, deshacerGrupo, agregarSalario, deshacerSalario, tarifaAplicable, tarifaDeArea,
  TipoAsignacion,
} from "../lib/tarifas.ts";

// Tarifas de destajo (Catálogos → Tarifas). Tablas y reglas en backend/scripts/createTarifas.ts y
// backend/src/lib/tarifas.ts. Es dinero, así que tiene permiso propio `tarifas`, aparte de
// `catalogos` y `destajo`:
//   ver     → consultar tarifas, historial, clases/áreas por grupo y salario mínimo.
//   editar  → preparar versiones en BORRADOR, grupos y clases/áreas por grupo.
//   aprobar → aprobar o anular versiones, y registrar el salario mínimo (lo que mueve el pago).
// Modalidades (OBRA / TIEMPO / POOL): ver backend/scripts/alterTarifasModalidad.ts.
const router = Router();
const OPCIONES_TX = { maxWait: 10_000, timeout: 30_000 };
const UNIDADES = ["LB", "KG", "CAJA", "MASTER", "PIEZA", "HORA"];
const MODALIDADES = ["OBRA", "TIEMPO", "POOL"];

function usuarioDe(req: Request): string {
  const u = (req as AuthRequest).user;
  return u?.nombre || u?.username || "Sistema";
}

function responderError(res: Response, err: any) {
  if (err instanceof ErrorTarifa) res.status(err.status).json({ error: err.message });
  else if (err.message?.includes("Duplicate")) res.status(400).json({ error: "Ya existe un registro igual" });
  else res.status(500).json({ error: err.message });
}

// GET /api/tarifas/opciones — tallas activas, clases y áreas para los formularios (sin pedir
// permisos de Catálogos).
router.get("/opciones", requireAuth, requirePerm("tarifas", "ver"), async (_req, res) => {
  try {
    const tallas: any[] = await prisma.$queryRaw`SELECT Codigo, Descripcion FROM Tallas WHERE Activo = 1 ORDER BY Codigo`;
    const clases: any[] = await prisma.$queryRaw`SELECT Clase, Descripcion FROM Clase WHERE Activo = 1 ORDER BY Clase`;
    const areas: any[] = await prisma.$queryRaw`SELECT Codigo, Nombre FROM Areas ORDER BY Nombre`;
    res.json({ tallas: tallas.map(t => ({ ...t, Codigo: Number(t.Codigo) })), clases, areas, unidades: UNIDADES, modalidades: MODALIDADES, hoy: hoyGT() });
  } catch (err: any) { responderError(res, err); }
});

// ── Grupos ───────────────────────────────────────────────────────────

router.get("/grupos", requireAuth, requirePerm("tarifas", "ver"), async (_req, res) => {
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT g.Grupo, g.Descripcion, g.Modalidad, g.UnidadPago, g.BaseMinimo, g.Orden, g.Activo,
             (SELECT COUNT(*) FROM TarifaGrupoClase c WHERE c.Grupo = g.Grupo AND c.VigenteHasta IS NULL) AS Clases,
             (SELECT COUNT(*) FROM TarifaGrupoArea a WHERE a.Grupo = g.Grupo AND a.VigenteHasta IS NULL) AS Areas,
             (SELECT COUNT(*) FROM TarifaVersion v WHERE v.Grupo = g.Grupo) AS Versiones
      FROM TarifaGrupo g
      ORDER BY g.Orden, g.Grupo`;
    res.json(rows.map(r => ({
      ...r, Orden: Number(r.Orden), Activo: Number(r.Activo) === 1, BaseMinimo: Number(r.BaseMinimo) === 1,
      Clases: Number(r.Clases), Areas: Number(r.Areas), Versiones: Number(r.Versiones),
    })));
  } catch (err: any) { responderError(res, err); }
});

// Devuelve los valores limpios. BaseMinimo solo tiene sentido en TIEMPO (la hora sale del mínimo, por
// eso la unidad es HORA); en OBRA/POOL se ignora.
function validarGrupo(b: any) {
  if (!String(b.Descripcion ?? "").trim()) throw new ErrorTarifa(400, "La descripción es requerida");
  if (!MODALIDADES.includes(b.Modalidad)) throw new ErrorTarifa(400, "Modalidad inválida");
  if (!UNIDADES.includes(b.UnidadPago)) throw new ErrorTarifa(400, "Unidad de pago inválida");
  const baseMinimo = b.Modalidad === "TIEMPO" && (b.BaseMinimo === true || b.BaseMinimo === 1) ? 1 : 0;
  if (b.Modalidad === "TIEMPO" && b.UnidadPago !== "HORA") throw new ErrorTarifa(400, "Un grupo por tiempo se paga por HORA");
  if (b.Modalidad !== "TIEMPO" && b.UnidadPago === "HORA") throw new ErrorTarifa(400, "Solo un grupo por tiempo se paga por HORA");
  return { descripcion: String(b.Descripcion).trim().toUpperCase(), baseMinimo, orden: Number(b.Orden) || 0 };
}

router.post("/grupos", requireAuth, requirePerm("tarifas", "editar"), async (req, res) => {
  try {
    const grupo = String(req.body.Grupo ?? "").trim().toUpperCase().replace(/\s+/g, "_");
    if (!/^[A-Z0-9_]{2,20}$/.test(grupo)) throw new ErrorTarifa(400, "El código del grupo: 2 a 20 letras, números o _");
    const v = validarGrupo(req.body);
    await prisma.$executeRaw`
      INSERT INTO TarifaGrupo (Grupo, Descripcion, Modalidad, UnidadPago, BaseMinimo, Orden)
      VALUES (${grupo}, ${v.descripcion}, ${req.body.Modalidad}, ${req.body.UnidadPago}, ${v.baseMinimo}, ${v.orden})`;
    res.status(201).json({ ok: true });
  } catch (err: any) { responderError(res, err); }
});

// El código no se edita: lo referencian versiones, clases y áreas. La modalidad, la unidad y "basada
// en el mínimo" tampoco, una vez que el grupo tiene versiones, clases o áreas: cambiarlas cambiaría
// cómo se pagaron días pasados. Para eso se crea otro grupo y se le pasan las áreas desde una fecha.
router.put("/grupos/:grupo", requireAuth, requirePerm("tarifas", "editar"), async (req, res) => {
  try {
    const v = validarGrupo(req.body);
    const { Modalidad, UnidadPago, Activo } = req.body;
    const actual: any[] = await prisma.$queryRaw`
      SELECT g.Modalidad, g.UnidadPago, g.BaseMinimo,
             (SELECT COUNT(*) FROM TarifaVersion x WHERE x.Grupo = g.Grupo)
           + (SELECT COUNT(*) FROM TarifaGrupoClase x WHERE x.Grupo = g.Grupo)
           + (SELECT COUNT(*) FROM TarifaGrupoArea x WHERE x.Grupo = g.Grupo) AS Usos
      FROM TarifaGrupo g WHERE g.Grupo = ${req.params.grupo}`;
    if (!actual.length) throw new ErrorTarifa(404, "El grupo no existe");
    const a = actual[0];
    const cambiaForma = a.Modalidad !== Modalidad || a.UnidadPago !== UnidadPago || Number(a.BaseMinimo) !== v.baseMinimo;
    if (cambiaForma && Number(a.Usos) > 0) {
      throw new ErrorTarifa(400, "El grupo ya tiene versiones, clases o áreas: su forma de pago no se cambia. Crea otro grupo y pásale las áreas desde una fecha.");
    }
    await prisma.$executeRaw`
      UPDATE TarifaGrupo SET Descripcion = ${v.descripcion}, Modalidad = ${Modalidad}, UnidadPago = ${UnidadPago},
             BaseMinimo = ${v.baseMinimo}, Orden = ${v.orden}, Activo = ${Activo === false || Activo === 0 ? 0 : 1}
      WHERE Grupo = ${req.params.grupo}`;
    res.json({ ok: true });
  } catch (err: any) { responderError(res, err); }
});

// ── Clases y áreas por grupo ─────────────────────────────────────────
// /clases → TarifaGrupoClase (grupos OBRA); /areas → TarifaGrupoArea (grupos TIEMPO y POOL).
// Mismas reglas de vigencia para las dos (lib/tarifas.ts → asignarGrupo).

// GET /api/tarifas/clases?todas=1 — vigentes por defecto; con todas=1 el historial completo.
router.get("/clases", requireAuth, requirePerm("tarifas", "ver"), async (req, res) => {
  try {
    const todas = req.query.todas === "1";
    const rows: any[] = await prisma.$queryRaw`
      SELECT gc.GrupoClaseId AS Id, gc.Clase AS Codigo, c.Descripcion, gc.Grupo, g.Descripcion AS GrupoDescripcion,
             DATE_FORMAT(gc.VigenteDesde, '%Y-%m-%d') AS VigenteDesde, DATE_FORMAT(gc.VigenteHasta, '%Y-%m-%d') AS VigenteHasta,
             gc.CreadoPor
      FROM TarifaGrupoClase gc JOIN Clase c ON c.Clase = gc.Clase JOIN TarifaGrupo g ON g.Grupo = gc.Grupo
      WHERE (${todas ? 1 : 0} = 1 OR gc.VigenteHasta IS NULL)
      ORDER BY g.Orden, gc.Clase, gc.VigenteDesde DESC`;
    res.json(rows);
  } catch (err: any) { responderError(res, err); }
});

// GET /api/tarifas/areas?todas=1
router.get("/areas", requireAuth, requirePerm("tarifas", "ver"), async (req, res) => {
  try {
    const todas = req.query.todas === "1";
    const rows: any[] = await prisma.$queryRaw`
      SELECT ga.GrupoAreaId AS Id, ga.AreaCodigo AS Codigo, a.Nombre AS Descripcion, ga.Grupo, g.Descripcion AS GrupoDescripcion,
             g.Modalidad, DATE_FORMAT(ga.VigenteDesde, '%Y-%m-%d') AS VigenteDesde, DATE_FORMAT(ga.VigenteHasta, '%Y-%m-%d') AS VigenteHasta,
             ga.CreadoPor
      FROM TarifaGrupoArea ga JOIN Areas a ON a.Codigo = ga.AreaCodigo JOIN TarifaGrupo g ON g.Grupo = ga.Grupo
      WHERE (${todas ? 1 : 0} = 1 OR ga.VigenteHasta IS NULL)
      ORDER BY g.Orden, a.Nombre, ga.VigenteDesde DESC`;
    res.json(rows);
  } catch (err: any) { responderError(res, err); }
});

for (const [ruta, tipo] of [["clases", "clase"], ["areas", "area"]] as [string, TipoAsignacion][]) {
  router.post(`/${ruta}`, requireAuth, requirePerm("tarifas", "editar"), async (req, res) => {
    try {
      await prisma.$transaction(tx => asignarGrupo(tx, tipo, req.body, usuarioDe(req)), OPCIONES_TX);
      res.status(201).json({ ok: true });
    } catch (err: any) { responderError(res, err); }
  });

  router.put(`/${ruta}/:id/cerrar`, requireAuth, requirePerm("tarifas", "editar"), async (req, res) => {
    try {
      await prisma.$transaction(tx => cerrarGrupo(tx, tipo, Number(req.params.id), req.body.VigenteHasta), OPCIONES_TX);
      res.json({ ok: true });
    } catch (err: any) { responderError(res, err); }
  });

  router.delete(`/${ruta}/:id`, requireAuth, requirePerm("tarifas", "editar"), async (req, res) => {
    try {
      await prisma.$transaction(tx => deshacerGrupo(tx, tipo, Number(req.params.id)), OPCIONES_TX);
      res.json({ ok: true });
    } catch (err: any) { responderError(res, err); }
  });
}

// ── Versiones ────────────────────────────────────────────────────────

// GET /api/tarifas/versiones?grupo=PD_TOFF — historial de versiones (la más nueva primero).
router.get("/versiones", requireAuth, requirePerm("tarifas", "ver"), async (req, res) => {
  try {
    const grupo = String(req.query.grupo ?? "");
    const rows: any[] = await prisma.$queryRaw`
      SELECT v.VersionId, v.Grupo, v.Estado, v.Motivo,
             DATE_FORMAT(v.VigenteDesde, '%Y-%m-%d') AS VigenteDesde, DATE_FORMAT(v.VigenteHasta, '%Y-%m-%d') AS VigenteHasta,
             v.CreadoPor, DATE_FORMAT(v.CreadoEn, '%Y-%m-%d %H:%i') AS CreadoEn,
             v.AprobadoPor, DATE_FORMAT(v.AprobadoEn, '%Y-%m-%d %H:%i') AS AprobadoEn,
             v.AnuladoPor, DATE_FORMAT(v.AnuladoEn, '%Y-%m-%d %H:%i') AS AnuladoEn,
             (SELECT COUNT(*) FROM Tarifas t WHERE t.VersionId = v.VersionId) AS Tallas
      FROM TarifaVersion v
      WHERE (${grupo} = '' OR v.Grupo = ${grupo})
      ORDER BY v.VigenteDesde DESC, v.VersionId DESC`;
    const hoy = hoyGT();
    res.json(rows.map(r => ({
      ...r, Tallas: Number(r.Tallas),
      Vigente: r.Estado === "APROBADO" && r.VigenteDesde <= hoy && (!r.VigenteHasta || r.VigenteHasta >= hoy),
    })));
  } catch (err: any) { responderError(res, err); }
});

// GET /api/tarifas/versiones/:id — encabezado, tallas y el salario mínimo vigente al inicio de la
// versión (la pantalla calcula con él la meta del día y la Lb/hr de cada talla).
router.get("/versiones/:id", requireAuth, requirePerm("tarifas", "ver"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const v: any[] = await prisma.$queryRaw`
      SELECT v.VersionId, v.Grupo, g.Descripcion AS GrupoDescripcion, g.Modalidad, g.UnidadPago, v.Estado, v.Motivo,
             DATE_FORMAT(v.VigenteDesde, '%Y-%m-%d') AS VigenteDesde, DATE_FORMAT(v.VigenteHasta, '%Y-%m-%d') AS VigenteHasta,
             v.CreadoPor, v.AprobadoPor, DATE_FORMAT(v.AprobadoEn, '%Y-%m-%d %H:%i') AS AprobadoEn
      FROM TarifaVersion v JOIN TarifaGrupo g ON g.Grupo = v.Grupo WHERE v.VersionId = ${id}`;
    if (!v.length) { res.status(404).json({ error: "La versión no existe" }); return; }
    const detalle: any[] = await prisma.$queryRaw`
      SELECT t.Talla, ta.Descripcion, t.Tarifa
      FROM Tarifas t LEFT JOIN Tallas ta ON ta.Codigo = t.Talla WHERE t.VersionId = ${id}`;
    const salario: any[] = await prisma.$queryRaw`
      SELECT ValorDia, HorasJornada FROM SalarioMinimo
      WHERE VigenteDesde <= ${v[0].VigenteDesde} AND (VigenteHasta IS NULL OR VigenteHasta >= ${v[0].VigenteDesde})
      ORDER BY Categoria = 'PLANTA' DESC LIMIT 1`;
    res.json({
      ...v[0],
      detalle: detalle.map(d => ({ Talla: d.Talla == null ? null : Number(d.Talla), Descripcion: d.Descripcion, Tarifa: Number(d.Tarifa) })),
      salario: salario[0] ? { ValorDia: Number(salario[0].ValorDia), HorasJornada: Number(salario[0].HorasJornada) } : null,
    });
  } catch (err: any) { responderError(res, err); }
});

router.post("/versiones", requireAuth, requirePerm("tarifas", "editar"), async (req, res) => {
  try {
    const { VersionId: _ignorar, ...body } = req.body;
    const id = await prisma.$transaction(tx => guardarBorrador(tx, body, usuarioDe(req)), OPCIONES_TX);
    res.status(201).json({ ok: true, VersionId: id });
  } catch (err: any) { responderError(res, err); }
});

router.put("/versiones/:id", requireAuth, requirePerm("tarifas", "editar"), async (req, res) => {
  try {
    const id = await prisma.$transaction(tx => guardarBorrador(tx, { ...req.body, VersionId: Number(req.params.id) }, usuarioDe(req)), OPCIONES_TX);
    res.json({ ok: true, VersionId: id });
  } catch (err: any) { responderError(res, err); }
});

router.delete("/versiones/:id", requireAuth, requirePerm("tarifas", "editar"), async (req, res) => {
  try {
    await prisma.$transaction(tx => eliminarBorrador(tx, Number(req.params.id)), OPCIONES_TX);
    res.json({ ok: true });
  } catch (err: any) { responderError(res, err); }
});

router.post("/versiones/:id/aprobar", requireAuth, requirePerm("tarifas", "aprobar"), async (req, res) => {
  try {
    const cambios = await prisma.$transaction(tx => aprobarVersion(tx, Number(req.params.id), usuarioDe(req)), OPCIONES_TX);
    res.json({ ok: true, cambios });
  } catch (err: any) { responderError(res, err); }
});

router.post("/versiones/:id/anular", requireAuth, requirePerm("tarifas", "aprobar"), async (req, res) => {
  try {
    const cambios = await prisma.$transaction(tx => anularVersion(tx, Number(req.params.id), usuarioDe(req)), OPCIONES_TX);
    res.json({ ok: true, cambios });
  } catch (err: any) { responderError(res, err); }
});

// ── Salario mínimo ───────────────────────────────────────────────────

router.get("/salario-minimo", requireAuth, requirePerm("tarifas", "ver"), async (_req, res) => {
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT SalarioMinimoId, Categoria, DATE_FORMAT(VigenteDesde, '%Y-%m-%d') AS VigenteDesde,
             DATE_FORMAT(VigenteHasta, '%Y-%m-%d') AS VigenteHasta, ValorDia, HorasJornada, Acuerdo, CreadoPor
      FROM SalarioMinimo ORDER BY Categoria, VigenteDesde DESC`;
    res.json(rows.map(r => ({ ...r, ValorDia: Number(r.ValorDia), HorasJornada: Number(r.HorasJornada) })));
  } catch (err: any) { responderError(res, err); }
});

router.post("/salario-minimo", requireAuth, requirePerm("tarifas", "aprobar"), async (req, res) => {
  try {
    await prisma.$transaction(tx => agregarSalario(tx, req.body, usuarioDe(req)), OPCIONES_TX);
    res.status(201).json({ ok: true });
  } catch (err: any) { responderError(res, err); }
});

router.delete("/salario-minimo/:id", requireAuth, requirePerm("tarifas", "aprobar"), async (req, res) => {
  try {
    await prisma.$transaction(tx => deshacerSalario(tx, Number(req.params.id)), OPCIONES_TX);
    res.json({ ok: true });
  } catch (err: any) { responderError(res, err); }
});

// ── Consulta ─────────────────────────────────────────────────────────

// GET /api/tarifas/consultar?clase=E41&talla=311&fecha=2026-10-08 — qué tarifa le toca a una
// pesada de obra; ?area=EG&fecha=… — la de un área de tiempo o pool (las mismas reglas que usará la
// planilla). { tarifa: null } = sin tarifa.
router.get("/consultar", requireAuth, requirePerm("tarifas", "ver"), async (req, res) => {
  try {
    const fecha = req.query.fecha ? validarFecha(req.query.fecha) : hoyGT();
    const tarifa = req.query.area
      ? await tarifaDeArea(prisma as any, String(req.query.area).toUpperCase(), fecha)
      : await tarifaAplicable(prisma as any, String(req.query.clase ?? "").toUpperCase(), Number(req.query.talla), fecha);
    res.json({ fecha, tarifa });
  } catch (err: any) { responderError(res, err); }
});

export default router;
