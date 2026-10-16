// Producción del día por mesa de pelado. Lo usan la pestaña "Por Mesa" de Destajo y la página que
// abre el QR de cada mesa (#/mesa/:codigo), sobre los datos de GET /api/mesas/hoy.
//
// La Lb/Hora sale de calcularLbHora con agruparPorArea — exactamente lo mismo que la pestaña Lb/Hora
// del Reporte de Producción — y aquí solo se suma por persona y por mesa. Así una mesa no puede dar
// un número distinto en el QR que en el reporte.
import { calcularLbHora, agruparPorArea, LB_POR_KG } from "./destajo.js";

// Dirección pública con la que se imprimen los QR. Fija y no window.location: si alguien imprime
// desde su PC de desarrollo o por IP, el letrero tiene que seguir apuntando a la planta.
export const URL_PUBLICA = "https://planta.esteromar.app";
export const urlDeMesa = codigo => `${URL_PUBLICA}/#/mesa/${encodeURIComponent(codigo)}`;

export const TIPOS_MESA = {
  // Tema "verde estero" de la vista de mesas: encabezado #0F5E57, acento #0F766E.
  // `color` = acento del tipo: línea de arriba de la tarjeta, Lb/hr y barra de asistencia.
  PELADORAS: { label: "Peladoras", clase: "bg-[#d9f0ea] text-[#0F5E57] border border-[#a9dccd]", color: "#0F766E" },
  APRENDIZAJE: { label: "Aprendizaje", clase: "bg-amber-50 text-amber-800 border border-amber-300", color: "#a16207" },
  BANDA: { label: "Banda", clase: "bg-violet-50 text-violet-700 border border-violet-200", color: "#6d28d9" },
  TEMPORAL: { label: "Sin mesa", clase: "bg-gray-100 text-gray-600 border border-gray-300", color: "#6b7280" },
};
export const tipoMesa = tipo => TIPOS_MESA[tipo] ?? TIPOS_MESA.PELADORAS;

const limpio = s => String(s ?? "").trim().replace(/\s+/g, " ");
const capital = s => limpio(s).toLowerCase().replace(/(^|\s)\p{L}/gu, c => c.toUpperCase());
const inicial = s => (limpio(s).charAt(0) || "").toUpperCase();

// Etiqueta corta del área para la línea de cada persona (las mesas solo cuentan estas dos).
const AREA_CORTA = { "PELADO Y DEVENADO": "Pelado", "DESCABEZADO": "Descabezado" };

// BANDA es una mesa más, con personal fijo. Quien pesa sin mesa asignada ese día cae en "BANDA
// TEMPORAL": un grupo que no existe en el catálogo (no se asigna, se llena solo) — cambio del
// 7 oct 2026; antes BANDA misma era el "sin mesa".
export const TEMPORAL = "TEMPORAL";
export const MESA_TEMPORAL = { Codigo: TEMPORAL, Nombre: "BANDA TEMPORAL", Tipo: "TEMPORAL", Orden: 100000 };

// Nota para quien agregue cálculos aquí: hubo un "% ajustado por talla" (comparar contra la planta en la misma talla) y se quitó el 7 oct
// 2026 a pedido del usuario: confundía más de lo que ayudaba. También se quitó "Lb/hr de hoy vs
// promedio de 5 días": la talla mueve tanto la Lb/hr que la comparación no deja evaluar. No volver a
// meter comparaciones de Lb/hr entre días o mesas sin resolver lo de la talla.
//
// Lo de la talla quedó resuelto con la META POR TALLA (12 oct 2026, pedido del usuario): cada talla
// tiene su meta Lb/hr sacada de la tarifa (salario mínimo ÷ tarifa ÷ horas de jornada; el backend la
// manda en `datos.metas` por clase + talla). Así cada quien se mide contra lo que se espera en lo que
// le tocó pelar, no contra otra mesa ni otro día.

