import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { authHeader } from "../context/AuthContext.jsx";
import { exportarTransferencias } from "../utils/exportExcel.js";

function formatMin(m) {
  if (m == null || m < 0) return "—";
  if (m < 60) return `${m}m`;
  return `${Math.floor(m/60)}h ${m%60 > 0 ? m%60+"m" : ""}`.trim();
}

function EditModal({ registro, onSave, onClose }) {
  const [form, setForm] = useState({
    FechaHora:   registro.FechaHoraInput   || "",
    FechaSalida: registro.FechaSalidaInput || "",
  });
  const handleSubmit = e => { e.preventDefault(); onSave(registro.id, form); };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-800">Corregir Transferencia</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              <span className="font-mono font-bold text-blue-700">{registro.CodigoArea}</span> {registro.NombreArea} · {registro.Codigo}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Hora de Entrada</label>
            <input type="datetime-local" required value={form.FechaHora}
              onChange={e => setForm(p => ({ ...p, FechaHora: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Hora de Salida <span className="text-gray-400">(vacío = en curso)</span></label>
            <input type="datetime-local" value={form.FechaSalida}
              onChange={e => setForm(p => ({ ...p, FechaSalida: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            {form.FechaSalida && (
              <button type="button" onClick={() => setForm(p => ({ ...p, FechaSalida: "" }))}
                className="text-xs text-red-500 mt-1 hover:underline">
                Quitar hora de salida
              </button>
            )}
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">Cancelar</button>
            <button type="submit" className="px-5 py-2 text-sm bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700">Guardar</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function TransferenciasAdminPage() {
  const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
  const [fecha, setFecha]       = useState(hoy);
  const [busqueda, setBusqueda] = useState("");
  const [areaFiltro, setAreaFiltro] = useState("");
  const [areaTexto, setAreaTexto] = useState("");
  const [areaAbierto, setAreaAbierto] = useState(false);
  const [registros, setRegistros] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [editando, setEditando] = useState(null);
  const [permisosEmpleado, setPermisosEmpleado] = useState([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/transferencias?fecha=${fecha}`, { headers: authHeader() });
      const data = await res.json();
      if (Array.isArray(data)) setRegistros(data);
    } finally { setLoading(false); }
  }, [fecha]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSave = async (id, form) => {
    const res = await fetch(`/api/transferencias/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(form),
    });
    if (res.ok) { setEditando(null); fetchData(); }
    else { const e = await res.json(); alert("Error: " + e.error); }
  };

  const handleDelete = async (id, nombre) => {
    if (!confirm(`¿Eliminar la transferencia de ${nombre}?`)) return;
    const res = await fetch(`/api/transferencias/${id}`, { method: "DELETE", headers: authHeader() });
    if (res.ok) fetchData();
    else { const e = await res.json(); alert("Error: " + e.error); }
  };

  const areas = [...new Map(
    registros.filter(r => r.CodigoArea).map(r => [r.CodigoArea, r.NombreArea])
  ).entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const areasSugeridas = areas.filter(([codigo, nombre]) => {
    const q = areaTexto.trim().toLowerCase();
    if (!q) return true;
    return codigo.toLowerCase().includes(q) || nombre?.toLowerCase().includes(q);
  });

  const seleccionarArea = ([codigo, nombre]) => {
    setAreaFiltro(codigo);
    setAreaTexto(`${codigo} — ${nombre}`);
    setAreaAbierto(false);
  };

  const limpiarArea = () => {
    setAreaFiltro("");
    setAreaTexto("");
  };

  const filtrados = registros.filter(r =>
    (!busqueda ||
      r.NombreCompleto?.toLowerCase().includes(busqueda.toLowerCase()) ||
      r.Codigo?.toLowerCase().includes(busqueda.toLowerCase())) &&
    (!areaFiltro || r.CodigoArea === areaFiltro)
  );
  if (areaFiltro) filtrados.sort((a, b) => (b.Minutos ?? 0) - (a.Minutos ?? 0));

  const nombreAreaFiltro = areas.find(([codigo]) => codigo === areaFiltro)?.[1];
  const fechasUnicas = [...new Set(filtrados.map(r => r.Fecha))];
  const impresoEn = new Date().toLocaleString("sv-SE", { timeZone: "America/Guatemala", hour12: false }).slice(0, 16);

  // Si la búsqueda quedó acotada a un solo empleado, avisar si tiene permisos en el rango filtrado
  const codigosUnicos = [...new Set(filtrados.map(r => r.Codigo))];
  const empleadoUnico = busqueda.trim() && codigosUnicos.length === 1 ? codigosUnicos[0] : null;

  useEffect(() => {
    if (!empleadoUnico) { setPermisosEmpleado([]); return; }
    fetch(`/api/permisos?codigo=${empleadoUnico}&desde=${fecha}`, { headers: authHeader() })
      .then(r => r.ok ? r.json() : [])
      .then(data => setPermisosEmpleado(Array.isArray(data) ? data : []))
      .catch(() => setPermisosEmpleado([]));
  }, [empleadoUnico, fecha]);

  return (
    <>
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
        <div className="relative w-64">
          <input type="text" placeholder="Buscar área por código o nombre..."
            value={areaTexto}
            onChange={e => {
              setAreaTexto(e.target.value);
              setAreaFiltro("");
              setAreaAbierto(true);
            }}
            onFocus={() => setAreaAbierto(true)}
            onBlur={() => setTimeout(() => setAreaAbierto(false), 150)}
            className="w-full border border-gray-300 rounded-lg pl-3 pr-7 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          {areaTexto && (
            <button type="button" onClick={limpiarArea} tabIndex={-1}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm">
              &times;
            </button>
          )}
          {areaAbierto && areasSugeridas.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full max-h-60 overflow-auto bg-white border border-gray-200 rounded-lg shadow-lg text-sm">
              {areasSugeridas.map(([codigo, nombre]) => (
                <li key={codigo}
                  onMouseDown={() => seleccionarArea([codigo, nombre])}
                  className="px-3 py-1.5 hover:bg-blue-50 cursor-pointer flex gap-2">
                  <span className="font-mono font-bold text-blue-700">{codigo}</span>
                  <span className="text-gray-700">{nombre}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button onClick={fetchData} className="text-blue-600 hover:text-blue-800 text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-blue-50 border border-blue-200 transition">
          Actualizar
        </button>
        <span className="text-sm text-gray-500 ml-auto">{filtrados.length} registro{filtrados.length !== 1 ? "s" : ""}</span>
        {filtrados.length > 0 && (
          <>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" />
              </svg>
              Imprimir
            </button>
            <button
              onClick={() => exportarTransferencias(filtrados, fecha)}
              className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-3 py-1.5 rounded-lg transition">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Exportar Excel
            </button>
          </>
        )}
      </div>

      {permisosEmpleado.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-300 text-amber-800 rounded-lg px-4 py-2.5 text-sm">
          📋 <span className="font-semibold">{permisosEmpleado[0].NombreCompleto}</span> tiene {permisosEmpleado.length} permiso{permisosEmpleado.length !== 1 ? "s" : ""} registrado{permisosEmpleado.length !== 1 ? "s" : ""} en el rango filtrado:{" "}
          {permisosEmpleado.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ", "}
              <span className="font-medium">{p.descripcion}</span> ({p.Fecha.split("-").reverse().join("/")})
            </span>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                <th className="px-4 py-3 text-left">Fecha</th>
                <th className="px-4 py-3 text-left">Código</th>
                <th className="px-4 py-3 text-left">Nombre</th>
                <th className="px-4 py-3 text-center">Área</th>
                <th className="px-4 py-3 text-left">Nombre del Área</th>
                <th className="px-4 py-3 text-center">H. Entrada</th>
                <th className="px-4 py-3 text-center">H. Salida</th>
                <th className="px-4 py-3 text-center">Duración</th>
                <th className="px-4 py-3 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtrados.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">Sin registros desde esta fecha</td></tr>
              ) : filtrados.map(r => {
                const abierto = !r.HoraSalida;
                return (
                  <tr key={r.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-2.5 text-gray-600 text-xs">{r.Fecha?.split("-").reverse().join("/")}</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-gray-700">{r.Codigo}</td>
                    <td className="px-4 py-2.5 text-gray-900 text-xs">{r.NombreCompleto}</td>
                    <td className="px-4 py-2.5 text-center font-mono font-bold text-blue-700">{r.CodigoArea}</td>
                    <td className="px-4 py-2.5 text-gray-700 text-xs">{r.NombreArea}</td>
                    <td className="px-4 py-2.5 text-center font-mono text-gray-600 text-xs">{r.HoraEntrada}</td>
                    <td className="px-4 py-2.5 text-center font-mono text-xs">
                      {abierto
                        ? <span className="text-green-600 font-semibold">En curso</span>
                        : <span className="text-gray-600">{r.HoraSalida}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`font-semibold text-xs ${abierto ? "text-green-700" : "text-gray-700"}`}>
                        {formatMin(r.Minutos)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex justify-center gap-2">
                        <button onClick={() => setEditando(r)}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition">
                          Editar
                        </button>
                        <button onClick={() => handleDelete(r.id, r.NombreCompleto)}
                          className="text-red-500 hover:text-red-700 text-xs font-medium px-2 py-1 rounded hover:bg-red-50 transition">
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editando && (
        <EditModal registro={editando} onSave={handleSave} onClose={() => setEditando(null)} />
      )}
    </div>

    {/* Hoja imprimible — se monta en #print-root (fuera de #root) para que solo ella
        quede en el documento cuando #root se oculta al imprimir (ver index.css) */}
    {createPortal(
    <div className="hidden print:block font-sans text-slate-700">
      <div className="flex items-end justify-between border-b-[3px] border-slate-900 pb-2 mb-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-700">EsteroMar · Control de Personal</p>
          <h1 className="text-xl font-extrabold uppercase text-slate-900 tracking-tight">Transferencias</h1>
          <p className="text-[10px] text-gray-500 mt-0.5">
            {fechasUnicas.length === 1
              ? fechasUnicas[0]?.split("-").reverse().join("/")
              : `Desde ${fecha.split("-").reverse().join("/")}`}
            {areaFiltro && <> · Área <span className="font-mono font-bold text-blue-700">{areaFiltro}</span> — {nombreAreaFiltro}</>}
            {busqueda && <> · «{busqueda}»</>}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold text-slate-900 tabular-nums">{filtrados.length} registro{filtrados.length !== 1 ? "s" : ""}</p>
          <p className="text-[10px] text-gray-400 font-mono mt-0.5">impreso {impresoEn}</p>
        </div>
      </div>

      <table className="print-table w-full border-collapse text-[11px] leading-tight table-fixed">
        <colgroup>
          <col className="w-[9%]" /><col className="w-[11%]" /><col className="w-[26%]" />
          <col className="w-[7%]" /><col className="w-[16%]" /><col className="w-[10%]" />
          <col className="w-[10%]" /><col className="w-[11%]" />
        </colgroup>
        <thead>
          <tr>
            <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Fecha</th>
            <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Código</th>
            <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Nombre</th>
            <th className="text-center font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Área</th>
            <th className="text-left font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Nombre del Área</th>
            <th className="text-center font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">H. Entrada</th>
            <th className="text-center font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">H. Salida</th>
            <th className="text-right font-bold uppercase tracking-wider text-gray-400 border-b-2 border-slate-900 py-1 px-1">Duración</th>
          </tr>
        </thead>
        <tbody>
          {filtrados.map(r => {
            const abierto = !r.HoraSalida;
            return (
              <tr key={r.id} className="border-b border-gray-100">
                <td className="py-0.5 px-1 text-gray-500 tabular-nums">{r.Fecha?.split("-").reverse().join("/")}</td>
                <td className="py-0.5 px-1 font-mono font-bold text-blue-700 truncate">{r.Codigo}</td>
                <td className="py-0.5 px-1 text-slate-800 font-medium truncate">{r.NombreCompleto}</td>
                <td className="py-0.5 px-1 font-mono font-bold text-slate-500 text-center">{r.CodigoArea}</td>
                <td className="py-0.5 px-1 text-slate-600 truncate">{r.NombreArea}</td>
                <td className="py-0.5 px-1 font-mono text-center tabular-nums">{r.HoraEntrada}</td>
                <td className="py-0.5 px-1 font-mono text-center tabular-nums">
                  {abierto ? <span className="text-green-700 font-semibold">En curso</span> : r.HoraSalida}
                </td>
                <td className={`py-0.5 px-1 text-right font-bold tabular-nums ${abierto ? "text-green-700" : "text-slate-700"}`}>
                  {formatMin(r.Minutos)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>,
    document.getElementById("print-root")
    )}
    </>
  );
}
