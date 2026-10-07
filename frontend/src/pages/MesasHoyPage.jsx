import { useState, useEffect, useCallback, useMemo } from "react";
import { authHeader } from "../context/AuthContext.jsx";
import { fmtNum } from "../utils/numero.js";
import { calcularProduccionMesas, tipoMesa, horaDe, serieMesa } from "../utils/mesas.js";
import MesaDetalle from "../components/MesaDetalle.jsx";

// Pestaña "Por Mesa" de Destajo: producción de HOY por mesa de pelado, en vivo. Una tarjeta por mesa
// (peladoras, aprendizaje, Banda y Banda temporal) y, al tocarla, el mismo detalle que abre el QR de esa mesa.
// Para rangos de fechas está el Reporte de Producción; esto es solo el día actual.
const REFRESCO_MS = 2 * 60_000;

export function useMesasHoy() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch("/api/mesas/hoy", { headers: authHeader() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo cargar la producción por mesa");
      setDatos(data); setError("");
    } catch (e) {
      setError(e.message);
    } finally { setCargando(false); }
  }, []);

  useEffect(() => {
    cargar();
    const id = setInterval(cargar, REFRESCO_MS);
    return () => clearInterval(id);
  }, [cargar]);

  const mesas = useMemo(() => calcularProduccionMesas(datos), [datos]);
  return { datos, mesas, error, cargando, recargar: cargar };
}

// Días anteriores para la gráfica (GET /api/mesas/historial). Ya no cambian durante el día, así que
// basta pedirlos cada 10 min; el punto de HOY sale de useMesasHoy y se mueve cada 2 min.
const REFRESCO_HISTORIAL_MS = 10 * 60_000;
export function useHistorialMesas() {
  const [historial, setHistorial] = useState(null);
  useEffect(() => {
    const cargar = () => fetch("/api/mesas/historial", { headers: authHeader() })
      .then(r => (r.ok ? r.json() : null)).then(d => { if (d) setHistorial(d); }).catch(() => {});
    cargar();
    const id = setInterval(cargar, REFRESCO_HISTORIAL_MS);
    return () => clearInterval(id);
  }, []);
  return historial;
}

export default function MesasHoyPage() {
  const { datos, mesas, error, cargando, recargar } = useMesasHoy();
  const historial = useHistorialMesas();
  const [seleccion, setSeleccion] = useState(null);
  const mesa = mesas.find(m => m.Codigo === seleccion);
  const serie = useMemo(() => (mesa ? serieMesa(mesa.Codigo, mesas, historial, datos?.fecha) : []), [mesa, mesas, historial, datos]);

  if (cargando) return <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {mesa && (
          <button onClick={() => setSeleccion(null)} className="text-sm text-blue-600 hover:text-blue-800 font-medium">← Todas las mesas</button>
        )}
        <h3 className="text-lg font-bold text-gray-800">{mesa ? mesa.Nombre : "Producción de hoy por mesa"}</h3>
        <span className="text-sm text-gray-500 ml-auto">
          {datos ? `Actualizado ${horaDe(datos.generado)}` : ""}
        </span>
        <button onClick={recargar} className="border border-gray-300 text-gray-700 text-sm font-semibold px-3 py-1.5 rounded-lg hover:bg-gray-50 transition">⟳ Actualizar</button>
      </div>
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {mesa ? (
        <div className="max-w-xl"><MesaDetalle mesa={mesa} serie={serie} /></div>
      ) : (
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
          {mesas.map(m => {
            const tipo = tipoMesa(m.Tipo);
            return (
              <button key={m.Codigo} onClick={() => setSeleccion(m.Codigo)}
                className="text-left bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-400 hover:shadow transition">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="font-bold text-gray-900 truncate">{m.Nombre}</span>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold ${tipo.clase}`}>{tipo.label}</span>
                </div>
                <p className="text-2xl font-bold text-gray-900 tabular-nums">{fmtNum(m.LbTotal, 1)} <span className="text-sm font-medium text-gray-500">lb</span></p>
                <p className="text-sm text-blue-700 font-semibold tabular-nums">
                  {fmtNum(m.LbHoraPonderada, 1)} lb/hr
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {m.Asignados == null ? `${m.Pesando} pesando` : `${m.Pesando} de ${m.Asignados} pesando`}
                  {` · ${m.Tallas.length} talla${m.Tallas.length !== 1 ? "s" : ""}`}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
