import { useState, useEffect, useCallback } from "react";
import { authHeader } from "../context/AuthContext.jsx";

// Quién creó a mano, corrigió o borró marcajes (tabla BitacoraMarcaje, 12 nov 2026). Sirve para las
// dos pantallas: Entradas/Salidas (tabla="movimientos") y Transferencias (tabla="transferencias").
// De cada corrección se muestran solo los campos que cambiaron, con lo de antes tachado.
const ETIQUETA = { Codigo: "Código", Tipo: "Tipo", FechaHora: "Entrada", FechaSalida: "Salida", CodigoArea: "Área", Operador: "Marcó", RegistradoPor: "Registró" };
const ACCION = {
  CREAR:  { texto: "Alta manual", clase: "bg-blue-100 text-blue-800" },
  EDITAR: { texto: "Corrección",  clase: "bg-amber-100 text-amber-800" },
  BORRAR: { texto: "Borrado",     clase: "bg-red-100 text-red-700" },
};
// "2026-11-03 05:30:00" → "03/11/2026 05:30"
const fmt = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/.exec(String(v ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}` : (v ?? "—");
};

function Cambios({ b }) {
  const antes = b.Antes ?? {}, despues = b.Despues ?? {};
  if (b.Accion !== "EDITAR") {
    const r = b.Accion === "BORRAR" ? antes : despues;
    return (
      <span className="text-gray-700">
        {Object.entries(r).filter(([k]) => k !== "Codigo").map(([k, v]) => `${ETIQUETA[k] ?? k}: ${k.startsWith("Fecha") ? fmt(v) : (v ?? "—")}`).join(" · ")}
      </span>
    );
  }
  const campos = Object.keys(ETIQUETA).filter(k => k in antes || k in despues).filter(k => antes[k] !== despues[k]);
  return (
    <span className="space-x-3">
      {campos.map(k => (
        <span key={k} className="whitespace-nowrap">
          <span className="text-gray-500">{ETIQUETA[k]}:</span>{" "}
          <span className="line-through text-gray-400">{k.startsWith("Fecha") ? fmt(antes[k]) : (antes[k] ?? "—")}</span>{" → "}
          <span className="font-semibold text-gray-800">{k.startsWith("Fecha") ? fmt(despues[k]) : (despues[k] ?? "—")}</span>
        </span>
      ))}
    </span>
  );
}

export default function BitacoraMarcajeModal({ tabla, titulo, onClose }) {
  const [codigo, setCodigo] = useState("");
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState("");

  const cargar = useCallback(async (cod) => {
    setError("");
    try {
      const res = await fetch(`/api/${tabla}/bitacora${cod ? `?codigo=${encodeURIComponent(cod)}` : ""}`, { headers: authHeader() });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || "No se pudo cargar"); setFilas([]); return; }
      setFilas(d);
    } catch (e) { setError(e.message); setFilas([]); }
  }, [tabla]);
  useEffect(() => { cargar(""); }, [cargar]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-800">{titulo}</h2>
            <p className="text-xs text-gray-500">Altas manuales, correcciones y borrados, con quién los hizo. Lo del kiosco no aparece: ya lleva quién marcó.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <form className="px-6 pt-3 flex gap-2" onSubmit={e => { e.preventDefault(); cargar(codigo.trim()); }}>
          <input value={codigo} onChange={e => setCodigo(e.target.value)} placeholder="Código de empleado (vacío = todos)"
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-400" />
          <button type="submit" className="text-blue-600 text-sm font-medium px-3 py-1.5 rounded-lg border border-blue-200 hover:bg-blue-50">Buscar</button>
        </form>
        <div className="px-6 py-3 overflow-y-auto">
          {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
          {filas === null ? <p className="text-sm text-gray-400 py-6 text-center">Cargando…</p>
            : filas.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">Sin correcciones registradas.</p> : (
            <table className="w-full text-sm">
              <thead className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                <tr>
                  <th className="px-2 py-2 text-left">Cuándo</th>
                  <th className="px-2 py-2 text-left">Quién</th>
                  <th className="px-2 py-2 text-left">Acción</th>
                  <th className="px-2 py-2 text-left">Empleado</th>
                  <th className="px-2 py-2 text-left">Qué cambió</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filas.map(b => {
                  const a = ACCION[b.Accion] ?? { texto: b.Accion, clase: "bg-gray-100 text-gray-700" };
                  return (
                    <tr key={b.Id} className="align-top">
                      <td className="px-2 py-2 whitespace-nowrap tabular-nums">{fmt(b.Fecha)}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{b.Usuario}</td>
                      <td className="px-2 py-2"><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${a.clase}`}>{a.texto}</span></td>
                      <td className="px-2 py-2"><span className="font-mono text-xs text-gray-500">{b.Codigo}</span> {b.NombreEmpleado}</td>
                      <td className="px-2 py-2"><Cambios b={b} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
