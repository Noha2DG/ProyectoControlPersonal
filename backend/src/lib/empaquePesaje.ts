// Cálculo del rango de un tipo de empaque (ver scripts/createPesajeBascula.ts). Único lugar donde se
// hace: la pantalla de Tipos de empaque muestra lo que devuelve el servidor y la de pesaje compara
// contra MinG/MaxG guardados, así que no hay dos fórmulas que puedan diferir.

export type DatosEmpaque = {
  PesoNetoG: number; TaraG: number; DeshidratacionPct: number; MargenPosG: number; MargenNegG: number;
};

export function calcularEmpaque(d: DatosEmpaque) {
  const deshidratacionG = Math.round(d.PesoNetoG * d.DeshidratacionPct / 100);
  const bruto = d.PesoNetoG + d.TaraG + deshidratacionG;
  return { DeshidratacionG: deshidratacionG, PesoBrutoG: bruto, MinG: bruto - d.MargenNegG, MaxG: bruto + d.MargenPosG };
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
    TaraG: entero(b?.TaraG ?? 0, "Tara (g)", 0, 20000),
    DeshidratacionPct: Math.round(pct * 100) / 100,
    MargenPosG: entero(b?.MargenPosG ?? 0, "Margen + (g)", 0, 20000),
    MargenNegG: entero(b?.MargenNegG ?? 0, "Margen − (g)", 0, 20000),
  };
  const c = calcularEmpaque(d);
  if (c.MinG <= 0) throw new Error("El mínimo queda en 0 o menos: revise el margen −");
  return { Nombre: nombre, Unidad: unidad, ...d, ...c };
}
