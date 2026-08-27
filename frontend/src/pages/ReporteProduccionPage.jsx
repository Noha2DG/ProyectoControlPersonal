import { useState, useEffect, useCallback, Fragment } from "react";
import { createPortal } from "react-dom";
import { authHeader } from "../context/AuthContext.jsx";
import { exportarReporteGeneral, exportarReporteTermos, exportarEficiencias, exportarLbHora, exportarLbHoraPorTalla, exportarLbPorPersona } from "../utils/exportExcel.js";
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
const LBHORA_COL_DEFAULTS = { id: 100, nombre: 150, area: 110, lb: 90, horas: 90, lbhora: 90, pesadas: 90 };
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
  const anchoLbPersona = 16 + LBPERSONA_COLS.reduce((s, k) => s + (widthsLbPersona[k] ?? LBPERSONA_COL_DEFAULTS[k] ?? 0), 0);

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

  const pausasNoPaga = reporte?.pausasNoPaga ?? [];
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
  const filasLbPersona = calcularLbPorPersona(reporte?.porPersona ?? []);
  // Acá sí cuadra sumar columna por columna: calcularLbPorPersona define LbTotal como la suma de
  // las áreas de destajo, y cada persona aparece en una sola fila (agrupada por IdEmpleado), así
  // que el total de la columna Total es también la suma de los tres totales de área.
  const totalLbPersona = {
    ...Object.fromEntries(AREAS_DESTAJO.map(a => [a.lb, filasLbPersona.reduce((t, f) => t + f[a.lb], 0)])),
    LbTotal: filasLbPersona.reduce((t, f) => t + f.LbTotal, 0),
    Personas: filasLbPersona.length,
  };


  // El % de Talla se ordena por Procesado: es proporcional, y así no depende del redondeo.
  const tallasOrdenadas = ordenarFilas(tallasMostradas, ordenTallaGen, {
    talla: t => t.Talla, kg: t => t.Procesado, pct: t => t.Procesado,
  });
  const lbHoraOrdenadas = ordenarFilas(filasLbHora, ordenLbHora, {
    id: f => f.IdEmpleado, nombre: f => f.Nombre, area: f => f.Area,
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
  const pesajes = reporte?.porPersona ?? [];
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

  const nombreFincaSeleccionada = fincas.find(f => f.Codigo === finca)?.Descripcion;
  const rangoFechasTexto = desde === hasta ? fechaCorta(desde) : `${fechaCorta(desde)} — ${fechaCorta(hasta)}`;
  const impresoEn = new Date().toLocaleString("sv-SE", { timeZone: "America/Guatemala", hour12: false }).slice(0, 16);

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
                <p className="text-base font-bold text-gray-800">{fmtNum(reporte.totales.PesoIngreso)} kg</p>
              </div>
              <div className="bg-white rounded-lg shadow px-3 py-2 text-center">
                <p className="text-xs text-gray-400">Procesado</p>
                <p className="text-base font-bold text-blue-700">{fmtNum(reporte.totales.Procesado)} kg</p>
              </div>
              <div className="bg-white rounded-lg shadow px-3 py-2 text-center">
                <p className="text-xs text-gray-400">Pendiente</p>
                <p className="text-base font-bold text-amber-600">{fmtNum(reporte.totales.Pendiente)} kg</p>
              </div>
              <div className="bg-white rounded-lg shadow px-3 py-2 text-center">
                <p className="text-xs text-gray-400">Rendimiento</p>
                <p className="text-base font-bold text-gray-700">{fmtNum(reporte.totales.Rendimiento, 1)}%</p>
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
                      {reporte.porLote.length === 0 && (
                        <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">Sin lotes en este rango de fechas</td></tr>
                      )}
                    </tbody>
                    {reporte.porLote.length > 0 && (
                      <tfoot>
                        <tr className="bg-gray-200 font-bold border-t-2 border-gray-300">
                          <td className="px-3 py-2.5" colSpan={5}>Total General</td>
                          <td className="px-3 py-2.5 text-right text-gray-900">{fmtNum(reporte.totales.PesoIngreso)}</td>
                          <td className="px-3 py-2.5 text-right text-blue-800">{fmtNum(reporte.totales.Procesado)}</td>
                          <td className="px-3 py-2.5 text-right text-amber-700">{fmtNum(reporte.totales.Pendiente)}</td>
                          <td className="px-3 py-2.5 text-right text-gray-800">{fmtNum(reporte.totales.Rendimiento, 1)}%</td>
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
                    {(reporte.porTermo ?? []).length === 0 && (
                      <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-400">Sin datos en este rango de fechas</td></tr>
                    )}
                  </tbody>
                  {(reporte.porTermo ?? []).length > 0 && (
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
              </p>
              <div className="bg-white rounded-lg shadow overflow-hidden overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-xs table-fixed">
                  <Colgroup columns={LBHORA_COLS} widths={widthsLbHora} />
                  <thead>
                    <tr className="bg-gray-100 text-gray-600 uppercase text-[10px] tracking-wider">
                      <Th width={widthsLbHora.id} onResizeStart={startResizeLbHora("id")} sortKey="id" orden={ordenLbHora} onOrdenar={alternarOrdenLbHora} className="px-2 py-1.5 text-left whitespace-nowrap">Id Empleado</Th>
                      <Th width={widthsLbHora.nombre} onResizeStart={startResizeLbHora("nombre")} sortKey="nombre" orden={ordenLbHora} onOrdenar={alternarOrdenLbHora} className="px-2 py-1.5 text-left">Nombre</Th>
                      <Th width={widthsLbHora.area} onResizeStart={startResizeLbHora("area")} sortKey="area" orden={ordenLbHora} onOrdenar={alternarOrdenLbHora} className="px-2 py-1.5 text-left whitespace-nowrap">Área</Th>
                      <Th width={widthsLbHora.lb} onResizeStart={startResizeLbHora("lb")} sortKey="lb" orden={ordenLbHora} onOrdenar={alternarOrdenLbHora} className="px-2 py-1.5 text-right whitespace-nowrap">Lb</Th>
                      <Th width={widthsLbHora.horas} onResizeStart={startResizeLbHora("horas")} sortKey="horas" orden={ordenLbHora} onOrdenar={alternarOrdenLbHora} className="px-2 py-1.5 text-right whitespace-nowrap">Horas</Th>
                      <Th width={widthsLbHora.lbhora} onResizeStart={startResizeLbHora("lbhora")} sortKey="lbhora" orden={ordenLbHora} onOrdenar={alternarOrdenLbHora} className="px-2 py-1.5 text-right whitespace-nowrap">Lb/Hora</Th>
                      <Th width={widthsLbHora.pesadas} onResizeStart={startResizeLbHora("pesadas")} sortKey="pesadas" orden={ordenLbHora} onOrdenar={alternarOrdenLbHora} className="px-2 py-1.5 text-center whitespace-nowrap"># Pesadas</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {lbHoraOrdenadas.map(f => (
                      <tr key={`${f.IdEmpleado}-${f.Area}`} className="hover:bg-gray-50 transition">
                        <td className="px-2 py-1.5 font-mono text-gray-700 whitespace-nowrap">{f.IdEmpleado}</td>
                        <td className="px-2 py-1.5 text-gray-700"><div className="max-w-[9rem] truncate" title={f.Nombre}>{f.Nombre}</div></td>
                        <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">{f.Area || <span className="text-gray-300">—</span>}</td>
                        <td className="px-2 py-1.5 text-right text-gray-700 whitespace-nowrap">{fmtNum(f.Lb)}</td>
                        <td className="px-2 py-1.5 text-right text-gray-500 whitespace-nowrap">{fmtNum(f.Horas)}</td>
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
                Libras por Persona — {AREAS_DESTAJO.map(a => a.etiqueta).join(", ")}
              </h3>
              <p className="text-xs text-gray-400 mb-2">
                Libras acumuladas por persona en cada área (sin tasa ni horas), ordenado de mayor a menor por el total de todas.
                {" "}Semáforo por tercios de posición en el ranking: <span className="px-1.5 py-0.5 rounded bg-green-50 border border-green-200">verde</span> = tercio superior,
                {" "}<span className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200">amarillo</span> = tercio medio,
                {" "}<span className="px-1.5 py-0.5 rounded bg-red-50 border border-red-200">rojo</span> = tercio inferior — no un monto fijo de libras, para no tener que ajustarlo cada día según el volumen.
              </p>
              <div className="bg-white rounded-lg shadow overflow-hidden overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-xs table-fixed">
                  <Colgroup columns={LBPERSONA_COLS} widths={widthsLbPersona} />
                  <thead>
                    <tr className="bg-gray-100 text-gray-600 uppercase text-[10px] tracking-wider">
                      <Th width={widthsLbPersona.puesto} onResizeStart={startResizeLbPersona("puesto")} sortKey="puesto" orden={ordenLbPersona} onOrdenar={alternarOrdenLbPersona} className="px-2 py-1.5 text-center whitespace-nowrap">Puesto</Th>
                      <Th width={widthsLbPersona.id} onResizeStart={startResizeLbPersona("id")} sortKey="id" orden={ordenLbPersona} onOrdenar={alternarOrdenLbPersona} className="px-2 py-1.5 text-left whitespace-nowrap">Id Empleado</Th>
                      <Th width={widthsLbPersona.nombre} onResizeStart={startResizeLbPersona("nombre")} sortKey="nombre" orden={ordenLbPersona} onOrdenar={alternarOrdenLbPersona} className="px-2 py-1.5 text-left">Nombre</Th>
                      {AREAS_DESTAJO.map(a => (
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
                        {AREAS_DESTAJO.map(a => (
                          <td key={a.codigo} className="px-2 py-1.5 text-right text-gray-700 whitespace-nowrap">
                            {f[a.lb] > 0 ? fmtNum(f[a.lb]) : <span className="text-gray-300">—</span>}
                          </td>
                        ))}
                        <td className="px-2 py-1.5 text-right font-semibold text-blue-700 whitespace-nowrap">{fmtNum(f.LbTotal)}</td>
                      </tr>
                    ))}
                    {filasLbPersona.length === 0 && (
                      <tr><td colSpan={LBPERSONA_COLS.length} className="px-3 py-6 text-center text-gray-400">Sin datos en este rango de fechas</td></tr>
                    )}
                  </tbody>
                  {filasLbPersona.length > 0 && (
                    <tfoot>
                      <tr className="bg-gray-200 font-bold border-t-2 border-gray-300">
                        <td className="px-2 py-1.5 whitespace-nowrap" colSpan={3}>
                          Total General <span className="font-normal text-gray-500">· {totalLbPersona.Personas} persona{totalLbPersona.Personas !== 1 ? "s" : ""}</span>
                        </td>
                        {AREAS_DESTAJO.map(a => (
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
              <h1 className="text-xl font-extrabold uppercase text-slate-900 tracking-tight">Destajo — {tituloSubTab}</h1>
              <p className="text-[10px] text-gray-500 mt-0.5">
                {rangoFechasTexto}
                {finca && <> · Finca <span className="font-mono font-bold text-blue-700">{finca}</span>{nombreFincaSeleccionada && <> — {nombreFincaSeleccionada}</>}</>}
                {areaLbHora && SUB_TABS_CON_AREA.includes(subTab) && <> · Área <span className="font-mono font-bold text-blue-700">{areaLbHora}</span></>}
              </p>
            </div>
          </div>
          <p className="text-[10px] text-gray-400 font-mono mt-0.5">impreso {impresoEn}</p>
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
                {(reporte.porLote ?? []).map(l => (
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
                  <td className="py-1 px-1 text-right tabular-nums">{fmtNum(reporte.totales.PesoIngreso)}</td>
                  <td className="py-1 px-1 text-right tabular-nums">{fmtNum(reporte.totales.Procesado)}</td>
                  <td className="py-1 px-1 text-right tabular-nums">{fmtNum(reporte.totales.Pendiente)}</td>
                  <td className="py-1 px-1 text-right tabular-nums">{fmtNum(reporte.totales.Rendimiento, 1)}%</td>
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
              {(reporte.porPersona ?? []).map((p, i) => (
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
                  <th className="text-right font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Lb</th>
                  <th className="text-right font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Horas</th>
                  <th className="text-right font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Lb/Hora</th>
                  <th className="text-center font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1"># Pesadas</th>
                </tr>
              </thead>
              <tbody>
                {filasLbHora.map(f => (
                  <tr key={`${f.IdEmpleado}-${f.Area}`} className="border-b border-gray-100">
                    <td className="py-0.5 px-1 font-mono">{f.IdEmpleado}</td>
                    <td className="py-0.5 px-1">{f.Nombre}</td>
                    <td className="py-0.5 px-1">{f.Area || "—"}</td>
                    <td className="py-0.5 px-1 text-right tabular-nums">{fmtNum(f.Lb)}</td>
                    <td className="py-0.5 px-1 text-right tabular-nums">{fmtNum(f.Horas)}</td>
                    <td className="py-0.5 px-1 text-right font-semibold tabular-nums">{f.LbPorHora != null ? fmtNum(f.LbPorHora, 1) : "—"}</td>
                    <td className="py-0.5 px-1 text-center tabular-nums">{f.NumPesadas}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold border-t-2 border-slate-900">
                  <td className="py-1 px-1" colSpan={3}>Total General</td>
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
                {AREAS_DESTAJO.map(a => (
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
                  {AREAS_DESTAJO.map(a => (
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
