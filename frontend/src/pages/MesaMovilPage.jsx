import { useMemo } from "react";
import { useMesasHoy } from "./MesasHoyPage.jsx";
import MesaDetalle from "../components/MesaDetalle.jsx";
import { horaDe, serieHorasMesa } from "../utils/mesas.js";

// Página que abre el QR pegado en cada mesa: https://planta.esteromar.app/#/mesa/MESA03.
// Pensada para el celular del supervisor (requiere sesión y el permiso mesas.reporte; las peladoras
// no usan la app). Arriba solo el día actual; abajo la gráfica de hoy hora por hora. Se
// refresca sola cada 2 min, y el selector deja pasar a otra mesa sin buscar su QR.
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fechaCorta(ymd) {
  const [y, m, d] = String(ymd ?? "").split("-").map(Number);
  if (!y) return "";
  return `${DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MESES[m - 1]}`;
}

export default function MesaMovilPage({ codigo }) {
  const { datos, mesas, error, cargando, actualizando, recargar } = useMesasHoy();
  const mesa = useMemo(() => mesas.find(m => m.Codigo === codigo), [mesas, codigo]);
  const serie = useMemo(() => serieHorasMesa(mesa, datos), [mesa, datos]);

  return (
    <div className="min-h-screen bg-[#eceeec]">
      <header className="sticky top-0 z-10 bg-[#0F5E57] text-white px-4 py-3 shadow rounded-b-2xl">
        <div className="flex items-center gap-3">
          <select value={codigo} onChange={e => { window.location.hash = `#/mesa/${e.target.value}`; }}
            className="min-w-0 flex-1 bg-[#0b4a44] text-white text-lg font-bold rounded-xl px-3 py-2 border border-[#2a7a72] focus:outline-none">
            {!mesa && <option value={codigo}>{codigo}</option>}
            {mesas.map(m => <option key={m.Codigo} value={m.Codigo}>{m.Nombre}</option>)}
          </select>
          <button onClick={recargar} disabled={actualizando} aria-label="Actualizar"
            className="shrink-0 bg-[#0F766E] hover:bg-[#13887f] disabled:opacity-80 rounded-xl px-3 py-2 text-lg">
            <span className={`inline-block ${actualizando ? "animate-spin" : ""}`}>⟳</span>
          </button>
        </div>
        <p className="text-xs text-[#cde7e2] mt-1 capitalize">
          Hoy {fechaCorta(datos?.fecha)}{datos ? ` · actualizado ${horaDe(datos.generado)}` : ""}
        </p>
      </header>

      <main className="px-4 py-4 max-w-xl mx-auto">
        {cargando ? (
          <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-[#0F766E] border-t-transparent rounded-full animate-spin" /></div>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : !mesa ? (
          <p className="text-sm text-gray-600">La mesa <span className="font-mono">{codigo}</span> no existe o está inactiva.</p>
        ) : (
          <MesaDetalle mesa={mesa} serie={serie} />
        )}
        <a href="#/mesas" className="block text-center text-sm text-[#0F766E] mt-6">Abrir el sistema</a>
      </main>
    </div>
  );
}
