import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { authHeader } from "../context/AuthContext.jsx";
import { fmtNum } from "../utils/numero.js";

// Reporte de la JORNADA del área — no de una hoja. La hoja es un turno; esto es el día completo,
// en el orden en que se mueve el producto: lo que se recibió, lo que se descongeló, lo que se
// devolvió y lo que queda al piso.
//
// El cuadre va arriba y a la vista (al piso al iniciar + recibido − bajado = queda al piso), porque
// es la pregunta que el reporte existe para contestar: ¿se sabe dónde está todo lo que entró?
//
// Se imprime con el diálogo del navegador ("Guardar como PDF"), igual que la hoja.

function fmtDia(iso) {
  if (!iso) return "—";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}
const hora = (s) => (s ? String(s).slice(11, 16) : "—");
const kg = (n) => (n == null ? "—" : fmtNum(n));

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

export function ContenidoReporte({ r }) {
  const T = r.Totales;
  const producto = (x) => `${x.Clase} ${x.DescripcionClase}`;

  return (
    <div className="text-gray-900 text-[11px]">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h1 className="text-2xl font-bold">{r.NombreBodega} — reporte de la jornada</h1>
          <p className="text-sm text-gray-500">Recibido, descongelado, devuelto y al piso</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold">{fmtDia(r.Fecha)}</p>
          <p className="text-xs text-gray-500">
            {r.hojas.length} hoja{r.hojas.length !== 1 ? "s" : ""}
            {r.hojas.some(h => h.Estatus !== "Cerrada") && <b className="text-red-600"> · con hojas abiertas</b>}
          </p>
        </div>
      </div>

      {/* Las hojas del día: quién, a qué hora y cuánto. Con dos turnos es lo que los separa. */}
      {r.hojas.length > 0 && (
        <table className="w-full border-y-2 border-gray-800 mb-3">
          <thead><tr className="text-left">
            <th className={TH}>Hoja</th><th className={TH}>Encargado</th><th className={TH}>Horario</th>
            <th className={`${TH} text-right`}>Auxiliares</th><th className={`${TH} text-right`}>Descongelado</th>
            <th className={`${TH} text-right`}>Rend.</th><th className={TH}>Estatus</th>
          </tr></thead>
          <tbody>
            {r.hojas.map(h => (
              <tr key={h.HojaId}>
                <td className={`${TD} font-mono`}>#{h.HojaId}</td>
                <td className={TD}>{h.NombreEncargado || h.Encargado || "—"}</td>
                <td className={TD}>{hora(h.HoraInicio)}–{h.Estatus === "Cerrada" ? hora(h.HoraFin) : "…"}</td>
                <td className={`${TD} text-right`}>{h.Personas ?? "—"}</td>
                <td className={`${TD} text-right`}>{kg(h.KgDescongelado)} kg</td>
                <td className={`${TD} text-right`}>{h.Rendimiento != null ? `${fmtNum(h.Rendimiento)} %` : "—"}</td>
                <td className={TD}>{h.Estatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* El cuadre del día, en una línea que se lee de izquierda a derecha. */}
      <div className="grid grid-cols-6 border border-gray-800 text-center mb-1">
        {[
          ["Al piso al iniciar", T.InicioKg, T.InicioMasters],
          ["+ Recibido", T.RecibidoKg, T.RecibidoMasters],
          ["− Descongelado", T.DescongeladoDeclaradoKg, T.DescongeladoMasters],
          ["− Devuelto a bodega", T.DevueltoKg, T.DevueltoMasters],
          ["= Queda al piso", T.AlPisoKg, T.AlPisoMasters],
          ["Rendimiento", null, null],
        ].map(([t, v, m], i) => (
          <div key={t} className={`py-1.5 ${i ? "border-l border-gray-800" : ""}`}>
            <div className="text-[10px] uppercase text-gray-500">{t}</div>
            {t === "Rendimiento"
              ? <div className="font-mono font-bold text-sm">{T.Rendimiento != null ? `${fmtNum(T.Rendimiento)} %` : "—"}</div>
              : <>
                  <div className="font-mono font-bold text-sm">{kg(v)} kg</div>
                  <div className="text-[10px] text-gray-500">{m} masters</div>
                </>}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-500 mb-2">
        Descongelado en kilos declarados, que es lo que salió del piso. Pesado en báscula:{" "}
        <b>{kg(T.DescongeladoPesadoKg)} kg</b>. Rendimiento = pesado ÷ declarado, solo de lo descongelado
        (lo devuelto no entra). Merma anotada en las hojas: <b>{kg(T.MermaKg)} kg</b>.
      </p>

      {/* 1 · RECIBIDO */}
      <Titulo n={1} extra={`${T.RecibidoMasters} masters · ${kg(T.RecibidoKg)} kg`}>Recibido de bodega u otro origen</Titulo>
      <table className="w-full print-table">
        <thead><tr className="text-left border-b-2 border-gray-800">
          <th className={TH}>Origen</th><th className={TH}>Lote</th><th className={TH}>Producto</th>
          <th className={TH}>Talla</th><th className={`${TH} text-right`}>Masters</th><th className={`${TH} text-right`}>Kg</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-200">
          {r.recibido.map(x => (
            <tr key={x.MovimientoId}>
              <td className={TD}>{x.Origen}</td>
              <td className={`${TD} font-mono whitespace-nowrap`}>{x.Lote}</td>
              <td className={TD}>{producto(x)}</td>
              <td className={`${TD} whitespace-nowrap`}>{x.DescripcionTalla}</td>
              <td className={`${TD} text-right`}>{x.Masters ?? "—"}</td>
              <td className={`${TD} text-right`}>{kg(x.PesoKg)}</td>
            </tr>
          ))}
          {r.recibido.length === 0 && <tr><td colSpan={6} className="py-2 text-center text-gray-400">Nada recibido en la jornada</td></tr>}
        </tbody>
      </table>

      {/* 2 · DESCONGELADO */}
      <Titulo n={2} extra={`${T.DescongeladoMasters} masters · declarado ${kg(T.DescongeladoDeclaradoKg)} kg · pesado ${kg(T.DescongeladoPesadoKg)} kg`}>Descongelado</Titulo>
      <table className="w-full print-table">
        <thead><tr className="text-left border-b-2 border-gray-800">
          <th className={TH}>Hoja</th><th className={TH}>Lote</th><th className={TH}>Producto</th><th className={TH}>Talla</th>
          <th className={TH}>Remisión</th><th className={`${TH} text-right`}>Masters</th>
          <th className={`${TH} text-right`}>Declarado</th><th className={`${TH} text-right`}>Pesado</th>
          <th className={`${TH} text-right`}>Dif.</th><th className={TH}>Enviado a</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-200">
          {r.descongelado.map(x => {
            const dif = x.Declarado != null ? Number((x.Declarado - x.Pesado).toFixed(2)) : null;
            return (
              <tr key={x.MovimientoId}>
                <td className={`${TD} font-mono`}>#{x.HojaId}</td>
                <td className={`${TD} font-mono whitespace-nowrap`}>{x.Lote}</td>
                <td className={TD}>{producto(x)}</td>
                <td className={`${TD} whitespace-nowrap`}>{x.DescripcionTalla}</td>
                <td className={`${TD} font-mono`}>{x.FolioRemision || "—"}</td>
                <td className={`${TD} text-right`}>{x.Masters ?? "—"}</td>
                <td className={`${TD} text-right`}>{kg(x.Declarado)}</td>
                <td className={`${TD} text-right font-semibold`}>{kg(x.Pesado)}</td>
                <td className={`${TD} text-right`}>{dif ? fmtNum(dif) : "—"}</td>
                <td className={TD}>{x.Destino}</td>
              </tr>
            );
          })}
          {r.descongelado.length === 0 && <tr><td colSpan={10} className="py-2 text-center text-gray-400">Nada descongelado en la jornada</td></tr>}
        </tbody>
      </table>
      {r.porDestino.length > 1 && (
        <table className="mt-1 ml-auto">
          <tbody>
            {r.porDestino.map(d => (
              <tr key={d.Destino}>
                <td className="pr-3 text-gray-500">→ {d.Destino}</td>
                <td className="pr-3 text-right">{d.Masters} masters</td>
                <td className="text-right font-semibold">{kg(d.Pesado)} kg</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* 3 · DEVUELTO */}
      <Titulo n={3} extra={`${T.DevueltoMasters} masters · ${kg(T.DevueltoKg)} kg`}>Devuelto a bodega sin descongelar</Titulo>
      <table className="w-full print-table">
        <thead><tr className="text-left border-b-2 border-gray-800">
          <th className={TH}>Hoja</th><th className={TH}>Lote</th><th className={TH}>Producto</th><th className={TH}>Talla</th>
          <th className={TH}>Remisión</th><th className={`${TH} text-right`}>Masters</th>
          <th className={`${TH} text-right`}>Kg</th><th className={TH}>Motivo</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-200">
          {r.devuelto.map(x => (
            <tr key={x.MovimientoId}>
              <td className={`${TD} font-mono`}>#{x.HojaId}</td>
              <td className={`${TD} font-mono whitespace-nowrap`}>{x.Lote}</td>
              <td className={TD}>{producto(x)}</td>
              <td className={`${TD} whitespace-nowrap`}>{x.DescripcionTalla}</td>
              <td className={`${TD} font-mono`}>{x.FolioRemision || "—"}</td>
              <td className={`${TD} text-right`}>{x.Masters ?? "—"}</td>
              <td className={`${TD} text-right`}>{kg(x.Pesado)}</td>
              <td className={TD}>{x.Motivo || "—"}</td>
            </tr>
          ))}
          {r.devuelto.length === 0 && <tr><td colSpan={8} className="py-2 text-center text-gray-400">Nada devuelto en la jornada</td></tr>}
        </tbody>
      </table>

      {/* 4 · AL PISO */}
      <Titulo n={4} extra={`${T.AlPisoMasters} masters · ${kg(T.AlPisoKg)} kg al cierre de la jornada`}>Queda al piso</Titulo>
      <table className="w-full print-table">
        <thead><tr className="text-left border-b-2 border-gray-800">
          <th className={TH}>Remisión</th><th className={TH}>Lote</th><th className={TH}>Producto</th><th className={TH}>Talla</th>
          <th className={TH}>Entró</th><th className={`${TH} text-right`}>Días</th>
          <th className={`${TH} text-right`}>Masters</th><th className={`${TH} text-right`}>Kg</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-200">
          {r.alPiso.map((x, i) => (
            <tr key={`${x.RemisionId}|${x.Lote}|${x.Clase}|${x.Talla}|${i}`}>
              <td className={`${TD} font-mono`}>{x.FolioRemision || "Ajuste"}</td>
              <td className={`${TD} font-mono whitespace-nowrap`}>{x.Lote}</td>
              <td className={TD}>{producto(x)}</td>
              <td className={`${TD} whitespace-nowrap`}>{x.DescripcionTalla}</td>
              <td className={TD}>{fmtDia(x.FechaIngreso)}</td>
              <td className={`${TD} text-right ${x.DiasAlPiso > 2 ? "font-bold" : ""}`}>{x.DiasAlPiso ?? "—"}</td>
              <td className={`${TD} text-right`}>{x.Masters ?? "—"}</td>
              <td className={`${TD} text-right`}>{kg(x.Kg)}</td>
            </tr>
          ))}
          {r.alPiso.length === 0 && <tr><td colSpan={8} className="py-2 text-center text-gray-400">Nada al piso</td></tr>}
        </tbody>
      </table>

      <div className="grid grid-cols-2 gap-16 mt-12">
        <div className="text-center"><div className="border-t border-gray-800 pt-1 text-xs text-gray-600">Elaborado por</div></div>
        <div className="text-center"><div className="border-t border-gray-800 pt-1 text-xs text-gray-600">Revisado por</div></div>
      </div>
      <p className="text-[10px] text-gray-400 mt-4">
        Impreso {new Date().toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" })}
      </p>
    </div>
  );
}

export default function ReporteDescongeladoModal({ fecha, bodega = "DESCONGELADO", onCerrar }) {
  const [r, setR] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/descongelado/reporte?bodega=${bodega}&fecha=${fecha}`, { headers: authHeader() })
      .then(async res => { const d = await res.json(); if (!res.ok) throw new Error(d.error || `Error ${res.status}`); return d; })
      .then(setR).catch(e => setError(e.message));
  }, [fecha, bodega]);

  // El navegador toma el nombre del PDF del título de la página.
  useEffect(() => {
    const antes = document.title;
    document.title = `Reporte descongelado ${fmtDia(fecha).replaceAll("/", "-")}`;
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
