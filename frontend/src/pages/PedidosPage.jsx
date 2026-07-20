import { useState, useEffect, useCallback } from "react";
import { authHeader } from "../context/AuthContext.jsx";
import { useColWidths, Th, Colgroup } from "../components/ResizableTh.jsx";

const ESTATUS = ["Proceso", "Terminado"];

const PEDIDOS_COL_DEFAULTS = { pedido: 130, descripcion: 220, estatus: 110, editar: 90 };
const PEDIDOS_COLS = Object.keys(PEDIDOS_COL_DEFAULTS);
const DETALLE_COL_DEFAULTS = { clase: 90, talla: 90, presentacion: 130, cajas: 90, kg: 90, acciones: 130 };
const DETALLE_COLS = Object.keys(DETALLE_COL_DEFAULTS);

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

function DetalleModal({ item, codigoPedido, clases, tallas, presentaciones, empaquesMaster, empaquesIndividual, onSave, onClose }) {
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
                  <span className="font-semibold">{masters.toFixed(2)} master{masters !== 1 ? "s" : ""}</span>
                  <span className="text-blue-500"> ({presentacionSel.CajasXMaster} cajas x master)</span>
                </>
              )}
            </div>
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

export default function PedidosPage() {
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

  const seleccionarPedido = (p) => { setPedidoSel(p); fetchDetalles(p.CodigoPedido); };

  const handleSavePedido = async (form) => {
    const isEdit = pedidos.some(p => p.CodigoPedido === form.CodigoPedido);
    const res = await fetch(isEdit ? `/api/pedidos/${form.CodigoPedido}` : "/api/pedidos", {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(form),
    });
    if (res.ok) { setModalPedido({ open: false, item: null }); fetchPedidos(); }
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
          <button onClick={() => setModalPedido({ open: true, item: null })}
            className="bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition">
            + Nuevo Pedido
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="bg-white rounded-xl shadow overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-sm table-fixed">
              <Colgroup columns={PEDIDOS_COLS} widths={widthsPedidos} />
              <thead>
                <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                  <Th width={widthsPedidos.pedido} onResizeStart={startResizePedidos("pedido")} className="px-4 py-3 text-left whitespace-nowrap">Pedido</Th>
                  <Th width={widthsPedidos.descripcion} onResizeStart={startResizePedidos("descripcion")} className="px-4 py-3 text-left whitespace-nowrap">Descripción</Th>
                  <Th width={widthsPedidos.estatus} onResizeStart={startResizePedidos("estatus")} className="px-4 py-3 text-center whitespace-nowrap">Estatus</Th>
                  <Th width={widthsPedidos.editar} onResizeStart={startResizePedidos("editar")} className="px-4 py-3 text-center whitespace-nowrap">Editar</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pedidosFiltrados.map(p => (
                  <tr key={p.CodigoPedido} onClick={() => seleccionarPedido(p)}
                    className={`cursor-pointer transition ${pedidoSel?.CodigoPedido === p.CodigoPedido ? "bg-blue-50" : "hover:bg-gray-50"}`}>
                    <td className="px-4 py-3 font-mono font-bold text-gray-700 whitespace-nowrap">{p.CodigoPedido}</td>
                    <td className="px-4 py-3 text-gray-900 whitespace-nowrap">{p.Descripcion}</td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${ESTATUS_BADGE[p.Estatus] || "bg-gray-100 text-gray-600"}`}>
                        {p.Estatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <button onClick={() => setModalPedido({ open: true, item: p })}
                        className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition">Editar</button>
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
            Detalle {pedidoSel ? <span className="font-mono font-bold text-gray-800">— {pedidoSel.CodigoPedido}</span> : ""}
          </h3>
          <button onClick={() => setModalDetalle({ open: true, item: null })} disabled={!pedidoSel}
            className="ml-auto bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
            + Nueva Línea
          </button>
        </div>

        {!pedidoSel ? (
          <div className="bg-white rounded-xl shadow px-4 py-8 text-center text-gray-400 text-sm">Seleccione un pedido para ver su detalle</div>
        ) : loadingDet ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="bg-white rounded-xl shadow overflow-x-auto">
            <table className="w-full text-sm table-fixed">
              <Colgroup columns={DETALLE_COLS} widths={widthsDetalle} />
              <thead>
                <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                  <Th width={widthsDetalle.clase} onResizeStart={startResizeDetalle("clase")} className="px-4 py-3 text-left whitespace-nowrap">Clase</Th>
                  <Th width={widthsDetalle.talla} onResizeStart={startResizeDetalle("talla")} className="px-4 py-3 text-left whitespace-nowrap">Talla</Th>
                  <Th width={widthsDetalle.presentacion} onResizeStart={startResizeDetalle("presentacion")} className="px-4 py-3 text-left whitespace-nowrap">Presentación</Th>
                  <Th width={widthsDetalle.cajas} onResizeStart={startResizeDetalle("cajas")} className="px-4 py-3 text-right whitespace-nowrap">Cajas</Th>
                  <Th width={widthsDetalle.kg} onResizeStart={startResizeDetalle("kg")} className="px-4 py-3 text-right whitespace-nowrap">Kg</Th>
                  <Th width={widthsDetalle.acciones} onResizeStart={startResizeDetalle("acciones")} className="px-4 py-3 text-center whitespace-nowrap">Acciones</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {detalles.map(d => (
                  <tr key={d.DetalleId} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 font-mono text-gray-700 whitespace-nowrap">{d.Clase}</td>
                    <td className="px-4 py-3 font-mono text-gray-700 whitespace-nowrap">{d.Talla}</td>
                    <td className="px-4 py-3 font-mono text-gray-700 whitespace-nowrap">{d.Presentacion}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{d.CantidadCajas}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{d.KgPedido}</td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <div className="flex justify-center gap-2">
                        <button onClick={() => setModalDetalle({ open: true, item: d })}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition">Editar</button>
                        <button onClick={() => handleDeleteDetalle(d)}
                          className="text-red-500 hover:text-red-700 text-xs font-medium px-2 py-1 rounded hover:bg-red-50 transition">Eliminar</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {detalles.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Sin líneas en este pedido</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalPedido.open && (
        <PedidoModal item={modalPedido.item} clientes={clientes} onSave={handleSavePedido} onClose={() => setModalPedido({ open: false, item: null })} />
      )}
      {modalDetalle.open && pedidoSel && (
        <DetalleModal item={modalDetalle.item} codigoPedido={pedidoSel.CodigoPedido}
          clases={clases} tallas={tallas} presentaciones={presentaciones}
          empaquesMaster={empaquesMaster} empaquesIndividual={empaquesIndividual}
          onSave={handleSaveDetalle} onClose={() => setModalDetalle({ open: false, item: null })} />
      )}
    </div>
  );
}
