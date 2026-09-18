import { useState, useEffect, useCallback, Fragment } from "react";
import { createPortal } from "react-dom";
import { authHeader, useAuth, usePuede } from "../context/AuthContext.jsx";
import { exportarReporteGeneral, exportarReporteTermos, exportarHojaLote, exportarEficiencias, exportarLbHora, exportarLbHoraPorTalla, exportarLbPorPersona } from "../utils/exportExcel.js";
import { useColWidths, useOrden, ordenarFilas, FiltroColumna, Th, Colgroup } from "../components/ResizableTh.jsx";
import { fmtNum } from "../utils/numero.js";
import {
  LB_POR_KG, MINIMO_BLOQUE_MINUTOS, AREAS_DESTAJO, calcularLbHora, agruparPorArea, agruparPorProductoTalla,
  totalLbHora, resumenValidez,
} from "../utils/destajo.js";

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
const LBHORA_COL_DEFAULTS = { id: 100, nombre: 150, area: 110, fecha: 130, clase: 160, talla: 190, lb: 90, horas: 90, lbhora: 90, pesadas: 90 };
const LBHORA_COLS = Object.keys(LBHORA_COL_DEFAULTS);
const PORTALLA_COL_DEFAULTS = { expand: 24, productoTalla: 220, lbTotal: 100, lbHoraProm: 110, numPersonas: 100 };
const PORTALLA_COLS = Object.keys(PORTALLA_COL_DEFAULTS);
// Anchos pensados para que quepa el título completo de cada columna sin encimarse ("Pelado y
// Devenado (Lb)" es el más largo) y para que en Nombre se lea al menos hasta el primer apellido.
const LBPERSONA_COL_DEFAULTS = { puesto: 80, id: 120, nombre: 240, descabezado: 150, pelado: 190, pinchado: 190, reprocesoDescolado: 200, reprocesoCorte: 180, total: 110 };
const LBPERSONA_COLS = Object.keys(LBPERSONA_COL_DEFAULTS);
// Llave de columna (ancho ajustable) que le toca a cada área de destajo, en el mismo orden en que
// AREAS_DESTAJO las lista — la tabla se arma recorriendo AREAS_DESTAJO, no columna por columna.
const LBPERSONA_AREA_COL = { DU: "descabezado", DS: "pelado", DT: "pinchado", RD: "reprocesoDescolado", RC: "reprocesoCorte" };

function hoy() { return new Date().toLocaleDateString("sv-SE"); }
const fechaCorta = (f) => f ? f.split("-").reverse().join("/") : "";

// Debe coincidir con MAX_NOTAS en backend/src/routes/lotes.ts, que es quien rechaza de verdad.
// El límite es de espacio: más que esto no cabe en el recuadro de la hoja impresa.
const MAX_NOTAS = 500;

const SUB_TABS = [
  { key: "general",     label: "Reporte General" },
  { key: "termos",      label: "Reporte Termos" },
  { key: "hojalote",    label: "Reporte x Lote" },
  { key: "eficiencias", label: "Eficiencias" },
  { key: "lbhora",      label: "Lb/Hora" },
  { key: "portalla",    label: "Por Talla" },
  { key: "lbpersona",   label: "Lb/Persona" },
];

// Eficiencias, Lb/Hora, Por Talla y Lb/Persona son vistas por persona, no por lote de Materia Prima —
// no tiene sentido mostrarles el resumen de Ingreso/Procesado/Pendiente/Rendimiento. Hoja de Lote
// tampoco: ya trae su propia comparación Ingreso vs. Pelado dentro de la hoja.
const SUB_TABS_SIN_TOTALES = ["eficiencias", "lbhora", "portalla", "lbpersona", "hojalote"];
// Ninguna de estas cuatro usa Finca (son vistas por persona, no por lote/origen). Eficiencias
// estaba fuera de la lista por descuido: mostraba el selector aunque la vista es por persona.
const SUB_TABS_SIN_FINCA = ["eficiencias", "lbhora", "portalla", "lbpersona"];
// Solo Lb/Hora y Por Talla filtran por Área — Lb/Persona siempre muestra Descabezado y
// Pelado y Devenado lado a lado, así que un filtro de Área no tendría sentido ahí.
const SUB_TABS_CON_AREA = ["lbhora", "portalla"];

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
      <span title={`Dato de baja confianza: ${f.NumPesadas} pesada${f.NumPesadas !== 1 ? "s" : ""}, ${fmtNum(f.Horas)} h válidas`}
        className="text-amber-600">
        {fmtNum(f.LbPorHora, 1)} <span className="text-[10px] align-top">●</span>
      </span>
    );
  }
  return <>{fmtNum(f.LbPorHora, 1)}</>;
}

