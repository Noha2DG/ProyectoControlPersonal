import { useState, useEffect, useRef } from "react";
import { authHeader } from "../context/AuthContext.jsx";
import { fmtFechaHoraLarga } from "../utils/fecha.js";

// Consulta un correlativo por completo: producto, historial de impresión y si ya está escaneado en
// bodega (y dónde) — usable tanto desde Impresión (antes de reimprimir) como desde Bodega (para
// investigar un escaneo rechazado o una caja sin explicación). El input queda enfocado para que el
// lector 2D alimente el correlativo igual que en el resto de la app (escribe como teclado + Enter).
// Un correlativo de master es numérico ("E47" o "47"); un código de polín siempre lleva letras
// delante ("T0010", "RP0007"). Se decide por la forma del código y no preguntándole al usuario: en
// piso se lee lo que se tiene enfrente sin saber de qué tipo es.
const esCorrelativoMaster = (v) => /^E?\d+$/i.test(v.trim());

export default function ConsultarEtiquetaModal({ onCerrar }) {
  const [valor, setValor] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [resultado, setResultado] = useState(null);   // etiqueta (master)
  const [pallet, setPallet] = useState(null);         // polín
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const buscar = async (e) => {
    e.preventDefault();
    const codigo = valor.trim();
    if (!codigo || buscando) return;
    setBuscando(true);
    setError("");
    setResultado(null);
    setPallet(null);
    try {
      const url = esCorrelativoMaster(codigo)
        ? `/api/etiqueta-impresa/${encodeURIComponent(codigo)}/consultar`
        : `/api/pallets/codigo/${encodeURIComponent(codigo.toUpperCase())}`;
      const res = await fetch(url, { headers: authHeader() });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "No se pudo consultar"); return; }
      if (esCorrelativoMaster(codigo)) setResultado(data); else setPallet(data);
    } catch (err) {
      setError("No se pudo consultar: " + err.message);
    } finally {
      setBuscando(false);
    }
  };

  const buscarOtra = () => {
    setResultado(null); setPallet(null); setError(""); setValor("");
    inputRef.current?.focus();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-full">
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
          <h2 className="text-base font-semibold text-gray-800">Consultar etiqueta o polín</h2>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <div className="px-6 py-4 overflow-y-auto">
          <form onSubmit={buscar} className="flex gap-2 mb-4">
            <input ref={inputRef} type="text" value={valor} onChange={e => setValor(e.target.value)}
              placeholder="Master (E47) o polín (T0010) — o apunta el lector aquí"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <button type="submit" disabled={buscando || !valor.trim()}
              className="px-4 py-2 text-sm bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
              {buscando ? "Buscando..." : "Consultar"}
            </button>
          </form>

          {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

          {pallet && (() => {
            // Lo que hay ARRIBA del polín, que es contra lo que se coteja: los despachados siguen en
            // la respuesta como historia, pero no son carga actual (misma regla que la hoja del polín).
            const encima = pallet.Masters.filter(m => m.Estatus !== "Salido");
            const productos = [...new Set(encima.map(m => `${m.DescripcionProceso} ${m.DescripcionTalla}`))];
            const clientes = [...new Set(encima.map(m => m.NombreCliente))];
            return (
              <div className="space-y-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-lg font-bold text-gray-800">Polín {pallet.Codigo}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                    pallet.Estatus === "Abierto" ? "bg-blue-100 text-blue-700" :
                    pallet.Estatus === "Cerrado" ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-600"}`}>
                    {pallet.Estatus}
                  </span>
                </div>

                <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                  <p><span className="text-gray-500">Área:</span> {pallet.NombreBodegaVirtual || "-"}</p>
                  <p><span className="text-gray-500">Origen:</span> {pallet.DescripcionOrigen || "-"}</p>
                  <p>
                    <span className="text-gray-500">Masters:</span>{" "}
                    <span className="font-semibold">{pallet.CantidadMasters}</span>
                    {pallet.CantidadMaster != null ? ` de ${pallet.CantidadMaster}` : ""}
                    {pallet.CantidadSalidos > 0 && <span className="text-gray-400"> · {pallet.CantidadSalidos} ya despachado(s)</span>}
                  </p>
                  <p>
                    <span className="text-gray-500">Peso:</span>{" "}
                    {encima.reduce((a, m) => a + m.PesoMasterKG, 0).toFixed(2)} kg ·{" "}
                    {encima.reduce((a, m) => a + m.PesoMasterLb, 0).toFixed(2)} lb
                  </p>
                  {clientes.length > 0 && <p><span className="text-gray-500">Cliente{clientes.length > 1 ? "s" : ""}:</span> {clientes.join(", ")}</p>}
                  {productos.length > 0 && <p><span className="text-gray-500">Producto{productos.length > 1 ? "s" : ""}:</span> {productos.join(", ")}</p>}
                </div>

                <div className={`rounded-lg p-3 border ${pallet.PosicionCodigo ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
                  {pallet.PosicionCodigo ? (
                    <>
                      <p className="font-semibold text-red-800">🔒 Ubicado en bodega física</p>
                      <p>Posición <span className="font-mono font-semibold">{pallet.PosicionCodigo}</span></p>
                      <p className="text-gray-600">
                        Ubicado por <span className="font-semibold">{pallet.UbicadoPor || "-"}</span>
                        {pallet.UbicadoEn ? ` · ${fmtFechaHoraLarga(pallet.UbicadoEn)}` : ""}
                      </p>
                      <p className="text-gray-600">
                        Su contenido está sellado: para reabrirlo hay que des-ubicarlo primero. Sacar cajas
                        sueltas sí se puede con “+ Master de otro Pallet” desde el polín destino.
                      </p>
                    </>
                  ) : (
                    <p className="font-semibold text-amber-800">Sin posición en bodega física</p>
                  )}
                </div>

                <div className="text-xs text-gray-500 space-y-0.5">
                  <p>Creado por {pallet.CreadoPor || "-"}{pallet.CreadoEn ? ` · ${fmtFechaHoraLarga(pallet.CreadoEn)}` : ""}</p>
                  {pallet.CerradoEn && <p>Cerrado por {pallet.CerradoPor || "-"} · {fmtFechaHoraLarga(pallet.CerradoEn)}</p>}
                </div>

                <button onClick={buscarOtra} className="text-xs text-blue-600 hover:text-blue-800 underline">Consultar otro</button>
              </div>
            );
          })()}

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
                    {/* Las dos manos que tocaron la caja: quien la escaneó al polín y quien subió el
                        polín al rack. Casi nunca son la misma persona y es lo primero que se pregunta
                        cuando algo no cuadra. */}
                    <p className="text-gray-600">
                      Escaneado por <span className="font-semibold">{resultado.Master.IngresadoPor || "-"}</span>
                      {resultado.Master.FechaIngreso ? ` · ${fmtFechaHoraLarga(resultado.Master.FechaIngreso)}` : ""}
                    </p>
                    <p className="text-gray-600">
                      Ubicado por <span className="font-semibold">{resultado.Master.UbicadoPor || "-"}</span>
                      {resultado.Master.UbicadoEn ? ` · ${fmtFechaHoraLarga(resultado.Master.UbicadoEn)}` : ""}
                    </p>
                    <p className="text-gray-600 mt-1">
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
                      Escaneado por <span className="font-semibold">{resultado.Master.IngresadoPor || "-"}</span>
                      {resultado.Master.FechaIngreso ? ` · ${fmtFechaHoraLarga(resultado.Master.FechaIngreso)}` : ""}
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
                        {fmtFechaHoraLarga(h.FechaHora)} · {h.ImpresoPor}
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
