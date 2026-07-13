import { useState, useEffect, useCallback, Fragment } from "react";
import { authHeader } from "../context/AuthContext.jsx";
import { exportarReporteGeneral, exportarReporteTermos, exportarEficiencias } from "../utils/exportExcel.js";

function hoy() { return new Date().toLocaleDateString("sv-SE"); }
function primerDiaMes() { return `${hoy().slice(0, 7)}-01`; }

const SUB_TABS = [
  { key: "general",     label: "Reporte General" },
  { key: "termos",      label: "Reporte Termos" },
  { key: "eficiencias", label: "Eficiencias" },
];

function FilaLote({ l, detalle, abierta, onToggle }) {
  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer hover:bg-gray-50 transition">
        <td className="px-3 py-2.5 text-gray-400">
          <span className={`inline-block transition-transform ${abierta ? "rotate-90" : ""}`}>▶</span>
        </td>
        <td className="px-3 py-2.5 font-mono font-bold text-gray-700 whitespace-nowrap">{l.Lote}</td>
        <td className="px-3 py-2.5 text-gray-700">{l.NombreFinca}</td>
        <td className="px-3 py-2.5 font-mono text-gray-600">{l.Clase} — {l.DescripcionClase}</td>
        <td className="px-3 py-2.5 text-center text-gray-600">{l.Fecha?.slice(0, 10)}</td>
        <td className="px-3 py-2.5 text-right font-semibold text-gray-800">{l.PesoIngreso.toFixed(2)} {l.UM}</td>
        <td className="px-3 py-2.5 text-right font-semibold text-blue-700">{l.Procesado.toFixed(2)}</td>
        <td className="px-3 py-2.5 text-right font-semibold text-amber-600">{l.Pendiente.toFixed(2)}</td>
        <td className="px-3 py-2.5 text-right">
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${l.Rendimiento >= 50 ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
            {l.Rendimiento.toFixed(1)}%
          </span>
        </td>
        <td className="px-3 py-2.5 text-center text-gray-500">{l.NumTransacciones}</td>
      </tr>
      {abierta && (
        <tr>
          <td colSpan={10} className="bg-gray-50 px-6 py-3">
            {detalle.length === 0 ? (
              <p className="text-sm text-gray-400">Sin transacciones para este lote</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 uppercase tracking-wider">
                    <th className="px-2 py-1 text-left">Talla</th>
                    <th className="px-2 py-1 text-left">Producto Terminado</th>
                    <th className="px-2 py-1 text-center">Estado</th>
                    <th className="px-2 py-1 text-right">Procesado</th>
                    <th className="px-2 py-1 text-right">Pesajes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {detalle.map((d, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1.5 font-mono">{d.Talla} — {d.DescripcionTalla}</td>
                      <td className="px-2 py-1.5">{d.ClasePT} — {d.DescripcionClasePT}</td>
                      <td className="px-2 py-1.5 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${d.Estado === "Abierta" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                          {d.Estado}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right font-semibold">{d.Procesado.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right">{d.NumPesajes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

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
  const [subTab, setSubTab] = useState("general");
  const [loteAbierto, setLoteAbierto] = useState(null);
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

  // Lote (texto) puede repetirse entre Clases del mismo Piscina+Ciclo+Fecha (ver
  // project_destajo_lote_clase_en_codigo) — hace falta también la Clase para no mezclar el detalle de
  // dos filas de Materia Prima distintas.
  const detalleDeLote = (lote, clase) => (reporte?.porLoteTalla ?? []).filter(d => d.Lote === lote && d.ClaseOrigen === clase);

  // Si hay un lote abierto (tocado en la tabla de la izquierda), la tabla de Talla se
  // filtra a solo lo procesado de ese lote; si no, muestra el total del rango de fechas.
  const tallasMostradas = (() => {
    if (!loteAbierto) return reporte?.porTalla ?? [];
    const mapa = new Map();
    for (const d of detalleDeLote(loteAbierto.Lote, loteAbierto.Clase)) {
      if (!mapa.has(d.Talla)) mapa.set(d.Talla, { Talla: d.Talla, DescripcionTalla: d.DescripcionTalla, Procesado: 0, NumPesajes: 0 });
      const acc = mapa.get(d.Talla);
      acc.Procesado += d.Procesado;
      acc.NumPesajes += d.NumPesajes;
    }
    return [...mapa.values()].sort((a, b) => b.Procesado - a.Procesado);
  })();
  const totalProcesadoTalla = tallasMostradas.reduce((s, t) => s + t.Procesado, 0);
  const totalProcesadoTermo = (reporte?.porTermo ?? []).reduce((s, t) => s + t.Procesado, 0);

  const gruposPorFinca = () => {
    const mapa = new Map();
    for (const l of reporte?.porLote ?? []) {
      if (!mapa.has(l.NombreFinca)) mapa.set(l.NombreFinca, []);
      mapa.get(l.NombreFinca).push(l);
    }
    return [...mapa.entries()];
  };

  const sumar = (lotes) => lotes.reduce((acc, l) => ({
    PesoIngreso: acc.PesoIngreso + l.PesoIngreso,
    Procesado: acc.Procesado + l.Procesado,
    Pendiente: acc.Pendiente + l.Pendiente,
  }), { PesoIngreso: 0, Procesado: 0, Pendiente: 0 });

  const gruposPorTermo = () => {
    const mapa = new Map();
    for (const t of reporte?.porTermo ?? []) {
      if (!mapa.has(t.NumeroTermo)) mapa.set(t.NumeroTermo, []);
      mapa.get(t.NumeroTermo).push(t);
    }
    return [...mapa.entries()];
  };

  const exportar = () => {
    if (!reporte) return;
    if (subTab === "general") exportarReporteGeneral(reporte.porLote, reporte.porTalla, desde, hasta);
    else if (subTab === "termos") exportarReporteTermos(reporte.porTermo, desde, hasta);
    else exportarEficiencias(reporte.porPersona, desde, hasta);
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

        <div className="flex gap-1 bg-gray-200 rounded-lg p-1 ml-4">
          {SUB_TABS.map(t => (
            <button key={t.key} onClick={() => setSubTab(t.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition ${
                subTab === t.key ? "bg-white shadow text-blue-700" : "text-gray-600 hover:text-gray-800"
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {reporte && (
          <button onClick={exportar}
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

          {/* ── Reporte General ── */}
          {subTab === "general" && (
            <div className="grid grid-cols-3 gap-5">
              {/* Por Lote */}
              <div className="col-span-2 min-w-0">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Materia Prima y Procesado por Lote</h3>
                <div className="bg-white rounded-xl shadow overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                        <th className="px-3 py-3"></th>
                        <th className="px-3 py-3 text-left">Lote</th>
                        <th className="px-3 py-3 text-left">Finca</th>
                        <th className="px-3 py-3 text-left">Clase MP</th>
                        <th className="px-3 py-3 text-center">Fecha</th>
                        <th className="px-3 py-3 text-right">Ingreso</th>
                        <th className="px-3 py-3 text-right">Procesado</th>
                        <th className="px-3 py-3 text-right">Pendiente</th>
                        <th className="px-3 py-3 text-right">Rend.</th>
                        <th className="px-3 py-3 text-center">Transac.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {gruposPorFinca().map(([nombreFinca, lotes]) => {
                        const sub = sumar(lotes);
                        const rendSub = sub.PesoIngreso > 0 ? (sub.Procesado / sub.PesoIngreso * 100) : 0;
                        return (
                          <Fragment key={nombreFinca}>
                            {lotes.map(l => (
                              <FilaLote key={`${l.Lote}-${l.Clase}`} l={l} detalle={detalleDeLote(l.Lote, l.Clase)}
                                abierta={loteAbierto?.Lote === l.Lote && loteAbierto?.Clase === l.Clase}
                                onToggle={() => setLoteAbierto(loteAbierto?.Lote === l.Lote && loteAbierto?.Clase === l.Clase ? null : { Lote: l.Lote, Clase: l.Clase })} />
                            ))}
                            <tr className="bg-gray-50 font-semibold">
                              <td className="px-3 py-2" colSpan={5}>Subtotal — {nombreFinca}</td>
                              <td className="px-3 py-2 text-right text-gray-800">{sub.PesoIngreso.toFixed(2)}</td>
                              <td className="px-3 py-2 text-right text-blue-700">{sub.Procesado.toFixed(2)}</td>
                              <td className="px-3 py-2 text-right text-amber-600">{sub.Pendiente.toFixed(2)}</td>
                              <td className="px-3 py-2 text-right text-gray-600">{rendSub.toFixed(1)}%</td>
                              <td className="px-3 py-2"></td>
                            </tr>
                          </Fragment>
                        );
                      })}
                      {reporte.porLote.length === 0 && (
                        <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">Sin lotes en este rango de fechas</td></tr>
                      )}
                    </tbody>
                    {reporte.porLote.length > 0 && (
                      <tfoot>
                        <tr className="bg-gray-200 font-bold border-t-2 border-gray-300">
                          <td className="px-3 py-2.5" colSpan={5}>Total General</td>
                          <td className="px-3 py-2.5 text-right text-gray-900">{reporte.totales.PesoIngreso.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right text-blue-800">{reporte.totales.Procesado.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right text-amber-700">{reporte.totales.Pendiente.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right text-gray-800">{reporte.totales.Rendimiento.toFixed(1)}%</td>
                          <td className="px-3 py-2.5"></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>

              {/* Por Talla */}
              <div className="min-w-0">
                <div className="flex items-center justify-between mb-2 gap-2">
                  <h3 className="text-sm font-semibold text-gray-700">Procesado por Talla</h3>
                  {loteAbierto && (
                    <button onClick={() => setLoteAbierto(null)}
                      className="flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-full transition">
                      <span className="font-mono">{loteAbierto}</span>
                      <span className="text-blue-400">&times;</span>
                    </button>
                  )}
                </div>
                <div className="bg-white rounded-xl shadow overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                        <th className="px-3 py-3 text-left">Talla</th>
                        <th className="px-3 py-3 text-right">Kg</th>
                        <th className="px-3 py-3 text-right">%</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {tallasMostradas.map(t => (
                        <tr key={t.Talla} className="hover:bg-gray-50 transition">
                          <td className="px-3 py-2.5 text-gray-700">
                            <span className="font-mono">{t.Talla}</span> — {t.DescripcionTalla}
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold text-blue-700">{t.Procesado.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right text-gray-500">
                            {totalProcesadoTalla > 0 ? (t.Procesado / totalProcesadoTalla * 100).toFixed(1) : "0.0"}%
                          </td>
                        </tr>
                      ))}
                      {tallasMostradas.length === 0 && (
                        <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400">Sin datos</td></tr>
                      )}
                    </tbody>
                    {tallasMostradas.length > 0 && (
                      <tfoot>
                        <tr className="bg-gray-200 font-bold border-t-2 border-gray-300">
                          <td className="px-3 py-2.5">Total General</td>
                          <td className="px-3 py-2.5 text-right text-blue-800">{totalProcesadoTalla.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right text-gray-800">100.0%</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── Reporte Termos ── */}
          {subTab === "termos" && (
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
          )}

          {/* ── Eficiencias ── */}
          {subTab === "eficiencias" && (
            <div>
              <h3 className="text-xs font-semibold text-gray-700 mb-1.5">Pesajes por Persona</h3>
              <div className="bg-white rounded-lg shadow overflow-hidden overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-100 text-gray-600 uppercase text-[10px] tracking-wider">
                      <th className="px-2 py-1.5 text-left whitespace-nowrap">Id Empleado</th>
                      <th className="px-2 py-1.5 text-left whitespace-nowrap">Nombre</th>
                      <th className="px-2 py-1.5 text-left whitespace-nowrap">Área</th>
                      <th className="px-2 py-1.5 text-center whitespace-nowrap">Fecha</th>
                      <th className="px-2 py-1.5 text-center whitespace-nowrap">Hora</th>
                      <th className="px-2 py-1.5 text-left whitespace-nowrap">Lote</th>
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
                        <td className="px-2 py-1.5 font-mono text-gray-700 whitespace-nowrap">{p.Lote}</td>
                        <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">{p.Producto}</td>
                        <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">{p.Talla} — {p.DescripcionTalla}</td>
                        <td className="px-2 py-1.5 text-right font-semibold text-blue-700 whitespace-nowrap">{p.Kilos.toFixed(2)}</td>
                      </tr>
                    ))}
                    {(reporte.porPersona ?? []).length === 0 && (
                      <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">Sin datos en este rango de fechas</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
