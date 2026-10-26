import { useEffect } from "react";
import { createPortal } from "react-dom";
import { fmtNum } from "../utils/numero.js";

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
// El corte es la clase sin el "CULTIVO PELADO" con que empiezan todas las de pelado: lo que distingue
// a una de otra es lo que viene después (P&D T-OFF, PUD T-ON…).
const corteDe = (t) => `${t.Clase} · ${String(t.DescripcionClase ?? "").replace(/^CULTIVO\s+PELADO\s+/i, "")}`;

// Ancho fijo por columna (suman 100 %): con ancho automático, trece columnas en una hoja se
// apretaban hasta pegarse unas con otras ("4" y "1 min" se leían "41 min"). Lo que no cabe se recorta
// con "…" en su celda, nunca se pinta encima de la vecina.
const COLUMNAS = [
  ["Termo", "6%"], ["Lote", "12%"], ["Talla", "7%"], ["Horario", "10%"], ["Tiempo h:mm", "6%"], ["Conteo ini. → fin.", "8%"],
  ["Químico", "7%"], ["Corte", "12%"], ["Kg sin tratar", "7%", true], ["Kg tratadas", "7%", true], ["% Pick-up", "9%", true], ["Va a", "9%"],
];
const CELDA = "py-0.5 px-1.5 truncate";

