import { useEffect } from "react";
import { createPortal } from "react-dom";
import { fmtNum } from "../utils/numero.js";

// El inventario al piso de Pelado o Descabezado, agrupado por clase, para imprimir o guardar como PDF
// ("Imprimir / PDF" usa el diálogo del navegador, igual que la hoja de Descongelado).
//
// No pide nada al servidor: imprime las mismas líneas que se ven en "Tomar del piso". Así el papel con
// el que se cuenta el piso no puede decir otra cosa que la pantalla.

// Fechas puras (YYYY-MM-DD) partidas a mano: new Date() las lee como medianoche UTC y en Guatemala
// las muestra un día antes (ver utils/fecha.js).
function fmtDia(iso) {
  if (!iso) return "—";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}
const hoyGT = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });

function vieneDe(l) {
  if (l.EsBajado) return l.EsRojo ? "Bajado de la mesa · rojo a revisar" : "Bajado de la mesa";
  if (l.EsCola) return "Cola de Descabezado";
  return l.FolioRemision ? `Remisión ${l.FolioRemision}` : "—";
}

// Por clase, en orden de código; dentro de cada clase por talla y, en la misma talla, el lote más
// viejo primero (el orden en que se debería trabajar).
function agruparPorClase(lineas) {
  const grupos = new Map();
  for (const l of lineas) {
    if (!grupos.has(l.Clase)) grupos.set(l.Clase, { Clase: l.Clase, Descripcion: l.DescripcionClase || l.Clase, lineas: [], Kg: 0, Masters: 0 });
    const g = grupos.get(l.Clase);
    g.lineas.push(l);
    g.Kg += l.Kg;
    g.Masters += l.Masters || 0;
  }
  return [...grupos.values()]
    .sort((a, b) => a.Clase.localeCompare(b.Clase))
    .map(g => ({
      ...g,
      lineas: [...g.lineas].sort((a, b) => (a.Talla - b.Talla) || String(a.FechaLote ?? "").localeCompare(String(b.FechaLote ?? ""))),
    }));
}

export function ContenidoInventarioPiso({ nombreBodega, lineas }) {
  const grupos = agruparPorClase(lineas);
  const total = lineas.reduce((s, l) => s + l.Kg, 0);
  // Masters solo si alguna línea los trae (lo que llegó por remisión directa); lo que viene de
  // Descongelado está pesado y no en cajas.
  const conMasters = lineas.some(l => l.Masters);

  return (
    <div className="text-gray-900">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Inventario al piso</h1>
          <p className="text-sm text-gray-500">Agrupado por clase</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold">{nombreBodega}</p>
          <p className="text-sm text-gray-500">{fmtDia(hoyGT())}</p>
        </div>
      </div>

      <div className="border-y-2 border-gray-800 py-2 mb-4 grid grid-cols-3 gap-x-6 text-sm">
        <div><span className="text-gray-500">Total al piso:</span> <b>{fmtNum(total)} kg</b></div>
        <div><span className="text-gray-500">Clases:</span> <b>{grupos.length}</b></div>
        <div><span className="text-gray-500">Líneas:</span> <b>{lineas.length}</b></div>
      </div>

      {grupos.length === 0 && <p className="text-sm text-gray-500 py-6 text-center">No hay nada al piso.</p>}

      {grupos.map(g => (
        <div key={g.Clase} className="mb-5" style={{ breakInside: "avoid-page" }}>
          <div className="flex items-baseline justify-between border-b-2 border-gray-800 pb-0.5 mb-1">
            <h2 className="text-base font-bold">
              {g.Descripcion} <span className="text-xs font-normal text-gray-500">{g.Clase}</span>
            </h2>
            <p className="text-sm font-bold tabular-nums">{fmtNum(g.Kg)} kg</p>
          </div>
          <table className="w-full text-xs print-table">
            <thead>
              <tr className="text-gray-500 text-left">
                <th className="py-1 pr-2 font-medium">Lote de origen</th>
                <th className="py-1 pr-2 font-medium">Finca</th>
                <th className="py-1 pr-2 font-medium">Talla</th>
                <th className="py-1 pr-2 font-medium">Viene de</th>
                <th className="py-1 pr-2 font-medium">F. del lote</th>
                <th className="py-1 pr-2 font-medium text-right">Días al piso</th>
                {conMasters && <th className="py-1 pr-2 font-medium text-right">Masters</th>}
                <th className="py-1 font-medium text-right">Kg</th>
              </tr>
            </thead>
            <tbody>
              {g.lineas.map(l => (
                <tr key={l.Clave} className="border-t border-gray-200">
                  <td className="py-1 pr-2 font-mono">{l.Lote}</td>
                  <td className="py-1 pr-2">{l.NombreFinca || "—"}</td>
                  <td className="py-1 pr-2">{l.Talla === 900 ? "—" : l.DescripcionTalla}</td>
                  <td className="py-1 pr-2">{vieneDe(l)}</td>
                  <td className="py-1 pr-2">{fmtDia(l.FechaLote)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{l.DiasAlPiso === 0 ? "hoy" : l.DiasAlPiso}</td>
                  {conMasters && <td className="py-1 pr-2 text-right tabular-nums">{l.Masters || ""}</td>}
                  <td className="py-1 text-right tabular-nums font-semibold">{fmtNum(l.Kg)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-400 font-semibold">
                <td className="py-1 pr-2" colSpan={6}>Subtotal {g.Descripcion}</td>
                {conMasters && <td className="py-1 pr-2 text-right tabular-nums">{g.Masters || ""}</td>}
                <td className="py-1 text-right tabular-nums">{fmtNum(g.Kg)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ))}

      {grupos.length > 1 && (
        <div className="flex justify-between border-y-2 border-gray-800 py-1.5 mb-8 text-sm font-bold">
          <span>Total {nombreBodega}</span>
          <span className="tabular-nums">{fmtNum(total)} kg</span>
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

export default function InventarioPisoModal({ nombreBodega, lineas, onCerrar }) {
  // El nombre del PDF lo pone el navegador a partir del título de la página.
  useEffect(() => {
    const antes = document.title;
    document.title = `Inventario al piso ${nombreBodega} - ${fmtDia(hoyGT()).replaceAll("/", "-")}`;
    return () => { document.title = antes; };
  }, [nombreBodega]);

  return (
    <>
      {/* Vista previa — SOLO pantalla. index.css oculta #root al imprimir; lo que se imprime va en el
          portal de abajo, igual que HojaDescongeladoModal. */}
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 print:hidden"
        onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-full min-w-0 flex flex-col">
          <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
            <h2 className="text-base font-semibold text-gray-800">Inventario al piso — {nombreBodega} — vista previa</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => window.print()}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition">
                Imprimir / PDF
              </button>
              <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-2 text-xl leading-none transition">&times;</button>
            </div>
          </div>
          <div className="px-8 py-6 overflow-auto">
            <ContenidoInventarioPiso nombreBodega={nombreBodega} lineas={lineas} />
          </div>
        </div>
      </div>

      {createPortal(
        <div className="hidden print:block">
          <style>{"@media print { @page { size: letter; margin: 1.2cm; } }"}</style>
          <ContenidoInventarioPiso nombreBodega={nombreBodega} lineas={lineas} />
        </div>,
        document.getElementById("print-root")
      )}
    </>
  );
}
