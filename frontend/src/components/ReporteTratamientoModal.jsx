import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { authHeader } from "../context/AuthContext.jsx";
import { fmtNum } from "../utils/numero.js";

// Reporte de la JORNADA de Tratamiento —  no de una hoja. Cada hoja es un cliente previsto; esto es el
// día completo: las hojas, el cuadre del piso, lo tratado por lote, por cliente y por destino, y el
// consumo de insumos. Las alertas se ven en el pick-up de cada fila; el detalle por termo está en la
// hoja impresa de cada turno.
//
// El cuadre va arriba (al piso al iniciar + recibido − tomado por los termos − diferencias = queda al
// piso) porque es la pregunta que el reporte existe para contestar: ¿se sabe dónde está todo lo que
// entró? Se imprime con el diálogo del navegador ("Guardar como PDF"), igual que la hoja.

function fmtDia(iso) {
  if (!iso) return "—";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}
const hora = (s) => (s ? String(s).slice(11, 16) : "—");
const kg = (n) => (n == null ? "—" : fmtNum(n));
const pct = (p) => (p == null ? "—" : `${p > 0 ? "+" : ""}${fmtNum(p, 1)} %`);
const colorAlerta = (a) => (a === "PERDIDA" ? "text-red-700 font-bold" : a === "EXCEDE" ? "text-amber-700 font-bold" : "");

function Titulo({ n, children, extra }) {
  return (
    <h2 className="text-sm font-bold uppercase mt-5 mb-1 flex items-baseline gap-2">
      <span>{n}. {children}</span>
      {extra && <span className="font-normal normal-case text-gray-500 text-xs">{extra}</span>}
    </h2>
  );
}

const TH = "py-1 pr-2 text-[10px] uppercase text-gray-600";
const TD = "py-0.5 pr-2";
const R = "text-right";

// Las columnas de kilos y pick-up se repiten en las tablas de hojas, por lote y por cliente.
// "En termo" va aparte porque ganados y pick-up son solo de lo que ya salió: sin esa columna,
// "recibidos 1,053 · tratadas 995 · ganados +98" se leía como pérdida (lo que faltaba seguía en el termo).
const enTermo = (v) => (v > 0.001 ? kg(v) : "—");
const THK = `${TH} ${R} whitespace-nowrap`;
const ThKilos = () => (<>
  <th className={THK}>Termos</th><th className={THK}>Kg sin tratar</th><th className={THK}>En termo</th>
  <th className={THK}>Kg tratadas</th><th className={THK}>Kg ganados</th><th className={THK}>% Pick-up</th>
</>);
const TdKilos = ({ g }) => (<>
  <td className={`${TD} ${R} whitespace-nowrap`}>{g.Termos}{g.Alertas ? <span className="text-red-700"> ({g.Alertas} ⚠)</span> : ""}</td>
  <td className={`${TD} ${R}`}>{kg(g.KgSinTratar)}</td><td className={`${TD} ${R} ${g.KgEnTermo > 0.001 ? "text-blue-700" : "text-gray-400"}`}>{enTermo(g.KgEnTermo)}</td>
  <td className={`${TD} ${R} font-semibold`}>{kg(g.KgTratadas)}</td>
  <td className={`${TD} ${R}`}>{kg(g.KgGanados)}</td><td className={`${TD} ${R} whitespace-nowrap ${colorAlerta(g.Alerta)}`}>{pct(g.Pickup)}</td>
</>);

// Los totales de una hoja (o del día) con los mismos nombres que un agrupado por lote o cliente.
const kilosDe = (t) => ({ Termos: t.Termos, Alertas: t.Alertas, KgSinTratar: t.KgRecibidos, KgEnTermo: t.KgEnTermo,
                          KgTratadas: t.KgTratados, KgGanados: t.KgGanados, Pickup: t.Pickup, Alerta: t.Alerta });

