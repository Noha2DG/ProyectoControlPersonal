import { fmtNum } from "../utils/numero.js";
import { tipoMesa } from "../utils/mesas.js";
import GraficaMesa from "./GraficaMesa.jsx";

// Detalle de una mesa: ARRIBA solo el día de hoy (totales y cada persona con libras y Lb/Hora) y
// ABAJO la gráfica de hoy hora por hora. Lo comparten la página del QR (#/mesa/:codigo,
// pensada para celular) y la pestaña "Por Mesa" de Destajo.
export default function MesaDetalle({ mesa, serie }) {
  const tipo = tipoMesa(mesa.Tipo);
  const pesando = mesa.personas.filter(p => p.NumPesadas > 0);
  const sinPesar = mesa.personas.filter(p => p.NumPesadas === 0);

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${tipo.clase}`}>{tipo.label}</span>
          {mesa.Tipo === "TEMPORAL" && <span className="text-xs text-gray-500">quienes pesaron hoy sin mesa asignada</span>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Libras hoy</p>
            <p className="text-3xl font-bold text-gray-900">{fmtNum(mesa.LbTotal, 1)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Lb/Hora ponderada</p>
            <p className="text-3xl font-bold text-[#0F766E]">{fmtNum(mesa.LbHoraPonderada, 1)}</p>
          </div>
        </div>
        <p className="text-sm text-gray-600 mt-2">
          {mesa.Asignados == null
            ? `${mesa.Pesando} persona${mesa.Pesando !== 1 ? "s" : ""} pesando`
            : `${mesa.Pesando} de ${mesa.Asignados} pesando`}
        </p>
        <p className="text-sm text-gray-600 mt-1">
          <span className="font-semibold text-gray-900">{mesa.Tallas.length}</span> talla{mesa.Tallas.length !== 1 ? "s" : ""} trabajada{mesa.Tallas.length !== 1 ? "s" : ""} hoy
          {mesa.Tallas.length > 0 && <span className="text-gray-500"> · {mesa.Tallas.join(", ")}</span>}
        </p>
      </div>

      {pesando.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-2 text-xs text-gray-500 uppercase tracking-wide">
            <span>Persona</span><span className="text-right w-16">Lb</span><span className="text-right w-16">Lb/Hr</span>
          </div>
          {pesando.map(p => (
            <div key={p.Codigo} className="px-4 py-2.5">
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-baseline">
                <span className="min-w-0 break-words leading-snug font-medium text-gray-900">
                  {p.NombreCorto}
                  {p.EsLider && <span className="ml-1.5 text-xs font-semibold text-amber-700">★ Líder</span>}
                </span>
                <span className="text-right w-16 tabular-nums text-gray-900">{fmtNum(p.Lb, 1)}</span>
                <span className="text-right w-16 tabular-nums font-semibold text-[#0F766E]">{fmtNum(p.LbPorHora, 1)}</span>
              </div>
              <p className="text-xs text-gray-500">
                {p.Areas && <span className="font-medium text-gray-700">{p.Areas} · </span>}
                {p.NumPesadas} pesada{p.NumPesadas !== 1 ? "s" : ""}{p.UltimaHora ? ` · última ${p.UltimaHora}` : ""}
              </p>
              {p.LbSinTiempo > 0.05 && (
                // Libras sin tiempo medible (sin entrada al área, o bloque menor al mínimo al cambiar
                // de talla): cuentan en Lb pero no en Lb/Hr — mismo criterio de "libra válida" del
                // Reporte. En gris y corto: le sale a casi todas, y en naranja competía con la gráfica.
                <p className="text-xs text-gray-400">{fmtNum(p.LbSinTiempo, 1)} lb sin tiempo válido *</p>
              )}
            </div>
          ))}
          {pesando.some(p => p.LbSinTiempo > 0.05) && (
            <p className="px-4 py-2 text-[11px] text-gray-400">* Libras pesadas sin tiempo medible (sin marcaje de entrada o un cambio de talla muy corto): cuentan en Lb pero no en Lb/Hr.</p>
          )}
        </div>
      )}

      {sinPesar.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Sin pesadas hoy</p>
          <p className="text-sm text-gray-700">
            {sinPesar.map(p => `${p.NombreCorto}${p.EsLider ? " (líder)" : ""}`).join(" · ")}
          </p>
        </div>
      )}

      {serie?.length > 0 && (
        <GraficaMesa serie={serie} />
      )}

      {mesa.personas.length === 0 && (
        <p className="text-center text-sm text-gray-400 py-6">
          {mesa.Tipo === "TEMPORAL" ? "Nadie ha pesado hoy sin mesa asignada." : "Esta mesa no tiene personas asignadas."}
        </p>
      )}
    </div>
  );
}
