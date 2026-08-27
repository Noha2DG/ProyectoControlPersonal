import { useState, useEffect, useCallback, useRef } from "react";
import { fmtNum } from "../utils/numero.js";
import { authHeader, usePuede } from "../context/AuthContext.jsx";
import { useColWidths, useOrden, ordenarFilas, Th, Colgroup } from "../components/ResizableTh.jsx";
import ConsultarEtiquetaModal from "../components/ConsultarEtiquetaModal.jsx";
import AvisoModal from "../components/AvisoModal.jsx";
import HojaPalletModal from "../components/HojaPalletModal.jsx";
import ModalEscaneo from "../components/ModalEscaneo.jsx";
import { useAviso } from "../hooks/useAviso.js";

const API = "/api/pallets";

const MASTERS_COL_DEFAULTS = { correlativo: 100, pedido: 100, cliente: 150, lote: 110, procesoTallaPres: 170, kg: 80, lb: 80, hora: 130, acciones: 90 };
const MASTERS_COLS_BASE = ["correlativo", "pedido", "cliente", "lote", "procesoTallaPres", "kg", "lb", "hora"];
const PALLETS_COL_DEFAULTS = { pallet: 110, estatus: 100, area: 130, origen: 130, masters: 110, cuadre: 110, creado: 215, cerrado: 215, acciones: 130 };
const PALLETS_COLS = Object.keys(PALLETS_COL_DEFAULTS);

const ESTATUS_BADGE = {
  Abierto:    "bg-blue-100 text-blue-700",
  Cerrado:    "bg-green-100 text-green-700",
  // Despachado = salió completo en una remisión confirmada (ver remisiones.ts).
  Despachado: "bg-slate-200 text-slate-600",
  Cancelado:  "bg-gray-100 text-gray-500",
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

function calcularCuadre(cantidadMaster, escaneados) {
  if (cantidadMaster == null) return null;
  if (escaneados === cantidadMaster) return "Completo";
  return escaneados < cantidadMaster ? "Incompleto" : "Sobrante";
}

// La misma caja, con el signo de MÁS: es la caja que sube al polín viniendo de otro. Espeja al
// ícono de quitar para que los dos modales de tanda se lean como par.
const IconoTraerMaster = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
    <circle cx="17.5" cy="16.5" r="4.5" />
    <path strokeLinecap="round" d="M15.25 16.5h4.5M17.5 14.25v4.5" />
  </svg>
);

// La misma caja del master que se usa al cargar, con el signo de menos: es la caja que BAJA del
// polín. La figura hace de aviso de que este modal es el destructivo, junto con el color rojo.
const IconoQuitarMaster = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
    <circle cx="17.5" cy="16.5" r="4.5" />
    <path strokeLinecap="round" d="M15.25 16.5h4.5" />
  </svg>
);