// Cuadre contra el Procesado del Reporte General. Lb/Hora y Por Talla suman libra VÁLIDA (peso con
// tiempo medible), así que su Total General siempre queda por debajo del Procesado — sin este aviso
// la diferencia parecía producción perdida y obligaba a rehacer la resta a mano. Se nombra a la gente
// afectada porque la causa casi siempre es marcaje: la Transferencia de área quedó abierta de un día
// anterior, así que su primera pesada del día no tiene ancla y se descarta entera.
function AvisoLbSinTiempo({ resumen }) {
  const [abierto, setAbierto] = useState(false);
  if (resumen.PesadasSinTiempo === 0) return null;
  const pct = resumen.LbProcesadas > 0 ? (resumen.LbSinTiempo / resumen.LbProcesadas) * 100 : 0;
  return (
    <div className="mt-2 text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
      <div className="flex items-start gap-2">
        <span className="text-amber-600 mt-px">▲</span>
        <div className="flex-1 min-w-0">
          <p className="text-amber-900">
            El Total General de arriba es <strong>libra válida</strong>: {fmtNum(resumen.LbSinTiempo)} lb
            {" "}({pct.toFixed(1)}% de las {fmtNum(resumen.LbProcesadas)} lb procesadas) quedaron fuera porque
            {" "}{resumen.PesadasSinTiempo === 1 ? "una pesada no tiene" : `${resumen.PesadasSinTiempo} pesadas no tienen`} tiempo medible.
            {" "}Por eso este total no cuadra con el Procesado del Reporte General.
          </p>
          <button onClick={() => setAbierto(!abierto)} className="mt-1 text-amber-700 underline hover:text-amber-900">
            {abierto ? "Ocultar" : `Ver ${resumen.Personas.length} persona${resumen.Personas.length !== 1 ? "s" : ""} a revisar`}
          </button>
          {abierto && (
            <>
              <p className="mt-1.5 text-amber-800">
                Casi siempre es marcaje: su entrada al área quedó abierta desde un día anterior (olvidó marcar salida
                y no volvió a darse transferencia al área), así que su primera pesada del día no tiene desde cuándo
                contar. El tiempo se cuenta desde que entra a Pelado o Descabezado, no desde su entrada general —
                esa es solo asistencia. Corrigiendo la transferencia del área, esa producción vuelve a contar.
              </p>
              <ul className="mt-1 grid grid-cols-2 md:grid-cols-3 gap-x-4 text-amber-900">
                {resumen.Personas.map(p => (
                  <li key={p.IdEmpleado} className="truncate" title={p.Nombre}>
                    <span className="font-mono">{p.IdEmpleado}</span> {p.Nombre}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Solo libras acumuladas por persona en las áreas de destajo (ver AREAS_DESTAJO), sin hora ni tasa —
// no usa calcularLbHora porque no necesita el cálculo de bloques/tiempo, solo sumar Kilos por Área.
// Un pesaje con Área fuera de esa lista (o sin Área resuelta, ver project_destajo_area_familia_validacion
// y el caso Susan Valeska/TUNEL) no entra en ninguna columna ni en el Total — es un caso raro y esta
// vista solo tiene columna para las áreas de destajo.
function calcularLbPorPersona(porPersona) {
  const porEmpleado = new Map();
  for (const p of porPersona) {
    if (!porEmpleado.has(p.IdEmpleado)) {
      porEmpleado.set(p.IdEmpleado, {
        IdEmpleado: p.IdEmpleado, Nombre: p.Nombre,
        ...Object.fromEntries(AREAS_DESTAJO.map(a => [a.lb, 0])),
      });
    }
    const acc = porEmpleado.get(p.IdEmpleado);
    const area = AREAS_DESTAJO.find(a => a.nombre === p.Area);
    if (area) acc[area.lb] += p.Kilos * LB_POR_KG;
  }
  const filas = [...porEmpleado.values()]
    .map(f => ({ ...f, LbTotal: AREAS_DESTAJO.reduce((s, a) => s + f[a.lb], 0) }))
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
        <td className="px-3 py-2.5 text-right font-semibold text-gray-800">{fmtNum(l.PesoIngreso)} {l.UM}</td>
        <td className="px-3 py-2.5 text-right font-semibold text-blue-700">{fmtNum(l.Procesado)}</td>
        <td className="px-3 py-2.5 text-right font-semibold text-amber-600">{fmtNum(l.Pendiente)}</td>
        <td className="px-3 py-2.5 text-right">
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${l.Rendimiento >= 50 ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
            {fmtNum(l.Rendimiento, 1)}%
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
                      <td className="px-2 py-1.5 text-right font-semibold">{fmtNum(d.Procesado)}</td>
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
        <td className="px-2 py-1.5 text-right font-bold text-blue-700 whitespace-nowrap w-28">{fmtNum(subtotal)}</td>
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
                    <td className="px-2 py-1 text-right font-semibold">{fmtNum(c.Procesado)}</td>
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
        <td className="px-2 py-1.5 text-right whitespace-nowrap">{fmtNum(g.resumen.TotalLb)}</td>
        <td className={`px-2 py-1.5 text-right whitespace-nowrap ${g.esSecundaria ? "" : "text-blue-700"}`}>
          {g.resumen.PromedioLbHora != null ? fmtNum(g.resumen.PromedioLbHora, 1) : "—"}
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
                    <td className="px-2 py-1 text-right font-semibold">{fmtNum(f.Lb)}</td>
                    <td className="px-2 py-1 text-right text-gray-500">{fmtNum(f.Horas)}</td>
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
  const { user } = useAuth();
  // El backend es quien bloquea de verdad; esto solo evita que alguien sin permiso escriba una nota
  // para descubrir al salir del campo que no se guardó.
  const puedeEditarNotas = usePuede("destajo", "editar");
  const [desde, setDesde] = useState(hoy());
  const [hasta, setHasta] = useState(hoy());
  const [finca, setFinca] = useState("");
  // Valor = `${Lote}|${Clase}` (compuesto: ver project_destajo_lote_clase_en_codigo) — el mismo
  // texto de Lote puede repetirse entre Clases del mismo Piscina+Ciclo+Fecha.
  const [loteFiltro, setLoteFiltro] = useState("");
  const [areaLbHora, setAreaLbHora] = useState("");
  const [notasHoja, setNotasHoja] = useState("");
  const [guardandoNotas, setGuardandoNotas] = useState(false);
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
  const [ordenEfic, alternarOrdenEfic] = useOrden();
  const [ordenTallaGen, alternarOrdenTallaGen] = useOrden();
  const [ordenLbHora, alternarOrdenLbHora] = useOrden();
  const [ordenPortalla, alternarOrdenPortalla] = useOrden();
  const [ordenLbPersona, alternarOrdenLbPersona] = useOrden();
  const [personaEfic, setPersonaEfic] = useState("");
  const [widthsLbHora, startResizeLbHora] = useColWidths("reporte_lbhora", LBHORA_COL_DEFAULTS);
  const [widthsPortalla, startResizePortalla] = useColWidths("reporte_portalla", PORTALLA_COL_DEFAULTS);
  // _v2 en la llave: los anchos guardados en localStorage se mezclan sobre los defaults, así que
  // sin cambiar la llave quien ya tenía la tabla abierta seguiría con los anchos viejos (angostos).
  const [widthsLbPersona, startResizeLbPersona] = useColWidths("reporte_lbpersona_v2", LBPERSONA_COL_DEFAULTS);
  // Lb/Persona tiene pocas columnas y angostas: a pantalla completa la tabla quedaba estirada de
  // borde a borde con huecos enormes. Se limita el bloque a la suma real de los anchos (que el
  // usuario puede cambiar arrastrando) y se centra; si la pantalla es más angosta, encoge sola.
  // +16 px por la barra de scroll vertical de la lista, para que no le robe ancho a las columnas.

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

  // Lotes "en proceso" para el filtro de Lote: el mismo rango/Finca que ya se trajo, sin volver a
  // pedirle nada al backend — se filtra en el cliente sobre reporte.porLote (Pendiente > 0 = todavía
  // le falta procesar algo, es un lote que se está trabajando ahora mismo, no uno ya cerrado).
  const lotesEnProceso = (reporte?.porLote ?? []).filter(l => l.Pendiente > 0.01);
  // Hoja de Lote es distinta: casi siempre se imprime cuando el lote YA terminó (Pendiente en 0), así
  // que ahí el selector no se recorta a "en proceso" — se ofrecen todos los lotes del rango/Finca.
  const lotesSelector = subTab === "hojalote" ? (reporte?.porLote ?? []) : lotesEnProceso;
  // Si el rango/Finca/pestaña cambia y el Lote elegido ya no aparece en la lista que le toca a esta
  // pestaña, se limpia el filtro en vez de dejarlo apuntando a un Lote que ya no aparece.
  useEffect(() => {
    if (loteFiltro && !lotesSelector.some(l => `${l.Lote}|${l.Clase}` === loteFiltro)) setLoteFiltro("");
  }, [reporte, subTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Solo actúa en las pestañas donde se VE el selector (General y Termos). En Lb/Hora, Por Talla,
  // Eficiencias y Lb/Persona quedaba activo pero oculto, y además distorsiona: los bloques de tiempo
  // se miden entre pesadas consecutivas de la persona, y casi siempre alterna lotes en el día — al
  // quitarle las del otro lote, ese tiempo se le cargaba al lote elegido.
  const loteFiltroObj = loteFiltro && !SUB_TABS_SIN_FINCA.includes(subTab)
    ? { Lote: loteFiltro.split("|")[0], Clase: loteFiltro.split("|")[1] } : null;

  // Reporte visible: si hay un Lote elegido en el filtro, se recorta reporte a solo ese Lote+Clase
  // antes de que el resto del componente lo use. El mismo texto de Lote puede repetirse con otra
  // Clase (C20/D30/E41 del mismo Piscina+Ciclo+Fecha, ver project_destajo_lote_clase_en_codigo) —
  // filtrar solo por Lote mezclaba ahí Termos y pesadas de una etapa de proceso distinta que nunca
  // se trabajó con el Lote+Clase elegido, por eso porTermo y porPersona también cortan por ClaseOrigen.
  const datos = (() => {
    if (!reporte || !loteFiltroObj) return reporte;
    const porLote = reporte.porLote.filter(l => l.Lote === loteFiltroObj.Lote && l.Clase === loteFiltroObj.Clase);
    const porLoteTalla = reporte.porLoteTalla.filter(d => d.Lote === loteFiltroObj.Lote && d.ClaseOrigen === loteFiltroObj.Clase);
    const porTermo = reporte.porTermo.filter(t => t.Lote === loteFiltroObj.Lote && t.ClaseOrigen === loteFiltroObj.Clase);
    const porPersona = reporte.porPersona.filter(p => p.Lote === loteFiltroObj.Lote && p.ClaseOrigen === loteFiltroObj.Clase);
    const porTalla = (() => {
      const mapa = new Map();
      for (const d of porLoteTalla) {
        if (!mapa.has(d.Talla)) mapa.set(d.Talla, { Talla: d.Talla, DescripcionTalla: d.DescripcionTalla, Procesado: 0, NumPesajes: 0 });
        const acc = mapa.get(d.Talla);
        acc.Procesado += d.Procesado;
        acc.NumPesajes += d.NumPesajes;
      }
      return [...mapa.values()].sort((a, b) => b.Procesado - a.Procesado);
    })();
    const totales = porLote.reduce((acc, l) => ({
      PesoIngreso: acc.PesoIngreso + l.PesoIngreso,
      Procesado: acc.Procesado + l.Procesado,
    }), { PesoIngreso: 0, Procesado: 0 });
    return {
      ...reporte, porLote, porLoteTalla, porTermo, porPersona, porTalla,
      totales: { ...totales, Pendiente: totales.PesoIngreso - totales.Procesado, Rendimiento: totales.PesoIngreso > 0 ? (totales.Procesado / totales.PesoIngreso * 100) : 0 },
    };
  })();

  // Lote (texto) puede repetirse entre Clases del mismo Piscina+Ciclo+Fecha (ver
  // project_destajo_lote_clase_en_codigo) — hace falta también la Clase para no mezclar el detalle de
  // dos filas de Materia Prima distintas.
  const detalleDeLote = (lote, clase) => (datos?.porLoteTalla ?? []).filter(d => d.Lote === lote && d.ClaseOrigen === clase);

  // Si hay un lote abierto (tocado en la tabla de la izquierda), la tabla de Talla se
  // filtra a solo lo procesado de ese lote; si no, muestra el total del rango de fechas.
  const tallasMostradas = (() => {
    if (!loteAbierto) return datos?.porTalla ?? [];
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
  const totalProcesadoTermo = (datos?.porTermo ?? []).reduce((s, t) => s + t.Procesado, 0);

  // Hoja de Lote: datos ya viene recortado al Lote+Clase elegidos (ver loteFiltroObj/datos arriba),
  // así que loteHoja es esa única fila de porLote y termosHoja son solo los Termos de ese Lote.
  const loteHoja = loteFiltroObj ? (datos?.porLote?.[0] ?? null) : null;
  const termosHoja = datos?.porTermo ?? [];
  const totalPeladoHoja = termosHoja.reduce((s, t) => s + t.Procesado, 0);

  // Para el PDF: TODOS los lotes con producción en el rango Desde/Hasta, sin importar el Lote elegido
  // en el selector (ese selector es solo para la vista/edición de notas en pantalla, ver más abajo).
  // Se arma sobre `reporte` (sin recortar por loteFiltroObj) para que el botón imprima el lote
  // elegido y también todos los demás.
  const lotesParaImprimir = (reporte?.porLote ?? []).filter(l => l.Procesado > 0);
  const termosDeLote = (lote, clase) => (reporte?.porTermo ?? []).filter(t => t.Lote === lote && t.ClaseOrigen === clase);

  // El textarea de Notas es local mientras se escribe (se guarda al salir del campo, no en cada
  // tecla) — se resincroniza con lo que trae el Lote cada vez que cambia el Lote elegido, para no
  // arrastrar la nota de un Lote hacia otro.
  useEffect(() => { setNotasHoja(loteHoja?.Notas ?? ""); }, [loteHoja?.Lote, loteHoja?.Clase]);

  const guardarNotasHoja = async () => {
    if (!loteHoja || notasHoja === (loteHoja.Notas ?? "")) return;
    setGuardandoNotas(true);
    try {
      const res = await fetch(`/api/lotes/${encodeURIComponent(loteHoja.Lote)}/${encodeURIComponent(loteHoja.Clase)}/notas`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ Notas: notasHoja }),
      });
      // Si el servidor rechaza (sin permiso, nota muy larga), se devuelve el texto al valor guardado:
      // dejarlo escrito en pantalla haría creer que quedó grabado cuando no fue así.
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert("No se pudo guardar la nota: " + (data.error || res.status));
        setNotasHoja(loteHoja.Notas ?? "");
        return;
      }
      // Refleja el guardado en `reporte` para que loteHoja.Notas quede al día sin recargar el
      // reporte completo (evita que useEffect de arriba dispare otra vuelta al comparar contra sí mismo).
      setReporte(r => r && {
        ...r,
        porLote: r.porLote.map(l => l.Lote === loteHoja.Lote && l.Clase === loteHoja.Clase ? { ...l, Notas: notasHoja } : l),
      });
    } finally {
      setGuardandoNotas(false);
    }
  };

  const areasLbHora = [...new Set((datos?.porPersona ?? []).map(p => p.Area).filter(Boolean))].sort();
  // El filtro de Área se aplica ANTES de calcular los bloques (no después) para que, si un
  // Producto+Talla llegara a venir de dos áreas distintas, quede acotado a una sola al elegirla.
  const porPersonaLbHora = (datos?.porPersona ?? []).filter(p => !areaLbHora || p.Area === areaLbHora);

  const pausasNoPaga = datos?.pausasNoPaga ?? [];
  const filasLbHora = calcularLbHora(porPersonaLbHora, agruparPorArea, pausasNoPaga).sort((a, b) => b.Lb - a.Lb);
  const filasPorTalla = calcularLbHora(porPersonaLbHora, agruparPorProductoTalla, pausasNoPaga);
  // Uno por pestaña, no uno compartido: Por Talla descarta además los bloques con cambio de grupo de
  // menos de 15 min, así que descarta más libras que Lb/Hora. Con un solo resumen la resta del aviso
  // no cerraba contra el Total General de esa pestaña. resumenValidez deduplica por IdEmpleado, así
  // que la lista de gente no repite a nadie aunque haya trabajado en varios Producto+Talla.
  const validezLbHora = resumenValidez(filasLbHora);
  const validezPorTalla = resumenValidez(filasPorTalla);
  const gruposPorTalla = gruposPorProductoTalla(filasPorTalla);
  // Lb se suma, pero las otras dos NO:
  //  · Lb/Hora es el promedio PONDERADO por horas sobre las filas de persona (totalLbHora), no el
  //    promedio de los promedios de cada fila — una talla con poca gente pesaría igual que una
  //    con todo el equipo.
  //  · Personas se cuenta DISTINTO: quien trabajó en dos Producto+Talla aparece en ambas filas, y
  //    sumar la columna lo contaría dos veces.
  const totalPorTalla = {
    ...totalLbHora(filasPorTalla),
    NumPersonas: new Set(filasPorTalla.map(f => f.IdEmpleado)).size,
  };
  const filasLbPersona = calcularLbPorPersona(datos?.porPersona ?? []);
  // Acá sí cuadra sumar columna por columna: calcularLbPorPersona define LbTotal como la suma de
  // las áreas de destajo, y cada persona aparece en una sola fila (agrupada por IdEmpleado), así
  // que el total de la columna Total es también la suma de los tres totales de área.
  const totalLbPersona = {
    ...Object.fromEntries(AREAS_DESTAJO.map(a => [a.lb, filasLbPersona.reduce((t, f) => t + f[a.lb], 0)])),
    LbTotal: filasLbPersona.reduce((t, f) => t + f.LbTotal, 0),
    Personas: filasLbPersona.length,
  };
  // Solo las áreas que tuvieron libras en el rango: una columna entera de "—" solo estorba. Sin datos
  // se dejan todas, para que la tabla vacía conserve su encabezado.
  const areasLbPersona = filasLbPersona.length ? AREAS_DESTAJO.filter(a => totalLbPersona[a.lb] > 0) : AREAS_DESTAJO;
  const colsLbPersona = LBPERSONA_COLS.filter(k =>
    !Object.values(LBPERSONA_AREA_COL).includes(k) || areasLbPersona.some(a => LBPERSONA_AREA_COL[a.codigo] === k));
  const anchoLbPersona = 16 + colsLbPersona.reduce((s, k) => s + (widthsLbPersona[k] ?? LBPERSONA_COL_DEFAULTS[k] ?? 0), 0);


  // El % de Talla se ordena por Procesado: es proporcional, y así no depende del redondeo.
  const tallasOrdenadas = ordenarFilas(tallasMostradas, ordenTallaGen, {
    talla: t => t.Talla, kg: t => t.Procesado, pct: t => t.Procesado,
  });
  const lbHoraOrdenadas = ordenarFilas(filasLbHora, ordenLbHora, {
    id: f => f.IdEmpleado, nombre: f => f.Nombre, area: f => f.Area,
    fecha: f => f.Fecha ?? "", clase: f => f.Producto ?? "", talla: f => f.Talla ?? "",
    lb: f => f.Lb, horas: f => f.Horas, lbhora: f => f.LbPorHora, pesadas: f => f.NumPesadas,
  });
  const portallaOrdenadas = ordenarFilas(gruposPorTalla, ordenPortalla, {
    productoTalla: g => `${g.Producto} ${g.Talla}`,
    lbTotal: g => g.resumen.TotalLb,
    lbHoraProm: g => g.resumen.PromedioLbHora,
    numPersonas: g => g.resumen.NumPersonas,
  });
  // Las columnas por área se arman recorriendo AREAS_DESTAJO, así que su mapa de orden también.
  const lbPersonaOrdenadas = ordenarFilas(filasLbPersona, ordenLbPersona, {
    puesto: f => f.Puesto, id: f => f.IdEmpleado, nombre: f => f.Nombre, total: f => f.LbTotal,
    ...Object.fromEntries(AREAS_DESTAJO.map(a => [LBPERSONA_AREA_COL[a.codigo], f => f[a.lb]])),
  });

  // Eficiencias: una fila por pesada, así que la misma persona aparece decenas de veces. El filtro
  // de la columna Nombre es para poder aislar a una sola sin exportar y filtrar en Excel.
  const pesajes = datos?.porPersona ?? [];
  const personasEfic = Object.values(pesajes.reduce((acc, p) => {
    (acc[p.IdEmpleado] ??= { valor: p.IdEmpleado, etiqueta: `${p.Nombre} (${p.IdEmpleado})`, cuenta: 0 }).cuenta++;
    return acc;
  }, {})).sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es"));
  // Talla y Kilos se ordenan por su número, no por el texto que se pinta ("361 — 91/110").
  const VALORES_EFIC = {
    id:       p => p.IdEmpleado,
    nombre:   p => p.Nombre,
    area:     p => p.Area,
    fecha:    p => p.FechaHora,                 // completo: a igual día, ordena por hora
    hora:     p => p.FechaHora?.slice(11, 16),  // solo la hora del día, como se muestra
    lote:     p => p.Lote,
    producto: p => p.Producto,
    talla:    p => p.Talla,
    kilos:    p => p.Kilos,
  };
  const pesajesVisibles = ordenarFilas(
    personaEfic ? pesajes.filter(p => p.IdEmpleado === personaEfic) : pesajes,
    ordenEfic, VALORES_EFIC);

  // Solo para la hoja imprimible (Descargar PDF) — encabezado con el rango, filtros activos y sello de hora.
  const tituloSubTab = SUB_TABS.find(t => t.key === subTab)?.label ?? "";
  useEffect(() => {
    if (SUB_TABS_SIN_FINCA.includes(subTab) && finca) setFinca("");
  }, [subTab, finca]);

  // Solo las fincas que tuvieron lotes en el rango. La elegida se conserva aunque no esté (ej. se
  // cambió el rango y ya no trabajó), para que el select no muestre un valor que no existe.
  const fincasConLotes = reporte?.fincasConLotes ?? [];
  const fincas = finca && !fincasConLotes.some(f => f.Codigo === finca)
    ? [...fincasConLotes, { Codigo: finca, Descripcion: "sin lotes en el rango" }]
    : fincasConLotes;
  const nombreFincaSeleccionada = fincas.find(f => f.Codigo === finca)?.Descripcion;
  const rangoFechasTexto = desde === hasta ? fechaCorta(desde) : `${fechaCorta(desde)} — ${fechaCorta(hasta)}`;
  const impresoEn = new Date().toLocaleString("sv-SE", { timeZone: "America/Guatemala", hour12: false }).slice(0, 16);

  const gruposPorFinca = () => {
    const mapa = new Map();
    for (const l of datos?.porLote ?? []) {
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
    for (const t of datos?.porTermo ?? []) {
      if (!mapa.has(t.NumeroTermo)) mapa.set(t.NumeroTermo, []);
      mapa.get(t.NumeroTermo).push(t);
    }
    return [...mapa.entries()];
  };

  const exportar = () => {
    if (!reporte) return;
    if (subTab === "general") exportarReporteGeneral(datos.porLote, datos.porTalla, desde, hasta);
    else if (subTab === "termos") exportarReporteTermos(datos.porTermo, desde, hasta);
    else if (subTab === "hojalote") { if (loteHoja) exportarHojaLote(termosHoja, loteHoja); }
    else if (subTab === "lbhora") exportarLbHora(filasLbHora, desde, hasta);
    else if (subTab === "portalla") exportarLbHoraPorTalla(filasPorTalla, desde, hasta);
    else if (subTab === "lbpersona") exportarLbPorPersona(filasLbPersona, desde, hasta, areasLbPersona);
    // pesajesVisibles y no reporte.porPersona: el Excel debe traer lo que se está viendo, con el
    // filtro de persona y el orden ya aplicados.
    else exportarEficiencias(pesajesVisibles, desde, hasta);
  };

  return (
    <>
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
        {!SUB_TABS_SIN_FINCA.includes(subTab) && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-0.5">{subTab === "hojalote" ? "Lote" : "Lote (en proceso)"}</label>
            <select value={loteFiltro} onChange={e => setLoteFiltro(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="">{subTab === "hojalote" ? "Seleccione..." : "Todos"}</option>
              {lotesSelector.map(l => (
                <option key={`${l.Lote}-${l.Clase}`} value={`${l.Lote}|${l.Clase}`}>
                  {subTab === "hojalote"
                    ? `${l.Lote} — ${l.Clase} (rendimiento ${fmtNum(l.Rendimiento, 1)}%)`
                    : `${l.Lote} — ${l.Clase} (pendiente ${fmtNum(l.Pendiente)} kg)`}
                </option>
              ))}
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

        <div className="flex gap-1 bg-blue-800 rounded-lg p-1 ml-4">
          {SUB_TABS.map(t => (
            <button key={t.key} onClick={() => setSubTab(t.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition ${
                subTab === t.key
                  ? "bg-white shadow text-blue-800"
                  : "text-white hover:bg-blue-700"
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {reporte && (
          <div className="ml-auto flex gap-2">
            <button onClick={() => window.print()}
              className="flex items-center gap-1.5 bg-red-600 text-white text-sm font-semibold px-3 py-1.5 rounded-lg hover:bg-red-700 transition">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" />
              </svg>
              Descargar PDF
            </button>
            <button onClick={exportar}
              className="bg-green-600 text-white text-sm font-semibold px-3 py-1.5 rounded-lg hover:bg-green-700 transition">
              Exportar Excel
            </button>
          </div>
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
                <p className="text-base font-bold text-gray-800">{fmtNum(datos.totales.PesoIngreso)} kg</p>
              </div>
              <div className="bg-white rounded-lg shadow px-3 py-2 text-center">
                <p className="text-xs text-gray-400">Procesado</p>
                <p className="text-base font-bold text-blue-700">{fmtNum(datos.totales.Procesado)} kg</p>
              </div>
              <div className="bg-white rounded-lg shadow px-3 py-2 text-center">
                <p className="text-xs text-gray-400">Pendiente</p>
                <p className="text-base font-bold text-amber-600">{fmtNum(datos.totales.Pendiente)} kg</p>
              </div>
              <div className="bg-white rounded-lg shadow px-3 py-2 text-center">
                <p className="text-xs text-gray-400">Rendimiento</p>
                <p className="text-base font-bold text-gray-700">{fmtNum(datos.totales.Rendimiento, 1)}%</p>
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
                              <td className="px-3 py-2 text-right text-gray-800">{fmtNum(sub.PesoIngreso)}</td>
                              <td className="px-3 py-2 text-right text-blue-700">{fmtNum(sub.Procesado)}</td>
                              <td className="px-3 py-2 text-right text-amber-600">{fmtNum(sub.Pendiente)}</td>
                              <td className="px-3 py-2 text-right text-gray-600">{fmtNum(rendSub, 1)}%</td>
                              <td className="px-3 py-2"></td>
                            </tr>
                          </Fragment>
                        );
                      })}
                      {datos.porLote.length === 0 && (
                        <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">Sin lotes en este rango de fechas</td></tr>
                      )}
                    </tbody>
                    {datos.porLote.length > 0 && (
                      <tfoot>
                        <tr className="bg-gray-200 font-bold border-t-2 border-gray-300">
                          <td className="px-3 py-2.5" colSpan={5}>Total General</td>
                          <td className="px-3 py-2.5 text-right text-gray-900">{fmtNum(datos.totales.PesoIngreso)}</td>
                          <td className="px-3 py-2.5 text-right text-blue-800">{fmtNum(datos.totales.Procesado)}</td>
                          <td className="px-3 py-2.5 text-right text-amber-700">{fmtNum(datos.totales.Pendiente)}</td>
                          <td className="px-3 py-2.5 text-right text-gray-800">{fmtNum(datos.totales.Rendimiento, 1)}%</td>
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
                        <Th width={widthsPorTallaGen.talla} onResizeStart={startResizePorTallaGen("talla")} sortKey="talla" orden={ordenTallaGen} onOrdenar={alternarOrdenTallaGen} className="px-3 py-3 text-left">Talla</Th>
                        <Th width={widthsPorTallaGen.kg} onResizeStart={startResizePorTallaGen("kg")} sortKey="kg" orden={ordenTallaGen} onOrdenar={alternarOrdenTallaGen} className="px-3 py-3 text-right">Kg</Th>
                        <Th width={widthsPorTallaGen.pct} onResizeStart={startResizePorTallaGen("pct")} sortKey="pct" orden={ordenTallaGen} onOrdenar={alternarOrdenTallaGen} className="px-3 py-3 text-right">%</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {tallasOrdenadas.map(t => (
                        <tr key={t.Talla} className="hover:bg-gray-50 transition">
                          <td className="px-3 py-2.5 text-gray-700">
                            <span className="font-mono">{t.Talla}</span> — {t.DescripcionTalla}
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold text-blue-700">{fmtNum(t.Procesado)}</td>
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
                          <td className="px-3 py-2.5 text-right text-blue-800">{fmtNum(totalProcesadoTalla)}</td>
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
                    {(datos.porTermo ?? []).length === 0 && (
                      <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-400">Sin datos en este rango de fechas</td></tr>
                    )}
                  </tbody>
                  {(datos.porTermo ?? []).length > 0 && (
                    <tfoot>
                      <tr className="bg-gray-200 font-bold border-t-2 border-gray-300">
                        <td className="px-2 py-1.5" colSpan={3}>Total General</td>
                        <td className="px-2 py-1.5 text-right text-blue-800">{fmtNum(totalProcesadoTermo)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          {/* ── Hoja de Lote ── */}
          {subTab === "hojalote" && (
            <>
            <p className="text-xs text-gray-400 mb-2 text-center">
              El selector de Lote de arriba es solo para ver/editar la nota de uno a la vez en pantalla —
              {" "}"Descargar PDF" imprime una hoja por cada Lote con producción en el rango Desde/Hasta ({lotesParaImprimir.length} lote{lotesParaImprimir.length !== 1 ? "s" : ""}).
            </p>
            {!loteFiltroObj ? (
              <div className="bg-white rounded-xl shadow px-4 py-8 text-center text-gray-400 text-sm">Elige un Lote arriba para ver/editar su nota</div>
            ) : !loteHoja ? (
              <div className="bg-white rounded-xl shadow px-4 py-8 text-center text-gray-400 text-sm">Ese Lote no aparece en el rango de fechas elegido</div>
            ) : (
              <div className="bg-white rounded-xl shadow p-5 max-w-2xl mx-auto">
                <h3 className="text-center text-base font-bold uppercase tracking-wide text-gray-800 border-2 border-gray-800 rounded py-1.5 mb-4">
                  Camarón Pelado
                </h3>
                <table className="w-full text-sm mb-4">
                  <tbody>
                    <tr className="border-b border-gray-200">
                      <td className="py-1.5 pr-3 font-semibold text-gray-500 w-28">Fecha</td>
                      <td className="py-1.5 text-center font-semibold text-gray-800">{fechaCorta(loteHoja.Fecha?.slice(0, 10))}</td>
                    </tr>
                    <tr className="border-b border-gray-200">
                      <td className="py-1.5 pr-3 font-semibold text-gray-500">Nombre</td>
                      <td className="py-1.5 text-center font-semibold text-gray-800">{loteHoja.RegistradoPor || "—"}</td>
                    </tr>
                    <tr className="border-b border-gray-200">
                      <td className="py-1.5 pr-3 font-semibold text-gray-500">Lote</td>
                      <td className="py-1.5 text-center font-mono font-bold text-gray-800">{loteHoja.Lote}</td>
                    </tr>
                    <tr className="border-b border-gray-200">
                      <td className="py-1.5 pr-3 font-semibold text-gray-500">Clase de Materia Prima</td>
                      <td className="py-1.5 text-center font-semibold text-gray-800">{loteHoja.Clase} — {loteHoja.DescripcionClase}</td>
                    </tr>
                  </tbody>
                </table>

                <table className="w-full text-sm border border-gray-300 mb-4">
                  <thead>
                    <tr className="bg-gray-100 text-gray-600 uppercase text-xs">
                      <th className="border border-gray-300 py-1.5 px-2 text-left">Termo</th>
                      <th className="border border-gray-300 py-1.5 px-2 text-left">Talla</th>
                      <th className="border border-gray-300 py-1.5 px-2 text-left">Producto</th>
                      <th className="border border-gray-300 py-1.5 px-2 text-right">Kilos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {termosHoja.map(t => (
                      <tr key={t.TermoId}>
                        <td className="border border-gray-300 py-1 px-2 font-mono">{t.NumeroTermo}</td>
                        <td className="border border-gray-300 py-1 px-2">{t.DescripcionTalla}</td>
                        <td className="border border-gray-300 py-1 px-2">{t.DescripcionProceso}</td>
                        <td className="border border-gray-300 py-1 px-2 text-right tabular-nums">{fmtNum(t.Procesado)}</td>
                      </tr>
                    ))}
                    {termosHoja.length === 0 && (
                      <tr><td colSpan={4} className="border border-gray-300 py-4 text-center text-gray-400">Sin termos registrados para este Lote</td></tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="font-bold">
                      <td className="border border-gray-300 py-1.5 px-2" colSpan={3}></td>
                      <td className="border border-gray-300 py-1.5 px-2 text-right">{fmtNum(totalPeladoHoja)}</td>
                    </tr>
                  </tfoot>
                </table>

                {/* Comparación contra la Materia Prima Ingresada del lote (loteHoja.PesoIngreso ya
                    viene del mismo endpoint que Materia Prima, así que siempre cuadra con esa pantalla). */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="border-2 border-gray-800 rounded px-3 py-2 text-center">
                    <p className="text-xs text-gray-500">Materia Prima Ingresada</p>
                    <p className="text-lg font-bold text-gray-800">{fmtNum(loteHoja.PesoIngreso)}</p>
                  </div>
                  <div className="border-2 border-gray-800 rounded px-3 py-2 text-center">
                    <p className="text-xs text-gray-500">Total Pelado</p>
                    <p className="text-lg font-bold text-blue-700">{fmtNum(totalPeladoHoja)}</p>
                  </div>
                  <div className="border-2 border-gray-800 rounded px-3 py-2 text-center">
                    <p className="text-xs text-gray-500">Rendimiento</p>
                    <p className="text-lg font-bold text-gray-800">{fmtNum(loteHoja.Rendimiento, 0)}%</p>
                  </div>
                </div>
                {Math.abs(totalPeladoHoja - loteHoja.Procesado) > 0.5 && (
                  <p className="text-xs text-amber-600 mb-4">
                    ● El Total Pelado de la hoja ({fmtNum(totalPeladoHoja)}) no cuadra con el Procesado del Lote ({fmtNum(loteHoja.Procesado)}):
                    hay {fmtNum(Math.abs(totalPeladoHoja - loteHoja.Procesado))} kg pesados sin Termo asignado.
                  </p>
                )}

                <div className="border border-gray-400 rounded">
                  <p className="text-xs font-semibold text-gray-500 px-2 pt-1.5">Notas</p>
                  <textarea value={notasHoja} onChange={e => setNotasHoja(e.target.value)}
                    onBlur={guardarNotasHoja}
                    maxLength={MAX_NOTAS}
                    disabled={!puedeEditarNotas}
                    placeholder={puedeEditarNotas ? "Observaciones..." : "Sin permiso para editar la nota"}
                    className="w-full h-20 px-2 py-1 text-sm text-gray-700 resize-none focus:outline-none disabled:bg-gray-50 disabled:text-gray-500" />
                  <p className="text-[10px] text-gray-400 px-2 pb-1 flex justify-between">
                    <span>{guardandoNotas ? "Guardando…" : puedeEditarNotas ? "Se guarda al salir del campo" : ""}</span>
                    <span className={notasHoja.length >= MAX_NOTAS ? "text-amber-600 font-semibold" : ""}>
                      {notasHoja.length}/{MAX_NOTAS}
                    </span>
                  </p>
                </div>
              </div>
            )}
            </>
          )}

          {/* ── Eficiencias ── */}
          {subTab === "eficiencias" && (
            <div>
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <h3 className="text-xs font-semibold text-gray-700">Pesajes por Persona</h3>
                <span className="text-xs text-gray-500">{pesajesVisibles.length} pesada{pesajesVisibles.length !== 1 ? "s" : ""}</span>
                {personaEfic && (
                  <button onClick={() => setPersonaEfic("")}
                    className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 hover:bg-blue-200 transition">
                    {personasEfic.find(o => o.valor === personaEfic)?.etiqueta ?? personaEfic} &times;
                  </button>
                )}
              </div>
              <div className="bg-white rounded-lg shadow overflow-hidden overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-xs table-fixed">
                  <Colgroup columns={EFICIENCIAS_COLS} widths={widthsEficiencias} />
                  <thead>
                    <tr className="bg-gray-100 text-gray-600 uppercase text-[10px] tracking-wider">
                      <Th width={widthsEficiencias.id} onResizeStart={startResizeEficiencias("id")} sortKey="id" orden={ordenEfic} onOrdenar={alternarOrdenEfic} className="px-2 py-1.5 text-left whitespace-nowrap">Id Empleado</Th>
                      <Th width={widthsEficiencias.nombre} onResizeStart={startResizeEficiencias("nombre")} sortKey="nombre" orden={ordenEfic} onOrdenar={alternarOrdenEfic} className="px-2 py-1.5 text-left"
                        filtro={<FiltroColumna opciones={personasEfic} valor={personaEfic} onCambio={setPersonaEfic} etiqueta="Ver una sola persona" />}>Nombre</Th>
                      <Th width={widthsEficiencias.area} onResizeStart={startResizeEficiencias("area")} sortKey="area" orden={ordenEfic} onOrdenar={alternarOrdenEfic} className="px-2 py-1.5 text-left whitespace-nowrap">Área</Th>
                      <Th width={widthsEficiencias.fecha} onResizeStart={startResizeEficiencias("fecha")} sortKey="fecha" orden={ordenEfic} onOrdenar={alternarOrdenEfic} className="px-2 py-1.5 text-center whitespace-nowrap">Fecha</Th>
                      <Th width={widthsEficiencias.hora} onResizeStart={startResizeEficiencias("hora")} sortKey="hora" orden={ordenEfic} onOrdenar={alternarOrdenEfic} className="px-2 py-1.5 text-center whitespace-nowrap">Hora</Th>
                      <Th width={widthsEficiencias.lote} onResizeStart={startResizeEficiencias("lote")} sortKey="lote" orden={ordenEfic} onOrdenar={alternarOrdenEfic} className="px-2 py-1.5 text-left whitespace-nowrap">Lote</Th>
                      <Th width={widthsEficiencias.producto} onResizeStart={startResizeEficiencias("producto")} sortKey="producto" orden={ordenEfic} onOrdenar={alternarOrdenEfic} className="px-2 py-1.5 text-left whitespace-nowrap">Producto</Th>
                      <Th width={widthsEficiencias.talla} onResizeStart={startResizeEficiencias("talla")} sortKey="talla" orden={ordenEfic} onOrdenar={alternarOrdenEfic} className="px-2 py-1.5 text-left whitespace-nowrap">Talla</Th>
                      <Th width={widthsEficiencias.kilos} onResizeStart={startResizeEficiencias("kilos")} sortKey="kilos" orden={ordenEfic} onOrdenar={alternarOrdenEfic} className="px-2 py-1.5 text-right whitespace-nowrap">Kilos</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pesajesVisibles.map((p, i) => (
                      <tr key={i} className="hover:bg-gray-50 transition">
                        <td className="px-2 py-1.5 font-mono text-gray-700 whitespace-nowrap">{p.IdEmpleado}</td>
                        <td className="px-2 py-1.5 text-gray-700"><div className="max-w-[9rem] truncate" title={p.Nombre}>{p.Nombre}</div></td>
                        <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">{p.Area || <span className="text-gray-300">—</span>}</td>
                        <td className="px-2 py-1.5 text-center text-gray-600 whitespace-nowrap">{p.FechaHora?.slice(0, 10)}</td>
                        <td className="px-2 py-1.5 text-center text-gray-600 whitespace-nowrap">{p.FechaHora?.slice(11, 16)}</td>
                        <td className="px-2 py-1.5 font-mono text-gray-700 whitespace-nowrap">{p.Lote}</td>
                        <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">{p.Producto}</td>
                        <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">{p.Talla} — {p.DescripcionTalla}</td>
                        <td className="px-2 py-1.5 text-right font-semibold text-blue-700 whitespace-nowrap">{fmtNum(p.Kilos)}</td>
                      </tr>
                    ))}
                    {pesajesVisibles.length === 0 && (
                      <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">{personaEfic ? "Esa persona no tiene pesadas en este rango" : "Sin datos en este rango de fechas"}</td></tr>
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
                {" "}Cada fila es Persona+Área+Día+Talla+Clase: un cambio de talla o de producto entre dos pesadas consecutivas exige el mismo mínimo de {MINIMO_BLOQUE_MINUTOS} min que un cambio de Área.
              </p>
              <div className="bg-white rounded-lg shadow overflow-hidden overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-xs table-fixed">
                  <Colgroup columns={LBHORA_COLS} widths={widthsLbHora} />
                  <thead>
                    <tr className="bg-gray-100 text-gray-600 uppercase text-[10px] tracking-wider">
                      <Th width={widthsLbHora.id} onResizeStart={startResizeLbHora("id")} sortKey="id" orden={ordenLbHora} onOrdenar={alternarOrdenLbHora} className="px-2 py-1.5 text-left whitespace-nowrap">Id Empleado</Th>
                      <Th width={widthsLbHora.nombre} onResizeStart={startResizeLbHora("nombre")} sortKey="nombre" orden={ordenLbHora} onOrdenar={alternarOrdenLbHora} className="px-2 py-1.5 text-left">Nombre</Th>
                      <Th width={widthsLbHora.area} onResizeStart={startResizeLbHora("area")} sortKey="area" orden={ordenLbHora} onOrdenar={alternarOrdenLbHora} className="px-2 py-1.5 text-left whitespace-nowrap">Área</Th>
                      <Th width={widthsLbHora.fecha} onResizeStart={startResizeLbHora("fecha")} sortKey="fecha" orden={ordenLbHora} onOrdenar={alternarOrdenLbHora} className="px-2 py-1.5 text-left whitespace-nowrap">Fecha</Th>
                      <Th width={widthsLbHora.clase} onResizeStart={startResizeLbHora("clase")} sortKey="clase" orden={ordenLbHora} onOrdenar={alternarOrdenLbHora} className="px-2 py-1.5 text-left whitespace-nowrap">Clase</Th>
                      <Th width={widthsLbHora.talla} onResizeStart={startResizeLbHora("talla")} sortKey="talla" orden={ordenLbHora} onOrdenar={alternarOrdenLbHora} className="px-2 py-1.5 text-left whitespace-nowrap">Talla</Th>
                      <Th width={widthsLbHora.lb} onResizeStart={startResizeLbHora("lb")} sortKey="lb" orden={ordenLbHora} onOrdenar={alternarOrdenLbHora} className="px-2 py-1.5 text-right whitespace-nowrap">Lb</Th>
                      <Th width={widthsLbHora.horas} onResizeStart={startResizeLbHora("horas")} sortKey="horas" orden={ordenLbHora} onOrdenar={alternarOrdenLbHora} className="px-2 py-1.5 text-right whitespace-nowrap">Horas</Th>
                      <Th width={widthsLbHora.lbhora} onResizeStart={startResizeLbHora("lbhora")} sortKey="lbhora" orden={ordenLbHora} onOrdenar={alternarOrdenLbHora} className="px-2 py-1.5 text-right whitespace-nowrap">Lb/Hora</Th>
                      <Th width={widthsLbHora.pesadas} onResizeStart={startResizeLbHora("pesadas")} sortKey="pesadas" orden={ordenLbHora} onOrdenar={alternarOrdenLbHora} className="px-2 py-1.5 text-center whitespace-nowrap"># Pesadas</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {lbHoraOrdenadas.map(f => (
                      <tr key={`${f.IdEmpleado}-${f.Area}-${f.Fecha}-${f.Talla}-${f.Producto}`} className="hover:bg-gray-50 transition">
                        <td className="px-2 py-1.5 font-mono text-gray-700 whitespace-nowrap">{f.IdEmpleado}</td>
                        <td className="px-2 py-1.5 text-gray-700"><div className="max-w-[9rem] truncate" title={f.Nombre}>{f.Nombre}</div></td>
                        <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">{f.Area || <span className="text-gray-300">—</span>}</td>
                        <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{fechaCorta(f.Fecha)}</td>
                        <td className="px-2 py-1.5 text-gray-600"><div className="max-w-[10rem] truncate" title={f.Producto}>{f.Producto}</div></td>
                        <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{f.DescripcionTalla}</td>
                        <td className="px-2 py-1.5 text-right text-gray-700 whitespace-nowrap">{fmtNum(f.Lb)}</td>
                        <td className="px-2 py-1.5 text-right text-gray-500 whitespace-nowrap">{fmtNum(f.Horas)}</td>
                        <td className="px-2 py-1.5 text-right font-semibold text-blue-700 whitespace-nowrap">
                          <CeldaLbHora f={f} />
                        </td>
                        <td className="px-2 py-1.5 text-center text-gray-500 whitespace-nowrap">{f.NumPesadas}</td>
                      </tr>
                    ))}
                    {filasLbHora.length === 0 && (
                      <tr><td colSpan={10} className="px-3 py-6 text-center text-gray-400">Sin datos en este rango de fechas</td></tr>
                    )}
                  </tbody>
                  {filasLbHora.length > 0 && (() => {
                    const total = totalLbHora(filasLbHora);
                    return (
                      <tfoot>
                        <tr className="bg-gray-200 font-bold border-t-2 border-gray-300">
                          <td className="px-2 py-1.5" colSpan={6}>Total General</td>
                          <td className="px-2 py-1.5 text-right text-gray-900">{fmtNum(total.TotalLb)}</td>
                          <td className="px-2 py-1.5"></td>
                          <td className="px-2 py-1.5 text-right text-blue-800">
                            {total.PromedioLbHora != null ? fmtNum(total.PromedioLbHora, 1) : "—"}
                          </td>
                          <td className="px-2 py-1.5"></td>
                        </tr>
                      </tfoot>
                    );
                  })()}
                </table>
              </div>
              <AvisoLbSinTiempo resumen={validezLbHora} />
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
                      <Th width={widthsPortalla.productoTalla} onResizeStart={startResizePortalla("productoTalla")} sortKey="productoTalla" orden={ordenPortalla} onOrdenar={alternarOrdenPortalla} className="px-2 py-1.5 text-left whitespace-nowrap">Producto — Talla</Th>
                      <Th width={widthsPortalla.lbTotal} onResizeStart={startResizePortalla("lbTotal")} sortKey="lbTotal" orden={ordenPortalla} onOrdenar={alternarOrdenPortalla} className="px-2 py-1.5 text-right whitespace-nowrap">Lb Total</Th>
                      <Th width={widthsPortalla.lbHoraProm} onResizeStart={startResizePortalla("lbHoraProm")} sortKey="lbHoraProm" orden={ordenPortalla} onOrdenar={alternarOrdenPortalla} className="px-2 py-1.5 text-right whitespace-nowrap">Lb/Hora Prom.</Th>
                      <Th width={widthsPortalla.numPersonas} onResizeStart={startResizePortalla("numPersonas")} sortKey="numPersonas" orden={ordenPortalla} onOrdenar={alternarOrdenPortalla} className="px-2 py-1.5 text-center whitespace-nowrap"># Personas</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {portallaOrdenadas.map(g => {
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
                  {gruposPorTalla.length > 0 && (
                    <tfoot>
                      <tr className="bg-gray-200 font-bold border-t-2 border-gray-300">
                        <td className="px-2 py-1.5" colSpan={2}>Total General</td>
                        <td className="px-2 py-1.5 text-right text-gray-900">{fmtNum(totalPorTalla.TotalLb)}</td>
                        <td className="px-2 py-1.5 text-right text-blue-800"
                          title="Promedio ponderado por horas de todo el equipo, no el promedio de las filas">
                          {totalPorTalla.PromedioLbHora != null ? fmtNum(totalPorTalla.PromedioLbHora, 1) : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-center"
                          title="Personas distintas: quien trabajó en varios Producto+Talla se cuenta una sola vez">
                          {totalPorTalla.NumPersonas}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              <AvisoLbSinTiempo resumen={validezPorTalla} />
            </div>
          )}

          {/* ── Lb/Persona ── */}
          {subTab === "lbpersona" && (
            <div className="mx-auto w-full" style={{ maxWidth: anchoLbPersona }}>
              <h3 className="text-xs font-semibold text-gray-700 mb-1">
                Libras por Persona — {areasLbPersona.map(a => a.etiqueta).join(", ")}
              </h3>
              <p className="text-xs text-gray-400 mb-2">
                Libras acumuladas por persona en cada área (sin tasa ni horas), ordenado de mayor a menor por el total de todas.
                {" "}Semáforo por tercios de posición en el ranking: <span className="px-1.5 py-0.5 rounded bg-green-50 border border-green-200">verde</span> = tercio superior,
                {" "}<span className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200">amarillo</span> = tercio medio,
                {" "}<span className="px-1.5 py-0.5 rounded bg-red-50 border border-red-200">rojo</span> = tercio inferior — no un monto fijo de libras, para no tener que ajustarlo cada día según el volumen.
              </p>
              <div className="bg-white rounded-lg shadow overflow-hidden overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-xs table-fixed">
                  <Colgroup columns={colsLbPersona} widths={widthsLbPersona} />
                  <thead>
                    <tr className="bg-gray-100 text-gray-600 uppercase text-[10px] tracking-wider">
                      <Th width={widthsLbPersona.puesto} onResizeStart={startResizeLbPersona("puesto")} sortKey="puesto" orden={ordenLbPersona} onOrdenar={alternarOrdenLbPersona} className="px-2 py-1.5 text-center whitespace-nowrap">Puesto</Th>
                      <Th width={widthsLbPersona.id} onResizeStart={startResizeLbPersona("id")} sortKey="id" orden={ordenLbPersona} onOrdenar={alternarOrdenLbPersona} className="px-2 py-1.5 text-left whitespace-nowrap">Id Empleado</Th>
                      <Th width={widthsLbPersona.nombre} onResizeStart={startResizeLbPersona("nombre")} sortKey="nombre" orden={ordenLbPersona} onOrdenar={alternarOrdenLbPersona} className="px-2 py-1.5 text-left">Nombre</Th>
                      {areasLbPersona.map(a => (
                        <Th key={a.codigo} width={widthsLbPersona[LBPERSONA_AREA_COL[a.codigo]]}
                          onResizeStart={startResizeLbPersona(LBPERSONA_AREA_COL[a.codigo])}
                          sortKey={LBPERSONA_AREA_COL[a.codigo]} orden={ordenLbPersona} onOrdenar={alternarOrdenLbPersona}
                          className="px-2 py-1.5 text-right whitespace-nowrap">{a.etiqueta} (Lb)</Th>
                      ))}
                      <Th width={widthsLbPersona.total} onResizeStart={startResizeLbPersona("total")} sortKey="total" orden={ordenLbPersona} onOrdenar={alternarOrdenLbPersona} className="px-2 py-1.5 text-right whitespace-nowrap">Total (Lb)</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {lbPersonaOrdenadas.map(f => (
                      <tr key={f.IdEmpleado} className={`${FILA_SEMAFORO[f.Semaforo]} hover:brightness-95 transition`}>
                        <td className="px-2 py-1.5 text-center text-gray-500 whitespace-nowrap">{f.Puesto}</td>
                        <td className="px-2 py-1.5 font-mono text-gray-700 whitespace-nowrap">{f.IdEmpleado}</td>
                        {/* sin max-w fijo: que el corte lo mande el ancho de la columna (ajustable) */}
                        <td className="px-2 py-1.5 text-gray-700"><div className="truncate" title={f.Nombre}>{f.Nombre}</div></td>
                        {areasLbPersona.map(a => (
                          <td key={a.codigo} className="px-2 py-1.5 text-right text-gray-700 whitespace-nowrap">
                            {f[a.lb] > 0 ? fmtNum(f[a.lb]) : <span className="text-gray-300">—</span>}
                          </td>
                        ))}
                        <td className="px-2 py-1.5 text-right font-semibold text-blue-700 whitespace-nowrap">{fmtNum(f.LbTotal)}</td>
                      </tr>
                    ))}
                    {filasLbPersona.length === 0 && (
                      <tr><td colSpan={colsLbPersona.length} className="px-3 py-6 text-center text-gray-400">Sin datos en este rango de fechas</td></tr>
                    )}
                  </tbody>
                  {filasLbPersona.length > 0 && (
                    <tfoot>
                      <tr className="bg-gray-200 font-bold border-t-2 border-gray-300">
                        <td className="px-2 py-1.5 whitespace-nowrap" colSpan={3}>
                          Total General <span className="font-normal text-gray-500">· {totalLbPersona.Personas} persona{totalLbPersona.Personas !== 1 ? "s" : ""}</span>
                        </td>
                        {areasLbPersona.map(a => (
                          <td key={a.codigo} className="px-2 py-1.5 text-right whitespace-nowrap text-gray-900">
                            {totalLbPersona[a.lb] > 0 ? fmtNum(totalLbPersona[a.lb]) : <span className="text-gray-400">—</span>}
                          </td>
                        ))}
                        <td className="px-2 py-1.5 text-right whitespace-nowrap text-blue-800">{fmtNum(totalLbPersona.LbTotal)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>

    {/* Hoja imprimible (Descargar PDF) — se monta en #print-root (fuera de #root) para que solo
        ella quede en el documento cuando #root se oculta al imprimir (ver index.css). Muestra el
        reporte de la pestaña activa, en su vista de resumen (sin filas expandidas). */}
    {reporte && createPortal(
      <div className="hidden print:block font-sans text-slate-700">
        <div className="flex items-end justify-between border-b-[3px] border-slate-900 pb-2 mb-2">
          <div className="flex items-center gap-2">
            <img src="/favicon.png" alt="" className="w-8 h-8 shrink-0" />
            <div>
              <p className="text-lg font-extrabold italic text-blue-700 tracking-tight">ORO BI</p>
              {/* Hoja de Lote ya lleva su propio título ("Camarón Pelado") y su propio Lote/Fecha
                  dentro de cada hoja — este título+subtítulo genérico sobraba repetido arriba. */}
              {subTab !== "hojalote" && (
                <>
                  <h1 className="text-xl font-extrabold uppercase text-slate-900 tracking-tight">Destajo — {tituloSubTab}</h1>
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    {rangoFechasTexto}
                    {finca && <> · Finca <span className="font-mono font-bold text-blue-700">{finca}</span>{nombreFincaSeleccionada && <> — {nombreFincaSeleccionada}</>}</>}
                    {loteFiltroObj && <> · Lote <span className="font-mono font-bold text-blue-700">{loteFiltroObj.Lote} — {loteFiltroObj.Clase}</span></>}
                    {areaLbHora && SUB_TABS_CON_AREA.includes(subTab) && <> · Área <span className="font-mono font-bold text-blue-700">{areaLbHora}</span></>}
                  </p>
                </>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-gray-400 font-mono mt-0.5">impreso {impresoEn}</p>
            {user?.nombre && <p className="text-[10px] text-gray-500 mt-0.5">Generado por <span className="font-semibold text-slate-700">{user.nombre}</span></p>}
          </div>
        </div>

        {subTab === "general" && (
          <>
            <table className="print-table w-full border-collapse text-[11px] leading-tight mb-4">
              <thead>
                <tr>
                  <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Lote</th>
                  <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Finca</th>
                  <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Clase MP</th>
                  <th className="text-center font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Fecha</th>
                  <th className="text-right font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Ingreso</th>
                  <th className="text-right font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Procesado</th>
                  <th className="text-right font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Pendiente</th>
                  <th className="text-right font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Rend.</th>
                </tr>
              </thead>
              <tbody>
                {(datos.porLote ?? []).map(l => (
                  <tr key={`${l.Lote}-${l.Clase}`} className="border-b border-gray-100">
                    <td className="py-0.5 px-1 font-mono font-bold text-blue-700">{l.Lote}</td>
                    <td className="py-0.5 px-1">{l.NombreFinca}</td>
                    <td className="py-0.5 px-1 font-mono">{l.Clase} — {l.DescripcionClase}</td>
                    <td className="py-0.5 px-1 text-center tabular-nums">{l.Fecha?.slice(0, 10)}</td>
                    <td className="py-0.5 px-1 text-right tabular-nums">{fmtNum(l.PesoIngreso)}</td>
                    <td className="py-0.5 px-1 text-right font-semibold tabular-nums">{fmtNum(l.Procesado)}</td>
                    <td className="py-0.5 px-1 text-right tabular-nums">{fmtNum(l.Pendiente)}</td>
                    <td className="py-0.5 px-1 text-right tabular-nums">{fmtNum(l.Rendimiento, 1)}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold border-t-2 border-slate-900">
                  <td className="py-1 px-1" colSpan={4}>Total General</td>
                  <td className="py-1 px-1 text-right tabular-nums">{fmtNum(datos.totales.PesoIngreso)}</td>
                  <td className="py-1 px-1 text-right tabular-nums">{fmtNum(datos.totales.Procesado)}</td>
                  <td className="py-1 px-1 text-right tabular-nums">{fmtNum(datos.totales.Pendiente)}</td>
                  <td className="py-1 px-1 text-right tabular-nums">{fmtNum(datos.totales.Rendimiento, 1)}%</td>
                </tr>
              </tfoot>
            </table>

            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900 mb-1">Procesado por Talla</h2>
            <table className="print-table w-full border-collapse text-[11px] leading-tight">
              <thead>
                <tr>
                  <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Talla</th>
                  <th className="text-right font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Kg</th>
                  <th className="text-right font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">%</th>
                </tr>
              </thead>
              <tbody>
                {tallasMostradas.map(t => (
                  <tr key={t.Talla} className="border-b border-gray-100">
                    <td className="py-0.5 px-1"><span className="font-mono">{t.Talla}</span> — {t.DescripcionTalla}</td>
                    <td className="py-0.5 px-1 text-right font-semibold tabular-nums">{fmtNum(t.Procesado)}</td>
                    <td className="py-0.5 px-1 text-right tabular-nums">{totalProcesadoTalla > 0 ? (t.Procesado / totalProcesadoTalla * 100).toFixed(1) : "0.0"}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {subTab === "termos" && (
          <table className="print-table w-full border-collapse text-[11px] leading-tight">
            <thead>
              <tr>
                <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Termo</th>
                <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Cargas</th>
                <th className="text-right font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Kg Procesados</th>
              </tr>
            </thead>
            <tbody>
              {gruposPorTermo().map(([numeroTermo, cargas]) => {
                const subtotal = cargas.reduce((s, c) => s + c.Procesado, 0);
                return (
                  <tr key={numeroTermo} className="border-b border-gray-100">
                    <td className="py-0.5 px-1 font-mono font-bold">Termo {numeroTermo}</td>
                    <td className="py-0.5 px-1">{cargas.length} carga{cargas.length !== 1 ? "s" : ""}</td>
                    <td className="py-0.5 px-1 text-right font-semibold tabular-nums">{fmtNum(subtotal)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-bold border-t-2 border-slate-900">
                <td className="py-1 px-1" colSpan={2}>Total General</td>
                <td className="py-1 px-1 text-right tabular-nums">{fmtNum(totalProcesadoTermo)}</td>
              </tr>
            </tfoot>
          </table>
        )}

        {/* Hoja de Lote se imprime SIEMPRE para todos los lotes con producción del rango
            Desde/Hasta (lotesParaImprimir), no solo el que está elegido en el selector de arriba —
            ese selector es nada más para previsualizar/editar la nota de uno a la vez en pantalla.
            Cada lote lleva su propia página (breakAfter: "page" en todas menos la última). */}
        {subTab === "hojalote" && (
          lotesParaImprimir.length === 0 ? (
            <p className="text-center text-sm text-gray-400">Sin lotes con producción en este rango de fechas</p>
          ) : lotesParaImprimir.map((l, i) => {
            const termos = termosDeLote(l.Lote, l.Clase);
            const totalPelado = termos.reduce((s, t) => s + t.Procesado, 0);
            return (
              <div key={`${l.Lote}-${l.Clase}`} className="max-w-xl mx-auto"
                style={i < lotesParaImprimir.length - 1 ? { breakAfter: "page" } : undefined}>
                <h2 className="text-center text-base font-bold uppercase tracking-wide text-slate-900 border-2 border-slate-900 rounded py-1.5 mb-3">
                  Camarón Pelado
                </h2>
                <table className="w-full text-[11px] mb-3">
                  <tbody>
                    <tr className="border-b border-gray-300">
                      <td className="py-1 pr-2 font-bold text-gray-500 w-24">Fecha</td>
                      <td className="py-1 text-center font-bold">{fechaCorta(l.Fecha?.slice(0, 10))}</td>
                    </tr>
                    <tr className="border-b border-gray-300">
                      <td className="py-1 pr-2 font-bold text-gray-500">Nombre</td>
                      <td className="py-1 text-center font-bold">{l.RegistradoPor || "—"}</td>
                    </tr>
                    <tr className="border-b border-gray-300">
                      <td className="py-1 pr-2 font-bold text-gray-500">Lote</td>
                      <td className="py-1 text-center font-mono font-bold">{l.Lote}</td>
                    </tr>
                    <tr className="border-b border-gray-300">
                      <td className="py-1 pr-2 font-bold text-gray-500">Clase de Materia Prima</td>
                      <td className="py-1 text-center font-bold">{l.Clase} — {l.DescripcionClase}</td>
                    </tr>
                  </tbody>
                </table>

                <table className="print-table w-full border-collapse text-[11px] leading-tight mb-3">
                  <thead>
                    <tr>
                      <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Termo</th>
                      <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Talla</th>
                      <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Producto</th>
                      <th className="text-right font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Kilos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {termos.map(t => (
                      <tr key={t.TermoId} className="border-b border-gray-100">
                        <td className="py-0.5 px-1 font-mono">{t.NumeroTermo}</td>
                        <td className="py-0.5 px-1">{t.DescripcionTalla}</td>
                        <td className="py-0.5 px-1">{t.DescripcionProceso}</td>
                        <td className="py-0.5 px-1 text-right tabular-nums">{fmtNum(t.Procesado)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-bold border-t-2 border-slate-900">
                      <td className="py-1 px-1" colSpan={3}></td>
                      <td className="py-1 px-1 text-right tabular-nums">{fmtNum(totalPelado)}</td>
                    </tr>
                  </tfoot>
                </table>

                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="border-2 border-slate-900 rounded px-2 py-1.5 text-center">
                    <p className="text-[9px] text-gray-500">Materia Prima Ingresada</p>
                    <p className="text-sm font-bold">{fmtNum(l.PesoIngreso)}</p>
                  </div>
                  <div className="border-2 border-slate-900 rounded px-2 py-1.5 text-center">
                    <p className="text-[9px] text-gray-500">Total Pelado</p>
                    <p className="text-sm font-bold">{fmtNum(totalPelado)}</p>
                  </div>
                  <div className="border-2 border-slate-900 rounded px-2 py-1.5 text-center">
                    <p className="text-[9px] text-gray-500">Rendimiento</p>
                    <p className="text-sm font-bold">{fmtNum(l.Rendimiento, 0)}%</p>
                  </div>
                </div>

                <div className="border border-slate-400 rounded">
                  <p className="text-[9px] font-bold text-gray-500 px-2 pt-1">Notas</p>
                  <p className="px-2 py-1.5 text-[11px] whitespace-pre-wrap min-h-[3rem]">{l.Notas || " "}</p>
                </div>
              </div>
            );
          })
        )}

        {subTab === "eficiencias" && (
          <table className="print-table w-full border-collapse text-[10px] leading-tight">
            <thead>
              <tr>
                <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Id</th>
                <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Nombre</th>
                <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Área</th>
                <th className="text-center font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Fecha</th>
                <th className="text-center font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Hora</th>
                <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Lote</th>
                <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Producto</th>
                <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Talla</th>
                <th className="text-right font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Kilos</th>
              </tr>
            </thead>
            <tbody>
              {(datos.porPersona ?? []).map((p, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="py-0.5 px-1 font-mono">{p.IdEmpleado}</td>
                  <td className="py-0.5 px-1">{p.Nombre}</td>
                  <td className="py-0.5 px-1">{p.Area || "—"}</td>
                  <td className="py-0.5 px-1 text-center tabular-nums">{p.FechaHora?.slice(0, 10)}</td>
                  <td className="py-0.5 px-1 text-center tabular-nums">{p.FechaHora?.slice(11, 16)}</td>
                  <td className="py-0.5 px-1 font-mono">{p.Lote}</td>
                  <td className="py-0.5 px-1">{p.Producto}</td>
                  <td className="py-0.5 px-1">{p.Talla} — {p.DescripcionTalla}</td>
                  <td className="py-0.5 px-1 text-right font-semibold tabular-nums">{fmtNum(p.Kilos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {subTab === "lbhora" && (() => {
          const total = totalLbHora(filasLbHora);
          return (
            <table className="print-table w-full border-collapse text-[11px] leading-tight">
              <thead>
                <tr>
                  <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Id</th>
                  <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Nombre</th>
                  <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Área</th>
                  <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Fecha</th>
                  <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Clase</th>
                  <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Talla</th>
                  <th className="text-right font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Lb</th>
                  <th className="text-right font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Horas</th>
                  <th className="text-right font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Lb/Hora</th>
                  <th className="text-center font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1"># Pesadas</th>
                </tr>
              </thead>
              <tbody>
                {filasLbHora.map(f => (
                  <tr key={`${f.IdEmpleado}-${f.Area}-${f.Fecha}-${f.Talla}-${f.Producto}`} className="border-b border-gray-100">
                    <td className="py-0.5 px-1 font-mono">{f.IdEmpleado}</td>
                    <td className="py-0.5 px-1">{f.Nombre}</td>
                    <td className="py-0.5 px-1">{f.Area || "—"}</td>
                    <td className="py-0.5 px-1">{fechaCorta(f.Fecha)}</td>
                    <td className="py-0.5 px-1">{f.Producto}</td>
                    <td className="py-0.5 px-1">{f.DescripcionTalla}</td>
                    <td className="py-0.5 px-1 text-right tabular-nums">{fmtNum(f.Lb)}</td>
                    <td className="py-0.5 px-1 text-right tabular-nums">{fmtNum(f.Horas)}</td>
                    <td className="py-0.5 px-1 text-right font-semibold tabular-nums">{f.LbPorHora != null ? fmtNum(f.LbPorHora, 1) : "—"}</td>
                    <td className="py-0.5 px-1 text-center tabular-nums">{f.NumPesadas}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold border-t-2 border-slate-900">
                  <td className="py-1 px-1" colSpan={6}>Total General</td>
                  <td className="py-1 px-1 text-right tabular-nums">{fmtNum(total.TotalLb)}</td>
                  <td className="py-1 px-1"></td>
                  <td className="py-1 px-1 text-right tabular-nums">{total.PromedioLbHora != null ? fmtNum(total.PromedioLbHora, 1) : "—"}</td>
                  <td className="py-1 px-1"></td>
                </tr>
              </tfoot>
            </table>
          );
        })()}

        {subTab === "portalla" && (
          <table className="print-table w-full border-collapse text-[11px] leading-tight">
            <thead>
              <tr>
                <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Producto — Talla</th>
                <th className="text-right font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Lb Total</th>
                <th className="text-right font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Lb/Hora Prom.</th>
                <th className="text-center font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1"># Personas</th>
              </tr>
            </thead>
            <tbody>
              {gruposPorTalla.map(g => (
                <tr key={`${g.Producto}-${g.Talla}`} className="border-b border-gray-100">
                  <td className="py-0.5 px-1">{g.Producto} — {g.Talla} ({g.DescripcionTalla}){g.esSecundaria && " (Bajo Volumen)"}</td>
                  <td className="py-0.5 px-1 text-right font-semibold tabular-nums">{fmtNum(g.resumen.TotalLb)}</td>
                  <td className="py-0.5 px-1 text-right tabular-nums">{g.resumen.PromedioLbHora != null ? fmtNum(g.resumen.PromedioLbHora, 1) : "—"}</td>
                  <td className="py-0.5 px-1 text-center tabular-nums">{g.resumen.NumPersonas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {subTab === "lbpersona" && (
          <table className="print-table w-full border-collapse text-[11px] leading-tight">
            <thead>
              <tr>
                <th className="text-center font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Puesto</th>
                <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Id</th>
                <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Nombre</th>
                {areasLbPersona.map(a => (
                  <th key={a.codigo} className="text-right font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">{a.etiqueta} (Lb)</th>
                ))}
                <th className="text-right font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Total (Lb)</th>
              </tr>
            </thead>
            <tbody>
              {filasLbPersona.map(f => (
                <tr key={f.IdEmpleado} className={`border-b border-gray-100 ${FILA_SEMAFORO[f.Semaforo]}`}
                  style={{ WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}>
                  <td className="py-0.5 px-1 text-center tabular-nums">{f.Puesto}</td>
                  <td className="py-0.5 px-1 font-mono">{f.IdEmpleado}</td>
                  <td className="py-0.5 px-1">{f.Nombre}</td>
                  {areasLbPersona.map(a => (
                    <td key={a.codigo} className="py-0.5 px-1 text-right tabular-nums">{f[a.lb] > 0 ? fmtNum(f[a.lb]) : "—"}</td>
                  ))}
                  <td className="py-0.5 px-1 text-right font-semibold tabular-nums">{fmtNum(f.LbTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>,
      document.getElementById("print-root")
    )}
    </>
  );
}
