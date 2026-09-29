import { useEffect } from "react";
import { createPortal } from "react-dom";
import { fmtNum } from "../utils/numero.js";

// La hoja de descongelado impresa — la versión en papel del formulario FR-7.13-13, ya con los
// números que el sistema calculó. Se imprime con el diálogo del navegador ("Guardar como PDF"), igual
// que HojaRemisionModal: es un documento de oficina, no una etiqueta.
//
// No pide nada al servidor: el detalle de la hoja que ya tiene la pantalla trae los renglones, el
// cuadre y los auxiliares. Imprimir lo mismo que se está viendo es lo que evita que el papel y la
// pantalla digan cosas distintas.

// Fechas puras (YYYY-MM-DD) partidas a mano: new Date() las lee como medianoche UTC y en Guatemala
// las muestra un día antes (ver utils/fecha.js).
function fmtDia(iso) {
  if (!iso) return "—";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}
const hora = (s) => (s ? String(s).slice(11, 16) : "—");
function fmtHoras(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
const destinoDe = (l) => l?.NombreAreaDeclarada || l?.NombreBodegaDestino || l?.BodegaDestino || "—";

export function ContenidoHoja({ hoja, filas }) {
  const aux = hoja.Auxiliares;
  const abierta = hoja.Estatus !== "Cerrada";
  const merma = abierta
    ? Number((hoja.KgEntrada - hoja.KgDescongelado - hoja.KgDevuelto).toFixed(2))
    : hoja.KgMerma;
  const masters = filas.reduce((s, f) => s + (f.entrada?.Masters || 0), 0);

  return (
    <div className="text-gray-900">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Descongelado de Materia Prima</h1>
          <p className="text-sm text-gray-500">FR-7.13-13 · Hoja de proceso</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-mono font-bold">Hoja #{hoja.HojaId}</p>
          <p className="text-sm text-gray-500">Jornada {fmtDia(hoja.FechaProduccion)}</p>
          {/* Una hoja abierta impresa es un borrador: los números todavía se mueven y la merma no
              está escrita. Que el papel lo diga evita archivar un cuadre que no es el final. */}
          {abierta && <p className="text-sm font-bold text-red-600 uppercase">Borrador — hoja abierta</p>}
        </div>
      </div>

      <div className="border-y-2 border-gray-800 py-2 mb-4 grid grid-cols-3 gap-x-6 gap-y-1 text-sm">
        <div><span className="text-gray-500">Encargado:</span> <b>{hoja.NombreEncargado || hoja.Encargado || "—"}</b></div>
        <div><span className="text-gray-500">Propiedad:</span> <b>{hoja.Propiedad}</b></div>
        <div><span className="text-gray-500">Horario:</span> <b>{hora(hoja.HoraInicio)} – {abierta ? "…" : hora(hoja.HoraFin)}</b></div>
        <div className="col-span-3">
          <span className="text-gray-500">Auxiliares:</span>{" "}
          <b>{aux ? aux.Personas : hoja.Personas ?? "—"}</b>
          {aux && <> · <b>{fmtHoras(aux.Minutos)}</b> en el área <span className="text-gray-500">(sin contar al encargado)</span></>}
        </div>
      </div>

      <div className="grid grid-cols-5 border border-gray-800 mb-4 text-center">
        {[
          ["Entrada declarada", `${fmtNum(hoja.KgEntrada)} kg`],
          ["Descongelado", `${fmtNum(hoja.KgDescongelado)} kg`],
          ["Devuelto a bodega", `${fmtNum(hoja.KgDevuelto)} kg`],
          [abierta ? "Merma al cerrar" : "Merma", `${fmtNum(merma)} kg`],
          ["Rendimiento", hoja.Rendimiento != null ? `${fmtNum(hoja.Rendimiento)} %` : "—"],
        ].map(([t, v], i) => (
          <div key={t} className={`py-1.5 ${i ? "border-l border-gray-800" : ""}`}>
            <div className="text-[10px] uppercase text-gray-500">{t}</div>
            <div className="font-mono font-bold">{v}</div>
          </div>
        ))}
      </div>

      <h2 className="text-sm font-bold uppercase mb-1">Descongelado</h2>
      <table className="w-full text-[11px] print-table mb-4">
        <thead>
          <tr className="text-left uppercase border-b-2 border-gray-800 text-[10px] text-gray-600">
            <th className="py-1 pr-2">Lote</th>
            <th className="py-1 pr-2">Producto</th>
            <th className="py-1 pr-2">Talla</th>
            <th className="py-1 pr-2">Remisión</th>
            <th className="py-1 pr-2 text-right">Masters</th>
            <th className="py-1 pr-2 text-right">Declarado</th>
            <th className="py-1 pr-2 text-right">Pesado</th>
            <th className="py-1 pr-2 text-right">Dif.</th>
            <th className="py-1 pr-2">Enviado a</th>
            <th className="py-1">Termo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {filas.map(({ clave, entrada, salida, ref }) => {
            const dif = entrada && salida ? Number((entrada.PesoKg - salida.PesoKg).toFixed(2)) : null;
            return (
              <tr key={clave}>
                <td className="py-1 pr-2 font-mono whitespace-nowrap">{ref.Lote}</td>
                <td className="py-1 pr-2">{ref.Clase} {ref.DescripcionClase}</td>
                <td className="py-1 pr-2 whitespace-nowrap">{ref.DescripcionTalla}</td>
                <td className="py-1 pr-2 font-mono">{ref.FolioRemision || "—"}</td>
                <td className="py-1 pr-2 text-right">{entrada?.Masters ?? "—"}</td>
                <td className="py-1 pr-2 text-right">{entrada ? fmtNum(entrada.PesoKg) : "—"}</td>
                <td className="py-1 pr-2 text-right font-semibold">{salida ? fmtNum(salida.PesoKg) : "sin despachar"}</td>
                <td className="py-1 pr-2 text-right">{dif ? fmtNum(dif) : "—"}</td>
                <td className="py-1 pr-2">{salida ? destinoDe(salida) : "—"}</td>
                <td className="py-1 font-mono">{salida?.NumeroTermo || "—"}</td>
              </tr>
            );
          })}
          {filas.length === 0 && (
            <tr><td colSpan={10} className="py-3 text-center text-gray-400">Sin renglones</td></tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-800 font-bold">
            <td colSpan={4} className="py-1 pr-2 text-right uppercase text-[10px]">Totales</td>
            <td className="py-1 pr-2 text-right">{masters || "—"}</td>
            <td className="py-1 pr-2 text-right">{fmtNum(hoja.KgEntrada)}</td>
            <td className="py-1 pr-2 text-right">{fmtNum(hoja.KgDescongelado)}</td>
            <td className="py-1 pr-2 text-right">{fmtNum(Number((hoja.KgEntrada - hoja.KgDescongelado - hoja.KgDevuelto).toFixed(2)))}</td>
            <td colSpan={2}></td>
          </tr>
        </tfoot>
      </table>

      {hoja.devoluciones?.length > 0 && (
        <>
          <h2 className="text-sm font-bold uppercase mb-1">Devoluciones a bodega (sin descongelar)</h2>
          <table className="w-full text-[11px] print-table mb-4">
            <thead>
              <tr className="text-left uppercase border-b-2 border-gray-800 text-[10px] text-gray-600">
                <th className="py-1 pr-2">Lote</th>
                <th className="py-1 pr-2">Producto</th>
                <th className="py-1 pr-2">Talla</th>
                <th className="py-1 pr-2">Remisión</th>
                <th className="py-1 pr-2 text-right">Masters</th>
                <th className="py-1 pr-2 text-right">Kg</th>
                <th className="py-1">Motivo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {hoja.devoluciones.map(d => (
                <tr key={d.MovimientoId}>
                  <td className="py-1 pr-2 font-mono whitespace-nowrap">{d.Lote}</td>
                  <td className="py-1 pr-2">{d.Clase} {d.DescripcionClase}</td>
                  <td className="py-1 pr-2 whitespace-nowrap">{d.DescripcionTalla}</td>
                  <td className="py-1 pr-2 font-mono">{d.FolioRemision || "—"}</td>
                  <td className="py-1 pr-2 text-right">{d.Masters ?? "—"}</td>
                  <td className="py-1 pr-2 text-right">{fmtNum(d.PesoKg)}</td>
                  <td className="py-1">{d.Motivo || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {aux?.lista?.length > 0 && (
        <>
          <h2 className="text-sm font-bold uppercase mb-1">
            Auxiliares del turno <span className="font-normal normal-case text-gray-500">
              · de {hora(aux.Desde)} a {hora(aux.Hasta)}</span>
          </h2>
          <table className="w-full text-[11px] print-table mb-4">
            <thead>
              <tr className="text-left uppercase border-b-2 border-gray-800 text-[10px] text-gray-600">
                <th className="py-1 pr-2">Nombre</th>
                <th className="py-1 pr-2">Código</th>
                <th className="py-1 pr-2">En el área</th>
                <th className="py-1 text-right">Horas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {aux.lista.map(a => (
                <tr key={a.Codigo}>
                  <td className="py-1 pr-2">{a.Nombre}</td>
                  <td className="py-1 pr-2 font-mono">{a.Codigo}</td>
                  <td className="py-1 pr-2">{a.Desde}–{a.Hasta}</td>
                  <td className="py-1 text-right">{fmtHoras(a.Minutos)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-800 font-bold">
                <td colSpan={3} className="py-1 pr-2 text-right uppercase text-[10px]">Total</td>
                <td className="py-1 text-right">{fmtHoras(aux.Minutos)}</td>
              </tr>
            </tfoot>
          </table>
        </>
      )}

      {hoja.Observaciones && (
        <p className="text-sm mb-4"><span className="text-gray-500">Observaciones:</span> {hoja.Observaciones}</p>
      )}

      {/* El papel trae impresa la regla, y se conserva: la diferencia se anota, no se ajusta. */}
      <p className="text-[11px] text-gray-500 mb-10">La diferencia se anota, no se ajusta: la merma es lo que entró menos lo descongelado y lo devuelto.</p>

      <div className="grid grid-cols-2 gap-16">
        <div className="text-center">
          <p className="text-sm font-medium h-5">{hoja.NombreEncargado || ""}</p>
          <div className="border-t border-gray-800 pt-1 text-xs text-gray-600">Encargado del área</div>
        </div>
        <div className="text-center">
          <p className="text-sm font-medium h-5"></p>
          <div className="border-t border-gray-800 pt-1 text-xs text-gray-600">Revisado por</div>
        </div>
      </div>

      <p className="text-[10px] text-gray-400 mt-6">
        Impreso {new Date().toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" })}
        {hoja.CerradaEn ? ` · Cerrada por ${hoja.CerradaPor} el ${fmtDia(hoja.CerradaEn)} ${hora(hoja.CerradaEn)}` : ""}
      </p>
    </div>
  );
}

export default function HojaDescongeladoModal({ hoja, filas, onCerrar }) {
  // El nombre del PDF lo pone el navegador a partir del título de la página: sin esto, cada hoja
  // guardada se llamaría igual que el sistema y habría que renombrarlas a mano.
  useEffect(() => {
    const antes = document.title;
    document.title = `Hoja descongelado ${hoja.HojaId} - ${fmtDia(hoja.FechaProduccion).replaceAll("/", "-")}`;
    return () => { document.title = antes; };
  }, [hoja.HojaId, hoja.FechaProduccion]);

  return (
    <>
      {/* Vista previa — SOLO pantalla. index.css oculta #root al imprimir; lo que se imprime va en el
          portal de abajo, igual que HojaRemisionModal. */}
      <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 p-4 print:hidden"
        onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-full min-w-0 flex flex-col">
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
            <ContenidoHoja hoja={hoja} filas={filas} />
          </div>
        </div>
      </div>

      {createPortal(
        <div className="hidden print:block">
          <style>{"@media print { @page { size: letter; margin: 1.2cm; } }"}</style>
          <ContenidoHoja hoja={hoja} filas={filas} />
        </div>,
        document.getElementById("print-root")
      )}
    </>
  );
}
