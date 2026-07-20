import { useState, useEffect } from "react";
import { authHeader } from "../context/AuthContext.jsx";
import { useColWidths, Th, Colgroup } from "./ResizableTh.jsx";

function CatalogoModal({ item, pk, pkLabel, pkType, camposExtra, onSave, onClose }) {
  const isEdit = !!item;
  const vacio = { [pk]: "", Descripcion: "", ...Object.fromEntries(camposExtra.map(c => [c.campo, c.opciones?.[0] ?? ""])) };
  const [form, setForm] = useState(isEdit ? { ...vacio, ...item } : vacio);
  const set = f => e => setForm(p => ({ ...p, [f]: e.target.value }));

  const handleSubmit = e => { e.preventDefault(); onSave(form); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">{isEdit ? "Editar" : "Nuevo"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{pkLabel} *</label>
            <input
              required
              disabled={isEdit}
              type={pkType === "number" ? "number" : "text"}
              value={form[pk]}
              onChange={set(pk)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Descripción *</label>
            <input
              required
              value={form.Descripcion}
              onChange={set("Descripcion")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          {camposExtra.map(c => {
            const requerido = c.requerido !== false;
            return (
              <div key={c.campo}>
                <label className="block text-xs font-medium text-gray-500 mb-1">{c.label}{requerido ? " *" : ""}</label>
                {c.opciones ? (
                  <select required={requerido} value={form[c.campo]} onChange={set(c.campo)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                    {!requerido && <option value="">Sin especificar</option>}
                    {c.opciones.map(op => <option key={op} value={op}>{op}</option>)}
                  </select>
                ) : (
                  <input required={requerido} value={form[c.campo]} onChange={set(c.campo)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                )}
              </div>
            );
          })}
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

// Mantenimiento genérico para catálogos simples: Código + Descripción (+ campos extra) + Activo.
// api: ruta base, ej "/api/familia". pk: nombre del campo llave, ej "Codigo".
// camposExtra: [{ campo: "TipoEmpaque", label: "Tipo de Empaque", opciones: ["Individual","Master"] }]
export default function CatalogoSimpleTable({ api, pk, pkLabel = "Código", pkType = "text", nuevoLabel = "+ Nuevo", camposExtra = [] }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, item: null });
  const [filtro, setFiltro] = useState("Activo");
  const [busqueda, setBusqueda] = useState("");

  const COL_DEFAULTS = { [pk]: 110, descripcion: 240, ...Object.fromEntries(camposExtra.map(c => [c.campo, 140])), estado: 100, acciones: 150 };
  const COLS = [pk, "descripcion", ...camposExtra.map(c => c.campo), "estado", "acciones"];
  const [widths, startResize] = useColWidths(`catalogo:${api}`, COL_DEFAULTS);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await fetch(api, { headers: authHeader() });
      const data = await res.json();
      if (Array.isArray(data)) setItems(data);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchItems(); }, [api]);

  const handleSave = async (form) => {
    const isEdit = !!form[pk] && items.some(i => String(i[pk]) === String(form[pk]));
    const res = await fetch(isEdit ? `${api}/${form[pk]}` : api, {
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
      await fetch(`${api}/${item[pk]}`, { method: "DELETE", headers: authHeader() });
    } else {
      await fetch(`${api}/${item[pk]}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ ...item, Activo: true }),
      });
    }
    fetchItems();
  };

  const q = busqueda.toLowerCase();
  const filtrados = items.filter(i => {
    const matchEstado = filtro === "Todos" || (filtro === "Activo" ? i.Activo : !i.Activo);
    const matchBusqueda = !q || String(i[pk]).toLowerCase().includes(q) || String(i.Descripcion).toLowerCase().includes(q);
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
        <span className="text-sm text-gray-500 ml-auto">{filtrados.length} registro{filtrados.length !== 1 ? "s" : ""}</span>
        <button onClick={() => setModal({ open: true, item: null })}
          className="bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition">
          {nuevoLabel}
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
                <Th width={widths[pk]} onResizeStart={startResize(pk)} className="px-4 py-3 text-left">{pkLabel}</Th>
                <Th width={widths.descripcion} onResizeStart={startResize("descripcion")} className="px-4 py-3 text-left">Descripción</Th>
                {camposExtra.map(c => (
                  <Th key={c.campo} width={widths[c.campo]} onResizeStart={startResize(c.campo)} className="px-4 py-3 text-left">{c.label}</Th>
                ))}
                <Th width={widths.estado} onResizeStart={startResize("estado")} className="px-4 py-3 text-center">Estado</Th>
                <Th width={widths.acciones} onResizeStart={startResize("acciones")} className="px-4 py-3 text-center">Acciones</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtrados.map(item => (
                <tr key={item[pk]} className={`hover:bg-gray-50 transition ${!item.Activo ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3 font-mono font-bold text-gray-700">{item[pk]}</td>
                  <td className="px-4 py-3 text-gray-900">{item.Descripcion}</td>
                  {camposExtra.map(c => <td key={c.campo} className="px-4 py-3 text-gray-700">{item[c.campo]}</td>)}
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${item.Activo ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                      {item.Activo ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center gap-2">
                      <button onClick={() => setModal({ open: true, item })}
                        className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition">
                        Editar
                      </button>
                      <button onClick={() => handleToggle(item)}
                        className={`text-xs font-medium px-2 py-1 rounded transition ${item.Activo ? "text-red-500 hover:text-red-700 hover:bg-red-50" : "text-green-600 hover:text-green-800 hover:bg-green-50"}`}>
                        {item.Activo ? "Desactivar" : "Activar"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr><td colSpan={4 + camposExtra.length} className="px-4 py-8 text-center text-gray-400">Sin registros</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modal.open && (
        <CatalogoModal item={modal.item} pk={pk} pkLabel={pkLabel} pkType={pkType} camposExtra={camposExtra}
          onSave={handleSave} onClose={() => setModal({ open: false, item: null })} />
      )}
    </div>
  );
}
