// Reglas de Importaciones de materia prima (solicitudes a proveedores del extranjero). Las tablas y el
// porqué de cada una están en backend/scripts/createImportaciones.ts. Aquí van las reglas que la base
// NO valida a propósito (para poder cargar el histórico del Excel tal cual viene): fecha de pedido
// obligatoria, orden de las fechas y que la talla sea una de las del parámetro TALLAS.
//
// `client` acepta tanto el PrismaClient global como una tx de prisma.$transaction.

export class ErrorImportacion extends Error {
  constructor(public status: number, mensaje: string) { super(mensaje); }
}

export const CLASES = ["A", "B", "C"];
export const PAISES: Record<string, string> = { EC: "Ecuador", PE: "Perú", HN: "Honduras", NI: "Nicaragua", MX: "México", GT: "Guatemala" };
const RE_CORREO = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

export const esCorreo = (v: any) => RE_CORREO.test(String(v ?? "").trim());

export function esFecha(v: any): boolean {
  const s = String(v ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [a, m, d] = s.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

// "2026-11-24" → "24/11/2026", sin pasar por Date (ver la nota de frontend/src/utils/fecha.js).
export const fmtFecha = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");

// ── Parámetros ───────────────────────────────────────────────────────

export interface Parametros { diasPago: number; lbContenedor: number; tallas: number[] }

export async function leerParametros(client: any): Promise<Parametros> {
  const rows: any[] = await client.$queryRaw`SELECT Clave, Valor FROM ImportacionParametro`;
  const v = Object.fromEntries(rows.map(r => [r.Clave, String(r.Valor)]));
  let tallas: number[] = [];
  try { tallas = (JSON.parse(v.TALLAS ?? "[]") as any[]).map(Number).filter(Number.isInteger); } catch { /* lista vacía */ }
  return {
    diasPago: Number(v.DIAS_PAGO_ANTES_LLEGADA ?? 5),
    lbContenedor: Number(v.LB_CONTENEDOR ?? 44000) || 44000,
    tallas,
  };
}

// Las tallas del parámetro, en su orden, con la descripción de Catálogos → Tallas.
export async function tallasOfrecidas(client: any, codigos: number[]): Promise<{ Codigo: number; Descripcion: string; Activo: boolean }[]> {
  if (!codigos.length) return [];
  const rows: any[] = await client.$queryRawUnsafe(
    `SELECT Codigo, Descripcion, Activo FROM Tallas WHERE Codigo IN (${codigos.map(() => "?").join(",")})`, ...codigos);
  const por = new Map(rows.map(r => [Number(r.Codigo), r]));
  return codigos.filter(c => por.has(c)).map(c => ({ Codigo: c, Descripcion: String(por.get(c).Descripcion), Activo: Number(por.get(c).Activo) === 1 }));
}

// Un contenedor carga ~44,000 lb; se tolera un 5 % de más antes de contar otro (igual que la demo).
export const contenedores = (lb: number, cap: number) => Math.max(1, Math.ceil(lb / cap - 0.05));

// ── Validación ───────────────────────────────────────────────────────

export interface Linea { Clase: string; Descripcion: string | null; Talla: number; Libras: number; CostoLb: number }
export interface SolicitudLimpia {
  ProveedorId: number; Proforma: string;
  FechaPedido: string | null; FechaSalida: string | null; FechaLlegada: string; FechaPago: string;
  Notas: string | null; lineas: Linea[];
}

const texto = (v: any, max: number, campo: string): string | null => {
  const s = String(v ?? "").trim();
  if (s.length > max) throw new ErrorImportacion(400, `${campo}: máximo ${max} caracteres`);
  return s || null;
};

const numero = (v: any) => Number(String(v ?? "").replace(/[$,\s]/g, ""));

// `pedidoOpcional`: las cargadas del Excel no tienen fecha de pedido (allá la columna copiaba la
// salida), y corregirlas no debe obligar a inventarla.
export function validarSolicitud(b: any, tallasPermitidas: number[], pedidoOpcional = false): SolicitudLimpia {
  const ProveedorId = Number(b.ProveedorId);
  if (!Number.isInteger(ProveedorId) || ProveedorId <= 0) throw new ErrorImportacion(400, "Falta el proveedor");
  const Proforma = texto(b.Proforma, 40, "Proforma");
  if (!Proforma) throw new ErrorImportacion(400, "Falta el número de proforma");

  const fecha = (v: any, nombre: string, requerida: boolean): string | null => {
    if (v == null || v === "") {
      if (requerida) throw new ErrorImportacion(400, `Falta la fecha de ${nombre}`);
      return null;
    }
    if (!esFecha(v)) throw new ErrorImportacion(400, `Fecha de ${nombre} inválida`);
    return String(v);
  };
  const FechaPedido = fecha(b.FechaPedido, "pedido", !pedidoOpcional);
  const FechaSalida = fecha(b.FechaSalida, "salida", false);
  const FechaLlegada = fecha(b.FechaLlegada, "llegada", true)!;
  const FechaPago = fecha(b.FechaPago, "pago", true)!;
  if (FechaPedido && FechaSalida && FechaPedido > FechaSalida) throw new ErrorImportacion(400, `La fecha de pedido (${fmtFecha(FechaPedido)}) es posterior a la salida (${fmtFecha(FechaSalida)})`);
  if (FechaSalida && FechaSalida > FechaLlegada) throw new ErrorImportacion(400, `La salida (${fmtFecha(FechaSalida)}) es posterior a la llegada (${fmtFecha(FechaLlegada)})`);
  if (FechaPedido && FechaPedido > FechaLlegada) throw new ErrorImportacion(400, `La fecha de pedido (${fmtFecha(FechaPedido)}) es posterior a la llegada (${fmtFecha(FechaLlegada)})`);

  if (!Array.isArray(b.lineas) || !b.lineas.length) throw new ErrorImportacion(400, "Agrega al menos una talla con libras");
  if (b.lineas.length > 60) throw new ErrorImportacion(400, "Máximo 60 líneas por solicitud");
  const lineas: Linea[] = b.lineas.map((l: any, i: number) => {
    const n = `Línea ${i + 1}`;
    const Clase = String(l.Clase ?? "").trim().toUpperCase();
    if (!CLASES.includes(Clase)) throw new ErrorImportacion(400, `${n}: la clase debe ser A, B o C`);
    const Talla = Number(l.Talla);
    if (!tallasPermitidas.includes(Talla)) throw new ErrorImportacion(400, `${n}: talla no válida para importaciones`);
    const Libras = numero(l.Libras), CostoLb = numero(l.CostoLb);
    if (!(Libras > 0) || Libras >= 1e10) throw new ErrorImportacion(400, `${n}: las libras deben ser mayores que cero`);
    if (!(CostoLb > 0) || CostoLb >= 1e6) throw new ErrorImportacion(400, `${n}: el costo por libra debe ser mayor que cero`);
    return { Clase, Descripcion: texto(l.Descripcion, 100, `${n}, descripción`), Talla, Libras: Math.round(Libras * 100) / 100, CostoLb: Math.round(CostoLb * 10000) / 10000 };
  });

  return { ProveedorId, Proforma, FechaPedido, FechaSalida, FechaLlegada, FechaPago, Notas: texto(b.Notas, 500, "Notas"), lineas };
}

// ── Guardar ──────────────────────────────────────────────────────────

// Crea (id = undefined) o reemplaza una solicitud con sus líneas. Va dentro de una transacción: el
// folio se toma con un INSERT … ON DUPLICATE KEY UPDATE que bloquea la fila del año hasta el commit,
// así dos solicitudes creadas a la vez no pueden salir con el mismo folio.
export async function guardarSolicitud(tx: any, body: any, usuario: string, hoy: string, id?: number): Promise<{ SolicitudId: number; Folio: string }> {
  const p = await leerParametros(tx);

  let actual: any = null;
  if (id !== undefined) {
    const rows: any[] = await tx.$queryRaw`SELECT SolicitudId, Folio, ProveedorId, Estado, Origen FROM ImportacionSolicitud WHERE SolicitudId = ${id} FOR UPDATE`;
    if (!rows.length) throw new ErrorImportacion(404, "La solicitud no existe");
    actual = rows[0];
    if (actual.Estado === "ANULADA") throw new ErrorImportacion(400, "La solicitud está anulada: ya no se edita");
  }
  const s = validarSolicitud(body, p.tallas, actual?.Origen === "EXCEL");

  const prov: any[] = await tx.$queryRaw`SELECT Activo FROM ImportacionProveedor WHERE ProveedorId = ${s.ProveedorId}`;
  if (!prov.length) throw new ErrorImportacion(400, "El proveedor no existe");
  // Un proveedor dado de baja no recibe solicitudes nuevas, pero las suyas se siguen corrigiendo.
  const mismoProveedor = actual && Number(actual.ProveedorId) === s.ProveedorId;
  if (!Number(prov[0].Activo) && !mismoProveedor) throw new ErrorImportacion(400, "El proveedor está inactivo");

  const otra: any[] = await tx.$queryRaw`
    SELECT Folio FROM ImportacionSolicitud
    WHERE ProveedorId = ${s.ProveedorId} AND Proforma = ${s.Proforma} AND SolicitudId <> ${id ?? 0}`;
  if (otra.length) throw new ErrorImportacion(400, `La proforma ${s.Proforma} de este proveedor ya está en la solicitud ${otra[0].Folio}`);

  let solicitudId: number, folio: string;
  if (actual) {
    solicitudId = Number(actual.SolicitudId); folio = String(actual.Folio);
    await tx.$executeRaw`
      UPDATE ImportacionSolicitud
      SET ProveedorId = ${s.ProveedorId}, Proforma = ${s.Proforma}, FechaPedido = ${s.FechaPedido}, FechaSalida = ${s.FechaSalida},
          FechaLlegada = ${s.FechaLlegada}, FechaPago = ${s.FechaPago}, Notas = ${s.Notas},
          ModificadoPor = ${usuario}, ModificadoEn = NOW()
      WHERE SolicitudId = ${solicitudId}`;
    await tx.$executeRaw`DELETE FROM ImportacionSolicitudDetalle WHERE SolicitudId = ${solicitudId}`;
  } else {
    const anio = Number(hoy.slice(0, 4));
    await tx.$executeRaw`
      INSERT INTO ImportacionSerie (Anio, UltimoSecuencial) VALUES (${anio}, 1)
      ON DUPLICATE KEY UPDATE UltimoSecuencial = UltimoSecuencial + 1`;
    const sec: any[] = await tx.$queryRaw`SELECT UltimoSecuencial FROM ImportacionSerie WHERE Anio = ${anio}`;
    folio = `MP-${anio}-${String(Number(sec[0].UltimoSecuencial)).padStart(4, "0")}`;
    await tx.$executeRaw`
      INSERT INTO ImportacionSolicitud (Folio, ProveedorId, Proforma, FechaPedido, FechaSalida, FechaLlegada, FechaPago, Notas, CreadoPor)
      VALUES (${folio}, ${s.ProveedorId}, ${s.Proforma}, ${s.FechaPedido}, ${s.FechaSalida}, ${s.FechaLlegada}, ${s.FechaPago}, ${s.Notas}, ${usuario})`;
    const nuevo: any[] = await tx.$queryRaw`SELECT SolicitudId FROM ImportacionSolicitud WHERE Folio = ${folio}`;
    solicitudId = Number(nuevo[0].SolicitudId);
  }

  for (const [i, l] of s.lineas.entries()) {
    await tx.$executeRaw`
      INSERT INTO ImportacionSolicitudDetalle (SolicitudId, Linea, Clase, Descripcion, Talla, Libras, CostoLb)
      VALUES (${solicitudId}, ${i + 1}, ${l.Clase}, ${l.Descripcion}, ${l.Talla}, ${l.Libras}, ${l.CostoLb})`;
  }
  return { SolicitudId: solicitudId, Folio: folio };
}

// ── Lectura ──────────────────────────────────────────────────────────

const ENCABEZADO = `
  s.SolicitudId, s.Folio, s.ProveedorId, p.Nombre AS Proveedor, p.NombreCorto AS ProveedorCorto, p.Pais,
  p.Correo AS CorreoProveedor, p.Contacto AS ContactoProveedor, s.Proforma,
  DATE_FORMAT(s.FechaPedido, '%Y-%m-%d') AS FechaPedido, DATE_FORMAT(s.FechaSalida, '%Y-%m-%d') AS FechaSalida,
  DATE_FORMAT(s.FechaLlegada, '%Y-%m-%d') AS FechaLlegada, DATE_FORMAT(s.FechaPago, '%Y-%m-%d') AS FechaPago,
  s.Estado, DATE_FORMAT(s.RecibidaEn, '%Y-%m-%d') AS RecibidaEn, s.RecibidaPor,
  s.EstadoPago, DATE_FORMAT(s.PagadaEn, '%Y-%m-%d') AS PagadaEn, s.PagadaPor,
  s.MotivoAnulacion, s.Notas, s.Origen, s.CreadoPor, DATE_FORMAT(s.CreadoEn, '%Y-%m-%d %H:%i') AS CreadoEn,
  s.ModificadoPor, DATE_FORMAT(s.ModificadoEn, '%Y-%m-%d %H:%i') AS ModificadoEn,
  (SELECT COUNT(*) FROM ImportacionEnvio e WHERE e.SolicitudId = s.SolicitudId AND e.Estado = 'ENVIADO') AS Envios,
  (SELECT DATE_FORMAT(MAX(e.EnviadoEn), '%Y-%m-%d %H:%i') FROM ImportacionEnvio e WHERE e.SolicitudId = s.SolicitudId AND e.Estado = 'ENVIADO') AS UltimoEnvio`;

const limpiarLinea = (l: any) => ({
  Linea: Number(l.Linea), Clase: l.Clase, Descripcion: l.Descripcion, Talla: Number(l.Talla), TallaDescripcion: l.TallaDescripcion,
  Libras: Number(l.Libras), CostoLb: Number(l.CostoLb), Total: Number(l.Total),
});

function armar(enc: any, lineas: any[]) {
  const ls = lineas.map(limpiarLinea);
  return {
    ...enc, SolicitudId: Number(enc.SolicitudId), ProveedorId: Number(enc.ProveedorId), Envios: Number(enc.Envios),
    lineas: ls,
    Libras: Math.round(ls.reduce((a, l) => a + l.Libras, 0) * 100) / 100,
    TotalUsd: Math.round(ls.reduce((a, l) => a + l.Total, 0) * 100) / 100,
  };
}

const DETALLE = `
  SELECT d.SolicitudId, d.Linea, d.Clase, d.Descripcion, d.Talla, t.Descripcion AS TallaDescripcion, d.Libras, d.CostoLb, d.Total
  FROM ImportacionSolicitudDetalle d JOIN Tallas t ON t.Codigo = d.Talla`;

// Todas las solicitudes con sus líneas: son decenas al año, y el calendario y los reportes se arman
// en pantalla con la misma lista.
export async function listarSolicitudes(client: any) {
  const enc: any[] = await client.$queryRawUnsafe(`
    SELECT ${ENCABEZADO} FROM ImportacionSolicitud s JOIN ImportacionProveedor p ON p.ProveedorId = s.ProveedorId
    ORDER BY s.FechaLlegada DESC, s.SolicitudId DESC`);
  const det: any[] = await client.$queryRawUnsafe(`${DETALLE} ORDER BY d.SolicitudId, d.Linea`);
  const por = new Map<number, any[]>();
  for (const d of det) {
    const k = Number(d.SolicitudId);
    if (!por.has(k)) por.set(k, []);
    por.get(k)!.push(d);
  }
  return enc.map(e => armar(e, por.get(Number(e.SolicitudId)) ?? []));
}

export async function obtenerSolicitud(client: any, id: number) {
  const enc: any[] = await client.$queryRawUnsafe(`
    SELECT ${ENCABEZADO} FROM ImportacionSolicitud s JOIN ImportacionProveedor p ON p.ProveedorId = s.ProveedorId
    WHERE s.SolicitudId = ?`, id);
  if (!enc.length) throw new ErrorImportacion(404, "La solicitud no existe");
  const det: any[] = await client.$queryRawUnsafe(`${DETALLE} WHERE d.SolicitudId = ? ORDER BY d.Linea`, id);
  const envios: any[] = await client.$queryRaw`
    SELECT EnvioId, Asunto, Para, Estado, Error, EnviadoPor, DATE_FORMAT(EnviadoEn, '%Y-%m-%d %H:%i') AS EnviadoEn
    FROM ImportacionEnvio WHERE SolicitudId = ${id} ORDER BY EnviadoEn DESC, EnvioId DESC`;
  return {
    ...armar(enc[0], det),
    envios: envios.map(e => ({ ...e, EnvioId: Number(e.EnvioId), Para: JSON.parse(e.Para) })),
  };
}

// ── Correo ───────────────────────────────────────────────────────────

const nf = (d: number) => new Intl.NumberFormat("es-GT", { minimumFractionDigits: d, maximumFractionDigits: d });
const fLb = (n: number) => nf(0).format(n);
const fUsd = (n: number) => "$" + nf(2).format(n);
const fCosto = (n: number) => "$" + nf(2).format(n);
const esc = (v: any) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const pais = (codigo: string | null) => (codigo ? PAISES[codigo] ?? codigo : "");

export const asuntoPorDefecto = (s: any) =>
  `Materia prima solicitada ${s.Folio} · ${s.ProveedorCorto} · ${fLb(s.Libras)} lb · llega ${fmtFecha(s.FechaLlegada)}`;

// El reporte va en el cuerpo del correo (sin adjuntos), con estilos en línea porque Gmail y Outlook
// ignoran las hojas de estilo. `s` es lo que devuelve obtenerSolicitud, o la copia guardada en
// ImportacionEnvio.Contenido: con la copia, "ver lo enviado" muestra exactamente lo que se mandó.
export function armarCorreo(s: any, lbContenedor: number, asunto?: string) {
  const n = contenedores(s.Libras, lbContenedor);
  const origen = pais(s.Pais);
  const td = "padding:6px 10px;border-bottom:1px solid #e5e7eb;";
  const num = "text-align:right;font-variant-numeric:tabular-nums;";
  const filas = s.lineas.map((l: any) => `
      <tr><td style="${td}">${esc(l.Clase)}</td><td style="${td}">${esc(l.Descripcion || "—")}</td><td style="${td}">${esc(l.TallaDescripcion)}</td>
        <td style="${td}${num}">${fLb(l.Libras)}</td><td style="${td}${num}">${fCosto(l.CostoLb)}</td><td style="${td}${num}">${fUsd(l.Total)}</td></tr>`).join("");
  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Segoe UI,Arial,sans-serif;color:#1f2937">
  <div style="max-width:680px;margin:0 auto;padding:20px">
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:20px">
      <h2 style="margin:0 0 6px;font-size:20px;color:#1e3a8a">Materia prima solicitada ${esc(s.Folio)}</h2>
      <p style="margin:0 0 14px;font-size:14px">Se registró una solicitud de materia prima importada. Estos son los datos de la proforma.</p>
      <div style="background:#eff6ff;border-radius:8px;padding:12px 14px;font-size:14px;line-height:1.6">
        <b>${esc(s.Proveedor)}</b> · Proforma ${esc(s.Proforma)}${origen ? ` · Origen ${esc(origen)}` : ""}<br>
        ${fLb(s.Libras)} lb en ${n} contenedor${n === 1 ? "" : "es"} · Total <b>${fUsd(s.TotalUsd)}</b><br>
        Pedido <b>${fmtFecha(s.FechaPedido)}</b> · Salida <b>${fmtFecha(s.FechaSalida)}</b> · Llegada <b>${fmtFecha(s.FechaLlegada)}</b> · Pago <b>${fmtFecha(s.FechaPago)}</b>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-top:14px;font-size:13px">
        <thead><tr style="background:#f9fafb;color:#6b7280;text-align:left">
          <th style="${td}">Clase</th><th style="${td}">Descripción</th><th style="${td}">Talla</th>
          <th style="${td}${num}">Libras</th><th style="${td}${num}">$/lb</th><th style="${td}${num}">Total</th></tr></thead>
        <tbody>${filas}</tbody>
        <tfoot><tr style="font-weight:bold"><td style="${td}" colspan="3">Total</td><td style="${td}${num}">${fLb(s.Libras)}</td><td style="${td}"></td><td style="${td}${num}">${fUsd(s.TotalUsd)}</td></tr></tfoot>
      </table>
      ${s.Notas ? `<p style="margin:14px 0 0;font-size:14px"><b>Notas:</b> ${esc(s.Notas)}</p>` : ""}
      <div style="margin-top:14px;font-size:14px"><b>Para tomar en cuenta</b>
        <ul style="margin:6px 0 0;padding-left:20px;line-height:1.6">
          <li>Logística y agente aduanal: despacho y aduana para la llegada del ${fmtFecha(s.FechaLlegada)}.</li>
          <li>Finanzas: pago de ${fUsd(s.TotalUsd)} el ${fmtFecha(s.FechaPago)}.</li>
          <li>Producción y Bodega: recepción del ${fmtFecha(s.FechaLlegada)} (${fLb(s.Libras)} lb).</li>
        </ul></div>
      <p style="margin:18px 0 0;font-size:12px;color:#6b7280">Correo automático del módulo de Importaciones. La solicitud completa está en Importaciones › Materia prima solicitada › ${esc(s.Folio)}.</p>
    </div>
  </div></body></html>`;

  const texto = [
    `MATERIA PRIMA SOLICITADA ${s.Folio}`,
    `Proveedor: ${s.Proveedor}${origen ? ` (${origen})` : ""}`,
    `Proforma: ${s.Proforma}`,
    `Pedido ${fmtFecha(s.FechaPedido)} · Salida ${fmtFecha(s.FechaSalida)} · Llegada ${fmtFecha(s.FechaLlegada)} · Pago ${fmtFecha(s.FechaPago)}`,
    "",
    ["Clase", "Descripción", "Talla", "Libras", "$/lb", "Total"].join("\t"),
    ...s.lineas.map((l: any) => [l.Clase, l.Descripcion ?? "", l.TallaDescripcion, fLb(l.Libras), fCosto(l.CostoLb), fUsd(l.Total)].join("\t")),
    "",
    `Total: ${fLb(s.Libras)} lb · ${fUsd(s.TotalUsd)} · ${n} contenedor(es)`,
    ...(s.Notas ? [`Notas: ${s.Notas}`] : []),
  ].join("\n");

  return { asunto: asunto?.trim() || asuntoPorDefecto(s), html, texto };
}
