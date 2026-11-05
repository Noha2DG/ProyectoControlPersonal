import { Router, Request, Response } from "express";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm, requireAnyPerm, AuthRequest } from "../middleware/auth.ts";
import { hoyGT } from "../lib/dateGT.ts";
import { correoConfigurado, enviarCorreo } from "../lib/correo.ts";
import {
  ErrorImportacion, esFecha, esCorreo, fmtFecha, leerParametros, tallasOfrecidas, guardarSolicitud,
  listarSolicitudes, obtenerSolicitud, armarCorreo,
} from "../lib/importaciones.ts";

// Importaciones de materia prima: solicitudes a proveedores del extranjero (proformas), su
// seguimiento (recibida / pagada) y el reporte por correo a la lista de distribución. Tablas en
// backend/scripts/createImportaciones.ts; reglas en backend/src/lib/importaciones.ts.
// Permiso propio `importaciones`:
//   ver      → consultar solicitudes, calendario, reportes y ajustes.
//   crear    → registrar solicitudes y enviar su reporte por correo.
//   editar   → corregirlas, marcarlas recibidas / pagadas, anularlas, y los ajustes del módulo.
//   eliminar → borrar una solicitud que nunca se envió (la que ya se envió se anula).
const router = Router();
const OPCIONES_TX = { maxWait: 10_000, timeout: 30_000 };

function usuarioDe(req: Request): string {
  const u = (req as AuthRequest).user;
  return u?.nombre || u?.username || "Sistema";
}

function responderError(res: Response, err: any) {
  if (err instanceof ErrorImportacion) res.status(err.status).json({ error: err.message });
  else if (err.message?.includes("Duplicate")) res.status(400).json({ error: "Ya existe un registro igual" });
  else res.status(500).json({ error: err.message });
}

const idDe = (req: Request) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new ErrorImportacion(400, "Identificador inválido");
  return id;
};

// GET /api/importaciones/opciones — proveedores, tallas, parámetros y destinatarios para los
// formularios, y si el servidor tiene correo configurado.
router.get("/opciones", requireAuth, requirePerm("importaciones", "ver"), async (_req, res) => {
  try {
    const p = await leerParametros(prisma);
    const proveedores: any[] = await prisma.$queryRaw`
      SELECT ProveedorId, Nombre, NombreCorto, Pais, Contacto, Correo, Activo FROM ImportacionProveedor ORDER BY Activo DESC, Nombre`;
    const destinatarios: any[] = await prisma.$queryRaw`
      SELECT DestinatarioId, Nombre, Area, Correo, RecibePorDefecto, Activo, Orden FROM ImportacionDestinatario ORDER BY Orden, Nombre`;
    res.json({
      hoy: hoyGT(),
      parametros: { diasPago: p.diasPago, lbContenedor: p.lbContenedor },
      tallas: await tallasOfrecidas(prisma, p.tallas),
      proveedores: proveedores.map(x => ({ ...x, ProveedorId: Number(x.ProveedorId), Activo: Number(x.Activo) === 1 })),
      destinatarios: destinatarios.map(x => ({
        ...x, DestinatarioId: Number(x.DestinatarioId), Orden: Number(x.Orden),
        RecibePorDefecto: Number(x.RecibePorDefecto) === 1, Activo: Number(x.Activo) === 1,
      })),
      correo: { configurado: correoConfigurado(), remitente: process.env.SMTP_FROM || process.env.SMTP_USER || null },
    });
  } catch (err: any) { responderError(res, err); }
});

// ── Solicitudes ──────────────────────────────────────────────────────

router.get("/solicitudes", requireAuth, requirePerm("importaciones", "ver"), async (_req, res) => {
  try { res.json(await listarSolicitudes(prisma)); } catch (err: any) { responderError(res, err); }
});

router.get("/solicitudes/:id", requireAuth, requirePerm("importaciones", "ver"), async (req, res) => {
  try { res.json(await obtenerSolicitud(prisma, idDe(req))); } catch (err: any) { responderError(res, err); }
});

router.post("/solicitudes", requireAuth, requirePerm("importaciones", "crear"), async (req, res) => {
  try {
    const r = await prisma.$transaction(tx => guardarSolicitud(tx, req.body, usuarioDe(req), hoyGT()), OPCIONES_TX);
    res.status(201).json({ ok: true, ...r });
  } catch (err: any) { responderError(res, err); }
});