// ── Meta por talla, en LIBRAS ACUMULADAS, contra el RELOJ ─────────────────────────────────────────
// La comparación es sobre las libras acumuladas del día, NO sobre la Lb/hr (pedido del usuario).
//
// Las libras esperadas avanzan con el TIEMPO EN EL ÁREA, no con las pesadas. (La primera versión,
// del mismo 12 oct, las sacaba de las horas válidas de calcularLbHora; como un bloque solo se cierra
// cuando llega la pesada, la meta se quedaba plana entre pesadas y subía junto con lo real: la línea
// punteada copiaba a la real y no decía nada. El usuario lo notó en la gráfica.)
//
//   Libras esperadas hasta un momento = Σ minutos en Pelado/Descabezado (datos.tiempos) × meta Lb/hr
//   de la talla que se estaba trabajando en ese rato.
// · La talla de un rato es la de la pesada que lo cierra (la misma atribución que el Reporte). El
//   rato abierto después de la última pesada va con esa última talla; el de antes de su primera
//   pesada, si aún no pesa, con la última talla pesada en su mesa.
// · Con dos o más tallas NO se promedian metas: cada rato aporta minutos × la meta de su talla
//   (equivale a ponderar las metas por tiempo; un promedio simple pesaría igual 20 min de 16/20 que
//   6 h de 26/30, y ponderar por libras premiaría la talla donde más rindió).
// · Un tramo de área reabierto por el corte de medianoche (Automatica) no dice a qué hora empezó a
//   trabajar: cuenta desde su primera pesada. Y se deja de contar tiempo MAX_HORAS_SIN_PESAR después
//   de su última pesada: quien se fue sin marcar salida no debe seguir acumulando meta.
// · Libras que no se pueden medir —pesada sin tiempo en el área antes (sin marcaje), o de un
//   producto/talla sin tarifa— se dan POR BUENAS: suman igual en lo real y en lo esperado.
//   LbMeta = libras esperadas + libras no medibles;  VsMeta = Lb acumuladas ÷ LbMeta − 1.
// Así, entre dos pesadas la meta sigue subiendo y lo real se queda plano (la brecha crece en rojo);
// al pesar, lo real salta y se ve si alcanzó.
export const TOLERANCIA_META = 10; // hasta este % bajo la meta se ve "cerca" (ámbar); más abajo, rojo
export const MAX_HORAS_SIN_PESAR = 3;

const llaveMeta = (clase, talla) => `${clase}|${talla}`;
const mapaMetas = datos => new Map((datos?.metas ?? []).map(m => [llaveMeta(m.Clase, m.Talla), Number(m.MetaLbHora)]));

// Minuto del día de una marca del servidor ("YYYY-MM-DD HH:MM:SS", o ISO con la "Z" mentirosa): se
// leen los dígitos, sin pasar por Date. Una marca de un día anterior a `fecha` cuenta como 0:00.
function minutoDelDia(marca, fecha) {
  const t = String(marca ?? "");
  if (t.slice(0, 10) < fecha) return 0;
  return Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16)) + Number(t.slice(17, 19) || 0) / 60;
}

// Libras esperadas de UNA persona hasta el minuto `corte`. `pes` = sus pesadas de hoy hasta el corte,
// en orden, con `min` (minuto del día) y `lb`; `tramos` = sus tramos en el área (datos.tiempos).
function esperadoPersona(pes, tramos, corte, fecha, metas, pesadaMesa) {
  const metaDe = p => (p ? metas.get(llaveMeta(p.Clase, p.Talla)) : undefined);
  const ultima = pes.length ? pes[pes.length - 1].min : null;
  const r = { LbEsperada: 0, HorasSinMeta: 0, LbNoMedible: 0 };
  const cubiertos = []; // [ini, fin] efectivos: una pesada dentro de (ini, fin] tiene tiempo medido antes
  for (const tr of tramos) {
    let fin = Math.min(tr.Hasta ? minutoDelDia(tr.Hasta, fecha) : corte, corte);
    let ini = tr.Automatica ? null : minutoDelDia(tr.Desde, fecha);
    if (ini == null) {
      const primera = pes.find(p => p.min <= fin);
      if (!primera) continue;
      ini = primera.min;
    }
    fin = Math.min(fin, (ultima ?? ini) + MAX_HORAS_SIN_PESAR * 60);
    if (fin <= ini) continue;
    cubiertos.push([ini, fin]);
    // Partido en las pesadas: cada rato va con la talla de la pesada que lo cierra.
    const cortes = [ini, ...pes.map(p => p.min).filter(m => m > ini && m < fin), fin];
    for (let i = 0; i + 1 < cortes.length; i++) {
      const a = cortes[i], b = cortes[i + 1];
      if (b <= a) continue;
      const pesada = pes.find(p => p.min >= b) ?? pes[pes.length - 1] ?? pesadaMesa;
      const meta = metaDe(pesada);
      if (meta != null) r.LbEsperada += ((b - a) / 60) * meta;
      else r.HorasSinMeta += (b - a) / 60;
    }
  }
  for (const p of pes) {
    const medida = metaDe(p) != null && cubiertos.some(([a, b]) => p.min > a && p.min <= b);
    if (!medida) r.LbNoMedible += p.lb;
  }
  return r;
}

