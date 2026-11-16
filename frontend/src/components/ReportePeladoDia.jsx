import { fmtNum } from "../utils/numero.js";

// Reporte del Día de Pelado (Destajo → Reporte → Reporte del Día). Los datos salen de
// GET /api/reportes/pelado-dia (backend/src/lib/reportePeladoDia.ts); el ritmo (Lb/hr por producto y
// talla) lo calcula ReporteProduccionPage con utils/destajo.js, igual que Lb/Hora y Por Talla.
// El mismo componente se pinta en pantalla y en la hoja impresa.

function fmtDia(iso) {
  if (!iso) return "—";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}
const kg = (n) => (n == null ? "—" : fmtNum(n));

const TH = "py-1 pr-2 text-[10px] uppercase text-gray-600 font-semibold text-left";
const TD = "py-0.5 pr-2";
const R = "text-right";
const TOTAL = "border-t border-gray-800 font-bold";

function Titulo({ n, children, extra }) {
  return (
    <h2 className="text-sm font-bold uppercase mt-5 mb-1 flex items-baseline gap-2">
      <span>{n ? `${n}. ` : ""}{children}</span>
      {extra && <span className="font-normal normal-case text-gray-500 text-xs">{extra}</span>}
    </h2>
  );
}

function Casilla({ titulo, valor, className = "", grande }) {
  return (
    <div className={`py-1.5 px-1 ${className}`}>
      <div className="text-[10px] uppercase text-gray-500">{titulo}</div>
      <div className={`font-mono font-bold ${grande ? "text-xl" : "text-sm"}`}>{valor}</div>
    </div>
  );
}

// Suma por una llave, en el orden en que aparecen.
function totalesPor(filas, llave) {
  const m = new Map();
  for (const f of filas) m.set(f[llave], (m.get(f[llave]) ?? 0) + f.Kg);
  return [...m.entries()];
}

