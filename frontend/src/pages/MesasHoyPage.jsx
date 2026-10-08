import { useState, useEffect, useCallback, useMemo } from "react";
import { authHeader } from "../context/AuthContext.jsx";
import { fmtNum } from "../utils/numero.js";
import { calcularProduccionMesas, tipoMesa, horaDe, serieHorasMesa } from "../utils/mesas.js";
import MesaDetalle from "../components/MesaDetalle.jsx";
import ResumenMesasDia from "../components/ResumenMesasDia.jsx";

// Pestaña "Por Mesa" de Destajo: producción de HOY por mesa de pelado, en vivo. Una tarjeta por mesa
// (peladoras, aprendizaje, Banda y Banda temporal) y, al tocarla, el mismo detalle que abre el QR de esa mesa.
// Para rangos de fechas está el Reporte de Producción; esto es solo el día actual.
const REFRESCO_MS = 2 * 60_000;

export function useMesasHoy() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  // true mientras corre una recarga (botón ⟳ o refresco automático): el ícono gira para que se note
  // que se pidió. Ojo: el servidor guarda el cálculo 1 min, así que la hora "Actualizado" puede no
  // cambiar si se toca antes de ese minuto.
  const [actualizando, setActualizando] = useState(false);

  const cargar = useCallback(async () => {
    setActualizando(true);
    try {
      const res = await fetch("/api/mesas/hoy", { headers: authHeader() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo cargar la producción por mesa");
      setDatos(data); setError("");
    } catch (e) {
      setError(e.message);
    } finally { setCargando(false); setActualizando(false); }
  }, []);

  useEffect(() => {
    cargar();
    const id = setInterval(cargar, REFRESCO_MS);
    return () => clearInterval(id);
  }, [cargar]);

  const mesas = useMemo(() => calcularProduccionMesas(datos), [datos]);
  return { datos, mesas, error, cargando, actualizando, recargar: cargar };
}

export default function MesasHoyPage() {
  const { datos, mesas, error, cargando, actualizando, recargar } = useMesasHoy();
  const [seleccion, setSeleccion] = useState(null);
  const mesa = mesas.find(m => m.Codigo === seleccion);
  const serie = useMemo(() => serieHorasMesa(mesa, datos), [mesa, datos]);

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
        <button onClick={recargar} disabled={actualizando}
          className="border border-gray-300 text-gray-700 text-sm font-semibold px-3 py-1.5 rounded-lg hover:bg-gray-50 transition disabled:opacity-60 inline-flex items-center gap-1.5">
          <span className={`inline-block ${actualizando ? "animate-spin" : ""}`}>⟳</span> {actualizando ? "Actualizando…" : "Actualizar"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {mesa ? (
        <div className="max-w-xl"><MesaDetalle mesa={mesa} serie={serie} /></div>
      ) : (
        <>
        <ResumenMesasDia datos={datos} mesas={mesas} />
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
          {mesas.map(m => {
            const tipo = tipoMesa(m.Tipo);
            return (
              <button key={m.Codigo} onClick={() => setSeleccion(m.Codigo)}
                className="text-left rounded-2xl border border-gray-200 bg-gradient-to-b from-white to-gray-50 shadow-sm p-4 pt-3 hover:shadow-md transition relative overflow-hidden"
                style={{ borderTop: `3px solid ${tipo.color}` }}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="font-bold text-gray-900 truncate">{m.Nombre}</span>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold ${tipo.clase}`}>{tipo.label}</span>
                </div>
                <p className={`text-3xl font-bold tabular-nums ${m.LbTotal > 0 ? "text-gray-900" : "text-gray-400"}`}>
                  {fmtNum(m.LbTotal, 1)} <span className="text-sm font-medium text-gray-400">lb</span>
                </p>
                <p className="text-sm font-semibold tabular-nums mt-1" style={{ color: tipo.color }}>
                  {fmtNum(m.LbHoraPonderada, 1)} lb/hr
                </p>
                {/* Avance: cuántas de las asignadas están pesando (Banda temporal no tiene asignadas) */}
                <div className="h-1.5 rounded-full bg-gray-200 mt-3 overflow-hidden">
                  <div className="h-full rounded-full" style={{
                    width: `${m.Asignados ? Math.min(100, (100 * m.Pesando) / m.Asignados) : 0}%`, background: tipo.color,
                  }} />
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  {m.Asignados == null ? `${m.Pesando} pesando` : `${m.Pesando} de ${m.Asignados} pesando`}
                  {` · ${m.Tallas.length} talla${m.Tallas.length !== 1 ? "s" : ""}`}
                </p>
              </button>
            );
          })}
        </div>
        </>
      )}
    </div>
  );
}
