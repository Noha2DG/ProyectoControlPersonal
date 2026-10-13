import { fmtNum } from "../utils/numero.js";
import { tipoMesa, fmtVsMeta, estadoMeta, COLOR_META, TOLERANCIA_META } from "../utils/mesas.js";
import GraficaMesa from "./GraficaMesa.jsx";

// Detalle de una mesa: ARRIBA solo el día de hoy (totales y cada persona con libras y Lb/Hora) y
// ABAJO la gráfica de hoy hora por hora. Lo comparten la página del QR (#/mesa/:codigo,
// pensada para celular) y la pestaña "Por Mesa" de Destajo.
// "+12%" con el color de su estado (verde en meta, ámbar cerca, rojo abajo). Sin meta → guion gris.
export function VsMeta({ valor, className = "" }) {
  const e = estadoMeta(valor);
  return <span className={`tabular-nums font-semibold ${e ? COLOR_META[e].texto : "text-gray-400"} ${className}`}>{fmtVsMeta(valor)}</span>;
}

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
        {mesa.VsMeta != null && (
          // Contra la meta por talla: libras esperadas = horas en cada talla × su meta (utils/mesas.js).
          <div className={`mt-3 rounded-lg border px-3 py-2 flex items-center gap-3 ${COLOR_META[estadoMeta(mesa.VsMeta)].fondo}`}>
            <VsMeta valor={mesa.VsMeta} className="text-2xl" />
            <p className="text-xs text-gray-700 leading-snug">
              {mesa.VsMeta >= 0 ? "arriba de la meta" : "abajo de la meta"} en libras acumuladas
              <br /><span className="tabular-nums">{fmtNum(mesa.LbTotal, 0)}</span> lb de{" "}
              <span className="tabular-nums">{fmtNum(mesa.LbMeta, 0)}</span> esperadas a esta hora según las tallas trabajadas
            </p>
          </div>
        )}
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
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-4 py-2 text-xs text-gray-500 uppercase tracking-wide">
            <span>Persona</span><span className="text-right w-14">Lb</span><span className="text-right w-14">vs meta</span>
            <span className="text-right w-14">Lb/Hr</span>
          </div>
          {pesando.map(p => (
            <div key={p.Codigo} className="px-4 py-2.5">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-baseline">
                <span className="min-w-0 break-words leading-snug font-medium text-gray-900">
                  {p.NombreCorto}
                  {p.EsLider && <span className="ml-1.5 text-xs font-semibold text-amber-700">★ Líder</span>}
                </span>
                <span className="text-right w-14 tabular-nums text-gray-900">{fmtNum(p.Lb, 1)}</span>
                <VsMeta valor={p.VsMeta} className="text-right w-14" />
                <span className="text-right w-14 tabular-nums font-semibold text-[#0F766E]">{fmtNum(p.LbPorHora, 1)}</span>
              </div>
              <p className="text-xs text-gray-500">
                {p.Areas && <span className="font-medium text-gray-700">{p.Areas} · </span>}
                {p.NumPesadas} pesada{p.NumPesadas !== 1 ? "s" : ""}{p.UltimaHora ? ` · última ${p.UltimaHora}` : ""}
                {p.LbMeta != null && ` · esperadas ${fmtNum(p.LbMeta, 1)} lb`}
                {/* Horas en un producto o talla sin tarifa: no entran al %, así que el % y la Lb/hr
                    de la fila pueden no cuadrar a simple vista. Se dice cuánto quedó fuera. */}
                {p.HorasSinMeta > 0.05 && <span className="text-amber-700"> · {fmtNum(p.HorasSinMeta, 1)} h sin tarifa</span>}
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
          <p className="px-4 py-2 text-[11px] text-gray-400">
            Vs meta: libras acumuladas contra las esperadas a esta hora (tiempo en el área en cada talla × su meta, que sale de la tarifa).
            La meta sube con el reloj aunque no hayan pesado; al pesar se ve si alcanzaron.
            Las libras sin marcaje de área o sin tarifa cuentan igual en las dos, como cumplidas.
            Verde en meta o arriba, ámbar hasta {TOLERANCIA_META}% abajo, rojo más abajo.
          </p>
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
