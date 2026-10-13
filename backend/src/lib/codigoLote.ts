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
// La Clase NO va en el código (el usuario la ve aparte, en su propia columna) — varias etapas de
// proceso del mismo ciclo/día (ej. C20 entero y D30 descabezado) comparten el mismo texto de Lote y
// se distinguen a nivel de base de datos por la llave compuesta (Lote, Clase) de la tabla Lotes.
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

// Sifones impresos con el formato viejo, de antes de que el catálogo los llamara por finca
// (TM-SIFON / EM-SIFON). Siguen llegando en remisiones de producto congelado de meses atrás:
// G110SIFON-TF32, F241SIFON-T, G321SIFON-E… Lo que va después de la T/E (F32, 1) no es un ciclo
// —  un sifón no lleva—  así que se descarta.
const SIFON_VIEJO: [RegExp, string][] = [
  [/^SIFON-T/i, "TM-SIFON"],
  [/^SIFON-E/i, "EM-SIFON"],
];

/**
 * El camino inverso de componerCodigoLote: de un código ya impreso saca la piscina y el ciclo.
 * Devuelve null si no reconoce la piscina — quien llama decide qué hacer (nunca adivina).
 *
 * El nombre de la piscina se busca en el catálogo y no se parte por guiones: "EM06-E02" lleva un
 * guion propio, así que "G135EM06-E02-4" no se puede cortar a ciegas. Gana el nombre más largo que
 * calce, sin distinguir mayúsculas (hay etiquetas con "k024" contra el "K024" del catálogo).
 */
export function descomponerCodigoLote<P extends { Nombre: string }>(
  lote: string, piscinas: P[]
): { piscina: P; ciclo: number | null } | null {
  if (!/^[A-Z][1-7]\d{2}/i.test(lote || "")) return null;
  const resto = lote.slice(4).toUpperCase();

  for (const [patron, nombre] of SIFON_VIEJO) {
    if (patron.test(resto)) {
      const p = piscinas.find(x => x.Nombre.toUpperCase() === nombre);
      return p ? { piscina: p, ciclo: null } : null;
    }
  }

  let mejor: P | null = null;
  for (const p of piscinas) {
    const n = p.Nombre.toUpperCase();
    if ((resto === n || resto.startsWith(n + "-")) && (!mejor || n.length > mejor.Nombre.length)) mejor = p;
  }
  if (!mejor) return null;
  const cola = resto.slice(mejor.Nombre.length + 1);
  if (cola && !/^\d+$/.test(cola)) return null;
  return { piscina: mejor, ciclo: cola ? Number(cola) : null };
}
