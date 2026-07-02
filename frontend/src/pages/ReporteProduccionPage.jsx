import { useState, useEffect, useCallback } from "react";
import { authHeader } from "../context/AuthContext.jsx";
import { exportarReporteProduccion, exportarPesajesPorPersona } from "../utils/exportExcel.js";

function hoy() { return new Date().toLocaleDateString("sv-SE"); }
function primerDiaMes() { return `${hoy().slice(0, 7)}-01`; }

function FilaTermo({ numeroTermo, cargas, abierta, onToggle }) {
  const subtotal = cargas.reduce((s, c) => s + c.Procesado, 0);
  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer hover:bg-blue-50 transition bg-gray-50 font-semibold">
        <td className="px-2 py-1.5 text-gray-400 w-6">
          <span className={`inline-block transition-transform ${abierta ? "rotate-90" : ""}`}>▶</span>
        </td>
        <td className="px-2 py-1.5 font-mono font-bold text-gray-800 whitespace-nowrap w-28">Termo {numeroTermo}</td>
        <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">
          {cargas.length} carga{cargas.length !== 1 ? "s" : ""}
        </td>
        <td className="px-2 py-1.5 text-right font-bold text-blue-700 whitespace-nowrap w-28">{subtotal.toFixed(2)}</td>
      </tr>
      {abierta && (
        <tr>
          <td colSpan={4} className="bg-gray-50 px-3 py-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 uppercase tracking-wider">
                  <th className="px-2 py-1 text-left">Lote</th>
                  <th className="px-2 py-1 text-left">Talla</th>
                  <th className="px-2 py-1 text-left">Proceso</th>
                  <th className="px-2 py-1 text-center">Fecha Proceso</th>
                  <th className="px-2 py-1 text-right">Kg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {cargas.map(c => (
                  <tr key={c.TermoId}>
                    <td className="px-2 py-1 font-mono">{c.Lote}</td>
                    <td className="px-2 py-1">{c.Talla} — {c.DescripcionTalla}</td>
                    <td className="px-2 py-1">{c.DescripcionProceso}</td>
                    <td className="px-2 py-1 text-center">{c.FechaProduccion?.slice(0, 10)}</td>
                    <td className="px-2 py-1 text-right font-semibold">{c.Procesado.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

export default function ReporteProduccionPage() {
  const [desde, setDesde] = useState(primerDiaMes());
  const [hasta, setHasta] = useState(hoy());
  const [fincas, setFincas] = useState([]);
  const [finca, setFinca] = useState("");
  const [reporte, setReporte] = useState(null);
  const [loading, setLoading] = useState(false);
  const [termoAbierto, setTermoAbierto] = useState(null);

  useEffect(() => {
    fetch("/api/finca", { headers: authHeader() }).then(r => r.json())
      .then(d => { if (Array.isArray(d)) setFincas(d.filter(f => f.Activo)); });
  }, []);

  const buscar = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ desde, hasta, ...(finca ? { finca } : {}) });
      const res = await fetch(`/api/reportes/produccion?${params}`, { headers: authHeader() });
      const data = await res.json();
      if (res.ok) setReporte(data);
      else alert("Error: " + data.error);
    } catch (err) {
      console.error("Error al cargar el reporte:", err);
      alert("No se pudo conectar con el servidor.");
    } finally {
      setLoading(false);
    }
  }, [desde, hasta, finca]);

  useEffect(() => { buscar(); }, [buscar]);

  const totalProcesadoTermo = (reporte?.porTermo ?? []).reduce((s, t) => s + t.Procesado, 0);

  const gruposPorTermo = () => {
    const mapa = new Map();
    for (const t of reporte?.porTermo ?? []) {
      if (!mapa.has(t.NumeroTermo)) mapa.set(t.NumeroTermo, []);
      mapa.get(t.NumeroTermo).push(t);
    }
    return [...mapa.entries()];
  };

  return (
    <div>
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-2 mb-3 bg-white border border-gray-200 rounded-lg p-2.5 shadow-sm">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-0.5">Desde</label>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-0.5">Hasta</label>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-0.5">Finca</label>
          <select value={finca} onChange={e => setFinca(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
            <option value="">Todas</option>
            {fincas.map(f => <option key={f.Codigo} value={f.Codigo}>{f.Codigo} — {f.Descripcion}</option>)}
          </select>
        </div>
        <button onClick={buscar}
          className="bg-blue-600 text-white text-sm font-semibold px-3 py-1.5 rounded-lg hover:bg-blue-700 transition">
          Buscar
        </button>
        {reporte && (
          <button onClick={() => exportarReporteProduccion(reporte.porTermo, desde, hasta)}
            className="ml-auto bg-green-600 text-white text-sm font-semibold px-3 py-1.5 rounded-lg hover:bg-green-700 transition">
            Exportar Excel
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-7 h-7 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : !reporte ? null : (
        <>
          {/* Totales */}
          <div className="grid grid-cols-4 gap-2 mb-3">
            <div className="bg-white rounded-lg shadow px-3 py-2 text-center">
              <p className="text-xs text-gray-400">Materia Prima Recibida</p>
              <p className="text-base font-bold text-gray-800">{reporte.totales.PesoIngreso.toFixed(2)} kg</p>
            </div>
            <div className="bg-white rounded-lg shadow px-3 py-2 text-center">
              <p className="text-xs text-gray-400">Procesado</p>
              <p className="text-base font-bold text-blue-700">{reporte.totales.Procesado.toFixed(2)} kg</p>
            </div>
            <div className="bg-white rounded-lg shadow px-3 py-2 text-center">
              <p className="text-xs text-gray-400">Pendiente</p>
              <p className="text-base font-bold text-amber-600">{reporte.totales.Pendiente.toFixed(2)} kg</p>
            </div>
            <div className="bg-white rounded-lg shadow px-3 py-2 text-center">
              <p className="text-xs text-gray-400">Rendimiento</p>
              <p className="text-base font-bold text-gray-700">{reporte.totales.Rendimiento.toFixed(1)}%</p>
            </div>
          </div>

          {/* Por Termo */}
          <div>
            <h3 className="text-xs font-semibold text-gray-700 mb-1.5">Procesado por Termo</h3>
            <div className="bg-white rounded-lg shadow overflow-hidden overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-100 text-gray-600 uppercase text-[10px] tracking-wider">
                    <th className="px-2 py-1.5 w-6"></th>
                    <th className="px-2 py-1.5 text-left whitespace-nowrap w-28">Termo</th>
                    <th className="px-2 py-1.5 text-left whitespace-nowrap">Detalle</th>
                    <th className="px-2 py-1.5 text-right whitespace-nowrap w-28">Kg Procesados</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {gruposPorTermo().map(([numeroTermo, cargas]) => (
                    <FilaTermo key={numeroTermo} numeroTermo={numeroTermo} cargas={cargas}
                      abierta={termoAbierto === numeroTermo}
                      onToggle={() => setTermoAbierto(termoAbierto === numeroTermo ? null : numeroTermo)} />
                  ))}
                  {(reporte.porTermo ?? []).length === 0 && (
                    <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-400">Sin datos en este rango de fechas</td></tr>
                  )}
                </tbody>
                {(reporte.porTermo ?? []).length > 0 && (
                  <tfoot>
                    <tr className="bg-gray-200 font-bold border-t-2 border-gray-300">
                      <td className="px-2 py-1.5" colSpan={3}>Total General</td>
                      <td className="px-2 py-1.5 text-right text-blue-800">{totalProcesadoTermo.toFixed(2)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Pesajes por Persona */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-xs font-semibold text-gray-700">Pesajes por Persona</h3>
              <button onClick={() => exportarPesajesPorPersona(reporte.porPersona, desde, hasta)}
                className="bg-green-600 text-white text-xs font-semibold px-2.5 py-1 rounded-lg hover:bg-green-700 transition">
                Exportar Excel
              </button>
            </div>
            <div className="bg-white rounded-lg shadow overflow-hidden overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-100 text-gray-600 uppercase text-[10px] tracking-wider">
                    <th className="px-2 py-1.5 text-left whitespace-nowrap">Id Empleado</th>
                    <th className="px-2 py-1.5 text-left whitespace-nowrap">Nombre</th>
                    <th className="px-2 py-1.5 text-left whitespace-nowrap">Área</th>
                    <th className="px-2 py-1.5 text-center whitespace-nowrap">Fecha</th>
                    <th className="px-2 py-1.5 text-center whitespace-nowrap">Hora</th>
                    <th className="px-2 py-1.5 text-left whitespace-nowrap">Producto</th>
                    <th className="px-2 py-1.5 text-left whitespace-nowrap">Talla</th>
                    <th className="px-2 py-1.5 text-right whitespace-nowrap">Kilos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(reporte.porPersona ?? []).map((p, i) => (
                    <tr key={i} className="hover:bg-gray-50 transition">
                      <td className="px-2 py-1.5 font-mono text-gray-700 whitespace-nowrap">{p.IdEmpleado}</td>
                      <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">{p.Nombre}</td>
                      <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">{p.Area || <span className="text-gray-300">—</span>}</td>
                      <td className="px-2 py-1.5 text-center text-gray-600 whitespace-nowrap">{p.FechaHora?.slice(0, 10)}</td>
                      <td className="px-2 py-1.5 text-center text-gray-600 whitespace-nowrap">{p.FechaHora?.slice(11, 16)}</td>
                      <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">{p.Producto}</td>
                      <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">{p.Talla} — {p.DescripcionTalla}</td>
                      <td className="px-2 py-1.5 text-right font-semibold text-blue-700 whitespace-nowrap">{p.Kilos.toFixed(2)}</td>
                    </tr>
                  ))}
                  {(reporte.porPersona ?? []).length === 0 && (
                    <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400">Sin datos en este rango de fechas</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
