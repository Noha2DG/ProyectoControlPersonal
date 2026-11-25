import { useEffect } from "react";
import { createPortal } from "react-dom";
import { fmtNum } from "../utils/numero.js";
import { LB_POR_KG } from "../utils/destajo.js";
import { C, IMPRIMIR_COLOR, Kg, Dato, Eslabon, TituloSeccion } from "./HojaLote.jsx";

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

// Un renglón despachado, visto desde donde SALIÓ. Unificado, el renglón dice el lote y la clase
// escogidos; el lote, la clase, la remisión y la talla de verdad vienen de su consumo
// (LoteOrigen y compañía, que el servidor manda solo para lo despachado). UnificadoEn es el lote al
// que pasó, si cambió.
export function origenDe(m) {
  if (m.LoteOrigen == null) {
    return { Lote: m.Lote, Clase: m.Clase, DescripcionClase: m.DescripcionClase, Folio: m.FolioRemision,
             Talla: m.DescripcionTalla, UnificadoEn: null };
  }
  return { Lote: m.LoteOrigen, Clase: m.ClaseOrigen, DescripcionClase: m.DescripcionClaseOrigen, Folio: m.FolioOrigen,
           Talla: m.DescripcionTallaOrigen, UnificadoEn: m.LoteOrigen !== m.Lote ? m.Lote : null };
}