router.put("/solicitudes/:id", requireAuth, requirePerm("importaciones", "editar"), async (req, res) => {
  try {
    const id = idDe(req);
    const r = await prisma.$transaction(tx => guardarSolicitud(tx, req.body, usuarioDe(req), hoyGT(), id), OPCIONES_TX);
    res.json({ ok: true, ...r });
  } catch (err: any) { responderError(res, err); }
});

// Solo se borra lo que nunca salió por correo: si alguien ya recibió el reporte, la solicitud se anula
// (queda con su motivo). Los intentos fallidos sí se van con ella: no le llegaron a nadie.
router.delete("/solicitudes/:id", requireAuth, requirePerm("importaciones", "eliminar"), async (req, res) => {
  try {
    const id = idDe(req);
    await prisma.$transaction(async tx => {
      const s: any[] = await tx.$queryRaw`SELECT Folio FROM ImportacionSolicitud WHERE SolicitudId = ${id} FOR UPDATE`;
      if (!s.length) throw new ErrorImportacion(404, "La solicitud no existe");
      const env: any[] = await tx.$queryRaw`SELECT COUNT(*) AS n FROM ImportacionEnvio WHERE SolicitudId = ${id} AND Estado = 'ENVIADO'`;
      if (Number(env[0].n) > 0) throw new ErrorImportacion(400, `La solicitud ${s[0].Folio} ya se envió por correo: no se borra, se anula`);
      await tx.$executeRaw`DELETE FROM ImportacionEnvio WHERE SolicitudId = ${id}`;
      await tx.$executeRaw`DELETE FROM ImportacionSolicitud WHERE SolicitudId = ${id}`;
    }, OPCIONES_TX);
    res.json({ ok: true });
  } catch (err: any) { responderError(res, err); }
});

// Recibir y pagar llevan la fecha en que pasó (hoy por defecto), no la de cuando se marcó: muchas
// veces se registra al día siguiente. No se aceptan fechas futuras.
function fechaPasada(v: any, hoy: string, que: string): string {
  const f = v ? String(v) : hoy;
  if (!esFecha(f)) throw new ErrorImportacion(400, `Fecha de ${que} inválida`);
  if (f > hoy) throw new ErrorImportacion(400, `La fecha de ${que} (${fmtFecha(f)}) no puede ser futura`);
  return f;
}

async function cambiarEstado(id: number, accion: (tx: any, s: any) => Promise<void>) {
  await prisma.$transaction(async tx => {
    const s: any[] = await tx.$queryRaw`SELECT SolicitudId, Folio, Estado, EstadoPago FROM ImportacionSolicitud WHERE SolicitudId = ${id} FOR UPDATE`;
    if (!s.length) throw new ErrorImportacion(404, "La solicitud no existe");
    await accion(tx, s[0]);
  }, OPCIONES_TX);
}

router.post("/solicitudes/:id/recibir", requireAuth, requirePerm("importaciones", "editar"), async (req, res) => {
  try {
    const f = fechaPasada(req.body.Fecha, hoyGT(), "recepción");
    await cambiarEstado(idDe(req), async (tx, s) => {
      if (s.Estado !== "CONFIRMADA") throw new ErrorImportacion(400, s.Estado === "RECIBIDA" ? "La solicitud ya está recibida" : "La solicitud está anulada");
      await tx.$executeRaw`UPDATE ImportacionSolicitud SET Estado = 'RECIBIDA', RecibidaEn = ${f}, RecibidaPor = ${usuarioDe(req)} WHERE SolicitudId = ${s.SolicitudId}`;
    });
    res.json({ ok: true });
  } catch (err: any) { responderError(res, err); }
});

router.post("/solicitudes/:id/deshacer-recibir", requireAuth, requirePerm("importaciones", "editar"), async (req, res) => {
  try {
    await cambiarEstado(idDe(req), async (tx, s) => {
      if (s.Estado !== "RECIBIDA") throw new ErrorImportacion(400, "La solicitud no está recibida");
      await tx.$executeRaw`UPDATE ImportacionSolicitud SET Estado = 'CONFIRMADA', RecibidaEn = NULL, RecibidaPor = NULL WHERE SolicitudId = ${s.SolicitudId}`;
    });
    res.json({ ok: true });
  } catch (err: any) { responderError(res, err); }
});