// Meta de un grupo de personas (una mesa) hasta el minuto `corte`: Map Codigo → resultado de
// esperadoPersona más Lb (todo lo pesado hasta el corte).
function metaDeGrupo(codigos, datos, corte) {
  const fecha = datos.fecha, metas = mapaMetas(datos);
  const pes = (datos.pesadas ?? [])
    .filter(p => codigos.has(p.IdEmpleado))
    .map(p => ({ ...p, min: minutoDelDia(p.FechaHora, fecha), lb: p.Kilos * LB_POR_KG }))
    .filter(p => p.min <= corte)
    .sort((a, b) => a.min - b.min);
  const pesadaMesa = pes[pes.length - 1];
  const res = new Map();
  for (const c of codigos) {
    const suyas = pes.filter(p => p.IdEmpleado === c);
    const tramos = (datos.tiempos ?? []).filter(t => t.IdEmpleado === c);
    res.set(c, { ...esperadoPersona(suyas, tramos, corte, fecha, metas, pesadaMesa), Lb: suyas.reduce((s, p) => s + p.lb, 0) });
  }
  return res;
}

// LbMeta y VsMeta de un acumulado { Lb, LbEsperada, LbNoMedible }. Sin tiempo con meta → null ("sin meta").
function cerrarMeta(a) {
  const lbMeta = a.LbEsperada > 0 ? a.LbEsperada + a.LbNoMedible : null;
  return { LbEsperada: a.LbEsperada, LbNoMedible: a.LbNoMedible, HorasSinMeta: a.HorasSinMeta,
    LbMeta: lbMeta, VsMeta: lbMeta ? (a.Lb / lbMeta - 1) * 100 : null };
}
const sumarMetas = lista => lista.reduce((acc, x) => {
  acc.Lb += x.Lb; acc.LbEsperada += x.LbEsperada; acc.LbNoMedible += x.LbNoMedible; acc.HorasSinMeta += x.HorasSinMeta;
  return acc;
}, { Lb: 0, LbEsperada: 0, LbNoMedible: 0, HorasSinMeta: 0 });
const ahoraMin = datos => minutoDelDia(datos.generado, datos.fecha);

// Meta de TODA la planta en un área, hasta ahora (aviso del resumen de Por Mesa): Pelado y, desde el
// 14 oct 2026, Descabezado (grupo DESC_, tallas 850/851/852). Un área sin tarifa da VsMeta null. Mismo cálculo que una
// mesa, pero con las pesadas hechas en esa área y el tiempo marcado en ella (sin importar la mesa).
// `nombreArea` = Areas.Nombre (así llegan las pesadas); `codigoArea` = así llegan los tiempos.
export function metaDeArea(datos, codigoArea, nombreArea) {
  if (!datos) return null;
  const sub = {
    ...datos,
    pesadas: (datos.pesadas ?? []).filter(p => p.Area === nombreArea),
    tiempos: (datos.tiempos ?? []).filter(t => t.CodigoArea === codigoArea),
  };
  const codigos = new Set([...sub.pesadas.map(p => p.IdEmpleado), ...sub.tiempos.map(t => t.IdEmpleado)]);
  const total = sumarMetas([...metaDeGrupo(codigos, sub, ahoraMin(datos)).values()]);
  return { Lb: total.Lb, ...cerrarMeta(total) };
}

