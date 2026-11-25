import { useEffect } from "react";
import { createPortal } from "react-dom";
import { fmtNum } from "../utils/numero.js";
import { C, IMPRIMIR_COLOR, Kg, Dato, Eslabon, TituloSeccion } from "./HojaLote.jsx";

// La hoja de tratamiento impresa: el formulario "TRATAMIENTO DE CAMARON" ya con los números que el
// sistema calculó (tiempo, pick-up, totales del turno). Se imprime con el diálogo del navegador
// ("Guardar como PDF"), igual que la hoja de Descongelado.
//
// No pide nada al servidor: imprime el mismo detalle que se está viendo en pantalla, para que el
// papel y la pantalla no digan cosas distintas. Va en horizontal porque son trece columnas, las del
// papel.

function fmtDia(iso) {
  if (!iso) return "—";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}
const hora = (s) => (s ? String(s).slice(11, 16) : "—");
// h:mm y no "1 h 50 min": en la columna de tiempo de la hoja impresa lo largo se recortaba.
const fmtTiempo = (min) => (min == null ? "—" : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`);
const pct = (p) => (p == null ? "—" : `${p > 0 ? "+" : ""}${fmtNum(p, 1)} %`);
const colorAlerta = (a) => (a === "PERDIDA" ? "text-red-700 font-bold" : a === "EXCEDE" ? "text-amber-700 font-bold" : "");
// Pick-up arriba de +10 % va en verde y abajo de 3 % (negativos incluidos) en rojo (usuario, 25 nov
// 2026). La alerta de "excede el máximo" (ámbar) manda sobre el verde.
const PICKUP_VERDE = 10;
const PICKUP_ROJO = 3;
const VERDE = "#15803D";
const colorPickupCelda = (p, a) =>
  colorAlerta(a) || (p == null ? "" : p > PICKUP_VERDE ? "text-green-700 font-bold" : p < PICKUP_ROJO ? "text-red-700 font-bold" : "");
// El corte es la clase sin el "CULTIVO PELADO" con que empiezan todas las de pelado: lo que distingue
// a una de otra es lo que viene después (P&D T-OFF, PUD T-ON…).
const corteDe = (t) => `${t.Clase} · ${String(t.DescripcionClase ?? "").replace(/^CULTIVO\s+PELADO\s+/i, "")}`;

// Ancho fijo por columna (suman 100 %): con ancho automático, trece columnas en una hoja se
// apretaban hasta pegarse unas con otras ("4" y "1 min" se leían "41 min"). Lo que no cabe se recorta
// con "…" en su celda, nunca se pinta encima de la vecina.
const COLUMNAS = [
  ["Termo", "6%"], ["Lote", "12%"], ["Talla", "7%"], ["Horario", "10%"], ["Tiempo h:mm", "6%"], ["Conteo fin.", "8%"],
  ["Químico", "7%"], ["Corte", "12%"], ["Kg sin tratar", "7%", true], ["Kg tratadas", "7%", true], ["% Pick-up", "9%", true], ["Va a", "9%"],
];
const CELDA = "py-0.5 px-1.5 truncate";

// Mismo diseño que la Hoja de Lote de Pelado y la de Descongelado (usuario, 25 nov 2026): las piezas
// vienen de HojaLote.jsx para no tener otro estilo más.
export function ContenidoHojaTratamiento({ hoja, pickupMaximo = 20 }) {
  const c = true; // letra de papel: la hoja lleva doce columnas aun en pantalla
  const abierta = hoja.Estatus !== "Cerrada";
  const t = hoja.Totales;
  const aux = hoja.Auxiliares;
  const insumos = hoja.Insumos.filter(i => i.Cantidad != null);
  const diferencias = hoja.Lineas.filter(l => l.KgDiferencia > 0);
  const colorPickup = t.Alerta === "PERDIDA" ? C.rojo : t.Alerta === "EXCEDE" ? C.ambar
    : t.Pickup == null ? C.marea : t.Pickup > PICKUP_VERDE ? VERDE : t.Pickup < PICKUP_ROJO ? C.rojo : C.marea;
  const th = "py-1 px-1.5 text-[9px] font-semibold uppercase tracking-wide leading-tight";
  const Seccion = "break-inside-avoid pt-2 pb-2";

  return (
    <div className="text-slate-800" style={IMPRIMIR_COLOR}>
      {/* ── Encabezado ── */}
      <div className="rounded-md overflow-hidden border mb-3" style={{ borderColor: C.marea }}>
        <div className="flex items-center justify-between px-3 py-1.5" style={{ background: C.marea }}>
          <h3 className="text-sm font-bold uppercase tracking-wide text-white">
            Hoja de Tratamiento <span className="font-mono tracking-normal">#{hoja.HojaId}</span>
            <span className="font-normal text-sky-200"> — Camarón</span>
          </h3>
          <span className="text-[11px] font-semibold text-sky-100 tabular-nums">
            {abierta && <span className="mr-2 rounded bg-red-600 px-1.5 py-0.5 text-white uppercase">Borrador — hoja abierta</span>}
            Jornada {fmtDia(hoja.FechaProduccion)}
          </span>
        </div>
        <div className="grid grid-cols-4 divide-x divide-y divide-white" style={{ background: C.hielo }}>
          <Dato c={c} ancho titulo="Cliente previsto">{hoja.NombreCliente || "—"}</Dato>
          <Dato c={c} titulo="Encargado de turno">{hoja.NombreEncargado || hoja.Encargado || "—"}</Dato>
          <Dato c={c} titulo="Horario">
            <span className="tabular-nums">{hora(hoja.HoraInicio)} – {abierta ? "…" : hora(hoja.HoraFin)}</span>
          </Dato>
          <div className="col-span-4">
            <Dato c={c} titulo="Personal del turno">
              {aux ? aux.Personas : hoja.Personas ?? "—"} personas
              {aux && <span className="font-normal text-slate-500"> · del marcaje del área, sin contar al encargado</span>}
            </Dato>
          </div>
        </div>
      </div>

      <div className="divide-y-2 divide-slate-300">
        {/* ── Termos ── */}
        <div className={`${Seccion} !pt-0`}>
          <TituloSeccion c={c} extra={`${hoja.Termos.length} termo${hoja.Termos.length !== 1 ? "s" : ""}`}>Tratamiento por termo</TituloSeccion>
          <table className="print-table w-full table-fixed border-collapse text-[10.5px]">
            <colgroup>{COLUMNAS.map(([n, w]) => <col key={n} style={{ width: w }} />)}</colgroup>
            <thead>
              <tr className="align-bottom" style={{ background: C.hielo, color: C.marea }}>
                {COLUMNAS.map(([n, , der]) => (
                  <th key={n} className={`${th} ${der ? "text-right" : "text-left"}`}>{n}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hoja.Termos.map((x, i) => (
                <tr key={x.TermoId} className="border-b border-slate-100" style={i % 2 ? { background: "#FAFCFD" } : undefined}>
                  <td className={`${CELDA} font-mono font-semibold`} style={{ color: C.marea }}>{x.NumeroTermo ?? "—"}</td>
                  <td className={`${CELDA} font-mono`} title={x.Lote}>{x.Lote}</td>
                  <td className={CELDA}>{x.DescripcionTalla}</td>
                  <td className={`${CELDA} tabular-nums`}>{hora(x.HoraInicio)}–{x.HoraSalida ? hora(x.HoraSalida) : "en termo"}</td>
                  <td className={`${CELDA} tabular-nums`}>{fmtTiempo(x.Minutos)}</td>
                  <td className={CELDA}>{x.ConteoFinal ?? "—"}</td>
                  <td className={CELDA}>{x.NombreQuimico || "—"}</td>
                  <td className={`${CELDA} text-slate-700`} title={`${x.Clase} ${x.DescripcionClase ?? ""}`}>{corteDe(x)}</td>
                  <td className={`${CELDA} text-right tabular-nums`}>{fmtNum(x.KgSinTratar)}</td>
                  <td className={`${CELDA} text-right tabular-nums font-semibold`}>{x.KgTratadas != null ? fmtNum(x.KgTratadas) : "—"}</td>
                  <td className={`${CELDA} text-right tabular-nums ${colorPickupCelda(x.Pickup, x.Alerta)}`}>{pct(x.Pickup)}{x.Alerta ? " ⚠" : ""}</td>
                  <td className={CELDA}>{x.NombreDestino || "—"}</td>
                </tr>
              ))}
              {hoja.Termos.length === 0 && <tr><td colSpan={COLUMNAS.length} className="py-3 text-center text-slate-400">Sin termos</td></tr>}
            </tbody>
            <tfoot>
              <tr className="font-bold" style={{ borderTop: `2px solid ${C.marea}` }}>
                <td colSpan={8} className={`${CELDA} text-right uppercase text-[9px] text-slate-500`}>Totales</td>
                <td className={`${CELDA} text-right tabular-nums`}>{fmtNum(t.KgRecibidos)}</td>
                <td className={`${CELDA} text-right tabular-nums`} style={{ color: C.coral }}>{fmtNum(t.KgTratados)}</td>
                <td className={`${CELDA} text-right tabular-nums ${colorPickupCelda(t.Pickup, t.Alerta)}`}>{pct(t.Pickup)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ── Totales del turno e insumos ── */}
        <div className={`${Seccion} grid grid-cols-3 gap-4`}>
          <div className="col-span-2">
            <TituloSeccion c={c}>Cuadre del turno</TituloSeccion>
            {/* "En termo" solo aparece si hay termos adentro: ganados y pick-up son de lo que ya salió, y
                sin ese recuadro "recibidos" contra "tratados" se leía como pérdida. */}
            <div className="flex items-stretch gap-1">
              <Eslabon c={c} titulo="Kg recibidos" color={C.marea}><Kg c={c} v={t.KgRecibidos} /></Eslabon>
              {t.KgEnTermo > 0.001 && <Eslabon c={c} op="−" titulo="En termo" color={C.ambar}><Kg c={c} v={t.KgEnTermo} /></Eslabon>}
              <Eslabon c={c} op="→" titulo="Kg tratados" color={C.coral}><Kg c={c} v={t.KgTratados} /></Eslabon>
              <Eslabon c={c} op="=" titulo="Kg ganados" color={C.marea} fondo={C.hielo}><Kg c={c} v={t.KgGanados} /></Eslabon>
              <span className="w-1.5" />
              <Eslabon c={c} titulo="Pick-up" color={colorPickup} fondo="#E6F4F2">
                <span className="tabular-nums">{pct(t.Pickup)}</span>
                <div className="text-[8px] font-normal leading-tight whitespace-nowrap text-slate-500">ganado ÷ sin tratar</div>
              </Eslabon>
            </div>
            {t.EnTermo > 0 && <p className="text-[9.5px] mt-1" style={{ color: C.rojo }}>{t.EnTermo} termo{t.EnTermo > 1 ? "s" : ""} todavía en termo ({fmtNum(t.KgEnTermo)} kg): no entran a ganados ni al pick-up.</p>}
          </div>
          <div>
            <TituloSeccion c={c}>Insumos — consumo</TituloSeccion>
            {insumos.length ? (
              <div className="rounded-md border border-slate-200 px-2 py-1">
                {insumos.map((i, k) => (
                  <div key={i.Codigo} className={`text-[10.5px] flex items-center justify-between gap-3 py-0.5 ${k ? "border-t border-slate-100" : ""}`}>
                    <span className="truncate">{i.Nombre}</span>
                    <span className="tabular-nums whitespace-nowrap font-semibold" style={{ color: C.marea }}>
                      {fmtNum(i.Cantidad)} <span className="text-[9px] font-normal text-slate-400">{i.UM.toLowerCase()}</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : <p className="text-[10.5px] text-slate-400 rounded-md border border-dashed border-slate-300 py-2 text-center">Sin consumo registrado</p>}
          </div>
        </div>

        {/* Las firmas y el pie no se separan: con 14 termos se iban solas a una segunda hoja. */}
        <div className={`${Seccion} !pb-0`}>
          {diferencias.length > 0 && (
            <p className="text-[10.5px] mb-1">
              <span className="font-bold uppercase text-[9px]" style={{ color: C.ambar }}>Diferencias de báscula al cerrar:</span>{" "}
              {diferencias.map(l => `${l.Lote} ${l.Clase} ${l.DescripcionTalla ?? ""} ${fmtNum(l.KgDiferencia)} kg`).join(" · ")}
            </p>
          )}
          {hoja.Observaciones && <p className="text-[10.5px] mb-1"><span className="text-slate-500">Observaciones:</span> {hoja.Observaciones}</p>}
          <p className="text-[9.5px] text-slate-500 mb-6">
            % Pick-up = (kg tratadas − kg sin tratar) ÷ kg sin tratar × 100. ⚠ = alerta: pick-up negativo (salió pesando menos) o mayor a {pickupMaximo} %.
            El corte es el de la clase del producto.
          </p>

          <div className="grid grid-cols-2 gap-16">
            <div className="text-center">
              <p className="text-sm font-medium h-5">{hoja.NombreEncargado || ""}</p>
              <div className="border-t border-slate-800 pt-1 text-xs text-slate-600">Firma encargado</div>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium h-5"></p>
              <div className="border-t border-slate-800 pt-1 text-xs text-slate-600">Revisado por</div>
            </div>
          </div>

          <p className="text-[10px] text-slate-400 mt-3">
            Impreso {new Date().toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" })}
            {hoja.CerradaEn ? ` · Cerrada por ${hoja.CerradaPor} el ${fmtDia(hoja.CerradaEn)} ${hora(hoja.CerradaEn)}` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function HojaTratamientoModal({ hoja, pickupMaximo, onCerrar }) {
  // El navegador toma el nombre del PDF del título de la página.
  useEffect(() => {
    const antes = document.title;
    document.title = `Hoja tratamiento ${hoja.HojaId} ${hoja.NombreCliente ?? ""} - ${fmtDia(hoja.FechaProduccion).replaceAll("/", "-")}`;
    return () => { document.title = antes; };
  }, [hoja.HojaId, hoja.NombreCliente, hoja.FechaProduccion]);

  return (
    <>
      <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 p-4 print:hidden"
        onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-6xl max-h-full min-w-0 flex flex-col">
          <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
            <h2 className="text-base font-semibold text-gray-800">Hoja #{hoja.HojaId} — vista previa</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => window.print()}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition">
                Imprimir / PDF
              </button>
              <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-2 text-xl leading-none transition">&times;</button>
            </div>
          </div>
          <div className="px-8 py-6 overflow-auto">
            <ContenidoHojaTratamiento hoja={hoja} pickupMaximo={pickupMaximo} />
          </div>
        </div>
      </div>

      {createPortal(
        <div className="hidden print:block">
          <style>{"@media print { @page { size: letter landscape; margin: 1cm; } }"}</style>
          <ContenidoHojaTratamiento hoja={hoja} pickupMaximo={pickupMaximo} />
        </div>,
        document.getElementById("print-root")
      )}
    </>
  );
}
