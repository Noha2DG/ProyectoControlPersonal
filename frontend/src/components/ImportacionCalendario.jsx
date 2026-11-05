import { useState } from "react";
import { fLb, fUsd, fFecha, fMes, fCorta, diasEntre, sumarDias, mesDe, sumarMeses } from "../utils/importaciones.js";
import { caja } from "./ImportacionUI.jsx";

// Calendario de Importaciones: el mes con lo que sale, llega y se paga cada día, o una línea de tiempo
// con una barra por solicitud (de la salida a la llegada) y el pago como rombo. Las anuladas no salen.
const TIPOS = [["salida", "Salidas"], ["llegada", "Llegadas"], ["pago", "Pagos"]];
const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function claseEvento(tipo, s, hoy) {
  if (tipo === "salida") return "bg-sky-50 text-sky-800 border-sky-200";
  if (tipo === "llegada") return s.Estado === "RECIBIDA" ? "bg-emerald-50 text-emerald-800 border-emerald-200"
    : s.FechaLlegada < hoy ? "bg-red-50 text-red-700 border-red-200" : "bg-blue-50 text-blue-800 border-blue-200";
  return s.EstadoPago === "PAGADA" ? "bg-emerald-50 text-emerald-800 border-emerald-200"
    : s.FechaPago < hoy ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-50 text-amber-900 border-amber-200";
}
const textoEvento = (tipo, s) => (tipo === "salida" ? "Sale" : tipo === "llegada" ? (s.Estado === "RECIBIDA" ? "Recibida" : "Llega") : s.EstadoPago === "PAGADA" ? "Pagada" : "Pago");
const fechaEvento = (tipo, s) => (tipo === "salida" ? s.FechaSalida : tipo === "llegada" ? s.FechaLlegada : s.FechaPago);

export default function ImportacionCalendario({ solicitudes, hoy, onAbrir }) {
  const [modo, setModo] = useState("mes");
  const [mes, setMes] = useState(mesDe(hoy));
  const [ver, setVer] = useState({ salida: true, llegada: true, pago: true });
  const [dosMeses, setDosMeses] = useState(false); // este mes y el siguiente, uno al lado del otro
  const vivas = solicitudes.filter(s => s.Estado !== "ANULADA");
  const siguiente = sumarMeses(mes, 1);
  const titulo = !dosMeses ? fMes(mes)
    : mes.slice(0, 4) === siguiente.slice(0, 4) ? `${fMes(mes).slice(0, 3)} – ${fMes(siguiente)}` : `${fMes(mes)} – ${fMes(siguiente)}`;

  const boton = (activo) => `px-3 py-1 rounded-md text-sm font-medium transition ${activo ? "bg-white shadow text-blue-700" : "text-gray-600 hover:text-gray-800"}`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 bg-gray-200 rounded-lg p-1">
          <button onClick={() => setModo("mes")} className={boton(modo === "mes")} aria-pressed={modo === "mes"}>Mes</button>
          <button onClick={() => setModo("linea")} className={boton(modo === "linea")} aria-pressed={modo === "linea"}>Línea de tiempo</button>
        </div>
        {modo === "mes" && (
          <>
            <div className="flex items-center gap-1 ml-1">
              <button onClick={() => setMes(m => sumarMeses(m, -1))} className="px-2 py-1 rounded-lg border border-gray-300 bg-white hover:bg-gray-50" aria-label="Mes anterior">‹</button>
              <span className={`${dosMeses ? "w-48" : "w-28"} text-center font-semibold text-gray-800`}>{titulo}</span>
              <button onClick={() => setMes(m => sumarMeses(m, 1))} className="px-2 py-1 rounded-lg border border-gray-300 bg-white hover:bg-gray-50" aria-label="Mes siguiente">›</button>
              <button onClick={() => setMes(mesDe(hoy))} className="ml-1 text-sm text-blue-700 hover:text-blue-900">Hoy</button>
              <button onClick={() => setDosMeses(v => !v)} aria-pressed={dosMeses}
                title={dosMeses ? "Ver un mes" : "Ver dos meses"}
                className={`ml-2 flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-sm font-medium transition ${dosMeses ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"}`}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="2.5" y="5" width="9" height="15" rx="1.5" strokeWidth={1.8} />
                  <rect x="12.5" y="5" width="9" height="15" rx="1.5" strokeWidth={1.8} />
                  <path strokeLinecap="round" strokeWidth={1.8} d="M2.5 9.5h9M12.5 9.5h9M6 3v3.5M18 3v3.5" />
                </svg>
                2 meses
              </button>
            </div>
            <div className="flex flex-wrap gap-3 ml-auto text-sm">
              {TIPOS.map(([k, t]) => (
                <label key={k} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={ver[k]} onChange={e => setVer(v => ({ ...v, [k]: e.target.checked }))} /> {t}
                </label>
              ))}
            </div>
          </>
        )}
      </div>
      {modo === "linea" ? <Linea solicitudes={vivas} hoy={hoy} onAbrir={onAbrir} />
        : dosMeses ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Mes solicitudes={vivas} mes={mes} ver={ver} hoy={hoy} onAbrir={onAbrir} compacto />
            <Mes solicitudes={vivas} mes={siguiente} ver={ver} hoy={hoy} onAbrir={onAbrir} compacto />
          </div>
        ) : <Mes solicitudes={vivas} mes={mes} ver={ver} hoy={hoy} onAbrir={onAbrir} />}
    </div>
  );
}