router.post("/solicitudes/:id/pagar", requireAuth, requirePerm("importaciones", "editar"), async (req, res) => {
  try {
    const f = fechaPasada(req.body.Fecha, hoyGT(), "pago");
    await cambiarEstado(idDe(req), async (tx, s) => {
      if (s.Estado === "ANULADA") throw new ErrorImportacion(400, "La solicitud está anulada");
      if (s.EstadoPago === "PAGADA") throw new ErrorImportacion(400, "La solicitud ya está pagada");
      await tx.$executeRaw`UPDATE ImportacionSolicitud SET EstadoPago = 'PAGADA', PagadaEn = ${f}, PagadaPor = ${usuarioDe(req)} WHERE SolicitudId = ${s.SolicitudId}`;
    });
    res.json({ ok: true });
  } catch (err: any) { responderError(res, err); }
});

router.post("/solicitudes/:id/deshacer-pago", requireAuth, requirePerm("importaciones", "editar"), async (req, res) => {
  try {
    await cambiarEstado(idDe(req), async (tx, s) => {
      if (s.EstadoPago !== "PAGADA") throw new ErrorImportacion(400, "La solicitud no está pagada");
      await tx.$executeRaw`UPDATE ImportacionSolicitud SET EstadoPago = 'PENDIENTE', PagadaEn = NULL, PagadaPor = NULL WHERE SolicitudId = ${s.SolicitudId}`;
    });
    res.json({ ok: true });
  } catch (err: any) { responderError(res, err); }
});

// Una recibida no se anula: el producto ya entró. Si fue un error de captura, primero se deshace la
// recepción.
router.post("/solicitudes/:id/anular", requireAuth, requirePerm("importaciones", "editar"), async (req, res) => {
  try {
    const motivo = String(req.body.Motivo ?? "").trim();
    if (motivo.length < 5) throw new ErrorImportacion(400, "Escribe el motivo de la anulación (mínimo 5 letras)");
    if (motivo.length > 300) throw new ErrorImportacion(400, "Motivo: máximo 300 caracteres");
    await cambiarEstado(idDe(req), async (tx, s) => {
      if (s.Estado !== "CONFIRMADA") throw new ErrorImportacion(400, s.Estado === "RECIBIDA" ? "Una solicitud recibida no se anula: primero deshaz la recepción" : "La solicitud ya está anulada");
      await tx.$executeRaw`
        UPDATE ImportacionSolicitud SET Estado = 'ANULADA', MotivoAnulacion = ${motivo}, ModificadoPor = ${usuarioDe(req)}, ModificadoEn = NOW()
        WHERE SolicitudId = ${s.SolicitudId}`;
    });
    res.json({ ok: true });
  } catch (err: any) { responderError(res, err); }
});

// ── Correo ───────────────────────────────────────────────────────────

// GET /api/importaciones/solicitudes/:id/correo?asunto=… — cómo se verá el correo, para revisarlo
// antes de enviarlo.
router.get("/solicitudes/:id/correo", requireAuth, requirePerm("importaciones", "ver"), async (req, res) => {
  try {
    const s = await obtenerSolicitud(prisma, idDe(req));
    const p = await leerParametros(prisma);
    const c = armarCorreo(s, p.lbContenedor, req.query.asunto ? String(req.query.asunto) : undefined);
    res.json({ asunto: c.asunto, html: c.html });
  } catch (err: any) { responderError(res, err); }
});

