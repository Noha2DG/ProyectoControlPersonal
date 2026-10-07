import { useMemo } from "react";
import { useMesasHoy, useHistorialMesas } from "./MesasHoyPage.jsx";
import MesaDetalle from "../components/MesaDetalle.jsx";
import { horaDe, serieMesa } from "../utils/mesas.js";

// Página que abre el QR pegado en cada mesa: https://planta.esteromar.app/#/mesa/MESA03.
// Pensada para el celular del supervisor (requiere sesión y el permiso mesas.reporte; las peladoras
// no usan la app). Arriba solo el día actual; abajo la gráfica de los 5 días anteriores + hoy. Se
// refresca sola cada 2 min, y el selector deja pasar a otra mesa sin buscar su QR.
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fechaCorta(ymd) {
  const [y, m, d] = String(ymd ?? "").split("-").map(Number);
  if (!y) return "";
  return `${DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MESES[m - 1]}`;
}

export default function MesaMovilPage({ codigo }) {
  const { datos, mesas, error, cargando, recargar } = useMesasHoy();
  const historial = useHistorialMesas();
  const mesa = useMemo(() => mesas.find(m => m.Codigo === codigo), [mesas, codigo]);
  const serie = useMemo(() => (mesa ? serieMesa(mesa.Codigo, mesas, historial, datos?.fecha) : []), [mesa, mesas, historial, datos]);

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="sticky top-0 z-10 bg-blue-700 text-white px-4 py-3 shadow">
        <div className="flex items-center gap-3">
          <select value={codigo} onChange={e => { window.location.hash = `#/mesa/${e.target.value}`; }}
            className="min-w-0 flex-1 bg-blue-800 text-white text-lg font-bold rounded-lg px-2 py-1.5 border border-blue-500 focus:outline-none">
            {!mesa && <option value={codigo}>{codigo}</option>}
            {mesas.map(m => <option key={m.Codigo} value={m.Codigo}>{m.Nombre}</option>)}
          </select>
          <button onClick={recargar} aria-label="Actualizar" className="shrink-0 bg-blue-600 hover:bg-blue-500 rounded-lg px-3 py-1.5 text-lg">⟳</button>
        </div>
        <p className="text-xs text-blue-100 mt-1 capitalize">
          Hoy {fechaCorta(datos?.fecha)}{datos ? ` · actualizado ${horaDe(datos.generado)}` : ""}
        </p>
      </header>

      <main className="px-4 py-4 max-w-xl mx-auto">
        {cargando ? (
          <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : !mesa ? (
          <p className="text-sm text-gray-600">La mesa <span className="font-mono">{codigo}</span> no existe o está inactiva.</p>
        ) : (
          <MesaDetalle mesa={mesa} serie={serie} />
        )}
        <a href="#/" className="block text-center text-sm text-blue-700 mt-6">Abrir el sistema</a>
      </main>
    </div>
  );
}
