import { useState, useEffect, useCallback, useRef } from "react";
import { authHeader } from "../context/AuthContext.jsx";
import { useColWidths, Th, Colgroup } from "../components/ResizableTh.jsx";

const COL_DEFAULTS = { empleado: 110, nombre: 190, termo: 90, peso: 100, hora: 90, acciones: 110 };
const COLS = Object.keys(COL_DEFAULTS);

function SelectorTransacciones({ transacciones, seleccionada, onSelect, onCerrar }) {
  const [busqueda, setBusqueda] = useState("");
  const q = busqueda.toLowerCase();
  const filtradas = transacciones.filter(t =>
    t.Lote.toLowerCase().includes(q) || t.DescripcionProceso.toLowerCase().includes(q) || t.ClasePT.toLowerCase().includes(q)
  );
  return (
    <div className="bg-white border border-gray-300 rounded-xl shadow-sm p-3 mb-4">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-xs font-semibold text-gray-500 uppercase shrink-0">Transacciones Abiertas</span>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar por lote, proceso o producto..."
          className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {filtradas.map(t => {
          const activa = seleccionada?.TransaccionId === t.TransaccionId;
          return (
            <div key={t.TransaccionId}
              className={`shrink-0 text-left border rounded-lg px-3 py-2 transition min-w-[200px] ${
                activa ? "bg-blue-600 border-blue-600 text-white" : "border-gray-200 hover:bg-blue-50 hover:border-blue-300"
              }`}>
              <button onClick={() => onSelect(t)} className="w-full text-left">
                <p className={`font-mono font-bold ${activa ? "text-white" : "text-gray-800"}`}>{t.Lote}</p>
                <p className={`text-xs ${activa ? "text-blue-100" : "text-gray-500"}`}>{t.DescripcionProceso} → {t.ClasePT} ({t.DescripcionTalla})</p>
                <p className={`text-xs font-semibold ${activa ? "text-white" : "text-blue-700"}`}>{t.Procesado.toFixed(1)} kg</p>
              </button>
              <button onClick={() => onCerrar(t)}
                className={`mt-1 text-xs font-medium underline ${activa ? "text-blue-100 hover:text-white" : "text-amber-600 hover:text-amber-700"}`}>
                Cerrar
              </button>
            </div>
          );
        })}
        {filtradas.length === 0 && <p className="text-sm text-gray-400 py-2">Sin transacciones abiertas</p>}
      </div>
    </div>
  );
}