export default function ReportePeladoDia({ r, ritmo }) {
  const C = r.Cuadre;
  const P = r.Personal;
  const porEnvia = totalesPor(r.Recibido, "Envia");
  const porDestino = totalesPor(r.Procesado, "Destino");

  return (
    <div className="text-gray-900 text-[11px]">
      {/* Encabezado */}
      <div className="grid grid-cols-5 border-y-2 border-gray-800 mb-3">
        <Casilla titulo="Fecha" valor={fmtDia(r.Fecha)} />
        <Casilla titulo="Hora inicio" valor={r.HoraInicio ?? "—"} className="border-l border-gray-300 pl-3" />
        <Casilla titulo="Hora fin" className="border-l border-gray-300 pl-3"
          valor={r.HoraFin ?? <span className="text-amber-700">En curso</span>} />
        <div className="py-1.5 border-l border-gray-300 pl-3 col-span-2">
          <div className="text-[10px] uppercase text-gray-500">Encargado</div>
          <div className="font-bold text-sm">{r.Encargado ?? "—"}</div>
        </div>
      </div>

      {/* Cuadre */}
      <Titulo>Cuadre del turno</Titulo>
      <div className="grid grid-cols-5 border border-gray-800 text-center">
        <Casilla titulo="Al piso al iniciar" valor={`${kg(C.InicioKg)} kg`} />
        <Casilla titulo="+ Recibido" valor={`${kg(C.RecibidoKg)} kg`} className="border-l border-gray-800" />
        <Casilla titulo="− Queda al piso" valor={`${kg(C.AlPisoKg)} kg`} className="border-l border-gray-800" />
        <Casilla titulo="= MP trabajada" valor={`${kg(C.MpTrabajadaKg)} kg`} className="border-l border-gray-800 bg-gray-100" />
        <Casilla titulo="Pelado (procesado)" valor={`${kg(C.PeladoKg)} kg`} className="border-l border-gray-800" />
      </div>
      <div className="grid grid-cols-2 border-x border-b border-gray-800 text-center">
        <div className="py-1.5 px-1 bg-emerald-50 text-emerald-800">
          <div className="text-[10px] uppercase text-gray-500">% Rendimiento (pelado ÷ MP trabajada, lotes terminados)</div>
          <div className="font-mono font-bold text-xl">{C.Rendimiento == null ? "—" : `${fmtNum(C.Rendimiento, 1)} %`}</div>
          <div className="text-[10px] text-gray-600">
            {C.LotesTerminados > 0
              ? `${C.LotesTerminados} lote${C.LotesTerminados !== 1 ? "s" : ""}: ${kg(C.PeladoTerminadoKg)} ÷ ${kg(C.MpTerminadaKg)} kg`
              : "Se calcula al cerrar los lotes"}
            {C.LotesEnMesas > 0 && (
              <span className="text-amber-700"> · {C.LotesEnMesas} en mesas ({kg(C.EnMesasMpKg)} kg MP, {kg(C.EnMesasPeladoKg)} kg pelado): no cuentan aún</span>
            )}
          </div>
        </div>
        <Casilla grande titulo="Ritmo del día (peladoras)" className="border-l border-gray-800"
          valor={ritmo.total.LbHora == null ? "—" : `${fmtNum(ritmo.total.LbHora, 1)} lb/hr`} />
      </div>
      {/* Solo informativo: no entra en el rendimiento ni en el cuadre. */}
      <div className="inline-flex items-baseline gap-2 mt-2 border border-dashed border-gray-400 rounded px-2 py-1 text-gray-600">
        <span className="text-[10px] uppercase">Cáscara (informativo)</span>
        <span className="font-mono font-semibold">{kg(C.CascaraKg)} kg</span>
        <span className="text-[10px] text-gray-500">= MP trabajada − pelado, incluye el descarte</span>
      </div>
      <p className="text-[10px] text-gray-500 mt-1">
        MP trabajada = tomado del piso ({kg(C.TomadoKg)} kg) − bajado de las mesas ({kg(C.BajadoKg)} kg).
        {(C.AjustesKg !== 0 || C.OtrasSalidasKg > 0) && <> Ajustes del piso {kg(C.AjustesKg)} kg; otras salidas {kg(C.OtrasSalidasKg)} kg.</>}
        {Math.abs(C.DiferenciaPisoKg) > 0.01 && (
          <b className="text-red-700"> El piso no cuadra por {kg(C.DiferenciaPisoKg)} kg: revise los movimientos del día.</b>
        )}
      </p>

      {/* Personal */}
      <Titulo extra="por el área donde marcaron en el día">Personal</Titulo>
      <table className="border border-gray-800 text-center w-[560px]">
        <thead><tr className="bg-gray-100">
          {["Peladoras", "Soportes", "Chequeadores", "QC", "Total"].map((t, i) => (
            <th key={t} className={`py-1 text-[10px] uppercase text-gray-600 w-1/5 ${i ? "border-l border-gray-800" : ""}`}>{t}</th>
          ))}
        </tr></thead>
        <tbody><tr className="font-mono font-bold text-lg">
          {[P.Peladoras, P.Soportes, P.Chequeadores, P.QC, P.Total].map((v, i) => (
            <td key={i} className={`py-1 ${i ? "border-l border-gray-800" : ""} ${i === 4 ? "bg-gray-50" : ""}`}>{v}</td>
          ))}
        </tr></tbody>
      </table>
      {r.SinSalida > 0 && r.HoraFin && (
        <p className="text-[10px] text-gray-500 mt-1">{r.SinSalida} peladora{r.SinSalida !== 1 ? "s" : ""} sin salida marcada ese día.</p>
      )}

      {/* 1. Recibido */}
      <Titulo n={1} extra="lo que entró al piso de Pelado desde las bodegas virtuales">Producto recibido</Titulo>
      <table className="w-full">
        <thead><tr className="border-b-2 border-gray-800">
          <th className={TH}>Lote</th><th className={TH}>Talla</th><th className={TH}>Clase / materia prima</th>
          <th className={TH}>Envía</th>
          <th className={`${TH} ${R}`}>Termos</th><th className={`${TH} ${R}`}>Kg MP</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-200">
          {r.Recibido.map(x => (
            <tr key={x.MovimientoId}>
              <td className={`${TD} font-mono whitespace-nowrap`}>{x.Lote}</td>
              <td className={`${TD} whitespace-nowrap`}>{x.DescripcionTalla}</td>
              <td className={TD}>{x.Clase} {x.DescripcionClase}</td>
              <td className={TD}>{x.Envia}</td>
              <td className={`${TD} ${R}`}>{x.Termos}</td>
              <td className={`${TD} ${R}`}>{kg(x.Kg)}</td>
            </tr>
          ))}
          {r.Recibido.length === 0 && <tr><td colSpan={6} className="py-2 text-center text-gray-400">Nada recibido en el día</td></tr>}
        </tbody>
        {r.Recibido.length > 0 && (
          <tfoot>
            {porEnvia.length > 1 && (
              <tr className="border-t border-gray-800">
                <td colSpan={5} className={`${TD} ${R} uppercase text-[10px] text-gray-600`}>
                  {porEnvia.map(([e, v]) => `${e} ${kg(v)}`).join(" · ")}
                </td><td />
              </tr>
            )}
            <tr className={porEnvia.length > 1 ? "font-bold" : TOTAL}>
              <td colSpan={5} className={`${TD} ${R} uppercase text-[10px]`}>Total recibido</td>
              <td className={`${TD} ${R}`}>{kg(C.RecibidoKg)}</td>
            </tr>
          </tfoot>
        )}
      </table>

      {/* 2. Procesado */}
      <Titulo n={2} extra="lo pelado en el día y a dónde se envió">Producto procesado</Titulo>
      <table className="w-full">
        <thead><tr className="border-b-2 border-gray-800">
          <th className={TH}>Lote</th><th className={TH}>Talla</th><th className={TH}>Clase / descripción</th>
          <th className={TH}>Enviado a</th><th className={`${TH} ${R}`}>Kg pelado</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-200">
          {r.Procesado.map((x, i) => (
            <tr key={i}>
              <td className={`${TD} font-mono whitespace-nowrap`}>{x.Lote}</td>
              <td className={`${TD} whitespace-nowrap`}>{x.DescripcionTalla}</td>
              <td className={TD}>{x.Clase} {x.DescripcionClase}</td>
              <td className={`${TD} ${x.Destino === "En proceso" ? "text-amber-700" : ""}`}>{x.Destino}</td>
              <td className={`${TD} ${R} font-semibold`}>{kg(x.Kg)}</td>
            </tr>
          ))}
          {r.Procesado.length === 0 && <tr><td colSpan={5} className="py-2 text-center text-gray-400">Nada pelado en el día</td></tr>}
        </tbody>
        {r.Procesado.length > 0 && (
          <tfoot>
            {porDestino.length > 1 && (
              <tr className="border-t border-gray-800">
                <td colSpan={4} className={`${TD} ${R} uppercase text-[10px] text-gray-600`}>
                  {porDestino.map(([d, v]) => `${d} ${kg(v)} kg`).join(" · ")}
                </td><td />
              </tr>
            )}
            <tr className={porDestino.length > 1 ? "font-bold" : TOTAL}>
              <td colSpan={4} className={`${TD} ${R} uppercase text-[10px]`}>Total pelado</td>
              <td className={`${TD} ${R}`}>{kg(C.PeladoKg)}</td>
            </tr>
          </tfoot>
        )}
      </table>

      <h3 className="text-xs font-bold uppercase mt-4 mb-1 flex items-baseline gap-2">
        <span>Ritmo por producto y talla</span>
        <span className="font-normal normal-case text-gray-500">libras peladas ÷ horas de las peladoras en ese producto y talla</span>
      </h3>
      <table className="w-full max-w-[760px]">
        <thead><tr className="border-b-2 border-gray-800">
          <th className={TH}>Producto</th><th className={TH}>Talla</th>
          <th className={`${TH} ${R}`}>Lb pelado</th><th className={`${TH} ${R}`}>Horas peladoras</th>
          <th className={`${TH} ${R}`}>Personas</th><th className={`${TH} ${R}`}>Lb/hr</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-200">
          {ritmo.grupos.map(g => (
            <tr key={`${g.Producto}|${g.Talla}`}>
              <td className={TD}>{g.Producto}</td>
              <td className={`${TD} whitespace-nowrap`}>{g.DescripcionTalla}</td>
              <td className={`${TD} ${R}`}>{fmtNum(g.Lb, 1)}</td>
              <td className={`${TD} ${R}`}>{fmtNum(g.Horas, 1)}</td>
              <td className={`${TD} ${R}`}>{g.Personas}</td>
              <td className={`${TD} ${R} font-bold`}>{g.LbHora == null ? "—" : fmtNum(g.LbHora, 1)}</td>
            </tr>
          ))}
          {ritmo.grupos.length === 0 && <tr><td colSpan={6} className="py-2 text-center text-gray-400">Sin pesadas de peladoras en el día</td></tr>}
        </tbody>
        {ritmo.grupos.length > 0 && (
          <tfoot><tr className={TOTAL}>
            <td colSpan={2} className={`${TD} ${R} uppercase text-[10px]`}>Ritmo del día</td>
            <td className={`${TD} ${R}`}>{fmtNum(ritmo.total.Lb, 1)}</td>
            <td className={`${TD} ${R}`}>{fmtNum(ritmo.total.Horas, 1)}</td>
            <td className={`${TD} ${R}`}>{ritmo.total.Personas}</td>
            <td className={`${TD} ${R}`}>{ritmo.total.LbHora == null ? "—" : fmtNum(ritmo.total.LbHora, 1)}</td>
          </tr></tfoot>
        )}
      </table>
      {ritmo.lbSinTiempo > 0.05 && (
        <p className="text-[10px] text-gray-500 mt-1">
          {fmtNum(ritmo.lbSinTiempo, 1)} lb pesadas sin tiempo medible (marcaje de área faltante) no entran en el ritmo; ver Lb/Hora.
        </p>
      )}

      {/* 3. Queda al piso */}
      <Titulo n={3} extra="materia prima sin pelar al cerrar el día (pasa al día siguiente)">Queda al piso</Titulo>
      <table className="w-full">
        <thead><tr className="border-b-2 border-gray-800">
          <th className={TH}>Lote</th><th className={TH}>Talla</th><th className={TH}>Clase / materia prima</th>
          <th className={TH}>Vino de</th><th className={TH}>Ingresó</th><th className={`${TH} ${R}`}>Kg MP</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-200">
          {r.AlPiso.map(x => (
            <tr key={`${x.Lote}|${x.Clase}|${x.Talla}`}>
              <td className={`${TD} font-mono whitespace-nowrap`}>{x.Lote}</td>
              <td className={`${TD} whitespace-nowrap`}>{x.DescripcionTalla}</td>
              <td className={TD}>{x.Clase} {x.DescripcionClase}</td>
              <td className={TD}>{x.VinoDe ?? "—"}</td>
              <td className={`${TD} whitespace-nowrap ${x.FechaIngreso && x.FechaIngreso < r.Fecha ? "text-amber-700" : ""}`}>{fmtDia(x.FechaIngreso)}</td>
              <td className={`${TD} ${R}`}>{kg(x.Kg)}</td>
            </tr>
          ))}
          {r.AlPiso.length === 0 && <tr><td colSpan={6} className="py-2 text-center text-gray-400">Todo lo recibido se trabajó: nada queda al piso</td></tr>}
        </tbody>
        <tfoot><tr className={TOTAL}>
          <td colSpan={5} className={`${TD} ${R} uppercase text-[10px]`}>Total al piso</td>
          <td className={`${TD} ${R}`}>{kg(C.AlPisoKg)}</td>
        </tr></tfoot>
      </table>

      <div className="grid grid-cols-2 gap-16 mt-12 text-center text-[10px] uppercase text-gray-600">
        <div className="border-t border-gray-800 pt-1">Encargado de Pelado</div>
        <div className="border-t border-gray-800 pt-1">Supervisor de producción</div>
      </div>
    </div>
  );
}
