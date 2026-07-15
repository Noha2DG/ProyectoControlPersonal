import { useState, useEffect, useCallback, useRef } from "react";
import { authHeader } from "../context/AuthContext.jsx";

const API = "/api/pallets";

const ESTATUS_BADGE = {
  Abierto:   "bg-blue-100 text-blue-700",
  Cerrado:   "bg-green-100 text-green-700",
  Cancelado: "bg-gray-100 text-gray-500",
};

const CUADRE_BADGE = {
  Completo:   "bg-green-100 text-green-700",
  Incompleto: "bg-orange-100 text-orange-700",
  Sobrante:   "bg-red-100 text-red-700",
};

function fmtFecha(iso) {
  return iso ? new Date(iso).toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" }) : "-";
}

async function leerJSON(res) {
  try { return await res.json(); } catch { return {}; }
}

// Panel de escaneo de un pallet — un solo pallet a la vez (mismo criterio operativo: la estación
// llena un pallet, lo cierra, recién ahí abre el siguiente). El input queda enfocado para que el
// lector 2D USB/Bluetooth (que escribe como si fuera teclado + Enter) alimente el escaneo sin mouse.
function PanelEscaneo({ palletId, onClose, onCambio }) {
  const [pallet, setPallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [correlativo, setCorrelativo] = useState("");
  const [mensaje, setMensaje] = useState(null); // { ok: bool, texto }
  const [enviando, setEnviando] = useState(false);
  const inputRef = useRef(null);

  const fetchDetalle = useCallback(async () => {
    const res = await fetch(`${API}/${palletId}`, { headers: authHeader() });
    if (res.ok) setPallet(await res.json());
    setLoading(false);
  }, [palletId]);

  useEffect(() => { fetchDetalle(); }, [fetchDetalle]);
  useEffect(() => { if (pallet?.Estatus === "Abierto") inputRef.current?.focus(); }, [pallet?.Estatus, mensaje]);

  const abierto = pallet?.Estatus === "Abierto";

  const handleEscanear = async (e) => {
    e.preventDefault();
    const valor = correlativo.trim();
    if (!valor || enviando) return;
    setEnviando(true);
    setCorrelativo("");
    try {
      const res = await fetch(`${API}/${palletId}/escanear`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ Correlativo: valor }),
      });
      const data = await leerJSON(res);
      if (res.ok) {
        const m = data.Master;
        setMensaje({ ok: true, texto: `${m.Correlativo} — ${m.CodigoPedido} · ${m.NombreCliente}${m.NombreSubcliente ? "-" + m.NombreSubcliente : ""} · Lote ${m.Lote}` });
        await fetchDetalle();
        onCambio?.();
      } else {
        setMensaje({ ok: false, texto: `${valor}: ${data.error || "No se pudo escanear"}` });
      }
    } finally {
      setEnviando(false);
    }
  };

  const handleQuitar = async (masterId, correlativoTexto) => {
    if (!window.confirm(`¿Quitar ${correlativoTexto} de este pallet? Podrá volver a escanearse.`)) return;
    const res = await fetch(`${API}/${palletId}/masters/${masterId}`, { method: "DELETE", headers: authHeader() });
    const data = await leerJSON(res);
    if (res.ok) { await fetchDetalle(); onCambio?.(); }
    else alert("Error: " + (data.error || "No se pudo quitar el master"));
  };

  const handleCerrar = async () => {
    if (!window.confirm("¿Cerrar este pallet? No se podrán escanear más masters aquí.")) return;
    const res = await fetch(`${API}/${palletId}/cerrar`, { method: "POST", headers: authHeader() });
    const data = await leerJSON(res);
    if (res.ok) { await fetchDetalle(); onCambio?.(); }
    else alert("Error: " + (data.error || "No se pudo cerrar el pallet"));
  };

  const handleReabrir = async () => {
    const res = await fetch(`${API}/${palletId}/reabrir`, { method: "PUT", headers: authHeader() });
    const data = await leerJSON(res);
    if (res.ok) { await fetchDetalle(); onCambio?.(); }
    else alert("Error: " + (data.error || "No se pudo reabrir el pallet"));
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-full flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-lg font-bold text-gray-800">Pallet {pallet?.Codigo || `#${palletId}`}</h3>
            {pallet && (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ESTATUS_BADGE[pallet.Estatus] || "bg-gray-100 text-gray-600"}`}>
                {pallet.Estatus}
              </span>
            )}
            {pallet?.Cuadre && (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${CUADRE_BADGE[pallet.Cuadre] || "bg-gray-100 text-gray-600"}`}>
                {pallet.Cuadre}
              </span>
            )}
            {pallet?.DescripcionOrigen && <span className="text-xs text-gray-400">Origen: {pallet.DescripcionOrigen}</span>}
            {pallet?.NombreBodegaVirtual && <span className="text-xs text-gray-400">· {pallet.NombreBodegaVirtual}</span>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">&times;</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1">
          {loading ? (
            <p className="text-gray-400 text-sm">Cargando…</p>
          ) : (
            <>
              {abierto && (
                <form onSubmit={handleEscanear} className="mb-3">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Escanear QR del master</label>
                  <input ref={inputRef} type="text" value={correlativo} onChange={e => setCorrelativo(e.target.value)}
                    autoFocus disabled={enviando}
                    placeholder="Apunta el lector aquí..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </form>
              )}

              {mensaje && (
                <div className={`mb-3 text-sm px-3 py-2 rounded-lg ${mensaje.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                  {mensaje.texto}
                </div>
              )}

              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">
                  {pallet?.Masters.length ?? 0}{pallet?.CantidadMaster != null ? ` / ${pallet.CantidadMaster}` : ""} master{pallet?.Masters.length === 1 ? "" : "s"} escaneado{pallet?.Masters.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Correlativo</th>
                      <th className="px-3 py-2 text-left">Pedido</th>
                      <th className="px-3 py-2 text-left">Cliente</th>
                      <th className="px-3 py-2 text-left">Lote</th>
                      <th className="px-3 py-2 text-left">Proceso/Talla/Pres.</th>
                      <th className="px-3 py-2 text-right">Peso</th>
                      <th className="px-3 py-2 text-left">Hora</th>
                      {abierto && <th className="px-3 py-2 text-center">Acciones</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {pallet?.Masters.map(m => (
                      <tr key={m.MasterId} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-mono">{m.Correlativo}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{m.CodigoPedido}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{m.NombreCliente}{m.NombreSubcliente ? `-${m.NombreSubcliente}` : ""}</td>
                        <td className="px-3 py-2 font-mono whitespace-nowrap">{m.Lote}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{m.DescripcionProceso} {m.DescripcionTalla} {m.DescripcionPresentacion}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">{m.PesoMasterKG.toFixed(2)} kg / {m.PesoMasterLb.toFixed(2)} lb</td>
                        <td className="px-3 py-2 whitespace-nowrap">{fmtFecha(m.FechaIngreso)}</td>
                        {abierto && (
                          <td className="px-3 py-2 text-center">
                            <button onClick={() => handleQuitar(m.MasterId, m.Correlativo)} className="text-red-600 hover:text-red-800 font-medium">Quitar</button>
                          </td>
                        )}
                      </tr>
                    ))}
                    {pallet?.Masters.length === 0 && (
                      <tr><td colSpan={abierto ? 8 : 7} className="px-3 py-6 text-center text-gray-400">Sin masters escaneados todavía</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition">Volver a la lista</button>
          {abierto && (
            <button onClick={handleCerrar} className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition">Cerrar pallet</button>
          )}
          {pallet?.Estatus === "Cerrado" && (
            <button onClick={handleReabrir} className="px-4 py-2 rounded-lg text-sm font-semibold bg-orange-500 text-white hover:bg-orange-600 transition">Reabrir pallet</button>
          )}
        </div>
      </div>
    </div>
  );
}

// Se pide Origen y la cantidad de masters que se planea que lleve el polín ANTES de abrir el
// escaneo — Origen es solo informativo (no filtra qué se puede escanear ahí) y la cantidad es una
// meta de referencia (no bloquea, se compara contra lo escaneado como Completo/Incompleto/Sobrante).
function ModalNuevoPallet({ origenes, bodegasVirtuales, onCrear, onClose }) {
  const [origen, setOrigen] = useState("");
  const [areaCodigo, setAreaCodigo] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [error, setError] = useState("");
  const [creando, setCreando] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setCreando(true);
    try {
      await onCrear({ Origen: origen, CantidadMaster: cantidad, AreaCodigo: areaCodigo });
    } catch (err) {
      setError(err.message);
    } finally {
      setCreando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="text-lg font-bold text-gray-800">Nuevo pallet</h3>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Área donde se está trabajando *</label>
            <select required value={areaCodigo} onChange={e => setAreaCodigo(e.target.value)} autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="">Selecciona...</option>
              {bodegasVirtuales.map(b => <option key={b.AreaCodigo} value={b.AreaCodigo}>{b.Nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Origen *</label>
            <select required value={origen} onChange={e => setOrigen(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="">Selecciona...</option>
              {origenes.map(o => <option key={o.Codigo} value={o.Codigo}>{o.Descripcion}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Cantidad de masters que llevará el pallet *</label>
            <input required type="number" min="1" step="1" value={cantidad} onChange={e => setCantidad(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition">Cancelar</button>
            <button type="submit" disabled={creando} className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50">
              {creando ? "Creando..." : "Crear y escanear"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function PalletsPage() {
  const [pallets, setPallets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroEstatus, setFiltroEstatus] = useState("");
  const [filtroFecha, setFiltroFecha] = useState("");
  const [panelId, setPanelId] = useState(null);
  const [origenes, setOrigenes] = useState([]);
  const [bodegasVirtuales, setBodegasVirtuales] = useState([]);
  const [modalNuevo, setModalNuevo] = useState(false);

  useEffect(() => {
    fetch("/api/origen", { headers: authHeader() }).then(r => r.json()).then(data => {
      if (Array.isArray(data)) setOrigenes(data.filter(o => o.Activo));
    });
    fetch("/api/bodega-virtual", { headers: authHeader() }).then(r => r.json()).then(data => {
      if (Array.isArray(data)) setBodegasVirtuales(data.filter(b => b.Activo));
    });
  }, []);

  const fetchPallets = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filtroEstatus) params.set("estatus", filtroEstatus);
    if (filtroFecha) params.set("fecha", filtroFecha);
    const res = await fetch(`${API}?${params}`, { headers: authHeader() });
    const data = await res.json();
    if (Array.isArray(data)) setPallets(data);
    setLoading(false);
  }, [filtroEstatus, filtroFecha]);

  useEffect(() => { fetchPallets(); }, [fetchPallets]);

  const handleCrear = async ({ Origen, CantidadMaster, AreaCodigo }) => {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ Origen, CantidadMaster, AreaCodigo }),
    });
    const data = await leerJSON(res);
    if (!res.ok) throw new Error(data.error || "No se pudo crear el pallet");
    setModalNuevo(false);
    setPanelId(data.PalletId);
    fetchPallets();
  };

  const handleEliminar = async (id) => {
    if (!window.confirm(`¿Eliminar el pallet #${id}? Solo es posible si está vacío.`)) return;
    const res = await fetch(`${API}/${id}`, { method: "DELETE", headers: authHeader() });
    const data = await leerJSON(res);
    if (res.ok) fetchPallets();
    else alert("Error: " + (data.error || "No se pudo eliminar el pallet"));
  };

  return (
    <>
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <select value={filtroEstatus} onChange={e => setFiltroEstatus(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
          <option value="">Todos los estatus</option>
          <option value="Abierto">Abierto</option>
          <option value="Cerrado">Cerrado</option>
        </select>
        <input type="date" value={filtroFecha} onChange={e => setFiltroFecha(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        <span className="text-sm text-gray-500 ml-auto">{pallets.length} pallet{pallets.length !== 1 ? "s" : ""}</span>
        <button onClick={() => setModalNuevo(true)} className="bg-blue-600 text-white font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm">
          + Nuevo pallet
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left">Pallet</th>
                <th className="px-4 py-3 text-center">Estatus</th>
                <th className="px-4 py-3 text-left">Área</th>
                <th className="px-4 py-3 text-left">Origen</th>
                <th className="px-4 py-3 text-right">Masters</th>
                <th className="px-4 py-3 text-center">Cuadre</th>
                <th className="px-4 py-3 text-left">Creado</th>
                <th className="px-4 py-3 text-left">Cerrado</th>
                <th className="px-4 py-3 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Cargando…</td></tr>
              ) : pallets.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Sin pallets para este filtro</td></tr>
              ) : pallets.map(p => (
                <tr key={p.PalletId} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono font-semibold">{p.Codigo || `#${p.PalletId}`}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ESTATUS_BADGE[p.Estatus] || "bg-gray-100 text-gray-600"}`}>
                      {p.Estatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{p.NombreBodegaVirtual || "-"}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{p.DescripcionOrigen || "-"}</td>
                  <td className="px-4 py-3 text-right font-mono">{p.CantidadMasters}{p.CantidadMaster != null ? ` / ${p.CantidadMaster}` : ""}</td>
                  <td className="px-4 py-3 text-center">
                    {p.Cuadre && (
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${CUADRE_BADGE[p.Cuadre] || "bg-gray-100 text-gray-600"}`}>
                        {p.Cuadre}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-500">{p.CreadoPor} · {fmtFecha(p.CreadoEn)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-500">{p.CerradoEn ? `${p.CerradoPor} · ${fmtFecha(p.CerradoEn)}` : "-"}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center gap-2">
                      <button onClick={() => setPanelId(p.PalletId)} className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition">
                        {p.Estatus === "Abierto" ? "Escanear" : "Ver"}
                      </button>
                      {p.Estatus === "Abierto" && p.CantidadMasters === 0 && (
                        <button onClick={() => handleEliminar(p.PalletId)} className="text-red-600 hover:text-red-800 text-xs font-medium px-2 py-1 rounded hover:bg-red-50 transition">Eliminar</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modalNuevo && <ModalNuevoPallet origenes={origenes} bodegasVirtuales={bodegasVirtuales} onCrear={handleCrear} onClose={() => setModalNuevo(false)} />}

      {panelId != null && (
        <PanelEscaneo palletId={panelId} onClose={() => { setPanelId(null); fetchPallets(); }} onCambio={fetchPallets} />
      )}
    </>
  );
}