// Panel de escaneo de un pallet — un solo pallet a la vez (mismo criterio operativo: la estación
// llena un pallet, lo cierra, recién ahí abre el siguiente). El input queda enfocado para que el
// lector 2D USB/Bluetooth (que escribe como si fuera teclado + Enter) alimente el escaneo sin mouse.
function PanelEscaneo({ palletId, onClose, onCambio }) {
  const puedeEscanear = usePuede("bodega", "escanear");
  const puedeEditar = usePuede("bodega", "editar");
  const { aviso, mostrarAlerta, pedirConfirmacion, cerrar } = useAviso();
  const [pallet, setPallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [correlativo, setCorrelativo] = useState("");
  const [mensaje, setMensaje] = useState(null); // { ok: bool, texto }
  const [mostrarHoja, setMostrarHoja] = useState(false);
  const [mostrarQuitar, setMostrarQuitar] = useState(false);
  const [mostrarTraer, setMostrarTraer] = useState(false);
  const inputRef = useRef(null);
  // Candado síncrono contra doble envío — el input NUNCA se deshabilita (deshabilitar un <input>
  // enfocado le quita el foco en el navegador, y a 50 masters/min el lector no puede darse el lujo
  // de reenfocar a mano en cada escaneo). Un estado en vez de ref no sirve: llega tarde un render.
  const enviandoRef = useRef(false);
  const [widths, startResize] = useColWidths("pallet_masters", MASTERS_COL_DEFAULTS);

  const fetchDetalle = useCallback(async () => {
    const res = await fetch(`${API}/${palletId}`, { headers: authHeader() });
    if (res.ok) setPallet(await res.json());
    setLoading(false);
  }, [palletId]);

  useEffect(() => { fetchDetalle(); }, [fetchDetalle]);
  useEffect(() => { if (pallet?.Estatus === "Abierto") inputRef.current?.focus(); }, [pallet?.Estatus, mensaje]);

  const abierto = pallet?.Estatus === "Abierto";
  const puedeQuitar = abierto && puedeEditar;
  // "Encima del polín" = lo que no salió. Es la base tanto del contador como del cupo, porque una
  // caja despachada libera lugar físico real.
  const enPolin = pallet?.Masters.filter(m => m.Estatus !== "Salido").length ?? 0;
  const cupoLibre = pallet?.CantidadMaster != null ? Math.max(0, pallet.CantidadMaster - enPolin) : null;
  const MASTERS_COLS = puedeQuitar ? [...MASTERS_COLS_BASE, "acciones"] : MASTERS_COLS_BASE;

  const handleEscanear = async (e) => {
    e.preventDefault();
    const valor = correlativo.trim();
    if (!valor || enviandoRef.current) return;
    enviandoRef.current = true;
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
        // Un traslado se ve distinto de un ingreso nuevo: si la caja vino de otro polín, el operador
        // tiene que notarlo (no es producción recién escaneada, es sobrante consolidado).
        const origen = data.Traslado ? ` · trasladado desde ${data.PalletOrigen}` : "";
        setMensaje({ ok: true, texto: `${m.Correlativo} — ${m.CodigoPedido} · ${m.NombreCliente}${m.NombreSubcliente ? "-" + m.NombreSubcliente : ""} · Lote ${m.Lote}${origen}` });
        // Se agrega el master ya devuelto por /escanear en vez de volver a pedir GET /:id — ese
        // endpoint reconstruye TODOS los masters del pallet con un join de 8 tablas, y repetirlo en
        // cada escaneo lo vuelve O(n²) según se llena el pallet (hasta 50 masters). Con esto el
        // costo por escaneo queda constante.
        setPallet(prev => {
          if (!prev) return prev;
          const masters = [...prev.Masters, m];
          return {
            ...prev, Masters: masters,
            // El master recién escaneado siempre entra EnBodega, así que el contador de "en el polín"
            // sube de a uno; los despachados no se tocan.
            CantidadMasters: (prev.CantidadMasters ?? 0) + 1,
            Cuadre: calcularCuadre(prev.CantidadMaster, masters.length),
          };
        });
        // No se llama onCambio() aquí: eso dispara el GET de la lista completa de pallets en el
        // padre, y a 50 escaneos/minuto sería una consulta extra por cada uno sin necesidad — la
        // lista ya se refresca al cerrar este panel (onClose) y al cerrar/reabrir el pallet.
      } else {
        setMensaje({ ok: false, texto: `${valor}: ${data.error || "No se pudo escanear"}` });
      }
    } finally {
      enviandoRef.current = false;
      // Foco explícito en vez de confiar solo en el efecto: el efecto depende de que `mensaje`
      // cambie de referencia, pero el input nunca se deshabilita ahora así que no hay blur que
      // revertir — este focus() es el que realmente importa entre escaneo y escaneo.
      inputRef.current?.focus();
    }
  };

  const handleQuitar = async (masterId, correlativoTexto) => {
    const confirmado = await pedirConfirmacion(`¿Quitar ${correlativoTexto} de este pallet? Podrá volver a escanearse.`, { textoConfirmar: "Quitar" });
    if (!confirmado) return;
    const res = await fetch(`${API}/${palletId}/masters/${masterId}`, { method: "DELETE", headers: authHeader() });
    const data = await leerJSON(res);
    if (res.ok) {
      // Si el master había llegado por traslado no se borra: vuelve a su polín de origen. Decirlo,
      // porque el operador espera "desapareció" y en realidad quedó en otro lado.
      if (data.Accion === "TrasladoDeshecho") {
        await mostrarAlerta(`${correlativoTexto} volvió al polín ${data.PalletOrigen} (había llegado aquí por traslado).`, "exito");
      }
      await fetchDetalle(); onCambio?.();
    }
    else await mostrarAlerta("Error: " + (data.error || "No se pudo quitar el master"));
  };

  // Quitar ESCANEANDO: el espejo exacto del escaneo de ingreso. Bajar 20 cajas mal puestas de un
  // polín buscándolas una por una en la tabla y confirmando cada una es donde se termina quitando la
  // que no era; con el lector, la caja que se baja es la que se quita. Sin confirmación por caja a
  // propósito — la confirmación es el acto físico de bajarla y pasarle el lector.
  // Traer una caja desde OTRO polín, incluso uno cerrado y ubicado en el rack. Es el mismo endpoint
  // de escaneo con la bandera DesdeSellado: el backend lo trata como traslado (mueve la fila, no
  // crea master nuevo) y deja el kardex con la posición de la que salió.
  const traerEscaneando = async (valor) => {
    const res = await fetch(`${API}/${palletId}/escanear`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ Correlativo: valor, DesdeSellado: true }),
    });
    const data = await leerJSON(res);
    if (!res.ok) throw new Error(data.error || "No se pudo traer el master");
    const m = data.Master;
    const desde = data.PalletOrigen
      ? ` · desde ${data.PalletOrigen}${data.PosicionOrigen ? ` (${data.PosicionOrigen})` : ""}`
      : "";
    // Que el polín de origen se haya quedado vacío es noticia: su casilla del rack acaba de
    // liberarse y quien está en piso tiene que saberlo para bajar la tarima.
    const liberada = data.PosicionLiberada ? ` · quedó libre ${data.PosicionLiberada}` : "";
    return `${m.Correlativo} — ${m.NombreCliente}${m.NombreSubcliente ? "-" + m.NombreSubcliente : ""} · ${m.DescripcionProceso} ${m.DescripcionTalla}${desde}${liberada}`;
  };

  const quitarEscaneando = async (valor) => {
    const res = await fetch(`${API}/${palletId}/quitar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ Correlativo: valor }),
    });
    const data = await leerJSON(res);
    if (!res.ok) throw new Error(data.error || "No se pudo quitar el master");

    // El detalle del master ya está cargado en pantalla, así que el renglón del historial se arma de
    // ahí en vez de pedirlo de nuevo — mismo criterio que el escaneo de ingreso, que tampoco refresca
    // el pallet completo en cada lectura.
    const m = pallet?.Masters.find(x => x.MasterId === data.MasterId);
    setPallet(prev => {
      if (!prev) return prev;
      const masters = prev.Masters.filter(x => x.MasterId !== data.MasterId);
      return {
        ...prev, Masters: masters,
        CantidadMasters: Math.max(0, (prev.CantidadMasters ?? 0) - 1),
        Cuadre: calcularCuadre(prev.CantidadMaster, masters.length),
      };
    });

    const detalle = m ? ` — ${m.CodigoPedido} · ${m.NombreCliente}${m.NombreSubcliente ? "-" + m.NombreSubcliente : ""} · Lote ${m.Lote}` : "";
    // Un traslado deshecho no desaparece: vuelve a su polín de origen, y el operador tiene que saber
    // dónde quedó la caja que acaba de bajar.
    const destino = data.Accion === "TrasladoDeshecho" ? ` · volvió al polín ${data.PalletOrigen}` : "";
    return `${data.Correlativo} quitado${detalle}${destino}`;
  };

  const handleCerrar = async () => {
    const confirmado = await pedirConfirmacion("¿Cerrar este pallet? No se podrán escanear más masters aquí.", { textoConfirmar: "Cerrar pallet" });
    if (!confirmado) return;
    const res = await fetch(`${API}/${palletId}/cerrar`, { method: "POST", headers: authHeader() });
    const data = await leerJSON(res);
    if (res.ok) { await fetchDetalle(); onCambio?.(); }
    else await mostrarAlerta("Error: " + (data.error || "No se pudo cerrar el pallet"));
  };

  // La capacidad frena el escaneo, así que tiene que ser corregible: un número mal tecleado al crear
  // el polín dejaría al operador trabado sin poder meter una caja que sí cabe.
  const handleAjustarCapacidad = async () => {
    const actual = pallet?.CantidadMaster ?? "";
    const valor = window.prompt(`Capacidad del polín ${pallet?.Codigo ?? ""} (cuántos masters caben):`, String(actual));
    if (valor == null) return;
    const res = await fetch(`${API}/${palletId}/capacidad`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ CantidadMaster: Number(valor) }),
    });
    const data = await leerJSON(res);
    if (res.ok) { await fetchDetalle(); onCambio?.(); }
    else await mostrarAlerta("Error: " + (data.error || "No se pudo ajustar la capacidad"));
  };

  // La capacidad frena el escaneo, así que tiene que ser corregible: un número mal tecleado al crear
  const handleReabrir = async () => {
    const res = await fetch(`${API}/${palletId}/reabrir`, { method: "PUT", headers: authHeader() });
    const data = await leerJSON(res);
    if (res.ok) { await fetchDetalle(); onCambio?.(); }
    else await mostrarAlerta("Error: " + (data.error || "No se pudo reabrir el pallet"));
  };

  return (
    <>
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-full flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="border-b border-gray-200 shrink-0">
          <div className="flex items-center justify-between px-5 py-4">
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
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg p-2 text-xl leading-none transition">&times;</button>
          </div>
          {/* Fila propia, con botones grandes tipo táctil — pensado para tablet/teléfono en piso de
              planta, no para links de texto chicos difíciles de presionar con el dedo. */}
          {/* "Consultar etiqueta" vivía acá adentro, pero consultar no tiene nada que ver con el
              polín que uno tenga abierto: se movió al encabezado de la lista, donde está siempre a
              la mano y además acepta códigos de polín. */}
          <div className="flex flex-wrap gap-2 px-5 pb-4">
            {/* También con el polín Abierto: la hoja es la forma de REVISAR en papel lo que lleva
                cargado antes de cerrarlo (se sale a cotejarla contra las cajas físicas), no solo el
                documento final del polín cerrado. La hoja misma se marca como preliminar. */}
            {pallet && (
              <button onClick={() => setMostrarHoja(true)}
                className="px-4 py-2.5 text-sm font-semibold text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 active:bg-purple-200 transition">
                Imprimir hoja
              </button>
            )}
            {/* Traer cajas de OTRO polín, incluso uno cerrado y ubicado. Pide 'bodega:editar' —el
                mismo permiso que des-ubicar— porque rompe el sello de un polín posicionado; el
                escaneo normal (bodega:escanear) sigue sin poder hacerlo. */}
            {abierto && puedeEditar && (
              <button onClick={() => setMostrarTraer(true)}
                className="px-4 py-2.5 text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 active:bg-amber-200 transition">
                + Master de otro Pallet
              </button>
            )}
            {puedeQuitar && (
              <button onClick={() => setMostrarQuitar(true)}
                className="px-4 py-2.5 text-sm font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 active:bg-red-200 transition">
                Quitar masters
              </button>
            )}
          </div>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1">
          {loading ? (
            <p className="text-gray-400 text-sm">Cargando…</p>
          ) : (
            <>
              {abierto && !puedeEscanear && (
                <div className="mb-3 text-sm px-3 py-2 rounded-lg bg-amber-50 text-amber-700 border border-amber-200">
                  No tienes permiso para escanear masters en este pallet.
                </div>
              )}
              {abierto && puedeEscanear && (
                <form onSubmit={handleEscanear} className="mb-3">
                  <div className="flex items-end justify-between gap-3 mb-1">
                    <div>
                      <label className="block text-xs font-medium text-gray-500">Escanear QR del master</label>
                      {/* El cupo restante se muestra ANTES de escanear: la capacidad ahora frena, y
                          enterarse al toparse con el error es tarde cuando ya tenés la caja en la mano. */}
                      {pallet?.CantidadMaster != null && (
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {cupoLibre > 0
                            ? <>Caben <span className="font-semibold text-gray-600">{cupoLibre}</span> más (capacidad {pallet.CantidadMaster})</>
                            : <span className="text-amber-700 font-semibold">Capacidad llena ({pallet.CantidadMaster})</span>}
                          {puedeEscanear && (
                            <button type="button" onClick={handleAjustarCapacidad} className="ml-2 text-blue-600 hover:text-blue-800 underline">ajustar</button>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="text-center px-3 py-1 rounded-lg bg-blue-50 border border-blue-100">
                      <div className="text-sm font-bold text-blue-700">
                        {enPolin} master{enPolin === 1 ? "" : "s"}
                      </div>
                      <div className="text-[10px] text-blue-500 whitespace-nowrap">
                        {/* Solo el peso de lo que sigue arriba: sumar los despachados daría un peso
                            que el polín ya no tiene. */}
                        {(pallet?.Masters.filter(m => m.Estatus !== "Salido").reduce((acc, m) => acc + m.PesoMasterKG, 0) ?? 0).toFixed(2)} kg acumulados
                      </div>
                    </div>
                  </div>
                  <input ref={inputRef} type="text" value={correlativo} onChange={e => setCorrelativo(e.target.value)}
                    autoFocus
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
                  {/* "En el polín" ≠ "escaneados alguna vez": lo despachado sigue listado abajo como
                      historia, pero no cuenta como carga presente. */}
                  {pallet?.CantidadMasters ?? 0}{pallet?.CantidadMaster != null ? ` / ${pallet.CantidadMaster}` : ""} master{pallet?.CantidadMasters === 1 ? "" : "s"} en el polín
                  {pallet?.CantidadSalidos > 0 && (
                    <span className="ml-2 text-xs font-normal text-slate-500">· {pallet.CantidadSalidos} ya despachado{pallet.CantidadSalidos === 1 ? "" : "s"}</span>
                  )}
                </span>
              </div>

              <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="w-full text-xs table-fixed">
                  <Colgroup columns={MASTERS_COLS} widths={widths} />
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <Th width={widths.correlativo} onResizeStart={startResize("correlativo")} className="px-3 py-2 text-left">Correlativo</Th>
                      <Th width={widths.pedido} onResizeStart={startResize("pedido")} className="px-3 py-2 text-left">Pedido</Th>
                      <Th width={widths.cliente} onResizeStart={startResize("cliente")} className="px-3 py-2 text-left">Cliente</Th>
                      <Th width={widths.lote} onResizeStart={startResize("lote")} className="px-3 py-2 text-left">Lote</Th>
                      <Th width={widths.procesoTallaPres} onResizeStart={startResize("procesoTallaPres")} className="px-3 py-2 text-left">Proceso/Talla/Pres.</Th>
                      <Th width={widths.kg} onResizeStart={startResize("kg")} className="px-3 py-2 text-right">Kg</Th>
                      <Th width={widths.lb} onResizeStart={startResize("lb")} className="px-3 py-2 text-right">Lb</Th>
                      <Th width={widths.hora} onResizeStart={startResize("hora")} className="px-3 py-2 text-left">Hora</Th>
                      {puedeQuitar && <Th width={widths.acciones} onResizeStart={startResize("acciones")} className="px-3 py-2 text-center">Acciones</Th>}
                    </tr>
                  </thead>
                  <tbody>
                    {pallet?.Masters.map(m => (
                      // Los despachados se listan pero atenuados: son historia del polín, no carga.
                      <tr key={m.MasterId} className={`border-t border-gray-100 ${m.Estatus === "Salido" ? "bg-slate-50 text-slate-400" : ""}`}>
                        <td className="px-3 py-2 font-mono truncate">
                          {m.Correlativo}
                          {m.Estatus === "Salido" && <span className="ml-1 text-[9px] font-sans font-semibold px-1 py-0.5 rounded bg-slate-200 text-slate-600">salió</span>}
                        </td>
                        {/* `truncate` y no `whitespace-nowrap` a secas: la tabla es de ancho fijo, y
                            sin recorte un nombre largo (ej. "RED CHAMBER COMPANY-RED CHAMBER") se
                            desborda de su columna y se pinta ENCIMA de la vecina. El title deja ver
                            el valor completo al pasar el mouse. */}
                        <td className="px-3 py-2 truncate" title={m.CodigoPedido}>{m.CodigoPedido}</td>
                        <td className="px-3 py-2 truncate" title={`${m.NombreCliente}${m.NombreSubcliente ? "-" + m.NombreSubcliente : ""}`}>
                          {m.NombreCliente}{m.NombreSubcliente ? `-${m.NombreSubcliente}` : ""}
                        </td>
                        <td className="px-3 py-2 font-mono truncate" title={m.Lote}>{m.Lote}</td>
                        <td className="px-3 py-2 truncate" title={`${m.DescripcionProceso} ${m.DescripcionTalla} ${m.DescripcionPresentacion}`}>
                          {m.DescripcionProceso} {m.DescripcionTalla} {m.DescripcionPresentacion}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">{fmtNum(m.PesoMasterKG)}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">{fmtNum(m.PesoMasterLb)}</td>
                        <td className="px-3 py-2 truncate" title={fmtFecha(m.FechaIngreso)}>{fmtFecha(m.FechaIngreso)}</td>
                        {puedeQuitar && (
                          <td className="px-3 py-2 text-center">
                            <button onClick={() => handleQuitar(m.MasterId, m.Correlativo)} className="text-red-600 hover:text-red-800 font-medium">Quitar</button>
                          </td>
                        )}
                      </tr>
                    ))}
                    {pallet?.Masters.length === 0 && (
                      <tr><td colSpan={puedeQuitar ? 9 : 8} className="px-3 py-6 text-center text-gray-400">Sin masters escaneados todavía</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-end gap-2 shrink-0 flex-wrap">
          {/* Un polín ubicado tiene AMBAS acciones bloqueadas por la misma regla de sellado, así que
              mostrarlas como botones hacía que las dos devolvieran el mismo error y parecieran hacer
              lo mismo. En ese estado se explica la única salida real en vez de invitar a clickear. */}
          {pallet?.Estatus === "Cerrado" && puedeEditar && pallet?.PosicionId != null && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mr-auto">
              Ubicado en <span className="font-mono font-semibold">{pallet.PosicionCodigo}</span> — su contenido está sellado.
              Para reabrirlo, des-ubícalo primero desde <span className="font-semibold">Bodega — Ubicaciones</span>.
            </p>
          )}
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition">Volver a la lista</button>
          {abierto && puedeEscanear && (
            <button onClick={handleCerrar} className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition">Cerrar pallet</button>
          )}
          {pallet?.Estatus === "Cerrado" && puedeEditar && pallet?.PosicionId == null && (
            <>
              {/* Reabrir es la ÚNICA forma de volver a tocar un polín cerrado: lo devuelve a la fila
                  de escaneo, donde puede recibir cajas nuevas y también ceder las suyas a otro polín. */}
              <button onClick={handleReabrir} className="px-4 py-2 rounded-lg text-sm font-semibold bg-orange-500 text-white hover:bg-orange-600 transition">Reabrir pallet</button>
            </>
          )}
        </div>
      </div>
    </div>
    {mostrarHoja && <HojaPalletModal palletId={palletId} onCerrar={() => setMostrarHoja(false)} />}
    {mostrarTraer && (
      <ModalEscaneo titulo="Master de otro pallet" Icono={IconoTraerMaster} tono="ambar" verbo="traído"
        descripcion={`Apunta el lector al QR de cada caja que subas al polín ${pallet?.Codigo ?? ""}. Puede venir de un polín cerrado o ubicado: no hace falta des-ubicarlo.`}
        placeholder="QR del master (ej. E120)"
        onEscanear={traerEscaneando}
        // Se recarga al cerrar: la tanda mueve cajas entre dos polines y pudo liberar una posición.
        onCerrar={() => { setMostrarTraer(false); fetchDetalle(); onCambio?.(); }} />
    )}
    {mostrarQuitar && (
      <ModalEscaneo titulo="Quitar masters del polín" Icono={IconoQuitarMaster} tono="rojo" verbo="quitado"
        descripcion={`Apunta el lector al QR de cada caja que bajes del polín ${pallet?.Codigo ?? ""}. Sale del polín apenas se lee.`}
        placeholder="QR del master (ej. E120)"
        onEscanear={quitarEscaneando}
        // Al cerrar sí se recarga: la tanda pudo tocar varios polines (un traslado deshecho devuelve
        // cajas a su origen) y la lista de atrás tiene que reflejarlo.
        onCerrar={() => { setMostrarQuitar(false); fetchDetalle(); onCambio?.(); }} />
    )}
    {aviso && <AvisoModal {...aviso} onCerrar={() => cerrar(true)} onCancelar={() => cerrar(false)} />}
    </>
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
  const puedeEscanear = usePuede("bodega", "escanear");
  const puedeEliminar = usePuede("bodega", "eliminar");
  const { aviso, mostrarAlerta, pedirConfirmacion, cerrar } = useAviso();
  const [pallets, setPallets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroEstatus, setFiltroEstatus] = useState("");
  const [filtroFecha, setFiltroFecha] = useState("");
  const [panelId, setPanelId] = useState(null);
  const [origenes, setOrigenes] = useState([]);
  const [bodegasVirtuales, setBodegasVirtuales] = useState([]);
  const [modalNuevo, setModalNuevo] = useState(false);
  const [busquedaPallet, setBusquedaPallet] = useState("");
  const [mostrarConsulta, setMostrarConsulta] = useState(false);
  const [widthsPallets, startResizePallets] = useColWidths("pallets", PALLETS_COL_DEFAULTS);
  const [ordenPallets, alternarOrdenPallets] = useOrden();

  // Se busca por código de polín, que es lo que el operador tiene a mano (la hoja o el QR). El
  // Origen y el Área entran también porque el mismo campo sirve para acotar "todo lo de BODEGA".
  const qPallet = busquedaPallet.trim().toLowerCase();
  const palletsFiltrados = qPallet
    ? pallets.filter(p => `${p.Codigo} ${p.DescripcionOrigen ?? ""} ${p.NombreBodegaVirtual ?? ""}`.toLowerCase().includes(qPallet))
    : pallets;

  // Masters ordena por lo que hay dentro (número), no por el texto "12 / 20"; Creado y Cerrado
  // por su fecha real y no por el "usuario · fecha" que se muestra.
  const palletsOrdenados = ordenarFilas(palletsFiltrados, ordenPallets, {
    pallet: p => p.Codigo, estatus: p => p.Estatus, area: p => p.NombreBodegaVirtual,
    origen: p => p.DescripcionOrigen, masters: p => p.CantidadMasters, cuadre: p => p.Cuadre,
    creado: p => p.CreadoEn, cerrado: p => p.CerradoEn,
  });

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

  const handleEliminar = async (p) => {
    const confirmado = await pedirConfirmacion(`¿Eliminar el pallet ${p.Codigo || `#${p.PalletId}`}? Solo es posible si está vacío.`, { textoConfirmar: "Eliminar" });
    if (!confirmado) return;
    const res = await fetch(`${API}/${p.PalletId}`, { method: "DELETE", headers: authHeader() });
    const data = await leerJSON(res);
    if (res.ok) { fetchPallets(); return; }

    // Un polín que ya tocó el kardex no se puede borrar sin perder esa historia — se cancela.
    // Se ofrece aquí mismo en vez de dejar al operador con un error y sin salida.
    if (/kard[eé]x/i.test(data.error || "")) {
      const cancelar = await pedirConfirmacion(`${data.error}\n\n¿Cancelarlo ahora?`, { textoConfirmar: "Cancelar polín", textoCancelar: "Dejarlo así" });
      if (!cancelar) return;
      const res2 = await fetch(`${API}/${p.PalletId}/cancelar`, { method: "POST", headers: authHeader() });
      const data2 = await leerJSON(res2);
      if (res2.ok) fetchPallets();
      else await mostrarAlerta("Error: " + (data2.error || "No se pudo cancelar el polín"));
      return;
    }
    await mostrarAlerta("Error: " + (data.error || "No se pudo eliminar el pallet"));
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
        {/* Filtro local: la lista ya viene entera del backend (tope 500), así que buscar el código
            aquí es instantáneo y no cuesta una consulta por tecla. */}
        <input type="text" value={busquedaPallet} onChange={e => setBusquedaPallet(e.target.value)}
          placeholder="Buscar polín (ej. T0010)"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono w-48 focus:outline-none focus:ring-2 focus:ring-blue-400" />
        <button onClick={() => setMostrarConsulta(true)}
          className="px-4 py-2 text-sm font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 active:bg-blue-200 transition">
          Consultar etiqueta
        </button>
        <span className="text-sm text-gray-500 ml-auto">
          {palletsFiltrados.length}
          {palletsFiltrados.length !== pallets.length ? ` de ${pallets.length}` : ""} pallet{palletsFiltrados.length !== 1 ? "s" : ""}
        </span>
        {puedeEscanear && (
          <button onClick={() => setModalNuevo(true)} className="bg-blue-600 text-white font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm">
            + Nuevo pallet
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm table-fixed">
            <Colgroup columns={PALLETS_COLS} widths={widthsPallets} />
            <thead className="bg-gray-50 text-gray-500 border-b border-gray-200">
              <tr>
                <Th width={widthsPallets.pallet} onResizeStart={startResizePallets("pallet")} sortKey="pallet" orden={ordenPallets} onOrdenar={alternarOrdenPallets} className="px-4 py-3 text-left">Pallet</Th>
                <Th width={widthsPallets.estatus} onResizeStart={startResizePallets("estatus")} sortKey="estatus" orden={ordenPallets} onOrdenar={alternarOrdenPallets} className="px-4 py-3 text-center">Estatus</Th>
                <Th width={widthsPallets.area} onResizeStart={startResizePallets("area")} sortKey="area" orden={ordenPallets} onOrdenar={alternarOrdenPallets} className="px-4 py-3 text-left">Área</Th>
                <Th width={widthsPallets.origen} onResizeStart={startResizePallets("origen")} sortKey="origen" orden={ordenPallets} onOrdenar={alternarOrdenPallets} className="px-4 py-3 text-left">Origen</Th>
                <Th width={widthsPallets.masters} onResizeStart={startResizePallets("masters")} sortKey="masters" orden={ordenPallets} onOrdenar={alternarOrdenPallets} className="px-4 py-3 text-right">Masters</Th>
                <Th width={widthsPallets.cuadre} onResizeStart={startResizePallets("cuadre")} sortKey="cuadre" orden={ordenPallets} onOrdenar={alternarOrdenPallets} className="px-4 py-3 text-center">Cuadre</Th>
                <Th width={widthsPallets.creado} onResizeStart={startResizePallets("creado")} sortKey="creado" orden={ordenPallets} onOrdenar={alternarOrdenPallets} className="px-4 py-3 text-left">Creado</Th>
                <Th width={widthsPallets.cerrado} onResizeStart={startResizePallets("cerrado")} sortKey="cerrado" orden={ordenPallets} onOrdenar={alternarOrdenPallets} className="px-4 py-3 text-left">Cerrado</Th>
                <Th width={widthsPallets.acciones} onResizeStart={startResizePallets("acciones")} className="px-4 py-3 text-center">Acciones</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Cargando…</td></tr>
              ) : pallets.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Sin pallets para este filtro</td></tr>
              ) : palletsOrdenados.map(p => (
                <tr key={p.PalletId} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono font-semibold">{p.Codigo || `#${p.PalletId}`}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ESTATUS_BADGE[p.Estatus] || "bg-gray-100 text-gray-600"}`}>
                      {p.Estatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 truncate" title={p.NombreBodegaVirtual || ""}>{p.NombreBodegaVirtual || "-"}</td>
                  <td className="px-4 py-3 truncate" title={p.DescripcionOrigen || ""}>{p.DescripcionOrigen || "-"}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {p.CantidadMasters}{p.CantidadMaster != null ? ` / ${p.CantidadMaster}` : ""}
                    {/* Un polín que despachó parte se ve "a medias" aquí: es la señal para ir a
                        completarlo y no dejarlo ocupando una posición entera con media carga. */}
                    {p.CantidadSalidos > 0 && (
                      <span className="block text-[10px] font-sans text-slate-500" title={`${p.CantidadSalidos} master(s) ya despachados en una remisión`}>
                        {p.CantidadSalidos} despachado{p.CantidadSalidos === 1 ? "" : "s"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {p.Cuadre && (
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${CUADRE_BADGE[p.Cuadre] || "bg-gray-100 text-gray-600"}`}>
                        {p.Cuadre}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 truncate text-gray-500" title={`${p.CreadoPor} · ${fmtFecha(p.CreadoEn)}`}>{p.CreadoPor} · {fmtFecha(p.CreadoEn)}</td>
                  <td className="px-4 py-3 truncate text-gray-500" title={p.CerradoEn ? `${p.CerradoPor} · ${fmtFecha(p.CerradoEn)}` : ""}>{p.CerradoEn ? `${p.CerradoPor} · ${fmtFecha(p.CerradoEn)}` : "-"}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center gap-2">
                      <button onClick={() => setPanelId(p.PalletId)} className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition">
                        {p.Estatus === "Abierto" ? "Escanear" : "Ver"}
                      </button>
                      {p.Estatus === "Abierto" && p.CantidadMasters === 0 && puedeEliminar && (
                        <button onClick={() => handleEliminar(p)} className="text-red-600 hover:text-red-800 text-xs font-medium px-2 py-1 rounded hover:bg-red-50 transition">Eliminar</button>
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
      {mostrarConsulta && <ConsultarEtiquetaModal onCerrar={() => setMostrarConsulta(false)} />}

      {panelId != null && (
        <PanelEscaneo palletId={panelId} onClose={() => { setPanelId(null); fetchPallets(); }} onCambio={fetchPallets} />
      )}

      {aviso && <AvisoModal {...aviso} onCerrar={() => cerrar(true)} onCancelar={() => cerrar(false)} />}
    </>
  );
}
