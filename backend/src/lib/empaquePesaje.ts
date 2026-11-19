// Cálculo del rango de un tipo de empaque (ver scripts/createPesajeBascula.ts). Único lugar donde se
// hace: la pantalla de Tipos de empaque muestra lo que devuelve el servidor y la de pesaje compara
// contra MinG/MaxG guardados, así que no hay dos fórmulas que puedan diferir.
//
// 19 nov 2026 (usuario): la tara del material se hace EN LA BÁSCULA, así que la pesa ya marca peso
// neto. El rango es [neto, neto + deshidratación]: el % de deshidratación —que cambia según el
// cliente— es lo máximo que puede pasarse. Tara y márgenes + / − se quitaron (no hacían nada útil).

export type DatosEmpaque = { PesoNetoG: number; DeshidratacionPct: number };

export function calcularEmpaque(d: DatosEmpaque) {
  const deshidratacionG = Math.round(d.PesoNetoG * d.DeshidratacionPct / 100);
  const maximo = d.PesoNetoG + deshidratacionG;
  // PesoBrutoG = el máximo con deshidratación (se conserva la columna por compatibilidad).
  return { DeshidratacionG: deshidratacionG, PesoBrutoG: maximo, MinG: d.PesoNetoG, MaxG: maximo };
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
  };
  // Sin rango = peso libre (producto terminado por bandeja, 17 nov 2026): se guarda cualquier peso
  // estable; el rango queda calculado solo como referencia.
  const conRango = !(b?.ConRango === false || b?.ConRango === 0 || b?.ConRango === "0");
  const c = calcularEmpaque(d);
  if (conRango && c.DeshidratacionG <= 0) {
    throw new Error("Con rango, la deshidratación debe ser mayor que 0 %: es lo máximo que puede pasarse del peso neto");
  }
  return { Nombre: nombre, Unidad: unidad, ConRango: conRango ? 1 : 0, ...d, ...c };
}
