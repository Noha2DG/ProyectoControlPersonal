import { useState, useEffect, useCallback } from "react";
import { authHeader, usePuede } from "../context/AuthContext.jsx";
import { exportarMovimientos } from "../utils/exportExcel.js";
import EmpleadoAutocomplete from "../components/EmpleadoAutocomplete.jsx";
import { useColWidths, Th, Colgroup } from "../components/ResizableTh.jsx";

const TIPOS = ["Entrada", "Salida"];

const COL_DEFAULTS = { fecha: 100, codigo: 100, nombre: 190, tipo: 100, hora: 90, dia: 100, operador: 130, acciones: 110 };
const COLS = Object.keys(COL_DEFAULTS);

// Debe coincidir con LIMITE_HORAS_JORNADA en backend/src/lib/corteMedianoche.ts — más allá de esto,
// el corte de medianoche deja el ciclo abierto a propósito para que un supervisor lo revise.
const LIMITE_HORAS_JORNADA = 15;

function ahoraInputGT() {
  return new Date().toLocaleString("sv-SE", { timeZone: "America/Guatemala" }).slice(0, 16).replace(" ", "T");
}

function formatHorasAbierto(h) {
  const horas = Math.floor(h);
  const dias = Math.floor(horas / 24);
  if (dias >= 1) return `${dias}d ${horas % 24}h`;
  return `${horas}h`;
}

function RegistroModal({ registro, cierre, empleados, onSave, onClose }) {
  const isEdit = !!registro;
  const [form, setForm] = useState({
    Codigo: registro?.Codigo || cierre?.Codigo || "",
    FechaHora: registro?.FechaHoraInput || ahoraInputGT(),
    Tipo: registro?.Tipo || (cierre ? "Salida" : "Entrada"),
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
          <h2 className="text-base font-semibold text-gray-800">{cierre ? "Cerrar ciclo abierto" : isEdit ? "Corregir Registro" : "Registrar Movimiento Manual"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {cierre && (
            <div className="bg-amber-50 border border-amber-300 text-amber-800 rounded-lg px-3 py-2 text-xs">
              ⚠️ Esta Salida se registra manualmente para cerrar el ciclo abierto de <span className="font-semibold">{cierre.NombreEmpleado}</span> — no corresponde a un escaneo real del gafete.
            </div>
          )}
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
  const puedeEditar = usePuede("movimientos", "editar");
  const puedeEliminar = usePuede("movimientos", "eliminar");
  const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
  const [fecha, setFecha]       = useState(hoy);
  const [busqueda, setBusqueda] = useState("");
  const [registros, setRegistros] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [modal, setModal] = useState({ open: false, registro: null, cierre: null });
  const [widths, startResize] = useColWidths("movimientos", COL_DEFAULTS);
  const [ciclosAbiertos, setCiclosAbiertos] = useState([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/movimientos?fecha=${fecha}`, { headers: authHeader() });
      const data = await res.json();
      if (Array.isArray(data)) setRegistros(data);
    } finally { setLoading(false); }
  }, [fecha]);

  const fetchCiclosAbiertos = useCallback(async () => {
    const res = await fetch("/api/movimientos/ciclos-abiertos", { headers: authHeader() });
    const data = await res.json();
    if (Array.isArray(data)) setCiclosAbiertos(data);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchCiclosAbiertos(); }, [fetchCiclosAbiertos]);

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
    if (res.ok) { setModal({ open: false, registro: null, cierre: null }); fetchData(); fetchCiclosAbiertos(); }
    else { const e = await res.json(); alert("Error: " + e.error); }
  };

  const abrirCierre = (c) => setModal({ open: true, registro: null, cierre: { Codigo: c.Codigo, NombreEmpleado: c.NombreEmpleado } });

  const handleDelete = async (id, nombre) => {
    if (!confirm(`¿Eliminar el registro de ${nombre}?`)) return;
    const res = await fetch(`/api/movimientos/${id}`, { method: "DELETE", headers: authHeader() });
    if (res.ok) { fetchData(); fetchCiclosAbiertos(); }
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
        {puedeEditar && (
          <button
            onClick={() => setModal({ open: true, registro: null, cierre: null })}
            className="bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition"
          >
            + Registrar manual
          </button>
        )}
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

      {ciclosAbiertos.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-300 text-amber-800 rounded-lg px-4 py-2.5 text-sm">
          <p className="font-semibold mb-1.5">
            ⚠️ {ciclosAbiertos.length} empleado{ciclosAbiertos.length !== 1 ? "s" : ""} con ciclo abierto hace más de {LIMITE_HORAS_JORNADA} horas sin marcar Salida — probable olvido, no un turno real:
          </p>
          <ul className="space-y-1">
            {ciclosAbiertos.map(c => (
              <li key={c.Codigo} className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-bold">{c.Codigo}</span>
                <span>{c.NombreEmpleado}</span>
                <span className="text-amber-600 text-xs">
                  entró {c.FechaHora?.slice(0, 16)} · {formatHorasAbierto(c.HorasAbierto)} abierto
                </span>
                {puedeEditar && (
                  <button onClick={() => abrirCierre(c)}
                    className="ml-auto text-xs font-semibold text-blue-700 hover:underline">
                    Cerrar ahora
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

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
                <Th width={widths.tipo} onResizeStart={startResize("tipo")} className="px-4 py-3 text-center">Tipo</Th>
                <Th width={widths.hora} onResizeStart={startResize("hora")} className="px-4 py-3 text-center">Hora</Th>
                <Th width={widths.dia} onResizeStart={startResize("dia")} className="px-4 py-3 text-center">Día</Th>
                <Th width={widths.operador} onResizeStart={startResize("operador")} className="px-4 py-3 text-center">Operador</Th>
                <Th width={widths.acciones} onResizeStart={startResize("acciones")} className="px-4 py-3 text-center">Acciones</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtrados.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Sin registros desde esta fecha</td></tr>
              ) : filtrados.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-2.5 text-gray-500 text-xs font-mono">{r.Fecha ? r.Fecha.split("-").reverse().join("/") : ""}</td>
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
                      {puedeEditar && (
                        <button onClick={() => setModal({ open: true, registro: r, cierre: null })}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition">
                          Editar
                        </button>
                      )}
                      {puedeEliminar && (
                        <button onClick={() => handleDelete(r.id, r.NombreEmpleado)}
                          className="text-red-500 hover:text-red-700 text-xs font-medium px-2 py-1 rounded hover:bg-red-50 transition">
                          Eliminar
                        </button>
                      )}
                      {!puedeEditar && !puedeEliminar && <span className="text-gray-300 text-xs">—</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal.open && (
        <RegistroModal registro={modal.registro} cierre={modal.cierre} empleados={empleados} onSave={handleSave}
          onClose={() => setModal({ open: false, registro: null, cierre: null })} />
      )}
    </div>
  );
}
