// Reporte visual de asistencia diaria — pensado para descargarse como imagen
// y enviarse por WhatsApp, no para imprimir.
import { useState } from "react";
import { toPng } from "html-to-image";

// La clasificación se define por LO QUE NO ES DIRECTO, al revés que antes: la lista larga de 35
// códigos "directos" había que ampliarla cada vez que nacía un área, y el área nueva caía callada
// en indirecto hasta que alguien lo notara. Ahora lo que se enumera son las excepciones —que son
// pocas y estables— y todo lo demás es producción (regla del usuario, sep 2026).
//
// Se mezclan dos niveles a propósito porque así es la realidad: Administración y Mantenimiento son
// grupos COMPLETOS de apoyo (RRHH, jefaturas, mantto., sanitización, planta de hielo), mientras que
// Lavandería, Seguridad y Almacén de Empaque son tres áreas sueltas que viven dentro del grupo
// GENERAL junto a cosas que no son apoyo.
const GRUPOS_INDIRECTOS = ["ADMINISTRACION", "MANTENIMIENTO"];
const AREAS_INDIRECTAS = ["BS", "AU", "BL"]; // Lavandería, Seguridad Planta, Almacén Material Empaque

// No es trabajo: la persona está marcada pero fuera de su área. Enfermería, Capacitación, Baño,
// Cafetería, Salida Temporal, Permiso Asunto Personal, Gestiones RRHH y Área General.
//
// TT (ÁREA GENERAL) va aquí y no en directo aunque la regla sea "directo es el resto": es donde cae
// quien no está asignado a ningún área —la única exenta de planificación— así que contarla como
// producción infla el directo con gente que no está produciendo.
const AREAS_TEMPORALES = ["AS", "CA", "TB", "TC", "TM", "TP", "TR", "TT"];

const DIRECTO = "directo", INDIRECTO = "indirecto", TEMPORAL = "temporal";

function clasificar(area) {
  if (AREAS_TEMPORALES.includes(area.CodigoArea)) return TEMPORAL;
  if (AREAS_INDIRECTAS.includes(area.CodigoArea) || GRUPOS_INDIRECTOS.includes(area.Grupo)) return INDIRECTO;
  return DIRECTO;
}

const COLOR_DIRECTO   = "#2563eb";
const COLOR_INDIRECTO = "#f97316";
const COLOR_TEMPORAL  = "#16a34a";

const CONECTORES = new Set(["y", "de", "del", "la", "el", "en", "a"]);
function aTitulo(nombre) {
  return (nombre || "").toLowerCase().split(" ").map((w, i) =>
    i > 0 && CONECTORES.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)
  ).join(" ");
}

