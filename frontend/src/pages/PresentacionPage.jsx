import { useState, useEffect } from "react";
import { authHeader, usePuede } from "../context/AuthContext.jsx";
import { useColWidths, Th, Colgroup } from "../components/ResizableTh.jsx";

const API = "/api/presentacion";

const COL_DEFAULTS = { codigo: 90, descripcion: 180, abreviatura: 110, tipoMedida: 110, pesoKG: 90, pesoLb: 90, cajasXMaster: 110, estado: 100, acciones: 150 };
const COLS = Object.keys(COL_DEFAULTS);
const EMPTY = { Codigo: "", Descripcion: "", Abreviatura: "", TipoMedida: "Kilos", PesoKG: "", PesoLb: "", CajasXMaster: "" };

const LB_PER_KG = 2.2046226218;
const KG_PER_LB = 0.45359237;
const round3 = n => Math.round(n * 1000) / 1000;

function PresentacionModal({ item, onSave, onClose }) {
  const isEdit = !!item;
  const [form, setForm] = useState(isEdit ? { ...EMPTY, ...item } : EMPTY);
  const set = f => e => setForm(p => ({ ...p, [f]: e.target.value }));

  const setPesoKG = e => {
    const val = e.target.value;
    const num = parseFloat(val);
    setForm(p => ({ ...p, PesoKG: val, PesoLb: (val === "" || isNaN(num)) ? p.PesoLb : round3(num * LB_PER_KG) }));
  };
  const setPesoLb = e => {
    const val = e.target.value;
    const num = parseFloat(val);
    setForm(p => ({ ...p, PesoLb: val, PesoKG: (val === "" || isNaN(num)) ? p.PesoKG : round3(num * KG_PER_LB) }));
  };

  const handleSubmit = e => { e.preventDefault(); onSave(form); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">{isEdit ? "Editar Presentación" : "Nueva Presentación"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Código *</label>
            <input required disabled={isEdit} value={form.Codigo} onChange={set("Codigo")} maxLength={5}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Descripción *</label>
            <input required value={form.Descripcion} onChange={set("Descripcion")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Abreviatura *</label>
            <input required value={form.Abreviatura} onChange={set("Abreviatura")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Tipo de Medida *</label>
            <select required value={form.TipoMedida} onChange={set("TipoMedida")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="Kilos">Kilos</option>
              <option value="libras">libras</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Peso KG *</label>
              <input required type="number" step="0.001" value={form.PesoKG} onChange={setPesoKG}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Peso Lb *</label>
              <input required type="number" step="0.001" value={form.PesoLb} onChange={setPesoLb}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Cajas x Master *</label>
            <input required type="number" step="1" value={form.CajasXMaster} onChange={set("CajasXMaster")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
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

export default function PresentacionPage() {
  const puedeCrear = usePuede("catalogos", "crear");
  const puedeEditar = usePuede("catalogos", "editar");
  const puedeEliminar = usePuede("catalogos", "eliminar");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, item: null });
  const [filtro, setFiltro] = useState("Activo");
  const [busqueda, setBusqueda] = useState("");
  const [widths, startResize] = useColWidths("presentacion", COL_DEFAULTS);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await fetch(API, { headers: authHeader() });
      const data = await res.json();
      if (Array.isArray(data)) setItems(data);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchItems(); }, []);

  const handleSave = async (form) => {
    const isEdit = items.some(i => i.Codigo === form.Codigo);
    const res = await fetch(isEdit ? `${API}/${form.Codigo}` : API, {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(form),
    });
    if (res.ok) { setModal({ open: false, item: null }); fetchItems(); }
    else { const e = await res.json(); alert("Error: " + e.error); }
  };

  const handleToggle = async (item) => {
    if (item.Activo) {
      if (!confirm(`¿Desactivar "${item.Descripcion}"?`)) return;
      await fetch(`${API}/${item.Codigo}`, { method: "DELETE", headers: authHeader() });
    } else {
      await fetch(`${API}/${item.Codigo}`, {
        method: "PUT", headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ ...item, Activo: true }),
      });
    }
    fetchItems();
  };

  const q = busqueda.toLowerCase();
  const filtrados = items.filter(i => {
    const matchEstado = filtro === "Todos" || (filtro === "Activo" ? i.Activo : !i.Activo);
    const matchBusqueda = !q || i.Codigo.toLowerCase().includes(q) || i.Descripcion.toLowerCase().includes(q);
    return matchEstado && matchBusqueda;
  });

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <input type="text" placeholder="Buscar..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-60 focus:outline-none focus:ring-2 focus:ring-blue-400" />
        <div className="flex gap-1 bg-gray-200 rounded-lg p-1">
          {["Activo", "Inactivo", "Todos"].map(f => (
            <button key={f} onClick={() => setFiltro(f)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition ${filtro === f ? "bg-white shadow text-blue-700" : "text-gray-600 hover:text-gray-800"}`}>
              {f}
            </button>
          ))}
        </div>
        <span className="text-sm text-gray-500 ml-auto">{filtrados.length} presentaci{filtrados.length !== 1 ? "ones" : "ón"}</span>
        {puedeCrear && (
          <button onClick={() => setModal({ open: true, item: null })}
            className="bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition">
            + Nueva Presentación
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="bg-white rounded-xl shadow overflow-hidden overflow-x-auto">
          <table className="w-full text-sm table-fixed">
            <Colgroup columns={COLS} widths={widths} />
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                <Th width={widths.codigo} onResizeStart={startResize("codigo")} className="px-4 py-3 text-left">Código</Th>
                <Th width={widths.descripcion} onResizeStart={startResize("descripcion")} className="px-4 py-3 text-left">Descripción</Th>
                <Th width={widths.abreviatura} onResizeStart={startResize("abreviatura")} className="px-4 py-3 text-left whitespace-nowrap">Abreviatura</Th>
                <Th width={widths.tipoMedida} onResizeStart={startResize("tipoMedida")} className="px-4 py-3 text-left whitespace-nowrap">Tipo Medida</Th>
                <Th width={widths.pesoKG} onResizeStart={startResize("pesoKG")} className="px-4 py-3 text-right whitespace-nowrap">Peso KG</Th>
                <Th width={widths.pesoLb} onResizeStart={startResize("pesoLb")} className="px-4 py-3 text-right whitespace-nowrap">Peso Lb</Th>
                <Th width={widths.cajasXMaster} onResizeStart={startResize("cajasXMaster")} className="px-4 py-3 text-right whitespace-nowrap">Cajas x Master</Th>
                <Th width={widths.estado} onResizeStart={startResize("estado")} className="px-4 py-3 text-center">Estado</Th>
                <Th width={widths.acciones} onResizeStart={startResize("acciones")} className="px-4 py-3 text-center">Acciones</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtrados.map(item => (
                <tr key={item.Codigo} className={`hover:bg-gray-50 transition ${!item.Activo ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3 font-mono font-bold text-gray-700">{item.Codigo}</td>
                  <td className="px-4 py-3 text-gray-900">{item.Descripcion}</td>
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{item.Abreviatura}</td>
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{item.TipoMedida}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{item.PesoKG}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{item.PesoLb}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{item.CajasXMaster}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${item.Activo ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                      {item.Activo ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center gap-2">
                      {puedeEditar && (
                        <button onClick={() => setModal({ open: true, item })}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition">Editar</button>
                      )}
                      {((item.Activo && puedeEliminar) || (!item.Activo && puedeEditar)) && (
                        <button onClick={() => handleToggle(item)}
                          className={`text-xs font-medium px-2 py-1 rounded transition ${item.Activo ? "text-red-500 hover:text-red-700 hover:bg-red-50" : "text-green-600 hover:text-green-800 hover:bg-green-50"}`}>
                          {item.Activo ? "Desactivar" : "Activar"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Sin registros</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modal.open && (
        <PresentacionModal item={modal.item} onSave={handleSave} onClose={() => setModal({ open: false, item: null })} />
      )}
    </div>
  );
}
