import { useState, useEffect, useRef } from "react";
import { authHeader } from "../context/AuthContext.jsx";

// Consulta un correlativo por completo: producto, historial de impresión y si ya está escaneado en
// bodega (y dónde) — usable tanto desde Impresión (antes de reimprimir) como desde Bodega (para
// investigar un escaneo rechazado o una caja sin explicación). El input queda enfocado para que el
// lector 2D alimente el correlativo igual que en el resto de la app (escribe como teclado + Enter).
export default function ConsultarEtiquetaModal({ onCerrar }) {
  const [valor, setValor] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const buscar = async (e) => {
    e.preventDefault();
    const correlativo = valor.trim();
    if (!correlativo || buscando) return;
    setBuscando(true);
    setError("");
    setResultado(null);
    try {
      const res = await fetch(`/api/etiqueta-impresa/${encodeURIComponent(correlativo)}/consultar`, { headers: authHeader() });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "No se pudo consultar"); return; }
      setResultado(data);
    } catch (err) {
      setError("No se pudo consultar: " + err.message);
    } finally {
      setBuscando(false);
    }
  };

  const buscarOtra = () => {
    setResultado(null); setError(""); setValor("");
    inputRef.current?.focus();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-full">
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
          <h2 className="text-base font-semibold text-gray-800">Consultar etiqueta</h2>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <div className="px-6 py-4 overflow-y-auto">
          <form onSubmit={buscar} className="flex gap-2 mb-4">
            <input ref={inputRef} type="text" value={valor} onChange={e => setValor(e.target.value)}
              placeholder="Correlativo (ej. E47) — o apunta el lector aquí"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <button type="submit" disabled={buscando || !valor.trim()}
              className="px-4 py-2 text-sm bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
              {buscando ? "Buscando..." : "Consultar"}
            </button>
          </form>

          {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

          {resultado && (
            <div className="space-y-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-mono text-lg font-bold text-gray-800">{resultado.Correlativo}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${resultado.Estatus === "Activa" ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-600"}`}>
                  {resultado.Estatus}
                </span>
              </div>

              {resultado.Producto ? (
                <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                  <p><span className="text-gray-500">Pedido:</span> <span className="font-mono font-semibold">{resultado.Producto.codigoPedido}</span></p>
                  <p><span className="text-gray-500">Cliente:</span> {resultado.Producto.cliente}{resultado.Producto.subcliente ? `-${resultado.Producto.subcliente}` : ""}</p>
                  <p><span className="text-gray-500">Lote:</span> <span className="font-mono">{resultado.Producto.lote}</span></p>
                  <p><span className="text-gray-500">Producto:</span> {resultado.Producto.proceso} {resultado.Producto.talla} · {resultado.Producto.presentacion}</p>
                  <p><span className="text-gray-500">Fecha producción:</span> {resultado.Producto.fechaProduccion || "-"}</p>
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">No se pudo resolver la orden de etiquetado de este correlativo.</p>
              )}

              <div className={`rounded-lg p-3 border ${
                resultado.Master?.PosicionCodigo ? "bg-red-50 border-red-200" :
                resultado.YaEscaneado ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200"
              }`}>
                {resultado.Master?.PosicionCodigo ? (
                  <>
                    <p className="font-semibold text-red-800">🔒 Sellado en bodega física</p>
                    <p>
                      Pallet <span className="font-mono font-semibold">{resultado.Master.PalletCodigo}</span> ·
                      Posición <span className="font-mono font-semibold">{resultado.Master.PosicionCodigo}</span>
                    </p>
                    <p className="text-gray-600">
                      Ya es parte del inventario — no se puede anular ni reimprimir. La única corrección
                      es des-ubicar el pallet desde Bodega Física.
                    </p>
                  </>
                ) : resultado.YaEscaneado ? (
                  <>
                    <p className="font-semibold text-amber-800">Ya escaneado en bodega</p>
                    <p>
                      Pallet <span className="font-mono font-semibold">{resultado.Master.PalletCodigo}</span>
                      {resultado.Master.NombreArea ? ` (${resultado.Master.NombreArea})` : ""} — {resultado.Master.PalletEstatus}
                    </p>
                    <p className="text-gray-600">
                      {new Date(resultado.Master.FechaIngreso).toLocaleString("es-GT")}
                      {resultado.Master.IngresadoPor ? ` · ${resultado.Master.IngresadoPor}` : ""}
                    </p>
                  </>
                ) : (
                  <p className="font-semibold text-green-800">Todavía no se ha escaneado en bodega</p>
                )}
              </div>

              <div>
                <p className="font-semibold text-gray-700 mb-1">
                  Impresión ({resultado.VecesImpresa} {resultado.VecesImpresa === 1 ? "vez" : "veces"})
                </p>
                <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {resultado.Historial.map(h => (
                    <div key={h.LogId} className="px-3 py-1.5 text-xs flex justify-between gap-2">
                      <span className="text-gray-600 whitespace-nowrap">
                        {new Date(h.FechaHora).toLocaleString("es-GT")} · {h.ImpresoPor}
                        {h.ReimpresionForzada ? " · forzada" : ""}
                      </span>
                      <span className="text-gray-400 italic truncate" title={h.Motivo}>{h.Motivo}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button onClick={buscarOtra} className="text-xs text-blue-600 hover:text-blue-800 underline">Consultar otra</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
