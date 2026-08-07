// Cálculo de libras y Lb/Hora del destajo.
//
// Vive aquí y no dentro de una página porque lo consumen dos vistas distintas: el Reporte de
// Producción (rango de fechas, todas las personas, agrupando por Área o por Producto+Talla) y el
// kiosco "Mi Producción de Hoy" (una persona, un solo día). Dos copias de esta regla terminarían
// dando dos números distintos para el mismo pesaje, y la que ve el operario en la pantalla de
// planta tiene que ser la misma que la que ve administración en el reporte.

export const LB_POR_KG = 2.20462;

// Las áreas donde se pesa a destajo, en el orden en que se presentan en pantalla. `nombre` es
// Areas.Nombre tal cual está en la BD: los pesajes llegan con el nombre del área ya resuelto (la
// Transferencia vigente al momento de la pesada), no con el código. `kilos`/`lb` son los campos que
// le corresponden en la respuesta del backend y en las filas ya convertidas a libras.
//
// DT (PELADO Y PINCHADO) entró en producción en ago 2026 sin estar planificada: los pinchos
// (E63/E64/E65) son Familia E igual que Pelado y Devenado, pero se trabajan en otra área con otra
// gente, así que llevan columna y ranking propios en vez de sumarse a Pelado. El equivalente en el
// backend es FAMILIA_ESPERADA_POR_AREA (routes/pesajeDetalle.ts), que es lo que habilita el pesaje.
export const AREAS_DESTAJO = [
  { codigo: "DU", nombre: "DESCABEZADO", etiqueta: "Descabezado", kilos: "KilosDescabezado", lb: "LbDescabezado" },
  { codigo: "DS", nombre: "PELADO Y DEVENADO", etiqueta: "Pelado y Devenado", kilos: "KilosPelado", lb: "LbPelado" },
  { codigo: "DT", nombre: "PELADO Y PINCHADO", etiqueta: "Pelado y Pinchado", kilos: "KilosPinchado", lb: "LbPinchado" },
];

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

// Reparte Puesto (1, 2, 3...) y Semaforo (tercios de POSICIÓN, no de valor) sobre una lista ya
// ordenada de mayor a menor — lo comparten el ranking general y el ranking por área, cada uno
// ordenando por un campo distinto antes de llamar esto.
function asignarPuestoYSemaforo(ordenadas) {
  const n = ordenadas.length;
  const corte1 = Math.ceil(n / 3);
  const corte2 = Math.ceil((n * 2) / 3);
  return ordenadas.map((f, i) => {
    const puesto = i + 1;
    const semaforo = puesto <= corte1 ? "verde" : puesto <= corte2 ? "amarillo" : "rojo";
    return { ...f, Puesto: puesto, Semaforo: semaforo };
  });
}

// Convierte los Kilos agregados por el backend (GET /api/reportes/ranking-produccion) a libras, uno
// por área de destajo. LbTotal NO es la suma de esas áreas — es KilosTotal tal cual lo agregó el
// backend (todas las áreas), para que alguien que produce en un área sin columna propia no quede en
// 0. No asigna Puesto/Semaforo: la pantalla de pared rankea cada área por separado (ver
// calcularRankingPorArea), no este total combinado.
export function calcularLbsPorPersona(filas) {
  return filas.map(f => {
    const porArea = Object.fromEntries(AREAS_DESTAJO.map(a => [a.lb, (f[a.kilos] ?? 0) * LB_POR_KG]));
    return { ...f, ...porArea, LbTotal: f.KilosTotal * LB_POR_KG };
  });
}

// Ranking de una sola área para la pantalla de pared (project_ranking_produccion_pantalla_design):
// se muestra Pelado y Devenado primero y luego Descabezado, cada una como su propia diapositiva —
// así que cada una rankea solo a quien produjo ALGO en esa área hoy (filtro > 0), no a todo el
// personal con un cero incómodo, y el semáforo por tercios se calcula sobre ese subconjunto, no
// sobre la planta completa.
export function calcularRankingPorArea(filas, campoLb) {
  const activos = filas.filter(f => f[campoLb] > 0);
  return asignarPuestoYSemaforo(activos.slice().sort((a, b) => b[campoLb] - a[campoLb]));
}

// Promedio de Lb/Hora ponderado por horas (no un promedio simple de las tasas individuales), y solo
// entre quienes tienen tasa definida — así una persona con una sola pesada no distorsiona el total.
export function totalLbHora(filas) {
  const totalLb = filas.reduce((s, f) => s + f.Lb, 0);
  const conTasa = filas.filter(f => f.LbPorHora != null);
  const sumLb = conTasa.reduce((s, f) => s + f.Lb, 0);
  const sumHoras = conTasa.reduce((s, f) => s + f.Horas, 0);
  return { TotalLb: totalLb, PromedioLbHora: sumHoras > 0 ? sumLb / sumHoras : null };
}
