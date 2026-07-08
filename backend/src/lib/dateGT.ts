const TZ = "America/Guatemala";

/** Hora local Guatemala como string "YYYY-MM-DD HH:MM:SS" para INSERT en DATETIME */
export function nowGT(): string {
  return new Date().toLocaleString("sv-SE", { timeZone: TZ }).replace("T", " ");
}

/** Inicio del día en Guatemala "YYYY-MM-DD 00:00:00" para filtros WHERE */
export function hoyInicioGT(): string {
  const fecha = new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
  return `${fecha} 00:00:00`;
}

export const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/** Día de la semana de una fecha "YYYY-MM-DD..." usando solo la parte de fecha (sin TZ). */
export function diaSemanaDe(fechaYMD: string): string {
  const [y, m, d] = fechaYMD.slice(0, 10).split("-").map(Number);
  return DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
