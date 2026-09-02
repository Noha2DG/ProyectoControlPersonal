import { useState, useEffect, useCallback } from "react";
import { fmtNum } from "../utils/numero.js";
import { authHeader, usePuede, useAuth } from "../context/AuthContext.jsx";
import { useColWidths, useOrden, ordenarFilas, Th, Colgroup } from "../components/ResizableTh.jsx";
import AvisoModal from "../components/AvisoModal.jsx";
import HojaRemisionModal from "../components/HojaRemisionModal.jsx";
import ModalEscaneo from "../components/ModalEscaneo.jsx";
import { useAviso } from "../hooks/useAviso.js";

const API = "/api/remisiones";

// Qué campos pide cada tipo NO se decide aquí: viene de la serie (`Destino` / `PideEmbarque` en
// SerieRemision, la misma fuente que valida el backend). Un destino nuevo se agrega en el catálogo
// y esta pantalla lo soporta sola.
//   Destino 'Cliente' → el producto sale de la planta (venta local, exportación, maquila)
//   Destino 'Area'    → traslado interno (reempaque, reetiquetado, reproceso)

const COL_DEFAULTS = { folio: 110, tipo: 130, estatus: 110, fecha: 110, destino: 220, masters: 90, kg: 100, creado: 160, acciones: 150 };
const COLS = Object.keys(COL_DEFAULTS);
const LINEAS_COL_DEFAULTS = { linea: 70, correlativo: 100, polin: 90, pedido: 100, cliente: 170, lote: 110, producto: 180, kg: 75, lb: 75, acciones: 80 };

const ESTATUS_BADGE = {
  Borrador:   "bg-gray-100 text-gray-600",
  Confirmada: "bg-green-100 text-green-700",
  Anulada:    "bg-red-100 text-red-700",
};

// Los tres primeros (producto que SALE de la planta) en tonos fríos; los tres de traslado interno en
// tonos cálidos — así se distinguen de un vistazo en la lista sin tener que leer el nombre.
const TIPO_BADGE = {
  VentaLocal:   "bg-blue-100 text-blue-700",
  Exportacion:  "bg-purple-100 text-purple-700",
  Maquila:      "bg-teal-100 text-teal-700",
  Reempaque:    "bg-amber-100 text-amber-700",
  Reetiquetado: "bg-orange-100 text-orange-700",
  Reproceso:    "bg-rose-100 text-rose-700",
};

function fmtFecha(iso) {
  return iso ? new Date(iso).toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" }) : "-";
}