// Mismo diseño que la Hoja de Lote de Pelado (usuario, 25 nov 2026): encabezado azul marea, cuadre en
// eslabones y tablas con cabecera hielo. Las piezas vienen de HojaLote.jsx para no tener dos estilos.
// compacto: versión del papel (letras más chicas), igual que HojaLote.
export function ContenidoHoja({ hoja, filas, compacto = false }) {
  const c = compacto;
  const aux = hoja.Auxiliares;
  const abierta = hoja.Estatus !== "Cerrada";
  const merma = abierta
    ? Number((hoja.KgEntrada - hoja.KgDescongelado - hoja.KgDevuelto).toFixed(2))
    : hoja.KgMerma;
  // En el papel va como DIFERENCIA = lo descongelado (más lo devuelto) − lo declarado (usuario,
  // 11 nov 2026): positiva si se pesó de más, negativa si se perdió. Es la merma con el signo al revés;
  // lo guardado (KgMerma) no cambia.
  const diferencia = merma === 0 ? 0 : -merma;
  const masters = filas.reduce((s, f) => s + (f.entrada?.Masters || 0), 0);
  // Libras por persona = libras descongeladas ÷ auxiliares, SIN el encargado (usuario, 25 nov 2026).
  const personas = aux ? aux.Personas : hoja.Personas;
  const lbTotal = (Number(hoja.KgDescongelado) || 0) * LB_POR_KG;
  const lbPersona = personas > 0 ? lbTotal / personas : null;

  const th = `${c ? "py-1 px-1.5 text-[9px]" : "py-1.5 px-2 text-[11px]"} font-semibold uppercase tracking-wide whitespace-nowrap`;
  const td = c ? "py-0.5 px-1.5" : "py-1 px-2";
  const tabla = `print-table w-full border-collapse ${c ? "text-[10.5px]" : "text-sm"}`;
  const zebra = (i) => (i % 2 ? { background: "#FAFCFD" } : undefined);
  const Seccion = `break-inside-avoid ${c ? "pt-2 pb-2" : "pt-4 pb-4"}`;
  const nota = `${c ? "text-[8px]" : "text-[10px]"} font-normal leading-tight whitespace-nowrap text-slate-500`;
  const signo = (v) => {
    const n = Number(Number(v).toFixed(2));
    return n ? `${n > 0 ? "+" : ""}${fmtNum(n)}` : "—";
  };

  // Hoja cerrada: destino → lote (con su producto y talla), en el orden en que aparecen. Lo que no se
  // despachó (no debería quedar en una cerrada) va junto bajo "Sin despachar" para que no se pierda.
  const agrupado = [];
  if (!abierta) {
    const porDestino = new Map();
    for (const { entrada, salida, ref } of filas) {
      const destino = salida ? destinoDe(salida) : "Sin despachar";
      let g = porDestino.get(destino);
      if (!g) { g = { destino, masters: 0, declarado: 0, pesado: 0, lotes: [], idx: new Map() }; porDestino.set(destino, g); agrupado.push(g); }
      const o = origenDe(ref);
      const clave = `${o.Lote}|${o.UnificadoEn ?? ""}|${o.Clase}|${o.Talla}`;
      let r = g.idx.get(clave);
      if (!r) {
        r = { clave, Lote: o.Lote, UnificadoEn: o.UnificadoEn, Producto: `${o.Clase} ${o.DescripcionClase ?? ""}`.trim(), Talla: o.Talla, masters: 0, declarado: 0, pesado: 0 };
        g.idx.set(clave, r); g.lotes.push(r);
      }
      const m = entrada?.Masters || 0, d = Number(entrada?.PesoKg) || 0, p = Number(salida?.PesoKg) || 0;
      r.masters += m; r.declarado += d; r.pesado += p;
      g.masters += m; g.declarado += d; g.pesado += p;
    }
  }

  return (
    <div className="text-slate-800" style={IMPRIMIR_COLOR}>
      {/* ── Encabezado ── */}
      <div className={`rounded-md overflow-hidden border ${c ? "mb-3" : "mb-5"}`} style={{ borderColor: C.marea }}>
        <div className={`flex items-center justify-between ${c ? "px-3 py-1.5" : "px-4 py-2.5"}`} style={{ background: C.marea }}>
          <h3 className={`${c ? "text-sm" : "text-lg"} font-bold uppercase tracking-wide text-white`}>
            Hoja de Descongelado <span className="font-mono tracking-normal">#{hoja.HojaId}</span>
            <span className="font-normal text-sky-200"> — Materia Prima</span>
          </h3>
          <span className={`${c ? "text-[11px]" : "text-sm"} font-semibold text-sky-100 tabular-nums`}>
            {/* Una hoja abierta impresa es un borrador: los números todavía se mueven y la merma no
                está escrita. Que el papel lo diga evita archivar un cuadre que no es el final. */}
            {abierta && <span className="mr-2 rounded bg-red-600 px-1.5 py-0.5 text-white uppercase">Borrador — hoja abierta</span>}
            Jornada {fmtDia(hoja.FechaProduccion)}
          </span>
        </div>
        <div className="grid grid-cols-2 divide-x divide-y divide-white" style={{ background: C.hielo }}>
          <Dato c={c} titulo="Encargado de turno">{hoja.NombreEncargado || hoja.Encargado || "—"}</Dato>
          <Dato c={c} titulo="Propiedad">{hoja.Propiedad || "—"}</Dato>
          <Dato c={c} titulo="Hora de inicio"><span className="tabular-nums">{hora(hoja.HoraInicio)}</span></Dato>
          <Dato c={c} titulo="Hora final"><span className="tabular-nums">{abierta ? "…" : hora(hoja.HoraFin)}</span></Dato>
          <Dato c={c} ancho titulo="Personal del turno">
            {personas ?? "—"} auxiliares
            {aux && <span className="font-normal text-slate-500"> · {fmtHoras(aux.Minutos)} en el área · sin contar al encargado</span>}
          </Dato>
        </div>
      </div>

      <div className="divide-y-2 divide-slate-300">
        {/* ── Cuadre ── */}
        <div className={`${Seccion} !pt-0`}>
          <TituloSeccion c={c}>Cuadre de la hoja</TituloSeccion>
          <div className="flex items-stretch gap-1">
            <Eslabon c={c} titulo="Entrada declarada" color={C.marea}><Kg c={c} v={hoja.KgEntrada} /></Eslabon>
            <Eslabon c={c} op="→" titulo="Descongelado" color={C.coral}><Kg c={c} v={hoja.KgDescongelado} /></Eslabon>
            <Eslabon c={c} op="+" titulo="Devuelto a bodega" color={C.ambar}><Kg c={c} v={hoja.KgDevuelto} /></Eslabon>
            <Eslabon c={c} op="=" titulo={abierta ? "Diferencia al cerrar" : "Diferencia"} color={diferencia < 0 ? C.rojo : C.marea} fondo={C.hielo}>
              <span className="tabular-nums">{diferencia > 0 ? "+" : ""}{fmtNum(diferencia)}</span>
              <span className={`${c ? "text-[9px]" : "text-xs"} font-normal text-slate-400 ml-1`}>kg</span>
            </Eslabon>
          </div>
          {/* Los indicadores en su propia fila: con los seis en una, Lb por persona se salía del papel. */}
          <div className={`flex items-stretch gap-1 ${c ? "mt-1.5" : "mt-2"}`}>
            <Eslabon c={c} titulo="Rendimiento" color={C.laguna} fondo="#E6F4F2">
              {hoja.Rendimiento == null ? "—" : <span className="tabular-nums">{fmtNum(hoja.Rendimiento)}<span className={c ? "text-[10px]" : "text-sm"}> %</span></span>}
              <div className={nota}>descongelado ÷ declarado</div>
            </Eslabon>
            <Eslabon c={c} titulo="Lb por persona" color={C.laguna} fondo="#E6F4F2">
              {lbPersona == null ? "—" : <span className="tabular-nums">{fmtNum(lbPersona, 1)}<span className={c ? "text-[10px]" : "text-sm"}> lb</span></span>}
              <div className={nota}>{fmtNum(lbTotal, 1)} lb ÷ {personas ?? "—"} auxiliares</div>
            </Eslabon>
          </div>
        </div>

        {/* ── Descongelado ──
            Hoja abierta: termo por termo, que es como se va trabajando. Hoja cerrada: agrupado por a
            dónde se envió y por lote, sin el termo (usuario, 25 nov 2026): el papel archivado se lee
            por destino, y el termo ya no le dice nada a nadie una vez cerrada. */}
        <div className={Seccion}>
          <TituloSeccion c={c} extra={abierta ? `${masters} masters · por termo` : `${masters} masters · por destino y lote`}>Descongelado</TituloSeccion>
          <table className={tabla}>
            <thead>
              <tr style={{ background: C.hielo, color: C.marea }}>
                {abierta && <th className={`${th} text-left`}>Termo</th>}
                <th className={`${th} text-left`}>Lote</th>
                <th className={`${th} text-left`}>Producto</th>
                <th className={`${th} text-left`}>Talla</th>
                <th className={`${th} text-right`}>Masters</th>
                <th className={`${th} text-right`}>Declarado</th>
                <th className={`${th} text-right`}>Pesado</th>
                <th className={`${th} text-right`}>Dif.</th>
                {abierta && <th className={`${th} text-left`}>Enviado a</th>}
              </tr>
            </thead>
            {abierta ? (
              <tbody>
                {filas.map(({ clave, entrada, salida, ref }, i) => {
                  // Pesado − declarado: positivo si el termo pesó de más (mismo signo que la Diferencia de arriba).
                  const dif = entrada && salida ? Number((salida.PesoKg - entrada.PesoKg).toFixed(2)) : null;
                  const o = origenDe(ref);
                  return (
                    <tr key={clave} className="border-b border-slate-100" style={zebra(i)}>
                      <td className={`${td} font-mono font-semibold`} style={{ color: C.marea }}>{entrada?.NumeroTermo ?? ""}</td>
                      <td className={`${td} font-mono whitespace-nowrap`}>
                        {o.Lote}{o.UnificadoEn && <span className="text-slate-500"> → {o.UnificadoEn}</span>}
                      </td>
                      <td className={`${td} text-slate-700`}>{o.Clase} {o.DescripcionClase}</td>
                      <td className={`${td} whitespace-nowrap`}>{o.Talla}</td>
                      <td className={`${td} text-right tabular-nums`}>{entrada?.Masters ?? "—"}</td>
                      <td className={`${td} text-right tabular-nums`}>{entrada ? fmtNum(entrada.PesoKg) : "—"}</td>
                      <td className={`${td} text-right tabular-nums font-semibold`}>{salida ? fmtNum(salida.PesoKg) : "sin despachar"}</td>
                      <td className={`${td} text-right tabular-nums`} style={dif < 0 ? { color: C.rojo } : undefined}>{dif ? `${dif > 0 ? "+" : ""}${fmtNum(dif)}` : "—"}</td>
                      <td className={td}>{salida ? destinoDe(salida) : "—"}</td>
                    </tr>
                  );
                })}
                {filas.length === 0 && (
                  <tr><td colSpan={9} className="py-3 text-center text-slate-400">Sin renglones</td></tr>
                )}
              </tbody>
            ) : agrupado.map(g => (
              <tbody key={g.destino}>
                <tr style={{ background: "#F1F5F9" }}>
                  <td colSpan={7} className={`${td} font-bold uppercase tracking-wide ${c ? "text-[10px]" : "text-xs"}`} style={{ color: C.marea }}>
                    → {g.destino}
                  </td>
                </tr>
                {g.lotes.map((r, i) => (
                  <tr key={r.clave} className="border-b border-slate-100" style={zebra(i)}>
                    <td className={`${td} font-mono whitespace-nowrap ${c ? "pl-4" : "pl-6"}`}>
                      {r.Lote}{r.UnificadoEn && <span className="text-slate-500"> → {r.UnificadoEn}</span>}
                    </td>
                    <td className={`${td} text-slate-700`}>{r.Producto}</td>
                    <td className={`${td} whitespace-nowrap`}>{r.Talla}</td>
                    <td className={`${td} text-right tabular-nums`}>{r.masters}</td>
                    <td className={`${td} text-right tabular-nums`}>{fmtNum(r.declarado)}</td>
                    <td className={`${td} text-right tabular-nums font-semibold`}>{fmtNum(r.pesado)}</td>
                    <td className={`${td} text-right tabular-nums`} style={r.pesado - r.declarado < -0.005 ? { color: C.rojo } : undefined}>
                      {signo(r.pesado - r.declarado)}
                    </td>
                  </tr>
                ))}
                {/* El subtotal del destino va al final de sus lotes (usuario, 25 nov 2026). */}
                <tr className="font-bold" style={{ borderTop: `1px solid ${C.gris}` }}>
                  <td colSpan={3} className={`${td} text-right uppercase ${c ? "text-[9px]" : "text-[11px]"} text-slate-500`}>Subtotal {g.destino}</td>
                  <td className={`${td} text-right tabular-nums`}>{g.masters}</td>
                  <td className={`${td} text-right tabular-nums`}>{fmtNum(g.declarado)}</td>
                  <td className={`${td} text-right tabular-nums`} style={{ color: C.coral }}>{fmtNum(g.pesado)}</td>
                  <td className={`${td} text-right tabular-nums`}>{signo(g.pesado - g.declarado)}</td>
                </tr>
              </tbody>
            ))}
            {!abierta && filas.length === 0 && (
              <tbody><tr><td colSpan={7} className="py-3 text-center text-slate-400">Sin renglones</td></tr></tbody>
            )}
            <tfoot>
              <tr className="font-bold" style={{ borderTop: `2px solid ${C.marea}` }}>
                <td colSpan={abierta ? 4 : 3} className={`${td} text-right uppercase ${c ? "text-[9px]" : "text-[11px]"} text-slate-500`}>Totales</td>
                <td className={`${td} text-right tabular-nums`}>{masters || "—"}</td>
                <td className={`${td} text-right tabular-nums`}>{fmtNum(hoja.KgEntrada)}</td>
                <td className={`${td} text-right tabular-nums`} style={{ color: C.coral }}>{fmtNum(hoja.KgDescongelado)}</td>
                <td className={`${td} text-right tabular-nums`}>{signo(hoja.KgDescongelado + hoja.KgDevuelto - hoja.KgEntrada)}</td>
                {abierta && <td></td>}
              </tr>
            </tfoot>
          </table>
        </div>

        {hoja.devoluciones?.length > 0 && (
          <div className={Seccion}>
            <TituloSeccion c={c} extra="sin descongelar">Devoluciones a bodega</TituloSeccion>
            <table className={tabla}>
              <thead>
                <tr style={{ background: "#FBF3E4", color: C.ambar }}>
                  <th className={`${th} text-left`}>Lote</th>
                  <th className={`${th} text-left`}>Producto</th>
                  <th className={`${th} text-left`}>Talla</th>
                  <th className={`${th} text-left`}>Remisión</th>
                  <th className={`${th} text-right`}>Masters</th>
                  <th className={`${th} text-right`}>Kg</th>
                  <th className={`${th} text-left`}>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {hoja.devoluciones.map((d, i) => (
                  <tr key={d.MovimientoId} className="border-b border-slate-100" style={zebra(i)}>
                    <td className={`${td} font-mono whitespace-nowrap`}>{d.Lote}</td>
                    <td className={`${td} text-slate-700`}>{d.Clase} {d.DescripcionClase}</td>
                    <td className={`${td} whitespace-nowrap`}>{d.DescripcionTalla}</td>
                    <td className={`${td} font-mono`}>{d.FolioRemision || "—"}</td>
                    <td className={`${td} text-right tabular-nums`}>{d.Masters ?? "—"}</td>
                    <td className={`${td} text-right tabular-nums`}>{fmtNum(d.PesoKg)}</td>
                    <td className={td}>{d.Motivo || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* La lista de auxiliares con sus horas no va en el papel (usuario, 27 oct 2026): el
            encabezado ya dice cuántos fueron y cuánto tiempo estuvieron en el área. */}
        <div className={`${Seccion} !pb-0`}>
          {hoja.Observaciones && (
            <p className={`${c ? "text-[10.5px]" : "text-sm"} mb-2`}><span className="text-slate-500">Observaciones:</span> {hoja.Observaciones}</p>
          )}
          {/* El papel trae impresa la regla, y se conserva: la diferencia se anota, no se ajusta. */}
          <p className={`${c ? "text-[9.5px]" : "text-[11px]"} text-slate-500 mb-10`}>La diferencia se anota, no se ajusta: la diferencia es lo descongelado y lo devuelto menos lo que entró (positiva: se pesó de más; negativa: merma).</p>

          <div className="grid grid-cols-2 gap-16">
            <div className="text-center">
              <p className="text-sm font-medium h-5">{hoja.NombreEncargado || ""}</p>
              <div className="border-t border-slate-800 pt-1 text-xs text-slate-600">Encargado del área</div>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium h-5"></p>
              <div className="border-t border-slate-800 pt-1 text-xs text-slate-600">Revisado por</div>
            </div>
          </div>

          <p className="text-[10px] text-slate-400 mt-6">
            Impreso {new Date().toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" })}
            {hoja.CerradaEn ? ` · Cerrada por ${hoja.CerradaPor} el ${fmtDia(hoja.CerradaEn)} ${hora(hoja.CerradaEn)}` : ""}
          </p>
        </div>
      </div>
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
          <ContenidoHoja hoja={hoja} filas={filas} compacto />
        </div>,
        document.getElementById("print-root")
      )}
    </>
  );
}
