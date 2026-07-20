import { useState, useEffect, useCallback } from "react";
import { authHeader } from "../context/AuthContext.jsx";
import { exportarPermisos } from "../utils/exportExcel.js";
import { useColWidths, Th, Colgroup } from "../components/ResizableTh.jsx";

const COL_DEFAULTS = { fecha: 110, codigo: 100, nombre: 200, etalent: 110, tipo: 170, obs: 260, registrado: 140, acciones: 110 };
const COLS = Object.keys(COL_DEFAULTS);

const API = "/api/permisos";

function hoyGT() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
}

function EmpleadoAutocomplete({ empleados, value, onSelect }) {
  const seleccionado = empleados.find(e => e.Codigo === value);
  const [query, setQuery] = useState(seleccionado ? seleccionado.Codigo : "");
  const [open, setOpen] = useState(false);

  const q = query.trim().toLowerCase();
  const sugerencias = q
    ? empleados.filter(e =>
        e.Codigo.toLowerCase().includes(q) || e.NombreCompleto.toLowerCase().includes(q)
      ).slice(0, 8)
    : [];

  const handleSelect = (emp) => {
    setQuery(emp.Codigo);
    setOpen(false);
    onSelect(emp.Codigo);
  };

  const handleChange = (e) => {
    setQuery(e.target.value);
    setOpen(true);
    if (value) onSelect("");
  };

  return (
    <div className="relative">
      <input
        type="text"
        required
        value={query}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Escribe el código del empleado"
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      {open && sugerencias.length > 0 && (
        <ul className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {sugerencias.map(e => (
            <li key={e.Codigo} onMouseDown={() => handleSelect(e)}
              className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer">
              <span className="font-mono font-bold text-gray-700">{e.Codigo}</span>
              <span className="text-gray-600"> — {e.NombreCompleto}</span>
            </li>
          ))}
        </ul>
      )}
      {value && seleccionado && (
        <p className="text-xs text-gray-500 mt-1">{seleccionado.NombreCompleto}</p>
      )}
    </div>
  );
}

