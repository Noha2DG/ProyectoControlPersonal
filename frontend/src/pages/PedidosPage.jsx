import { useState, useEffect, useCallback } from "react";
import { fmtEntero, fmtNum } from "../utils/numero.js";
import { authHeader, usePuede } from "../context/AuthContext.jsx";
import { useColWidths, useOrden, ordenarFilas, Th, Colgroup } from "../components/ResizableTh.jsx";

const ESTATUS = ["Proceso", "Terminado"];

const PEDIDOS_COL_DEFAULTS = { pedido: 130, descripcion: 220, estatus: 110, editar: 90 };
const PEDIDOS_COLS = Object.keys(PEDIDOS_COL_DEFAULTS);
const DETALLE_COL_DEFAULTS = { clase: 90, talla: 90, presentacion: 130, cajas: 90, kg: 90, acciones: 170 };
const DETALLE_COLS = Object.keys(DETALLE_COL_DEFAULTS);
// El avance va en su propia pestaña y no como columnas extra del detalle: son 8 columnas y el panel
// vive a media pantalla, así que metidas junto a la proforma quedarían ilegibles.
const AVANCE_COL_DEFAULTS = { clase: 70, talla: 80, presentacion: 95, objetivo: 80, agrupado: 85, bodega: 85, despachado: 90, dif: 90 };
const AVANCE_COLS = Object.keys(AVANCE_COL_DEFAULTS);

