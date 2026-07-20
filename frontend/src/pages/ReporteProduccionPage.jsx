import { useState, useEffect, useCallback, Fragment } from "react";
import { authHeader } from "../context/AuthContext.jsx";
import { exportarReporteGeneral, exportarReporteTermos, exportarEficiencias, exportarLbHora, exportarLbHoraPorTalla, exportarLbPorPersona } from "../utils/exportExcel.js";
import { useColWidths, Th, Colgroup } from "../components/ResizableTh.jsx";

const LOTE_DET_COL_DEFAULTS = { talla: 160, producto: 180, estado: 110, procesado: 100, pesajes: 90 };
const LOTE_DET_COLS = Object.keys(LOTE_DET_COL_DEFAULTS);
const TERMO_DET_COL_DEFAULTS = { lote: 110, talla: 150, proceso: 130, fecha: 110, kg: 90 };
const TERMO_DET_COLS = Object.keys(TERMO_DET_COL_DEFAULTS);
const TALLA_DET_COL_DEFAULTS = { id: 100, nombre: 150, lb: 90, horas: 90, lbhora: 90, pesadas: 90 };
const TALLA_DET_COLS = Object.keys(TALLA_DET_COL_DEFAULTS);

const POR_LOTE_COL_DEFAULTS = { expand: 30, lote: 130, finca: 130, clase: 150, fecha: 100, ingreso: 100, procesado: 100, pendiente: 100, rend: 90, transac: 90 };
const POR_LOTE_COLS = Object.keys(POR_LOTE_COL_DEFAULTS);
const POR_TALLA_GEN_COL_DEFAULTS = { talla: 220, kg: 100, pct: 90 };
const POR_TALLA_GEN_COLS = Object.keys(POR_TALLA_GEN_COL_DEFAULTS);
const TERMOS_COL_DEFAULTS = { expand: 24, termo: 110, detalle: 220, kg: 110 };
const TERMOS_COLS = Object.keys(TERMOS_COL_DEFAULTS);
const EFICIENCIAS_COL_DEFAULTS = { id: 100, nombre: 150, area: 110, fecha: 100, hora: 80, lote: 120, producto: 130, talla: 150, kilos: 100 };
const EFICIENCIAS_COLS = Object.keys(EFICIENCIAS_COL_DEFAULTS);
const LBHORA_COL_DEFAULTS = { id: 100, nombre: 150, area: 110, lb: 90, horas: 90, lbhora: 90, pesadas: 90 };
const LBHORA_COLS = Object.keys(LBHORA_COL_DEFAULTS);
const PORTALLA_COL_DEFAULTS = { expand: 24, productoTalla: 220, lbTotal: 100, lbHoraProm: 110, numPersonas: 100 };
const PORTALLA_COLS = Object.keys(PORTALLA_COL_DEFAULTS);
const LBPERSONA_COL_DEFAULTS = { puesto: 80, id: 100, nombre: 150, descabezado: 130, pelado: 150, total: 100 };
const LBPERSONA_COLS = Object.keys(LBPERSONA_COL_DEFAULTS);

function hoy() { return new Date().toLocaleDateString("sv-SE"); }

// estado es solo para el color del botón (ver render): "listo" = gris, "progreso" = ámbar mientras
// se sigue ajustando Lb/Hora y Por Talla.
const SUB_TABS = [
  { key: "general",     label: "Reporte General", estado: "listo" },
  { key: "termos",      label: "Reporte Termos",  estado: "listo" },
  { key: "eficiencias", label: "Eficiencias",     estado: "listo" },
  { key: "lbhora",      label: "Lb/Hora",         estado: "progreso" },
  { key: "portalla",    label: "Por Talla",       estado: "progreso" },
  { key: "lbpersona",   label: "Lb/Persona",      estado: "listo" },
];

// Eficiencias, Lb/Hora, Por Talla y Lb/Persona son vistas por persona, no por lote de Materia Prima —
// no tiene sentido mostrarles el resumen de Ingreso/Procesado/Pendiente/Rendimiento.
const SUB_TABS_SIN_TOTALES = ["eficiencias", "lbhora", "portalla", "lbpersona"];
// Ninguna de estas tres usa Finca (son vistas por persona, no por lote/origen).
const SUB_TABS_SIN_FINCA = ["lbhora", "portalla", "lbpersona"];
// Solo Lb/Hora y Por Talla filtran por Área — Lb/Persona siempre muestra Descabezado y
// Pelado y Devenado lado a lado, así que un filtro de Área no tendría sentido ahí.
const SUB_TABS_CON_AREA = ["lbhora", "portalla"];

const LB_POR_KG = 2.20462;

const MINIMO_BLOQUE_MINUTOS = 15;

