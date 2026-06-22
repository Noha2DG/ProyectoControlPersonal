import { useState, useEffect } from "react";
import { authHeader } from "../context/AuthContext.jsx";

const API = "/api/clase";
const EMPTY = { Clase: "", Familia: "", Proceso: "", Descripcion: "", TipoClase: "PRODUCTO FINAL" };

function ClaseModal({ item, familias, procesos, onSave, onClose }) {
  const isEdit = !!item;
  const [form, setForm] = useState(isEdit ? { ...EMPTY, ...item } : EMPTY);
  const set = f => e => setForm(p => ({ ...p, [f]: e.target.value }));
  const handleSubmit = e => { e.preventDefault(); onSave(form); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">{isEdit ? "Editar Clase" : "Nueva Clase"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Clase *</label>
            <input required disabled={isEdit} value={form.Clase} onChange={set("Clase")} maxLength={10}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Familia *</label>
            <select required value={form.Familia} onChange={set("Familia")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="">Seleccione...</option>
              {familias.map(f => <option key={f.Codigo} value={f.Codigo}>{f.Codigo} — {f.Descripcion}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Proceso *</label>
            <select required value={form.Proceso} onChange={set("Proceso")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="">Seleccione...</option>
              {procesos.map(p => <option key={p.Proceso} value={p.Proceso}>{p.Proceso} — {p.Descripcion}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Descripción *</label>
            <input required value={form.Descripcion} onChange={set("Descripcion")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Tipo de Clase</label>
            <input value={form.TipoClase} onChange={set("TipoClase")}
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

export default function ClasePage() {
  const [items, setItems] = useState([]);
  const [familias, setFamilias] = useState([]);
  const [procesos, setProcesos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, item: null });
  const [filtro, setFiltro] = useState("Activo");
  const [busqueda, setBusqueda] = useState("");

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [r1, r2, r3] = await Promise.all([
        fetch(API, { headers: authHeader() }),
        fetch("/api/familia", { headers: authHeader() }),
        fetch("/api/procesos", { headers: authHeader() }),
      ]);
      const [d1, d2, d3] = await Promise.all([r1.json(), r2.json(), r3.json()]);
      if (Array.isArray(d1)) setItems(d1);
      if (Array.isArray(d2)) setFamilias(d2.filter(f => f.Activo));
      if (Array.isArray(d3)) setProcesos(d3.filter(p => p.Activo));
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []);

  const handleSave = async (form) => {
    const isEdit = items.some(i => i.Clase === form.Clase);
    const res = await fetch(isEdit ? `${API}/${form.Clase}` : API, {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(form),
    });
    if (res.ok) { setModal({ open: false, item: null }); fetchAll(); }
    else { const e = await res.json(); alert("Error: " + e.error); }
  };

  const handleToggle = async (item) => {
    if (item.Activo) {
      if (!confirm(`¿Desactivar la clase "${item.Clase}"?`)) return;
      await fetch(`${API}/${item.Clase}`, { method: "DELETE", headers: authHeader() });
    } else {
      await fetch(`${API}/${item.Clase}`, {
        method: "PUT", headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ ...item, Activo: true }),
      });
    }
    fetchAll();
  };

  const q = busqueda.toLowerCase();
  const filtrados = items.filter(i => {
    const matchEstado = filtro === "Todos" || (filtro === "Activo" ? i.Activo : !i.Activo);
    const matchBusqueda = !q || i.Clase.toLowerCase().includes(q) || i.Descripcion.toLowerCase().includes(q);
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
        <span className="text-sm text-gray-500 ml-auto">{filtrados.length} clase{filtrados.length !== 1 ? "s" : ""}</span>
        <button onClick={() => setModal({ open: true, item: null })}
          className="bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition">
          + Nueva Clase
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                <th className="px-4 py-3 text-left">Clase</th>
                <th className="px-4 py-3 text-left">Familia</th>
                <th className="px-4 py-3 text-left">Proceso</th>
                <th className="px-4 py-3 text-left">Descripción</th>
                <th className="px-4 py-3 text-center">Estado</th>
                <th className="px-4 py-3 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtrados.map(item => (
                <tr key={item.Clase} className={`hover:bg-gray-50 transition ${!item.Activo ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3 font-mono font-bold text-gray-700">{item.Clase}</td>
                  <td className="px-4 py-3 text-gray-700">{item.Familia}</td>
                  <td className="px-4 py-3 text-gray-700">{item.Proceso}</td>
                  <td className="px-4 py-3 text-gray-900">{item.Descripcion}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${item.Activo ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                      {item.Activo ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center gap-2">
                      <button onClick={() => setModal({ open: true, item })}
                        className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition">Editar</button>
                      <button onClick={() => handleToggle(item)}
                        className={`text-xs font-medium px-2 py-1 rounded transition ${item.Activo ? "text-red-500 hover:text-red-700 hover:bg-red-50" : "text-green-600 hover:text-green-800 hover:bg-green-50"}`}>
                        {item.Activo ? "Desactivar" : "Activar"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Sin registros</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modal.open && (
        <ClaseModal item={modal.item} familias={familias} procesos={procesos}
          onSave={handleSave} onClose={() => setModal({ open: false, item: null })} />
      )}
    </div>
  );
}
