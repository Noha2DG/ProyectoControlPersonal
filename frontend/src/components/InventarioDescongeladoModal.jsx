import { useEffect } from "react";
import { createPortal } from "react-dom";
import { fmtNum } from "../utils/numero.js";

// El inventario al piso de Descongelado, para imprimir o guardar como PDF y contar el piso con él
// ("Imprimir / PDF" usa el diálogo del navegador, igual que la hoja de Descongelado).
//
// No pide nada al servidor: imprime las mismas líneas que se ven en AL PISO, agrupadas igual (por
// remisión). Así el papel con el que se cuenta el piso no puede decir otra cosa que la pantalla.

// Fechas puras (YYYY-MM-DD) partidas a mano: new Date() las lee como medianoche UTC y en Guatemala
// las muestra un día antes (ver utils/fecha.js).
function fmtDia(iso) {
  if (!iso) return "—";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

// Conserva el orden que trae el backend: la remisión confirmada primero y, dentro, el lote más viejo
// primero. El producto que entró por un ajuste, sin remisión, va en su propio grupo.
function agruparPorRemision(saldo) {
  const grupos = [];
  for (const r of saldo) {
    const clave = r.RemisionId ?? "sin-remision";
    let g = grupos.find(x => x.clave === clave);
    if (!g) { g = { clave, Folio: r.FolioRemision, ConfirmadaEn: r.ConfirmadaEn, lineas: [], Kg: 0, Masters: 0 }; grupos.push(g); }
    g.lineas.push(r); g.Kg += r.Kg; g.Masters += r.Masters || 0;
  }
  return grupos;
}

function ContenidoInventario({ fecha, saldo }) {
  const grupos = agruparPorRemision(saldo);
  const totalKg = saldo.reduce((s, r) => s + r.Kg, 0);
  const totalM = saldo.reduce((s, r) => s + (r.Masters || 0), 0);

  return (
    <div className="text-gray-900">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Inventario al piso</h1>
          <p className="text-sm text-gray-500">Sin descongelar, por remisión</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold">Descongelado</p>
          <p className="text-sm text-gray-500">Al {fmtDia(fecha)}</p>
        </div>
      </div>

      <div className="border-y-2 border-gray-800 py-2 mb-4 grid grid-cols-4 gap-x-6 text-sm">
        <div><span className="text-gray-500">Masters:</span> <b>{totalM}</b></div>
        <div><span className="text-gray-500">Kg al piso:</span> <b>{fmtNum(totalKg)}</b></div>
        <div><span className="text-gray-500">Remisiones:</span> <b>{grupos.length}</b></div>
        <div><span className="text-gray-500">Líneas:</span> <b>{saldo.length}</b></div>
      </div>

      {grupos.length === 0 && <p className="text-sm text-gray-500 py-6 text-center">No hay nada al piso.</p>}

      {grupos.map(g => (
        <div key={g.clave} className="mb-5" style={{ breakInside: "avoid-page" }}>
          <div className="flex items-baseline justify-between border-b-2 border-gray-800 pb-0.5 mb-1">
            <h2 className="text-base font-bold">
              {g.Folio || "Sin remisión (ajuste)"}
              {g.ConfirmadaEn && <span className="text-xs font-normal text-gray-500 ml-2">confirmada {g.ConfirmadaEn}</span>}
            </h2>
            <p className="text-sm font-bold tabular-nums">{g.Masters ? `${g.Masters} masters · ` : ""}{fmtNum(g.Kg)} kg</p>
          </div>
          <table className="w-full text-xs print-table">
            <thead>
              <tr className="text-gray-500 text-left">
                <th className="py-1 pr-2 font-medium">Lote</th>
                <th className="py-1 pr-2 font-medium">F. producción</th>
                <th className="py-1 pr-2 font-medium">Producto</th>
                <th className="py-1 pr-2 font-medium">Talla</th>
                <th className="py-1 pr-2 font-medium">Entró</th>
                <th className="py-1 pr-2 font-medium text-right">Días al piso</th>
                <th className="py-1 pr-2 font-medium text-right">Masters</th>
                <th className="py-1 font-medium text-right">Kg</th>
              </tr>
            </thead>
            <tbody>
              {g.lineas.map((r, i) => (
                <tr key={i} className="border-t border-gray-200">
                  <td className="py-1 pr-2 font-mono">{r.Lote}</td>
                  <td className="py-1 pr-2">{fmtDia(r.FechaLote)}</td>
                  <td className="py-1 pr-2"><span className="font-mono text-gray-500">{r.Clase}</span> {r.DescripcionClase}</td>
                  <td className="py-1 pr-2">{r.DescripcionTalla}</td>
                  <td className="py-1 pr-2">{fmtDia(r.FechaIngreso)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{r.DiasAlPiso === 0 ? "hoy" : r.DiasAlPiso ?? "—"}</td>
                  <td className="py-1 pr-2 text-right tabular-nums font-semibold">{r.Masters || ""}</td>
                  <td className="py-1 text-right tabular-nums font-semibold">{fmtNum(r.Kg)}</td>
                </tr>
              ))}
            </tbody>
            {g.lineas.length > 1 && (
              <tfoot>
                <tr className="border-t border-gray-400 font-semibold">
                  <td className="py-1 pr-2" colSpan={6}>Subtotal {g.Folio || "ajuste"}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{g.Masters || ""}</td>
                  <td className="py-1 text-right tabular-nums">{fmtNum(g.Kg)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      ))}

      {grupos.length > 1 && (
        <div className="flex justify-between border-y-2 border-gray-800 py-1.5 mb-8 text-sm font-bold">
          <span>Total Descongelado</span>
          <span className="tabular-nums">{totalM} masters · {fmtNum(totalKg)} kg</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-16 mt-10">
        <div className="text-center">
          <p className="h-5"></p>
          <div className="border-t border-gray-800 pt-1 text-xs text-gray-600">Contado por</div>
        </div>
        <div className="text-center">
          <p className="h-5"></p>
          <div className="border-t border-gray-800 pt-1 text-xs text-gray-600">Revisado por</div>
        </div>
      </div>

      <p className="text-[10px] text-gray-400 mt-6">
        Impreso {new Date().toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" })}
      </p>
    </div>
  );
}

export default function InventarioDescongeladoModal({ fecha, saldo, onCerrar }) {
  // El nombre del PDF lo pone el navegador a partir del título de la página.
  useEffect(() => {
    const antes = document.title;
    document.title = `Inventario al piso Descongelado - ${fmtDia(fecha).replaceAll("/", "-")}`;
    return () => { document.title = antes; };
  }, [fecha]);

  return (
    <>
      {/* Vista previa — SOLO pantalla. index.css oculta #root al imprimir; lo que se imprime va en el
          portal de abajo, igual que HojaDescongeladoModal. */}
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 print:hidden"
        onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-full min-w-0 flex flex-col">
          <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
            <h2 className="text-base font-semibold text-gray-800">Inventario al piso — Descongelado — vista previa</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => window.print()}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition">
                Imprimir / PDF
              </button>
              <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-2 text-xl leading-none transition">&times;</button>
            </div>
          </div>
          <div className="px-8 py-6 overflow-auto">
            <ContenidoInventario fecha={fecha} saldo={saldo} />
          </div>
        </div>
      </div>

      {createPortal(
        <div className="hidden print:block">
          <style>{"@media print { @page { size: letter; margin: 1.2cm; } }"}</style>
          <ContenidoInventario fecha={fecha} saldo={saldo} />
        </div>,
        document.getElementById("print-root")
      )}
    </>
  );
}
