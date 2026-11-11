import { useState, useEffect, useCallback } from "react";
import { authHeader, usePuede } from "../context/AuthContext.jsx";
import { fmtNum } from "../utils/numero.js";

// Liberar materia prima: cada contenedor importado (piscina Qnnn) nace pendiente y nada de él sale de
// bodega hasta que alguien con el permiso lo libera COMPLETO. Lista de pendientes arriba, con un
// botón por contenedor; lo ya resuelto queda abajo como historial. No se usa la palabra "calidad":
// es otra rama del proceso (usuario, 11 nov 2026).
const API = "/api/liberacion-mp";

const ESTADO = {
  PENDIENTE: { texto: "Pendiente de liberar", clase: "bg-amber-100 text-amber-800" },
  LIBERADO:  { texto: "Liberado",             clase: "bg-green-100 text-green-800" },
  RECHAZADO: { texto: "Rechazado",            clase: "bg-red-100 text-red-700" },
};

function Estado({ estado }) {
  const e = ESTADO[estado] ?? { texto: estado, clase: "bg-gray-100 text-gray-700" };
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${e.clase}`}>{e.texto}</span>;
}

// Solo se libera (usuario, 11 nov 2026: sin botón de rechazar). Lo que no se libera sigue pendiente.
function ModalLiberar({ contenedor, onHecho, onClose }) {
  const [observacion, setObservacion] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const enviar = async (e) => {
    e.preventDefault();
    setGuardando(true); setError("");
    try {
      const res = await fetch(`${API}/${contenedor.PiscinaId}/liberar`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ Observacion: observacion }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || "No se pudo guardar"); setGuardando(false); return; }
      onHecho();
    } catch (err) { setError(err.message); setGuardando(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={enviar} className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="text-lg font-bold text-gray-800">Liberar contenedor {contenedor.Contenedor}</h3>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-gray-600">
            Se libera el contenedor completo: sus <b>{contenedor.EnBodega}</b> masters en bodega podrán salir en cualquier remisión y armarse en cualquier polín.
          </p>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Observación (número de análisis, resultado…)</label>
            <textarea value={observacion} onChange={e => setObservacion(e.target.value)} rows={3} maxLength={500} autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition">Cancelar</button>
          <button type="submit" disabled={guardando}
            className="px-5 py-2 text-sm text-white font-semibold rounded-lg transition disabled:opacity-50 bg-green-600 hover:bg-green-700">
            {guardando ? "Guardando…" : `Liberar ${contenedor.Contenedor}`}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function LiberarMateriaPrimaPage() {
  const puedeLiberar = usePuede("liberar_mp", "liberar");
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [aLiberar, setALiberar] = useState(null);   // el contenedor del modal

  const cargar = useCallback(async () => {
    setCargando(true); setError("");
    try {
      const res = await fetch(API, { headers: authHeader() });
      const d = await res.json();
      if (!res.ok) { setError(d.error || "No se pudo cargar"); return; }
      setFilas(d);
    } catch (e) { setError(e.message); } finally { setCargando(false); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const pendientes = filas.filter(f => f.Estado !== "LIBERADO");
  const liberados = filas.filter(f => f.Estado === "LIBERADO");

  const tarjeta = (c) => (
    <div key={c.PiscinaId} className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
      <div className="w-40 shrink-0">
        <p className="font-mono text-lg font-bold text-gray-800">{c.Contenedor}</p>
        <Estado estado={c.Estado} />
      </div>
      <div className="flex-1 min-w-[14rem] grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-sm">
        <div><p className="text-xs text-gray-400">En bodega</p><p className="font-semibold text-gray-800">{c.EnBodega} masters</p></div>
        <div><p className="text-xs text-gray-400">Kg en bodega</p><p className="font-semibold text-gray-800">{fmtNum(c.KgEnBodega)}</p></div>
        <div><p className="text-xs text-gray-400">Muestras sacadas</p><p className="font-semibold text-gray-800">{c.Muestras}</p></div>
        <div><p className="text-xs text-gray-400">Llegó</p><p className="text-gray-700">{c.PrimerIngreso || "aún sin escanear"}</p></div>
        {c.Lotes && <div className="col-span-2 sm:col-span-4"><p className="text-xs text-gray-400">Lotes: <span className="font-mono text-gray-600">{c.Lotes}</span></p></div>}
        {c.Estado === "RECHAZADO" && (
          <div className="col-span-2 sm:col-span-4 text-xs text-red-700">
            Rechazado por {c.ResueltoPor} el {c.ResueltoEn}{c.Observacion ? ` — ${c.Observacion}` : ""}
          </div>
        )}
      </div>
      {puedeLiberar && (
        <div className="flex gap-2 ml-auto">
          <button onClick={() => setALiberar(c)}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 transition">Liberar</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-500">
        Cada contenedor importado nuevo entra <b>pendiente de liberar</b>: se recibe y se ubica en bodega, solo en polines de
        materia prima (MP), pero no puede salir en ninguna remisión hasta que se libere completo. La única salida permitida
        mientras tanto es la remisión <b>Muestra para análisis</b>.
      </p>

      {cargando ? (
        <div className="flex justify-center py-10"><div className="w-7 h-7 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-700">Por liberar ({pendientes.length})</h2>
            {pendientes.length === 0
              ? <p className="bg-white border border-gray-200 rounded-lg px-4 py-6 text-center text-sm text-gray-400">No hay contenedores pendientes.</p>
              : pendientes.map(tarjeta)}
          </section>

          {liberados.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-700">Liberados</h2>
              <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                    <tr>
                      <th className="px-3 py-2 text-left">Contenedor</th>
                      <th className="px-3 py-2 text-left">Liberado por</th>
                      <th className="px-3 py-2 text-left">Fecha</th>
                      <th className="px-3 py-2 text-left">Observación</th>
                      <th className="px-3 py-2 text-right">En bodega</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {liberados.map(c => (
                      <tr key={c.PiscinaId}>
                        <td className="px-3 py-2 font-mono font-semibold">{c.Contenedor}</td>
                        <td className="px-3 py-2">{c.ResueltoPor}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{c.ResueltoEn}</td>
                        <td className="px-3 py-2 text-gray-600">{c.Observacion || "—"}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">{c.EnBodega} masters</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      {aLiberar && (
        <ModalLiberar contenedor={aLiberar}
          onClose={() => setALiberar(null)} onHecho={() => { setALiberar(null); cargar(); }} />
      )}
    </div>
  );
}