// POST /api/importaciones/solicitudes/:id/enviar { Para: [{ Nombre, Correo }], Asunto }
// Se registra cada intento, también el que falla: el historial dice a quién se le mandó y qué. El
// contenido se guarda como copia, así una corrección posterior no cambia lo que muestra el historial.
router.post("/solicitudes/:id/enviar", requireAuth, requireAnyPerm([["importaciones", "crear"], ["importaciones", "editar"]]), async (req, res) => {
  try {
    if (!correoConfigurado()) throw new ErrorImportacion(400, "El servidor no tiene correo configurado: avisa a sistemas");
    const id = idDe(req);
    const vistos = new Set<string>();
    const para: { Nombre: string; Correo: string }[] = [];
    for (const d of Array.isArray(req.body.Para) ? req.body.Para : []) {
      const correo = String(d?.Correo ?? "").trim().toLowerCase();
      if (!correo) continue;
      if (!esCorreo(correo)) throw new ErrorImportacion(400, `Correo inválido: ${correo}`);
      if (vistos.has(correo)) continue;
      vistos.add(correo);
      para.push({ Nombre: String(d?.Nombre ?? "").trim().slice(0, 100) || correo, Correo: correo });
    }
    if (!para.length) throw new ErrorImportacion(400, "Elige al menos un destinatario");
    if (para.length > 40) throw new ErrorImportacion(400, "Máximo 40 destinatarios por envío");

    const s = await obtenerSolicitud(prisma, id);
    if (s.Estado === "ANULADA") throw new ErrorImportacion(400, "La solicitud está anulada: no se envía");
    const p = await leerParametros(prisma);
    const c = armarCorreo(s, p.lbContenedor, req.body.Asunto ? String(req.body.Asunto).slice(0, 250) : undefined);
    const { envios: _e, ...copia } = s;

    let estado = "ENVIADO", error: string | null = null, rechazados: string[] = [];
    try {
      const r = await enviarCorreo({ para: para.map(x => x.Correo), asunto: c.asunto, html: c.html, texto: c.texto });
      rechazados = r.rechazados;
      if (r.aceptados.length === 0) { estado = "ERROR"; error = "El servidor de correo no aceptó ningún destinatario"; }
      else if (rechazados.length) error = `No aceptados: ${rechazados.join(", ")}`.slice(0, 500);
    } catch (e: any) {
      estado = "ERROR"; error = String(e?.response || e?.message || e).split("\n")[0].slice(0, 500);
    }
    await prisma.$executeRaw`
      INSERT INTO ImportacionEnvio (SolicitudId, Asunto, Para, Contenido, Estado, Error, EnviadoPor)
      VALUES (${id}, ${c.asunto}, ${JSON.stringify(para)}, ${JSON.stringify(copia)}, ${estado}, ${error}, ${usuarioDe(req)})`;
    if (estado === "ERROR") throw new ErrorImportacion(502, `No se pudo enviar: ${error}`);
    res.json({ ok: true, enviados: para.length - rechazados.length, rechazados });
  } catch (err: any) { responderError(res, err); }
});

