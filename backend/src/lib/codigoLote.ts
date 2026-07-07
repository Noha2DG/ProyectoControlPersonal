// Número de semana ISO-8601 y día de semana ISO (lunes=1...domingo=7) de una fecha "YYYY-MM-DD".
// Se usa Date.UTC para evitar corrimientos de zona horaria.
export function isoSemana(fecha: string) {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const date = new Date(Date.UTC(anio, mes - 1, dia));
  const diaSemanaISO = date.getUTCDay() || 7;
  const jueves = new Date(date);
  jueves.setUTCDate(date.getUTCDate() + 4 - diaSemanaISO);
  const inicioAnio = new Date(Date.UTC(jueves.getUTCFullYear(), 0, 1));
  const semana = Math.ceil((((jueves.getTime() - inicioAnio.getTime()) / 86400000) + 1) / 7);
  return { diaSemanaISO, semana };
}

// Letra de año (A=2020, B=2021... G=2026) + día de semana ISO + semana ISO (2 dígitos).
export function segmentoFecha(fecha: string) {
  const [anio] = fecha.split("-").map(Number);
  const letra = String.fromCharCode(65 + (anio - 2020));
  const { diaSemanaISO, semana } = isoSemana(fecha);
  return `${letra}${diaSemanaISO}${String(semana).padStart(2, "0")}`;
}

// Formato: <letraAño><díaSemanaISO><semanaISO><primeraParteDePiscina>-<segundaParteDePiscina>-<secuencial>
// ej. piscina "EM07-E01", martes (2) semana 27 de 2026 (G), secuencial 5 → G227EM07-E01-5
// Usado tanto por Destajo (Lotes, con secuencial autogenerado por día) como por Etiquetado
// (OrdenEtiquetado, con secuencial = Ciclo capturado manualmente) — ver project_ordenetiquetado_design.
export function componerCodigoLote(nombrePiscina: string, fecha: string, secuencial: string) {
  const [parte1, parte2] = nombrePiscina.split("-");
  return [`${segmentoFecha(fecha)}${parte1}`, parte2, secuencial].filter(Boolean).join("-");
}

// Fincas que son proveedores externos (importación, maquila, proveedores de pescado) — no tienen
// piscinas de cultivo real, así que ninguna de sus "piscinas" (códigos genéricos tipo Q001/K001)
// lleva ciclo. Mismo criterio que ya usaba Destajo solo para sifones, ahora también para "00-E00"
// (piscina genérica sin ciclo dentro de una finca real) — ver project_ordenetiquetado_design.
export const FINCAS_SIN_CICLO = ["IM001", "MA001", "P0001"];

export function piscinaRequiereCiclo(nombrePiscina: string, codigoFinca: string) {
  if (FINCAS_SIN_CICLO.includes(codigoFinca)) return false;
  return !/SIFON|00-E00/i.test(nombrePiscina || "");
}