// `compacto`: dos meses lado a lado; celdas más bajas y cada evento solo con su tipo y proveedor (el
// detalle completo sigue en el título al pasar el mouse).
function Mes({ solicitudes, mes, ver, hoy, onAbrir, compacto = false }) {
  const primero = `${mes}-01`;
  const desfase = (new Date(Date.parse(`${primero}T00:00:00Z`)).getUTCDay() + 6) % 7; // lunes = 0
  const inicio = sumarDias(primero, -desfase);
  const dias = Array.from({ length: 42 }, (_, i) => sumarDias(inicio, i));
  const semanas = dias[35].slice(0, 7) === mes ? 6 : 5;

  const eventos = (dia) => TIPOS.flatMap(([tipo]) => (ver[tipo] ? solicitudes.filter(s => fechaEvento(tipo, s) === dia).map(s => ({ tipo, s })) : []));
  const delMes = dias.filter(d => mesDe(d) === mes).flatMap(eventos);
  const cuenta = (t) => delMes.filter(e => e.tipo === t).length;

  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-600">
        {compacto ? <b className="text-gray-800">{fMes(mes)}</b> : `En ${fMes(mes)}`}: {TIPOS.filter(([k]) => ver[k]).map(([k, t]) => `${cuenta(k)} ${cuenta(k) === 1 ? k : t.toLowerCase()}`).join(" · ") || "nada seleccionado"}
      </p>
      <div className={`${caja} overflow-x-auto`}>
        <div className={`grid grid-cols-7 ${compacto ? "min-w-[480px]" : "min-w-[720px]"}`}>
          {DIAS.map(d => <div key={d} className="px-2 py-1.5 text-xs font-semibold text-gray-500 uppercase bg-gray-50 border-b border-gray-200">{d}</div>)}
          {dias.slice(0, semanas * 7).map(d => {
            const fuera = mesDe(d) !== mes, esHoy = d === hoy;
            return (
              // Hoy: la celda entera resaltada (fondo y borde), no solo el número, para encontrarla de un vistazo.
              <div key={d} aria-current={esHoy ? "date" : undefined}
                className={`${compacto ? "min-h-[72px] p-1" : "min-h-[96px] p-1.5"} border-b border-r space-y-1 ${esHoy ? "bg-blue-50 border-blue-100 ring-2 ring-inset ring-blue-500" : fuera ? "border-gray-100 bg-gray-50/60" : "border-gray-100"}`}>
                <div className="flex items-center gap-1">
                  <span className={`text-xs font-semibold ${esHoy ? "bg-blue-600 text-white rounded-full px-1.5" : fuera ? "text-gray-300" : "text-gray-500"}`}>{Number(d.slice(8))}</span>
                  {esHoy && <span className="text-[10px] font-bold uppercase tracking-wide text-blue-700">Hoy</span>}
                </div>
                {/* En dos meses los días de relleno de otro mes van vacíos: ya salen en su propio mes. */}
                {!(compacto && fuera) && eventos(d).map(({ tipo, s }) => (
                  <button key={tipo + s.SolicitudId} onClick={() => onAbrir(s.SolicitudId)}
                    title={`${textoEvento(tipo, s)} · ${s.Folio} · ${s.Proveedor} · ${fLb(s.Libras)} lb · ${fUsd(s.TotalUsd)}`}
                    className={`block w-full text-left ${compacto ? "text-[10px] px-1 py-0.5" : "text-[11px] px-1.5 py-1"} leading-tight border rounded truncate hover:brightness-95 ${claseEvento(tipo, s, hoy)}`}>
                    <b>{textoEvento(tipo, s)}</b> {s.ProveedorCorto}{compacto ? "" : ` · ${tipo === "pago" ? fUsd(s.TotalUsd) : `${fLb(s.Libras)} lb`}`}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Linea({ solicitudes, hoy, onAbrir }) {
  const filas = [...solicitudes].sort((a, b) => a.FechaLlegada.localeCompare(b.FechaLlegada));
  if (!filas.length) return <p className="text-sm text-gray-500">No hay solicitudes para mostrar.</p>;
  const fechas = filas.flatMap(s => [s.FechaSalida, s.FechaLlegada, s.FechaPago].filter(Boolean)).concat(hoy).sort();
  const ini = sumarDias(fechas[0], -3), fin = sumarDias(fechas[fechas.length - 1], 4), total = diasEntre(ini, fin);
  const pct = (d) => (diasEntre(ini, d) / total) * 100;
  const meses = [];
  for (let m = mesDe(ini); m <= mesDe(fin); m = sumarMeses(m, 1)) meses.push(m);

  return (
    <div className={`${caja} p-3 overflow-x-auto`}>
      <div className="min-w-[760px]">
        <div className="relative h-6 ml-48 border-b border-gray-200 text-xs text-gray-500">
          {meses.map(m => <span key={m} className="absolute top-0 whitespace-nowrap" style={{ left: `${Math.max(0, pct(`${m}-01`))}%` }}>{fMes(m)}</span>)}
        </div>
        <div className="relative">
          <div className="absolute top-0 bottom-0 left-48 right-0 pointer-events-none">
            <div className="absolute top-0 bottom-0 border-l-2 border-blue-500/70" style={{ left: `${pct(hoy)}%` }}>
              <span className="absolute -top-0.5 left-1 text-[10px] font-semibold text-blue-700">hoy</span>
            </div>
          </div>
          {filas.map(s => {
            const tarde = s.FechaSalida && s.FechaSalida > s.FechaLlegada;
            const a = s.FechaSalida && !tarde ? pct(s.FechaSalida) : pct(s.FechaLlegada), b = pct(s.FechaLlegada);
            const color = s.Estado === "RECIBIDA" ? "bg-emerald-500" : s.FechaLlegada < hoy ? "bg-red-500" : "bg-blue-500";
            const pago = s.EstadoPago === "PAGADA" ? "bg-emerald-600" : s.FechaPago < hoy ? "bg-red-600" : "bg-amber-500";
            return (
              <button key={s.SolicitudId} onClick={() => onAbrir(s.SolicitudId)}
                className="flex items-center w-full h-9 text-left hover:bg-gray-50 rounded"
                title={`${s.Folio} · sale ${fFecha(s.FechaSalida)} · llega ${fFecha(s.FechaLlegada)} · pago ${fFecha(s.FechaPago)}`}>
                <span className="w-48 shrink-0 pr-2 text-xs truncate"><b className="text-gray-800">{s.Folio}</b> <span className="text-gray-500">{s.ProveedorCorto} · {fLb(s.Libras)} lb</span></span>
                <span className="relative flex-1 h-full">
                  <span className={`absolute top-1/2 -translate-y-1/2 h-2.5 rounded-full ${color}`} style={{ left: `${a}%`, width: `${Math.max(0.6, b - a)}%` }} />
                  <span className={`absolute top-1/2 w-2.5 h-2.5 rotate-45 -translate-y-1/2 -translate-x-1/2 ${pago}`} style={{ left: `${pct(s.FechaPago)}%` }} />
                  <span className="absolute top-1/2 -translate-y-1/2 text-[10px] text-gray-500 pl-1.5 whitespace-nowrap" style={{ left: `${Math.max(b, pct(s.FechaPago)) + 0.5}%` }}>{fCorta(s.FechaLlegada)}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
          <span><span className="inline-block w-4 h-2 rounded-full bg-blue-500 align-middle" /> de la salida a la llegada</span>
          <span><span className="inline-block w-2.5 h-2.5 rotate-45 bg-amber-500 align-middle" /> pago pendiente</span>
          <span><span className="inline-block w-2.5 h-2.5 rotate-45 bg-emerald-600 align-middle" /> pagada / recibida</span>
          <span><span className="inline-block w-2.5 h-2.5 rotate-45 bg-red-600 align-middle" /> vencida / atrasada</span>
        </p>
      </div>
    </div>
  );
}
