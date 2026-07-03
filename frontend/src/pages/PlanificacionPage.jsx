import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { authHeader } from "../context/AuthContext.jsx";
import AsistenciaDiariaModal from "../components/AsistenciaDiariaModal.jsx";

const API = "/api/planificacion";
const AREAS_LIBRES = ["TT"]; // exentas de planificación, siempre disponibles

export default function PlanificacionPage() {
  const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
  const [fecha, setFecha]   = useState(hoy);
  const [areas, setAreas]   = useState([]);  // [{ CodigoArea, Nombre, FormaPago, Cantidad, ocupacion, disponible }]
  const [loading, setLoading]   = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado]   = useState(false);
  const [modalResumen, setModalResumen] = useState(false);
  const [modalAsistencia, setModalAsistencia] = useState(false);
  const [busqueda, setBusqueda]   = useState("");

  const fetchPlan = useCallback(async () => {
    setLoading(true);
    setGuardado(false);
    try {
      const res = await fetch(`${API}?fecha=${fecha}`, { headers: authHeader() });
      const data = await res.json();
      if (Array.isArray(data)) setAreas(data);
    } finally { setLoading(false); }
  }, [fecha]);

  useEffect(() => { fetchPlan(); }, [fetchPlan]);

  const setCantidad = (codigo, valor) => {
    const num = Math.max(0, parseInt(valor) || 0);
    setAreas(prev => prev.map(a => a.CodigoArea === codigo ? { ...a, Cantidad: num } : a));
    setGuardado(false);
  };

  const copiarAyer = async () => {
    const ayer = new Date(fecha);
    ayer.setDate(ayer.getDate() - 1);
    const fechaAyer = ayer.toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
    try {
      const res = await fetch(`${API}?fecha=${fechaAyer}`, { headers: authHeader() });
      const data = await res.json();
      if (!Array.isArray(data)) return;
      setAreas(prev => prev.map(a => {
        const ayer = data.find(d => d.CodigoArea === a.CodigoArea);
        return ayer ? { ...a, Cantidad: ayer.Cantidad } : a;
      }));
      setGuardado(false);
    } catch { /* sin conexión */ }
  };

  const guardar = async () => {
    setGuardando(true);
    try {
      const items = areas
        .filter(a => !AREAS_LIBRES.includes(a.CodigoArea))
        .map(a => ({ CodigoArea: a.CodigoArea, Cantidad: a.Cantidad }));
      const res = await fetch(API, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ fecha, items }),
      });
      if (res.ok) { setGuardado(true); fetchPlan(); }
      else { const e = await res.json(); alert("Error: " + e.error); }
    } finally { setGuardando(false); }
  };

  const generaPago       = a => a.FormaPago !== "No Genera Paga";
  const areasConPago     = areas.filter(generaPago);
  const areasRegulares   = areasConPago.filter(a => !AREAS_LIBRES.includes(a.CodigoArea));
  const totalPlanificado = areasRegulares.reduce((s, a) => s + a.Cantidad, 0);
  const totalOcupado     = areas.reduce((s, a) => s + (a.ocupacion ?? 0), 0);
  const areasActivas     = areasRegulares.filter(a => a.Cantidad > 0).length;

  const q = busqueda.trim().toLowerCase();
  const areasFiltradas = areas.filter(a =>
    !q || a.CodigoArea.toLowerCase().includes(q) || a.Nombre.toLowerCase().includes(q)
  );

  return (
    <div>
      {/* Barra superior */}
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 font-medium">Fecha:</label>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>

        <button onClick={copiarAyer}
          className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition">
          Copiar de ayer
        </button>

        <input type="text" placeholder="Buscar área (código o nombre)..."
          value={busqueda} onChange={e => setBusqueda(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-400" />

        <div className="ml-auto flex items-center gap-3">
          <button onClick={() => setModalAsistencia(true)}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 transition font-medium">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 012-2h2a2 2 0 012 2v6m-9 0h14a2 2 0 002-2V7.414a1 1 0 00-.293-.707l-3.414-3.414A1 1 0 0015.586 3H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Asistencia diaria
          </button>
          <button onClick={() => setModalResumen(true)}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition font-medium">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Resumen del día
          </button>
          {guardado && (
            <span className="text-green-600 text-sm font-medium flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              Guardado
            </span>
          )}
          <button onClick={guardar} disabled={guardando}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-1.5 rounded-lg text-sm transition disabled:opacity-60 flex items-center gap-2">
            {guardando && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            Guardar planificación
          </button>
        </div>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
          <p className="text-xs text-blue-500 font-medium uppercase tracking-wide">Áreas programadas</p>
          <p className="text-2xl font-bold text-blue-700 mt-0.5">{areasActivas} <span className="text-sm font-normal text-blue-400">de {areasConPago.length}</span></p>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <p className="text-xs text-green-500 font-medium uppercase tracking-wide">Cupos planificados</p>
          <p className="text-2xl font-bold text-green-700 mt-0.5">{totalPlanificado}</p>
        </div>
        {fecha === hoy && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
            <p className="text-xs text-orange-500 font-medium uppercase tracking-wide">Actualmente ocupados</p>
            <p className="text-2xl font-bold text-orange-700 mt-0.5">{totalOcupado} <span className="text-sm font-normal text-orange-400">de {totalPlanificado}</span></p>
          </div>
        )}
      </div>

      {/* Tabla */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-blue-800 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                <th className="px-5 py-3 text-left">Área</th>
                <th className="px-5 py-3 text-left">Nombre</th>
                <th className="px-5 py-3 text-left">Forma de Pago</th>
                <th className="px-5 py-3 text-center w-32">Cupos</th>
                {fecha === hoy && <th className="px-5 py-3 text-center w-32">Ocupación</th>}
                <th className="px-5 py-3 text-center w-28">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {areasFiltradas.length === 0 && (
                <tr><td colSpan={fecha === hoy ? 6 : 5} className="px-5 py-10 text-center text-gray-400">Sin áreas que coincidan</td></tr>
              )}
              {areasFiltradas.map(a => {
                const libre   = AREAS_LIBRES.includes(a.CodigoArea);
                const llena   = !libre && a.Cantidad > 0 && a.ocupacion >= a.Cantidad;
                const bloq    = !libre && a.Cantidad === 0;
                return (
                  <tr key={a.CodigoArea} className={`transition ${libre ? "bg-purple-50" : bloq ? "bg-gray-50 opacity-60" : "hover:bg-gray-50"}`}>
                    <td className="px-5 py-2.5 font-mono font-bold text-gray-700">{a.CodigoArea}</td>
                    <td className="px-5 py-2.5 font-medium text-gray-900">
                      {a.Nombre}
                      {libre && <span className="ml-2 text-xs font-semibold text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded-full">Libre</span>}
                    </td>
                    <td className="px-5 py-2.5 text-gray-500 text-xs">{a.FormaPago ?? "—"}</td>
                    <td className="px-5 py-2.5 text-center">
                      {libre ? (
                        <span className="text-xs text-purple-500 font-medium">Sin límite</span>
                      ) : (
                        <input
                          type="number" min="0" max="999"
                          value={a.Cantidad}
                          onChange={e => setCantidad(a.CodigoArea, e.target.value)}
                          className="w-20 border border-gray-300 rounded-lg px-2 py-1 text-sm text-center font-semibold focus:outline-none focus:ring-2 focus:ring-blue-400"
                        />
                      )}
                    </td>
                    {fecha === hoy && (
                      <td className="px-5 py-2.5 text-center">
                        {libre ? (
                          <span className="text-sm font-semibold text-purple-600">{a.ocupacion}</span>
                        ) : bloq ? (
                          <span className="text-gray-400 text-xs">—</span>
                        ) : (
                          <span className={`text-sm font-semibold ${llena ? "text-red-600" : "text-green-600"}`}>
                            {a.ocupacion}/{a.Cantidad}
                          </span>
                        )}
                      </td>
                    )}
                    <td className="px-5 py-2.5 text-center">
                      {libre ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">Sin restricción</span>
                      ) : bloq ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-200 text-gray-500">No programada</span>
                      ) : llena ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">Llena</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                          {a.disponible} disponible{a.disponible !== 1 ? "s" : ""}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal asistencia diaria */}
      {modalAsistencia && (
        <AsistenciaDiariaModal
          areas={areas}
          fecha={fecha}
          onClose={() => setModalAsistencia(false)}
        />
      )}

      {/* Modal resumen del día */}
      {modalResumen && (
        <ResumenModal
          areas={areas}
          fecha={fecha}
          totalPlanificado={totalPlanificado}
          totalOcupado={totalOcupado}
          onClose={() => setModalResumen(false)}
        />
      )}
    </div>
  );
}

function ResumenModal({ areas, fecha, totalPlanificado, totalOcupado, onClose }) {
  const [vistaArea, setVistaArea]         = useState(null); // área seleccionada para ver empleados
  const [transferencias, setTransferencias] = useState([]);
  const [cargandoEmp, setCargandoEmp]     = useState(false);

  // Cargar transferencias del día al abrir el modal
  useEffect(() => {
    setCargandoEmp(true);
    fetch(`/api/transferencias?fecha=${fecha}`, { headers: authHeader() })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setTransferencias(data); })
      .catch(() => {})
      .finally(() => setCargandoEmp(false));
  }, [fecha]);

  // Empleados activos (sin hora de salida) agrupados por área
  const empPorArea = {};
  transferencias.forEach(t => {
    if (!t.HoraSalida) {
      if (!empPorArea[t.CodigoArea]) empPorArea[t.CodigoArea] = [];
      empPorArea[t.CodigoArea].push(t);
    }
  });

  const areasLibresModal = areas.filter(a => AREAS_LIBRES.includes(a.CodigoArea));
  const programadas      = areas.filter(a => !AREAS_LIBRES.includes(a.CodigoArea) && a.Cantidad > 0);
  const conPersonas      = programadas.filter(a => a.ocupacion > 0);
  const sinPersonas      = programadas.filter(a => a.ocupacion === 0);

  // Solo para el reporte impreso: áreas libres con gente (las de 0 escaneados se omiten del PDF)
  const areasLibresImpresion = areasLibresModal.filter(a => a.ocupacion > 0);
  const cobertura = totalPlanificado > 0 ? (totalOcupado / totalPlanificado * 100) : 0;
  const fechaLargaImpresion = new Date(`${fecha}T00:00:00`).toLocaleDateString("es-GT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const impresoEn = new Date().toLocaleString("sv-SE", { timeZone: "America/Guatemala", hour12: false }).slice(0, 16);

  // ── Vista detalle de un área ──────────────────────────────────────
  if (vistaArea) {
    const empleados = empPorArea[vistaArea.CodigoArea] || [];
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 flex flex-col max-h-[85vh]">
          <div className="px-5 py-4 border-b flex items-center gap-3 bg-white rounded-t-2xl">
            <button onClick={() => setVistaArea(null)}
              className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Volver
            </button>
            <div className="flex-1">
              <p className="font-bold text-gray-800 leading-none">
                <span className="font-mono text-blue-700 mr-1">{vistaArea.CodigoArea}</span>
                {vistaArea.Nombre}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{empleados.length} de {vistaArea.Cantidad} personas</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
          </div>
          <div className="overflow-y-auto flex-1 divide-y divide-gray-100">
            {empleados.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-10">Sin empleados activos en esta área</p>
            ) : empleados.map((emp, i) => (
              <div key={emp.id ?? i} className="flex items-center gap-3 px-5 py-3">
                <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
                  {emp.Codigo}
                </span>
                <span className="text-sm font-medium text-gray-800">{emp.NombreCompleto}</span>
                <span className="ml-auto text-xs text-gray-400">{emp.HoraEntrada}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Vista principal (screenshot) ──────────────────────────────────
  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl mx-4 flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between bg-white rounded-t-2xl shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-800">Resumen del día</h2>
            <p className="text-xs text-gray-400">{fecha}</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => window.print()}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" />
              </svg>
              Imprimir
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
          </div>
        </div>

        {/* Total grande */}
        <div className="px-6 pt-5 pb-4 flex items-end gap-4 border-b border-gray-100 shrink-0">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">Total registrados</p>
            <p className="text-5xl font-black text-gray-900 leading-none">{totalOcupado}</p>
            <p className="text-sm text-gray-400 mt-1">de <span className="font-semibold text-gray-600">{totalPlanificado}</span> planificadas</p>
          </div>
          <div className="flex-1" />
          <div className="text-right">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">Áreas activas</p>
            <p className="text-3xl font-black text-blue-700">{conPersonas.length}</p>
            <p className="text-sm text-gray-400 mt-1">de {programadas.length} programadas</p>
          </div>
        </div>

        {/* Área libre — tabla fija arriba, fuera del scroll */}
        {areasLibresModal.length > 0 && (
          <div className="border-b border-gray-100 bg-purple-50/50 shrink-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-purple-400 uppercase text-[11px] tracking-wider">
                  <th className="px-6 pt-3 pb-1.5 text-left font-semibold">Área libre (sin restricción)</th>
                  <th className="px-3 pt-3 pb-1.5 text-center font-semibold w-32">Planificado</th>
                  <th className="px-3 pt-3 pb-1.5 text-center font-semibold w-32">Escaneado</th>
                  <th className="px-6 pt-3 pb-1.5 text-right font-semibold w-32"></th>
                </tr>
              </thead>
              <tbody>
                {areasLibresModal.map(a => (
                  <tr key={a.CodigoArea} onClick={() => setVistaArea(a)}
                    className="hover:bg-purple-100/60 transition cursor-pointer">
                    <td className="px-6 py-2 font-medium text-gray-800">
                      <span className="font-mono font-bold text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded mr-2">
                        {a.CodigoArea}
                      </span>
                      {a.Nombre}
                    </td>
                    <td className="px-3 py-2 text-center text-purple-500 font-medium text-xs">Sin límite</td>
                    <td className="px-3 py-2 text-center font-bold text-purple-700">{a.ocupacion}</td>
                    <td className="px-6 py-2 text-right">
                      <span className="text-xs text-purple-600 font-medium hover:underline">Ver empleados →</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Tabla de áreas — con scroll */}
        <div className="overflow-y-auto flex-1">
          {cargandoEmp && (
            <div className="flex justify-center py-4">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-100 z-10">
              <tr className="text-gray-600 uppercase text-xs tracking-wider">
                <th className="px-6 py-3 text-left">Área</th>
                <th className="px-3 py-3 text-center w-32">Planificado</th>
                <th className="px-3 py-3 text-center w-32">Escaneado</th>
                <th className="px-6 py-3 text-right w-32"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {conPersonas.length > 0 && (
                <>
                  <tr>
                    <td colSpan={4} className="px-6 py-1.5 bg-gray-50 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      Con personal
                    </td>
                  </tr>
                  {conPersonas.map(a => {
                    const llena = a.ocupacion >= a.Cantidad;
                    return (
                      <tr key={a.CodigoArea} onClick={() => setVistaArea(a)}
                        className="hover:bg-gray-50 transition cursor-pointer">
                        <td className="px-6 py-2.5 font-medium text-gray-800">
                          <span className="font-mono font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded mr-2">
                            {a.CodigoArea}
                          </span>
                          {a.Nombre}
                        </td>
                        <td className="px-3 py-2.5 text-center text-gray-700 font-medium">{a.Cantidad}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                            llena ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-700"
                          }`}>
                            {a.ocupacion}
                          </span>
                        </td>
                        <td className="px-6 py-2.5 text-right">
                          <span className="text-xs text-blue-600 font-medium hover:underline">Ver empleados →</span>
                        </td>
                      </tr>
                    );
                  })}
                </>
              )}

              {sinPersonas.length > 0 && (
                <>
                  <tr>
                    <td colSpan={4} className="px-6 py-1.5 bg-gray-50 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      Sin personal aún
                    </td>
                  </tr>
                  {sinPersonas.map(a => (
                    <tr key={a.CodigoArea} onClick={() => setVistaArea(a)}
                      className="hover:bg-gray-50 transition cursor-pointer">
                      <td className="px-6 py-2.5 font-medium text-gray-500">
                        <span className="font-mono font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded mr-2">
                          {a.CodigoArea}
                        </span>
                        {a.Nombre}
                      </td>
                      <td className="px-3 py-2.5 text-center text-gray-500">{a.Cantidad}</td>
                      <td className="px-3 py-2.5 text-center text-gray-400 font-medium">0</td>
                      <td className="px-6 py-2.5 text-right">
                        <span className="text-xs text-gray-400 font-medium hover:underline">Ver empleados →</span>
                      </td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>

        {/* Pie */}
        <div className="border-t border-gray-100 px-6 py-3 bg-gray-50 rounded-b-2xl flex items-center justify-between">
          <p className="text-xs text-gray-400">Toca un área para ver el listado de personas</p>
          {totalOcupado === totalPlanificado && totalPlanificado > 0
            ? <span className="text-xs font-bold text-green-600">✓ Cuadra exacto</span>
            : <span className={`text-xs font-bold ${totalOcupado > totalPlanificado ? "text-red-600" : "text-yellow-600"}`}>
                {totalOcupado > totalPlanificado ? "▲" : "▼"} {Math.abs(totalOcupado - totalPlanificado)} {totalOcupado > totalPlanificado ? "excedente" : "faltante"}
              </span>
          }
        </div>
      </div>
    </div>

    {/* Hoja imprimible — se monta en #print-root (fuera de #root) para que solo ella
        quede en el documento cuando #root se oculta al imprimir (ver index.css) */}
    {createPortal(
    <div className="hidden print:block font-sans text-slate-700">
      <div className="flex items-end justify-between border-b-[3px] border-slate-900 pb-2 mb-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-700">EsteroMar · Control de Personal</p>
          <h1 className="text-xl font-extrabold uppercase text-slate-900 tracking-tight">Resumen del día</h1>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold text-slate-900 capitalize">{fechaLargaImpresion}</p>
          <p className="text-[10px] text-gray-400 font-mono mt-0.5">impreso {impresoEn}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 border border-gray-200 rounded overflow-hidden mb-4">
        <div className="px-4 py-2 border-r border-gray-200 bg-slate-100">
          <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Total registrados</p>
          <p className="text-2xl font-extrabold text-blue-700 tabular-nums">
            {totalOcupado} <span className="text-xs font-semibold text-gray-400">de {totalPlanificado} planificadas</span>
          </p>
        </div>
        <div className="px-4 py-2 border-r border-gray-200">
          <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Áreas activas</p>
          <p className="text-2xl font-extrabold text-slate-900 tabular-nums">
            {conPersonas.length} <span className="text-xs font-semibold text-gray-400">de {programadas.length} programadas</span>
          </p>
        </div>
        <div className="px-4 py-2">
          <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Cobertura</p>
          <p className="text-2xl font-extrabold text-slate-900 tabular-nums">{cobertura.toFixed(1)}<span className="text-xs font-semibold text-gray-400">%</span></p>
        </div>
      </div>

      {areasLibresImpresion.length > 0 && (
        <>
          <span className="inline-block text-[10px] font-extrabold uppercase tracking-wider text-white bg-purple-700 px-2 py-1 mb-1">
            Área libre — sin restricción
          </span>
          <table className="w-full border-collapse text-[11px] mb-4">
            <thead>
              <tr>
                <th className="text-left text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-300 py-1 px-1.5">Área</th>
                <th className="text-center text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-300 py-1 px-1.5 w-28">Planificado</th>
                <th className="text-center text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-300 py-1 px-1.5 w-28">Escaneado</th>
              </tr>
            </thead>
            <tbody>
              {areasLibresImpresion.map(a => (
                <tr key={a.CodigoArea}>
                  <td className="py-1 px-1.5 border-b border-gray-100">
                    <span className="font-mono font-bold text-[10px] text-purple-700 bg-purple-50 rounded px-1.5 py-0.5 mr-1.5 inline-block min-w-[26px] text-center">{a.CodigoArea}</span>
                    <span className="font-semibold text-slate-900">{a.Nombre}</span>
                  </td>
                  <td className="text-center py-1 px-1.5 border-b border-gray-100 text-purple-600 font-medium text-xs">Sin límite</td>
                  <td className="text-center py-1 px-1.5 border-b border-gray-100">
                    <span className="font-mono font-bold text-[10px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 tabular-nums">{a.ocupacion}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <span className="inline-block text-[10px] font-extrabold uppercase tracking-wider text-white bg-slate-900 px-2 py-1 mb-1">
        Áreas con personal ({conPersonas.length})
      </span>
      <table className="w-full border-collapse text-[11px] mb-3">
        <thead>
          <tr>
            <th className="text-left text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-300 py-1 px-1.5">Área</th>
            <th className="text-center text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-300 py-1 px-1.5 w-28">Planificado</th>
            <th className="text-center text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-300 py-1 px-1.5 w-28">Escaneado</th>
          </tr>
        </thead>
        <tbody>
          {conPersonas.length === 0 && (
            <tr><td colSpan={3} className="py-4 text-center text-gray-400 text-xs">Ningún área tiene personal escaneado todavía</td></tr>
          )}
          {conPersonas.map((a, i) => {
            const llena = a.ocupacion >= a.Cantidad;
            return (
              <tr key={a.CodigoArea} className={i % 2 === 1 ? "bg-slate-50" : ""}>
                <td className="py-1 px-1.5 border-b border-gray-100">
                  <span className="font-mono font-bold text-[10px] text-blue-700 bg-blue-50 rounded px-1.5 py-0.5 mr-1.5 inline-block min-w-[26px] text-center">{a.CodigoArea}</span>
                  <span className="font-semibold text-slate-900">{a.Nombre}</span>
                </td>
                <td className="text-center py-1 px-1.5 border-b border-gray-100 tabular-nums">{a.Cantidad}</td>
                <td className="text-center py-1 px-1.5 border-b border-gray-100">
                  <span className={`font-mono font-bold text-[10px] px-2 py-0.5 rounded-full tabular-nums ${llena ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
                    {a.ocupacion}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="flex justify-between items-end border-t-2 border-slate-900 pt-2 mt-3">
        <div>
          {totalOcupado === totalPlanificado && totalPlanificado > 0
            ? <span className="text-xs font-extrabold text-green-700">✓ Cuadra exacto</span>
            : <span className={`text-xs font-extrabold ${totalOcupado > totalPlanificado ? "text-red-700" : "text-amber-700"}`}>
                {totalOcupado > totalPlanificado ? "▲" : "▼"} {Math.abs(totalOcupado - totalPlanificado)} {totalOcupado > totalPlanificado ? "excedente" : "faltante"}
              </span>
          }
        </div>
        <div className="text-center">
          <div className="w-40 border-t border-gray-700 mb-1" />
          <p className="text-[9px] uppercase tracking-wide text-gray-400">Supervisor de turno</p>
        </div>
      </div>
    </div>,
    document.getElementById("print-root")
    )}
    </>
  );
}
