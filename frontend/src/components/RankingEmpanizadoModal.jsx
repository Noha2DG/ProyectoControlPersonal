import { useEffect } from "react";
import { createPortal } from "react-dom";

// Ranking de Empanizado por bandejas acumuladas, para imprimir o guardar como PDF (usuario, 26 nov 2026:
// "descargar ese ranking en un pdf, para no generar otro reporte"). No pide nada al servidor: imprime la
// misma lista que el reporte "Producción por persona", ordenada por bandejas y, con las mismas bandejas,
// por libras. "Imprimir / PDF" usa el diálogo del navegador, igual que InventarioPisoModal.

const META_LBH = 4; // igual que la tabla del reporte: menos de 4 en rojo, de 4 para arriba en verde
const num = (n, d = 2) => (n == null ? "—" : Number(n).toLocaleString("es-GT", { minimumFractionDigits: d, maximumFractionDigits: d }));
const titulo = s => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase().replace(/(^|\s)\p{L}/gu, c => c.toUpperCase());
function fmtDia(iso) {
  if (!iso) return "—";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}
const exacto = { printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" };

export function ContenidoRankingEmpanizado({ lista, desde, hasta, totales }) {
  const periodo = desde === hasta ? fmtDia(desde) : `${fmtDia(desde)} al ${fmtDia(hasta)}`;
  return (
    <div className="text-gray-900">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h1 className="text-2xl font-bold">Ranking de Empanizado</h1>
          <p className="text-sm text-gray-500">Por bandejas acumuladas</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold">{periodo}</p>
          <p className="text-xs text-gray-500">Producción por persona</p>
        </div>
      </div>

      <div className="border-y-2 border-gray-800 py-2 mb-4 grid grid-cols-4 gap-x-4 text-sm">
        <div><span className="text-gray-500">Personas:</span> <b>{totales.personas.toLocaleString("es-GT")}</b></div>
        <div><span className="text-gray-500">Bandejas:</span> <b>{totales.bandejas.toLocaleString("es-GT")}</b></div>
        <div><span className="text-gray-500">Libras:</span> <b>{num(totales.lb)}</b></div>
        <div><span className="text-gray-500">Lb/hora ponderada:</span> <b>{num(totales.ponderada)}</b></div>
      </div>

      <table className="w-full text-xs print-table">
        <thead>
          <tr className="text-gray-500 text-left border-b-2 border-gray-800">
            <th className="py-1 pr-2 font-medium text-right w-8">#</th>
            <th className="py-1 pr-2 font-medium">Persona</th>
            <th className="py-1 pr-2 font-medium">Código</th>
            <th className="py-1 pr-2 font-medium">Mesa / banda</th>
            <th className="py-1 pr-2 font-medium text-right">Pos.</th>
            <th className="py-1 pr-2 font-medium text-right">Bandejas</th>
            <th className="py-1 pr-2 font-medium text-right">Libras</th>
            <th className="py-1 font-medium text-right">Lb/hora</th>
          </tr>
        </thead>
        <tbody>
          {lista.map(p => {
            const color = p.LbHora == null ? "" : Math.round(p.LbHora * 100) / 100 < META_LBH ? "text-red-700" : "text-emerald-700";
            return (
              // Los tres primeros con fondo ámbar suave; print-color-adjust para que el navegador no lo quite.
              <tr key={p.Codigo} className={`border-t border-gray-200 ${p.Puesto <= 3 ? "bg-amber-50 font-semibold" : ""}`}
                style={p.Puesto <= 3 ? exacto : undefined}>
                <td className="py-1 pr-2 text-right tabular-nums font-bold">{p.Puesto}</td>
                <td className="py-1 pr-2">{titulo(p.Nombre)}</td>
                <td className="py-1 pr-2 font-mono">{p.Codigo}</td>
                <td className="py-1 pr-2">{p.MesaNombre ?? "—"}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{p.Posicion ?? ""}</td>
                <td className="py-1 pr-2 text-right tabular-nums font-bold">{p.Bandejas.toLocaleString("es-GT")}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{num(p.Lb)}</td>
                <td className={`py-1 text-right tabular-nums font-bold ${color}`} style={exacto}>{num(p.LbHora)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {lista.length === 0 && <p className="text-sm text-gray-500 py-6 text-center">Sin bandejas pesadas en esas fechas.</p>}

      <p className="text-[10px] text-gray-500 mt-3">
        Ordenado por bandejas; con las mismas bandejas, por libras. Lb/hora: libra válida ÷ horas, mismo cálculo que destajo;
        en rojo menos de {META_LBH}, en verde {META_LBH} o más. Solo bandejas guardadas y no anuladas, pesadas en modo Empanizado.
      </p>
      <p className="text-[10px] text-gray-400 mt-1">
        Impreso {new Date().toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" })}
      </p>
    </div>
  );
}

export default function RankingEmpanizadoModal({ lista, desde, hasta, totales, onCerrar }) {
  // El nombre del PDF lo pone el navegador a partir del título de la página.
  useEffect(() => {
    const antes = document.title;
    const periodo = desde === hasta ? fmtDia(desde) : `${fmtDia(desde)} al ${fmtDia(hasta)}`;
    document.title = `Ranking Empanizado ${periodo.replaceAll("/", "-")}`;
    return () => { document.title = antes; };
  }, [desde, hasta]);

  return (
    <>
      {/* Vista previa — SOLO pantalla. index.css oculta #root al imprimir; lo que se imprime va en el portal. */}
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 print:hidden"
        onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-full min-w-0 flex flex-col">
          <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
            <h2 className="text-base font-semibold text-gray-800">Ranking de Empanizado — vista previa</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => window.print()}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition">
                Imprimir / PDF
              </button>
              <button onClick={onCerrar} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-2 text-xl leading-none transition">&times;</button>
            </div>
          </div>
          <div className="px-8 py-6 overflow-auto">
            <ContenidoRankingEmpanizado lista={lista} desde={desde} hasta={hasta} totales={totales} />
          </div>
        </div>
      </div>

      {createPortal(
        <div className="hidden print:block">
          <style>{"@media print { @page { size: letter; margin: 1.2cm; } }"}</style>
          <ContenidoRankingEmpanizado lista={lista} desde={desde} hasta={hasta} totales={totales} />
        </div>,
        document.getElementById("print-root")
      )}
    </>
  );
}
