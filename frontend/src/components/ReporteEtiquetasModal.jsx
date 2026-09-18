import { createPortal } from "react-dom";
import { fmtDia } from "../utils/fecha.js";

// Documento de oficina, no etiqueta — mismo criterio que HojaRemisionModal/HojaPalletModal: se
// imprime con el diálogo del navegador en papel carta, y el usuario elige "Guardar como PDF" ahí
// (no se genera el PDF en el cliente con una librería aparte, para no sumar una dependencia solo
// para esto). El contenido va DUPLICADO a propósito: vista previa en pantalla dentro del modal, y
// una copia portada a #print-root que es lo único que sobrevive cuando index.css oculta #root.
function ContenidoReporte({ filas, etiqueta }) {
  const totales = filas.reduce((acc, f) => {
    const impresas = f.EnPapel;
    const noEscaneadas = Math.max(0, f.EnPapel - f.Escaneadas);
    return {
      Declarado: acc.Declarado + f.CantidadMaster,
      Impresas: acc.Impresas + impresas,
      Escaneadas: acc.Escaneadas + f.Escaneadas,
      NoEscaneadas: acc.NoEscaneadas + noEscaneadas,
    };
  }, { Declarado: 0, Impresas: 0, Escaneadas: 0, NoEscaneadas: 0 });

  return (
    <>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reporte de Etiquetas</h1>
          <p className="text-base text-gray-500 mt-1">{etiqueta}</p>
        </div>
        <p className="text-sm text-gray-400 text-right">
          Impreso {new Date().toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" })}
        </p>
      </div>

      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b-2 border-gray-800 text-left text-gray-600 uppercase tracking-wide">
            <th className="py-1.5 pr-2">Producción</th>
            <th className="py-1.5 pr-2">Impreso</th>
            <th className="py-1.5 pr-2">Pedido</th>
            <th className="py-1.5 pr-2">Cliente</th>
            <th className="py-1.5 pr-2">Producto</th>
            <th className="py-1.5 pr-2">Lote</th>
            <th className="py-1.5 pr-2 text-right">Solicitado</th>
            <th className="py-1.5 pr-2 text-right">Impresas</th>
            <th className="py-1.5 pr-2 text-right">Escaneadas</th>
            <th className="py-1.5 pr-2 text-right">No escaneadas</th>
            <th className="py-1.5 pr-2">Solicitó</th>
            <th className="py-1.5">Imprimió</th>
          </tr>
        </thead>
        <tbody>
          {filas.map(f => {
            const noEscaneadas = Math.max(0, f.EnPapel - f.Escaneadas);
            return (
              <tr key={f.OrdenId} className="border-b border-gray-200">
                {/* Dos fechas, no una: lo producido el 11 se puede imprimir el 17, y con una sola
                    columna el reporte del día parecía lleno de filas viejas. */}
                <td className="py-1.5 pr-2 whitespace-nowrap">{fmtDia(f.FechaProduccion)}</td>
                <td className="py-1.5 pr-2 whitespace-nowrap">{f.UltimaImpresion ? fmtDia(f.UltimaImpresion) : "-"}</td>
                <td className="py-1.5 pr-2 font-mono">{f.CodigoPedido}</td>
                <td className="py-1.5 pr-2">{f.NombreCliente}{f.NombreSubcliente ? ` — ${f.NombreSubcliente}` : ""}</td>
                <td className="py-1.5 pr-2">{f.DescripcionProceso} {f.DescripcionTalla} {f.DescripcionPresentacion}</td>
                <td className="py-1.5 pr-2 font-mono">{f.Lote}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{f.CantidadMaster}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{f.EnPapel}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{f.Escaneadas}</td>
                <td className={`py-1.5 pr-2 text-right tabular-nums ${noEscaneadas > 0 ? "text-amber-700 font-semibold" : ""}`}>{noEscaneadas}</td>
                <td className="py-1.5 pr-2">{f.RegistradoPor || "-"}</td>
                <td className="py-1.5">{f.ImpresoPor || "-"}</td>
              </tr>
            );
          })}
          {filas.length === 0 && (
            <tr><td colSpan={12} className="py-6 text-center text-gray-400">Sin capturas para este filtro</td></tr>
          )}
        </tbody>
        {filas.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-gray-800 font-bold">
              <td colSpan={6} className="py-2 pr-2 text-right text-gray-500 uppercase text-[10px] tracking-wide">Total</td>
              <td className="py-2 pr-2 text-right tabular-nums">{totales.Declarado}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{totales.Impresas}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{totales.Escaneadas}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{totales.NoEscaneadas}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        )}
      </table>
    </>
  );
}

// filas = las capturas que YA se imprimieron en el día elegido, filtradas en la página (ver
// filasReporte en ImpresionEtiquetasPage). No son todas las de la tabla: con una fecha puesta la
// tabla muestra además lo pendiente de imprimir de cualquier día, que es trabajo por hacer y no
// trabajo del día — en el PDF solo ensuciaba las filas y los totales.
export default function ReporteEtiquetasModal({ filas, etiqueta, onCerrar }) {
  return (
    <>
      <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 p-4 print:hidden"
        onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-6xl max-h-full flex flex-col">
          <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
            <h2 className="text-base font-semibold text-gray-800">Reporte de Etiquetas — Vista previa</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => window.print()}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition">
                Imprimir / Generar PDF
              </button>
              <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-2 text-xl leading-none transition">&times;</button>
            </div>
          </div>
          <div className="px-8 py-6 overflow-y-auto">
            <ContenidoReporte filas={filas} etiqueta={etiqueta} />
          </div>
        </div>
      </div>

      {createPortal(
        <div className="hidden print:block">
          <style>{"@media print { @page { size: letter landscape; margin: 1.2cm; } }"}</style>
          <ContenidoReporte filas={filas} etiqueta={etiqueta} />
        </div>,
        document.getElementById("print-root")
      )}
    </>
  );
}
