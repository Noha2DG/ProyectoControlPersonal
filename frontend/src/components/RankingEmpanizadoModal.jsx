import { useEffect } from "react";
import { createPortal } from "react-dom";

// Ranking de Empanizado por bandejas acumuladas, para imprimir o guardar como PDF (usuario, 26 nov 2026:
// "descargar ese ranking en un pdf, para no generar otro reporte"). No pide nada al servidor: imprime la
// misma lista que el reporte "Producción por persona", ordenada por bandejas y, con las mismas bandejas,
// por libras. "Imprimir / PDF" usa el diálogo del navegador, igual que InventarioPisoModal.
// Diseño (usuario, 26 nov 2026: "ponle diseño al pdf"): franja ámbar de Empanizado, totales, podio de los
// tres primeros (oro, plata y bronce) y la tabla con filas alternadas.

const META_LBH = 4; // igual que la tabla del reporte: menos de 4 en rojo, de 4 para arriba en verde
const num = (n, d = 2) => (n == null ? "—" : Number(n).toLocaleString("es-GT", { minimumFractionDigits: d, maximumFractionDigits: d }));
const titulo = s => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase().replace(/(^|\s)\p{L}/gu, c => c.toUpperCase());
function fmtDia(iso) {
  if (!iso) return "—";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}
