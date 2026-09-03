import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { authHeader } from "../context/AuthContext.jsx";
import { fmtFechaHora } from "../utils/fecha.js";

// Delega en el helper compartido: los DATETIME del backend traen hora de Guatemala con una "Z"
// mentirosa, y `new Date(iso)` les restaba 6 horas más (ver utils/fecha.js).
const fmtFecha = fmtFechaHora;

function fmtDia(iso) {
  if (!iso) return "-";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

// El documento en sí — vive DUPLICADO a propósito (vista previa en pantalla dentro del modal y una
// copia portada a #print-root solo para imprimir), mismo patrón que HojaPalletModal.
function ContenidoHoja({ remision }) {
  // Igual que el formulario: lo que decide la forma del documento es el Destino de la serie, no el
  // nombre del tipo — un destino interno nuevo sale bien impreso sin tocar este componente.
  const interno = remision.Destino === "Area";
  const exportacion = remision.PideEmbarque === true;

  // El detalle impreso se agrupa por producto, no una fila por master: al cliente y a la aduana les
  // importa "cuántos masters de tal talla van", no el correlativo de cada caja. La trazabilidad
  // master a master ya vive en el sistema y en el kardex.
  // En exportación la LÍNEA DEL CONTENEDOR entra en la clave de agrupación y ordena el listado: el
  // papel se usa para estibar y para auditar la carga, así que "qué va en la línea 3" tiene que
  // leerse directo, sin recomponerlo mentalmente.
  const conLinea = remision.PideLinea === true;
  const agrupado = Object.values(remision.Lineas.reduce((acc, l) => {
    const clave = `${conLinea ? l.LineaContenedor : ""}|${l.CodigoPedido}|${l.DescripcionProceso}|${l.DescripcionTalla}|${l.DescripcionPresentacion}|${l.Lote}`;
    acc[clave] ??= {
      clave, CodigoPedido: l.CodigoPedido, Lote: l.Lote, Linea: l.LineaContenedor,
      Producto: `${l.DescripcionProceso} ${l.DescripcionTalla} ${l.DescripcionPresentacion}`,
      Cliente: l.NombreCliente + (l.NombreSubcliente ? `-${l.NombreSubcliente}` : ""),
      CalzaConDestino: l.CalzaConDestino,
      Masters: 0, Kg: 0, Lb: 0,
    };
    acc[clave].Masters += 1;
    acc[clave].Kg += l.PesoMasterKG;
    acc[clave].Lb += l.PesoMasterLb;
    return acc;
  }, {})).sort((a, b) => (a.Linea ?? 0) - (b.Linea ?? 0));

  const destino = interno
    ? (remision.NombreAreaDestino || remision.AreaDestino)
    : (remision.NombreCliente || "-") + (remision.NombreSubcliente ? ` — ${remision.NombreSubcliente}` : "");

  return (
    <>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            {interno ? "Vale de traslado interno" : "Remisión de despacho"}
          </h1>
          <p className="text-base text-gray-500 mt-1">{remision.NombreTipo}</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-mono font-bold">{remision.Folio}</p>
          <p className="text-base text-gray-500 mt-1">{fmtDia(remision.Fecha)}</p>
          {remision.Estatus !== "Confirmada" && (
            <p className="text-sm font-bold text-red-600 mt-1 uppercase">{remision.Estatus}</p>
          )}
        </div>
      </div>

      <div className="border-y-2 border-gray-800 py-3 mb-5 grid grid-cols-2 gap-x-8 gap-y-2 text-base">
        <div>
          <span className="text-gray-400">{interno ? "Área de destino:" : "Cliente:"}</span>{" "}
          <span className="font-semibold">{destino}</span>
        </div>
        {remision.CodigoPedido && (
          <div>
            <span className="text-gray-400">Pedido:</span>{" "}
            <span className="font-mono font-semibold">{remision.CodigoPedido}</span>
            {remision.DescripcionPedido ? <span className="text-gray-500"> — {remision.DescripcionPedido}</span> : null}
            {/* Va en el papel a propósito: si el embarque mezcla proformas, quien lo recibe o audita
                tiene que poder verlo sin abrir el sistema. */}
            {remision.EsMixta ? <span className="font-semibold"> (mixta)</span> : null}
          </div>
        )}
        {/* En exportación el renglón va SIEMPRE, aunque el dato falte: son obligatorios desde ago
            2026, así que un hueco visible en el papel avisa del problema — ocultarlo lo escondería. */}
        {exportacion && (
          <div>
            <span className="text-gray-400">Contenedor:</span>{" "}
            <span className="font-mono font-semibold">{remision.Contenedor || "—"}</span>
          </div>
        )}
        {exportacion && (
          <div>
            <span className="text-gray-400">Sello / marchamo:</span>{" "}
            <span className="font-mono font-semibold">{remision.Sello || "—"}</span>
          </div>
        )}
      </div>

      <div className="flex gap-10 mb-5 text-base">
        <span><span className="text-gray-400">Total Masters:</span> <span className="font-bold text-2xl">{remision.CantidadMasters}</span></span>
        <span><span className="text-gray-400">Total Kg:</span> <span className="font-bold text-2xl">{remision.PesoKg.toFixed(2)}</span></span>
        <span><span className="text-gray-400">Total Lb:</span> <span className="font-bold text-2xl">{remision.PesoLb.toFixed(2)}</span></span>
      </div>

      <table className="w-full text-base">
        <thead>
          <tr className="text-left text-gray-600 uppercase border-b-2 border-gray-800 text-sm">
            {conLinea && <th className="py-2 pr-3 text-center">Línea</th>}
            <th className="py-2 pr-3">Pedido</th>
            <th className="py-2 pr-3">Cliente de la etiqueta</th>
            <th className="py-2 pr-3">Lote</th>
            <th className="py-2 pr-3">Producto</th>
            <th className="py-2 pr-3 text-right">Masters</th>
            <th className="py-2 pr-3 text-right">Kg</th>
            <th className="py-2 text-right">Lb</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {agrupado.map(g => (
            <tr key={g.clave}>
              {conLinea && <td className="py-1.5 pr-3 text-center font-mono font-bold">{g.Linea ?? "—"}</td>}
              <td className="py-1.5 pr-3 font-mono">{g.CodigoPedido}</td>
              <td className="py-1.5 pr-3 whitespace-nowrap">
                {g.Cliente}
                {/* El producto se despacha con la etiqueta que traía: si es de otro cliente, quien
                    recibe tiene que poder verlo en el papel, no solo en pantalla. */}
                {g.CalzaConDestino === false && <span className="ml-1 text-xs font-bold">(*)</span>}
              </td>
              <td className="py-1.5 pr-3 font-mono whitespace-nowrap">{g.Lote}</td>
              <td className="py-1.5 pr-3 whitespace-nowrap">{g.Producto}</td>
              <td className="py-1.5 pr-3 text-right font-mono">{g.Masters}</td>
              <td className="py-1.5 pr-3 text-right">{g.Kg.toFixed(2)}</td>
              <td className="py-1.5 text-right">{g.Lb.toFixed(2)}</td>
            </tr>
          ))}
          {agrupado.length === 0 && (
            <tr><td colSpan={conLinea ? 8 : 7} className="py-6 text-center text-gray-400">Sin producto</td></tr>
          )}
        </tbody>
      </table>

      {remision.Lineas.some(l => l.CalzaConDestino === false) && (
        <p className="text-sm text-gray-600 mt-3">
          (*) Producto etiquetado a nombre de otro cliente, despachado sin reetiquetar.
        </p>
      )}

      {remision.Observaciones && (
        <p className="text-base mt-5"><span className="text-gray-400">Observaciones:</span> {remision.Observaciones}</p>
      )}

      <div className="grid grid-cols-2 gap-16 mt-16">
        <div className="border-t border-gray-800 pt-2 text-center text-sm text-gray-600">Entregado por</div>
        <div className="border-t border-gray-800 pt-2 text-center text-sm text-gray-600">Recibido por</div>
      </div>

      <p className="text-sm text-gray-400 mt-6">
        Impreso {fmtFecha(new Date().toISOString())}
        {remision.ConfirmadaEn ? ` · Confirmada por ${remision.ConfirmadaPor} el ${fmtFecha(remision.ConfirmadaEn)}` : ""}
      </p>
    </>
  );
}

// Documento de oficina, no etiqueta: a diferencia de la etiqueta de master (que va por ZPL directo a
// la Zebra), esto se imprime con el diálogo del navegador en papel carta.
export default function HojaRemisionModal({ remisionId, onCerrar }) {
  const [remision, setRemision] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/remisiones/${remisionId}`, { headers: authHeader() })
      .then(res => res.json())
      .then(data => { setRemision(data); setLoading(false); });
  }, [remisionId]);

  return (
    <>
      {/* Modal interactivo — SOLO pantalla. index.css oculta todo #root al imprimir, por eso lo que
          realmente se imprime va en el portal de abajo. */}
      <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 p-4 print:hidden"
        onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-full flex flex-col">
          <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
            <h2 className="text-base font-semibold text-gray-800">Vista previa del documento</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => window.print()} disabled={loading || !remision}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50">
                Imprimir
              </button>
              <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-2 text-xl leading-none transition">&times;</button>
            </div>
          </div>
          <div className="px-8 py-6 overflow-y-auto">
            {loading ? <p className="text-gray-400 text-sm">Cargando…</p>
              : !remision?.Folio ? <p className="text-sm text-red-600">No se pudo cargar la remisión.</p>
              : <ContenidoHoja remision={remision} />}
          </div>
        </div>
      </div>

      {remision?.Folio && createPortal(
        <div className="hidden print:block">
          <style>{"@media print { @page { size: letter; margin: 1.5cm; } }"}</style>
          <ContenidoHoja remision={remision} />
        </div>,
        document.getElementById("print-root")
      )}
    </>
  );
}
