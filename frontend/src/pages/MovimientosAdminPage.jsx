import { useState, useEffect, useCallback } from "react";
import { authHeader } from "../context/AuthContext.jsx";
import { exportarMovimientos } from "../utils/exportExcel.js";
import EmpleadoAutocomplete from "../components/EmpleadoAutocomplete.jsx";

const TIPOS = ["Entrada", "Salida"];

function ahoraInputGT() {
  return new Date().toLocaleString("sv-SE", { timeZone: "America/Guatemala" }).slice(0, 16).replace(" ", "T");
}

function RegistroModal({ registro, empleados, onSave, onClose }) {
  const isEdit = !!registro;
  const [form, setForm] = useState({
    Codigo: registro?.Codigo || "",
    FechaHora: registro?.FechaHoraInput || ahoraInputGT(),
    Tipo: registro?.Tipo || "Entrada",
  });

  const handleSubmit = e => {
    e.preventDefault();
    if (!form.Codigo) { alert("Selecciona un empleado válido de la lista"); return; }
    onSave(registro?.id, form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">{isEdit ? "Corregir Registro" : "Registrar Movimiento Manual"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Empleado</label>
            <EmpleadoAutocomplete
              empleados={empleados}
              value={form.Codigo}
              onSelect={codigo => setForm(p => ({ ...p, Codigo: codigo }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Fecha y Hora</label>
            <input type="datetime-local" required value={form.FechaHora}
              onChange={e => setForm(p => ({ ...p, FechaHora: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Tipo</label>
            <div className="flex gap-2">
              {TIPOS.map(t => (
                <button key={t} type="button" onClick={() => setForm(p => ({ ...p, Tipo: t }))}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition ${
                    form.Tipo === t
                      ? t === "Entrada" ? "bg-green-500 text-white border-green-500" : "bg-red-500 text-white border-red-500"
                      : "border-gray-300 text-gray-600 hover:bg-gray-50"
                  }`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">Cancelar</button>
            <button type="submit" className="px-5 py-2 text-sm bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700">{isEdit ? "Guardar" : "Crear"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function MovimientosAdminPage() {
  const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
  const [fecha, setFecha]       = useState(hoy);
  const [busqueda, setBusqueda] = useState("");
  const [registros, setRegistros] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [modal, setModal] = useState({ open: false, registro: null });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/movimientos?fecha=${fecha}`, { headers: authHeader() });
      const data = await res.json();
      if (Array.isArray(data)) setRegistros(data);
    } finally { setLoading(false); }
  }, [fecha]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    fetch("/api/empleados", { headers: authHeader() }).then(r => r.json())
      .then(d => { if (Array.isArray(d)) setEmpleados(d.filter(e => e.Estado === "Activo")); });
  }, []);

  const handleSave = async (id, form) => {
    const isEdit = !!id;
    const res = await fetch(isEdit ? `/api/movimientos/${id}` : "/api/movimientos", {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(form),
    });
    if (res.ok) { setModal({ open: false, registro: null }); fetchData(); }
    else { const e = await res.json(); alert("Error: " + e.error); }
  };

  const handleDelete = async (id, nombre) => {
    if (!confirm(`¿Eliminar el registro de ${nombre}?`)) return;
    const res = await fetch(`/api/movimientos/${id}`, { method: "DELETE", headers: authHeader() });
    if (res.ok) fetchData();
    else { const e = await res.json(); alert("Error: " + e.error); }
  };

  const filtrados = registros.filter(r =>
    !busqueda ||
    r.NombreEmpleado?.toLowerCase().includes(busqueda.toLowerCase()) ||
    r.Codigo?.toLowerCase().includes(busqueda.toLowerCase())
  );

  return (
    <div>
      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 font-medium">Desde:</label>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        <input type="text" placeholder="Buscar empleado o código..."
          value={busqueda} onChange={e => setBusqueda(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-400" />
        <button onClick={fetchData} className="text-blue-600 hover:text-blue-800 text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-blue-50 border border-blue-200 transition">
          Actualizar
        </button>
        <button
          onClick={() => setModal({ open: true, registro: null })}
          className="bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition"
        >
          + Registrar manual
        </button>
        <span className="text-sm text-gray-500 ml-auto">{filtrados.length} registro{filtrados.length !== 1 ? "s" : ""}</span>
        {filtrados.length > 0 && (
          <button
            onClick={() => exportarMovimientos(filtrados, fecha)}
            className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-3 py-1.5 rounded-lg transition">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Exportar Excel
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                <th className="px-4 py-3 text-left">ID</th>
                <th className="px-4 py-3 text-left">Código</th>
                <th className="px-4 py-3 text-left">Nombre</th>
                <th className="px-4 py-3 text-center">Tipo</th>
                <th className="px-4 py-3 text-center">Hora</th>
                <th className="px-4 py-3 text-center">Día</th>
                <th className="px-4 py-3 text-center">Operador</th>
                <th className="px-4 py-3 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtrados.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Sin registros desde esta fecha</td></tr>
              ) : filtrados.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-2.5 text-gray-400 text-xs font-mono">{r.id}</td>
                  <td className="px-4 py-2.5 font-mono font-bold text-gray-700">{r.Codigo}</td>
                  <td className="px-4 py-2.5 text-gray-900">{r.NombreEmpleado}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                      r.Tipo === "Entrada" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
                    }`}>{r.Tipo}</span>
                  </td>
                  <td className="px-4 py-2.5 text-center font-mono text-gray-700">{r.Hora}</td>
                  <td className="px-4 py-2.5 text-center text-gray-500 text-xs">{r.DiaSemana}</td>
                  <td className="px-4 py-2.5 text-center text-gray-500 text-xs">{r.Operador}</td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex justify-center gap-2">
                      <button onClick={() => setModal({ open: true, registro: r })}
                        className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition">
                        Editar
                      </button>
                      <button onClick={() => handleDelete(r.id, r.NombreEmpleado)}
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
        <RegistroModal registro={modal.registro} empleados={empleados} onSave={handleSave} onClose={() => setModal({ open: false, registro: null })} />
      )}
    </div>
  );
}
