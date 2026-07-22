import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { authHeader, usePuede } from "../context/AuthContext.jsx";
import AvisoModal from "../components/AvisoModal.jsx";
import { useAviso } from "../hooks/useAviso.js";

const API = "/api/bodega-fisica";

// Cada cuántos ms se refresca el mapa/pendientes/kardex en segundo plano. El candado real contra
// conflictos es el UNIQUE en la BD (el servidor revalida al confirmar) — esto solo mantiene la
// pantalla razonablemente fresca cuando hay varias estaciones trabajando.
const POLL_MS = 20000;

const ZOOMS = [8, 11, 15];

const CUADRE_BADGE = {
  Completo:   "bg-green-100 text-green-700",
  Incompleto: "bg-orange-100 text-orange-700",
  Sobrante:   "bg-red-100 text-red-700",
};

const TIPO_MOV_BADGE = {
  INGRESO:      "bg-green-100 text-green-700",
  DESUBICACION: "bg-orange-100 text-orange-700",
  SALIDA:       "bg-blue-100 text-blue-700",
};

function fmtFecha(iso) {
  return iso ? new Date(iso).toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" }) : "-";
}

async function leerJSON(res) {
  try { return await res.json(); } catch { return {}; }
}

function IconCandado({ className = "w-3.5 h-3.5" }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z" />
    </svg>
  );
}

// Estado derivado de una posición: la BD solo almacena Bloqueada; Ocupada = hay pallet apuntándola.
function estadoDe(pos) {
  if (!pos) return "libre";
  if (pos.Bloqueada) return "bloqueada";
  if (pos.PalletId != null) return "ocupada";
  return "libre";
}