function fmtDia(iso) {
  // Las fechas puras (YYYY-MM-DD) se parten a mano: new Date("2026-08-05") las interpreta como UTC
  // y en Guatemala (UTC-6) se muestran un día antes.
  if (!iso) return "-";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

async function leerJSON(res) {
  try { return await res.json(); } catch { return {}; }
}

function destinoDe(r) {
  if (r.AreaDestino) return r.NombreAreaDestino || r.AreaDestino;
  if (!r.NombreCliente) return "-";
  return r.NombreCliente + (r.NombreSubcliente ? ` — ${r.NombreSubcliente}` : "");
}

// ── Formulario de cabecera (crear y editar) ───────────────────────────────────────────────────────
function ModalRemision({ remision, series, clientes, areas, onGuardar, onClose }) {
  const editando = !!remision;
  const [tipo, setTipo] = useState(remision?.Tipo ?? "");
  const [fecha, setFecha] = useState(remision?.Fecha ?? new Date().toISOString().slice(0, 10));
  const [codigoCliente, setCodigoCliente] = useState(remision?.CodigoCliente != null ? String(remision.CodigoCliente) : "");
  const [codigoSubcliente, setCodigoSubcliente] = useState(remision?.CodigoSubcliente ?? "");
  const [areaDestino, setAreaDestino] = useState(remision?.AreaDestino ?? "");
  const [codigoPedido, setCodigoPedido] = useState(remision?.CodigoPedido ?? "");
  const [esMixta, setEsMixta] = useState(remision?.EsMixta ?? false);
  const [pedidos, setPedidos] = useState([]);
  const [contenedor, setContenedor] = useState(remision?.Contenedor ?? "");
  const [sello, setSello] = useState(remision?.Sello ?? "");
  const [observaciones, setObservaciones] = useState(remision?.Observaciones ?? "");
  const [subclientes, setSubclientes] = useState([]);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const serie = series.find(s => s.Tipo === tipo);
  const aCliente = serie?.Destino === "Cliente";
  const pideEmbarque = serie?.PideEmbarque === true;
  const pidePedido = serie?.PidePedido === true;
  // Una venta local solo ofrece clientes locales y una exportación solo los de exportación. Maquila
  // no filtra (TipoCliente null) porque el maquilador puede ser cualquiera de los dos.
  const clientesDelTipo = serie?.TipoCliente ? clientes.filter(c => c.Tipo === serie.TipoCliente) : clientes;
  // Cuando la serie pide pedido, el cliente NO se elige: se lee del pedido seleccionado.
  const pedidoSel = pedidos.find(p => p.CodigoPedido === codigoPedido);

  useEffect(() => {
    if (!pidePedido) { setPedidos([]); return; }
    const qs = serie?.TipoCliente ? `?tipoCliente=${serie.TipoCliente}` : "";
    fetch(`/api/pedidos${qs}`, { headers: authHeader() })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setPedidos(data); });
  }, [pidePedido, serie?.TipoCliente]);

  useEffect(() => {
    if (!codigoCliente) { setSubclientes([]); return; }
    fetch(`/api/subcliente?cliente=${codigoCliente}`, { headers: authHeader() })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setSubclientes(data.filter(s => s.Activo)); });
  }, [codigoCliente]);

  // Cambiar de tipo puede dejar afuera al cliente ya elegido (pasar de Exportación a Venta local con
  // GOLD LAKE seleccionado). Si ya no califica se limpia: dejarlo puesto mostraría un desplegable en
  // blanco pero con valor cargado, y el backend lo rechazaría recién al guardar.
  const handleTipo = (nuevoTipo) => {
    setTipo(nuevoTipo);
    const serieNueva = series.find(s => s.Tipo === nuevoTipo);
    const sigueValido = !serieNueva?.TipoCliente
      || clientes.some(c => String(c.Codigo) === String(codigoCliente) && c.Tipo === serieNueva.TipoCliente);
    if (!sigueValido) { setCodigoCliente(""); setCodigoSubcliente(""); }
    // El pedido pertenece a la serie que lo pidió: al cambiar de tipo deja de tener sentido.
    setCodigoPedido("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(""); setGuardando(true);
    try {
      await onGuardar({
        Tipo: tipo, Fecha: fecha,
        // Con pedido, el backend ignora estos dos y los hereda del pedido — se mandan igual por
        // claridad del payload, pero la fuente de verdad es CodigoPedido.
        CodigoCliente: aCliente ? Number(codigoCliente) : null,
        CodigoSubcliente: aCliente ? codigoSubcliente : null,
        AreaDestino: aCliente ? null : areaDestino,
        CodigoPedido: pidePedido ? codigoPedido : null,
        EsMixta: pidePedido ? esMixta : false,
        Contenedor: contenedor, Sello: sello, Observaciones: observaciones,
      });
    } catch (err) { setError(err.message); setGuardando(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-full flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200 shrink-0">
          <h3 className="text-lg font-bold text-gray-800">{editando ? `Editar remisión ${remision.Folio}` : "Nueva remisión"}</h3>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Tipo *</label>
              {/* El tipo se congela al crear: el folio ya salió de esa serie (VL/EX/RE) y cambiarlo
                  dejaría un documento numerado en una serie que no le corresponde. */}
              <select required value={tipo} onChange={e => handleTipo(e.target.value)} disabled={editando} autoFocus={!editando}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100 disabled:text-gray-500">
                <option value="">Selecciona...</option>
                {series.map(s => <option key={s.Tipo} value={s.Tipo}>{s.Nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Fecha *</label>
              <input required type="date" value={fecha} onChange={e => setFecha(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>

          {tipo && (pidePedido ? (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Pedido a exportar *</label>
                <select required value={codigoPedido} onChange={e => setCodigoPedido(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="">Selecciona...</option>
                  {pedidos.map(p => (
                    <option key={p.CodigoPedido} value={p.CodigoPedido}>{p.CodigoPedido} — {p.Descripcion}</option>
                  ))}
                </select>
                {serie?.TipoCliente && (
                  <p className="text-xs text-gray-400 mt-1">
                    Solo pedidos de clientes de exportación. ¿No aparece? Revisa el tipo del cliente en Catálogos → Clientes.
                  </p>
                )}
              </div>
              {/* Cliente y subcliente NO se eligen: son los del pedido. Se muestran para que quien
                  arma el documento confirme a dónde va antes de crearlo. */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Cliente</label>
                  <div className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-700 truncate"
                    title={pedidoSel?.NombreCliente || ""}>
                    {pedidoSel?.NombreCliente || <span className="text-gray-400">— según el pedido —</span>}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Subcliente</label>
                  <div className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-700 truncate"
                    title={pedidoSel?.NombreSubcliente || ""}>
                    {pedidoSel?.NombreSubcliente || <span className="text-gray-400">—</span>}
                  </div>
                </div>
              </div>
              {/* La excepción, no la norma: sin marcarla, la remisión solo admite producto de su
                  propia proforma. Con ella se pueden juntar sobrantes de varias para un mismo cliente. */}
              <label className="flex items-start gap-2.5 p-3 rounded-lg border border-amber-200 bg-amber-50 cursor-pointer">
                <input type="checkbox" checked={esMixta} onChange={e => setEsMixta(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-amber-600 shrink-0" />
                <span className="text-sm">
                  <span className="font-semibold text-amber-800">Remisión mixta</span>
                  <span className="block text-xs text-amber-700 mt-0.5">
                    Permite agregar producto de otras proformas — así se juntan los sobrantes de varios pedidos
                    para un mismo cliente. Sin marcar, solo entra producto de {codigoPedido || "la proforma elegida"}.
                  </span>
                </span>
              </label>
            </>
          ) : aCliente ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Cliente *</label>
                <select required value={codigoCliente} onChange={e => { setCodigoCliente(e.target.value); setCodigoSubcliente(""); }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="">Selecciona...</option>
                  {clientesDelTipo.map(c => <option key={c.Codigo} value={c.Codigo}>{c.RazonSocial}</option>)}
                </select>
                {/* Si el cliente que busca no está en la lista, lo más probable es que esté mal
                    clasificado en el catálogo — decirlo aquí evita que crea que falta darlo de alta. */}
                {serie?.TipoCliente && (
                  <p className="text-xs text-gray-400 mt-1">
                    Solo clientes de tipo {serie.TipoCliente === "Local" ? "Local" : "Exportación"}. ¿No aparece? Revisa su tipo en Catálogos → Clientes.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Subcliente</label>
                <select value={codigoSubcliente} onChange={e => setCodigoSubcliente(e.target.value)} disabled={!subclientes.length}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100">
                  <option value="">(ninguno)</option>
                  {subclientes.map(s => <option key={s.CodigoSubcliente} value={s.CodigoSubcliente}>{s.RazonSocial}</option>)}
                </select>
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Área de destino *</label>
              <select required value={areaDestino} onChange={e => setAreaDestino(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                <option value="">Selecciona...</option>
                {areas.map(a => <option key={a.Codigo} value={a.Codigo}>{a.Nombre}</option>)}
              </select>
              <p className="text-xs text-gray-400 mt-1">El producto no sale de la planta: se traslada a esta área y vuelve a ingresar como producto nuevo, con etiqueta nueva.</p>
            </div>
          ))}

          {pideEmbarque && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Contenedor *</label>
                <input required type="text" value={contenedor} onChange={e => setContenedor(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Sello / marchamo *</label>
                <input required type="text" value={sello} onChange={e => setSello(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Observaciones</label>
            <textarea rows={2} value={observaciones} onChange={e => setObservaciones(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition">Cancelar</button>
            <button type="submit" disabled={guardando} className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50">
              {guardando ? "Guardando..." : editando ? "Guardar cambios" : "Crear y agregar producto"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Figuras de las dos formas de cargar ───────────────────────────────────────────────────────────
// El polín como capas apiladas y el master como una caja: en el andén se decide de un vistazo, sin
// leer. El rótulo va igual debajo, la figura sola no basta para quien recién entra.
const IconoPallet = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M6.429 9.75L2.25 12l4.179 2.25m0-4.5l5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L21.75 12l-4.179 2.25m0 0l4.179 2.25L12 21.75 2.25 16.5l4.179-2.25m11.142 0l-5.571 3-5.571-3" />
  </svg>
);
const IconoMaster = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
  </svg>
);

// ── Panel de armado / consulta de una remisión ────────────────────────────────────────────────────
// Anular no siempre significa lo mismo. Si fue un error de captura, la carga nunca se movió y vuelve
// a su polín. Pero cuando el producto salió de verdad y regresó, las cajas casi nunca vuelven a la
// misma tarima: quedan sueltas y hay que montarlas en otro polín. Preguntarlo aquí evita que el
// inventario diga por un rato que las cajas están en un rack donde ya no están, y evita tener que
// des-ubicar y reabrir un polín sellado solo para mover unas cuantas cajas.
function ModalAnularRemision({ remision, onConfirmar, onCerrar }) {
  const [motivo, setMotivo] = useState("");
  const [destino, setDestino] = useState("mismo");   // "mismo" | "otro"
  const [palletDestinoId, setPalletDestinoId] = useState("");
  const [abiertos, setAbiertos] = useState(null);    // null = todavía no se consultó
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (destino !== "otro" || abiertos !== null) return;
    fetch("/api/pallets?estatus=Abierto", { headers: authHeader() })
      .then(r => (r.ok ? r.json() : []))
      .then(d => setAbiertos(Array.isArray(d) ? d : []))
      .catch(() => setAbiertos([]));
  }, [destino, abiertos]);

  const cuantos = remision?.CantidadMasters ?? 0;
  // Solo se ofrecen los polines donde de verdad cabe la devolución completa: los que declararon
  // capacidad y ya no dan para tanto se muestran deshabilitados en vez de dejar que el backend
  // rechace la anulación después de escribir el motivo.
  const conEspacio = (abiertos ?? []).map(p => {
    const libre = p.CantidadMaster == null ? null : p.CantidadMaster - p.CantidadMasters;
    return { ...p, libre, cabe: libre == null || libre >= cuantos };
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (destino === "otro" && !palletDestinoId) { setError("Elige el polín al que vuelve el producto."); return; }
    setEnviando(true);
    try {
      await onConfirmar(motivo.trim(), destino === "otro" ? Number(palletDestinoId) : null);
    } catch (err) {
      setError(err.message);
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-[55] flex items-center justify-center p-4" onClick={onCerrar}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-full overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="text-lg font-bold text-gray-800">Anular remisión {remision?.Folio}</h3>
          <p className="text-sm text-gray-500 mt-1">
            {cuantos} master(s) vuelven a inventario y queda registrado en el kardex. La remisión no se borra.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Motivo *</label>
            <textarea required rows={3} value={motivo} onChange={e => setMotivo(e.target.value)} autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">¿Dónde queda el producto?</label>
            <div className="space-y-2">
              <label className="flex gap-2 items-start cursor-pointer">
                <input type="radio" name="destino" value="mismo" checked={destino === "mismo"}
                  onChange={() => setDestino("mismo")} className="mt-1" />
                <span className="text-sm">
                  <span className="font-medium text-gray-800">En su mismo polín</span>
                  <span className="block text-xs text-gray-500">La carga nunca se movió — se anuló por error de captura.</span>
                </span>
              </label>
              <label className="flex gap-2 items-start cursor-pointer">
                <input type="radio" name="destino" value="otro" checked={destino === "otro"}
                  onChange={() => setDestino("otro")} className="mt-1" />
                <span className="text-sm">
                  <span className="font-medium text-gray-800">En otro polín</span>
                  <span className="block text-xs text-gray-500">El producto volvió suelto y se monta en otra tarima.</span>
                </span>
              </label>
            </div>
          </div>

          {destino === "otro" && (
            <div>
              {abiertos === null ? (
                <p className="text-xs text-gray-400">Buscando polines abiertos…</p>
              ) : conEspacio.length === 0 ? (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  No hay ningún polín abierto. Crea uno en Bodega — Pallets y vuelve a intentarlo.
                </p>
              ) : (
                <>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Polín de retorno *</label>
                  <select value={palletDestinoId} onChange={e => setPalletDestinoId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                    <option value="">Elegir…</option>
                    {conEspacio.map(p => (
                      <option key={p.PalletId} value={p.PalletId} disabled={!p.cabe}>
                        {p.Codigo} — {p.CantidadMasters}{p.CantidadMaster != null ? `/${p.CantidadMaster}` : ""} master(s)
                        {p.DescripcionOrigen ? ` · ${p.DescripcionOrigen}` : ""}
                        {!p.cabe ? ` · solo caben ${p.libre}` : ""}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">
                    El polín de origen conserva las cajas que no salieron; solo se mueven estas {cuantos}.
                  </p>
                </>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onCerrar} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition">Cancelar</button>
            <button type="submit" disabled={enviando} className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-50">
              {enviando ? "Anulando..." : "Anular remisión"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PanelRemision({ remisionId, onClose, onCambio }) {
  const puedeEditar = usePuede("remisiones", "editar");
  const puedeImprimir = usePuede("remisiones", "imprimir");
  const puedeAnular = usePuede("remisiones", "anular");
  // El plazo para anular no aplica al administrador (ver DIAS_PARA_ANULAR en remisiones.ts).
  const esAdmin = useAuth().user?.rol === "admin";
  const { aviso, mostrarAlerta, pedirConfirmacion, cerrar } = useAviso();
  const [remision, setRemision] = useState(null);
  const [loading, setLoading] = useState(true);
  // Las dos formas de cargar producto se escanean, no se eligen de una lista: el operador tiene el
  // polín o la caja enfrente. null = ningún modal abierto.
  const [escaneando, setEscaneando] = useState(null); // "pallet" | "master" | null
  const [modalAnular, setModalAnular] = useState(false);
  const [mostrarHoja, setMostrarHoja] = useState(false);
  const [avance, setAvance] = useState({}); // DetalleId -> avance de esa línea de la proforma
  const [widths, startResize] = useColWidths("remision_lineas", LINEAS_COL_DEFAULTS);

  const fetchDetalle = useCallback(async () => {
    const res = await fetch(`${API}/${remisionId}`, { headers: authHeader() });
    if (res.ok) setRemision(await res.json());
    setLoading(false);
  }, [remisionId]);

  useEffect(() => { fetchDetalle(); }, [fetchDetalle]);

  const borrador = remision?.Estatus === "Borrador";
  const editable = borrador && puedeEditar;

  // Ambos handlers devuelven el texto del acierto y LANZAN en el error: es el contrato que espera
  // ModalEscaneo para armar su historial de la tanda.
  const escanearMaster = async (valor, linea) => {
    const res = await fetch(`${API}/${remisionId}/agregar-master`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ Correlativo: valor, Linea: linea }),
    });
    const data = await leerJSON(res);
    if (!res.ok) throw new Error(data.error || "No se pudo agregar");
    await fetchDetalle();
    onCambio?.();
    const m = data.Master;
    const sufijoLinea = data.Linea != null ? ` · línea ${data.Linea}` : "";
    return `${m.Correlativo} — ${m.CodigoPedido} · ${m.NombreCliente} · ${m.DescripcionProceso} ${m.DescripcionTalla}${sufijoLinea}`;
  };

  const escanearPallet = async (codigo, linea) => {
    const res = await fetch(`${API}/${remisionId}/agregar-pallet`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ Codigo: codigo, Linea: linea }),
    });
    const data = await leerJSON(res);
    if (!res.ok) throw new Error(data.error || "No se pudo agregar el polín");
    await fetchDetalle();
    onCambio?.();
    const sufijoLinea = data.Linea != null ? ` en la línea ${data.Linea}` : "";
    return `Polín ${data.PalletCodigo} — ${data.Agregados} master(s) agregados${sufijoLinea}`;
  };

  const handleQuitar = async (detalleId, correlativoTexto) => {
    const confirmado = await pedirConfirmacion(`¿Quitar ${correlativoTexto} de esta remisión?`, { textoConfirmar: "Quitar" });
    if (!confirmado) return;
    const res = await fetch(`${API}/${remisionId}/detalle/${detalleId}`, { method: "DELETE", headers: authHeader() });
    const data = await leerJSON(res);
    if (res.ok) { await fetchDetalle(); onCambio?.(); }
    else await mostrarAlerta("Error: " + (data.error || "No se pudo quitar la línea"));
  };

  const handleQuitarPallet = async (palletId, palletCodigo) => {
    const confirmado = await pedirConfirmacion(`¿Quitar todas las líneas del polín ${palletCodigo}?`, { textoConfirmar: "Quitar polín" });
    if (!confirmado) return;
    const res = await fetch(`${API}/${remisionId}/quitar-pallet`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ PalletId: palletId }),
    });
    const data = await leerJSON(res);
    if (res.ok) { await fetchDetalle(); onCambio?.(); }
    else await mostrarAlerta("Error: " + (data.error || "No se pudo quitar el polín"));
  };

  const handleConfirmar = async () => {
    const confirmado = await pedirConfirmacion(
      `¿Confirmar la remisión ${remision.Folio}?\n\n${remision.CantidadMasters} master(s) van a salir de bodega. Después de esto solo se puede anular.`,
      { textoConfirmar: "Confirmar salida" }
    );
    if (!confirmado) return;
    const res = await fetch(`${API}/${remisionId}/confirmar`, { method: "POST", headers: authHeader() });
    const data = await leerJSON(res);
    if (res.ok) { await fetchDetalle(); onCambio?.(); }
    else await mostrarAlerta("Error: " + (data.error || "No se pudo confirmar"));
  };

  const handleAnular = async (motivo, palletDestinoId) => {
    const res = await fetch(`${API}/${remisionId}/anular`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ Motivo: motivo, PalletDestinoId: palletDestinoId }),
    });
    const data = await leerJSON(res);
    if (!res.ok) throw new Error(data.error || "No se pudo anular");
    setModalAnular(false);
    await fetchDetalle();
    onCambio?.();
    if (data.PalletDestino) {
      await mostrarAlerta(`${data.MastersDevueltos} master(s) quedaron en el polín ${data.PalletDestino}.`, "exito");
    }
  };

  // Las líneas se muestran agrupadas por polín de origen: es como llega el producto al andén, y así
  // "quitar el polín completo" tiene dónde vivir sin una columna de casillas de selección.
  const porPolin = (remision?.Lineas ?? []).reduce((acc, l) => {
    (acc[l.PalletCodigo] ??= { PalletId: l.PalletId, PalletCodigo: l.PalletCodigo, lineas: [] }).lineas.push(l);
    return acc;
  }, {});
  const grupos = Object.values(porPolin);

  // Compara lo que va saliendo contra lo que pide la proforma. Es AVISO, no candado: la proforma se
  // modifica constantemente y se corrige después de la carga, así que bloquear aquí frenaría
  // contenedores legítimos con el camión esperando en el andén.
  const lineasRem = remision?.Lineas ?? [];
  const pedidosEnRemision = [...new Set(lineasRem.map(l => l.CodigoPedido).filter(Boolean))].sort().join(",");

  useEffect(() => {
    if (!pedidosEnRemision) { setAvance({}); return; }
    let vivo = true;
    // Una remisión mixta junta varias proformas, así que se piden todas y se indexan por línea.
    Promise.all(pedidosEnRemision.split(",").map(p =>
      fetch(`/api/detalle-pedido/avance?pedido=${encodeURIComponent(p)}`, { headers: authHeader() })
        .then(r => (r.ok ? r.json() : [])).catch(() => [])
    )).then(res => {
      if (!vivo) return;
      const mapa = {};
      for (const fila of res.flat()) mapa[fila.DetalleId] = fila;
      setAvance(mapa);
    });
    return () => { vivo = false; };
  }, [pedidosEnRemision]);

  const excedidas = (() => {
    const enRemision = {};
    for (const l of lineasRem) enRemision[l.DetalleId] = (enRemision[l.DetalleId] ?? 0) + 1;
    const confirmada = remision?.Estatus === "Confirmada";
    return Object.entries(enRemision).map(([id, cuantos]) => {
      const a = avance[id];
      // Objetivo null = pedido general: perpetuo, sin cantidad planificada contra la cual comparar.
      if (!a || a.Objetivo === null) return null;
      // En una confirmada el Despachado del avance YA incluye estas líneas; en un borrador todavía no.
      const total = confirmada ? a.Despachado : a.Despachado + cuantos;
      if (total <= a.Objetivo) return null;
      const l = lineasRem.find(x => String(x.DetalleId) === String(id));
      return {
        id,
        producto: `${l.DescripcionProceso} ${l.DescripcionTalla}`,
        pedido: l.CodigoPedido,
        total, objetivo: a.Objetivo, exceso: total - a.Objetivo,
      };
    }).filter(Boolean);
  })();
  // La columna de línea del contenedor solo tiene sentido donde se estiba uno (Exportación).
  const pideLinea = remision?.PideLinea === true;
  const LINEAS_COLS = Object.keys(LINEAS_COL_DEFAULTS)
    .filter(c => (c !== "acciones" || editable) && (c !== "linea" || pideLinea));
  const descalzadas = (remision?.Lineas ?? []).filter(l => l.CalzaConDestino === false).length;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-full flex flex-col" onClick={e => e.stopPropagation()}>
          <div className="border-b border-gray-200 shrink-0 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg font-bold text-gray-800">Remisión {remision?.Folio ?? `#${remisionId}`}</h3>
                {remision && (
                  <>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TIPO_BADGE[remision.Tipo] || "bg-gray-100 text-gray-600"}`}>{remision.NombreTipo}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ESTATUS_BADGE[remision.Estatus] || "bg-gray-100 text-gray-600"}`}>{remision.Estatus}</span>
                    <span className="text-xs text-gray-500">→ {destinoDe(remision)}</span>
                    {remision.CodigoPedido && <span className="text-xs text-gray-500 font-mono">· Pedido {remision.CodigoPedido}</span>}
                    {remision.EsMixta && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700"
                        title="Admite producto de otras proformas">Mixta</span>
                    )}
                    <span className="text-xs text-gray-400">· {fmtDia(remision.Fecha)}</span>
                  </>
                )}
              </div>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg p-2 text-xl leading-none transition shrink-0">&times;</button>
            </div>
            {remision?.Estatus === "Anulada" && (
              <div className="mt-2 text-sm px-3 py-2 rounded-lg bg-red-50 text-red-700 border border-red-200">
                Anulada por {remision.AnuladaPor} el {fmtFecha(remision.AnuladaEn)} — {remision.MotivoAnulacion}
              </div>
            )}
          </div>

          <div className="px-5 py-4 overflow-y-auto flex-1">
            {loading ? <p className="text-gray-400 text-sm">Cargando…</p> : (
              <>
                {editable && (
                  // Dos tarjetas grandes: se usa en tablet en el andén, con guantes — el objetivo
                  // táctil importa más que el ahorro de espacio.
                  <div className="mb-4 grid grid-cols-2 gap-3">
                    {[
                      { id: "pallet", label: "Pallet", sub: "escanear polín completo", Icono: IconoPallet },
                      { id: "master", label: "Master", sub: "escanear caja por caja", Icono: IconoMaster },
                    ].map(o => (
                      <button key={o.id} onClick={() => setEscaneando(o.id)}
                        className="flex flex-col items-center gap-2 px-4 py-5 rounded-xl border-2 border-gray-200 bg-white text-gray-700 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 active:bg-blue-100 transition">
                        <o.Icono className="w-11 h-11" />
                        <span className="text-base font-bold">{o.label}</span>
                        <span className="text-xs text-gray-400">{o.sub}</span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-4 mb-3 text-sm">
                  <span className="font-semibold text-gray-700">{remision?.CantidadMasters ?? 0} master(s)</span>
                  <span className="text-gray-500">{(remision?.PesoKg ?? 0).toFixed(2)} kg</span>
                  <span className="text-gray-500">{(remision?.PesoLb ?? 0).toFixed(2)} lb</span>
                  {descalzadas > 0 && (
                    <span className="text-xs font-semibold px-2 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200">
                      {descalzadas} línea(s) con etiqueta de otro cliente
                    </span>
                  )}
                </div>

                {excedidas.length > 0 && (
                  <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                    <span className="font-semibold">Pasa lo que pide la proforma.</span>{" "}
                    Se puede despachar igual — es solo un aviso para que la proforma se corrija después.
                    <ul className="mt-1 space-y-0.5">
                      {excedidas.map(e => (
                        <li key={e.id}>
                          · {e.producto} <span className="font-mono text-amber-700">({e.pedido})</span>:{" "}
                          {e.total} de {e.objetivo} master — <b>+{e.exceso}</b>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {grupos.length === 0 ? (
                  <p className="text-gray-400 text-sm py-8 text-center border border-gray-200 rounded-lg">
                    Sin producto todavía. Escanea un <span className="font-semibold">Pallet</span> completo
                    o cajas sueltas con <span className="font-semibold">Master</span>.
                  </p>
                ) : grupos.map(g => (
                  <div key={g.PalletCodigo} className="mb-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-gray-500">
                        Polín <span className="font-mono text-gray-700">{g.PalletCodigo}</span> · {g.lineas.length} master(s)
                      </span>
                      {editable && (
                        <button onClick={() => handleQuitarPallet(g.PalletId, g.PalletCodigo)}
                          className="text-xs text-red-600 hover:text-red-800 font-medium px-2 py-1 rounded hover:bg-red-50 transition">
                          Quitar polín
                        </button>
                      )}
                    </div>
                    <div className="overflow-x-auto border border-gray-200 rounded-lg">
                      <table className="w-full text-xs table-fixed">
                        <Colgroup columns={LINEAS_COLS} widths={widths} />
                        <thead className="bg-gray-50 text-gray-500">
                          <tr>
                            {pideLinea && <Th width={widths.linea} onResizeStart={startResize("linea")} className="px-3 py-2 text-center">Línea</Th>}
                            <Th width={widths.correlativo} onResizeStart={startResize("correlativo")} className="px-3 py-2 text-left">Correlativo</Th>
                            <Th width={widths.polin} onResizeStart={startResize("polin")} className="px-3 py-2 text-left">Polín</Th>
                            <Th width={widths.pedido} onResizeStart={startResize("pedido")} className="px-3 py-2 text-left">Pedido</Th>
                            <Th width={widths.cliente} onResizeStart={startResize("cliente")} className="px-3 py-2 text-left">Cliente de la etiqueta</Th>
                            <Th width={widths.lote} onResizeStart={startResize("lote")} className="px-3 py-2 text-left">Lote</Th>
                            <Th width={widths.producto} onResizeStart={startResize("producto")} className="px-3 py-2 text-left">Producto</Th>
                            {/* Sin ordenamiento, igual que el resto de columnas de esta tabla: acá
                                las líneas van agrupadas por polín y en el orden en que se
                                escanearon, que es como se cotejan contra la carga. */}
                            <Th width={widths.kg} onResizeStart={startResize("kg")} className="px-3 py-2 text-right">Kg</Th>
                            <Th width={widths.lb} onResizeStart={startResize("lb")} className="px-3 py-2 text-right">Lb</Th>
                            {editable && <Th width={widths.acciones} onResizeStart={startResize("acciones")} className="px-3 py-2 text-center">Quitar</Th>}
                          </tr>
                        </thead>
                        <tbody>
                          {g.lineas.map(l => (
                            <tr key={l.RemisionDetalleId} className="border-t border-gray-100">
                              {pideLinea && (
                                <td className="px-3 py-2 text-center">
                                  <span className="inline-block min-w-[1.75rem] px-1.5 py-0.5 rounded font-mono font-bold bg-amber-100 text-amber-800">
                                    {l.LineaContenedor ?? "—"}
                                  </span>
                                </td>
                              )}
                              <td className="px-3 py-2 font-mono">{l.Correlativo}</td>
                              {/* Mismo motivo que en la tabla de masters del polín: con ancho fijo,
                                  un texto largo sin `truncate` se pinta encima de la celda vecina. */}
                              <td className="px-3 py-2 font-mono text-gray-500 truncate">{l.PalletCodigo}</td>
                              <td className="px-3 py-2 font-mono truncate" title={l.CodigoPedido}>{l.CodigoPedido}</td>
                              <td className="px-3 py-2 truncate" title={`${l.NombreCliente}${l.NombreSubcliente ? "-" + l.NombreSubcliente : ""}`}>
                                <span className={l.CalzaConDestino === false ? "text-amber-700 font-medium" : ""}>
                                  {l.NombreCliente}{l.NombreSubcliente ? `-${l.NombreSubcliente}` : ""}
                                </span>
                                {l.CalzaConDestino === false && (
                                  <span className="ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700" title="La etiqueta de este master es de otro cliente — se despacha tal cual, sin reetiquetar">
                                    otro cliente
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 font-mono truncate" title={l.Lote}>{l.Lote}</td>
                              <td className="px-3 py-2 truncate" title={`${l.DescripcionProceso} ${l.DescripcionTalla} ${l.DescripcionPresentacion}`}>
                                {l.DescripcionProceso} {l.DescripcionTalla} {l.DescripcionPresentacion}
                              </td>
                              <td className="px-3 py-2 text-right">{fmtNum(l.PesoMasterKG)}</td>
                              <td className="px-3 py-2 text-right">{fmtNum(l.PesoMasterLb)}</td>
                              {editable && (
                                <td className="px-3 py-2 text-center">
                                  <button onClick={() => handleQuitar(l.RemisionDetalleId, l.Correlativo)} className="text-red-600 hover:text-red-800 font-medium">Quitar</button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}

                {remision?.Observaciones && (
                  <p className="text-sm text-gray-500 mt-3"><span className="font-medium">Observaciones:</span> {remision.Observaciones}</p>
                )}
              </>
            )}
          </div>

          <div className="px-5 py-3 border-t border-gray-200 flex flex-wrap justify-end gap-2 shrink-0">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition">Volver a la lista</button>
            {remision && remision.Estatus !== "Anulada" && puedeImprimir && (
              <button onClick={() => setMostrarHoja(true)}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-purple-700 bg-purple-50 border border-purple-200 hover:bg-purple-100 transition">
                Imprimir
              </button>
            )}
            {/* Pasado el plazo, anular queda solo para el administrador: el documento ya circuló y
                devolver producto al inventario deja de ser una corrección de captura. El backend lo
                valida igual — esto solo evita ofrecer un botón que va a rebotar. */}
            {remision?.Estatus === "Confirmada" && puedeAnular && remision.AnulacionVencida && !esAdmin && (
              <span className="px-3 py-2 text-xs text-gray-500 self-center">
                Se confirmó hace {remision.DiasDesdeConfirmada} días — pasados {remision.DiasParaAnular},
                solo un administrador puede anularla.
              </span>
            )}
            {remision?.Estatus === "Confirmada" && puedeAnular && (!remision.AnulacionVencida || esAdmin) && (
              <button onClick={() => setModalAnular(true)}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition">
                Anular
              </button>
            )}
            {editable && (
              <button onClick={handleConfirmar} disabled={!remision?.CantidadMasters}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50">
                Confirmar salida
              </button>
            )}
          </div>
        </div>
      </div>

      {escaneando === "pallet" && (
        <ModalEscaneo titulo="Escanear polín" Icono={IconoPallet} pideLinea={remision?.PideLinea === true}
          descripcion="Apunta el lector al QR de la hoja del polín. Entra completo, con todos sus masters."
          placeholder="QR del polín (ej. T0012)"
          onEscanear={escanearPallet} onCerrar={() => setEscaneando(null)} />
      )}
      {escaneando === "master" && (
        <ModalEscaneo titulo="Escanear master" Icono={IconoMaster} pideLinea={remision?.PideLinea === true}
          descripcion="Apunta el lector al QR de la caja. El polín conserva su posición y las cajas que no se lleven."
          placeholder="QR del master (ej. E120)"
          onEscanear={escanearMaster} onCerrar={() => setEscaneando(null)} />
      )}
      {modalAnular && (
        <ModalAnularRemision remision={remision} onConfirmar={handleAnular} onCerrar={() => setModalAnular(false)} />
      )}
      {mostrarHoja && <HojaRemisionModal remisionId={remisionId} onCerrar={() => setMostrarHoja(false)} />}
      {aviso && <AvisoModal {...aviso} onCerrar={() => cerrar(true)} onCancelar={() => cerrar(false)} />}
    </>
  );
}

// ── Pantalla ──────────────────────────────────────────────────────────────────────────────────────
export default function RemisionesPage() {
  const puedeCrear = usePuede("remisiones", "crear");
  const puedeEditar = usePuede("remisiones", "editar");
  const puedeEliminar = usePuede("remisiones", "eliminar");
  const { aviso, mostrarAlerta, pedirConfirmacion, cerrar } = useAviso();
  const [remisiones, setRemisiones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroEstatus, setFiltroEstatus] = useState("");
  const [filtroFecha, setFiltroFecha] = useState("");
  const [series, setSeries] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [areas, setAreas] = useState([]);
  const [modal, setModal] = useState(null); // { remision } — null = cerrado
  const [panelId, setPanelId] = useState(null);
  const [widths, startResize] = useColWidths("remisiones", COL_DEFAULTS);
  const [ordenLista, alternarOrdenLista] = useOrden();
  // Fecha del documento por su ISO; Creado por la marca de tiempo, no por el "usuario · fecha".
  const remisionesOrdenadas = ordenarFilas(remisiones, ordenLista, {
    folio: r => r.Folio, tipo: r => r.NombreTipo, estatus: r => r.Estatus, fecha: r => r.Fecha,
    destino: r => destinoDe(r), masters: r => r.CantidadMasters, kg: r => r.PesoKg,
    creado: r => r.CreadoEn,
  });

  useEffect(() => {
    fetch(`${API}/series`, { headers: authHeader() }).then(r => r.json())
      .then(data => { if (Array.isArray(data)) setSeries(data); });
    fetch("/api/clientes", { headers: authHeader() }).then(r => r.json())
      .then(data => { if (Array.isArray(data)) setClientes(data.filter(c => c.Activo)); });
    fetch("/api/areas", { headers: authHeader() }).then(r => r.json())
      .then(data => { if (Array.isArray(data)) setAreas(data.filter(a => a.Activa)); });
  }, []);

  const fetchRemisiones = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filtroTipo) params.set("tipo", filtroTipo);
    if (filtroEstatus) params.set("estatus", filtroEstatus);
    if (filtroFecha) params.set("fecha", filtroFecha);
    const res = await fetch(`${API}?${params}`, { headers: authHeader() });
    const data = await res.json();
    if (Array.isArray(data)) setRemisiones(data);
    setLoading(false);
  }, [filtroTipo, filtroEstatus, filtroFecha]);

  useEffect(() => { fetchRemisiones(); }, [fetchRemisiones]);

  const handleGuardar = async (datos) => {
    const editando = !!modal?.remision;
    const res = await fetch(editando ? `${API}/${modal.remision.RemisionId}` : API, {
      method: editando ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(datos),
    });
    const data = await leerJSON(res);
    if (!res.ok) throw new Error(data.error || "No se pudo guardar la remisión");
    setModal(null);
    // Al crear se salta directo al armado: una remisión sin líneas no sirve de nada.
    if (!editando) setPanelId(data.RemisionId);
    fetchRemisiones();
  };

  const handleEliminar = async (r) => {
    const confirmado = await pedirConfirmacion(`¿Eliminar el borrador ${r.Folio}? No se puede deshacer.`, { textoConfirmar: "Eliminar" });
    if (!confirmado) return;
    const res = await fetch(`${API}/${r.RemisionId}`, { method: "DELETE", headers: authHeader() });
    const data = await leerJSON(res);
    if (res.ok) fetchRemisiones();
    else await mostrarAlerta("Error: " + (data.error || "No se pudo eliminar"));
  };

  return (
    <>
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
          <option value="">Todos los tipos</option>
          {series.map(s => <option key={s.Tipo} value={s.Tipo}>{s.Nombre}</option>)}
        </select>
        <select value={filtroEstatus} onChange={e => setFiltroEstatus(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
          <option value="">Todos los estatus</option>
          <option value="Borrador">Borrador</option>
          <option value="Confirmada">Confirmada</option>
          <option value="Anulada">Anulada</option>
        </select>
        <input type="date" value={filtroFecha} onChange={e => setFiltroFecha(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        <span className="text-sm text-gray-500 ml-auto">{remisiones.length} remisi{remisiones.length !== 1 ? "ones" : "ón"}</span>
        {puedeCrear && (
          <button onClick={() => setModal({ remision: null })} className="bg-blue-600 text-white font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm">
            + Nueva remisión
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm table-fixed">
            <Colgroup columns={COLS} widths={widths} />
            <thead className="bg-gray-50 text-gray-500 border-b border-gray-200">
              <tr>
                <Th width={widths.folio} onResizeStart={startResize("folio")} sortKey="folio" orden={ordenLista} onOrdenar={alternarOrdenLista} className="px-4 py-3 text-left">Folio</Th>
                <Th width={widths.tipo} onResizeStart={startResize("tipo")} sortKey="tipo" orden={ordenLista} onOrdenar={alternarOrdenLista} className="px-4 py-3 text-left">Tipo</Th>
                <Th width={widths.estatus} onResizeStart={startResize("estatus")} sortKey="estatus" orden={ordenLista} onOrdenar={alternarOrdenLista} className="px-4 py-3 text-center">Estatus</Th>
                <Th width={widths.fecha} onResizeStart={startResize("fecha")} sortKey="fecha" orden={ordenLista} onOrdenar={alternarOrdenLista} className="px-4 py-3 text-left">Fecha</Th>
                <Th width={widths.destino} onResizeStart={startResize("destino")} sortKey="destino" orden={ordenLista} onOrdenar={alternarOrdenLista} className="px-4 py-3 text-left">Destino</Th>
                <Th width={widths.masters} onResizeStart={startResize("masters")} sortKey="masters" orden={ordenLista} onOrdenar={alternarOrdenLista} className="px-4 py-3 text-right">Masters</Th>
                <Th width={widths.kg} onResizeStart={startResize("kg")} className="px-4 py-3 text-right">Kg</Th>
                <Th width={widths.creado} onResizeStart={startResize("creado")} sortKey="creado" orden={ordenLista} onOrdenar={alternarOrdenLista} className="px-4 py-3 text-left">Creado</Th>
                <Th width={widths.acciones} onResizeStart={startResize("acciones")} className="px-4 py-3 text-center">Acciones</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Cargando…</td></tr>
              ) : remisiones.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Sin remisiones para este filtro</td></tr>
              ) : remisionesOrdenadas.map(r => (
                <tr key={r.RemisionId} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono font-semibold">
                    {r.Folio}
                    {r.EsMixta && <span className="ml-1 text-[10px] font-sans font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700" title="Remisión mixta: admite producto de otras proformas">mixta</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TIPO_BADGE[r.Tipo] || "bg-gray-100 text-gray-600"}`}>{r.NombreTipo}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ESTATUS_BADGE[r.Estatus] || "bg-gray-100 text-gray-600"}`}>{r.Estatus}</span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{fmtDia(r.Fecha)}</td>
                  <td className="px-4 py-3 truncate" title={destinoDe(r)}>{destinoDe(r)}</td>
                  <td className="px-4 py-3 text-right font-mono">{r.CantidadMasters}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtNum(r.PesoKg)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-500 truncate">{r.CreadoPor} · {fmtFecha(r.CreadoEn)}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center gap-2">
                      <button onClick={() => setPanelId(r.RemisionId)} className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition">
                        {r.Estatus === "Borrador" ? "Armar" : "Ver"}
                      </button>
                      {r.Estatus === "Borrador" && puedeEditar && (
                        <button onClick={() => setModal({ remision: r })} className="text-gray-600 hover:text-gray-800 text-xs font-medium px-2 py-1 rounded hover:bg-gray-100 transition">Editar</button>
                      )}
                      {r.Estatus === "Borrador" && puedeEliminar && (
                        <button onClick={() => handleEliminar(r)} className="text-red-600 hover:text-red-800 text-xs font-medium px-2 py-1 rounded hover:bg-red-50 transition">Eliminar</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <ModalRemision remision={modal.remision} series={series} clientes={clientes} areas={areas}
          onGuardar={handleGuardar} onClose={() => setModal(null)} />
      )}
      {panelId != null && (
        <PanelRemision remisionId={panelId} onClose={() => { setPanelId(null); fetchRemisiones(); }} onCambio={fetchRemisiones} />
      )}
      {aviso && <AvisoModal {...aviso} onCerrar={() => cerrar(true)} onCancelar={() => cerrar(false)} />}
    </>
  );
}
