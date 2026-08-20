
// Se apoya en Intl en vez de armar la cadena a mano para no reinventar el agrupado, y los
// formateadores se crean UNA vez por cantidad de decimales: construir un Intl.NumberFormat es caro
// y estas funciones se llaman una vez por celda, en tablas de cientos de filas.
const cache = new Map();

function formateador(decimales) {
  if (!cache.has(decimales)) {
    cache.set(decimales, new Intl.NumberFormat("es-GT", {
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    }));
  }
  return cache.get(decimales);
}

// Cantidades con decimales: libras, kilos, tasas. `vacio` es lo que se muestra cuando no hay dato —
// null y NaN NO se imprimen como "0.00" a propósito: "no se midió" y "midió cero" son cosas
// distintas, y confundirlas en un reporte de producción es peor que dejar el guion.
export function fmtNum(valor, decimales = 2, vacio = "—") {
  if (valor == null || valor === "" || Number.isNaN(Number(valor))) return vacio;
  return formateador(decimales).format(Number(valor));
}

// Conteos enteros: cajas, master, pesadas, personas. Mismo agrupado, sin decimales.
export function fmtEntero(valor, vacio = "—") {
  return fmtNum(valor, 0, vacio);
}