export function ContenidoReporte({ r }) {
  const T = r.Totales, C = r.Cuadre;
  const abiertas = r.Hojas.some(h => h.Estatus !== "Cerrada");
  const cuadra = Math.abs(C.InicioKg + C.RecibidoKg - C.TomadoTermosKg - C.DiferenciasKg - C.OtrasSalidasKg - C.AlPisoKg) < 0.02;

  return (
    <div className="text-gray-900 text-[11px]">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h1 className="text-2xl font-bold">Tratamiento — reporte de la jornada</h1>
          <p className="text-sm text-gray-500">Hojas, cuadre del piso, pick-up e insumos</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold">{fmtDia(r.Fecha)}</p>
          <p className="text-xs text-gray-500">
            {r.Hojas.length} hoja{r.Hojas.length !== 1 ? "s" : ""}
            {abiertas && <b className="text-red-600"> · con hojas abiertas</b>}
          </p>
        </div>
      </div>

      {/* Las hojas: una por cliente previsto. */}
      <table className="w-full border-y-2 border-gray-800 mb-3">
        <thead><tr className="text-left">
          <th className={TH}>Hoja</th><th className={TH}>Cliente previsto</th><th className={TH}>Encargado</th><th className={`${TH} whitespace-nowrap`}>Horario</th>
          <ThKilos /><th className={TH}>Estatus</th>
        </tr></thead>
        <tbody>
          {r.Hojas.map(h => (
            <tr key={h.HojaId}>
              <td className={`${TD} font-mono`}>#{h.HojaId}</td>
              <td className={TD}>{h.NombreCliente || "—"}</td>
              <td className={TD}>{h.NombreEncargado || h.Encargado || "—"}</td>
              <td className={`${TD} whitespace-nowrap`}>{hora(h.HoraInicio)}–{h.Estatus === "Cerrada" ? hora(h.HoraFin) : "…"}</td>
              <TdKilos g={kilosDe(h.Totales)} />
              <td className={TD}>{h.Estatus}</td>
            </tr>
          ))}
          {r.Hojas.length === 0 && <tr><td colSpan={11} className="py-2 text-center text-gray-400">Sin hojas en la jornada</td></tr>}
        </tbody>
        {r.Hojas.length > 1 && (
          <tfoot><tr className="border-t border-gray-800 font-bold">
            <td colSpan={4} className={`${TD} ${R} uppercase text-[10px]`}>Total del día</td>
            <TdKilos g={kilosDe(T)} /><td></td>
          </tr></tfoot>
        )}
      </table>
      {T.KgEnTermo > 0.001 && (
        <p className="text-[10px] text-gray-500 -mt-2 mb-2">
          Kg ganados y pick-up son de lo que ya salió del termo: (kg sin tratar − en termo) → kg tratadas.
        </p>
      )}

      {/* El cuadre del piso, de izquierda a derecha. */}
      <div className="grid grid-cols-5 border border-gray-800 text-center mb-1">
        {[["Al piso al iniciar", C.InicioKg], ["+ Recibido", C.RecibidoKg], ["− Tomado por los termos", C.TomadoTermosKg],
          ["− Diferencias de báscula", C.DiferenciasKg], ["= Queda al piso", C.AlPisoKg]].map(([t, v], i) => (
          <div key={t} className={`py-1.5 ${i ? "border-l border-gray-800" : ""}`}>
            <div className="text-[10px] uppercase text-gray-500">{t}</div>
            <div className="font-mono font-bold text-sm">{kg(v)} kg</div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-500 mb-2">
        Kilos del inventario al piso de Tratamiento. Lo tratado ya salió a su destino con {kg(T.KgTratados)} kg ({pct(T.Pickup)} de pick-up).
        {C.OtrasSalidasKg > 0 && <b className="text-red-700"> Otras salidas del piso: {kg(C.OtrasSalidasKg)} kg.</b>}
        {!cuadra && <b className="text-red-700"> El cuadre no cierra: revise los movimientos del día.</b>}
      </p>

      {/* 1 · RECIBIDO */}
      <Titulo n={1} extra={`${kg(C.RecibidoKg)} kg`}>Recibido al piso en la jornada</Titulo>
      <table className="w-full print-table">
        <thead><tr className="text-left border-b-2 border-gray-800">
          <th className={TH}>Origen</th><th className={TH}>Lote</th><th className={TH}>Producto</th>
          <th className={TH}>Talla</th><th className={TH}>Prod.</th><th className={`${TH} ${R}`}>Kg</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-200">
          {r.Recibido.map(x => (
            <tr key={x.MovimientoId}>
              <td className={TD}>{x.Origen}{x.TransaccionId ? ` · trans. ${x.TransaccionId}` : ""}{x.NumeroTermo ? ` · termo ${x.NumeroTermo}` : ""}</td>
              <td className={`${TD} font-mono whitespace-nowrap`}>{x.Lote}</td>
              <td className={TD}>{x.Clase} {x.DescripcionClase}</td>
              <td className={`${TD} whitespace-nowrap`}>{x.DescripcionTalla}</td>
              <td className={TD}>{fmtDia(x.FechaLote)}</td>
              <td className={`${TD} ${R}`}>{kg(x.PesoKg)}</td>
            </tr>
          ))}
          {r.Recibido.length === 0 && <tr><td colSpan={6} className="py-2 text-center text-gray-400">Nada recibido en la jornada</td></tr>}
        </tbody>
      </table>

      {/* 2 · POR LOTE */}
      <Titulo n={2} extra="cada lote conserva su código, clase y talla">Tratado por lote</Titulo>
      <table className="w-full print-table">
        <thead><tr className="text-left border-b-2 border-gray-800">
          <th className={TH}>Lote</th><th className={TH}>Producto / corte</th><th className={TH}>Talla</th><ThKilos />
        </tr></thead>
        <tbody className="divide-y divide-gray-200">
          {r.PorLote.map(g => (
            <tr key={`${g.Lote}|${g.Clase}|${g.Talla}`}>
              <td className={`${TD} font-mono whitespace-nowrap`}>{g.Lote}</td>
              <td className={TD}>{g.Clase} {g.DescripcionClase}</td>
              <td className={`${TD} whitespace-nowrap`}>{g.DescripcionTalla}</td>
              <TdKilos g={g} />
            </tr>
          ))}
          {r.PorLote.length === 0 && <tr><td colSpan={9} className="py-2 text-center text-gray-400">Nada tratado en la jornada</td></tr>}
        </tbody>
      </table>

      {/* 3 · POR CLIENTE — a lo ancho: en media hoja, con más de cinco clientes los nombres y el pick-up
          se partían en dos renglones. */}
      <Titulo n={3} extra="referencia: Empaque puede cambiar el destino">Por cliente previsto</Titulo>
      <table className="w-full print-table">
        <thead><tr className="text-left border-b-2 border-gray-800"><th className={TH}>Cliente</th><ThKilos /></tr></thead>
        <tbody className="divide-y divide-gray-200">
          {r.PorCliente.map(g => <tr key={g.Cliente}><td className={TD}>{g.Cliente}</td><TdKilos g={g} /></tr>)}
          {r.PorCliente.length === 0 && <tr><td colSpan={7} className="py-2 text-center text-gray-400">Sin termos en la jornada</td></tr>}
        </tbody>
      </table>

      {/* 4 · POR DESTINO */}
      <Titulo n={4}>Lo tratado salió a</Titulo>
      <table className="w-full print-table">
        <thead><tr className="text-left border-b-2 border-gray-800">
          <th className={TH}>Destino</th><th className={`${TH} ${R}`}>Termos</th><th className={`${TH} ${R}`}>Kg tratadas</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-200">
          {r.PorDestino.map(d => (
            <tr key={d.Destino}><td className={TD}>{d.Destino}</td><td className={`${TD} ${R}`}>{d.Termos}</td><td className={`${TD} ${R} font-semibold`}>{kg(d.Kg)}</td></tr>
          ))}
          {r.PorDestino.length === 0 && <tr><td colSpan={3} className="py-2 text-center text-gray-400">Nada salió todavía</td></tr>}
        </tbody>
      </table>

      {/* 5 · INSUMOS */}
      <Titulo n={5} extra="suma de las hojas">Insumos consumidos</Titulo>
      <table className="w-full print-table">
        <thead><tr className="text-left border-b-2 border-gray-800">
          <th className={TH}>Insumo</th><th className={`${TH} ${R}`}>Consumo</th><th className={`${TH} ${R}`}>Por 100 kg tratados</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-200">
          {r.Insumos.map(i => (
            <tr key={i.Codigo}>
              <td className={TD}>{i.Nombre}</td>
              <td className={`${TD} ${R}`}>{kg(i.Cantidad)} {i.UM.toLowerCase()}</td>
              <td className={`${TD} ${R}`}>{i.Por100Kg != null ? `${fmtNum(i.Por100Kg)} ${i.UM.toLowerCase()}` : "—"}</td>
            </tr>
          ))}
          {r.Insumos.length === 0 && <tr><td colSpan={3} className="py-2 text-center text-gray-400">Sin consumo registrado</td></tr>}
        </tbody>
      </table>

      {/* 6 · AL PISO */}
      <Titulo n={6} extra={`${kg(C.AlPisoKg)} kg al cierre de la jornada`}>Queda al piso</Titulo>
      <table className="w-full print-table">
        <thead><tr className="text-left border-b-2 border-gray-800">
          <th className={TH}>Lote</th><th className={TH}>Producto</th><th className={TH}>Talla</th>
          <th className={TH}>Entró</th><th className={`${TH} ${R}`}>Días</th><th className={`${TH} ${R}`}>Kg</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-200">
          {r.AlPiso.map((x, i) => (
            <tr key={`${x.Lote}|${x.Clase}|${x.Talla}|${i}`}>
              <td className={`${TD} font-mono whitespace-nowrap`}>{x.Lote}</td>
              <td className={TD}>{x.Clase} {x.DescripcionClase}</td>
              <td className={`${TD} whitespace-nowrap`}>{x.DescripcionTalla}</td>
              <td className={TD}>{fmtDia(x.FechaIngreso)}</td>
              <td className={`${TD} ${R} ${x.DiasAlPiso > 2 ? "font-bold" : ""}`}>{x.DiasAlPiso ?? "—"}</td>
              <td className={`${TD} ${R}`}>{kg(x.Kg)}</td>
            </tr>
          ))}
          {r.AlPiso.length === 0 && <tr><td colSpan={6} className="py-2 text-center text-gray-400">Nada al piso</td></tr>}
        </tbody>
      </table>

      <div className="grid grid-cols-2 gap-16 mt-12">
        <div className="text-center"><div className="border-t border-gray-800 pt-1 text-xs text-gray-600">Elaborado por</div></div>
        <div className="text-center"><div className="border-t border-gray-800 pt-1 text-xs text-gray-600">Revisado por</div></div>
      </div>
      <p className="text-[10px] text-gray-400 mt-4">
        % Pick-up = (kg tratadas − kg sin tratar) ÷ kg sin tratar × 100, de los termos que ya salieron.
        Impreso {new Date().toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" })}
      </p>
    </div>
  );
}

export default function ReporteTratamientoModal({ fecha, onCerrar }) {
  const [r, setR] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/tratamiento/reporte?fecha=${fecha}`, { headers: authHeader() })
      .then(async res => { const d = await res.json(); if (!res.ok) throw new Error(d.error || `Error ${res.status}`); return d; })
      .then(setR).catch(e => setError(e.message));
  }, [fecha]);

  useEffect(() => {
    const antes = document.title;
    document.title = `Reporte tratamiento ${fmtDia(fecha).replaceAll("/", "-")}`;
    return () => { document.title = antes; };
  }, [fecha]);

  return (
    <>
      <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 p-4 print:hidden"
        onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-full min-w-0 flex flex-col">
          <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
            <h2 className="text-base font-semibold text-gray-800">Reporte de la jornada {fmtDia(fecha)} — vista previa</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => window.print()} disabled={!r}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50">
                Imprimir / PDF
              </button>
              <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-2 text-xl leading-none transition">&times;</button>
            </div>
          </div>
          <div className="px-8 py-6 overflow-auto">
            {error ? <p className="text-sm text-red-600">{error}</p>
              : !r ? <p className="text-sm text-gray-400">Armando el reporte…</p>
              : <ContenidoReporte r={r} />}
          </div>
        </div>
      </div>

      {r && createPortal(
        <div className="hidden print:block">
          <style>{"@media print { @page { size: letter; margin: 1.2cm; } }"}</style>
          <ContenidoReporte r={r} />
        </div>,
        document.getElementById("print-root")
      )}
    </>
  );
}