// "+12%" / "−8%" (signo menos de verdad, se lee mejor que el guion). null = sin meta.
export function fmtVsMeta(v) {
  if (v == null) return "—";
  const r = Math.round(v);
  return r > 0 ? `+${r}%` : r < 0 ? `−${-r}%` : "0%";
}
// arriba (verde) = en la meta o encima; cerca (ámbar) = hasta TOLERANCIA_META abajo; abajo (rojo).
export function estadoMeta(v) {
  if (v == null) return null;
  return Math.round(v) >= 0 ? "arriba" : v >= -TOLERANCIA_META ? "cerca" : "abajo";
}
export const COLOR_META = {
  arriba: { texto: "text-emerald-700", fondo: "bg-emerald-50 border-emerald-200", hex: "#047857" },
  cerca: { texto: "text-amber-700", fondo: "bg-amber-50 border-amber-200", hex: "#b45309" },
  abajo: { texto: "text-red-700", fondo: "bg-red-50 border-red-200", hex: "#b91c1c" },
};

// "Carmen Nohemi S." — primer nombre, segundo nombre completo (si tiene) e inicial del primer apellido. Si dos personas de la MISMA vista
// quedan iguales se agrega la inicial del segundo apellido ("Rosa C. R." / "Rosa C. C."), y si aun
// así chocan, el código. Devuelve Map Codigo → nombre corto.
export function nombresCortos(personas) {
  const ini = s => (inicial(s) ? ` ${inicial(s)}.` : "");
  const base = p => `${capital(p.PrimerNombre)}${limpio(p.SegundoNombre) ? ` ${capital(p.SegundoNombre)}` : ""}${ini(p.PrimerApellido)}`;
  const conSegundo = p => `${base(p)}${ini(p.SegundoApellido)}`;
  const contar = (lista, f) => lista.reduce((m, p) => m.set(f(p), (m.get(f(p)) ?? 0) + 1), new Map());

  const n1 = contar(personas, base);
  const paso1 = personas.map(p => ({ p, nombre: n1.get(base(p)) > 1 ? conSegundo(p) : base(p) }));
  const n2 = contar(paso1, x => x.nombre);
  return new Map(paso1.map(({ p, nombre }) => [p.Codigo, n2.get(nombre) > 1 ? `${nombre} (${p.Codigo})` : nombre]));
}