function PermisoModal({ permiso, empleados, tipos, onSave, onClose }) {
  const isEdit = !!permiso;
  const [form, setForm] = useState(isEdit
    ? { CodigoEmpleado: permiso.CodigoEmpleado, codigoPermiso: permiso.codigoPermiso, Fecha: permiso.Fecha, Observacion: permiso.Observacion || "" }
    : { CodigoEmpleado: "", codigoPermiso: "", Fecha: hoyGT(), Observacion: "" }
  );
  const set = f => e => setForm(p => ({ ...p, [f]: e.target.value }));

  const handleSubmit = e => {
    e.preventDefault();
    if (!form.CodigoEmpleado) { alert("Selecciona un empleado válido de la lista"); return; }
    onSave(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">{isEdit ? "Editar Permiso" : "Nuevo Permiso"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Empleado *</label>
            {isEdit ? (
              <input disabled value={`${permiso.CodigoEmpleado} — ${permiso.NombreCompleto}`}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-100" />
            ) : (
              <EmpleadoAutocomplete
                empleados={empleados}
                value={form.CodigoEmpleado}
                onSelect={codigo => setForm(p => ({ ...p, CodigoEmpleado: codigo }))}
              />
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Tipo de Permiso *</label>
            <select
              required
              value={form.codigoPermiso}
              onChange={set("codigoPermiso")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="">Seleccionar...</option>
              {tipos.map(t => (
                <option key={t.codigoPermiso} value={t.codigoPermiso}>{t.descripcion}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Fecha *</label>
            <input type="date" required value={form.Fecha} onChange={set("Fecha")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Observación</label>
            <input value={form.Observacion} onChange={set("Observacion")}
              maxLength={255}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="Opcional" />
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

export default function PermisosPage() {
  const [fecha, setFecha] = useState(hoyGT());
  const [hasta, setHasta] = useState("");
  const [permisos, setPermisos] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [modal, setModal] = useState({ open: false, permiso: null });
  const [widths, startResize] = useColWidths("permisos", COL_DEFAULTS);

  const fetchPermisos = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ fecha, ...(hasta ? { hasta } : {}) });
      const res = await fetch(`${API}?${params}`, { headers: authHeader() });
      const data = await res.json();
      if (Array.isArray(data)) setPermisos(data);
    } finally { setLoading(false); }
  }, [fecha, hasta]);

  useEffect(() => { fetchPermisos(); }, [fetchPermisos]);

  useEffect(() => {
    fetch("/api/empleados", { headers: authHeader() }).then(r => r.json()).then(d => { if (Array.isArray(d)) setEmpleados(d.filter(e => e.Estado === "Activo")); });
    fetch("/api/tipos-permiso", { headers: authHeader() }).then(r => r.json()).then(d => { if (Array.isArray(d)) setTipos(d.filter(t => t.Activo)); });
  }, []);

  const handleSave = async (form) => {
    const isEdit = !!modal.permiso;
    const res = await fetch(isEdit ? `${API}/${modal.permiso.id}` : API, {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(form),
    });
    if (res.ok) { setModal({ open: false, permiso: null }); fetchPermisos(); }
    else { const e = await res.json(); alert("Error: " + e.error); }
  };

  const handleDelete = async (permiso) => {
    if (!confirm(`¿Eliminar el permiso de ${permiso.NombreCompleto}?`)) return;
    const res = await fetch(`${API}/${permiso.id}`, { method: "DELETE", headers: authHeader() });
    if (res.ok) fetchPermisos();
    else { const e = await res.json(); alert("Error: " + e.error); }
  };

  const filtrados = permisos.filter(p =>
    !busqueda ||
    p.NombreCompleto?.toLowerCase().includes(busqueda.toLowerCase()) ||
    p.CodigoEmpleado?.toLowerCase().includes(busqueda.toLowerCase())
  );

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 font-medium">Desde:</label>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 font-medium">Hasta:</label>
          <input type="date" value={hasta} min={fecha} onChange={e => setHasta(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          {hasta && (
            <button onClick={() => setHasta("")} className="text-xs text-gray-500 hover:text-gray-700 underline">Quitar</button>
          )}
        </div>
        <input type="text" placeholder="Buscar empleado o código..."
          value={busqueda} onChange={e => setBusqueda(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-400" />
        <span className="text-sm text-gray-500 ml-auto">{filtrados.length} permiso{filtrados.length !== 1 ? "s" : ""}</span>
        {filtrados.length > 0 && (
          <button
            onClick={() => exportarPermisos(filtrados, fecha, hasta)}
            className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-3 py-1.5 rounded-lg transition">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Exportar Excel
          </button>
        )}
        <button
          onClick={() => setModal({ open: true, permiso: null })}
          className="bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition"
        >
          + Nuevo Permiso
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
                <Th width={widths.fecha} onResizeStart={startResize("fecha")} className="px-4 py-3 text-left">Fecha</Th>
                <Th width={widths.codigo} onResizeStart={startResize("codigo")} className="px-4 py-3 text-left">Código</Th>
                <Th width={widths.nombre} onResizeStart={startResize("nombre")} className="px-4 py-3 text-left">Nombre</Th>
                <Th width={widths.etalent} onResizeStart={startResize("etalent")} className="px-4 py-3 text-left">Etalent</Th>
                <Th width={widths.tipo} onResizeStart={startResize("tipo")} className="px-4 py-3 text-left">Tipo de Permiso</Th>
                <Th width={widths.obs} onResizeStart={startResize("obs")} className="px-4 py-3 text-left">Observación</Th>
                <Th width={widths.registrado} onResizeStart={startResize("registrado")} className="px-4 py-3 text-left">Registrado por</Th>
                <Th width={widths.acciones} onResizeStart={startResize("acciones")} className="px-4 py-3 text-center">Acciones</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtrados.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">{hasta ? "Sin permisos en este rango de fechas" : "Sin permisos desde esta fecha"}</td></tr>
              ) : filtrados.map(p => (
                <tr key={p.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-2.5 text-gray-700 text-xs">{p.Fecha}</td>
                  <td className="px-4 py-2.5 font-mono font-bold text-gray-700">{p.CodigoEmpleado}</td>
                  <td className="px-4 py-2.5 text-gray-900 text-xs">{p.NombreCompleto}</td>
                  <td className="px-4 py-2.5 font-mono text-gray-500 text-xs">{p.CodigoEtalent || "—"}</td>
                  <td className="px-4 py-2.5 text-gray-700 text-xs">{p.descripcion}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{p.Observacion || "—"}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{p.RegistradoPor}</td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex justify-center gap-2">
                      <button onClick={() => setModal({ open: true, permiso: p })}
                        className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition">
                        Editar
                      </button>
                      <button onClick={() => handleDelete(p)}
                        className="text-red-500 hover:text-red-700 text-xs font-medium px-2 py-1 rounded hover:bg-red-50 transition">
                        Eliminar
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
        <PermisoModal permiso={modal.permiso} empleados={empleados} tipos={tipos}
          onSave={handleSave} onClose={() => setModal({ open: false, permiso: null })} />
      )}
    </div>
  );
}
