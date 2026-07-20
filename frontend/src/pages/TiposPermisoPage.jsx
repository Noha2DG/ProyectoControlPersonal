import { useState, useEffect } from "react";
import { authHeader } from "../context/AuthContext.jsx";
import { useColWidths, Th, Colgroup } from "../components/ResizableTh.jsx";

const API = "/api/tipos-permiso";
const EMPTY = { codigoPermiso: "", descripcion: "" };

const COL_DEFAULTS = { codigo: 100, descripcion: 280, estado: 110, acciones: 150 };
const COLS = Object.keys(COL_DEFAULTS);

function TipoPermisoModal({ tipo, onSave, onClose }) {
  const isEdit = !!tipo;
  const [form, setForm] = useState(isEdit ? { ...tipo } : EMPTY);
  const set = f => e => setForm(p => ({ ...p, [f]: e.target.value }));

  const handleSubmit = e => { e.preventDefault(); onSave(form); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">{isEdit ? "Editar Tipo de Permiso" : "Nuevo Tipo de Permiso"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Código *</label>
            <input
              required
              disabled={isEdit}
              value={form.codigoPermiso}
              onChange={set("codigoPermiso")}
              maxLength={10}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100"
              placeholder="Ej: MED"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Descripción *</label>
            <input
              required
              value={form.descripcion}
              onChange={set("descripcion")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="Ej: Permiso médico"
            />
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

export default function TiposPermisoPage() {
  const [tipos, setTipos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, tipo: null });
  const [filtro, setFiltro] = useState("Activo");
  const [widths, startResize] = useColWidths("tipos_permiso", COL_DEFAULTS);

  const fetchTipos = async () => {
    setLoading(true);
    try {
      const res = await fetch(API, { headers: authHeader() });
      const data = await res.json();
      if (Array.isArray(data)) setTipos(data);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchTipos(); }, []);

  const handleSave = async (form) => {
    const isEdit = tipos.some(t => t.codigoPermiso === form.codigoPermiso);
    const res = await fetch(isEdit ? `${API}/${form.codigoPermiso}` : API, {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(form),
    });
    if (res.ok) { setModal({ open: false, tipo: null }); fetchTipos(); }
    else { const e = await res.json(); alert("Error: " + e.error); }
  };

  const handleToggle = async (tipo) => {
    if (tipo.Activo) {
      if (!confirm(`¿Desactivar el tipo de permiso "${tipo.descripcion}"?`)) return;
      await fetch(`${API}/${tipo.codigoPermiso}`, { method: "DELETE", headers: authHeader() });
    } else {
      await fetch(`${API}/${tipo.codigoPermiso}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ ...tipo, Activo: true }),
      });
    }
    fetchTipos();
  };

  const tiposFiltrados = tipos.filter(t =>
    filtro === "Todos" || (filtro === "Activo" ? t.Activo : !t.Activo)
  );

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <div className="flex gap-1 bg-gray-200 rounded-lg p-1">
          {["Activo", "Inactivo", "Todos"].map(f => (
            <button key={f} onClick={() => setFiltro(f)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition ${filtro === f ? "bg-white shadow text-blue-700" : "text-gray-600 hover:text-gray-800"}`}>
              {f}
            </button>
          ))}
        </div>
        <span className="text-sm text-gray-500 ml-auto">{tiposFiltrados.length} tipo{tiposFiltrados.length !== 1 ? "s" : ""}</span>
        <button
          onClick={() => setModal({ open: true, tipo: null })}
          className="bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition"
        >
          + Nuevo Tipo
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
                <Th width={widths.descripcion} onResizeStart={startResize("descripcion")} className="px-4 py-3 text-left">Descripción</Th>
                <Th width={widths.estado} onResizeStart={startResize("estado")} className="px-4 py-3 text-center">Estado</Th>
                <Th width={widths.acciones} onResizeStart={startResize("acciones")} className="px-4 py-3 text-center">Acciones</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tiposFiltrados.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-gray-400">Sin tipos de permiso</td></tr>
              ) : tiposFiltrados.map(tipo => (
                <tr key={tipo.codigoPermiso} className={`hover:bg-gray-50 transition ${!tipo.Activo ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3 font-mono font-bold text-gray-700">{tipo.codigoPermiso}</td>
                  <td className="px-4 py-3 text-gray-900">{tipo.descripcion}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${tipo.Activo ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                      {tipo.Activo ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center gap-2">
                      <button onClick={() => setModal({ open: true, tipo })}
                        className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition">
                        Editar
                      </button>
                      <button onClick={() => handleToggle(tipo)}
                        className={`text-xs font-medium px-2 py-1 rounded transition ${tipo.Activo ? "text-red-500 hover:text-red-700 hover:bg-red-50" : "text-green-600 hover:text-green-800 hover:bg-green-50"}`}>
                        {tipo.Activo ? "Desactivar" : "Activar"}
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
        <TipoPermisoModal tipo={modal.tipo} onSave={handleSave} onClose={() => setModal({ open: false, tipo: null })} />
      )}
    </div>
  );
}