// ── Mini-rack de la vista general (mapa de calor, NO es target táctil por celda: tocar selecciona
// el rack). Posiciones dibujadas de 8 → 1 y niveles de 4 → 1, igual que la numeración física. ──
function RackMini({ rack, posPorClave, activo, seleccionId, cellPx, onClick }) {
  const filas = [];
  let ocupadas = 0;
  for (let n = rack.Niveles; n >= 1; n--) {
    for (let p = rack.PosicionesPorNivel; p >= 1; p--) {
      const pos = posPorClave.get(`${rack.RackId}-${n}-${p}`);
      const estado = estadoDe(pos);
      if (estado === "ocupada") ocupadas++;
      let cls = "bg-green-100 border border-green-300";
      if (pos && seleccionId === pos.PosicionId) cls = "bg-white border-2 border-blue-600";
      else if (estado === "ocupada") cls = "bg-blue-500 border border-blue-600";
      else if (estado === "bloqueada") cls = "bg-red-500 border border-red-600";
      filas.push(<span key={`${n}-${p}`} className={`rounded-[3px] ${cls}`} style={{ width: cellPx, height: cellPx }} />);
    }
  }
  const total = rack.Niveles * rack.PosicionesPorNivel;
  return (
    <button onClick={onClick}
      className={`rounded-lg border-2 bg-white p-1.5 text-left transition ${activo ? "border-blue-600 ring-2 ring-blue-200" : "border-gray-200 hover:border-blue-300"}`}>
      <div className="text-[11px] font-bold text-center whitespace-nowrap mb-1">{rack.Nombre}</div>
      <div className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${rack.PosicionesPorNivel}, ${cellPx}px)` }}>
        {filas}
      </div>
      <div className="text-[9px] text-gray-400 text-center mt-1">{ocupadas} / {total}</div>
    </button>
  );
}

export default function BodegaFisicaPage() {
  const puedeUbicar = usePuede("bodega", "escanear");
  const puedeEditar = usePuede("bodega", "editar");
  const { aviso, mostrarAlerta, pedirConfirmacion, cerrar } = useAviso();

  const [mapa, setMapa] = useState({ Racks: [], Posiciones: [] });
  const [pendientes, setPendientes] = useState([]);
  const [movimientos, setMovimientos] = useState([]);
  const [loading, setLoading] = useState(true);

  const [palletActivo, setPalletActivo] = useState(null);   // fila de pendientes
  const [rackActivo, setRackActivo] = useState(null);       // RackId
  const [seleccion, setSeleccion] = useState(null);         // posición elegida (objeto del mapa)
  const [posInfo, setPosInfo] = useState(null);             // posición consultada (ocupada/bloqueada/libre)
  const [detallePallet, setDetallePallet] = useState(null); // detalle del pallet de posInfo (lazy)

  const [valorEscaneo, setValorEscaneo] = useState("");
  const [mensaje, setMensaje] = useState(null);             // { ok, texto }
  const [enviando, setEnviando] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [motivoAccion, setMotivoAccion] = useState("");     // des-ubicar / bloquear

  const inputRef = useRef(null);
  const detalleRef = useRef(null);
  const cachePallets = useRef(new Map());

  const fetchTodo = useCallback(async () => {
    const [resMapa, resPend, resMov] = await Promise.all([
      fetch(`${API}/mapa`, { headers: authHeader() }),
      fetch(`${API}/pendientes`, { headers: authHeader() }),
      fetch(`${API}/movimientos?limit=12`, { headers: authHeader() }),
    ]);
    if (resMapa.ok) { const d = await resMapa.json(); if (d.Posiciones) setMapa(d); }
    if (resPend.ok) { const d = await resPend.json(); if (Array.isArray(d)) setPendientes(d); }
    if (resMov.ok) { const d = await resMov.json(); if (Array.isArray(d)) setMovimientos(d); }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTodo();
    const t = setInterval(fetchTodo, POLL_MS);
    return () => clearInterval(t);
  }, [fetchTodo]);

  useEffect(() => { inputRef.current?.focus(); }, [palletActivo, mensaje]);

  // Índice rack-nivel-posición → posición (se reconstruye con cada refresco del mapa).
  const posPorClave = useMemo(() => {
    const m = new Map();
    for (const pos of mapa.Posiciones) m.set(`${pos.RackId}-${pos.Nivel}-${pos.Posicion}`, pos);
    return m;
  }, [mapa]);

  const conteos = useMemo(() => {
    const c = { libre: 0, ocupada: 0, bloqueada: 0 };
    for (const pos of mapa.Posiciones) c[estadoDe(pos)]++;
    return c;
  }, [mapa]);
  const totalPos = mapa.Posiciones.length;
  const pctOcupacion = totalPos ? Math.round((conteos.ocupada / totalPos) * 100) : 0;

  // Si el mapa se refrescó y la posición seleccionada dejó de estar libre (otra estación la ganó),
  // se suelta la selección — el candado real igual está en el servidor, esto solo avisa antes.
  useEffect(() => {
    if (!seleccion) return;
    const actual = mapa.Posiciones.find(p => p.PosicionId === seleccion.PosicionId);
    if (actual && estadoDe(actual) !== "libre") {
      setSeleccion(null);
      setMensaje({ ok: false, texto: `La posición ${actual.Codigo} acaba de ocuparse — elige otra.` });
    }
  }, [mapa, seleccion]);

  const cargarPallet = (fila) => {
    setPalletActivo(fila);
    setSeleccion(null);
    setMensaje({ ok: true, texto: `${fila.Codigo} — ${fila.CantidadMasters} masters · ${fila.PesoKg.toFixed(2)} kg. Elige una posición verde en el mapa.` });
  };

  const handleEscanear = (e) => {
    e.preventDefault();
    const valor = valorEscaneo.trim().toUpperCase();
    setValorEscaneo("");
    if (!valor) return;
    const fila = pendientes.find(p => p.Codigo === valor);
    if (fila) { cargarPallet(fila); return; }
    const ubicado = mapa.Posiciones.find(p => p.PalletCodigo === valor);
    if (ubicado) {
      // No es un error — ya está ubicado, así que en vez de solo avisarlo con texto, se salta
      // directo a su rack y posición (mismo efecto que si el operador la hubiera tocado a mano)
      // para que la encuentre de un vistazo, sin tener que buscarla ella misma en el mapa.
      setMensaje({ ok: true, tipo: "info", texto: `${valor} ya está ubicado en ${ubicado.Codigo} — mostrando su posición.` });
      abrirRack(ubicado.RackId);
      consultarPosicion(ubicado);
      return;
    }
    setMensaje({ ok: false, texto: `${valor}: QR no reconocido o el pallet no está pendiente de ubicar (¿ya se cerró?).` });
  };

  const abrirRack = (rackId) => {
    setRackActivo(rackId);
    setPosInfo(null);
    setDetallePallet(null);
    if (window.matchMedia("(max-width: 1279px)").matches) {
      setTimeout(() => detalleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  };

  const consultarPosicion = async (pos) => {
    setPosInfo(pos);
    setDetallePallet(null);
    setMotivoAccion("");
    if (pos.PalletId == null) return;
    if (cachePallets.current.has(pos.PalletId)) { setDetallePallet(cachePallets.current.get(pos.PalletId)); return; }
    const res = await fetch(`/api/pallets/${pos.PalletId}`, { headers: authHeader() });
    if (res.ok) {
      const data = await res.json();
      cachePallets.current.set(pos.PalletId, data);
      setDetallePallet(data);
    }
  };

  const clickPosicion = (pos) => {
    const estado = estadoDe(pos);
    if (estado !== "libre") { consultarPosicion(pos); return; }
    if (!palletActivo) {
      consultarPosicion(pos);
      setMensaje({ ok: false, texto: "Primero escanea o toca un pallet pendiente de ubicar." });
      return;
    }
    setPosInfo(null);
    setSeleccion(seleccion?.PosicionId === pos.PosicionId ? null : pos);
  };

  const handleConfirmar = async () => {
    if (!palletActivo || !seleccion || enviando) return;
    setEnviando(true);
    try {
      const res = await fetch(`${API}/ubicar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ PalletId: palletActivo.PalletId, PosicionId: seleccion.PosicionId }),
      });
      const data = await leerJSON(res);
      if (res.ok) {
        setMensaje({ ok: true, texto: `${data.PalletCodigo} ubicado en ${data.PosicionCodigo} — movimiento registrado, contenido sellado.` });
        cachePallets.current.delete(palletActivo.PalletId);
        setPalletActivo(null);
        setSeleccion(null);
      } else {
        setMensaje({ ok: false, texto: data.error || "No se pudo ubicar el pallet" });
        setSeleccion(null);
      }
      await fetchTodo();
    } finally {
      setEnviando(false);
    }
  };

  const handleDesubicar = async () => {
    if (!posInfo?.PalletId) return;
    const motivo = motivoAccion.trim();
    if (!motivo) { await mostrarAlerta("Escribe el motivo de la des-ubicación."); return; }
    const confirmado = await pedirConfirmacion(
      `¿Des-ubicar el pallet ${posInfo.PalletCodigo} de ${posInfo.Codigo}? Volverá a pendientes de ubicar y el movimiento queda registrado.`,
      { textoConfirmar: "Des-ubicar" }
    );
    if (!confirmado) return;
    const res = await fetch(`${API}/desubicar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ PalletId: posInfo.PalletId, Motivo: motivo }),
    });
    const data = await leerJSON(res);
    if (res.ok) {
      setMensaje({ ok: true, texto: `${data.PalletCodigo} des-ubicado de ${data.PosicionCodigo}.` });
      cachePallets.current.delete(posInfo.PalletId);
      setPosInfo(null);
      await fetchTodo();
    } else {
      await mostrarAlerta("Error: " + (data.error || "No se pudo des-ubicar"));
    }
  };

  const handleBloqueo = async (accion) => {
    if (!posInfo) return;
    const motivo = motivoAccion.trim();
    if (accion === "bloquear" && !motivo) { await mostrarAlerta("Escribe el motivo del bloqueo."); return; }
    const res = await fetch(`${API}/posiciones/${posInfo.PosicionId}/${accion}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(accion === "bloquear" ? { Motivo: motivo } : {}),
    });
    const data = await leerJSON(res);
    if (res.ok) { setPosInfo(null); await fetchTodo(); }
    else await mostrarAlerta("Error: " + (data.error || "No se pudo actualizar la posición"));
  };

  const rackSel = mapa.Racks.find(r => r.RackId === rackActivo);
  const cellPx = ZOOMS[zoom];

  // Filas del rack activo (niveles 4 → 1, posiciones 8 → 1 — misma orientación que los mini-racks).
  const filasDetalle = [];
  if (rackSel) {
    for (let n = rackSel.Niveles; n >= 1; n--) {
      const celdas = [];
      for (let p = rackSel.PosicionesPorNivel; p >= 1; p--) {
        const pos = posPorClave.get(`${rackSel.RackId}-${n}-${p}`);
        if (!pos) { celdas.push(<span key={p} />); continue; }
        const estado = estadoDe(pos);
        const seleccionada = seleccion?.PosicionId === pos.PosicionId;
        // Distinta de "seleccionada" (esa es para elegir dónde ubicar un pallet nuevo): esta marca
        // la celda que se acaba de encontrar por escaneo/consulta, para ubicarla de un vistazo entre
        // el resto de celdas azules "Ocupada" que se ven todas iguales.
        const consultada = posInfo?.PosicionId === pos.PosicionId;
        let cls = "bg-green-100 border border-green-300 text-green-700" + (palletActivo ? " hover:bg-green-200 cursor-pointer" : " cursor-pointer");
        let contenido = p;
        if (seleccionada) { cls = "bg-white border-[3px] border-blue-600 text-blue-700 ring-2 ring-blue-300 animate-pulse cursor-pointer"; contenido = "✓"; }
        else if (estado === "ocupada") { cls = `bg-blue-500 border border-blue-600 text-white cursor-pointer${consultada ? " ring-4 ring-yellow-300 animate-pulse" : ""}`; }
        else if (estado === "bloqueada") { cls = `bg-red-100 border border-red-400 text-red-700 cursor-pointer${consultada ? " ring-4 ring-yellow-300 animate-pulse" : ""}`; contenido = <IconCandado />; }
        celdas.push(
          <button key={p} onClick={() => clickPosicion(pos)} title={pos.Codigo}
            className={`min-h-[42px] rounded-lg text-xs font-bold flex items-center justify-center transition ${cls}`}>
            {contenido}
          </button>
        );
      }
      filasDetalle.push(
        <div key={n} className="grid grid-cols-[44px_repeat(8,1fr)] gap-1.5 items-stretch">
          <span className="text-[10px] font-bold text-gray-400 flex items-center">Nivel {n}</span>
          {celdas}
        </div>
      );
    }
  }

  const estadoPosInfo = posInfo ? estadoDe(posInfo) : null;

  return (
    <>
      <div className={palletActivo && seleccion ? "pb-24" : ""}>
        <div className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)_320px] gap-3 items-start">

          {/* ── Riel izquierdo: escaneo + pendientes + pallet activo + leyenda ── */}
          <div className="space-y-3">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200">
              <div className="px-4 pt-3 flex gap-2 text-[11px] text-gray-400">
                <span className="font-semibold text-blue-600">1 Escanear</span>
                <span>›</span>
                <span className={palletActivo ? "font-semibold text-blue-600" : ""}>2 Posición</span>
                <span>›</span>
                <span className={seleccion ? "font-semibold text-blue-600" : ""}>3 Confirmar</span>
              </div>
              <div className="px-4 py-3">
                {!puedeUbicar && (
                  <div className="mb-2 text-xs px-3 py-2 rounded-lg bg-amber-50 text-amber-700 border border-amber-200">
                    No tienes permiso para ubicar pallets — solo consulta.
                  </div>
                )}
                <form onSubmit={handleEscanear}>
                  <input ref={inputRef} type="text" value={valorEscaneo} onChange={e => setValorEscaneo(e.target.value)}
                    autoFocus disabled={!puedeUbicar}
                    placeholder="Escanea la hoja del pallet..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-50" />
                </form>
                {mensaje && (
                  <div className={`mt-2 text-xs px-3 py-2 rounded-lg border ${
                    mensaje.tipo === "info"
                      ? "bg-green-50 text-green-700 border-green-400 font-semibold shadow-[0_0_8px_1px_rgba(74,222,128,0.7),0_0_20px_4px_rgba(74,222,128,0.4)]"
                      : mensaje.ok ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"
                  }`}>
                    {mensaje.texto}
                  </div>
                )}
              </div>
            </div>

            {palletActivo && (
              <div className="bg-white rounded-xl shadow-sm border border-blue-200">
                <div className="px-4 py-2.5 border-b border-blue-100 bg-blue-50 rounded-t-xl flex items-center gap-2">
                  <h3 className="text-xs font-bold text-blue-800 uppercase tracking-wide">Pallet {palletActivo.Codigo}</h3>
                  {palletActivo.Cuadre && (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${CUADRE_BADGE[palletActivo.Cuadre] || "bg-gray-100 text-gray-600"}`}>{palletActivo.Cuadre}</span>
                  )}
                </div>
                <div className="px-4 py-3 text-xs space-y-1">
                  <div className="flex justify-between gap-2"><span className="text-gray-400">Bodega virtual</span><span className="font-medium text-right">{palletActivo.NombreBodegaVirtual || "-"}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-gray-400">Masters</span><span className="font-medium">{palletActivo.CantidadMasters}{palletActivo.CantidadMaster != null ? ` / ${palletActivo.CantidadMaster}` : ""}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-gray-400">Peso</span><span className="font-medium">{palletActivo.PesoKg.toFixed(2)} kg · {palletActivo.PesoLb.toFixed(2)} lb</span></div>
                  {palletActivo.Productos && <div className="flex justify-between gap-2"><span className="text-gray-400">Producto</span><span className="font-medium text-right">{palletActivo.Productos}</span></div>}
                  {palletActivo.Lotes && <div className="flex justify-between gap-2"><span className="text-gray-400">Lote{palletActivo.Lotes.includes(",") ? "s" : ""}</span><span className="font-mono font-medium text-right">{palletActivo.Lotes}</span></div>}
                  {palletActivo.Clientes && <div className="flex justify-between gap-2"><span className="text-gray-400">Cliente</span><span className="font-medium text-right">{palletActivo.Clientes}</span></div>}
                  {palletActivo.Cuadre === "Incompleto" && (
                    <div className="mt-2 px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200">
                      Cuadre Incompleto ({palletActivo.CantidadMasters} de {palletActivo.CantidadMaster}) — puede ubicarse; la diferencia queda registrada.
                    </div>
                  )}
                  <button onClick={() => { setPalletActivo(null); setSeleccion(null); setMensaje(null); }}
                    className="mt-2 w-full py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition">
                    Cancelar — volver a pendientes
                  </button>
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl shadow-sm border border-gray-200">
              <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Leyenda</h3>
                <span className="text-[11px] text-gray-500">Ocupación <b className="text-gray-800">{pctOcupacion}%</b> · {conteos.ocupada}/{totalPos}</span>
              </div>
              <div className="px-4 py-3 space-y-1.5 text-xs">
                <div className="flex items-center gap-2"><span className="w-4 h-4 rounded bg-green-100 border border-green-300" /> Disponible <span className="ml-auto text-gray-400 tabular-nums">{conteos.libre}</span></div>
                <div className="flex items-center gap-2"><span className="w-4 h-4 rounded bg-blue-500 border border-blue-600" /> Ocupada <span className="ml-auto text-gray-400 tabular-nums">{conteos.ocupada}</span></div>
                <div className="flex items-center gap-2"><span className="w-4 h-4 rounded bg-red-100 border border-red-400 text-red-600 flex items-center justify-center"><IconCandado className="w-2.5 h-2.5" /></span> Bloqueada <span className="ml-auto text-gray-400 tabular-nums">{conteos.bloqueada}</span></div>
              </div>
            </div>
          </div>

          {/* ── Mapa central ── */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 min-w-0">
            <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
              <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mr-auto">Vista general de bodega (2D)</h3>
              <button onClick={() => setZoom(z => Math.max(0, z - 1))} title="Alejar"
                className="w-7 h-7 rounded-lg border border-gray-200 text-gray-500 hover:border-blue-400 hover:text-blue-600 transition leading-none">−</button>
              <button onClick={() => setZoom(z => Math.min(ZOOMS.length - 1, z + 1))} title="Acercar"
                className="w-7 h-7 rounded-lg border border-gray-200 text-gray-500 hover:border-blue-400 hover:text-blue-600 transition leading-none">+</button>
            </div>
            <div className="p-3 overflow-x-auto">
              {loading ? (
                <p className="text-gray-400 text-sm py-8 text-center">Cargando mapa…</p>
              ) : (
                <div className="grid gap-2.5 justify-start" style={{ gridTemplateColumns: "repeat(10, max-content)" }}>
                  {mapa.Racks.map(r => (
                    <RackMini key={r.RackId} rack={r} posPorClave={posPorClave} cellPx={cellPx}
                      activo={rackActivo === r.RackId} seleccionId={seleccion?.PosicionId}
                      onClick={() => abrirRack(r.RackId)} />
                  ))}
                </div>
              )}
            </div>
            <div className="px-4 py-2 border-t border-gray-100 text-[11px] text-gray-400">
              {palletActivo
                ? `Toca un rack y elige una posición verde para ${palletActivo.Codigo} — la barra azul de confirmación aparecerá abajo.`
                : "Toca un rack para ver sus niveles y posiciones."}
            </div>
          </div>

          {/* ── Detalle de rack ── */}
          <div ref={detalleRef} className="bg-white rounded-xl shadow-sm border border-gray-200">
            <div className="px-4 py-2.5 border-b border-gray-100 flex items-baseline gap-2">
              <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">{rackSel ? rackSel.Nombre : "Detalle de rack"}</h3>
              {rackSel && (
                <span className="ml-auto text-[11px] text-gray-400 tabular-nums">
                  {mapa.Posiciones.filter(p => p.RackId === rackSel.RackId && estadoDe(p) === "ocupada").length} / {rackSel.Niveles * rackSel.PosicionesPorNivel} ocupadas
                </span>
              )}
            </div>
            <div className="px-3 py-3">
              {!rackSel ? (
                <p className="text-xs text-gray-400 text-center py-8">Toca un rack en el mapa<br />para ver sus niveles.</p>
              ) : (
                <div className="space-y-1.5">{filasDetalle}</div>
              )}

              {posInfo && (
                <div className="mt-3 pt-3 border-t border-dashed border-gray-200 text-xs">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${estadoPosInfo === "ocupada" ? "bg-blue-500" : estadoPosInfo === "bloqueada" ? "bg-red-500" : "bg-green-400"}`} />
                    <span className="font-mono font-bold">{posInfo.Codigo}</span>
                    <span className="text-gray-400">· {estadoPosInfo === "ocupada" ? "Ocupada" : estadoPosInfo === "bloqueada" ? "Bloqueada" : "Disponible"}</span>
                    <button onClick={() => setPosInfo(null)} className="ml-auto text-gray-300 hover:text-gray-500">&times;</button>
                  </div>

                  {estadoPosInfo === "ocupada" && (
                    <div className="space-y-1">
                      <div className="flex justify-between gap-2"><span className="text-gray-400">Pallet</span><span className="font-mono font-bold">{posInfo.PalletCodigo}</span></div>
                      {detallePallet ? (
                        <>
                          <div className="flex justify-between gap-2"><span className="text-gray-400">Masters</span><span className="font-medium">{detallePallet.Masters.length}</span></div>
                          <div className="flex justify-between gap-2"><span className="text-gray-400">Peso</span><span className="font-medium">{detallePallet.Masters.reduce((a, m) => a + m.PesoMasterKG, 0).toFixed(2)} kg</span></div>
                          <div className="flex justify-between gap-2"><span className="text-gray-400">Producto{new Set(detallePallet.Masters.map(m => m.DescripcionProceso)).size > 1 ? "s" : ""}</span><span className="font-medium text-right">{[...new Set(detallePallet.Masters.map(m => m.DescripcionProceso))].join(", ")}</span></div>
                        </>
                      ) : (
                        <p className="text-gray-300">Cargando contenido…</p>
                      )}
                      {puedeEditar && (
                        <div className="mt-2 space-y-1.5">
                          <input type="text" value={motivoAccion} onChange={e => setMotivoAccion(e.target.value)}
                            placeholder="Motivo de la des-ubicación..."
                            className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-300" />
                          <button onClick={handleDesubicar}
                            className="w-full py-1.5 rounded-lg bg-orange-500 text-white font-semibold hover:bg-orange-600 transition">
                            Des-ubicar (corrección)
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {estadoPosInfo === "bloqueada" && (
                    <div className="space-y-1">
                      <div className="flex justify-between gap-2"><span className="text-gray-400">Motivo</span><span className="font-medium text-right">{posInfo.MotivoBloqueo || "-"}</span></div>
                      <div className="flex justify-between gap-2"><span className="text-gray-400">Bloqueada</span><span className="font-medium text-right">{fmtFecha(posInfo.BloqueadaEn)}{posInfo.BloqueadaPor ? ` · ${posInfo.BloqueadaPor}` : ""}</span></div>
                      {puedeEditar && (
                        <button onClick={() => handleBloqueo("desbloquear")}
                          className="mt-2 w-full py-1.5 rounded-lg border border-gray-300 text-gray-600 font-semibold hover:bg-gray-50 transition">
                          Desbloquear posición
                        </button>
                      )}
                    </div>
                  )}

                  {estadoPosInfo === "libre" && (
                    <div className="space-y-1.5">
                      <p className="text-gray-400">{palletActivo ? "Tócala de nuevo para seleccionarla." : "Escanea un pallet para poder seleccionarla."}</p>
                      {puedeEditar && (
                        <>
                          <input type="text" value={motivoAccion} onChange={e => setMotivoAccion(e.target.value)}
                            placeholder="Motivo del bloqueo..."
                            className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-300" />
                          <button onClick={() => handleBloqueo("bloquear")}
                            className="w-full py-1.5 rounded-lg border border-red-300 text-red-600 font-semibold hover:bg-red-50 transition">
                            Bloquear posición
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Kardex reciente ── */}
        <div className="mt-3 bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="px-4 py-2.5 border-b border-gray-100">
            <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Últimos movimientos</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-gray-400 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Fecha</th>
                  <th className="px-4 py-2 text-left font-semibold">Tipo</th>
                  <th className="px-4 py-2 text-left font-semibold">Pallet</th>
                  <th className="px-4 py-2 text-left font-semibold">Origen</th>
                  <th className="px-4 py-2 text-left font-semibold">Destino</th>
                  <th className="px-4 py-2 text-left font-semibold">Usuario</th>
                  <th className="px-4 py-2 text-left font-semibold">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {movimientos.map(m => (
                  <tr key={m.MovimientoId} className="border-t border-gray-50">
                    <td className="px-4 py-2 whitespace-nowrap text-gray-500">{fmtFecha(m.Fecha)}</td>
                    <td className="px-4 py-2">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TIPO_MOV_BADGE[m.Tipo] || "bg-gray-100 text-gray-600"}`}>{m.Tipo}</span>
                    </td>
                    <td className="px-4 py-2 font-mono font-semibold">{m.PalletCodigo}</td>
                    <td className="px-4 py-2 font-mono whitespace-nowrap">{m.PosicionOrigen || (m.NombreBodegaVirtual ? `BV ${m.NombreBodegaVirtual}` : "-")}</td>
                    <td className="px-4 py-2 font-mono whitespace-nowrap">{m.PosicionDestino || "-"}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{m.Usuario || "-"}</td>
                    <td className="px-4 py-2 text-gray-500">{m.Motivo || "-"}</td>
                  </tr>
                ))}
                {!loading && movimientos.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">Sin movimientos todavía</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Barra fija de confirmación (paso 3) — visible sin importar el scroll ── */}
      {palletActivo && seleccion && (
        <div className="fixed inset-x-0 bottom-0 z-40 bg-white/95 border-t-2 border-blue-600 shadow-[0_-8px_24px_rgba(16,24,40,0.14)]">
          <div className="max-w-screen-2xl mx-auto px-4 py-2.5 flex items-center gap-3 flex-wrap">
            <div>
              <div className="text-sm">
                Ubicar <span className="font-mono font-bold">{palletActivo.Codigo}</span> en <span className="font-mono font-bold">{seleccion.Codigo}</span>
              </div>
              <div className="text-[11px] text-gray-400">
                Rack {seleccion.RackId} · Nivel {seleccion.Nivel} · Posición {seleccion.Posicion} — al confirmar se asigna la ubicación y se registra el movimiento.
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => setSeleccion(null)}
                className="px-3 py-2 rounded-lg border border-gray-200 text-xs text-gray-500 hover:bg-gray-50 transition">
                Quitar selección
              </button>
              <button onClick={handleConfirmar} disabled={enviando}
                className="px-6 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 transition disabled:opacity-50">
                {enviando ? "Ubicando..." : "✓ Confirmar ubicación"}
              </button>
            </div>
          </div>
        </div>
      )}

      {aviso && <AvisoModal {...aviso} onCerrar={() => cerrar(true)} onCancelar={() => cerrar(false)} />}
    </>
  );
}
