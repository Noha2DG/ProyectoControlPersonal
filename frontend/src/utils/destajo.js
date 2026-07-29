// Cálculo de libras y Lb/Hora del destajo.
//
// Vive aquí y no dentro de una página porque lo consumen dos vistas distintas: el Reporte de
// Producción (rango de fechas, todas las personas, agrupando por Área o por Producto+Talla) y el
// kiosco "Mi Producción de Hoy" (una persona, un solo día). Dos copias de esta regla terminarían
// dando dos números distintos para el mismo pesaje, y la que ve el operario en la pantalla de
// planta tiene que ser la misma que la que ve administración en el reporte.

export const LB_POR_KG = 2.20462;

export const MINIMO_BLOQUE_MINUTOS = 15;

export const diaLocal = (fechaHora) => new Date(fechaHora).toLocaleDateString("sv-SE");

// Recorre la secuencia cronológica COMPLETA de cada persona (todas sus tareas, no una tarea aislada)
// para calcular su tiempo por bloque: el primer bloque de CADA día (no solo el primero del rango
// completo — un reporte de varios días también debe reiniciar el ancla cada día) se cuenta desde que
// entra al área (EntradaArea) hasta esa pesada; los siguientes usan la pesada anterior como referencia.
// EntradaArea solo se usa como ancla si es del MISMO día que la pesada — si la persona no vuelve a
// marcar entrada al área cada día (Transferencias puede quedar abierta varios días sin un nuevo
// registro), un EntradaArea de días atrás producía bloques de 60-100+ horas para una jornada normal de
// 8 horas. Sin ancla confiable ese primer bloque queda inválido, igual que si no hubiera EntradaArea.
// obtenerGrupo(p) decide en qué se agrupa cada pesada (por Área, por Producto+Talla, etc.) — pero
// también importa para el cálculo de horas: si esta pesada cae en un grupo distinto al de la pesada
// inmediatamente anterior de la misma persona, se exige el mismo mínimo de 15 min que al arranque del
// día antes de contar ese bloque. Sin esto, cuando una persona produce dos o tres Producto+Talla casi
// al mismo tiempo (común en Pelado y Devenado: el mismo trabajo se clasifica en distintas tallas sobre
// la marcha), el cambio de grupo puede caer segundos después de la pesada anterior y el bloque le
// atribuye TODO el peso a un lapso casi instantáneo — de ahí las tasas de 40-60+ lb/hr con una sola
// pesada. Dentro de un mismo grupo y mismo día no hay mínimo ni tope: ahí sigue aplicando que un hueco
// largo es el ritmo normal del trabajo (lote grande acumulado), no una pausa. Un bloque inválido no
// aporta ni peso ni tiempo al total — igual que LIBRA VALIDA/HR VALIDA en la planilla de referencia.
export function calcularLbHora(porPersona, obtenerGrupo) {
  const porEmpleado = new Map();
  for (const p of porPersona) {
    if (!porEmpleado.has(p.IdEmpleado)) porEmpleado.set(p.IdEmpleado, { Nombre: p.Nombre, pesadas: [] });
    porEmpleado.get(p.IdEmpleado).pesadas.push(p);
  }

  const buckets = new Map();
  for (const [idEmpleado, { Nombre, pesadas }] of porEmpleado) {
    const ordenadas = pesadas.slice().sort((a, b) => new Date(a.FechaHora) - new Date(b.FechaHora));

    let horaAnterior = null;
    let grupoAnterior = null;
    let diaAnterior = null;
    ordenadas.forEach((p, i) => {
      const horaActual = new Date(p.FechaHora).getTime();
      const diaActual = diaLocal(p.FechaHora);
      const { key, campos } = obtenerGrupo(p);
      const esGrupoNuevo = i === 0 || key !== grupoAnterior;
      const esDiaNuevo = i === 0 || diaActual !== diaAnterior;

      let minutosBloque = 0;
      let valido = false;
      if (esDiaNuevo) {
        if (p.EntradaArea && diaLocal(p.EntradaArea) === diaActual) {
          minutosBloque = (horaActual - new Date(p.EntradaArea).getTime()) / 60000;
          valido = minutosBloque >= MINIMO_BLOQUE_MINUTOS;
        }
      } else {
        minutosBloque = (horaActual - horaAnterior) / 60000;
        valido = esGrupoNuevo ? minutosBloque >= MINIMO_BLOQUE_MINUTOS : minutosBloque > 0;
      }

      horaAnterior = horaActual;
      grupoAnterior = key;
      diaAnterior = diaActual;

      const bucketKey = `${idEmpleado}|${key}`;
      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, { IdEmpleado: idEmpleado, Nombre, ...campos, Kilos: 0, Horas: 0, NumPesadas: 0 });
      }
      const b = buckets.get(bucketKey);
      b.NumPesadas += 1;
      if (valido) {
        b.Kilos += p.Kilos;
        b.Horas += minutosBloque / 60;
      }
    });
  }

  return [...buckets.values()].map(({ Kilos, ...b }) => {
    const lb = Kilos * LB_POR_KG;
    return { ...b, Lb: lb, LbPorHora: b.Horas > 0 ? lb / b.Horas : null };
  });
}

export const agruparPorArea = p => ({ key: p.Area ?? "", campos: { Area: p.Area ?? null } });
export const agruparPorProductoTalla = p => ({
  key: `${p.Producto}|${p.Talla}`,
  campos: { Producto: p.Producto, Talla: p.Talla, DescripcionTalla: p.DescripcionTalla },
});

// Promedio de Lb/Hora ponderado por horas (no un promedio simple de las tasas individuales), y solo
// entre quienes tienen tasa definida — así una persona con una sola pesada no distorsiona el total.
export function totalLbHora(filas) {
  const totalLb = filas.reduce((s, f) => s + f.Lb, 0);
  const conTasa = filas.filter(f => f.LbPorHora != null);
  const sumLb = conTasa.reduce((s, f) => s + f.Lb, 0);
  const sumHoras = conTasa.reduce((s, f) => s + f.Horas, 0);
  return { TotalLb: totalLb, PromedioLbHora: sumHoras > 0 ? sumLb / sumHoras : null };
}
