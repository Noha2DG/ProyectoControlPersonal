import { fmtNum } from "../utils/numero.js";
import { LB_POR_KG, calcularLbHora, agruparPorArea } from "../utils/destajo.js";
import { metaDeArea, estadoMeta, COLOR_META } from "../utils/mesas.js";
import { VsMeta } from "./MesaDetalle.jsx";

// Números del día arriba de las tarjetas de Destajo → Por Mesa: libras totales, Lb/hr por proceso,
// libras y personas por proceso, y tallas del día. Cifras sueltas, no gráficas. Sin comparar mesas
// entre sí ni Lb/hr entre días: la talla no deja evaluar (decisión del usuario, 7 oct 2026).
// Solo Pelado y Descabezado, los mismos datos de las tarjetas (GET /api/mesas/hoy).
const PELADO = "PELADO Y DEVENADO", DESCABEZADO = "DESCABEZADO";

export default function ResumenMesasDia({ datos, mesas }) {
  if (!datos) return null;

  const libras = mesas.reduce((s, m) => s + m.LbTotal, 0);

  // Libras y personas por proceso (el área de cada pesada es la transferencia vigente en ese
  // momento). Las pesadas sin área (sin marcaje) van aparte para que la suma cuadre con el total.
  const areas = { [PELADO]: { lb: 0, gente: new Set() }, [DESCABEZADO]: { lb: 0, gente: new Set() }, otra: { lb: 0, gente: new Set() } };
  for (const p of datos.pesadas ?? []) {
    const a = areas[p.Area] ?? areas.otra;
    a.lb += p.Kilos * LB_POR_KG; a.gente.add(p.IdEmpleado);
  }

  // Lb/hr por proceso con la misma calcularLbHora del Reporte: Σ libra válida ÷ Σ hora válida de cada
  // área (ponderada, no promedio de tasas).
  const ritmo = { [PELADO]: { lb: 0, h: 0 }, [DESCABEZADO]: { lb: 0, h: 0 } };
  for (const f of calcularLbHora(datos.pesadas ?? [], agruparPorArea, datos.pausas ?? [])) {
    const r = ritmo[f.Area];
    if (r && f.Horas > 0) { r.lb += f.Lb; r.h += f.Horas; }
  }
  const tasa = r => (r.h > 0 ? r.lb / r.h : null);

  // Aviso de meta por proceso: Pelado (tarifas PD_TON/PD_TOFF) y Descabezado (DESC_, desde el 14 oct
  // 2026). Mismo cálculo de la vista de mesa: libras acumuladas contra las esperadas por el tiempo
  // marcado en esa área. Sin tarifa aprobada no sale la pastilla.
  const metaPelado = metaDeArea(datos, "DS", PELADO);
  const metaDescabezado = metaDeArea(datos, "DU", DESCABEZADO);

  // Tallas por CÓDIGO (hay descripciones repetidas entre las dos escalas), de grande a chica.
  const tallas = new Map();
  for (const p of datos.pesadas ?? []) if (p.Talla != null) tallas.set(p.Talla, p.DescripcionTalla);
  const listaTallas = [...tallas.entries()]
    .sort((a, b) => (parseInt(a[1]) || 9999) - (parseInt(b[1]) || 9999) || a[0] - b[0])
    .map(([, d]) => d);

  return (
    <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(220px,1fr))] mb-4">
      <Cuadro titulo="Libras totales hoy">
        <p className="mt-2"><span className="text-4xl font-bold text-gray-900">{fmtNum(libras, 0)}</span><span className="text-sm text-gray-500"> lb</span></p>
      </Cuadro>
      <Cuadro titulo="Lb/hr por proceso">
        <Linea nombre="Pelado" valor={fmtNum(tasa(ritmo[PELADO]), 1)} unidad="lb/hr" />
        <Linea nombre="Descabezado" valor={fmtNum(tasa(ritmo[DESCABEZADO]), 1)} unidad="lb/hr" />
      </Cuadro>
      <Cuadro titulo="Libras por proceso">
        {/* Meta en la MISMA línea (pastilla antes de las libras) para no agrandar el cuadro; el detalle va en el title */}
        <Linea nombre="Pelado" extra={`${areas[PELADO].gente.size} pers.`} valor={fmtNum(areas[PELADO].lb, 0)} unidad="lb"
          antes={<PastillaMeta meta={metaPelado} />} />
        <Linea nombre="Descabezado" extra={`${areas[DESCABEZADO].gente.size} pers.`} valor={fmtNum(areas[DESCABEZADO].lb, 0)} unidad="lb"
          antes={<PastillaMeta meta={metaDescabezado} />} />
        {areas.otra.lb > 0.05 && <p className="text-xs text-gray-500 mt-1">+ {fmtNum(areas.otra.lb, 0)} lb sin área (sin marcaje)</p>}
      </Cuadro>
      <Cuadro titulo="Tallas hoy" junto={<span className="text-lg font-bold text-gray-900">{listaTallas.length}</span>}>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {listaTallas.length ? listaTallas.map(t => (
            <span key={t} className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-white/80 border border-[#b9ddd3] text-gray-700">{t}</span>
          )) : <span className="text-xs text-gray-500">Aún no hay pesadas</span>}
        </div>
      </Cuadro>
    </div>
  );
}

// Cuadro del resumen: fondo gris claro con doble borde verde (anillo exterior + línea interior) y
// el título en una pastilla menta. Solo estos cuatro cuadros; las tarjetas de mesa llevan su estilo.
function Cuadro({ titulo, junto, children }) {
  return (
    <div className="rounded-2xl border-2 border-[#5fbf8a] bg-white p-[3px] min-w-0">
      <div className="h-full rounded-xl border border-[#a8dcbc] bg-gradient-to-br from-white to-gray-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 rounded-full bg-[#e3f6ea] border border-[#a5dcb9] text-[11px] font-bold uppercase tracking-wider text-[#14532d]">{titulo}</span>
          {junto}
        </div>
        {children}
      </div>
    </div>
  );
}

// % contra la meta del proceso, en la misma línea de sus libras (no agranda el cuadro).
function PastillaMeta({ meta }) {
  if (meta?.VsMeta == null) return null;
  return (
    <span title={`${meta.VsMeta >= 0 ? "Sobre" : "Bajo"} la meta ${fmtNum(meta.LbMeta, 0)} `}
      className={`mr-2 px-1.5 py-0.5 rounded-md border text-xs align-middle ${COLOR_META[estadoMeta(meta.VsMeta)].fondo}`}>
      <VsMeta valor={meta.VsMeta} />
      {/* Según el ancho: angosto solo el %, mediano "+6% meta", ancho "+6% · meta 10,350 lb" */}
      <span className="hidden xl:inline 2xl:hidden text-gray-500 font-normal"> meta</span>
      <span className="hidden 2xl:inline text-gray-600 font-normal"> · meta <span className="tabular-nums font-semibold text-gray-800">{fmtNum(meta.LbMeta, 0)}</span> lb</span>
    </span>
  );
}

function Linea({ nombre, extra, valor, unidad, antes }) {
  return (
    <div className="flex items-baseline justify-between gap-2 mt-3">
      <span className="text-sm text-gray-800 whitespace-nowrap">{nombre}{extra && <span className="text-xs text-gray-500"> · {extra}</span>}</span>
      <span className="tabular-nums whitespace-nowrap">{antes}<span className="text-xl font-bold text-gray-900">{valor}</span><span className="text-xs text-gray-500"> {unidad}</span></span>
    </div>
  );
}