// Arma, para cada mesa activa, sus personas con libras y Lb/Hora, y los totales de la mesa.
//   Lb        → todo lo que pesó la persona hoy (incluye lo que quedó sin hora válida).
//   LbPorHora → libra válida / hora válida (mismas reglas del Reporte: bloque mínimo, pausas, entrada).
//   Mesa      → Lb/Hora PONDERADA: Σ libra válida / Σ hora válida de quienes tienen tasa, no el
//               promedio de las tasas (alguien con 1 hora no pesa igual que alguien con 8).
// Banda temporal = quien pesó hoy sin mesa asignada ese día; no tiene "asignados".
export function calcularProduccionMesas(datos) {
  if (!datos) return [];
  const { mesas = [], integrantes = [], pesadas = [], pausas = [] } = datos;

  const filas = calcularLbHora(pesadas, agruparPorArea, pausas);
  const porPersona = new Map();
  for (const f of filas) {
    const a = porPersona.get(f.IdEmpleado) ?? { LbValida: 0, Horas: 0, LbSinTiempo: 0, NumPesadas: 0 };
    a.LbValida += f.Lb; a.Horas += f.Horas; a.LbSinTiempo += f.LbSinTiempo; a.NumPesadas += f.NumPesadas;
    porPersona.set(f.IdEmpleado, a);
  }

  // Datos de cada persona (nombre, mesa, líder, última pesada). La mesa sale de la asignación del
  // día; quien pesó sin asignación va a Banda temporal.
  const personas = new Map();
  for (const i of integrantes) personas.set(i.Codigo, { ...i, MesaCodigo: i.MesaCodigo, UltimaHora: null, AreasSet: new Set() });
  for (const p of pesadas) {
    let actual = personas.get(p.IdEmpleado);
    if (!actual) {
      actual = {
        Codigo: p.IdEmpleado, PrimerNombre: p.PrimerNombre, PrimerApellido: p.PrimerApellido,
        SegundoApellido: p.SegundoApellido, SegundoNombre: p.SegundoNombre, MesaCodigo: p.MesaCodigo ?? TEMPORAL, EsLider: !!p.EsLider, UltimaHora: p.Hora,
        AreasSet: new Set(),
      };
      personas.set(p.IdEmpleado, actual);
    } else if (!actual.UltimaHora || p.Hora > actual.UltimaHora) actual.UltimaHora = p.Hora;
    if (AREA_CORTA[p.Area]) actual.AreasSet.add(AREA_CORTA[p.Area]);
  }

  return [...mesas, MESA_TEMPORAL].map(m => {
    const lista = [...personas.values()].filter(p => p.MesaCodigo === m.Codigo).map(({ AreasSet, ...p }) => {
      const a = porPersona.get(p.Codigo);
      return {
        ...p,
        Areas: ["Pelado", "Descabezado"].filter(x => AreasSet.has(x)).join(" + "),
        Lb: a ? a.LbValida + a.LbSinTiempo : 0,
        LbValida: a?.LbValida ?? 0,
        Horas: a?.Horas ?? 0,
        LbSinTiempo: a?.LbSinTiempo ?? 0,
        NumPesadas: a?.NumPesadas ?? 0,
        LbPorHora: a && a.Horas > 0 ? a.LbValida / a.Horas : null,
      };
    });
    // Meta contra el reloj (hasta ahora) de cada persona de la mesa.
    const metaMesa = metaDeGrupo(new Set(lista.map(p => p.Codigo)), datos, ahoraMin(datos));
    lista.forEach(p => Object.assign(p, cerrarMeta(metaMesa.get(p.Codigo))));
    const cortos = nombresCortos(lista);
    lista.forEach(p => { p.NombreCorto = cortos.get(p.Codigo); });
    lista.sort((a, b) => (b.NumPesadas > 0) - (a.NumPesadas > 0) || b.Lb - a.Lb || a.NombreCorto.localeCompare(b.NombreCorto, "es"));

    // Tallas trabajadas hoy por la mesa. Se cuentan por CÓDIGO, no por descripción: la tabla de tallas
    // tiene dos escalas con descripciones repetidas (261 y 376 son ambas "150/200").
    const codigos = new Set(lista.map(p => p.Codigo));
    const tallas = new Map();
    for (const p of pesadas) if (codigos.has(p.IdEmpleado) && p.Talla != null) tallas.set(p.Talla, p.DescripcionTalla);
    const conTasa = lista.filter(p => p.LbPorHora != null);
    const horas = conTasa.reduce((s, p) => s + p.Horas, 0);
    return {
      ...m,
      personas: lista,
      // Orden de grande a chica por el primer número de la talla ("16/20" antes que "41/50"); el
      // código no sigue ese orden.
      Tallas: [...tallas.entries()]
        .sort((a, b) => (parseInt(a[1]) || 9999) - (parseInt(b[1]) || 9999) || a[0] - b[0])
        .map(([, d]) => d),
      LbValida: lista.reduce((s, p) => s + p.LbValida, 0),
      HorasValidas: lista.reduce((s, p) => s + p.Horas, 0),
      LbTotal: lista.reduce((s, p) => s + p.Lb, 0),
      LbHoraPonderada: horas > 0 ? conTasa.reduce((s, p) => s + p.LbValida, 0) / horas : null,
      Pesando: lista.filter(p => p.NumPesadas > 0).length,
      // Meta de la mesa: suma de las libras esperadas de cada persona (cada una con sus tallas y su tiempo).
      ...cerrarMeta(sumarMetas([...metaMesa.values()])),
      Asignados: m.Codigo === TEMPORAL ? null : integrantes.filter(i => i.MesaCodigo === m.Codigo).length,
    };
  });
}

