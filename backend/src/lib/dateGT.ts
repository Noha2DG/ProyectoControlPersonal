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
