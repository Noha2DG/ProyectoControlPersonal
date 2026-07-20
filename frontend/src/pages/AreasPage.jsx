import { useState, useEffect } from "react";
import { authHeader } from "../context/AuthContext.jsx";
import { useColWidths, Th, Colgroup } from "../components/ResizableTh.jsx";

const API = "/api/areas";
const FORMAS_PAGO = ["Paga por Tiempo", "Paga por Obra", "No Genera Paga"];

const COL_DEFAULTS = { codigo: 100, nombre: 220, forma: 170, estado: 110, acciones: 150 };
const COLS = Object.keys(COL_DEFAULTS);

const EMPTY = { Codigo: "", Nombre: "", FormaPago: "" };

function AreaModal({ area, onSave, onClose }) {
  const isEdit = !!area;
  const [form, setForm] = useState(isEdit ? { ...area, FormaPago: area.FormaPago || "" } : EMPTY);
  const set = f => e => setForm(p => ({ ...p, [f]: e.target.value }));

  const handleSubmit = e => { e.preventDefault(); onSave(form); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">{isEdit ? "Editar Área" : "Nueva Área"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Código *</label>
            <input
              required
              disabled={isEdit}
              value={form.Codigo}
              onChange={set("Codigo")}
              maxLength={10}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100"
              placeholder="Ej: DS"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Nombre *</label>
            <input
              required
              value={form.Nombre}
              onChange={set("Nombre")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="Nombre del área"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Forma de Pago</label>
            <select
              value={form.FormaPago}
              onChange={set("FormaPago")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="">Sin especificar</option>
              {FORMAS_PAGO.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
              Cancelar
            </button>
            <button type="submit" className="px-5 py-2 text-sm bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition">
              {isEdit ? "Guardar" : "Crear"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const FORMA_BADGE = {
  "Paga por Tiempo": "bg-blue-100 text-blue-700",
  "Paga por Obra":   "bg-purple-100 text-purple-700",
  "No Genera Paga":  "bg-gray-100 text-gray-500",
};

export default function AreasPage() {
  const [areas, setAreas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, area: null });
  const [filtro, setFiltro] = useState("Activa");
  const [widths, startResize] = useColWidths("areas", COL_DEFAULTS);

  const fetchAreas = async () => {
    setLoading(true);
    try {
      const res = await fetch(API, { headers: authHeader() });
      const data = await res.json();
      if (Array.isArray(data)) setAreas(data);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchAreas(); }, []);

  const handleSave = async (form) => {
    const isEdit = !!form.Codigo && areas.some(a => a.Codigo === form.Codigo);
    const res = await fetch(isEdit ? `${API}/${form.Codigo}` : API, {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(form),
    });
    if (res.ok) { setModal({ open: false, area: null }); fetchAreas(); }
    else { const e = await res.json(); alert("Error: " + e.error); }
  };

  const handleToggle = async (area) => {
    if (area.Activa) {
      if (!confirm(`¿Desactivar el área "${area.Nombre}"?`)) return;
      await fetch(`${API}/${area.Codigo}`, { method: "DELETE", headers: authHeader() });
    } else {
      await fetch(`${API}/${area.Codigo}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ ...area, Activa: true }),
      });
    }
    fetchAreas();
  };

  const areasFiltradas = areas.filter(a =>
    filtro === "Todas" || (filtro === "Activa" ? a.Activa : !a.Activa)
  );

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <div className="flex gap-1 bg-gray-200 rounded-lg p-1">
          {["Activa", "Inactiva", "Todas"].map(f => (
            <button key={f} onClick={() => setFiltro(f)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition ${filtro === f ? "bg-white shadow text-blue-700" : "text-gray-600 hover:text-gray-800"}`}>
              {f}
            </button>
          ))}
        </div>
        <span className="text-sm text-gray-500 ml-auto">{areasFiltradas.length} área{areasFiltradas.length !== 1 ? "s" : ""}</span>
        <button
          onClick={() => setModal({ open: true, area: null })}
          className="bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition"
        >
          + Nueva Área
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <table className="w-full text-sm table-fixed">
            <Colgroup columns={COLS} widths={widths} />
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                <Th width={widths.codigo} onResizeStart={startResize("codigo")} className="px-4 py-3 text-left">Código</Th>
                <Th width={widths.nombre} onResizeStart={startResize("nombre")} className="px-4 py-3 text-left">Nombre</Th>
                <Th width={widths.forma} onResizeStart={startResize("forma")} className="px-4 py-3 text-left">Forma de Pago</Th>
                <Th width={widths.estado} onResizeStart={startResize("estado")} className="px-4 py-3 text-center">Estado</Th>
                <Th width={widths.acciones} onResizeStart={startResize("acciones")} className="px-4 py-3 text-center">Acciones</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {areasFiltradas.map(area => (
                <tr key={area.Codigo} className={`hover:bg-gray-50 transition ${!area.Activa ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3 font-mono font-bold text-gray-700">{area.Codigo}</td>
                  <td className="px-4 py-3 text-gray-900">{area.Nombre}</td>
                  <td className="px-4 py-3">
                    {area.FormaPago ? (
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${FORMA_BADGE[area.FormaPago] || "bg-gray-100 text-gray-500"}`}>
                        {area.FormaPago}
                      </span>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${area.Activa ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                      {area.Activa ? "Activa" : "Inactiva"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center gap-2">
                      <button onClick={() => setModal({ open: true, area })}
                        className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition">
                        Editar
                      </button>
                      <button onClick={() => handleToggle(area)}
                        className={`text-xs font-medium px-2 py-1 rounded transition ${area.Activa ? "text-red-500 hover:text-red-700 hover:bg-red-50" : "text-green-600 hover:text-green-800 hover:bg-green-50"}`}>
                        {area.Activa ? "Desactivar" : "Activar"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal.open && (
        <AreaModal area={modal.area} onSave={handleSave} onClose={() => setModal({ open: false, area: null })} />
      )}
    </div>
  );
}
