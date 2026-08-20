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
//
// El ÚNICO ancla válida es la entrada al área de destajo (Transferencias a Pelado/Descabezado/
// Pinchado). La Entrada general de Movimientos NO se usa ni como respaldo: es un dato de ASISTENCIA
// (a qué hora llegó a planta), no de cuándo empezó a trabajar el destajo — entre marcar asistencia y
// pararse en la línea puede pasar cualquier cosa, y contar ese rato como tiempo de producción le
// bajaría la tasa a la persona por algo que no hizo. Si no hay entrada al área del día, el bloque se
// descarta y la corrección va en Transferencias, no en el cálculo (ver resumenValidez más abajo).
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
//
// `pausas` son las Transferencias a áreas que "No Genera Paga" (cafetería, baño, permisos — ver
// GET /api/reportes/produccion en reportes.ts) que trae cada fila de porPersona. Sin esto, si alguien
// sale a cafetería y vuelve a pesar en la misma área, el hueco quedaba dentro de un bloque normal
// (mismo grupo, mismo día) y se contaba entero como tiempo trabajado, diluyendo su Lb/Hora real —
// obtenerGrupo agrupa por el NOMBRE del área, así que un viaje de ida y vuelta a cafetería no genera
// un cambio de grupo que dispare el mínimo de 15 min. Acá se resta el tiempo de pausa que se solapa
// con cada bloque ANTES de exigir el mínimo, para que un bloque que sin la pausa cumplía 15 min pero
// que en realidad son 5 min de trabajo y 10 de cafetería quede correctamente descartado.
export function calcularLbHora(porPersona, obtenerGrupo, pausas = []) {
  const pausasPorEmpleado = new Map();
  for (const pa of pausas) {
    if (!pausasPorEmpleado.has(pa.IdEmpleado)) pausasPorEmpleado.set(pa.IdEmpleado, []);
    pausasPorEmpleado.get(pa.IdEmpleado).push(pa);
  }
  function minutosPausa(idEmpleado, inicio, fin) {
    const lista = pausasPorEmpleado.get(idEmpleado);
    if (!lista || !lista.length || fin <= inicio) return 0;
    let minutos = 0;
    for (const pa of lista) {
      const paInicio = new Date(pa.FechaHora).getTime();
      const paFin = pa.FechaSalida ? new Date(pa.FechaSalida).getTime() : fin;
      const solape = Math.min(fin, paFin) - Math.max(inicio, paInicio);
      if (solape > 0) minutos += solape / 60000;
    }
    return minutos;
  }

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
          const inicioBloque = new Date(p.EntradaArea).getTime();
          minutosBloque = Math.max(0, (horaActual - inicioBloque) / 60000 - minutosPausa(idEmpleado, inicioBloque, horaActual));
          valido = minutosBloque >= MINIMO_BLOQUE_MINUTOS;
        }
      } else {
        minutosBloque = Math.max(0, (horaActual - horaAnterior) / 60000 - minutosPausa(idEmpleado, horaAnterior, horaActual));
        valido = esGrupoNuevo ? minutosBloque >= MINIMO_BLOQUE_MINUTOS : minutosBloque > 0;
      }

      horaAnterior = horaActual;
      grupoAnterior = key;
      diaAnterior = diaActual;

      const bucketKey = `${idEmpleado}|${key}`;
      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, {
          IdEmpleado: idEmpleado, Nombre, ...campos,
          Kilos: 0, Horas: 0, NumPesadas: 0, KilosSinTiempo: 0, PesadasSinTiempo: 0,
        });
      }
      const b = buckets.get(bucketKey);
      b.NumPesadas += 1;
      if (valido) {
        b.Kilos += p.Kilos;
        b.Horas += minutosBloque / 60;
      } else {
        // Se lleva aparte lo que el bloque inválido dejó fuera. No entra en Lb (que sigue siendo
        // "libra válida": peso con tiempo medible), pero sin esto la diferencia contra el Procesado
        // del Reporte General quedaba invisible y el reporte parecía estar perdiendo producción.
        b.KilosSinTiempo += p.Kilos;
        b.PesadasSinTiempo += 1;
      }
    });
  }

  return [...buckets.values()].map(({ Kilos, KilosSinTiempo, ...b }) => {
    const lb = Kilos * LB_POR_KG;
    return { ...b, Lb: lb, LbSinTiempo: KilosSinTiempo * LB_POR_KG, LbPorHora: b.Horas > 0 ? lb / b.Horas : null };
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

// Cuánta producción quedó FUERA del "Lb Total" de Lb/Hora y Por Talla, y por qué. Estas dos vistas
// muestran libra válida (peso con tiempo medible), así que su total nunca iguala al Procesado del
// Reporte General; la diferencia se explica sola aquí en vez de parecer producción perdida.
//
// El caso que más pesa en la práctica: alguien que pesó pero cuya Transferencia de área quedó
// abierta desde un día anterior (olvidó marcar salida y no volvió a marcar su entrada AL ÁREA). Sin
// ancla del mismo día su primer bloque no tiene tiempo confiable, y esa pesada se descarta entera.
// Es un problema de marcaje, no de cálculo — por eso se nombra a la gente: es la lista de a quién hay
// que corregirle la transferencia para que su producción vuelva a contar. La corrección se hace en
// Transferencias; que la persona tenga o no Entrada general de asistencia ese día es irrelevante acá.
export function resumenValidez(filas) {
  const lbSinTiempo = filas.reduce((s, f) => s + f.LbSinTiempo, 0);
  const pesadasSinTiempo = filas.reduce((s, f) => s + f.PesadasSinTiempo, 0);
  const personas = [...new Map(
    filas.filter(f => f.PesadasSinTiempo > 0).map(f => [f.IdEmpleado, f.Nombre])
  )].map(([IdEmpleado, Nombre]) => ({ IdEmpleado, Nombre }));
  const totalLb = filas.reduce((s, f) => s + f.Lb, 0) + lbSinTiempo;
  return { LbSinTiempo: lbSinTiempo, PesadasSinTiempo: pesadasSinTiempo, Personas: personas, LbProcesadas: totalLb };
}