// GET /api/importaciones/envios/:id — lo que se envió, armado con la copia guardada.
router.get("/envios/:id", requireAuth, requirePerm("importaciones", "ver"), async (req, res) => {
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT EnvioId, SolicitudId, Asunto, Para, Contenido, Estado, Error, EnviadoPor, DATE_FORMAT(EnviadoEn, '%Y-%m-%d %H:%i') AS EnviadoEn
      FROM ImportacionEnvio WHERE EnvioId = ${idDe(req)}`;
    if (!rows.length) throw new ErrorImportacion(404, "El envío no existe");
    const e = rows[0];
    const p = await leerParametros(prisma);
    const { Contenido, ...resto } = e;
    res.json({ ...resto, EnvioId: Number(e.EnvioId), SolicitudId: Number(e.SolicitudId), Para: JSON.parse(e.Para), html: armarCorreo(JSON.parse(Contenido), p.lbContenedor, e.Asunto).html });
  } catch (err: any) { responderError(res, err); }
});

// ── Ajustes: proveedores, destinatarios y parámetros ─────────────────

function validarProveedor(b: any) {
  const Nombre = String(b.Nombre ?? "").trim();
  const NombreCorto = String(b.NombreCorto ?? "").trim() || Nombre.split(",")[0].trim();
  if (!Nombre) throw new ErrorImportacion(400, "El nombre es requerido");
  if (Nombre.length > 150 || NombreCorto.length > 40) throw new ErrorImportacion(400, "Nombre: máximo 150 caracteres; nombre corto: 40");
  const Pais = String(b.Pais ?? "").trim().toUpperCase().slice(0, 5) || null;
  const Contacto = String(b.Contacto ?? "").trim().slice(0, 100) || null;
  const Correo = String(b.Correo ?? "").trim().toLowerCase() || null;
  if (Correo && !esCorreo(Correo)) throw new ErrorImportacion(400, "Correo del proveedor inválido");
  return { Nombre, NombreCorto, Pais, Contacto, Correo, Activo: b.Activo === false || b.Activo === 0 ? 0 : 1 };
}

router.post("/proveedores", requireAuth, requirePerm("importaciones", "editar"), async (req, res) => {
  try {
    const v = validarProveedor(req.body);
    await prisma.$executeRaw`
      INSERT INTO ImportacionProveedor (Nombre, NombreCorto, Pais, Contacto, Correo, Activo, CreadoPor)
      VALUES (${v.Nombre}, ${v.NombreCorto}, ${v.Pais}, ${v.Contacto}, ${v.Correo}, ${v.Activo}, ${usuarioDe(req)})`;
    res.status(201).json({ ok: true });
  } catch (err: any) { responderError(res, err); }
});

// Un proveedor no se borra (sus solicitudes lo referencian): se desactiva.
router.put("/proveedores/:id", requireAuth, requirePerm("importaciones", "editar"), async (req, res) => {
  try {
    const v = validarProveedor(req.body);
    const n = await prisma.$executeRaw`
      UPDATE ImportacionProveedor SET Nombre = ${v.Nombre}, NombreCorto = ${v.NombreCorto}, Pais = ${v.Pais}, Contacto = ${v.Contacto},
             Correo = ${v.Correo}, Activo = ${v.Activo}
      WHERE ProveedorId = ${idDe(req)}`;
    if (!n) throw new ErrorImportacion(404, "El proveedor no existe");
    res.json({ ok: true });
  } catch (err: any) { responderError(res, err); }
});

function validarDestinatario(b: any) {
  const Nombre = String(b.Nombre ?? "").trim().slice(0, 100);
  const Correo = String(b.Correo ?? "").trim().toLowerCase();
  if (!Nombre) throw new ErrorImportacion(400, "El nombre es requerido");
  if (!esCorreo(Correo) || Correo.length > 150) throw new ErrorImportacion(400, "Correo inválido");
  return {
    Nombre, Correo, Area: String(b.Area ?? "").trim().slice(0, 60) || null,
    RecibePorDefecto: b.RecibePorDefecto === false || b.RecibePorDefecto === 0 ? 0 : 1,
    Activo: b.Activo === false || b.Activo === 0 ? 0 : 1,
    Orden: Number.isInteger(Number(b.Orden)) ? Number(b.Orden) : 0,
  };
}

router.post("/destinatarios", requireAuth, requirePerm("importaciones", "editar"), async (req, res) => {
  try {
    const v = validarDestinatario(req.body);
    await prisma.$executeRaw`
      INSERT INTO ImportacionDestinatario (Nombre, Area, Correo, RecibePorDefecto, Activo, Orden, CreadoPor)
      VALUES (${v.Nombre}, ${v.Area}, ${v.Correo}, ${v.RecibePorDefecto}, ${v.Activo}, ${v.Orden}, ${usuarioDe(req)})`;
    res.status(201).json({ ok: true });
  } catch (err: any) { responderError(res, err); }
});

router.put("/destinatarios/:id", requireAuth, requirePerm("importaciones", "editar"), async (req, res) => {
  try {
    const v = validarDestinatario(req.body);
    const n = await prisma.$executeRaw`
      UPDATE ImportacionDestinatario SET Nombre = ${v.Nombre}, Area = ${v.Area}, Correo = ${v.Correo},
             RecibePorDefecto = ${v.RecibePorDefecto}, Activo = ${v.Activo}, Orden = ${v.Orden}
      WHERE DestinatarioId = ${idDe(req)}`;
    if (!n) throw new ErrorImportacion(404, "El destinatario no existe");
    res.json({ ok: true });
  } catch (err: any) { responderError(res, err); }
});

// El historial de envíos guarda los correos como texto, así que quitar a alguien de la lista no
// borra a quién se le mandó antes.
router.delete("/destinatarios/:id", requireAuth, requirePerm("importaciones", "editar"), async (req, res) => {
  try {
    await prisma.$executeRaw`DELETE FROM ImportacionDestinatario WHERE DestinatarioId = ${idDe(req)}`;
    res.json({ ok: true });
  } catch (err: any) { responderError(res, err); }
});

// PUT /api/importaciones/parametros { diasPago, lbContenedor }. La lista de tallas (TALLAS) no se
// edita aquí todavía: cambiarla es decidir qué códigos de Tallas se compran.
router.put("/parametros", requireAuth, requirePerm("importaciones", "editar"), async (req, res) => {
  try {
    const dias = Number(req.body.diasPago), lb = Number(req.body.lbContenedor);
    if (!Number.isInteger(dias) || dias < -60 || dias > 120) throw new ErrorImportacion(400, "Días de pago: un número entero entre -60 y 120");
    if (!Number.isInteger(lb) || lb < 1000 || lb > 200000) throw new ErrorImportacion(400, "Libras por contenedor: un número entero entre 1,000 y 200,000");
    const u = usuarioDe(req);
    await prisma.$transaction([
      prisma.$executeRaw`UPDATE ImportacionParametro SET Valor = ${String(dias)}, ModificadoPor = ${u}, ModificadoEn = NOW() WHERE Clave = 'DIAS_PAGO_ANTES_LLEGADA'`,
      prisma.$executeRaw`UPDATE ImportacionParametro SET Valor = ${String(lb)}, ModificadoPor = ${u}, ModificadoEn = NOW() WHERE Clave = 'LB_CONTENEDOR'`,
    ]);
    res.json({ ok: true });
  } catch (err: any) { responderError(res, err); }
});

export default router;
