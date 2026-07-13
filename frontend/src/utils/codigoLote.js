// Espejo de backend/src/lib/codigoLote.ts — se duplica aquí (backend y frontend son paquetes npm
// separados) para poder mostrar una vista previa del Lote en el formulario sin ir al servidor en
// cada tecla. Si cambia la fórmula allá, hay que actualizar también aquí.

// Número de semana ISO-8601 y día de semana ISO (lunes=1...domingo=7) de una fecha "YYYY-MM-DD".
function isoSemana(fecha) {
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
function segmentoFecha(fecha) {
  const [anio] = fecha.split("-").map(Number);
  const letra = String.fromCharCode(65 + (anio - 2020));
  const { diaSemanaISO, semana } = isoSemana(fecha);
  return `${letra}${diaSemanaISO}${String(semana).padStart(2, "0")}`;
}

// Formato: <letraAño><díaSemanaISO><semanaISO><primeraParteDePiscina>-<segundaParteDePiscina>-<ciclo>-<clase>
// ciclo puede venir vacío (piscinas exentas, ver piscinaRequiereCiclo) — simplemente se omite ese segmento.
// clase es opcional (solo la usa Destajo, para distinguir etapas de proceso del mismo ciclo/día).
export function componerCodigoLote(nombrePiscina, fecha, ciclo, clase) {
  if (!nombrePiscina || !fecha) return null;
  const [parte1, parte2] = nombrePiscina.split("-");
  return [`${segmentoFecha(fecha)}${parte1}`, parte2, ciclo, clase].filter(Boolean).join("-");
}

// Fincas proveedoras externas (importación, maquila, proveedores de pescado): no tienen piscinas de
// cultivo real, ninguna de sus "piscinas" (códigos genéricos tipo Q001/K001) lleva ciclo. Igual criterio
// para piscinas genéricas dentro de una finca real (sifones, "00-E00"). Espejo de
// backend/src/lib/codigoLote.ts — ver project_ordenetiquetado_design.
export const FINCAS_SIN_CICLO = ["IM001", "MA001", "P0001"];

export function piscinaRequiereCiclo(nombrePiscina, codigoFinca) {
  if (FINCAS_SIN_CICLO.includes(codigoFinca)) return false;
  return !/SIFON|00-E00/i.test(nombrePiscina || "");
}