// ── Serie de la gráfica: hoy, hora por hora ──────────────────────────────────────────────────────
// (Antes eran los 5 días anteriores + hoy; el 8 oct 2026 el usuario la cambió a las horas del día.)
//
// Las pesadas no caen en horas exactas, así que cada una va a la FRANJA de su hora en punto:
// 7:42 → "7:00", que cubre de 7:00 a 7:59. La hora se lee de los dígitos que manda el servidor
// (`Hora` = "HH:MM", hora de Guatemala), sin pasar por Date.
//
// Cada punto es lo ACUMULADO del día hasta el final de esa hora, no lo de esa hora sola: las mesas
// juntan producto y pesan por tandas, así que hora por hora salían ceros en horas trabajadas
// (8 oct 2026: MESA 2 con 0 lb a las 8, 9 y 11) y la gráfica parecía decir "no trabajaron".
//   Lb     → todo lo pesado hasta esa hora (mismo criterio que "Libras hoy" de arriba).
//   LbMeta → libras esperadas acumuladas hasta el final de esa hora (o hasta ahora, en la hora en
//            curso) según el tiempo en el área; VsMeta = Lb ÷ LbMeta − 1. Como la meta sigue el
//            reloj, la serie se alarga hasta la hora en curso aunque aún no hayan pesado en ella
//            (como mucho MAX_HORAS_SIN_PESAR después de la última pesada).
//   LbHora → libra válida / hora válida hasta esa hora: el ritmo del día a esa altura. Sale de la
//            misma calcularLbHora del Reporte corrida con las pesadas hasta el final de la hora. Un
//            bloque nunca depende de pesadas posteriores, así que cortar el día en una hora no cambia
//            los bloques ya cerrados, y el último punto es igual a la Lb/hr ponderada de la tarjeta.
// Con menos de HORAS_MINIMAS_FRANJA horas válidas acumuladas (arranque del día, una o dos
// personas) la Lb/hr salta mucho: el punto va hueco.
export const HORAS_MINIMAS_FRANJA = 1;
const horaEntera = hhmm => Number(String(hhmm ?? "").slice(0, 2));

export function serieHorasMesa(mesa, datos) {
  if (!mesa || !datos) return [];
  const codigos = new Set(mesa.personas.map(p => p.Codigo));
  const pesadas = (datos.pesadas ?? []).filter(p => codigos.has(p.IdEmpleado));
  if (!pesadas.length) return [];

  const horas = pesadas.map(p => horaEntera(p.Hora));
  const enCurso = horaEntera(horaDe(datos.generado));
  const ultimaHora = Math.max(...horas);
  const desde = Math.min(...horas);
  const hasta = Math.max(ultimaHora, Math.min(enCurso, ultimaHora + MAX_HORAS_SIN_PESAR));
  const ahora = ahoraMin(datos);

  const serie = [];
  for (let h = desde; h <= hasta; h++) {
    const hastaH = pesadas.filter((_, i) => horas[i] <= h);
    const valida = calcularLbHora(hastaH, agruparPorArea, datos.pausas ?? [])
      .reduce((a, f) => ({ lb: a.lb + f.Lb, h: a.h + f.Horas }), { lb: 0, h: 0 });
    const lb = hastaH.reduce((s, p) => s + p.Kilos * LB_POR_KG, 0);
    const meta = cerrarMeta(sumarMetas([...metaDeGrupo(codigos, datos, Math.min((h + 1) * 60, ahora)).values()]));
    serie.push({
      hora: h,
      etiqueta: `${h}:00`,
      esActual: h === enCurso,
      Lb: lb,
      LbHora: valida.h > 0 ? valida.lb / valida.h : null,
      pocoDato: valida.h > 0 && valida.h < HORAS_MINIMAS_FRANJA,
      // Acumulado contra la meta hasta esa hora (mismas reglas que la tarjeta: el último punto es
      // igual al % de la mesa).
      LbMeta: meta.LbMeta,
      VsMeta: meta.VsMeta,
    });
  }
  return serie;
}

// "10:42" de la marca "YYYY-MM-DD HH:MM:SS" que manda el servidor (hora de Guatemala, sin pasar por Date).
export const horaDe = s => String(s ?? "").slice(11, 16);