export function ContenidoHojaTratamiento({ hoja, pickupMaximo = 20 }) {
  const abierta = hoja.Estatus !== "Cerrada";
  const t = hoja.Totales;
  const aux = hoja.Auxiliares;
  const insumos = hoja.Insumos.filter(i => i.Cantidad != null);
  const diferencias = hoja.Lineas.filter(l => l.KgDiferencia > 0);

  return (
    <div className="text-gray-900">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold">Tratamiento de Camarón</h1>
          <p className="text-sm text-gray-500">Hoja de proceso · una hoja por cliente</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-mono font-bold">Hoja #{hoja.HojaId}</p>
          <p className="text-sm text-gray-500">Jornada {fmtDia(hoja.FechaProduccion)}</p>
          {abierta && <p className="text-sm font-bold text-red-600 uppercase">Borrador — hoja abierta</p>}
        </div>
      </div>

      <div className="border-y-2 border-gray-800 py-2 mb-3 grid grid-cols-4 gap-x-6 gap-y-1 text-sm">
        <div className="col-span-2"><span className="text-gray-500">Cliente previsto:</span> <b>{hoja.NombreCliente || "—"}</b></div>
        <div><span className="text-gray-500">Encargado:</span> <b>{hoja.NombreEncargado || hoja.Encargado || "—"}</b></div>
        <div><span className="text-gray-500">Horario:</span> <b>{hora(hoja.HoraInicio)} – {abierta ? "…" : hora(hoja.HoraFin)}</b></div>
        <div className="col-span-4">
          <span className="text-gray-500">Personas:</span> <b>{aux ? aux.Personas : hoja.Personas ?? "—"}</b>
          {aux && <span className="text-gray-500"> (del marcaje del área, sin contar al encargado)</span>}
        </div>
      </div>

      <table className="w-full table-fixed text-[11px] print-table mb-3">
        <colgroup>{COLUMNAS.map(([n, w]) => <col key={n} style={{ width: w }} />)}</colgroup>
        <thead>
          <tr className="uppercase border-b-2 border-gray-800 text-[10px] text-gray-600 align-bottom">
            {COLUMNAS.map(([n, , der]) => (
              <th key={n} className={`py-1 px-1.5 font-semibold leading-tight ${der ? "text-right" : "text-left"}`}>{n}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {hoja.Termos.map(x => (
            <tr key={x.TermoId}>
              <td className={`${CELDA} font-mono font-semibold`}>{x.NumeroTermo}</td>
              <td className={`${CELDA} font-mono`} title={x.Lote}>{x.Lote}</td>
              <td className={CELDA}>{x.DescripcionTalla}</td>
              <td className={CELDA}>{hora(x.HoraInicio)}–{x.HoraSalida ? hora(x.HoraSalida) : "en termo"}</td>
              <td className={CELDA}>{fmtTiempo(x.Minutos)}</td>
              <td className={CELDA}>{x.ConteoInicial ?? "—"} → {x.ConteoFinal ?? "—"}</td>
              <td className={CELDA}>{x.NombreQuimico || "—"}</td>
              <td className={CELDA} title={`${x.Clase} ${x.DescripcionClase ?? ""}`}>{corteDe(x)}</td>
              <td className={`${CELDA} text-right`}>{fmtNum(x.KgSinTratar)}</td>
              <td className={`${CELDA} text-right font-semibold`}>{x.KgTratadas != null ? fmtNum(x.KgTratadas) : "—"}</td>
              <td className={`${CELDA} text-right ${colorAlerta(x.Alerta)}`}>{pct(x.Pickup)}{x.Alerta ? " ⚠" : ""}</td>
              <td className={CELDA}>{x.NombreDestino || "—"}</td>
            </tr>
          ))}
          {hoja.Termos.length === 0 && <tr><td colSpan={COLUMNAS.length} className="py-3 text-center text-gray-400">Sin termos</td></tr>}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-800 font-bold">
            <td colSpan={8} className={`${CELDA} text-right uppercase text-[10px]`}>Totales</td>
            <td className={`${CELDA} text-right`}>{fmtNum(t.KgRecibidos)}</td>
            <td className={`${CELDA} text-right`}>{fmtNum(t.KgTratados)}</td>
            <td className={`${CELDA} text-right ${colorAlerta(t.Alerta)}`}>{pct(t.Pickup)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>

      <div className="grid grid-cols-2 gap-4 mb-3">
        <div>
          <h2 className="text-sm font-bold uppercase mb-1">Totales del turno</h2>
          {/* "En termo" solo aparece si hay termos adentro: ganados y pick-up son de lo que ya salió, y
              sin ese recuadro "recibidos" contra "tratados" se leía como pérdida. */}
          <div className="grid border border-gray-800 text-center" style={{ gridTemplateColumns: `repeat(${t.KgEnTermo > 0.001 ? 5 : 4}, minmax(0, 1fr))` }}>
            {[["Kg recibidos", fmtNum(t.KgRecibidos)], ...(t.KgEnTermo > 0.001 ? [["En termo", fmtNum(t.KgEnTermo)]] : []),
              ["Kg tratados", fmtNum(t.KgTratados)], ["Kg ganados", fmtNum(t.KgGanados)], ["% Pick-up", pct(t.Pickup)]].map(([e, v], i) => (
              <div key={e} className={`py-1.5 ${i ? "border-l border-gray-800" : ""}`}>
                <div className="text-[10px] uppercase text-gray-500">{e}</div>
                <div className={`font-mono font-bold ${e === "% Pick-up" ? colorAlerta(t.Alerta) : ""}`}>{v}</div>
              </div>
            ))}
          </div>
          {t.EnTermo > 0 && <p className="text-[10px] text-red-600 mt-1">{t.EnTermo} termo{t.EnTermo > 1 ? "s" : ""} todavía en termo ({fmtNum(t.KgEnTermo)} kg): no entran a ganados ni al pick-up.</p>}
        </div>
        <div>
          <h2 className="text-sm font-bold uppercase mb-1">Insumos — consumo</h2>
          {insumos.length ? (
            <div className="grid border border-gray-800 text-center" style={{ gridTemplateColumns: `repeat(${insumos.length}, minmax(0, 1fr))` }}>
              {insumos.map((i, k) => (
                <div key={i.Codigo} className={`py-1.5 ${k ? "border-l border-gray-800" : ""}`}>
                  <div className="text-[10px] uppercase text-gray-500">{i.Nombre} ({i.UM.toLowerCase()})</div>
                  <div className="font-mono font-bold">{fmtNum(i.Cantidad)}</div>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400 border border-dashed border-gray-300 py-2 text-center">Sin consumo registrado</p>}
        </div>
      </div>

      {diferencias.length > 0 && (
        <p className="text-[11px] mb-2">
          <span className="font-bold uppercase text-[10px]">Diferencias de báscula al cerrar:</span>{" "}
          {diferencias.map(l => `${l.Lote} ${l.Clase} ${l.DescripcionTalla ?? ""} ${fmtNum(l.KgDiferencia)} kg`).join(" · ")}
        </p>
      )}

      {hoja.Observaciones && <p className="text-sm mb-2"><span className="text-gray-500">Observaciones:</span> {hoja.Observaciones}</p>}

      <p className="text-[10px] text-gray-500 mb-6">
        % Pick-up = (kg tratadas − kg sin tratar) ÷ kg sin tratar × 100. ⚠ = alerta: pick-up negativo (salió pesando menos) o mayor a {pickupMaximo} %.
        El corte es el de la clase del producto.
      </p>

      {/* Las firmas y el pie no se separan: con 14 termos se iban solas a una segunda hoja. */}
      <div className="break-inside-avoid">
      <div className="grid grid-cols-2 gap-16">
        <div className="text-center">
          <p className="text-sm font-medium h-5">{hoja.NombreEncargado || ""}</p>
          <div className="border-t border-gray-800 pt-1 text-xs text-gray-600">Firma encargado</div>
        </div>
        <div className="text-center">
          <p className="text-sm font-medium h-5"></p>
          <div className="border-t border-gray-800 pt-1 text-xs text-gray-600">Revisado por</div>
        </div>
      </div>

      <p className="text-[10px] text-gray-400 mt-3">
        Impreso {new Date().toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" })}
        {hoja.CerradaEn ? ` · Cerrada por ${hoja.CerradaPor} el ${fmtDia(hoja.CerradaEn)} ${hora(hoja.CerradaEn)}` : ""}
      </p>
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