const fmtFecha = v => {
  if (!v) return "";
  const d = new Date(v);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const ACCION_BADGE = {
  Alta:   "bg-green-100 text-green-700",
  Cambio: "bg-blue-100 text-blue-700",
  Baja:   "bg-red-100 text-red-700",
};

// Combo de texto con búsqueda — para catálogos largos (Clase, Talla, Presentación, Empaques)
function ComboBuscable({ options, value, onChange, placeholder, required }) {
  const selected = options.find(o => String(o.value) === String(value));
  const [query, setQuery] = useState(selected ? selected.label : "");
  const [open, setOpen] = useState(false);

  useEffect(() => { setQuery(selected ? selected.label : ""); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = query.trim().toLowerCase();
  const filtradas = (q ? options.filter(o => o.label.toLowerCase().includes(q)) : options).slice(0, 50);

  const handleSelect = (opt) => {
    setQuery(opt.label);
    setOpen(false);
    onChange(opt.value);
  };

  const handleChange = (e) => {
    setQuery(e.target.value);
    setOpen(true);
    if (value) onChange("");
  };

  return (
    <div className="relative">
      <input
        type="text"
        required={required}
        value={query}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => { setOpen(false); setQuery(selected ? selected.label : ""); }, 150)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      {open && filtradas.length > 0 && (
        <ul className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {filtradas.map(o => (
            <li key={o.value} onMouseDown={() => handleSelect(o)}
              className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer">
              {o.label}
            </li>
          ))}
        </ul>
      )}
      {open && filtradas.length === 0 && (
        <ul className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg">
          <li className="px-3 py-2 text-sm text-gray-400">Sin resultados</li>
        </ul>
      )}
    </div>
  );
}

function PedidoModal({ item, clientes, onSave, onClose }) {
  const isEdit = !!item;
  const [form, setForm] = useState({
    CodigoPedido: item?.CodigoPedido || "",
    CodigoCliente: item?.CodigoCliente || "",
    CodigoSubcliente: item?.CodigoSubcliente || "",
    Descripcion: item?.Descripcion || "",
    FechaInicio: item?.FechaInicio?.slice(0, 10) || "",
    Estatus: item?.Estatus || "Proceso",
    EsGeneral: item?.EsGeneral || false,
  });
  const [subclientes, setSubclientes] = useState([]);
  const set = f => e => setForm(p => ({ ...p, [f]: e.target.value }));

  useEffect(() => {
    if (!form.CodigoCliente) { setSubclientes([]); return; }
    fetch(`/api/subcliente?cliente=${form.CodigoCliente}`, { headers: authHeader() })
      .then(r => r.json()).then(d => { if (Array.isArray(d)) setSubclientes(d.filter(s => s.Activo)); });
  }, [form.CodigoCliente]);

  const handleSubmit = e => { e.preventDefault(); onSave(form); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">{isEdit ? "Editar Pedido" : "Nuevo Pedido"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Código Pedido *</label>
            <input required disabled={isEdit} value={form.CodigoPedido} onChange={set("CodigoPedido")} maxLength={20}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Cliente *</label>
            <select required value={form.CodigoCliente} onChange={set("CodigoCliente")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="">Seleccione...</option>
              {clientes.map(c => <option key={c.Codigo} value={c.Codigo}>{c.Codigo} — {c.RazonSocial}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Subcliente</label>
            <select value={form.CodigoSubcliente} onChange={set("CodigoSubcliente")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="">Sin especificar</option>
              {subclientes.map(s => <option key={s.CodigoSubcliente} value={s.CodigoSubcliente}>{s.CodigoSubcliente} — {s.RazonSocial}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Descripción *</label>
            <input required value={form.Descripcion} onChange={set("Descripcion")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Fecha Inicio</label>
            <input type="date" value={form.FechaInicio} onChange={set("FechaInicio")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Estatus *</label>
            <select required value={form.Estatus} onChange={set("Estatus")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              {ESTATUS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Pedido general = producto solo para almacenaje, sin cantidades comprometidas. Se define al
              crear: el backend rechaza cambiarlo si el pedido ya tiene líneas, porque eso reinterpretaría
              los techos ya aplicados a las capturas existentes. */}
          <label className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 cursor-pointer">
            <input type="checkbox" checked={!!form.EsGeneral}
              onChange={e => setForm(p => ({ ...p, EsGeneral: e.target.checked }))}
              className="mt-0.5 h-4 w-4 accent-amber-600" />
            <span className="text-sm">
              <span className="font-semibold text-amber-900">Pedido general (almacenaje)</span>
              <span className="block text-xs text-amber-700 mt-0.5">
                Producto aún no comprometido a la venta: sus líneas no llevan cantidad planificada y se
                etiqueta lo que vaya saliendo, sin tope.
                {isEdit && " Solo se puede cambiar mientras el pedido no tenga líneas."}
              </span>
            </span>
          </label>

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition">Cancelar</button>
            <button type="submit" className="px-5 py-2 text-sm bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition">{isEdit ? "Guardar" : "Crear"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

const round3 = n => Math.round(n * 1000) / 1000;

function DetalleModal({ item, codigoPedido, esGeneral, clases, tallas, presentaciones, empaquesMaster, empaquesIndividual, onSave, onClose }) {
  const isEdit = !!item;
  const [form, setForm] = useState({
    Clase: item?.Clase || "", Talla: item?.Talla || "", Presentacion: item?.Presentacion || "",
    EmpaqueMaster: item?.EmpaqueMaster || "", EmpaqueAccesorio: item?.EmpaqueAccesorio || "",
    CantidadCajas: item?.CantidadCajas || "", KgPedido: item?.KgPedido || "", LibrasPedido: item?.LibrasPedido || "",
  });
  const set = f => e => setForm(p => ({ ...p, [f]: e.target.value }));
  const setVal = f => val => setForm(p => ({ ...p, [f]: val }));

  const setCantidadCajas = e => {
    const val = e.target.value;
    const cajas = parseFloat(val);
    setForm(p => {
      const pres = presentaciones.find(pr => pr.Codigo === p.Presentacion);
      if (!pres || val === "" || isNaN(cajas)) return { ...p, CantidadCajas: val };
      return { ...p, CantidadCajas: val, KgPedido: round3(cajas * pres.PesoKG), LibrasPedido: round3(cajas * pres.PesoLb) };
    });
  };

  const setKgPedido = e => {
    const val = e.target.value;
    const kg = parseFloat(val);
    setForm(p => {
      const pres = presentaciones.find(pr => pr.Codigo === p.Presentacion);
      if (!pres || !pres.PesoKG || val === "" || isNaN(kg)) return { ...p, KgPedido: val };
      return { ...p, KgPedido: val, CantidadCajas: round3(kg / pres.PesoKG), LibrasPedido: round3(kg * (pres.PesoLb / pres.PesoKG)) };
    });
  };

  const setLibrasPedido = e => {
    const val = e.target.value;
    const lb = parseFloat(val);
    setForm(p => {
      const pres = presentaciones.find(pr => pr.Codigo === p.Presentacion);
      if (!pres || !pres.PesoLb || val === "" || isNaN(lb)) return { ...p, LibrasPedido: val };
      return { ...p, LibrasPedido: val, CantidadCajas: round3(lb / pres.PesoLb), KgPedido: round3(lb * (pres.PesoKG / pres.PesoLb)) };
    });
  };

  const setPresentacion = codigo => {
    setForm(p => {
      const pres = presentaciones.find(pr => pr.Codigo === codigo);
      const cajas = parseFloat(p.CantidadCajas);
      if (!pres || isNaN(cajas)) return { ...p, Presentacion: codigo };
      return { ...p, Presentacion: codigo, KgPedido: round3(cajas * pres.PesoKG), LibrasPedido: round3(cajas * pres.PesoLb) };
    });
  };

  const handleSubmit = e => { e.preventDefault(); onSave({ ...form, CodigoPedido: codigoPedido, DetalleId: item?.DetalleId }); };

  const presentacionSel = presentaciones.find(pr => pr.Codigo === form.Presentacion);
  const cajasNum = parseFloat(form.CantidadCajas);
  const masters = presentacionSel && presentacionSel.CajasXMaster && !isNaN(cajasNum)
    ? cajasNum / presentacionSel.CajasXMaster
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">{isEdit ? "Editar Línea" : "Nueva Línea"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Clase *</label>
            <ComboBuscable required value={form.Clase} onChange={setVal("Clase")}
              placeholder="Buscar clase..."
              options={clases.map(c => ({ value: c.Clase, label: `${c.Clase} — ${c.Descripcion}` }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Talla *</label>
            <ComboBuscable required value={form.Talla} onChange={setVal("Talla")}
              placeholder="Buscar talla..."
              options={tallas.map(t => ({ value: t.Codigo, label: `${t.Codigo} — ${t.Descripcion}` }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Presentación *</label>
            <ComboBuscable required value={form.Presentacion} onChange={setPresentacion}
              placeholder="Buscar presentación..."
              options={presentaciones.map(p => ({ value: p.Codigo, label: `${p.Codigo} — ${p.Descripcion}` }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Empaque Master *</label>
            <ComboBuscable required value={form.EmpaqueMaster} onChange={setVal("EmpaqueMaster")}
              placeholder="Buscar empaque master..."
              options={empaquesMaster.map(e => ({ value: e.Codigo, label: `${e.Codigo} — ${e.Descripcion}` }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Empaque Accesorio</label>
            <ComboBuscable value={form.EmpaqueAccesorio} onChange={setVal("EmpaqueAccesorio")}
              placeholder="Sin especificar — buscar empaque..."
              options={empaquesIndividual.map(e => ({ value: e.Codigo, label: `${e.Codigo} — ${e.Descripcion}` }))} />
          </div>
          {/* En un pedido general no hay cantidad que planificar: el backend guarda el centinela de
              1 caja y desactiva el techo de la línea, así que pedir cajas/kg/lb aquí solo produciría
              números que no significan nada. */}
          {esGeneral ? (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-sm text-amber-800">
              <span className="font-semibold">Pedido general — sin cantidad planificada.</span>
              <span className="block text-xs mt-0.5">
                Se etiqueta lo que vaya saliendo; el avance se mide por lo acumulado, no contra un objetivo.
              </span>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Cajas *</label>
                  <input required type="number" value={form.CantidadCajas} onChange={setCantidadCajas}
                    className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Kg *</label>
                  <input required type="number" step="0.001" value={form.KgPedido} onChange={setKgPedido}
                    className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Lb *</label>
                  <input required type="number" step="0.001" value={form.LibrasPedido} onChange={setLibrasPedido}
                    className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              </div>

              {presentacionSel && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-800">
                  {masters === null ? (
                    <span className="text-blue-400">Ingrese las cajas para calcular los masters</span>
                  ) : (
                    <>
                      <span className="font-semibold">{fmtNum(masters)} master{masters !== 1 ? "s" : ""}</span>
                      <span className="text-blue-500"> ({presentacionSel.CajasXMaster} cajas x master)</span>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition">Cancelar</button>
            <button type="submit" className="px-5 py-2 text-sm bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition">{isEdit ? "Guardar" : "Crear"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

const ESTATUS_BADGE = { Proceso: "bg-yellow-100 text-yellow-700", Terminado: "bg-green-100 text-green-700" };

// Cómo se ha movido una línea de la proforma. Cada fila del historial es una foto completa del
// estado tras el cambio, así que el "de X a Y" se saca comparando con la fila anterior.
function HistorialModal({ detalleId, tallaDesc, presentacionDesc, onClose }) {
  const [filas, setFilas] = useState(null);

  useEffect(() => {
    fetch(`/api/detalle-pedido/${detalleId}/historial`, { headers: authHeader() })
      .then(r => r.json())
      .then(d => setFilas(Array.isArray(d) ? d : []))
      .catch(() => setFilas([]));
  }, [detalleId]);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">Historial de la línea</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">&times;</button>
        </div>

        <div className="overflow-y-auto p-5">
          {filas === null ? (
            <div className="flex justify-center py-8"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
          ) : filas.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Sin movimientos registrados.</p>
          ) : (
            <ol className="space-y-3">
              {filas.map((f, i) => {
                const prev = i > 0 ? filas[i - 1] : null;
                const cambioCajas = prev && prev.CantidadCajas !== f.CantidadCajas;
                return (
                  <li key={f.HistorialId} className="border-l-2 border-gray-200 pl-4 relative">
                    <span className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-gray-300" />
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className={`px-2 py-0.5 rounded-full font-semibold ${ACCION_BADGE[f.Accion] || "bg-gray-100 text-gray-600"}`}>{f.Accion}</span>
                      <span className="text-gray-500">{fmtFecha(f.CreadoEn)}</span>
                      <span className="text-gray-400">·</span>
                      <span className="text-gray-600">{f.RegistradoPor || "—"}</span>
                    </div>
                    <div className="mt-1 text-sm text-gray-700">
                      {f.Clase} · {tallaDesc(f.Talla)} · {presentacionDesc(f.Presentacion)}
                    </div>
                    <div className="text-sm">
                      {cambioCajas ? (
                        <span className="font-semibold text-amber-700">
                          {prev.CantidadCajas} → {f.CantidadCajas} cajas
                        </span>
                      ) : (
                        <span className="text-gray-600">{f.CantidadCajas} cajas</span>
                      )}
                      <span className="text-gray-400"> · {f.KgPedido} Kg</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PedidosPage() {
  const puedeCrear = usePuede("pedidos", "crear");
  const puedeEditar = usePuede("pedidos", "editar");
  const puedeEliminar = usePuede("pedidos", "eliminar");
  const [pedidos, setPedidos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [clases, setClases] = useState([]);
  const [tallas, setTallas] = useState([]);
  const [presentaciones, setPresentaciones] = useState([]);
  const [empaques, setEmpaques] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pedidoSel, setPedidoSel] = useState(null);
  const [detalles, setDetalles] = useState([]);
  const [loadingDet, setLoadingDet] = useState(false);
  const [modalPedido, setModalPedido] = useState({ open: false, item: null });
  const [modalDetalle, setModalDetalle] = useState({ open: false, item: null });
  const [busqueda, setBusqueda] = useState("");
  const [widthsPedidos, startResizePedidos] = useColWidths("pedidos", PEDIDOS_COL_DEFAULTS);
  const [widthsDetalle, startResizeDetalle] = useColWidths("pedidos_detalle", DETALLE_COL_DEFAULTS);
  const [widthsAvance, startResizeAvance] = useColWidths("pedidos_avance", AVANCE_COL_DEFAULTS);
  const [vista, setVista] = useState("proforma");
  const [avance, setAvance] = useState([]);
  const [loadingAv, setLoadingAv] = useState(false);
  const [historialId, setHistorialId] = useState(null);
  const [ordenPed, alternarOrdenPed] = useOrden();
  const [ordenDet, alternarOrdenDet] = useOrden();
  const [ordenAv, alternarOrdenAv] = useOrden();

  const fetchPedidos = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pedidos", { headers: authHeader() });
      const data = await res.json();
      if (Array.isArray(data)) setPedidos(data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchPedidos();
    Promise.all([
      fetch("/api/clientes", { headers: authHeader() }).then(r => r.json()),
      fetch("/api/clase", { headers: authHeader() }).then(r => r.json()),
      fetch("/api/tallas", { headers: authHeader() }).then(r => r.json()),
      fetch("/api/presentacion", { headers: authHeader() }).then(r => r.json()),
      fetch("/api/empaques", { headers: authHeader() }).then(r => r.json()),
    ]).then(([cl, ca, ta, pr, em]) => {
      if (Array.isArray(cl)) setClientes(cl.filter(c => c.Activo));
      if (Array.isArray(ca)) setClases(ca.filter(c => c.Activo));
      if (Array.isArray(ta)) setTallas(ta.filter(t => t.Activo));
      if (Array.isArray(pr)) setPresentaciones(pr.filter(p => p.Activo));
      if (Array.isArray(em)) setEmpaques(em.filter(e => e.Activo));
    });
  }, [fetchPedidos]);

  const fetchDetalles = useCallback(async (codigo) => {
    setLoadingDet(true);
    try {
      const res = await fetch(`/api/detalle-pedido?pedido=${encodeURIComponent(codigo)}`, { headers: authHeader() });
      const data = await res.json();
      if (Array.isArray(data)) setDetalles(data);
    } finally { setLoadingDet(false); }
  }, []);

  const fetchAvance = useCallback(async (codigo) => {
    setLoadingAv(true);
    try {
      const res = await fetch(`/api/detalle-pedido/avance?pedido=${encodeURIComponent(codigo)}`, { headers: authHeader() });
      const data = await res.json();
      setAvance(Array.isArray(data) ? data : []);
    } finally { setLoadingAv(false); }
  }, []);

  const seleccionarPedido = (p) => { setPedidoSel(p); fetchDetalles(p.CodigoPedido); };

  // El avance se recarga al entrar a la pestaña y al cambiar de pedido. Cuenta producto físico, que
  // se mueve todo el día por escaneo y despacho, así que se pide fresco en vez de cachearlo.
  useEffect(() => {
    if (vista === "avance" && pedidoSel) fetchAvance(pedidoSel.CodigoPedido);
  }, [vista, pedidoSel, fetchAvance]);

  const handleSavePedido = async (form) => {
    const isEdit = pedidos.some(p => p.CodigoPedido === form.CodigoPedido);
    const res = await fetch(isEdit ? `/api/pedidos/${form.CodigoPedido}` : "/api/pedidos", {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setModalPedido({ open: false, item: null });
      fetchPedidos();
      // El pedido abierto en la columna de detalle guarda su propio EsGeneral, y de él dependen el
      // modal de línea y las columnas de cantidad — hay que resincronizarlo o la vista queda mintiendo
      // hasta que se vuelva a seleccionar.
      if (pedidoSel?.CodigoPedido === form.CodigoPedido) {
        setPedidoSel(prev => ({ ...prev, ...form, EsGeneral: !!form.EsGeneral }));
      }
    }
    else { const e = await res.json(); alert("Error: " + e.error); }
  };

  const handleSaveDetalle = async (form) => {
    const isEdit = !!form.DetalleId;
    const res = await fetch(isEdit ? `/api/detalle-pedido/${form.DetalleId}` : "/api/detalle-pedido", {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(form),
    });
    if (res.ok) { setModalDetalle({ open: false, item: null }); fetchDetalles(pedidoSel.CodigoPedido); }
    else { const e = await res.json(); alert("Error: " + e.error); }
  };

  const handleDeleteDetalle = async (d) => {
    if (!confirm("¿Eliminar esta línea del pedido?")) return;
    await fetch(`/api/detalle-pedido/${d.DetalleId}`, { method: "DELETE", headers: authHeader() });
    fetchDetalles(pedidoSel.CodigoPedido);
  };

  const empaquesMaster = empaques.filter(e => e.TipoEmpaque === "Master");
  const empaquesIndividual = empaques.filter(e => e.TipoEmpaque === "Individual");

  const tallaDesc = codigo => tallas.find(t => String(t.Codigo) === String(codigo))?.Descripcion || codigo;
  const presentacionDesc = codigo => presentaciones.find(p => p.Codigo === codigo)?.Descripcion || codigo;

  const VALORES_PED = { pedido: p => p.CodigoPedido, descripcion: p => p.Descripcion, estatus: p => p.Estatus };
  const VALORES_DET = { clase: d => d.Clase, talla: d => d.Talla, presentacion: d => d.Presentacion,
                        cajas: d => d.CantidadCajas, kg: d => d.KgPedido };
  const VALORES_AV = { clase: a => a.Clase, talla: a => a.Talla, presentacion: a => a.Presentacion,
                       objetivo: a => a.Objetivo, agrupado: a => a.Declarado, bodega: a => a.EnBodega,
                       despachado: a => a.Despachado, dif: a => a.Diferencia };

  const q = busqueda.toLowerCase();
  const pedidosFiltrados = pedidos.filter(p =>
    !q || p.CodigoPedido.toLowerCase().includes(q) || p.Descripcion.toLowerCase().includes(q)
  );

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* Columna Pedidos */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap gap-3 items-center mb-4">
          <input type="text" placeholder="Buscar pedido..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-blue-400" />
          <span className="text-sm text-gray-500 ml-auto">{pedidosFiltrados.length} pedido{pedidosFiltrados.length !== 1 ? "s" : ""}</span>
          {puedeCrear && (
            <button onClick={() => setModalPedido({ open: true, item: null })}
              className="bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition">
              + Nuevo Pedido
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="bg-white rounded-xl shadow overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-sm table-fixed">
              <Colgroup columns={PEDIDOS_COLS} widths={widthsPedidos} />
              <thead>
                <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                  <Th width={widthsPedidos.pedido} onResizeStart={startResizePedidos("pedido")} sortKey="pedido" orden={ordenPed} onOrdenar={alternarOrdenPed} className="px-4 py-3 text-left whitespace-nowrap">Pedido</Th>
                  <Th width={widthsPedidos.descripcion} onResizeStart={startResizePedidos("descripcion")} sortKey="descripcion" orden={ordenPed} onOrdenar={alternarOrdenPed} className="px-4 py-3 text-left whitespace-nowrap">Descripción</Th>
                  <Th width={widthsPedidos.estatus} onResizeStart={startResizePedidos("estatus")} sortKey="estatus" orden={ordenPed} onOrdenar={alternarOrdenPed} className="px-4 py-3 text-center whitespace-nowrap">Estatus</Th>
                  <Th width={widthsPedidos.editar} onResizeStart={startResizePedidos("editar")} className="px-4 py-3 text-center whitespace-nowrap">Editar</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ordenarFilas(pedidosFiltrados, ordenPed, VALORES_PED).map(p => (
                  <tr key={p.CodigoPedido} onClick={() => seleccionarPedido(p)}
                    className={`cursor-pointer transition ${pedidoSel?.CodigoPedido === p.CodigoPedido ? "bg-blue-50" : "hover:bg-gray-50"}`}>
                    <td className="px-4 py-3 font-mono font-bold text-gray-700 whitespace-nowrap">{p.CodigoPedido}</td>
                    <td className="px-4 py-3 text-gray-900 truncate" title={p.Descripcion}>
                      {p.Descripcion}
                      {p.EsGeneral && (
                        <span className="ml-2 inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700"
                          title="Pedido general: almacenaje sin cantidades planificadas">General</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${ESTATUS_BADGE[p.Estatus] || "bg-gray-100 text-gray-600"}`}>
                        {p.Estatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      {puedeEditar && (
                        <button onClick={() => setModalPedido({ open: true, item: p })}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition">Editar</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Columna Detalle */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap gap-3 items-center mb-4">
          <h3 className="text-sm font-medium text-gray-600">
            {pedidoSel ? <span className="font-mono font-bold text-gray-800">{pedidoSel.CodigoPedido}</span> : "Detalle"}
          </h3>

          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden text-xs font-semibold">
            {[["proforma", "Proforma"], ["avance", "Avance"]].map(([key, label]) => (
              <button key={key} onClick={() => setVista(key)} disabled={!pedidoSel}
                className={`px-3 py-2 transition disabled:opacity-50 ${vista === key ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                {label}
              </button>
            ))}
          </div>

          {puedeCrear && vista === "proforma" && (
            <button onClick={() => setModalDetalle({ open: true, item: null })} disabled={!pedidoSel}
              className="ml-auto bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
              + Nueva Línea
            </button>
          )}
          {vista === "avance" && pedidoSel && (
            <button onClick={() => fetchAvance(pedidoSel.CodigoPedido)}
              className="ml-auto text-xs font-medium text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50 transition">
              Actualizar
            </button>
          )}
        </div>

        {!pedidoSel ? (
          <div className="bg-white rounded-xl shadow px-4 py-8 text-center text-gray-400 text-sm">Seleccione un pedido para ver su detalle</div>
        ) : vista === "avance" ? (
          loadingAv ? (
            <div className="flex justify-center py-10"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
          ) : (
            <>
              <div className="bg-white rounded-xl shadow overflow-x-auto">
                <table className="w-full text-sm table-fixed">
                  <Colgroup columns={AVANCE_COLS} widths={widthsAvance} />
                  <thead>
                    <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                      <Th width={widthsAvance.clase} onResizeStart={startResizeAvance("clase")} sortKey="clase" orden={ordenAv} onOrdenar={alternarOrdenAv} className="px-3 py-3 text-left">Clase</Th>
                      <Th width={widthsAvance.talla} onResizeStart={startResizeAvance("talla")} sortKey="talla" orden={ordenAv} onOrdenar={alternarOrdenAv} className="px-3 py-3 text-left">Talla</Th>
                      <Th width={widthsAvance.presentacion} onResizeStart={startResizeAvance("presentacion")} sortKey="presentacion" orden={ordenAv} onOrdenar={alternarOrdenAv} className="px-3 py-3 text-left">Present.</Th>
                      <Th width={widthsAvance.objetivo} onResizeStart={startResizeAvance("objetivo")} sortKey="objetivo" orden={ordenAv} onOrdenar={alternarOrdenAv} className="px-3 py-3 text-right" title="Master que pide la proforma">Pedido</Th>
                      <Th width={widthsAvance.agrupado} onResizeStart={startResizeAvance("agrupado")} sortKey="agrupado" orden={ordenAv} onOrdenar={alternarOrdenAv} className="px-3 py-3 text-right" title="Master declarados en Agrupación">Agrupado</Th>
                      <Th width={widthsAvance.bodega} onResizeStart={startResizeAvance("bodega")} sortKey="bodega" orden={ordenAv} onOrdenar={alternarOrdenAv} className="px-3 py-3 text-right" title="Master escaneados que siguen en bodega">Bodega</Th>
                      <Th width={widthsAvance.despachado} onResizeStart={startResizeAvance("despachado")} sortKey="despachado" orden={ordenAv} onOrdenar={alternarOrdenAv} className="px-3 py-3 text-right" title="Master que salieron en una remisión confirmada">Despach.</Th>
                      <Th width={widthsAvance.dif} onResizeStart={startResizeAvance("dif")} sortKey="dif" orden={ordenAv} onOrdenar={alternarOrdenAv} className="px-3 py-3 text-right" title="Despachado menos lo pedido">Dif.</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {ordenarFilas(avance, ordenAv, VALORES_AV).map(a => (
                      <tr key={a.DetalleId} className="hover:bg-gray-50 transition">
                        <td className="px-3 py-3 font-mono text-gray-700 truncate" title={a.Clase}>{a.Clase}</td>
                        <td className="px-3 py-3 text-gray-700 truncate" title={tallaDesc(a.Talla)}>{tallaDesc(a.Talla)}</td>
                        <td className="px-3 py-3 text-gray-700 truncate" title={presentacionDesc(a.Presentacion)}>{presentacionDesc(a.Presentacion)}</td>
                        <td className="px-3 py-3 text-right text-gray-800 font-semibold">
                          {a.Objetivo === null ? <span className="text-gray-300">—</span> : fmtEntero(a.Objetivo)}
                        </td>
                        <td className="px-3 py-3 text-right text-gray-600">{fmtEntero(a.Declarado)}</td>
                        <td className="px-3 py-3 text-right text-gray-600">{fmtEntero(a.EnBodega)}</td>
                        <td className="px-3 py-3 text-right text-gray-800 font-semibold">{fmtEntero(a.Despachado)}</td>
                        <td className="px-3 py-3 text-right">
                          {a.Diferencia === null ? (
                            <span className="text-gray-300">—</span>
                          ) : a.Diferencia > 0 ? (
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700"
                              title="Salió más de lo que pide la proforma">+{fmtEntero(a.Diferencia)}</span>
                          ) : a.Diferencia === 0 ? (
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">completo</span>
                          ) : (
                            <span className="text-gray-500">{fmtEntero(a.Diferencia)}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {avance.length === 0 && (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Sin líneas en este pedido</td></tr>
                    )}
                    {avance.length > 0 && (
                      <tr className="bg-gray-50 font-semibold">
                        <td colSpan={3} className="px-3 py-3 text-right text-gray-600">Total</td>
                        <td className="px-3 py-3 text-right text-gray-800">{fmtEntero(avance.reduce((s, a) => s + (a.Objetivo || 0), 0))}</td>
                        <td className="px-3 py-3 text-right text-gray-600">{fmtEntero(avance.reduce((s, a) => s + a.Declarado, 0))}</td>
                        <td className="px-3 py-3 text-right text-gray-600">{fmtEntero(avance.reduce((s, a) => s + a.EnBodega, 0))}</td>
                        <td className="px-3 py-3 text-right text-gray-800">{fmtEntero(avance.reduce((s, a) => s + a.Despachado, 0))}</td>
                        <td></td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-gray-500 leading-relaxed">
                Todo en master. <b>Pedido</b> = cajas de la proforma ÷ cajas por master.
                {" "}Las diferencias en ámbar avisan, no bloquean: la proforma se corrige después de la carga.
              </p>
            </>
          )
        ) : loadingDet ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="bg-white rounded-xl shadow overflow-x-auto">
            <table className="w-full text-sm table-fixed">
              <Colgroup columns={DETALLE_COLS} widths={widthsDetalle} />
              <thead>
                <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                  <Th width={widthsDetalle.clase} onResizeStart={startResizeDetalle("clase")} sortKey="clase" orden={ordenDet} onOrdenar={alternarOrdenDet} className="px-4 py-3 text-left whitespace-nowrap">Clase</Th>
                  <Th width={widthsDetalle.talla} onResizeStart={startResizeDetalle("talla")} sortKey="talla" orden={ordenDet} onOrdenar={alternarOrdenDet} className="px-4 py-3 text-left whitespace-nowrap">Talla</Th>
                  <Th width={widthsDetalle.presentacion} onResizeStart={startResizeDetalle("presentacion")} sortKey="presentacion" orden={ordenDet} onOrdenar={alternarOrdenDet} className="px-4 py-3 text-left whitespace-nowrap">Presentación</Th>
                  <Th width={widthsDetalle.cajas} onResizeStart={startResizeDetalle("cajas")} sortKey="cajas" orden={ordenDet} onOrdenar={alternarOrdenDet} className="px-4 py-3 text-right whitespace-nowrap">Cajas</Th>
                  <Th width={widthsDetalle.kg} onResizeStart={startResizeDetalle("kg")} sortKey="kg" orden={ordenDet} onOrdenar={alternarOrdenDet} className="px-4 py-3 text-right whitespace-nowrap">Kg</Th>
                  <Th width={widthsDetalle.acciones} onResizeStart={startResizeDetalle("acciones")} className="px-4 py-3 text-center whitespace-nowrap">Acciones</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ordenarFilas(detalles, ordenDet, VALORES_DET).map(d => (
                  <tr key={d.DetalleId} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 font-mono text-gray-700 truncate" title={d.Clase}>{d.Clase}</td>
                    <td className="px-4 py-3 text-gray-700 truncate" title={tallaDesc(d.Talla)}>{tallaDesc(d.Talla)}</td>
                    <td className="px-4 py-3 text-gray-700 truncate" title={presentacionDesc(d.Presentacion)}>{presentacionDesc(d.Presentacion)}</td>
                    {/* El 1 de un pedido general es centinela, no un dato: mostrarlo invitaría a leerlo
                        como cantidad planificada. */}
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {pedidoSel.EsGeneral ? <span className="text-gray-300">—</span> : fmtEntero(d.CantidadCajas)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {pedidoSel.EsGeneral ? <span className="text-gray-300">—</span> : fmtNum(d.KgPedido)}
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <div className="flex justify-center gap-1">
                        <button onClick={() => setHistorialId(d.DetalleId)} title="Cómo ha cambiado esta línea"
                          className="text-gray-500 hover:text-gray-800 text-xs font-medium px-2 py-1 rounded hover:bg-gray-100 transition">Historial</button>
                        {puedeEditar && (
                          <button onClick={() => setModalDetalle({ open: true, item: d })}
                            className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition">Editar</button>
                        )}
                        {puedeEliminar && (
                          <button onClick={() => handleDeleteDetalle(d)}
                            className="text-red-500 hover:text-red-700 text-xs font-medium px-2 py-1 rounded hover:bg-red-50 transition">Eliminar</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {detalles.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Sin líneas en este pedido</td></tr>
                )}
                {detalles.length > 0 && !pedidoSel.EsGeneral && (
                  <tr className="bg-gray-50 font-semibold">
                    <td colSpan={4} className="px-4 py-3 text-right text-gray-600 whitespace-nowrap">Total</td>
                    <td className="px-4 py-3 text-right text-gray-800 whitespace-nowrap">
                      {Number(detalles.reduce((sum, d) => sum + (Number(d.KgPedido) || 0), 0).toFixed(3))}
                    </td>
                    <td></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalPedido.open && (
        <PedidoModal item={modalPedido.item} clientes={clientes} onSave={handleSavePedido} onClose={() => setModalPedido({ open: false, item: null })} />
      )}
      {historialId && (
        <HistorialModal detalleId={historialId} tallaDesc={tallaDesc} presentacionDesc={presentacionDesc}
          onClose={() => setHistorialId(null)} />
      )}
      {modalDetalle.open && pedidoSel && (
        <DetalleModal item={modalDetalle.item} codigoPedido={pedidoSel.CodigoPedido} esGeneral={pedidoSel.EsGeneral}
          clases={clases} tallas={tallas} presentaciones={presentaciones}
          empaquesMaster={empaquesMaster} empaquesIndividual={empaquesIndividual}
          onSave={handleSaveDetalle} onClose={() => setModalDetalle({ open: false, item: null })} />
      )}
    </div>
  );
}