function pieSlicePath(cx, cy, r, startPct, endPct) {
  const toXY = pct => {
    const rad = (pct * 360 - 90) * Math.PI / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const [x1, y1] = toXY(startPct);
  const [x2, y2] = toXY(endPct);
  const largeArc = endPct - startPct > 0.5 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
}

function PieChart({ segmentos }) {
  const total = segmentos.reduce((s, seg) => s + seg.valor, 0);
  let acumulado = 0;
  const cx = 90, cy = 90, r = 80;
  return (
    <svg viewBox="0 0 180 180" className="w-full max-w-[220px] mx-auto">
      {total === 0 ? (
        <circle cx={cx} cy={cy} r={r} fill="#e5e7eb" />
      ) : segmentos.filter(seg => seg.valor > 0).map(seg => {
        const start = acumulado;
        const pct = seg.valor / total;
        acumulado += pct;
        const path = pct >= 0.999
          ? null
          : pieSlicePath(cx, cy, r, start, acumulado);
        const labelAngle = (start + acumulado) / 2 * 360 - 90;
        const labelRad = labelAngle * Math.PI / 180;
        const lx = cx + r * 0.62 * Math.cos(labelRad);
        const ly = cy + r * 0.62 * Math.sin(labelRad);
        return (
          <g key={seg.nombre}>
            {path
              ? <path d={path} fill={seg.color} />
              : <circle cx={cx} cy={cy} r={r} fill={seg.color} />}
            {pct >= 0.04 && (
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
                className="fill-white font-bold" style={{ fontSize: 11 }}>
                {(pct * 100).toFixed(1)}%
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function BarChart({ items }) {
  const max = Math.max(1, ...items.map(i => i.valor));
  return (
    <div className="space-y-1.5">
      {items.map(i => (
        <div key={i.nombre} className="flex items-center gap-2">
          <span className="w-28 shrink-0 text-[11px] text-slate-600 truncate text-right">{i.nombre}</span>
          <div className="flex-1 bg-slate-100 rounded h-4 overflow-hidden">
            <div className="h-full rounded bg-blue-600" style={{ width: `${(i.valor / max) * 100}%` }} />
          </div>
          <span className="w-6 shrink-0 text-[11px] font-bold text-slate-700 tabular-nums">{i.valor}</span>
        </div>
      ))}
    </div>
  );
}

function TablaAreas({ titulo, filas, total, colorClass }) {
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 bg-slate-50 border-b border-gray-200">
        <h3 className={`text-sm font-bold ${colorClass}`}>{titulo}</h3>
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-gray-400">
            <th className="text-left font-semibold px-4 pt-2.5 pb-1">Grupo</th>
            <th className="text-right font-semibold px-4 pt-2.5 pb-1 w-16">Esc.</th>
          </tr>
        </thead>
        <tbody>
          {filas.length === 0 && (
            <tr><td colSpan={2} className="px-4 py-4 text-center text-gray-400 text-xs">Sin registros</td></tr>
          )}
          {filas.map(f => (
            <tr key={f.nombre} className="border-t border-gray-100">
              <td className="px-4 py-1 text-slate-700">{f.nombre}</td>
              <td className="px-4 py-1 text-right font-semibold text-slate-800 tabular-nums">{f.valor}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-800">
            <td className="px-4 py-2 font-bold text-slate-900">Total</td>
            <td className="px-4 py-2 text-right font-bold text-slate-900 tabular-nums">{total}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default function AsistenciaDiariaModal({ areas, fecha, onClose }) {
  const conEscaneo = areas.filter(a => (a.ocupacion ?? 0) > 0);
  const temporales = conEscaneo.filter(a => clasificar(a) === TEMPORAL);
  const indirectas = conEscaneo.filter(a => clasificar(a) === INDIRECTO);
  const directas   = conEscaneo.filter(a => clasificar(a) === DIRECTO);

  const sumaOcup = list => list.reduce((s, a) => s + a.ocupacion, 0);
  const totalDirecto   = sumaOcup(directas);
  const totalIndirecto = sumaOcup(indirectas);
  const totalTemporal  = sumaOcup(temporales);
  const totalGeneral   = totalDirecto + totalIndirecto + totalTemporal;
  const pct = n => totalGeneral === 0 ? "0.0" : ((n / totalGeneral) * 100).toFixed(1);

  // Un grupo "mixto" es el que no cae entero en un solo bloque — hoy solo GENERAL, que reparte sus
  // áreas entre los tres. Sus áreas se listan una por una: poner "General" en las tres tablas con
  // tres cifras distintas no dice nada, mientras que "Lavandería" y "Baño" sí.
  //
  // Se calcula sobre TODAS las áreas, no sobre las escaneadas del día: si dependiera del día, un
  // lunes en que solo marcó Lavandería el grupo se vería puro y saldría rotulado "General".
  const bloquesPorGrupo = new Map();
  for (const a of areas) {
    if (!a.Grupo) continue;
    if (!bloquesPorGrupo.has(a.Grupo)) bloquesPorGrupo.set(a.Grupo, new Set());
    bloquesPorGrupo.get(a.Grupo).add(clasificar(a));
  }
  const esMixto = grupo => (bloquesPorGrupo.get(grupo)?.size ?? 0) > 1;
  const etiqueta = a => aTitulo(!a.Grupo || esMixto(a.Grupo) ? a.Nombre : a.Grupo);

  // Suma por etiqueta: las 5 áreas de Clasificado Cola se leen como una línea, que es el punto de
  // haber agrupado. Dentro de cada bloque, no entre bloques.
  const porGrupo = (lista) => {
    const acum = new Map();
    for (const a of lista) {
      const nombre = etiqueta(a);
      acum.set(nombre, (acum.get(nombre) ?? 0) + a.ocupacion);
    }
    return [...acum].map(([nombre, valor]) => ({ nombre, valor })).sort((x, y) => y.valor - x.valor);
  };

  const filasDirecto   = porGrupo(directas);
  const filasIndirecto = porGrupo(indirectas);
  const filasTemporal  = porGrupo(temporales);

  const topAreas = porGrupo(conEscaneo).slice(0, 8);

  const fechaLarga = new Date(`${fecha}T00:00:00`).toLocaleDateString("es-GT", { day: "2-digit", month: "2-digit", year: "numeric" });
  const [generadoEn] = useState(() =>
    new Date().toLocaleString("sv-SE", { timeZone: "America/Guatemala", hour12: false }).slice(0, 16)
  );

  const [descargando, setDescargando] = useState(false);
  const descargarImagen = async () => {
    const el = document.getElementById("reporte-asistencia-diaria");
    if (!el) return;
    setDescargando(true);
    try {
      const dataUrl = await toPng(el, { pixelRatio: 2, backgroundColor: "#ffffff" });
      const link = document.createElement("a");
      link.download = `asistencia-diaria-${fecha}.png`;
      link.href = dataUrl;
      link.click();
    } finally {
      setDescargando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[92vh] flex flex-col">
        <div className="px-5 py-3 border-b flex items-center justify-between shrink-0">
          <h2 className="text-sm font-semibold text-gray-700">Asistencia diaria — vista para compartir</h2>
          <div className="flex items-center gap-2">
            <button onClick={descargarImagen} disabled={descargando}
              className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition disabled:opacity-60">
              {descargando
                ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                )}
              {descargando ? "Generando..." : "Descargar imagen"}
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-5">
          <div id="reporte-asistencia-diaria" className="bg-white rounded-2xl overflow-hidden border border-gray-200">
            {/* Encabezado */}
            <div className="bg-slate-900 px-6 py-4 flex items-center justify-between">
              <h1 className="text-xl font-extrabold text-white uppercase tracking-wide">Reporte de Asistencia Diaria</h1>
              <div className="text-right">
                <p className="text-lg font-bold text-white tabular-nums leading-tight">{fechaLarga}</p>
                <p className="text-[11px] text-slate-400 font-mono">impreso {generadoEn}</p>
              </div>
            </div>

            <div className="p-6">
              {/* Tarjetas */}
              <div className="grid grid-cols-4 gap-3 mb-6">
                <div className="bg-slate-50 border border-gray-200 rounded-xl px-4 py-3">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Total registrados</p>
                  <p className="text-2xl font-black text-slate-900 leading-tight">{totalGeneral} <span className="text-xs font-normal text-gray-400">escaneados</span></p>
                </div>
                <div className="bg-slate-50 border border-gray-200 rounded-xl px-4 py-3">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Directo producción</p>
                  <p className="text-2xl font-black leading-tight" style={{ color: COLOR_DIRECTO }}>{totalDirecto} <span className="text-xs font-normal text-gray-400">{pct(totalDirecto)}%</span></p>
                </div>
                <div className="bg-slate-50 border border-gray-200 rounded-xl px-4 py-3">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Indirecto / apoyo</p>
                  <p className="text-2xl font-black leading-tight" style={{ color: COLOR_INDIRECTO }}>{totalIndirecto} <span className="text-xs font-normal text-gray-400">{pct(totalIndirecto)}%</span></p>
                </div>
                <div className="bg-slate-50 border border-gray-200 rounded-xl px-4 py-3">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Actividad temporal</p>
                  <p className="text-2xl font-black leading-tight" style={{ color: COLOR_TEMPORAL }}>{totalTemporal} <span className="text-xs font-normal text-gray-400">{pct(totalTemporal)}%</span></p>
                </div>
              </div>

              {/* Gráficos */}
              <div className="grid grid-cols-2 gap-6 mb-6">
                <div>
                  <h3 className="text-sm font-bold text-slate-800 mb-2">Distribución de escaneados</h3>
                  <PieChart segmentos={[
                    { nombre: "Directo",   valor: totalDirecto,   color: COLOR_DIRECTO },
                    { nombre: "Indirecto", valor: totalIndirecto, color: COLOR_INDIRECTO },
                    { nombre: "Actividad temporal", valor: totalTemporal, color: COLOR_TEMPORAL },
                  ]} />
                  <div className="flex justify-center gap-4 mt-2">
                    <span className="flex items-center gap-1.5 text-[11px] text-slate-600"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: COLOR_DIRECTO }} />Directo</span>
                    <span className="flex items-center gap-1.5 text-[11px] text-slate-600"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: COLOR_INDIRECTO }} />Indirecto</span>
                    <span className="flex items-center gap-1.5 text-[11px] text-slate-600"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: COLOR_TEMPORAL }} />Actividad temporal</span>
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800 mb-2">Grupos con mayor escaneado</h3>
                  {topAreas.length === 0
                    ? <p className="text-xs text-gray-400 text-center py-8">Sin escaneados hoy</p>
                    : <BarChart items={topAreas} />}
                </div>
              </div>

              {/* Tablas */}
              <div className="grid grid-cols-3 gap-6">
                <TablaAreas titulo="Personal directo de producción" filas={filasDirecto} total={totalDirecto}
                  colorClass="text-blue-700" />
                <TablaAreas titulo="Personal indirecto / apoyo" filas={filasIndirecto} total={totalIndirecto}
                  colorClass="text-orange-600" />
                <TablaAreas titulo="Actividad temporal" filas={filasTemporal} total={totalTemporal}
                  colorClass="text-green-700" />
              </div>

              {/* Pie */}
              <div className="mt-5 bg-slate-50 border border-gray-200 rounded-xl px-4 py-2.5">
                <p className="text-[11px] text-gray-500">
                  Criterio aplicado: se toma la cantidad de personas actualmente registradas (escaneadas) por área. Áreas con escaneado 0 no se cuentan.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