const exacto = { printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" };

// Medallas del podio: oro, plata y bronce (solo para los tres primeros).
const MEDALLA = {
  1: { aro: "#D97706", fondo: "#FFFBEB", borde: "#F59E0B", txt: "Primer lugar" },
  2: { aro: "#78716C", fondo: "#F5F5F4", borde: "#A8A29E", txt: "Segundo lugar" },
  3: { aro: "#9A3412", fondo: "#FFF7ED", borde: "#FDBA74", txt: "Tercer lugar" },
};
// Se compara el número ya redondeado a 2 decimales: 3.998 se ve "4.00" y sale verde.
const bajoMeta = v => Math.round(v * 100) / 100 < META_LBH;
const colorLbH = v => (v == null ? "#a8a29e" : bajoMeta(v) ? "#b91c1c" : "#047857");
const fondoLbH = v => (v == null ? "transparent" : bajoMeta(v) ? "#FEF2F2" : "#ECFDF5");

function Podio({ p }) {
  const m = MEDALLA[p.Puesto];
  const primero = p.Puesto === 1;
  return (
    <div className="rounded-xl border-2 px-3 text-center flex flex-col items-center"
      style={{ background: m.fondo, borderColor: m.borde, paddingTop: primero ? 14 : 10, paddingBottom: primero ? 14 : 10, marginTop: primero ? 0 : 14 }}>
      <div className="rounded-full text-white font-black flex items-center justify-center"
        style={{ background: m.aro, width: primero ? 40 : 32, height: primero ? 40 : 32, fontSize: primero ? 20 : 16 }}>{p.Puesto}</div>
      <p className="mt-1 text-[9px] uppercase tracking-[0.18em] font-semibold text-stone-500">{m.txt}</p>
      <p className={`mt-1 font-bold leading-tight text-stone-900 ${primero ? "text-[15px]" : "text-[13px]"}`}>{titulo(p.Nombre)}</p>
      <p className="text-[10px] text-stone-500 font-mono">{p.Codigo} · {p.MesaNombre ?? "sin posición"}{p.Posicion != null ? ` #${p.Posicion}` : ""}</p>
      <p className={`mt-1.5 font-black tabular-nums leading-none text-stone-900 ${primero ? "text-[30px]" : "text-[24px]"}`}>{p.Bandejas.toLocaleString("es-GT")}</p>
      <p className="text-[10px] uppercase tracking-wider text-stone-500">bandejas</p>
      <p className="mt-1 text-[11px] text-stone-700 tabular-nums">
        {num(p.Lb)} lb · <b style={{ color: colorLbH(p.LbHora) }}>{num(p.LbHora)} lb/h</b>
      </p>
    </div>
  );
}

export function ContenidoRankingEmpanizado({ lista, desde, hasta, totales, marca = "Empanizado" }) {
  const periodo = desde === hasta ? fmtDia(desde) : `${fmtDia(desde)} al ${fmtDia(hasta)}`;
  const top = lista.slice(0, 3);
  // Orden del podio en la hoja: 2.º, 1.º, 3.º (el primero al centro y más alto).
  const podio = top.length === 3 ? [top[1], top[0], top[2]] : top;
  return (
    // print-color-adjust se hereda: los fondos y colores de toda la hoja se imprimen tal cual.
    <div className="text-stone-900" style={exacto}>
      {/* Encabezado: franja ámbar con el título; a la derecha, el período. */}
      <div className="flex items-stretch justify-between rounded-xl overflow-hidden mb-3" style={{ background: "#D97706" }}>
        <div className="px-5 py-3 text-white">
          <p className="text-[10px] uppercase tracking-[0.25em] font-semibold" style={{ color: "#FEF3C7" }}>{marca} · producción por persona</p>
          <h1 className="text-[26px] font-black leading-tight">Ranking de bandejas</h1>
        </div>
        <div className="px-5 py-3 text-right flex flex-col justify-center" style={{ background: "#B45309", color: "#FFFBEB" }}>
          <p className="text-[10px] uppercase tracking-[0.2em] font-semibold" style={{ color: "#FDE68A" }}>{desde === hasta ? "Día" : "Período"}</p>
          <p className="text-lg font-bold tabular-nums leading-tight">{periodo}</p>
        </div>
      </div>

      {/* Totales compactos; la ponderada resaltada, como en la pantalla. */}
      <div className="grid grid-cols-4 gap-2 mb-4 text-center">
        {[["Personas", totales.personas.toLocaleString("es-GT")], ["Bandejas", totales.bandejas.toLocaleString("es-GT")], ["Libras", num(totales.lb)]].map(([t, v]) => (
          <div key={t} className="rounded-lg border border-stone-200 py-1.5" style={{ borderLeft: "4px solid #FDE68A" }}>
            <p className="text-[9px] uppercase tracking-[0.18em] font-semibold text-stone-500">{t}</p>
            <p className="text-base font-bold tabular-nums">{v}</p>
          </div>
        ))}
        <div className="rounded-lg py-1.5 text-white" style={{ background: "#D97706" }}>
          <p className="text-[9px] uppercase tracking-[0.18em] font-semibold" style={{ color: "#FEF3C7" }}>Lb/hora ponderada</p>
          <p className="text-base font-black tabular-nums">{num(totales.ponderada)}</p>
        </div>
      </div>

      {/* Podio de los tres primeros. */}
      {podio.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-5 items-start" style={{ breakInside: "avoid" }}>
          {podio.map(p => <Podio key={p.Codigo} p={p} />)}
        </div>
      )}

      <table className="w-full text-[11px] print-table border-collapse">
        <thead>
          <tr className="text-left text-stone-600" style={{ borderBottom: "2px solid #D97706" }}>
            <th className="py-1.5 pl-2 pr-2 font-semibold text-right w-9">#</th>
            <th className="py-1.5 pr-2 font-semibold">Persona</th>
            <th className="py-1.5 pr-2 font-semibold">Código</th>
            <th className="py-1.5 pr-2 font-semibold">Mesa / banda</th>
            <th className="py-1.5 pr-2 font-semibold text-right">Pos.</th>
            <th className="py-1.5 pr-2 font-semibold text-right">Bandejas</th>
            <th className="py-1.5 pr-2 font-semibold text-right">Libras</th>
            <th className="py-1.5 pr-2 font-semibold text-right">Lb/hora</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((p, i) => (
            <tr key={p.Codigo} style={{ background: i % 2 ? "#FAFAF9" : "#FFFFFF", breakInside: "avoid" }}>
              <td className="py-1 pl-2 pr-2 text-right">
                {p.Puesto <= 3
                  ? <span className="inline-flex w-5 h-5 rounded-full items-center justify-center text-white text-[10px] font-black" style={{ background: MEDALLA[p.Puesto].aro }}>{p.Puesto}</span>
                  : <span className="tabular-nums font-bold text-stone-500">{p.Puesto}</span>}
              </td>
              <td className={`py-1 pr-2 ${p.Puesto <= 3 ? "font-bold" : ""}`}>{titulo(p.Nombre)}</td>
              <td className="py-1 pr-2 font-mono text-stone-500">{p.Codigo}</td>
              <td className="py-1 pr-2 text-stone-700">{p.MesaNombre ?? "—"}</td>
              <td className="py-1 pr-2 text-right tabular-nums text-stone-700">{p.Posicion ?? ""}</td>
              <td className="py-1 pr-2 text-right tabular-nums font-black">{p.Bandejas.toLocaleString("es-GT")}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{num(p.Lb)}</td>
              <td className="py-1 pr-2 text-right">
                <span className="inline-block min-w-[2.9rem] rounded px-1.5 tabular-nums font-bold" style={{ color: colorLbH(p.LbHora), background: fondoLbH(p.LbHora) }}>{num(p.LbHora)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {lista.length === 0 && <p className="text-sm text-stone-500 py-6 text-center">Sin bandejas pesadas en esas fechas.</p>}

      <div className="mt-3 pt-2 flex items-start justify-between gap-6 text-[9.5px] text-stone-500" style={{ borderTop: "1px solid #E7E5E4" }}>
        <p className="max-w-[75%]">
          Ordenado por bandejas; con las mismas bandejas, por libras. Lb/hora: libra válida ÷ horas, mismo cálculo que destajo
          (<span style={{ color: "#b91c1c", fontWeight: 700 }}>rojo</span> menos de {META_LBH}, <span style={{ color: "#047857", fontWeight: 700 }}>verde</span> {META_LBH} o más).
          Solo bandejas guardadas y no anuladas, pesadas en modo Empanizado.
        </p>
        <p className="text-right whitespace-nowrap">Impreso {new Date().toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" })}</p>
      </div>
    </div>
  );
}

export default function RankingEmpanizadoModal({ lista, desde, hasta, totales, marca = "Empanizado", onCerrar }) {
  // El nombre del PDF lo pone el navegador a partir del título de la página.
  useEffect(() => {
    const antes = document.title;
    const periodo = desde === hasta ? fmtDia(desde) : `${fmtDia(desde)} al ${fmtDia(hasta)}`;
    document.title = `Ranking ${marca} ${periodo.replaceAll("/", "-")}`;
    return () => { document.title = antes; };
  }, [desde, hasta, marca]);

  return (
    <>
      {/* Vista previa — SOLO pantalla. index.css oculta #root al imprimir; lo que se imprime va en el portal. */}
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 print:hidden"
        onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-full min-w-0 flex flex-col">
          <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
            <h2 className="text-base font-semibold text-gray-800">Ranking {marca} — vista previa</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => window.print()}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition">
                Imprimir / PDF
              </button>
              <button onClick={onCerrar} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-2 text-xl leading-none transition">&times;</button>
            </div>
          </div>
          <div className="px-8 py-6 overflow-auto">
            <ContenidoRankingEmpanizado lista={lista} desde={desde} hasta={hasta} totales={totales} marca={marca} />
          </div>
        </div>
      </div>

      {createPortal(
        <div className="hidden print:block">
          <style>{"@media print { @page { size: letter; margin: 1.2cm; } }"}</style>
          <ContenidoRankingEmpanizado lista={lista} desde={desde} hasta={hasta} totales={totales} marca={marca} />
        </div>,
        document.getElementById("print-root")
      )}
    </>
  );
}
