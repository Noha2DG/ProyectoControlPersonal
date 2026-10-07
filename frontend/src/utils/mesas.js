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
  PELADORAS: { label: "Peladoras", clase: "bg-blue-100 text-blue-700" },
  APRENDIZAJE: { label: "Aprendizaje", clase: "bg-amber-100 text-amber-700" },
  BANDA: { label: "Banda", clase: "bg-purple-100 text-purple-700" },
  TEMPORAL: { label: "Sin mesa", clase: "bg-gray-200 text-gray-700" },
};
export const tipoMesa = tipo => TIPOS_MESA[tipo] ?? TIPOS_MESA.PELADORAS;

const limpio = s => String(s ?? "").trim().replace(/\s+/g, " ");
const capital = s => limpio(s).toLowerCase().replace(/(^|\s)\p{L}/gu, c => c.toUpperCase());
const inicial = s => (limpio(s).charAt(0) || "").toUpperCase();

// Etiqueta corta del área para la línea de cada persona (las mesas solo cuentan estas dos).
const AREA_CORTA = { "PELADO Y DEVENADO": "Pelado", "DESCABEZADO": "Descabezado" };

// Con menos horas válidas que esto la Lb/hr de un día salta mucho (una sola persona, un rato): en la
// gráfica ese punto va hueco.
export const HORAS_MINIMAS_CONFIABLES = 4;

// BANDA es una mesa más, con personal fijo. Quien pesa sin mesa asignada ese día cae en "BANDA
// TEMPORAL": un grupo que no existe en el catálogo (no se asigna, se llena solo) — cambio del
// 7 oct 2026; antes BANDA misma era el "sin mesa".
export const TEMPORAL = "TEMPORAL";
export const MESA_TEMPORAL = { Codigo: TEMPORAL, Nombre: "BANDA TEMPORAL", Tipo: "TEMPORAL", Orden: 100000 };
const mesaDePesada = p => p.MesaCodigo ?? TEMPORAL;

// Resumen de un día completo por mesa: { [mesa]: { Lb, LbValida, Horas } }. Lo usa el servidor para
// los días anteriores de la gráfica (GET /api/mesas/historial), con la misma calcularLbHora que el
// día de hoy en el navegador. Lb = todo lo pesado; LbValida/Horas = libra y hora válidas (Lb/hr).
//
// Hubo un "% ajustado por talla" (comparar contra la planta en la misma talla) y se quitó el 7 oct
// 2026 a pedido del usuario: confundía más de lo que ayudaba. También se quitó "Lb/hr de hoy vs
// promedio de 5 días": la talla mueve tanto la Lb/hr que la comparación no deja evaluar. No volver a
// meter comparaciones de Lb/hr entre días o mesas sin resolver lo de la talla.
export function resumenDelDia(pesadas, pausas) {
  const filas = calcularLbHora(pesadas, agruparPorArea, pausas);
  const mesaDe = new Map(pesadas.map(p => [p.IdEmpleado, mesaDePesada(p)]));
  const out = {};
  const de = m => (out[m] ??= { Lb: 0, LbValida: 0, Horas: 0 });
  for (const p of pesadas) de(mesaDePesada(p)).Lb += p.Kilos * LB_POR_KG;
  for (const f of filas) {
    if (!(f.Horas > 0)) continue;
    const a = de(mesaDe.get(f.IdEmpleado));
    a.LbValida += f.Lb; a.Horas += f.Horas;
  }
  return out;
}

// "Isabel M." — primer nombre e inicial del primer apellido. Si dos personas de la MISMA vista
// quedan iguales se agrega la inicial del segundo apellido ("Rosa C. R." / "Rosa C. C."), y si aun
// así chocan, el código. Devuelve Map Codigo → nombre corto.
export function nombresCortos(personas) {
  const base = p => `${capital(p.PrimerNombre)} ${inicial(p.PrimerApellido)}.`;
  const conSegundo = p => `${base(p)}${inicial(p.SegundoApellido) ? ` ${inicial(p.SegundoApellido)}.` : ""}`;
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
        SegundoApellido: p.SegundoApellido, MesaCodigo: p.MesaCodigo ?? TEMPORAL, EsLider: !!p.EsLider, UltimaHora: p.Hora,
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
      Asignados: m.Codigo === TEMPORAL ? null : integrantes.filter(i => i.MesaCodigo === m.Codigo).length,
    };
  });
}

// ── Serie de la gráfica: 5 días anteriores + hoy ────────────────────────────────────────────────
const DIAS_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const etiquetaDia = ymd => {
  const [y, m, d] = String(ymd).split("-").map(Number);
  return `${DIAS_CORTOS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}`;
};

// Puntos de la gráfica de una mesa: los días anteriores (GET /api/mesas/historial) y HOY, que sale
// del mismo cálculo que la parte de arriba (mesasHoy = calcularProduccionMesas), así el punto de hoy
// coincide con los totales de arriba. Cada punto: libras del día y Lb/hr (libra válida / hora válida).
// Hoy va en curso: sus libras crecen durante el día hasta alcanzar a los días anteriores.
//
// Sin comparación contra otras mesas a propósito (se quitó el 7 oct 2026): cada mesa trabaja tallas
// distintas y el 100% de cada talla depende de quién más la peló ese día, así que "mejor mesa" o
// "promedio" mezclaban cosas que no son comparables.
export function serieMesa(codigo, mesasHoy, historial, fechaHoy) {
  const deHoy = mesasHoy.find(m => m.Codigo === codigo);
  const hoy = {
    fecha: fechaHoy, esHoy: true,
    mesas: deHoy && deHoy.LbTotal > 0
      ? { [codigo]: { Lb: deHoy.LbTotal, LbValida: deHoy.LbValida, Horas: deHoy.HorasValidas } } : {},
  };
  const dias = [...(historial?.dias ?? []).filter(d => d.fecha !== fechaHoy), hoy];
  return dias.map(d => {
    const propia = d.mesas[codigo];
    return {
      fecha: d.fecha,
      etiqueta: d.esHoy ? "HOY" : etiquetaDia(d.fecha),
      esHoy: !!d.esHoy,
      Lb: propia?.Lb ?? null,
      LbHora: propia && propia.Horas > 0 ? propia.LbValida / propia.Horas : null,
      pocoDato: !!propia && propia.Horas < HORAS_MINIMAS_CONFIABLES,
    };
  });
}

// "10:42" de la marca "YYYY-MM-DD HH:MM:SS" que manda el servidor (hora de Guatemala, sin pasar por Date).
export const horaDe = s => String(s ?? "").slice(11, 16);
