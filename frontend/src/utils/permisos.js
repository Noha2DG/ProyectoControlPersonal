// Formato del rango de fechas de un permiso.
//
// Vive aquí y no dentro de una página porque lo consumen tres vistas: el listado de Permisos, el
// aviso de permisos en Transferencias y las dos hojas de Excel. Un permiso de un solo día se ve
// distinto que uno de varios, y esa decisión tiene que ser la misma en todas — si cada vista la
// resuelve por su cuenta, unas vacaciones acaban mostrándose como una sola fecha en un lado y como
// un rango en otro, y quien lee el reporte no sabe cuál de los dos está incompleto.

export const fmtFecha = (iso) => (iso ? iso.split("-").reverse().join("/") : "");

// Días que cubre el permiso, contando inicio y fin (un permiso de un día son 1 día, no 0). Las
// fechas se comparan como UTC a propósito: vienen del backend ya como "YYYY-MM-DD" y construirlas
// en hora local haría que un cambio de horario metiera o quitara un día en la resta.
export function diasPermiso(fecha, fechaFin) {
  if (!fecha || !fechaFin) return 1;
  const ms = Date.parse(`${fechaFin}T00:00:00Z`) - Date.parse(`${fecha}T00:00:00Z`);
  return Math.round(ms / 86400000) + 1;
}

export const esRango = (fecha, fechaFin) => Boolean(fechaFin) && fechaFin !== fecha;

// "30/07/2026" si es de un día, "20/07/2026 – 30/07/2026" si es un rango.
export function fmtRango(fecha, fechaFin) {
  return esRango(fecha, fechaFin) ? `${fmtFecha(fecha)} – ${fmtFecha(fechaFin)}` : fmtFecha(fecha);
}
