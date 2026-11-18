import { fmtNum } from "../utils/numero.js";
// Hoja de Lote (Destajo → Reporte → Reporte x Lote), igual en pantalla y en el PDF (`compacto`).
//
// Colores con significado, los mismos en toda la hoja:
//   marea  #0E3A53  títulos y bordes          coral  #D9573B  lo pelado (producto)
//   laguna #0F7C74  rendimiento y ritmo       hielo  #EEF6F9  fondos de encabezado
//   ámbar  #B7791F  bajado al piso            rojo   #B4232A  descarte
// La pieza central es el cuadre: la cadena Ingresada − Bajado = Trabajada → Pelado → Rendimiento.
// printColorAdjust: sin eso el navegador quita los fondos al imprimir.

const C = {
  marea: "#0E3A53", coral: "#D9573B", laguna: "#0F7C74", hielo: "#EEF6F9",
  ambar: "#B7791F", rojo: "#B4232A", gris: "#94A3B8",
};
const IMPRIMIR_COLOR = { WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" };
const fechaCorta = (f) => (f ? f.split("-").reverse().join("/") : "");

function Kg({ v, c }) {
  return (
    <>
      <span className="tabular-nums">{fmtNum(v)}</span>
      <span className={`${c ? "text-[9px]" : "text-xs"} font-normal text-slate-400 ml-1`}>kg</span>
    </>
  );
}

function Etiqueta({ children, c, color = "text-slate-500" }) {
  return <div className={`${c ? "text-[8.5px]" : "text-[10.5px]"} font-semibold uppercase tracking-[0.08em] ${color}`}>{children}</div>;
}

function TituloSeccion({ children, extra, c }) {
  return (
    <div className={`flex items-baseline gap-2 ${c ? "mb-1" : "mb-1.5"}`}>
      <span className="inline-block w-1 self-stretch rounded-sm" style={{ background: C.marea }} />
      <h4 className={`${c ? "text-[11px]" : "text-sm"} font-bold uppercase tracking-wide`} style={{ color: C.marea }}>{children}</h4>
      {extra && <span className={`${c ? "text-[9px]" : "text-xs"} text-slate-500`}>{extra}</span>}
    </div>
  );
}

// ── Encabezado ──────────────────────────────────────────────────────────────────────────────────
function Dato({ titulo, children, c, ancho = false }) {
  return (
    <div className={`${ancho ? "col-span-2" : ""} ${c ? "px-2.5 py-1" : "px-3 py-1.5"}`}>
      <Etiqueta c={c}>{titulo}</Etiqueta>
      <div className={`${c ? "text-[11px]" : "text-sm"} font-semibold text-slate-900`}>{children}</div>
    </div>
  );
}

// "2026-11-18 06:42" → "06:42"; si la hora cae en otro día que el del lote, lleva la fecha corta
// delante ("19/11 00:15") para que no se lea como del mismo día.
function hora(fh, fechaLote) {
  if (!fh) return null;
  const [f, h] = fh.split(" ");
  return f === fechaLote ? h : `${f.slice(8, 10)}/${f.slice(5, 7)} ${h}`;
}

function Encabezado({ l, d, c }) {
  const fechaLote = l.Fecha?.slice(0, 10);
  const inicio = hora(l.Horario?.Inicio, fechaLote);
  // Quien no marcó salida no frena la hora final: va la última salida que sí se marcó.
  const fin = hora(l.Horario?.Fin, fechaLote);
  const sinSalida = l.Horario?.SinSalida ?? 0;
  return (
    <div className={`rounded-md overflow-hidden border ${c ? "mb-3" : "mb-5"}`} style={{ borderColor: C.marea }}>
      <div className={`flex items-center justify-between ${c ? "px-3 py-1.5" : "px-4 py-2.5"}`} style={{ background: C.marea }}>
        <h3 className={`${c ? "text-sm" : "text-lg"} font-bold uppercase tracking-wide text-white`}>
          Hoja de Lote <span className="font-mono tracking-normal">{l.Lote}</span>
          <span className="font-normal text-sky-200"> — {l.EsEntero ? "Descabezado" : "Pelado"}</span>
        </h3>
        <span className={`${c ? "text-[11px]" : "text-sm"} font-semibold text-sky-100 tabular-nums`}>{fechaCorta(l.Fecha?.slice(0, 10))}</span>
      </div>
      <div className="grid grid-cols-2 divide-x divide-y divide-white" style={{ background: C.hielo }}>
        <Dato c={c} titulo="Encargado de turno">{d.Encargado || "—"}</Dato>
        <Dato c={c} titulo="Registró el pesaje">{l.RegistradoPor || "—"}</Dato>
        <Dato c={c} titulo="Hora de inicio">
          <span className="tabular-nums">{inicio ?? "—"}</span>
          {inicio && <span className="font-normal text-slate-500"> · primera entrada al área</span>}
        </Dato>
        <Dato c={c} titulo="Hora final">
          <span className="tabular-nums">{fin ?? "—"}</span>
          {fin && <span className="font-normal text-slate-500"> · última salida del área</span>}
          {/* Solo en pantalla: la hoja impresa lleva la hora sin el aviso. */}
          {!c && sinSalida > 0 && (
            <span className="font-normal" style={{ color: C.ambar }}> · {sinSalida} sin marcar salida</span>
          )}
        </Dato>
        <Dato c={c} ancho titulo="Personal del turno">
          {d.Personas} {d.EsEntero ? "descabezando" : "peladoras"} en el lote
          <span className="font-normal text-slate-500"> · {d.Soportes} soportes · {d.Chequeadores} chequeadores · {d.QC} QC</span>
        </Dato>
      </div>
    </div>
  );
}

// ── Cuadre del lote (la pieza central) ──────────────────────────────────────────────────────────
function Eslabon({ titulo, children, color, fondo, c, op }) {
  return (
    <>
      {op && <span className={`${c ? "text-sm px-0.5" : "text-lg px-1"} font-bold text-slate-400 self-center`}>{op}</span>}
      <div className={`flex-1 rounded-md border ${c ? "px-2 py-1" : "px-3 py-2"}`}
        style={{ borderColor: color, background: fondo ?? "white", borderTopWidth: 3 }}>
        <Etiqueta c={c}>{titulo}</Etiqueta>
        <div className={`${c ? "text-[13px]" : "text-lg"} font-bold`} style={{ color }}>{children}</div>
      </div>
    </>
  );
}

function Cuadre({ l, totalSalida, c }) {
  const ingreso = Number(l.PesoIngreso) || 0;
  const bajado = Number(l.Bajado) || 0;
  const descarte = Number(l.Descarte) || 0;
  // En un entero el descarte también sale de la base (rendimientosEntero en lib/destajoPiso.ts).
  const trabajada = ingreso - bajado - (l.EsEntero ? descarte : 0);
  const rend = l.SinCola ? null : l.Rendimiento;

  // En un entero lo que sale es cola (y lo pesado, cabeza).
  const salida = l.EsEntero ? (Number(l.Cola) || 0) : totalSalida;
  const cabeza = l.EsEntero ? totalSalida : 0;

  return (
    <div>
      <TituloSeccion c={c}>Cuadre del lote</TituloSeccion>
      <div className="flex items-stretch gap-1">
        <Eslabon c={c} titulo="MP ingresada" color={C.marea}><Kg c={c} v={ingreso} /></Eslabon>
        <Eslabon c={c} op="−" titulo="Bajado al piso" color={C.ambar}><Kg c={c} v={bajado} /></Eslabon>
        <Eslabon c={c} op="=" titulo="MP trabajada" color={C.marea} fondo={C.hielo}><Kg c={c} v={trabajada} /></Eslabon>
        <Eslabon c={c} op="→" titulo={l.EsEntero ? "Total cola" : "Total pelado"} color={C.coral}><Kg c={c} v={salida} /></Eslabon>
        <span className={c ? "w-1.5" : "w-3"} />
        <Eslabon c={c} titulo={l.EsEntero ? "Rend. cola" : "Rendimiento"} color={C.laguna} fondo="#E6F4F2">
          {rend == null ? "sin cola" : <span className="tabular-nums">{fmtNum(rend, 1)}<span className={c ? "text-[10px]" : "text-sm"}> %</span></span>}
          <div className={`${c ? "text-[8px]" : "text-[10px]"} font-normal leading-tight whitespace-nowrap text-slate-500`}>{l.EsEntero ? "cola" : "pelado"} ÷ MP trabajada</div>
        </Eslabon>
      </div>

      {l.EsEntero && (
        <div className={`flex gap-4 ${c ? "mt-1 text-[10px]" : "mt-2 text-xs"} text-slate-600`}>
          <span>Total cabeza <b className="text-slate-900"><Kg c={c} v={cabeza} /></b></span>
          <span>Cabeza + cola <b className="text-slate-900"><Kg c={c} v={l.Total} /></b></span>
          <span>Rendimiento total <b style={{ color: C.laguna }}>{fmtNum(l.RendimientoTotal, 1)} %</b></span>
          {descarte > 0 && <span>Descarte <b style={{ color: C.rojo }}><Kg c={c} v={descarte} /></b></span>}
        </div>
      )}
    </div>
  );
}

// ── Materia prima recibida (lo tomado del piso para este lote) ─────────────────────────────────
// Lote y talla de ORIGEN: un lote unificado junta varios, y cada uno se ve aquí. Un lote capturado a
// mano no tiene renglones: solo su peso de ingreso.
function Recibido({ l, c }) {
  const filas = l.Recibido ?? [];
  const th = `${c ? "py-1 px-1.5 text-[9px]" : "py-1.5 px-2 text-[11px]"} font-semibold uppercase tracking-wide`;
  const td = c ? "py-0.5 px-1.5" : "py-1 px-2";
  const total = filas.reduce((s, r) => s + r.Kg, 0);
  return (
    <div>
      <TituloSeccion c={c} extra={filas.length ? "tomada del piso para este lote" : "capturada a mano en Materia Prima"}>
        Materia prima recibida
      </TituloSeccion>
      {filas.length === 0 ? (
        <p className={c ? "text-[11px]" : "text-sm"}>Ingreso <b><Kg c={c} v={l.PesoIngreso} /></b></p>
      ) : (
        <table className={`print-table w-full border-collapse ${c ? "text-[10.5px]" : "text-sm"}`}>
          <thead>
            <tr style={{ background: C.hielo, color: C.marea }}>
              <th className={`${th} text-left`}>Lote</th><th className={`${th} text-left`}>Talla</th>
              <th className={`${th} text-left`}>Clase / materia prima</th><th className={`${th} text-left`}>Enviado por</th>
              <th className={`${th} text-right`}>Termos</th><th className={`${th} text-right`}>Kilos</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((r, i) => (
              <tr key={i} className="border-b border-slate-100" style={i % 2 ? { background: "#FAFCFD" } : undefined}>
                <td className={`${td} font-mono font-semibold`} style={{ color: C.marea }}>{r.LoteOrigen}</td>
                <td className={td}>{r.DescripcionTalla}</td>
                <td className={`${td} text-slate-700`}>{r.Clase} {r.DescripcionClase}</td>
                <td className={`${td} text-slate-700`}>{r.EnviadoPor ?? "—"}</td>
                <td className={`${td} text-right tabular-nums`}>{r.Termos}</td>
                <td className={`${td} text-right tabular-nums`}>{fmtNum(r.Kg)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold" style={{ borderTop: `2px solid ${C.marea}` }}>
              <td colSpan={5} className={`${td} text-right uppercase ${c ? "text-[9px]" : "text-[11px]"} text-slate-500`}>Total recibido</td>
              <td className={`${td} text-right`} style={{ color: C.marea }}><Kg c={c} v={total} /></td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}

// ── Termos ──────────────────────────────────────────────────────────────────────────────────────
function Termos({ termos, total, esEntero, c }) {
  const th = `${c ? "py-1 px-1.5 text-[9px]" : "py-1.5 px-2 text-[11px]"} font-semibold uppercase tracking-wide`;
  const td = c ? "py-0.5 px-1.5" : "py-1 px-2";
  // En el PDF, con muchos termos la tabla va en dos columnas: es la que más crece y la que empujaba
  // la hoja a una segunda página.
  const columnas = c && termos.length > 8 ? [termos.slice(0, Math.ceil(termos.length / 2)), termos.slice(Math.ceil(termos.length / 2))] : [termos];
  const tabla = (lista, k) => (
    <table key={k} className={`print-table w-full border-collapse self-start ${c ? "text-[10.5px]" : "text-sm"}`}>
      <thead>
        <tr style={{ background: C.hielo, color: C.marea }}>
          <th className={`${th} text-left`}>Termo</th><th className={`${th} text-left`}>Talla</th>
          <th className={`${th} text-left`}>Producto</th><th className={`${th} text-right`}>Kilos</th>
        </tr>
      </thead>
      <tbody>
        {lista.map((t, i) => (
          <tr key={t.TermoId} className="border-b border-slate-100" style={i % 2 ? { background: "#FAFCFD" } : undefined}>
            <td className={`${td} font-mono font-semibold`} style={{ color: C.marea }}>{t.NumeroTermo}</td>
            <td className={td}>{t.DescripcionTalla}</td>
            <td className={`${td} text-slate-700`}>{t.DescripcionProceso}</td>
            <td className={`${td} text-right tabular-nums`}>{fmtNum(t.Procesado)}</td>
          </tr>
        ))}
        {lista.length === 0 && (
          <tr><td colSpan={4} className="py-4 text-center text-slate-400">Sin termos registrados para este lote</td></tr>
        )}
      </tbody>
    </table>
  );
  return (
    <div>
      <TituloSeccion c={c} extra={`${termos.length} termo${termos.length !== 1 ? "s" : ""}`}>
        {esEntero ? "Cabeza pesada por termo" : "Pelado por termo"}
      </TituloSeccion>
      <div className={columnas.length > 1 ? "grid grid-cols-2 gap-4" : ""}>{columnas.map(tabla)}</div>
      <div className={`flex justify-end gap-6 font-bold ${td}`} style={{ borderTop: `2px solid ${C.marea}` }}>
        <span className={`uppercase ${c ? "text-[9px]" : "text-[11px]"} text-slate-500 self-center`}>Total</span>
        <span className={c ? "text-[10.5px]" : "text-sm"} style={{ color: C.coral }}><Kg c={c} v={total} /></span>
      </div>
    </div>
  );
}

// ── Ritmo por producto y talla ──────────────────────────────────────────────────────────────────
function Ritmo({ d, c }) {
  const lbh = v => (v == null ? "—" : fmtNum(v, 1));
  const th = `${c ? "py-1 px-1.5 text-[9px]" : "py-1.5 px-2 text-[11px]"} font-semibold uppercase tracking-wide`;
  const td = c ? "py-0.5 px-1.5" : "py-1 px-2";
  return (
    <div>
      <div className="flex items-end justify-between">
        <TituloSeccion c={c} extra="lb pesadas ÷ horas de quienes pesaron">Ritmo por producto y talla</TituloSeccion>
        <div className={`rounded-md ${c ? "px-2 py-0.5 mb-1" : "px-3 py-1 mb-1.5"} text-white`} style={{ background: C.laguna }}>
          <span className={`${c ? "text-[9px]" : "text-[11px]"} uppercase tracking-wide opacity-90`}>Lote </span>
          <b className={`${c ? "text-sm" : "text-lg"} tabular-nums`}>{lbh(d.Ritmo.LbHora)}</b>
          <span className={`${c ? "text-[9px]" : "text-xs"} opacity-90`}> lb/hr</span>
        </div>
      </div>
      {d.Ritmo.grupos.length > 0 ? (
        <table className={`print-table w-full border-collapse ${c ? "text-[10.5px]" : "text-sm"}`}>
          <thead>
            <tr style={{ background: "#E6F4F2", color: C.laguna }}>
              <th className={`${th} text-left`}>Producto</th><th className={`${th} text-left`}>Talla</th>
              <th className={`${th} text-right`}>Lb</th><th className={`${th} text-right`}>Horas</th>
              <th className={`${th} text-right`}>Personas</th><th className={`${th} text-right`}>Lb/hr</th>
            </tr>
          </thead>
          <tbody>
            {d.Ritmo.grupos.map(g => (
              <tr key={`${g.Producto}|${g.Talla}`} className="border-b border-slate-100">
                <td className={td}>{g.Producto}</td><td className={td}>{g.DescripcionTalla}</td>
                <td className={`${td} text-right tabular-nums`}>{fmtNum(g.Lb, 1)}</td>
                <td className={`${td} text-right tabular-nums text-slate-600`}>{fmtNum(g.Horas, 1)}</td>
                <td className={`${td} text-right tabular-nums text-slate-600`}>{g.Personas}</td>
                <td className={`${td} text-right tabular-nums font-bold`} style={{ color: C.laguna }}>{lbh(g.LbHora)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className={`${c ? "text-[10px]" : "text-xs"} text-slate-400`}>Sin pesadas con tiempo medible en este lote.</p>
      )}
      {d.Ritmo.LbSinTiempo > 0.05 && (
        <p className={`${c ? "text-[9px]" : "text-[11px]"} text-slate-500 mt-1`}>
          {fmtNum(d.Ritmo.LbSinTiempo, 1)} lb sin tiempo medible (falta marcaje de área) no entran en el ritmo.
        </p>
      )}
    </div>
  );
}

// ── Bajado al piso, descarte y cola, renglón por renglón ───────────────────────────────────────
const TIPO = {
  BAJADO:   { nombre: "Bajado al piso", color: C.ambar, fondo: "#FBF3E4" },
  DESCARTE: { nombre: "Descarte",       color: C.rojo,  fondo: "#FBEAEA" },
  COLA:     { nombre: "Cola",           color: C.laguna, fondo: "#E6F4F2" },
};

function Ajustes({ l, c }) {
  const ajustes = l.Ajustes ?? [];
  const hayCola = ajustes.some(a => a.Tipo === "COLA");
  const tam = c ? "text-[10.5px]" : "text-sm";
  return (
    <div>
      <TituloSeccion c={c}>{hayCola ? "Cola, bajado al piso y descarte" : "Bajado al piso y descarte"}</TituloSeccion>
      <div className={`rounded-md border border-slate-200 ${c ? "px-2 py-1 min-h-[2.5rem]" : "px-3 py-2 min-h-[3.5rem]"}`}>
        {ajustes.length === 0 ? (
          <p className={`${tam} text-slate-400`}>Sin bajados ni descartes</p>
        ) : ajustes.map((a, i) => {
          const t = TIPO[a.Tipo] ?? TIPO.BAJADO;
          return (
            <div key={i} className={`${tam} flex items-center justify-between gap-3 ${c ? "py-0.5" : "py-1"} ${i ? "border-t border-slate-100" : ""}`}>
              <span className="truncate">
                <span className={`inline-block rounded px-1.5 ${c ? "text-[9px]" : "text-[11px]"} font-bold mr-1.5`}
                  style={{ color: t.color, background: t.fondo }}>{t.nombre}</span>
                {a.Tipo === "COLA"
                  ? `termo ${a.NumeroTermo} · ${a.DescripcionClaseCola || a.ClaseCola} · ${a.NombreDestino ? `→ ${a.NombreDestino}` : "por trasladar"}`
                  : [a.NumeroTermo && `termo ${a.NumeroTermo}`, a.Motivo].filter(Boolean).join(" · ")}
                {a.Talla !== 900 ? ` · ${a.DescripcionTalla}` : ""}
              </span>
              <span className="tabular-nums whitespace-nowrap font-semibold" style={{ color: t.color }}>
                {fmtNum(a.Peso)} <span className="text-[9px] font-normal text-slate-400">{String(a.UM || "kg").toLowerCase()}</span>
              </span>
            </div>
          );
        })}
        {l.Notas && (
          <p className={`${c ? "text-[9.5px]" : "text-xs"} text-slate-500 italic whitespace-pre-wrap mt-1`}>Nota anterior: {l.Notas}</p>
        )}
      </div>
    </div>
  );
}

/**
 * Una hoja de lote.
 * l: el lote de porLote · termos: sus termos de pesaje · d: turnoDeLote(l) · compacto: versión PDF
 * aviso: texto opcional (solo pantalla) cuando los termos no cuadran con lo procesado.
 */
export default function HojaLote({ l, termos, d, compacto = false, aviso = null }) {
  const c = compacto;
  const total = termos.reduce((s, t) => s + t.Procesado, 0);
  // Cada sección separada por una línea: lo que entró, lo que se pesó, el cuadre de los dos, el ritmo
  // y lo que salió sin trabajarse.
  // break-inside-avoid: al imprimir, una sección que no cabe pasa entera a la hoja siguiente (antes el
  // título de "Bajado al piso" se quedaba solo al pie de la primera).
  const Seccion = `break-inside-avoid ${c ? "pt-2 pb-2" : "pt-4 pb-4"}`;
  return (
    <div className="text-slate-800" style={IMPRIMIR_COLOR}>
      <Encabezado l={l} d={d} c={c} />
      <div className="divide-y-2 divide-slate-300">
        <div className={`${Seccion} !pt-0`}><Recibido l={l} c={c} /></div>
        <div className={Seccion}><Termos termos={termos} total={total} esEntero={l.EsEntero} c={c} /></div>
        <div className={Seccion}>
          <Cuadre l={l} totalSalida={total} c={c} />
          {aviso && <p className="text-xs mt-2" style={{ color: C.ambar }}>● {aviso}</p>}
        </div>
        <div className={Seccion}><Ritmo d={d} c={c} /></div>
        <div className={`${Seccion} !pb-0`}><Ajustes l={l} c={c} /></div>
      </div>
    </div>
  );
}