function EditarPesajeModal({ item, onSave, onClose }) {
  const [numeroTermo, setNumeroTermo] = useState(item.NumeroTermo);
  const [peso, setPeso] = useState(item.Peso);
  const handleSubmit = e => { e.preventDefault(); onSave({ NumeroTermo: numeroTermo, Peso: peso }); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">Editar Pesaje — {item.Codigo}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Número de Termo *</label>
            <input required type="text" inputMode="numeric" pattern="[0-9]*" autoFocus value={numeroTermo} onChange={e => setNumeroTermo(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Peso *</label>
            <input required type="number" step="0.01" value={peso} onChange={e => setPeso(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition">Cancelar</button>
            <button type="submit" className="px-5 py-2 text-sm bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition">Guardar</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function PesajePage() {
  const [transacciones, setTransacciones] = useState([]);
  const [transSel, setTransSel] = useState(null);
  const [lote, setLote] = useState(null);

  const [termos, setTermos] = useState([]);
  const [numeroTermo, setNumeroTermo] = useState("");

  const [pesajes, setPesajes] = useState([]);
  const [loadingPesajes, setLoadingPesajes] = useState(false);

  const [peso, setPeso] = useState("");
  const [codigoInput, setCodigoInput] = useState("");
  const [ultimoEmpleado, setUltimoEmpleado] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [areaActualError, setAreaActualError] = useState(undefined);
  const [guardando, setGuardando] = useState(false);
  const [modalEditar, setModalEditar] = useState(null);
  const [widths, startResize] = useColWidths("pesajes", COL_DEFAULTS);

  const termoRef = useRef(null);
  const codigoRef = useRef(null);
  const pesoRef = useRef(null);

  const fetchTransaccionesAbiertas = useCallback(async () => {
    const res = await fetch("/api/transacciones-produccion?estado=Abierta", { headers: authHeader() });
    const data = await res.json();
    if (Array.isArray(data)) setTransacciones(data);
  }, []);

  useEffect(() => { fetchTransaccionesAbiertas(); }, [fetchTransaccionesAbiertas]);

  // Hasta 10 pantallas distintas pueden estar abriendo/cerrando transacciones al mismo tiempo —
  // refrescar la lista sola para que todas vean los cambios de las demás sin recargar.
  useEffect(() => {
    const id = setInterval(fetchTransaccionesAbiertas, 20000);
    return () => clearInterval(id);
  }, [fetchTransaccionesAbiertas]);

  // codigoLote puede repetirse entre Clases del mismo Piscina+Ciclo+Fecha (ver
  // project_destajo_lote_clase_en_codigo) — claseOrigen (t.ClaseOrigen) es obligatoria para
  // encontrar la fila real de Materia Prima.
  const fetchLote = useCallback(async (codigoLote, claseOrigen) => {
    const res = await fetch("/api/lotes", { headers: authHeader() });
    const data = await res.json();
    if (Array.isArray(data)) setLote(data.find(l => l.Lote === codigoLote && l.Clase === claseOrigen) || null);
  }, []);

  const fetchTermos = useCallback(async (transaccionId) => {
    const res = await fetch(`/api/termos?transaccion=${transaccionId}`, { headers: authHeader() });
    const data = await res.json();
    if (Array.isArray(data)) setTermos(data);
  }, []);

  const fetchPesajes = useCallback(async (transaccionId) => {
    setLoadingPesajes(true);
    try {
      const res = await fetch(`/api/pesaje?transaccion=${transaccionId}`, { headers: authHeader() });
      const data = await res.json();
      if (Array.isArray(data)) setPesajes(data);
    } finally { setLoadingPesajes(false); }
  }, []);

  const seleccionarTransaccion = (t) => {
    setTransSel(t);
    setNumeroTermo("");
    setUltimoEmpleado(null);
    setErrorMsg("");
    setAreaActualError(undefined);
    fetchLote(t.Lote, t.ClaseOrigen);
    fetchTermos(t.TransaccionId);
    fetchPesajes(t.TransaccionId);
    setTimeout(() => termoRef.current?.focus(), 0);
  };

  const refrescarTodo = async () => {
    await Promise.all([
      fetchTermos(transSel.TransaccionId),
      fetchPesajes(transSel.TransaccionId),
      fetchLote(transSel.Lote, transSel.ClaseOrigen),
      fetchTransaccionesAbiertas(),
    ]);
  };

  const handleCodigoKey = (e) => {
    if (e.key !== "Enter" && e.key !== "Tab") return;
    e.preventDefault();
    if (!codigoInput.trim()) return;
    pesoRef.current?.focus();
  };

  const handlePesoKey = async (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const codigo = codigoInput.trim().toUpperCase();
    setAreaActualError(undefined);
    if (!transSel) { setErrorMsg("Primero seleccione una transacción"); return; }
    if (!numeroTermo) { setErrorMsg("Ingrese el número de termo"); termoRef.current?.focus(); return; }
    if (!codigo) { setErrorMsg("Escanee o escriba el código de empleado"); codigoRef.current?.focus(); return; }
    if (!peso || isNaN(parseFloat(peso))) { setErrorMsg("Ingrese el peso"); return; }

    setGuardando(true);
    setErrorMsg("");
    try {
      const res = await fetch("/api/pesaje", {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ TransaccionId: transSel.TransaccionId, NumeroTermo: numeroTermo, Codigo: codigo, Peso: peso }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "Error al registrar");
        setAreaActualError(data.areaActual); // undefined si el error no es de área, null si no tiene transferencia abierta, objeto si está en otra área
      }
      else {
        setUltimoEmpleado(data.empleado);
        setCodigoInput("");
        setPeso("");
        await refrescarTodo();
      }
    } catch {
      setErrorMsg("No se pudo conectar con el servidor");
    } finally {
      setGuardando(false);
      // El input sigue disabled en este tick (guardando aún no se repintó) — se difiere
      // el focus al próximo tick para que ya no esté deshabilitado cuando se ejecute.
      setTimeout(() => codigoRef.current?.focus(), 0);
    }
  };

  const handleEliminarPesaje = async (p) => {
    if (!confirm("¿Eliminar esta pesada?")) return;
    await fetch(`/api/pesaje/${p.PesajeId}`, { method: "DELETE", headers: authHeader() });
    refrescarTodo();
  };

  const handleGuardarEdicionPesaje = async (form) => {
    try {
      const res = await fetch(`/api/pesaje/${modalEditar.PesajeId}`, {
        method: "PUT", headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify(form),
      });
      if (res.ok) { setModalEditar(null); await refrescarTodo(); }
      else { const data = await res.json(); alert("Error: " + data.error); }
    } catch (err) {
      console.error("Error al editar el pesaje:", err);
      alert("No se pudo conectar con el servidor.");
    }
  };

  const handleCerrarTransaccion = async (t) => {
    if (!confirm(`¿Cerrar la transacción del lote ${t.Lote} (${t.ClasePT})? Ya no podrá registrar pesajes en ella.`)) return;
    try {
      const res = await fetch(`/api/transacciones-produccion/${t.TransaccionId}`, {
        method: "PUT", headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ Estado: "Cerrada" }),
      });
      if (!res.ok) { const data = await res.json(); alert("Error: " + data.error); return; }
      if (transSel?.TransaccionId === t.TransaccionId) {
        setTransSel(null);
        setLote(null);
        setNumeroTermo("");
      }
      await fetchTransaccionesAbiertas();
    } catch (err) {
      console.error("Error al cerrar la transacción:", err);
      alert("No se pudo conectar con el servidor.");
    }
  };

  const termoActual = termos.find(t => t.NumeroTermo === numeroTermo);
  const rendimiento = lote && lote.PesoIngreso > 0 ? (lote.Procesado / lote.PesoIngreso * 100) : 0;

  return (
    <div>
      <SelectorTransacciones transacciones={transacciones} seleccionada={transSel} onSelect={seleccionarTransaccion} onCerrar={handleCerrarTransaccion} />
      <div className="flex flex-col lg:flex-row gap-4">
      {/* Columna captura */}
      <div className="lg:w-[420px] lg:shrink-0 space-y-4">

        {lote && (
          <div className="bg-white border border-gray-300 rounded-xl shadow-sm p-3 space-y-3">
            <div className="grid grid-cols-4 gap-2">
              <div className="text-center">
                <p className="text-xs text-gray-400">Ingreso MP</p>
                <p className="text-xs font-mono font-semibold text-blue-600 truncate">{lote.Clase}</p>
                <p className="text-sm font-bold text-gray-800">{lote.PesoIngreso.toFixed(1)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-400">Procesado</p>
                <p className="text-xs font-mono font-semibold text-blue-600 truncate">&nbsp;</p>
                <p className="text-sm font-bold text-blue-700">{lote.Procesado.toFixed(1)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-400">Pendiente MP</p>
                <p className="text-xs font-mono font-semibold text-blue-600 truncate">{lote.Clase}</p>
                <p className={`text-sm font-bold ${lote.Pendiente < 0 ? "text-red-600" : "text-amber-600"}`}>{lote.Pendiente.toFixed(1)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-400">Rendimiento</p>
                <p className="text-xs font-mono font-semibold text-blue-600 truncate">&nbsp;</p>
                <p className="text-sm font-bold text-gray-700">{rendimiento.toFixed(1)}%</p>
              </div>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div className={`h-full transition-all ${rendimiento >= 100 ? "bg-red-600" : rendimiento >= 85 ? "bg-amber-500" : "bg-green-500"}`}
                style={{ width: `${Math.min(rendimiento, 100)}%` }} />
            </div>
          </div>
        )}

        <div className="bg-white border border-gray-300 rounded-xl shadow-sm p-4">
          <span className="text-xs font-semibold text-gray-500 uppercase">Termo</span>
          <input ref={termoRef} type="text" inputMode="numeric" pattern="[0-9]*" value={numeroTermo}
            onChange={e => { setNumeroTermo(e.target.value); setEditandoCapacidad(false); setCapacidadInput(""); }}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); codigoRef.current?.focus(); } }}
            disabled={!transSel} placeholder="Número de termo"
            className="w-full mt-2 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100" />
          {numeroTermo && !termoActual && (
            <p className="text-xs text-gray-500 mt-2">Termo nuevo — se crea con la primera pesada</p>
          )}
          {termoActual && (
            <div className="mt-2">
              {(() => {
                const cap = termoActual.Capacidad ?? 150;
                const pct = (termoActual.PesoAcumulado / cap) * 100;
                const falta = cap - termoActual.PesoAcumulado;
                return (
                  <>
                    <p className="text-xs text-gray-500">
                      Acumulado: <span className="font-semibold text-gray-700">{termoActual.PesoAcumulado.toFixed(2)} kg</span>
                      <span className="text-gray-400"> / {cap} kg</span>
                    </p>
                    <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden mt-1.5">
                      <div className={`h-full transition-all ${pct >= 100 ? "bg-red-600" : pct >= 80 ? "bg-amber-500" : "bg-green-500"}`}
                        style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                    <p className={`text-xs font-semibold mt-1 ${pct >= 100 ? "text-red-600" : pct >= 80 ? "text-amber-600" : "text-gray-500"}`}>
                      {falta > 0 ? `Faltan ${falta.toFixed(2)} kg` : `Termo lleno — excedido ${Math.abs(falta).toFixed(2)} kg`}
                    </p>
                  </>
                );
              })()}
            </div>
          )}
        </div>

        <div className="bg-white border border-gray-300 rounded-xl shadow-sm p-4 space-y-3">
          <span className="text-xs font-semibold text-gray-500 uppercase">Pesaje por Persona</span>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Código Empleado *</label>
            <input ref={codigoRef} value={codigoInput} onChange={e => setCodigoInput(e.target.value.toUpperCase())}
              onKeyDown={handleCodigoKey} disabled={guardando || !numeroTermo} placeholder="Escanear o escribir..." autoComplete="off"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono uppercase text-center focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Peso *</label>
            <input ref={pesoRef} type="number" step="0.01" value={peso} onChange={e => setPeso(e.target.value)}
              onKeyDown={handlePesoKey} disabled={guardando || !numeroTermo}
              placeholder="kg" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-3xl font-bold text-center text-red-600 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50" />
          </div>
          {ultimoEmpleado && !errorMsg && (
            <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg px-3 py-2">
              ✓ Registrado: <span className="font-semibold">{ultimoEmpleado.NombreCompleto}</span>
            </div>
          )}
          {errorMsg && (
            <div className="bg-red-50 border border-red-300 text-red-700 text-sm rounded-lg px-3 py-2">
              <p>{errorMsg}</p>
              {areaActualError !== undefined && (
                <p className="mt-1.5">
                  Área actual:{" "}
                  <span className="inline-block bg-red-600 text-white font-bold px-2 py-0.5 rounded">
                    {areaActualError ? `${areaActualError.Codigo} — ${areaActualError.Nombre}` : "Sin transferencia registrada"}
                  </span>
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Columna detalle de pesadas */}
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-medium text-gray-600 mb-2">Pesajes registrados {transSel ? <span className="font-mono font-bold text-gray-800">— {transSel.Lote}</span> : ""}</h3>



        {!transSel ? (
          <div className="bg-white rounded-xl shadow px-4 py-8 text-center text-gray-400 text-sm">Seleccione una transacción para ver sus pesajes</div>
        ) : loadingPesajes ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="bg-white rounded-xl shadow overflow-x-auto max-h-[640px] overflow-y-auto">
            <table className="w-full text-sm table-fixed">
              <Colgroup columns={COLS} widths={widths} />
              <thead>
                <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                  <Th width={widths.empleado} onResizeStart={startResize("empleado")} className="px-3 py-3 text-left whitespace-nowrap">Empleado</Th>
                  <Th width={widths.nombre} onResizeStart={startResize("nombre")} className="px-3 py-3 text-left whitespace-nowrap">Nombre</Th>
                  <Th width={widths.termo} onResizeStart={startResize("termo")} className="px-3 py-3 text-center whitespace-nowrap">Termo</Th>
                  <Th width={widths.peso} onResizeStart={startResize("peso")} className="px-3 py-3 text-right whitespace-nowrap">Peso</Th>
                  <Th width={widths.hora} onResizeStart={startResize("hora")} className="px-3 py-3 text-center whitespace-nowrap">Hora</Th>
                  <Th width={widths.acciones} onResizeStart={startResize("acciones")} className="px-3 py-3 text-center whitespace-nowrap">Acciones</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pesajes.map(p => (
                  <tr key={p.PesajeId} className="hover:bg-gray-50 transition">
                    <td className="px-3 py-2 font-mono text-gray-700 whitespace-nowrap">{p.Codigo}</td>
                    <td className="px-3 py-2 text-gray-900 whitespace-nowrap">{p.NombreCompleto}</td>
                    <td className="px-3 py-2 text-center whitespace-nowrap">#{p.NumeroTermo}</td>
                    <td className="px-3 py-2 text-right font-semibold whitespace-nowrap">{p.Peso.toFixed(2)}</td>
                    <td className="px-3 py-2 text-center text-gray-500 whitespace-nowrap">{p.FechaHora?.slice(11, 16)}</td>
                    <td className="px-3 py-2 text-center whitespace-nowrap">
                      <div className="flex justify-center gap-2">
                        <button onClick={() => setModalEditar(p)}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition">Editar</button>
                        <button onClick={() => handleEliminarPesaje(p)}
                          className="text-red-500 hover:text-red-700 text-xs font-medium px-2 py-1 rounded hover:bg-red-50 transition">Eliminar</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {pesajes.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Sin pesajes registrados</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </div>

      {modalEditar && (
        <EditarPesajeModal item={modalEditar} onSave={handleGuardarEdicionPesaje} onClose={() => setModalEditar(null)} />
      )}


    </div>
  );
}
