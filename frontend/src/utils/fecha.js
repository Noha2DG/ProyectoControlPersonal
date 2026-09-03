// Formato de fechas y horas que vienen del backend.
//
// EL PROBLEMA QUE RESUELVE: MariaDB corre con time_zone = SYSTEM y el servidor está en CST (-6), así
// que todos los DATETIME de este sistema guardan HORA DE PARED DE GUATEMALA — un polín creado a las
// 9:00 a. m. queda como "2026-09-02 09:00:20". Al serializar a JSON, Prisma convierte ese valor a un
// Date de JavaScript y lo emite como "2026-09-02T09:00:20.000Z": la Z afirma que son las 9 UTC, y no
// lo son. Si el navegador lo lee con `new Date(iso)` y lo formatea en es-GT, le RESTA otras 6 horas
// y muestra 3:00 a. m. — seis horas antes de lo que de verdad pasó, y a veces el día anterior.
//
// LA REGLA: los dígitos que llegan ya son la hora de Guatemala. Hay que leerlos tal cual y NO dejar
// que el navegador los convierta. Por eso se parsea a mano en vez de usar `new Date(iso)`.
//
// Ojo al agregar pantallas: `new Date(algoDelBackend)` está mal siempre. Para "ahora mismo" en el
// navegador (ej. el pie de una hoja impresa) sí sirve `new Date()` directo — ese instante es real.

const RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;

/**
 * Convierte lo que manda el backend en un Date con esos MISMOS dígitos en la zona del navegador.
 * Devuelve null si no reconoce el formato, para que quien llame decida qué mostrar.
 */
export function fechaDelBackend(valor) {
  const m = RE.exec(String(valor ?? ""));
  if (!m) return null;
  const [, a, mes, dia, hh = "0", mi = "0", ss = "0"] = m;
  return new Date(Number(a), Number(mes) - 1, Number(dia), Number(hh), Number(mi), Number(ss));
}

/** "2/09/26, 9:00 a. m." — fecha y hora corta, el formato que usa toda la app. */
export function fmtFechaHora(valor) {
  const f = fechaDelBackend(valor);
  return f ? f.toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" }) : "-";
}

/** "2/9/2026, 9:00:20" — con segundos, para historiales donde el orden fino importa. */
export function fmtFechaHoraLarga(valor) {
  const f = fechaDelBackend(valor);
  return f ? f.toLocaleString("es-GT") : "-";
}

/** "02/09/2026" — solo el día. Sirve igual para DATE puros ("2026-09-02") que para DATETIME. */
export function fmtDia(valor) {
  const f = fechaDelBackend(valor);
  return f ? f.toLocaleDateString("es-GT", { day: "2-digit", month: "2-digit", year: "numeric" }) : "-";
}
