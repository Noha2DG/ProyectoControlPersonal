// Cálculos y formatos de Importaciones de materia prima, compartidos por la lista, el calendario y los
// reportes. Las fechas viajan como "YYYY-MM-DD" (DATE_FORMAT en el backend) y se comparan como texto:
// nunca pasan por `new Date(fechaDelBackend)` (ver utils/fecha.js).
import { authHeader } from "../context/AuthContext.jsx";
import { fmtNum } from "./numero.js";

export const API = "/api/importaciones";

export async function pedir(url, opciones = {}) {
  const res = await fetch(url, {
    ...opciones,
    headers: { ...(opciones.body ? { "Content-Type": "application/json" } : {}), ...authHeader() },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Error en el servidor");
  return data;
}
export const enviar = (url, method, body) => pedir(url, { method, body: body ? JSON.stringify(body) : undefined });

export const fLb = (n) => fmtNum(n, 0);
export const fUsd = (n) => (n == null ? "—" : "$" + fmtNum(n, 2));
export const fCosto = (n) => (n == null || n === "" ? "—" : "$" + fmtNum(n, 2));
export const fFecha = (iso) => (iso ? iso.split("-").reverse().join("/") : "—");
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const fCorta = (iso) => (iso ? `${Number(iso.slice(8, 10))} ${MESES[Number(iso.slice(5, 7)) - 1]}` : "—");
const MESES_TITULO = MESES.map((m) => m[0].toUpperCase() + m.slice(1));
export const fMes = (ym) => `${MESES_TITULO[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
export const plural = (n, s = "s") => (n === 1 ? "" : s);

// Aritmética de días en UTC para que un cambio de horario no meta ni quite un día.
const aUTC = (iso) => Date.parse(`${iso}T00:00:00Z`);
export const diasEntre = (a, b) => Math.round((aUTC(b) - aUTC(a)) / 86400000);
export const sumarDias = (iso, n) => new Date(aUTC(iso) + n * 86400000).toISOString().slice(0, 10);
export const mesDe = (iso) => iso.slice(0, 7);
export const sumarMeses = (ym, n) => {
  const [a, m] = ym.split("-").map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};

// Un contenedor carga ~44,000 lb; se tolera un 5 % de más antes de contar otro (igual que el backend).
export const contenedores = (lb, cap) => Math.max(1, Math.ceil(lb / cap - 0.05));

// Chips de estado. `hoy` viene del servidor (hora de Guatemala).
export function estadoChip(s, hoy) {
  if (s.Estado === "ANULADA") return { cls: "bg-gray-100 text-gray-500 border-gray-300", txt: "Anulada" };
  if (s.Estado === "RECIBIDA") return { cls: "bg-emerald-50 text-emerald-800 border-emerald-300", txt: `Recibida ${fCorta(s.RecibidaEn)}` };
  const d = diasEntre(hoy, s.FechaLlegada);
  if (d < 0) return { cls: "bg-red-50 text-red-700 border-red-300", txt: `Llegó ${fCorta(s.FechaLlegada)}, sin recibir` };
  if (d === 0) return { cls: "bg-amber-50 text-amber-800 border-amber-300", txt: "Llega hoy" };
  if (d <= 7) return { cls: "bg-amber-50 text-amber-800 border-amber-300", txt: `Llega en ${d} día${plural(d)}` };
  return { cls: "bg-blue-50 text-blue-700 border-blue-200", txt: "Confirmada" };
}
export function pagoChip(s, hoy) {
  if (s.EstadoPago === "PAGADA") return { cls: "bg-emerald-50 text-emerald-800 border-emerald-300", txt: `Pagada ${fCorta(s.PagadaEn)}` };
  if (s.Estado === "ANULADA") return { cls: "bg-gray-100 text-gray-500 border-gray-300", txt: "—" };
  const d = diasEntre(hoy, s.FechaPago);
  if (d < 0) return { cls: "bg-red-50 text-red-700 border-red-300", txt: `Vencido ${fCorta(s.FechaPago)}` };
  if (d <= 7) return { cls: "bg-amber-50 text-amber-800 border-amber-300", txt: `Vence ${fCorta(s.FechaPago)}` };
  return { cls: "bg-white text-gray-600 border-gray-300", txt: `Pendiente ${fCorta(s.FechaPago)}` };
}

// Días entre el pago y la llegada: + antes de llegar, − después (se negocia en cada proforma).
export function textoDifPago(pago, llegada) {
  if (!pago || !llegada) return "";
  const n = diasEntre(pago, llegada);
  return n === 0 ? "el mismo día de la llegada" : n > 0 ? `${n} día${plural(n)} antes de la llegada` : `${-n} día${plural(-n)} después de la llegada`;
}

// ── Pegar desde el Excel ─────────────────────────────────────────────
// Acepta filas completas de BASE DAtos (Proveedor, Fecha Salida, Fecha pedido, Fecha Llegada,
// Fecha Flujo, Proforma, Clase, Descripción, Talla, Libras, Costo…) o solo Clase, Descripción,
// Talla, Libras, Costo. La talla "16-20" se busca SOLO entre las tallas del módulo: la tabla Tallas
// tiene dos escalas con descripciones repetidas.
const aNum = (s) => Number(String(s ?? "").replace(/[$,\s]/g, "")) || 0;
const aClase = (s) => String(s || "").replace(/clase/i, "").trim().toUpperCase().slice(0, 1);
const pad = (n) => String(n).padStart(2, "0");
function aFechaISO(s) {
  s = String(s || "").trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return "";
}
const normTalla = (s) => String(s || "").toUpperCase().replace(/\s/g, "").replace(/-/g, "/");

export function leerPegado(texto, tallas, proveedores) {
  const porDesc = new Map(tallas.map((t) => [normTalla(t.Descripcion), t.Codigo]));
  const enc = {}, lineas = [], sinTalla = new Set();
  const linea = (clase, desc, talla, lb, costo) => {
    const codigo = porDesc.get(normTalla(talla));
    if (!codigo) { if (String(talla).trim()) sinTalla.add(String(talla).trim()); return; }
    lineas.push({ Clase: ["A", "B", "C"].includes(aClase(clase)) ? aClase(clase) : "B", Descripcion: String(desc || "").trim(), Talla: codigo, Libras: aNum(lb), CostoLb: aNum(costo) });
  };
  for (const fila of String(texto).split(/\r?\n/)) {
    const c = fila.split("\t").map((x) => x.trim());
    if (!c.some(Boolean) || /talla|libras|proveedor/i.test(fila)) continue;
    if (c.length >= 11) {
      if (!enc.ProveedorId) {
        const k = c[0].split(/[ ,]/)[0].toLowerCase();
        const p = proveedores.find((x) => k && x.Nombre.toLowerCase().startsWith(k));
        Object.assign(enc, { ProveedorId: p?.ProveedorId ?? "", FechaSalida: aFechaISO(c[1]), FechaLlegada: aFechaISO(c[3]), FechaPago: aFechaISO(c[4]), Proforma: c[5] });
      }
      linea(c[6], c[7], c[8], c[9], c[10]);
    } else if (c.length >= 5) linea(c[0], c[1], c[2], c[3], c[4]);
    else if (c.length >= 3) linea("B", "", c[0], c[1], c[2]);
  }
  return { enc, lineas: lineas.filter((l) => l.Libras > 0), sinTalla: [...sinTalla] };
}