const diaLocal = (fechaHora) => new Date(fechaHora).toLocaleDateString("sv-SE");

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
function calcularLbHora(porPersona, obtenerGrupo) {
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

const agruparPorArea = p => ({ key: p.Area ?? "", campos: { Area: p.Area ?? null } });
const agruparPorProductoTalla = p => ({
  key: `${p.Producto}|${p.Talla}`,
  campos: { Producto: p.Producto, Talla: p.Talla, DescripcionTalla: p.DescripcionTalla },
});

// Una tasa calculada con pocas pesadas o poco tiempo válido puede ser real pero es más fácil que sea
// producto de un dato aislado (ver project_destajo_lbhora_referencia_excel) — se marca en vez de
// mostrarla igual que una tasa con base sólida, sin dejar de mostrarla (no es un dato inválido).
const CONFIANZA_MIN_HORAS = 1;
const CONFIANZA_MIN_PESADAS = 3;
function esBajaConfianza(f) {
  return f.LbPorHora != null && (f.NumPesadas < CONFIANZA_MIN_PESADAS || f.Horas < CONFIANZA_MIN_HORAS);
}

function CeldaLbHora({ f }) {
  if (f.LbPorHora == null) return <span className="text-gray-300 font-normal">—</span>;
  if (esBajaConfianza(f)) {
    return (
      <span title={`Dato de baja confianza: ${f.NumPesadas} pesada${f.NumPesadas !== 1 ? "s" : ""}, ${f.Horas.toFixed(2)} h válidas`}
        className="text-amber-600">
        {f.LbPorHora.toFixed(1)} <span className="text-[10px] align-top">●</span>
      </span>
    );
  }
  return <>{f.LbPorHora.toFixed(1)}</>;
}

// Solo libras acumuladas por persona en las dos áreas de destajo, sin hora ni tasa — no usa
// calcularLbHora porque no necesita el cálculo de bloques/tiempo, solo sumar Kilos por Área. Un
// pesaje con Área distinta a estas dos (o sin Área resuelta, ver project_destajo_area_familia_validacion
// y el caso Susan Valeska/TUNEL) no entra en ninguna columna ni en el Total — es un caso raro y esta
// vista solo pidió estas dos columnas.
function calcularLbPorPersona(porPersona) {
  const porEmpleado = new Map();
  for (const p of porPersona) {
    if (!porEmpleado.has(p.IdEmpleado)) {
      porEmpleado.set(p.IdEmpleado, { IdEmpleado: p.IdEmpleado, Nombre: p.Nombre, LbDescabezado: 0, LbPelado: 0 });
    }
    const acc = porEmpleado.get(p.IdEmpleado);
    const lb = p.Kilos * LB_POR_KG;
    if (p.Area === "DESCABEZADO") acc.LbDescabezado += lb;
    else if (p.Area === "PELADO Y DEVENADO") acc.LbPelado += lb;
  }
  const filas = [...porEmpleado.values()]
    .map(f => ({ ...f, LbTotal: f.LbDescabezado + f.LbPelado }))
    .sort((a, b) => b.LbTotal - a.LbTotal);

  // Semáforo por tercios de POSICIÓN (no de valor): siempre reparte verde/amarillo/rojo en
  // proporciones iguales sin importar cuánto varíe el Total de un día a otro — no hay que retocar un
  // umbral fijo de libras cada vez que cambia el volumen del día. El primer tercio (mejor Total) queda
  // verde, el de en medio amarillo, el último rojo.
  const n = filas.length;
  const corte1 = Math.ceil(n / 3);
  const corte2 = Math.ceil((n * 2) / 3);
  return filas.map((f, i) => {
    const puesto = i + 1;
    const semaforo = puesto <= corte1 ? "verde" : puesto <= corte2 ? "amarillo" : "rojo";
    return { ...f, Puesto: puesto, Semaforo: semaforo };
  });
}

// Colores suaves (tono "-50", el más pálido de la escala) para no competir con el texto ni con el
// resto de la tabla — es un fondo de fila, no una alerta que deba saltar a la vista.
const FILA_SEMAFORO = { verde: "bg-green-50", amarillo: "bg-amber-50", rojo: "bg-red-50" };

// Promedio de Lb/Hora ponderado por horas (no un promedio simple de las tasas individuales), y solo
// entre quienes tienen tasa definida — así una persona con una sola pesada no distorsiona el total.
function totalLbHora(filas) {
  const totalLb = filas.reduce((s, f) => s + f.Lb, 0);
  const conTasa = filas.filter(f => f.LbPorHora != null);
  const sumLb = conTasa.reduce((s, f) => s + f.Lb, 0);
  const sumHoras = conTasa.reduce((s, f) => s + f.Horas, 0);
  return { TotalLb: totalLb, PromedioLbHora: sumHoras > 0 ? sumLb / sumHoras : null };
}

// Una talla que representa menos de esto del total de SU MISMO Producto (todas las tallas que salieron
// de esa clasificación, no de todo lo procesado) es producción incidental — el tamaño chico o grande
// que sale de forma natural junto a la talla objetivo, no algo a planificar o alertar por separado. Se
// recalcula siempre sobre el acumulado actual (no hay estado guardado), así que si más adelante en el
// proceso esa talla supera el umbral, deja de marcarse sola, sin ninguna lógica extra.
const UMBRAL_TALLA_SECUNDARIA_PORCENTAJE = 0.05;

// Agrupa las filas por persona (ya calculadas por Producto+Talla) en un resumen por tarea, para la
// vista "Por Talla": una fila por Producto+Talla con el total del equipo, expandible al detalle.
function gruposPorProductoTalla(filas) {
  const mapa = new Map();
  for (const f of filas) {
    const key = `${f.Producto}|${f.Talla}`;
    if (!mapa.has(key)) mapa.set(key, { Producto: f.Producto, Talla: f.Talla, DescripcionTalla: f.DescripcionTalla, filas: [] });
    mapa.get(key).filas.push(f);
  }
  const grupos = [...mapa.values()];
  for (const g of grupos) {
    g.filas.sort((a, b) => b.Lb - a.Lb);
    g.resumen = { ...totalLbHora(g.filas), NumPersonas: g.filas.length };
  }

  const totalPorProducto = new Map();
  for (const g of grupos) totalPorProducto.set(g.Producto, (totalPorProducto.get(g.Producto) ?? 0) + g.resumen.TotalLb);
  for (const g of grupos) {
    const totalProducto = totalPorProducto.get(g.Producto);
    g.porcentajeDelProducto = totalProducto > 0 ? g.resumen.TotalLb / totalProducto : 0;
    g.esSecundaria = g.porcentajeDelProducto < UMBRAL_TALLA_SECUNDARIA_PORCENTAJE;
  }

  grupos.sort((a, b) => b.resumen.TotalLb - a.resumen.TotalLb);
  return grupos;
}

function FilaLote({ l, detalle, abierta, onToggle }) {
  const [widths, startResize] = useColWidths("reporte_lote_detalle", LOTE_DET_COL_DEFAULTS);
  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer hover:bg-gray-50 transition">
        <td className="px-3 py-2.5 text-gray-400">
          <span className={`inline-block transition-transform ${abierta ? "rotate-90" : ""}`}>▶</span>
        </td>
        <td className="px-3 py-2.5 font-mono font-bold text-gray-700 whitespace-nowrap">{l.Lote}</td>
        <td className="px-3 py-2.5 text-gray-700">{l.NombreFinca}</td>
        <td className="px-3 py-2.5 font-mono text-gray-600">{l.Clase} — {l.DescripcionClase}</td>
        <td className="px-3 py-2.5 text-center text-gray-600">{l.Fecha?.slice(0, 10)}</td>
        <td className="px-3 py-2.5 text-right font-semibold text-gray-800">{l.PesoIngreso.toFixed(2)} {l.UM}</td>
        <td className="px-3 py-2.5 text-right font-semibold text-blue-700">{l.Procesado.toFixed(2)}</td>
        <td className="px-3 py-2.5 text-right font-semibold text-amber-600">{l.Pendiente.toFixed(2)}</td>
        <td className="px-3 py-2.5 text-right">
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${l.Rendimiento >= 50 ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
            {l.Rendimiento.toFixed(1)}%
          </span>
        </td>
        <td className="px-3 py-2.5 text-center text-gray-500">{l.NumTransacciones}</td>
      </tr>
      {abierta && (
        <tr>
          <td colSpan={10} className="bg-gray-50 px-6 py-3">
            {detalle.length === 0 ? (
              <p className="text-sm text-gray-400">Sin transacciones para este lote</p>
            ) : (
              <table className="w-full text-xs table-fixed">
                <Colgroup columns={LOTE_DET_COLS} widths={widths} />
                <thead>
                  <tr className="text-gray-500 uppercase tracking-wider">
                    <Th width={widths.talla} onResizeStart={startResize("talla")} className="px-2 py-1 text-left">Talla</Th>
                    <Th width={widths.producto} onResizeStart={startResize("producto")} className="px-2 py-1 text-left">Producto Terminado</Th>
                    <Th width={widths.estado} onResizeStart={startResize("estado")} className="px-2 py-1 text-center">Estado</Th>
                    <Th width={widths.procesado} onResizeStart={startResize("procesado")} className="px-2 py-1 text-right">Procesado</Th>
                    <Th width={widths.pesajes} onResizeStart={startResize("pesajes")} className="px-2 py-1 text-right">Pesajes</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {detalle.map((d, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1.5 font-mono">{d.Talla} — {d.DescripcionTalla}</td>
                      <td className="px-2 py-1.5">{d.ClasePT} — {d.DescripcionClasePT}</td>
                      <td className="px-2 py-1.5 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${d.Estado === "Abierta" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                          {d.Estado}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right font-semibold">{d.Procesado.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right">{d.NumPesajes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function FilaTermo({ numeroTermo, cargas, abierta, onToggle }) {
  const [widths, startResize] = useColWidths("reporte_termo_detalle", TERMO_DET_COL_DEFAULTS);
  const subtotal = cargas.reduce((s, c) => s + c.Procesado, 0);
  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer hover:bg-blue-50 transition bg-gray-50 font-semibold">
        <td className="px-2 py-1.5 text-gray-400 w-6">
          <span className={`inline-block transition-transform ${abierta ? "rotate-90" : ""}`}>▶</span>
        </td>
        <td className="px-2 py-1.5 font-mono font-bold text-gray-800 whitespace-nowrap w-28">Termo {numeroTermo}</td>
        <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">
          {cargas.length} carga{cargas.length !== 1 ? "s" : ""}
        </td>
        <td className="px-2 py-1.5 text-right font-bold text-blue-700 whitespace-nowrap w-28">{subtotal.toFixed(2)}</td>
      </tr>
      {abierta && (
        <tr>
          <td colSpan={4} className="bg-gray-50 px-3 py-2">
            <table className="w-full text-xs table-fixed">
              <Colgroup columns={TERMO_DET_COLS} widths={widths} />
              <thead>
                <tr className="text-gray-500 uppercase tracking-wider">
                  <Th width={widths.lote} onResizeStart={startResize("lote")} className="px-2 py-1 text-left">Lote</Th>
                  <Th width={widths.talla} onResizeStart={startResize("talla")} className="px-2 py-1 text-left">Talla</Th>
                  <Th width={widths.proceso} onResizeStart={startResize("proceso")} className="px-2 py-1 text-left">Proceso</Th>
                  <Th width={widths.fecha} onResizeStart={startResize("fecha")} className="px-2 py-1 text-center">Fecha Proceso</Th>
                  <Th width={widths.kg} onResizeStart={startResize("kg")} className="px-2 py-1 text-right">Kg</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {cargas.map(c => (
                  <tr key={c.TermoId}>
                    <td className="px-2 py-1 font-mono">{c.Lote}</td>
                    <td className="px-2 py-1">{c.Talla} — {c.DescripcionTalla}</td>
                    <td className="px-2 py-1">{c.DescripcionProceso}</td>
                    <td className="px-2 py-1 text-center">{c.FechaProduccion?.slice(0, 10)}</td>
                    <td className="px-2 py-1 text-right font-semibold">{c.Procesado.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

function FilaProductoTalla({ g, abierta, onToggle }) {
  const [widths, startResize] = useColWidths("reporte_portalla_detalle", TALLA_DET_COL_DEFAULTS);
  return (
    <>
      <tr onClick={onToggle}
        className={`cursor-pointer hover:bg-blue-50 transition bg-gray-50 font-semibold ${g.esSecundaria ? "text-gray-400" : ""}`}>
        <td className="px-2 py-1.5 text-gray-400 w-6">
          <span className={`inline-block transition-transform ${abierta ? "rotate-90" : ""}`}>▶</span>
        </td>
        <td className="px-2 py-1.5 whitespace-nowrap">
          {g.Producto} — {g.Talla} ({g.DescripcionTalla})
          {g.esSecundaria && (
            <span title={`${(g.porcentajeDelProducto * 100).toFixed(1)}% de las libras de este Producto — menos del ${(UMBRAL_TALLA_SECUNDARIA_PORCENTAJE * 100).toFixed(0)}%`}
              className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-200 text-gray-500 normal-case">
              Bajo Volumen
            </span>
          )}
        </td>
        <td className="px-2 py-1.5 text-right whitespace-nowrap">{g.resumen.TotalLb.toFixed(2)}</td>
        <td className={`px-2 py-1.5 text-right whitespace-nowrap ${g.esSecundaria ? "" : "text-blue-700"}`}>
          {g.resumen.PromedioLbHora != null ? g.resumen.PromedioLbHora.toFixed(1) : "—"}
        </td>
        <td className="px-2 py-1.5 text-center whitespace-nowrap">{g.resumen.NumPersonas}</td>
      </tr>
      {abierta && (
        <tr>
          <td colSpan={5} className="bg-gray-50 px-3 py-2">
            <table className="w-full text-xs table-fixed">
              <Colgroup columns={TALLA_DET_COLS} widths={widths} />
              <thead>
                <tr className="text-gray-500 uppercase tracking-wider">
                  <Th width={widths.id} onResizeStart={startResize("id")} className="px-2 py-1 text-left">Id Empleado</Th>
                  <Th width={widths.nombre} onResizeStart={startResize("nombre")} className="px-2 py-1 text-left">Nombre</Th>
                  <Th width={widths.lb} onResizeStart={startResize("lb")} className="px-2 py-1 text-right">Lb</Th>
                  <Th width={widths.horas} onResizeStart={startResize("horas")} className="px-2 py-1 text-right">Horas</Th>
                  <Th width={widths.lbhora} onResizeStart={startResize("lbhora")} className="px-2 py-1 text-right">Lb/Hora</Th>
                  <Th width={widths.pesadas} onResizeStart={startResize("pesadas")} className="px-2 py-1 text-center"># Pesadas</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {g.filas.map(f => (
                  <tr key={f.IdEmpleado}>
                    <td className="px-2 py-1 font-mono">{f.IdEmpleado}</td>
                    <td className="px-2 py-1"><div className="max-w-[9rem] truncate" title={f.Nombre}>{f.Nombre}</div></td>
                    <td className="px-2 py-1 text-right font-semibold">{f.Lb.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right text-gray-500">{f.Horas.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right font-semibold text-blue-700">
                      <CeldaLbHora f={f} />
                    </td>
                    <td className="px-2 py-1 text-center text-gray-500">{f.NumPesadas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

export default function ReporteProduccionPage() {
  const [desde, setDesde] = useState(hoy());
  const [hasta, setHasta] = useState(hoy());
  const [fincas, setFincas] = useState([]);
  const [finca, setFinca] = useState("");
  const [areaLbHora, setAreaLbHora] = useState("");
  const [reporte, setReporte] = useState(null);
  const [loading, setLoading] = useState(false);
  const [subTab, setSubTab] = useState("general");
  const [loteAbierto, setLoteAbierto] = useState(null);
  const [termoAbierto, setTermoAbierto] = useState(null);
  const [tallaAbierta, setTallaAbierta] = useState(null);
  const [widthsPorLote, startResizePorLote] = useColWidths("reporte_por_lote", POR_LOTE_COL_DEFAULTS);
  const [widthsPorTallaGen, startResizePorTallaGen] = useColWidths("reporte_por_talla_general", POR_TALLA_GEN_COL_DEFAULTS);
  const [widthsTermos, startResizeTermos] = useColWidths("reporte_termos", TERMOS_COL_DEFAULTS);
  const [widthsEficiencias, startResizeEficiencias] = useColWidths("reporte_eficiencias", EFICIENCIAS_COL_DEFAULTS);
  const [widthsLbHora, startResizeLbHora] = useColWidths("reporte_lbhora", LBHORA_COL_DEFAULTS);
  const [widthsPortalla, startResizePortalla] = useColWidths("reporte_portalla", PORTALLA_COL_DEFAULTS);
  const [widthsLbPersona, startResizeLbPersona] = useColWidths("reporte_lbpersona", LBPERSONA_COL_DEFAULTS);

  useEffect(() => {
    fetch("/api/finca", { headers: authHeader() }).then(r => r.json())
      .then(d => { if (Array.isArray(d)) setFincas(d.filter(f => f.Activo)); });
  }, []);

  const buscar = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ desde, hasta, ...(finca ? { finca } : {}) });
      const res = await fetch(`/api/reportes/produccion?${params}`, { headers: authHeader() });
      const data = await res.json();
      if (res.ok) setReporte(data);
      else alert("Error: " + data.error);
    } catch (err) {
      console.error("Error al cargar el reporte:", err);
      alert("No se pudo conectar con el servidor.");
    } finally {
      setLoading(false);
    }
  }, [desde, hasta, finca]);

  useEffect(() => { buscar(); }, [buscar]);

  // Lote (texto) puede repetirse entre Clases del mismo Piscina+Ciclo+Fecha (ver
  // project_destajo_lote_clase_en_codigo) — hace falta también la Clase para no mezclar el detalle de
  // dos filas de Materia Prima distintas.
  const detalleDeLote = (lote, clase) => (reporte?.porLoteTalla ?? []).filter(d => d.Lote === lote && d.ClaseOrigen === clase);

  // Si hay un lote abierto (tocado en la tabla de la izquierda), la tabla de Talla se
  // filtra a solo lo procesado de ese lote; si no, muestra el total del rango de fechas.
  const tallasMostradas = (() => {
    if (!loteAbierto) return reporte?.porTalla ?? [];
    const mapa = new Map();
    for (const d of detalleDeLote(loteAbierto.Lote, loteAbierto.Clase)) {
      if (!mapa.has(d.Talla)) mapa.set(d.Talla, { Talla: d.Talla, DescripcionTalla: d.DescripcionTalla, Procesado: 0, NumPesajes: 0 });
      const acc = mapa.get(d.Talla);
      acc.Procesado += d.Procesado;
      acc.NumPesajes += d.NumPesajes;
    }
    return [...mapa.values()].sort((a, b) => b.Procesado - a.Procesado);
  })();
  const totalProcesadoTalla = tallasMostradas.reduce((s, t) => s + t.Procesado, 0);
  const totalProcesadoTermo = (reporte?.porTermo ?? []).reduce((s, t) => s + t.Procesado, 0);

  const areasLbHora = [...new Set((reporte?.porPersona ?? []).map(p => p.Area).filter(Boolean))].sort();
  // El filtro de Área se aplica ANTES de calcular los bloques (no después) para que, si un
  // Producto+Talla llegara a venir de dos áreas distintas, quede acotado a una sola al elegirla.
  const porPersonaLbHora = (reporte?.porPersona ?? []).filter(p => !areaLbHora || p.Area === areaLbHora);

  const filasLbHora = calcularLbHora(porPersonaLbHora, agruparPorArea).sort((a, b) => b.Lb - a.Lb);
  const filasPorTalla = calcularLbHora(porPersonaLbHora, agruparPorProductoTalla);
  const gruposPorTalla = gruposPorProductoTalla(filasPorTalla);
  const filasLbPersona = calcularLbPorPersona(reporte?.porPersona ?? []);

  const gruposPorFinca = () => {
    const mapa = new Map();
    for (const l of reporte?.porLote ?? []) {
      if (!mapa.has(l.NombreFinca)) mapa.set(l.NombreFinca, []);
      mapa.get(l.NombreFinca).push(l);
    }
    return [...mapa.entries()];
  };

  const sumar = (lotes) => lotes.reduce((acc, l) => ({
    PesoIngreso: acc.PesoIngreso + l.PesoIngreso,
    Procesado: acc.Procesado + l.Procesado,
    Pendiente: acc.Pendiente + l.Pendiente,
  }), { PesoIngreso: 0, Procesado: 0, Pendiente: 0 });

  const gruposPorTermo = () => {
    const mapa = new Map();
    for (const t of reporte?.porTermo ?? []) {
      if (!mapa.has(t.NumeroTermo)) mapa.set(t.NumeroTermo, []);
      mapa.get(t.NumeroTermo).push(t);
    }
    return [...mapa.entries()];
  };

  const exportar = () => {
    if (!reporte) return;
    if (subTab === "general") exportarReporteGeneral(reporte.porLote, reporte.porTalla, desde, hasta);
    else if (subTab === "termos") exportarReporteTermos(reporte.porTermo, desde, hasta);
    else if (subTab === "lbhora") exportarLbHora(filasLbHora, desde, hasta);
    else if (subTab === "portalla") exportarLbHoraPorTalla(filasPorTalla, desde, hasta);
    else if (subTab === "lbpersona") exportarLbPorPersona(filasLbPersona, desde, hasta);
    else exportarEficiencias(reporte.porPersona, desde, hasta);
  };

  return (
    <div>
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-2 mb-3 bg-white border border-gray-200 rounded-lg p-2.5 shadow-sm">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-0.5">Desde</label>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-0.5">Hasta</label>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        {!SUB_TABS_SIN_FINCA.includes(subTab) && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-0.5">Finca</label>
            <select value={finca} onChange={e => setFinca(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="">Todas</option>
              {fincas.map(f => <option key={f.Codigo} value={f.Codigo}>{f.Codigo} — {f.Descripcion}</option>)}
            </select>
          </div>
        )}
        {SUB_TABS_CON_AREA.includes(subTab) && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-0.5">Área</label>
            <select value={areaLbHora} onChange={e => setAreaLbHora(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="">Todas</option>
              {areasLbHora.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        )}
        <button onClick={buscar}
          className="bg-blue-600 text-white text-sm font-semibold px-3 py-1.5 rounded-lg hover:bg-blue-700 transition">
          Buscar
        </button>

        <div className="flex gap-1 bg-gray-200 rounded-lg p-1 ml-4">
          {SUB_TABS.map(t => (
            <button key={t.key} onClick={() => setSubTab(t.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition ${
                subTab === t.key
                  ? "bg-white shadow text-blue-700"
                  : t.estado === "progreso"
                    ? "text-amber-600 hover:text-amber-700"
                    : "text-gray-600 hover:text-gray-800"
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {reporte && (
          <button onClick={exportar}
            className="ml-auto bg-green-600 text-white text-sm font-semibold px-3 py-1.5 rounded-lg hover:bg-green-700 transition">
            Exportar Excel
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-7 h-7 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : !reporte ? null : (
        <>
          {/* Totales */}
          {!SUB_TABS_SIN_TOTALES.includes(subTab) && (
            <div className="grid grid-cols-4 gap-2 mb-3">
              <div className="bg-white rounded-lg shadow px-3 py-2 text-center">
                <p className="text-xs text-gray-400">Materia Prima Recibida</p>
                <p className="text-base font-bold text-gray-800">{reporte.totales.PesoIngreso.toFixed(2)} kg</p>
              </div>
              <div className="bg-white rounded-lg shadow px-3 py-2 text-center">
                <p className="text-xs text-gray-400">Procesado</p>
                <p className="text-base font-bold text-blue-700">{reporte.totales.Procesado.toFixed(2)} kg</p>
              </div>
              <div className="bg-white rounded-lg shadow px-3 py-2 text-center">
                <p className="text-xs text-gray-400">Pendiente</p>
                <p className="text-base font-bold text-amber-600">{reporte.totales.Pendiente.toFixed(2)} kg</p>
              </div>
              <div className="bg-white rounded-lg shadow px-3 py-2 text-center">
                <p className="text-xs text-gray-400">Rendimiento</p>
                <p className="text-base font-bold text-gray-700">{reporte.totales.Rendimiento.toFixed(1)}%</p>
              </div>
            </div>
          )}

          {/* ── Reporte General ── */}
          {subTab === "general" && (
            <div className="grid grid-cols-3 gap-5">
              {/* Por Lote */}
              <div className="col-span-2 min-w-0">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Materia Prima y Procesado por Lote</h3>
                <div className="bg-white rounded-xl shadow overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm table-fixed">
                    <Colgroup columns={POR_LOTE_COLS} widths={widthsPorLote} />
                    <thead>
                      <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                        <Th width={widthsPorLote.expand} onResizeStart={startResizePorLote("expand")} className="px-3 py-3"></Th>
                        <Th width={widthsPorLote.lote} onResizeStart={startResizePorLote("lote")} className="px-3 py-3 text-left">Lote</Th>
                        <Th width={widthsPorLote.finca} onResizeStart={startResizePorLote("finca")} className="px-3 py-3 text-left">Finca</Th>
                        <Th width={widthsPorLote.clase} onResizeStart={startResizePorLote("clase")} className="px-3 py-3 text-left">Clase MP</Th>
                        <Th width={widthsPorLote.fecha} onResizeStart={startResizePorLote("fecha")} className="px-3 py-3 text-center">Fecha</Th>
                        <Th width={widthsPorLote.ingreso} onResizeStart={startResizePorLote("ingreso")} className="px-3 py-3 text-right">Ingreso</Th>
                        <Th width={widthsPorLote.procesado} onResizeStart={startResizePorLote("procesado")} className="px-3 py-3 text-right">Procesado</Th>
                        <Th width={widthsPorLote.pendiente} onResizeStart={startResizePorLote("pendiente")} className="px-3 py-3 text-right">Pendiente</Th>
                        <Th width={widthsPorLote.rend} onResizeStart={startResizePorLote("rend")} className="px-3 py-3 text-right">Rend.</Th>
                        <Th width={widthsPorLote.transac} onResizeStart={startResizePorLote("transac")} className="px-3 py-3 text-center">Transac.</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {gruposPorFinca().map(([nombreFinca, lotes]) => {
                        const sub = sumar(lotes);
                        const rendSub = sub.PesoIngreso > 0 ? (sub.Procesado / sub.PesoIngreso * 100) : 0;
                        return (
                          <Fragment key={nombreFinca}>
                            {lotes.map(l => (
                              <FilaLote key={`${l.Lote}-${l.Clase}`} l={l} detalle={detalleDeLote(l.Lote, l.Clase)}
                                abierta={loteAbierto?.Lote === l.Lote && loteAbierto?.Clase === l.Clase}
                                onToggle={() => setLoteAbierto(loteAbierto?.Lote === l.Lote && loteAbierto?.Clase === l.Clase ? null : { Lote: l.Lote, Clase: l.Clase })} />
                            ))}
                            <tr className="bg-gray-50 font-semibold">
                              <td className="px-3 py-2" colSpan={5}>Subtotal — {nombreFinca}</td>
                              <td className="px-3 py-2 text-right text-gray-800">{sub.PesoIngreso.toFixed(2)}</td>
                              <td className="px-3 py-2 text-right text-blue-700">{sub.Procesado.toFixed(2)}</td>
                              <td className="px-3 py-2 text-right text-amber-600">{sub.Pendiente.toFixed(2)}</td>
                              <td className="px-3 py-2 text-right text-gray-600">{rendSub.toFixed(1)}%</td>
                              <td className="px-3 py-2"></td>
                            </tr>
                          </Fragment>
                        );
                      })}
                      {reporte.porLote.length === 0 && (
                        <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">Sin lotes en este rango de fechas</td></tr>
                      )}
                    </tbody>
                    {reporte.porLote.length > 0 && (
                      <tfoot>
                        <tr className="bg-gray-200 font-bold border-t-2 border-gray-300">
                          <td className="px-3 py-2.5" colSpan={5}>Total General</td>
                          <td className="px-3 py-2.5 text-right text-gray-900">{reporte.totales.PesoIngreso.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right text-blue-800">{reporte.totales.Procesado.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right text-amber-700">{reporte.totales.Pendiente.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right text-gray-800">{reporte.totales.Rendimiento.toFixed(1)}%</td>
                          <td className="px-3 py-2.5"></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>

              {/* Por Talla */}
              <div className="min-w-0">
                <div className="flex items-center justify-between mb-2 gap-2">
                  <h3 className="text-sm font-semibold text-gray-700">Procesado por Talla</h3>
                  {loteAbierto && (
                    <button onClick={() => setLoteAbierto(null)}
                      className="flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-full transition">
                      <span className="font-mono">{loteAbierto.Lote} — {loteAbierto.Clase}</span>
                      <span className="text-blue-400">&times;</span>
                    </button>
                  )}
                </div>
                <div className="bg-white rounded-xl shadow overflow-hidden">
                  <table className="w-full text-sm table-fixed">
                    <Colgroup columns={POR_TALLA_GEN_COLS} widths={widthsPorTallaGen} />
                    <thead>
                      <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                        <Th width={widthsPorTallaGen.talla} onResizeStart={startResizePorTallaGen("talla")} className="px-3 py-3 text-left">Talla</Th>
                        <Th width={widthsPorTallaGen.kg} onResizeStart={startResizePorTallaGen("kg")} className="px-3 py-3 text-right">Kg</Th>
                        <Th width={widthsPorTallaGen.pct} onResizeStart={startResizePorTallaGen("pct")} className="px-3 py-3 text-right">%</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {tallasMostradas.map(t => (
                        <tr key={t.Talla} className="hover:bg-gray-50 transition">
                          <td className="px-3 py-2.5 text-gray-700">
                            <span className="font-mono">{t.Talla}</span> — {t.DescripcionTalla}
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold text-blue-700">{t.Procesado.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right text-gray-500">
                            {totalProcesadoTalla > 0 ? (t.Procesado / totalProcesadoTalla * 100).toFixed(1) : "0.0"}%
                          </td>
                        </tr>
                      ))}
                      {tallasMostradas.length === 0 && (
                        <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400">Sin datos</td></tr>
                      )}
                    </tbody>
                    {tallasMostradas.length > 0 && (
                      <tfoot>
                        <tr className="bg-gray-200 font-bold border-t-2 border-gray-300">
                          <td className="px-3 py-2.5">Total General</td>
                          <td className="px-3 py-2.5 text-right text-blue-800">{totalProcesadoTalla.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right text-gray-800">100.0%</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── Reporte Termos ── */}
          {subTab === "termos" && (
            <div>
              <h3 className="text-xs font-semibold text-gray-700 mb-1.5">Procesado por Termo</h3>
              <div className="bg-white rounded-lg shadow overflow-hidden overflow-x-auto">
                <table className="w-full text-xs table-fixed">
                  <Colgroup columns={TERMOS_COLS} widths={widthsTermos} />
                  <thead>
                    <tr className="bg-gray-100 text-gray-600 uppercase text-[10px] tracking-wider">
                      <Th width={widthsTermos.expand} onResizeStart={startResizeTermos("expand")} className="px-2 py-1.5"></Th>
                      <Th width={widthsTermos.termo} onResizeStart={startResizeTermos("termo")} className="px-2 py-1.5 text-left whitespace-nowrap">Termo</Th>
                      <Th width={widthsTermos.detalle} onResizeStart={startResizeTermos("detalle")} className="px-2 py-1.5 text-left whitespace-nowrap">Detalle</Th>
                      <Th width={widthsTermos.kg} onResizeStart={startResizeTermos("kg")} className="px-2 py-1.5 text-right whitespace-nowrap">Kg Procesados</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {gruposPorTermo().map(([numeroTermo, cargas]) => (
                      <FilaTermo key={numeroTermo} numeroTermo={numeroTermo} cargas={cargas}
                        abierta={termoAbierto === numeroTermo}
                        onToggle={() => setTermoAbierto(termoAbierto === numeroTermo ? null : numeroTermo)} />
                    ))}
                    {(reporte.porTermo ?? []).length === 0 && (
                      <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-400">Sin datos en este rango de fechas</td></tr>
                    )}
                  </tbody>
                  {(reporte.porTermo ?? []).length > 0 && (
                    <tfoot>
                      <tr className="bg-gray-200 font-bold border-t-2 border-gray-300">
                        <td className="px-2 py-1.5" colSpan={3}>Total General</td>
                        <td className="px-2 py-1.5 text-right text-blue-800">{totalProcesadoTermo.toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          {/* ── Eficiencias ── */}
          {subTab === "eficiencias" && (
            <div>
              <h3 className="text-xs font-semibold text-gray-700 mb-1.5">Pesajes por Persona</h3>
              <div className="bg-white rounded-lg shadow overflow-hidden overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-xs table-fixed">
                  <Colgroup columns={EFICIENCIAS_COLS} widths={widthsEficiencias} />
                  <thead>
                    <tr className="bg-gray-100 text-gray-600 uppercase text-[10px] tracking-wider">
                      <Th width={widthsEficiencias.id} onResizeStart={startResizeEficiencias("id")} className="px-2 py-1.5 text-left whitespace-nowrap">Id Empleado</Th>
                      <Th width={widthsEficiencias.nombre} onResizeStart={startResizeEficiencias("nombre")} className="px-2 py-1.5 text-left">Nombre</Th>
                      <Th width={widthsEficiencias.area} onResizeStart={startResizeEficiencias("area")} className="px-2 py-1.5 text-left whitespace-nowrap">Área</Th>
                      <Th width={widthsEficiencias.fecha} onResizeStart={startResizeEficiencias("fecha")} className="px-2 py-1.5 text-center whitespace-nowrap">Fecha</Th>
                      <Th width={widthsEficiencias.hora} onResizeStart={startResizeEficiencias("hora")} className="px-2 py-1.5 text-center whitespace-nowrap">Hora</Th>
                      <Th width={widthsEficiencias.lote} onResizeStart={startResizeEficiencias("lote")} className="px-2 py-1.5 text-left whitespace-nowrap">Lote</Th>
                      <Th width={widthsEficiencias.producto} onResizeStart={startResizeEficiencias("producto")} className="px-2 py-1.5 text-left whitespace-nowrap">Producto</Th>
                      <Th width={widthsEficiencias.talla} onResizeStart={startResizeEficiencias("talla")} className="px-2 py-1.5 text-left whitespace-nowrap">Talla</Th>
                      <Th width={widthsEficiencias.kilos} onResizeStart={startResizeEficiencias("kilos")} className="px-2 py-1.5 text-right whitespace-nowrap">Kilos</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(reporte.porPersona ?? []).map((p, i) => (
                      <tr key={i} className="hover:bg-gray-50 transition">
                        <td className="px-2 py-1.5 font-mono text-gray-700 whitespace-nowrap">{p.IdEmpleado}</td>
                        <td className="px-2 py-1.5 text-gray-700"><div className="max-w-[9rem] truncate" title={p.Nombre}>{p.Nombre}</div></td>
                        <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">{p.Area || <span className="text-gray-300">—</span>}</td>
                        <td className="px-2 py-1.5 text-center text-gray-600 whitespace-nowrap">{p.FechaHora?.slice(0, 10)}</td>
                        <td className="px-2 py-1.5 text-center text-gray-600 whitespace-nowrap">{p.FechaHora?.slice(11, 16)}</td>
                        <td className="px-2 py-1.5 font-mono text-gray-700 whitespace-nowrap">{p.Lote}</td>
                        <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">{p.Producto}</td>
                        <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">{p.Talla} — {p.DescripcionTalla}</td>
                        <td className="px-2 py-1.5 text-right font-semibold text-blue-700 whitespace-nowrap">{p.Kilos.toFixed(2)}</td>
                      </tr>
                    ))}
                    {(reporte.porPersona ?? []).length === 0 && (
                      <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">Sin datos en este rango de fechas</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Lb/Hora ── */}
          {subTab === "lbhora" && (
            <div>
              <h3 className="text-xs font-semibold text-gray-700 mb-1">Rendimiento por Persona y Área</h3>
              <p className="text-xs text-gray-400 mb-2">
                Horas: el primer bloque del día va desde que la persona entra al área hasta su primera pesada (se descarta si dura menos de {MINIMO_BLOQUE_MINUTOS} min, dato poco confiable); los siguientes son pesada a pesada, sin límite de duración. Con una sola pesada válida la tasa queda indefinida.
                {" "}<span className="text-amber-600">●</span> = menos de {CONFIANZA_MIN_PESADAS} pesadas o menos de {CONFIANZA_MIN_HORAS} h válidas — dato real, pero de baja confianza.
              </p>
              <div className="bg-white rounded-lg shadow overflow-hidden overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-xs table-fixed">
                  <Colgroup columns={LBHORA_COLS} widths={widthsLbHora} />
                  <thead>
                    <tr className="bg-gray-100 text-gray-600 uppercase text-[10px] tracking-wider">
                      <Th width={widthsLbHora.id} onResizeStart={startResizeLbHora("id")} className="px-2 py-1.5 text-left whitespace-nowrap">Id Empleado</Th>
                      <Th width={widthsLbHora.nombre} onResizeStart={startResizeLbHora("nombre")} className="px-2 py-1.5 text-left">Nombre</Th>
                      <Th width={widthsLbHora.area} onResizeStart={startResizeLbHora("area")} className="px-2 py-1.5 text-left whitespace-nowrap">Área</Th>
                      <Th width={widthsLbHora.lb} onResizeStart={startResizeLbHora("lb")} className="px-2 py-1.5 text-right whitespace-nowrap">Lb</Th>
                      <Th width={widthsLbHora.horas} onResizeStart={startResizeLbHora("horas")} className="px-2 py-1.5 text-right whitespace-nowrap">Horas</Th>
                      <Th width={widthsLbHora.lbhora} onResizeStart={startResizeLbHora("lbhora")} className="px-2 py-1.5 text-right whitespace-nowrap">Lb/Hora</Th>
                      <Th width={widthsLbHora.pesadas} onResizeStart={startResizeLbHora("pesadas")} className="px-2 py-1.5 text-center whitespace-nowrap"># Pesadas</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filasLbHora.map(f => (
                      <tr key={`${f.IdEmpleado}-${f.Area}`} className="hover:bg-gray-50 transition">
                        <td className="px-2 py-1.5 font-mono text-gray-700 whitespace-nowrap">{f.IdEmpleado}</td>
                        <td className="px-2 py-1.5 text-gray-700"><div className="max-w-[9rem] truncate" title={f.Nombre}>{f.Nombre}</div></td>
                        <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">{f.Area || <span className="text-gray-300">—</span>}</td>
                        <td className="px-2 py-1.5 text-right text-gray-700 whitespace-nowrap">{f.Lb.toFixed(2)}</td>
                        <td className="px-2 py-1.5 text-right text-gray-500 whitespace-nowrap">{f.Horas.toFixed(2)}</td>
                        <td className="px-2 py-1.5 text-right font-semibold text-blue-700 whitespace-nowrap">
                          <CeldaLbHora f={f} />
                        </td>
                        <td className="px-2 py-1.5 text-center text-gray-500 whitespace-nowrap">{f.NumPesadas}</td>
                      </tr>
                    ))}
                    {filasLbHora.length === 0 && (
                      <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">Sin datos en este rango de fechas</td></tr>
                    )}
                  </tbody>
                  {filasLbHora.length > 0 && (() => {
                    const total = totalLbHora(filasLbHora);
                    return (
                      <tfoot>
                        <tr className="bg-gray-200 font-bold border-t-2 border-gray-300">
                          <td className="px-2 py-1.5" colSpan={3}>Total General</td>
                          <td className="px-2 py-1.5 text-right text-gray-900">{total.TotalLb.toFixed(2)}</td>
                          <td className="px-2 py-1.5"></td>
                          <td className="px-2 py-1.5 text-right text-blue-800">
                            {total.PromedioLbHora != null ? total.PromedioLbHora.toFixed(1) : "—"}
                          </td>
                          <td className="px-2 py-1.5"></td>
                        </tr>
                      </tfoot>
                    );
                  })()}
                </table>
              </div>
            </div>
          )}

          {/* ── Por Talla ── */}
          {subTab === "portalla" && (
            <div>
              <h3 className="text-xs font-semibold text-gray-700 mb-1">Rendimiento por Producto y Talla</h3>
              <p className="text-xs text-gray-400 mb-2">
                Mismo cálculo de Horas que en Lb/Hora, agrupado por Producto+Talla en vez de por Área. Toca una fila para ver el detalle por persona.
                {" "}El "Lb/Hora Prom." de cada tarea (promedio ponderado de todo el equipo) es el número confiable; el detalle por persona es diagnóstico —
                {" "}<span className="text-amber-600">●</span> marca ahí un dato de menos de {CONFIANZA_MIN_PESADAS} pesadas o {CONFIANZA_MIN_HORAS} h válidas.
                {" "}"Bajo Volumen" marca una talla que junto con su Producto no llega al {(UMBRAL_TALLA_SECUNDARIA_PORCENTAJE * 100).toFixed(0)}% de las libras de ese mismo Producto — producción incidental de la clasificación, no la talla objetivo.
              </p>
              <div className="bg-white rounded-lg shadow overflow-hidden overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-xs table-fixed">
                  <Colgroup columns={PORTALLA_COLS} widths={widthsPortalla} />
                  <thead>
                    <tr className="bg-gray-100 text-gray-600 uppercase text-[10px] tracking-wider">
                      <Th width={widthsPortalla.expand} onResizeStart={startResizePortalla("expand")} className="px-2 py-1.5"></Th>
                      <Th width={widthsPortalla.productoTalla} onResizeStart={startResizePortalla("productoTalla")} className="px-2 py-1.5 text-left whitespace-nowrap">Producto — Talla</Th>
                      <Th width={widthsPortalla.lbTotal} onResizeStart={startResizePortalla("lbTotal")} className="px-2 py-1.5 text-right whitespace-nowrap">Lb Total</Th>
                      <Th width={widthsPortalla.lbHoraProm} onResizeStart={startResizePortalla("lbHoraProm")} className="px-2 py-1.5 text-right whitespace-nowrap">Lb/Hora Prom.</Th>
                      <Th width={widthsPortalla.numPersonas} onResizeStart={startResizePortalla("numPersonas")} className="px-2 py-1.5 text-center whitespace-nowrap"># Personas</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {gruposPorTalla.map(g => {
                      const key = `${g.Producto}-${g.Talla}`;
                      return (
                        <FilaProductoTalla key={key} g={g}
                          abierta={tallaAbierta === key}
                          onToggle={() => setTallaAbierta(tallaAbierta === key ? null : key)} />
                      );
                    })}
                    {gruposPorTalla.length === 0 && (
                      <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">Sin datos en este rango de fechas</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Lb/Persona ── */}
          {subTab === "lbpersona" && (
            <div>
              <h3 className="text-xs font-semibold text-gray-700 mb-1">Libras por Persona — Descabezado y Pelado y Devenado</h3>
              <p className="text-xs text-gray-400 mb-2">
                Libras acumuladas por persona en cada área (sin tasa ni horas), ordenado de mayor a menor por el total de ambas.
                {" "}Semáforo por tercios de posición en el ranking: <span className="px-1.5 py-0.5 rounded bg-green-50 border border-green-200">verde</span> = tercio superior,
                {" "}<span className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200">amarillo</span> = tercio medio,
                {" "}<span className="px-1.5 py-0.5 rounded bg-red-50 border border-red-200">rojo</span> = tercio inferior — no un monto fijo de libras, para no tener que ajustarlo cada día según el volumen.
              </p>
              <div className="bg-white rounded-lg shadow overflow-hidden overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-xs table-fixed">
                  <Colgroup columns={LBPERSONA_COLS} widths={widthsLbPersona} />
                  <thead>
                    <tr className="bg-gray-100 text-gray-600 uppercase text-[10px] tracking-wider">
                      <Th width={widthsLbPersona.puesto} onResizeStart={startResizeLbPersona("puesto")} className="px-2 py-1.5 text-center whitespace-nowrap">Puesto</Th>
                      <Th width={widthsLbPersona.id} onResizeStart={startResizeLbPersona("id")} className="px-2 py-1.5 text-left whitespace-nowrap">Id Empleado</Th>
                      <Th width={widthsLbPersona.nombre} onResizeStart={startResizeLbPersona("nombre")} className="px-2 py-1.5 text-left">Nombre</Th>
                      <Th width={widthsLbPersona.descabezado} onResizeStart={startResizeLbPersona("descabezado")} className="px-2 py-1.5 text-right whitespace-nowrap">Descabezado (Lb)</Th>
                      <Th width={widthsLbPersona.pelado} onResizeStart={startResizeLbPersona("pelado")} className="px-2 py-1.5 text-right whitespace-nowrap">Pelado y Devenado (Lb)</Th>
                      <Th width={widthsLbPersona.total} onResizeStart={startResizeLbPersona("total")} className="px-2 py-1.5 text-right whitespace-nowrap">Total (Lb)</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filasLbPersona.map(f => (
                      <tr key={f.IdEmpleado} className={`${FILA_SEMAFORO[f.Semaforo]} hover:brightness-95 transition`}>
                        <td className="px-2 py-1.5 text-center text-gray-500 whitespace-nowrap">{f.Puesto}</td>
                        <td className="px-2 py-1.5 font-mono text-gray-700 whitespace-nowrap">{f.IdEmpleado}</td>
                        <td className="px-2 py-1.5 text-gray-700"><div className="max-w-[9rem] truncate" title={f.Nombre}>{f.Nombre}</div></td>
                        <td className="px-2 py-1.5 text-right text-gray-700 whitespace-nowrap">{f.LbDescabezado > 0 ? f.LbDescabezado.toFixed(2) : <span className="text-gray-300">—</span>}</td>
                        <td className="px-2 py-1.5 text-right text-gray-700 whitespace-nowrap">{f.LbPelado > 0 ? f.LbPelado.toFixed(2) : <span className="text-gray-300">—</span>}</td>
                        <td className="px-2 py-1.5 text-right font-semibold text-blue-700 whitespace-nowrap">{f.LbTotal.toFixed(2)}</td>
                      </tr>
                    ))}
                    {filasLbPersona.length === 0 && (
                      <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">Sin datos en este rango de fechas</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
