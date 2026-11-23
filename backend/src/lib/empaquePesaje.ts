// Cálculo del rango de un tipo de empaque (ver scripts/createPesajeBascula.ts). Único lugar donde se
// hace: la pantalla de Tipos de empaque muestra lo que devuelve el servidor y la de pesaje compara
// contra MinG/MaxG guardados, así que no hay dos fórmulas que puedan diferir.
//
// 19 nov 2026 (usuario): la tara del material se hace EN LA BÁSCULA, así que la pesa ya marca peso
// neto. Tara y márgenes + / − se quitaron (no hacían nada útil).
//
// 23 nov 2026 (usuario): se pesa CRUDO y al congelarse pierde peso (se deshidrata), así que el
// sobrepeso por deshidratación es lo MÍNIMO que debe llevar, no el máximo. El rango es
//   mínimo = neto + deshidratación (neto × %)      p. ej. 2000 + 1.25 % = 2025 g
//   máximo = mínimo + RangoG (gramos de holgura)   p. ej. 2025 + 10 g    = 2035 g
// El % cambia según el cliente; RangoG es cuánto se deja subir por encima del mínimo.

export type DatosEmpaque = { PesoNetoG: number; DeshidratacionPct: number; RangoG: number };

export function calcularEmpaque(d: DatosEmpaque) {
  const deshidratacionG = Math.round(d.PesoNetoG * d.DeshidratacionPct / 100);
  const minimo = d.PesoNetoG + deshidratacionG;
  const maximo = minimo + Math.max(0, Math.round(d.RangoG || 0));
  // PesoBrutoG = el máximo (se conserva la columna por compatibilidad).
  return { DeshidratacionG: deshidratacionG, PesoBrutoG: maximo, MinG: minimo, MaxG: maximo };
}

const entero = (v: any, nombre: string, min: number, max: number) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${nombre}: entero de ${min} a ${max}`);
  return n;
};

/** Valida lo que viene del formulario. Lanza Error con un mensaje para el usuario. */
export function validarEmpaque(b: any) {
  const nombre = String(b?.Nombre ?? "").trim().slice(0, 100);
  if (!nombre) throw new Error("Falta el nombre");
  const unidad = ["g", "kg", "lb"].includes(String(b?.Unidad)) ? String(b.Unidad) : "g";
  const pct = Number(b?.DeshidratacionPct ?? 0);
  if (!Number.isFinite(pct) || pct < 0 || pct > 60) throw new Error("Deshidratación: de 0 a 60 %");
  const d: DatosEmpaque = {
    PesoNetoG: entero(b?.PesoNetoG, "Peso neto (g)", 1, 100000),
    DeshidratacionPct: Math.round(pct * 100) / 100,
    RangoG: entero(b?.RangoG ?? 0, "Rango (g)", 0, 10000),
  };
  // Sin rango = peso libre (producto terminado por bandeja, 17 nov 2026): se guarda cualquier peso
  // estable; el rango queda calculado solo como referencia.
  const conRango = !(b?.ConRango === false || b?.ConRango === 0 || b?.ConRango === "0");
  const c = calcularEmpaque(d);
  if (conRango && d.RangoG <= 0) {
    throw new Error("Con rango, escriba los gramos del rango: cuánto puede subir por encima del mínimo");
  }
  return { Nombre: nombre, Unidad: unidad, ConRango: conRango ? 1 : 0, ...d, ...c };
}
