// Descongelado de Materia Prima — la versión en pantalla del formulario FR-7.13-13.
//
// La pantalla sigue a propósito el orden de la hoja de papel (entrada declarada → descongelado
// pesado con área destino → devoluciones → cuadre del día) para que quien la llena hoy a mano no
// tenga que reaprender nada. Los totales y la merma los calcula el sistema: en las hojas reales del
// 21-sep dos de tres tenían la suma mal por cantidades redondas.
import { useState, useEffect, useCallback, Fragment } from "react";
import { fmtNum } from "../utils/numero.js";
import { authHeader, usePuede } from "../context/AuthContext.jsx";
import { useAviso } from "../hooks/useAviso.js";
import AvisoModal from "../components/AvisoModal.jsx";
import EmpleadoAutocomplete from "../components/EmpleadoAutocomplete.jsx";

const API = "/api/descongelado";

const hoyGT = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });

// Las fechas puras (YYYY-MM-DD) se parten a mano: new Date("2026-09-21") se interpreta como
// medianoche UTC y en Guatemala se muestra un día antes (ver utils/fecha.js).
const fmtDia = (iso) => {
  if (!iso) return "—";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

const ESTATUS_BADGE = {
  Abierta: "bg-green-100 text-green-700",
  Cerrada: "bg-gray-200 text-gray-600",
};

async function leerJSON(res) { try { return await res.json(); } catch { return {}; } }

// Un rendimiento por debajo del 90 % o por encima del 100 % casi siempre es un error de captura,
// no un dato de proceso: se marca en ámbar para que salte a la vista sin bloquear el cierre.
function colorRendimiento(r) {
  if (r == null) return "text-gray-400";
  if (r > 100 || r < 90) return "text-amber-600 font-bold";
  return "text-gray-800 font-semibold";
}

/* ── Fila de captura genérica ─────────────────────────────────────── */
function CampoNum({ value, onChange, placeholder, ancho = "w-24", paso = "0.01" }) {
  return (
    <input type="number" step={paso} min="0" value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`${ancho} border border-gray-300 rounded px-2 py-1 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-400`} />
  );
}
function CampoTxt({ value, onChange, placeholder, ancho = "w-32", upper = false }) {
  return (
    <input value={value} onChange={e => onChange(upper ? e.target.value.toUpperCase() : e.target.value)}
      placeholder={placeholder}
      className={`${ancho} border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400`} />
  );
}

/* ── Sección 1 · Entrada declarada ────────────────────────────────── */
// El lote NO se teclea: se escoge de lo que bodega ya confirmó y está al piso del área. Así el
// operador no puede inventar un lote que no le entregaron, y el código del lote nunca se reescribe
// —  que es lo que antes convertía un lote de mayo en uno de la semana en curso.
function SeccionEntrada({ hoja, puedeEditar, onBorrar }) {
  return (
    <section className="bg-white border border-gray-300 rounded-lg overflow-hidden">
      <header className="bg-gray-100 border-b border-gray-300 px-4 py-2 flex items-center justify-between">
        <h3 className="font-bold text-sm text-gray-700">1 · ENTRADA
          <span className="font-normal text-gray-500"> — lo que se bajó del inventario al piso</span></h3>
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Peso declarado</span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Remisión</th>
              <th className="px-3 py-2 text-left font-semibold">Lote</th>
              <th className="px-3 py-2 text-left font-semibold">Talla</th>
              <th className="px-3 py-2 text-left font-semibold">Producto</th>
              <th className="px-3 py-2 text-right font-semibold">Masters</th>
              <th className="px-3 py-2 text-right font-semibold">Kg declarado</th>
              <th className="px-3 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {hoja.entrada.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400 text-xs">
                Use el botón <b>Descongelar</b> del inventario al piso para traer producto a esta hoja.</td></tr>
            )}
            {hoja.entrada.map(l => (
              <tr key={l.MovimientoId} className="hover:bg-gray-50">
                <td className="px-3 py-1.5 font-mono text-xs text-blue-700">{l.FolioRemision || "—"}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{l.Lote}</td>
                <td className="px-3 py-1.5">{l.DescripcionTalla}</td>
                <td className="px-3 py-1.5"><span className="font-mono text-xs text-gray-500">{l.Clase}</span> {l.DescripcionClase}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{l.Masters ?? "—"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmtNum(l.PesoKg)}</td>
                <td className="px-3 py-1.5 text-center">
                  {puedeEditar && (
                    <button onClick={() => onBorrar(l.MovimientoId)} title="Devolver este renglón al inventario al piso"
                      className="text-gray-300 hover:text-red-600 text-lg leading-none">&times;</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-100 border-t-2 border-gray-300">
            <tr>
              <td colSpan={4} className="px-3 py-2 text-right text-xs font-bold text-gray-600 uppercase">Total entrada declarada</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold">
                {hoja.entrada.reduce((s, l) => s + (l.Masters || 0), 0) || "—"}
              </td>
              <td className="px-3 py-2 text-right tabular-nums font-bold text-base">{fmtNum(hoja.KgEntrada)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/* ── Sección 2 · Descongelado ─────────────────────────────────────── */
// Espejo de la sección 1, igual que en el papel: las mismas líneas que entraron a la hoja, ahora
// con su peso real de báscula y el área a la que se envían.
//
// El peso viene YA SUGERIDO con lo declarado, porque casi siempre son iguales. El operador solo lo
// corrige cuando faltó un master físicamente o cuando la báscula no dio lo mismo — que es
// justamente lo que hay que capturar, y lo único que produce la merma del día.
function SeccionSalida({ hoja, areas, puedeEditar, onAgregar, onBorrar }) {
  const vacio = { clave: "", Peso: "", AreaDestino: "", NumeroTermo: "" };
  const [f, setF] = useState(vacio);
  const set = k => v => setF(p => ({ ...p, [k]: v }));

  const claveDe = (l) => `${l.RemisionId ?? "-"}|${l.Lote}|${l.Clase}|${l.Talla}`;

  // Lo que falta por pesar de cada línea que entró: lo declarado menos lo que ya se despachó de
  // ella. Una misma línea puede irse partida a dos áreas distintas.
  const pendientes = hoja.entrada.map(e => {
    const yaSalio = hoja.descongelado
      .filter(d => claveDe(d) === claveDe(e))
      .reduce((s, d) => s + d.PesoKg, 0);
    return { ...e, Declarado: e.PesoKg, Pendiente: Number((e.PesoKg - yaSalio).toFixed(2)) };
  }).filter(e => e.Pendiente > 0.001);

  const elegido = pendientes.find(e => claveDe(e) === f.clave) || null;
  const pesado = Number(f.Peso) || 0;
  const difiere = elegido && pesado > 0 ? Math.abs(pesado - elegido.Pendiente) > 0.001 : false;

  // Al escoger la línea, el peso se rellena solo con lo pendiente: el caso normal es aceptar y dar +.
  const escoger = (clave) => {
    const e = pendientes.find(x => claveDe(x) === clave);
    setF({ clave, Peso: e ? String(e.Pendiente) : "", AreaDestino: "", NumeroTermo: "" });
  };

  const agregar = async () => {
    if (!elegido) return;
    const ok = await onAgregar({
      Lote: elegido.Lote, Clase: elegido.Clase, Talla: elegido.Talla, RemisionId: elegido.RemisionId,
      Peso: pesado, UM: "KG", BodegaDestino: f.AreaDestino, NumeroTermo: f.NumeroTermo,
    });
    if (ok) setF(vacio);
  };

  return (
    <section className="bg-white border border-gray-300 rounded-lg overflow-hidden">
      <header className="bg-gray-100 border-b border-gray-300 px-4 py-2 flex items-center justify-between">
        <h3 className="font-bold text-sm text-gray-700">2 · DESCONGELADO <span className="font-normal text-gray-500">— y a qué área se envía</span></h3>
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Peso real de báscula</span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Lote</th>
              <th className="px-3 py-2 text-left font-semibold">Talla</th>
              <th className="px-3 py-2 text-left font-semibold">Producto</th>
              <th className="px-3 py-2 text-left font-semibold">Termo</th>
              <th className="px-3 py-2 text-right font-semibold">Kg pesado</th>
              <th className="px-3 py-2 text-left font-semibold">Bodega destino</th>
              <th className="px-3 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {hoja.descongelado.map(l => (
              <tr key={l.MovimientoId} className="hover:bg-gray-50">
                <td className="px-3 py-1.5 font-mono text-xs">{l.Lote}</td>
                <td className="px-3 py-1.5">{l.DescripcionTalla}</td>
                <td className="px-3 py-1.5"><span className="font-mono text-xs text-gray-500">{l.Clase}</span> {l.DescripcionClase}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{l.NumeroTermo || "—"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmtNum(l.PesoKg)}</td>
                <td className="px-3 py-1.5">{l.NombreBodegaDestino || l.BodegaDestino}</td>
                <td className="px-3 py-1.5 text-center">
                  {puedeEditar && (
                    <button onClick={() => onBorrar(l.MovimientoId)} title="Quitar renglón"
                      className="text-gray-300 hover:text-red-600 text-lg leading-none">&times;</button>
                  )}
                </td>
              </tr>
            ))}
            {puedeEditar && (
              <tr className="bg-blue-50/40 align-top">
                <td colSpan={3} className="px-3 py-2">
                  <select value={f.clave} onChange={e => escoger(e.target.value)}
                    className="w-full border border-gray-300 rounded px-2 py-1 text-sm">
                    <option value="">Escoja de lo que entró a esta hoja…</option>
                    {pendientes.map(e => (
                      <option key={claveDe(e)} value={claveDe(e)}>
                        {e.Lote} · {e.Clase} · {e.DescripcionTalla} — faltan {fmtNum(e.Pendiente)} kg de {fmtNum(e.Declarado)}
                      </option>
                    ))}
                  </select>
                  {hoja.entrada.length === 0 ? (
                    <p className="text-xs text-gray-500 mt-1">Primero capture la entrada en la sección 1.</p>
                  ) : pendientes.length === 0 ? (
                    <p className="text-xs text-gray-500 mt-1">Todo lo que entró ya fue pesado y enviado.</p>
                  ) : difiere && (
                    <p className="text-xs text-amber-700 mt-1">
                      {pesado < elegido.Pendiente
                        ? `${fmtNum(elegido.Pendiente - pesado)} kg menos que lo declarado — va a la merma del día.`
                        : `${fmtNum(pesado - elegido.Pendiente)} kg más que lo declarado. Revise la báscula.`}
                    </p>
                  )}
                </td>
                <td className="px-3 py-2"><CampoTxt value={f.NumeroTermo} onChange={set("NumeroTermo")} placeholder="14" ancho="w-20" /></td>
                <td className="px-3 py-2 text-right">
                  <CampoNum value={f.Peso} onChange={set("Peso")} placeholder="0.00" />
                </td>
                <td className="px-3 py-2">
                  <select value={f.AreaDestino} onChange={e => set("AreaDestino")(e.target.value)}
                    className="w-48 border border-gray-300 rounded px-2 py-1 text-sm">
                    <option value="">Bodega…</option>
                    {areas.map(a => <option key={a.Codigo} value={a.Codigo}>{a.Nombre}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2 text-center">
                  <button onClick={agregar} disabled={!elegido || !f.AreaDestino || pesado <= 0}
                    className="bg-blue-600 text-white rounded px-2 py-1 text-xs font-semibold hover:bg-blue-700 disabled:opacity-40">+</button>
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="bg-gray-100 border-t-2 border-gray-300">
            <tr>
              <td colSpan={4} className="px-3 py-2 text-right text-xs font-bold text-gray-600 uppercase">Total descongelado pesado</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold text-base">{fmtNum(hoja.KgDescongelado)}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/* ── Sección 3 · Devoluciones ─────────────────────────────────────── */
function SeccionDevoluciones({ hoja, clases, tallas, puedeEditar, onAgregar, onBorrar }) {
  const vacio = { Lote: "", Clase: "", Talla: "900", Masters: "", Peso: "", Motivo: "" };
  const [f, setF] = useState(vacio);
  const set = k => v => setF(p => ({ ...p, [k]: v }));
  const agregar = async () => { if (await onAgregar(f)) setF(vacio); };

  return (
    <section className="bg-white border border-gray-300 rounded-lg overflow-hidden">
      <header className="bg-gray-100 border-b border-gray-300 px-4 py-2">
        <h3 className="font-bold text-sm text-gray-700">3 · DEVOLUCIONES A BODEGA <span className="font-normal text-gray-500">— lo que no se descongeló y regresa</span></h3>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Lote</th>
              <th className="px-3 py-2 text-left font-semibold">Talla</th>
              <th className="px-3 py-2 text-left font-semibold">Producto</th>
              <th className="px-3 py-2 text-right font-semibold">Masters</th>
              <th className="px-3 py-2 text-right font-semibold">Kg</th>
              <th className="px-3 py-2 text-left font-semibold">Motivo</th>
              <th className="px-3 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {hoja.devoluciones.length === 0 && !puedeEditar && (
              <tr><td colSpan={7} className="px-3 py-4 text-center text-gray-400 text-xs">Sin devoluciones</td></tr>
            )}
            {hoja.devoluciones.map(l => (
              <tr key={l.MovimientoId} className="hover:bg-gray-50">
                <td className="px-3 py-1.5 font-mono text-xs">{l.Lote}</td>
                <td className="px-3 py-1.5">{l.DescripcionTalla}</td>
                <td className="px-3 py-1.5"><span className="font-mono text-xs text-gray-500">{l.Clase}</span> {l.DescripcionClase}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{l.Masters ?? "—"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmtNum(l.PesoKg)}</td>
                <td className="px-3 py-1.5 text-xs text-gray-600 truncate max-w-xs">{l.Motivo || "—"}</td>
                <td className="px-3 py-1.5 text-center">
                  {puedeEditar && (
                    <button onClick={() => onBorrar(l.MovimientoId)} title="Quitar renglón"
                      className="text-gray-300 hover:text-red-600 text-lg leading-none">&times;</button>
                  )}
                </td>
              </tr>
            ))}
            {puedeEditar && (
              <tr className="bg-blue-50/40">
                <td className="px-3 py-2"><CampoTxt value={f.Lote} onChange={set("Lote")} placeholder="G139K022" ancho="w-36" /></td>
                <td className="px-3 py-2">
                  <select value={f.Talla} onChange={e => set("Talla")(e.target.value)}
                    className="w-28 border border-gray-300 rounded px-2 py-1 text-sm">
                    {tallas.map(t => <option key={t.Codigo} value={t.Codigo}>{t.Descripcion}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <select value={f.Clase} onChange={e => set("Clase")(e.target.value)}
                    className="w-52 border border-gray-300 rounded px-2 py-1 text-sm">
                    <option value="">Clase…</option>
                    {clases.map(c => <option key={c.Clase} value={c.Clase}>{c.Clase} — {c.Descripcion}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2 text-right"><CampoNum value={f.Masters} onChange={set("Masters")} placeholder="0" ancho="w-20" paso="1" /></td>
                <td className="px-3 py-2 text-right"><CampoNum value={f.Peso} onChange={set("Peso")} placeholder="0.00" /></td>
                <td className="px-3 py-2"><CampoTxt value={f.Motivo} onChange={set("Motivo")} placeholder="cambio de producción" ancho="w-44" /></td>
                <td className="px-3 py-2 text-center">
                  <button onClick={agregar} disabled={!f.Lote || !f.Clase || Number(f.Peso) <= 0}
                    className="bg-blue-600 text-white rounded px-2 py-1 text-xs font-semibold hover:bg-blue-700 disabled:opacity-40">+</button>
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="bg-gray-100 border-t-2 border-gray-300">
            <tr>
              <td colSpan={4} className="px-3 py-2 text-right text-xs font-bold text-gray-600 uppercase">Total devuelto a bodega</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold text-base">{fmtNum(hoja.KgDevuelto)}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/* ── Cuadre del día ───────────────────────────────────────────────── */
function Cuadre({ hoja }) {
  const dif = hoja.KgEntrada - hoja.KgDescongelado - hoja.KgDevuelto;
  return (
    <section className="bg-white border border-gray-300 rounded-lg overflow-hidden">
      <header className="bg-gray-100 border-b border-gray-300 px-4 py-2">
        <h3 className="font-bold text-sm text-gray-700">CUADRE DEL DÍA
          <span className="font-normal text-gray-500"> — la diferencia se anota, no se ajusta</span></h3>
      </header>
      <div className="p-4 flex flex-wrap items-center gap-3 text-sm">
        <div className="flex flex-col"><span className="text-xs text-gray-500">Entrada</span>
          <span className="font-mono tabular-nums font-semibold">{fmtNum(hoja.KgEntrada)}</span></div>
        <span className="text-gray-400 text-lg">−</span>
        <div className="flex flex-col"><span className="text-xs text-gray-500">Descongelado</span>
          <span className="font-mono tabular-nums font-semibold">{fmtNum(hoja.KgDescongelado)}</span></div>
        <span className="text-gray-400 text-lg">−</span>
        <div className="flex flex-col"><span className="text-xs text-gray-500">Devuelto</span>
          <span className="font-mono tabular-nums font-semibold">{fmtNum(hoja.KgDevuelto)}</span></div>
        <span className="text-gray-400 text-lg">=</span>
        <div className="flex flex-col">
          <span className="text-xs text-gray-500">{hoja.Estatus === "Cerrada" ? "Merma" : "Diferencia"}</span>
          <span className={`font-mono tabular-nums font-bold text-lg ${dif < 0 ? "text-red-600" : "text-gray-800"}`}>
            {fmtNum(hoja.Estatus === "Cerrada" ? hoja.KgMerma : dif)}
          </span>
        </div>
        <div className="ml-auto flex flex-col items-end">
          <span className="text-xs text-gray-500 uppercase tracking-wide">Rendimiento</span>
          <span className={`font-mono tabular-nums text-2xl ${colorRendimiento(hoja.Rendimiento)}`}>
            {hoja.Rendimiento != null ? `${fmtNum(hoja.Rendimiento)} %` : "—"}
          </span>
        </div>
      </div>
      {dif < 0 && hoja.Estatus === "Abierta" && (
        <p className="px-4 pb-3 text-xs text-red-600">
          Lo descongelado y devuelto supera la entrada declarada. Revise los pesos antes de cerrar.
        </p>
      )}
    </section>
  );
}

/* ── Modal de descongelado ────────────────────────────────────────── */
// Se cuenta en MASTERS, no en kilos. El peso de un master lo fija la presentación del pedido, así
// que los kilos se derivan y nunca se teclean: si se pudieran escribir habría dos verdades sobre el
// mismo peso y el cuadre del día dejaría de significar algo.
//
// Sirve para una línea suelta o para una remisión entera; en el segundo caso trae todas sus líneas
// con los masters ya propuestos y se ajusta solo la que venga incompleta.
function ModalDescongelar({ titulo, lineas, hojaAbierta, empleados, auxiliares, onConfirmar, onCerrar }) {
  const [cant, setCant] = useState(() =>
    Object.fromEntries(lineas.map(l => [`${l.RemisionId}|${l.Lote}|${l.Clase}|${l.Talla}`, String(l.Masters ?? 0)])));
  const [cab, setCab] = useState({
    Encargado: "", Personas: "",
    HoraInicio: new Date().toLocaleTimeString("es-GT", { hour12: false, hour: "2-digit", minute: "2-digit", timeZone: "America/Guatemala" }),
  });
  const [personasTocado, setPersonasTocado] = useState(false);

  // Personas son los AUXILIARES: todos los que pasaron por el área en la jornada, menos el
  // encargado, que va aparte. Se recalcula al elegir encargado —  si él mismo aparece en la lista,
  // el número baja solo—  y deja de recalcularse en cuanto alguien lo escribe a mano.
  const auxiliaresSinEncargado = auxiliares.filter(a => a.Codigo !== cab.Encargado);
  useEffect(() => {
    if (!personasTocado) setCab(c => ({ ...c, Personas: String(auxiliaresSinEncargado.length) }));
  }, [auxiliaresSinEncargado.length, personasTocado]);
  const [guardando, setGuardando] = useState(false);

  const clave = l => `${l.RemisionId}|${l.Lote}|${l.Clase}|${l.Talla}`;
  const mastersDe = l => Math.max(0, Math.min(Number(cant[clave(l)]) || 0, l.Masters ?? 0));
  const kgDe = l => Number((mastersDe(l) * (l.KgPorMaster || 0)).toFixed(2));

  const totalM = lineas.reduce((s, l) => s + mastersDe(l), 0);
  const totalKg = Number(lineas.reduce((s, l) => s + kgDe(l), 0).toFixed(2));
  const faltantes = lineas.filter(l => mastersDe(l) < (l.Masters ?? 0));
  const faltanM = faltantes.reduce((s, l) => s + ((l.Masters ?? 0) - mastersDe(l)), 0);

  const listo = totalM > 0 && (hojaAbierta || cab.Encargado);

  const confirmar = async () => {
    setGuardando(true);
    try {
      await onConfirmar(
        lineas.filter(l => mastersDe(l) > 0).map(l => ({ linea: l, Masters: mastersDe(l), Kg: kgDe(l) })),
        hojaAbierta ? null : cab
      );
    } finally { setGuardando(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[88vh]">
        <div className="px-5 py-3 border-b flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-bold text-gray-800">Descongelar</h2>
            <p className="text-xs text-gray-500 mt-0.5">{titulo}</p>
          </div>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="px-5 py-3 overflow-y-auto">
          <p className="text-xs text-gray-500 mb-3">
            Confirme cuántos masters bajaron de verdad. Si faltó alguno, baje la cantidad — los kilos
            se calculan solos con el peso de la presentación.
          </p>
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 uppercase border-b">
              <tr>
                <th className="py-2 text-left font-semibold">Lote</th>
                <th className="py-2 text-left font-semibold">Producto</th>
                <th className="py-2 text-left font-semibold">Talla</th>
                <th className="py-2 text-right font-semibold">Al piso</th>
                <th className="py-2 text-right font-semibold">Masters</th>
                <th className="py-2 text-right font-semibold">Kg</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lineas.map(l => {
                const falta = (l.Masters ?? 0) - mastersDe(l);
                return (
                  <tr key={clave(l)}>
                    <td className="py-1.5 font-mono text-xs">{l.Lote}</td>
                    <td className="py-1.5 text-xs"><span className="font-mono text-gray-500">{l.Clase}</span> {l.DescripcionClase}</td>
                    <td className="py-1.5 text-xs">{l.DescripcionTalla}</td>
                    <td className="py-1.5 text-right tabular-nums text-xs text-gray-500">
                      {l.Masters} m · {fmtNum(l.Kg)}
                    </td>
                    <td className="py-1.5 text-right">
                      <input type="number" min="0" max={l.Masters} step="1"
                        value={cant[clave(l)]}
                        onChange={e => setCant(c => ({ ...c, [clave(l)]: e.target.value }))}
                        className={`w-20 border rounded px-2 py-1 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-400
                          ${falta > 0 ? "border-amber-400 bg-amber-50" : "border-gray-300"}`} />
                    </td>
                    <td className="py-1.5 text-right tabular-nums font-semibold w-24">{fmtNum(kgDe(l))}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2">
              <tr>
                <td colSpan={4} className="py-2 text-right text-xs font-bold text-gray-600 uppercase">Total a descongelar</td>
                <td className="py-2 text-right tabular-nums font-bold">{totalM} m</td>
                <td className="py-2 text-right tabular-nums font-bold">{fmtNum(totalKg)}</td>
              </tr>
            </tfoot>
          </table>

          {faltanM > 0 && (
            <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              Faltan <b>{faltanM} master{faltanM !== 1 ? "s" : ""}</b> respecto de lo que bodega despachó.
              Esa diferencia queda al piso hasta que aparezca, o se anota como merma al cerrar la hoja.
            </p>
          )}

          {!hojaAbierta && (
            <div className="mt-4 pt-3 border-t">
              <p className="text-xs font-semibold text-gray-600 mb-2">
                No hay hoja abierta hoy — se abre una con estos datos (es la cabecera del formulario de papel).
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Encargado</label>
                  <EmpleadoAutocomplete empleados={empleados} value={cab.Encargado}
                    onSelect={cod => setCab(c => ({ ...c, Encargado: cod }))} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Personas (auxiliares)</label>
                  <input type="number" min="0" value={cab.Personas}
                    onChange={e => { setPersonasTocado(true); setCab(c => ({ ...c, Personas: e.target.value })); }}
                    className="w-20 border border-gray-300 rounded px-2 py-1 text-sm text-right" />
                  <p className="text-xs text-gray-400 mt-1"
                     title={auxiliaresSinEncargado.map(a => `${a.Codigo} ${a.Nombre}`).join(", ")}>
                    {auxiliaresSinEncargado.length} auxiliar{auxiliaresSinEncargado.length !== 1 ? "es" : ""} pasaron por el área
                    {cab.Encargado && auxiliares.some(a => a.Codigo === cab.Encargado) ? " (sin el encargado)" : ""}
                  </p>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Hora inicio</label>
                  <input type="time" value={cab.HoraInicio}
                    onChange={e => setCab(c => ({ ...c, HoraInicio: e.target.value }))}
                    className="border border-gray-300 rounded px-2 py-1 text-sm" />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t flex items-center gap-2 shrink-0">
          {hojaAbierta && (
            <span className="text-xs text-gray-500">
              Se agrega a la hoja <b>#{hojaAbierta.HojaId}</b>
              {hojaAbierta.NombreEncargado ? ` · ${hojaAbierta.NombreEncargado}` : ""}
            </span>
          )}
          <button onClick={onCerrar}
            className="ml-auto border border-gray-300 rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={!listo || guardando}
            className="bg-blue-600 text-white rounded px-5 py-1.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-40">
            {guardando ? "Guardando…" : `Descongelar ${totalM} master${totalM !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Inventario al piso ───────────────────────────────────────────── */
// Lo que el área tiene y todavía no ha bajado. Entra solo cuando bodega confirma la remisión y sale
// solo cuando una hoja lo consume; nadie lo teclea ni lo arrastra de un día a otro.
//
// "Días al piso" cuenta desde que el producto ENTRÓ AL ÁREA, no desde la fecha del lote: hay lotes
// congelados del año pasado y su edad de producción no dice nada sobre si el área lo tiene parado.
function InventarioPiso({ saldo, resumen, puedeCrear, onDescongelar }) {
  const [abierto, setAbierto] = useState(true);
  const totalKg = saldo.reduce((s, r) => s + r.Kg, 0);
  const totalM  = saldo.reduce((s, r) => s + (r.Masters || 0), 0);

  // Agrupado por remisión, conservando el orden que ya trae el backend (la remisión confirmada
  // primero, y dentro de ella el lote más viejo primero). El producto que entró por un ajuste, sin
  // remisión detrás, cae en su propio grupo al final.
  const grupos = [];
  for (const r of saldo) {
    const clave = r.RemisionId ?? "sin-remision";
    let g = grupos.find(x => x.clave === clave);
    if (!g) {
      g = { clave, Folio: r.FolioRemision, ConfirmadaEn: r.ConfirmadaEn, lineas: [], Kg: 0, Masters: 0 };
      grupos.push(g);
    }
    g.lineas.push(r); g.Kg += r.Kg; g.Masters += r.Masters || 0;
  }

  return (
    <section className="bg-white border border-gray-300 rounded-lg overflow-hidden">
      <header className="bg-gray-100 border-b border-gray-300 px-4 py-2 flex items-center gap-3">
        <button onClick={() => setAbierto(a => !a)}
          className="text-gray-500 hover:text-gray-800 text-xs font-bold w-4">{abierto ? "▾" : "▸"}</button>
        <h3 className="font-bold text-sm text-gray-700">INVENTARIO AL PISO</h3>
        <span className="text-xs text-gray-500">
          {grupos.length} {grupos.length === 1 ? "remisión" : "remisiones"} · {saldo.length} renglones
        </span>
        <span className="ml-auto flex items-baseline gap-4 text-sm">
          {resumen && resumen.IngresadoKg > 0 && (
            <span className="text-xs text-gray-500">
              Ingresó hoy <b className="font-mono tabular-nums text-gray-700">{fmtNum(resumen.IngresadoKg)} kg</b>
              {" · "}descongelado <b className="font-mono tabular-nums text-gray-700">{fmtNum(resumen.DescongeladoKg)} kg</b>
            </span>
          )}
          <span className="font-mono tabular-nums font-bold text-gray-800">
            {fmtNum(totalKg)} kg {totalM > 0 && <span className="font-normal text-gray-500">· {totalM} masters</span>}
          </span>
        </span>
      </header>
      {abierto && (
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Lote</th>
                <th className="px-3 py-2 text-left font-semibold">Producto</th>
                <th className="px-3 py-2 text-left font-semibold">Talla</th>
                <th className="px-3 py-2 text-left font-semibold">Entró</th>
                <th className="px-3 py-2 text-right font-semibold">Días al piso</th>
                <th className="px-3 py-2 text-right font-semibold">Masters</th>
                <th className="px-3 py-2 text-right font-semibold">Kg</th>
                <th className="px-3 py-2 w-28"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {saldo.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-400 text-xs">
                  Sin producto al piso. Aparece aquí cuando bodega confirma una remisión al área.</td></tr>
              ) : grupos.map(g => (
                <Fragment key={g.clave}>
                  <tr className="bg-blue-50 border-t border-blue-200">
                    <td colSpan={4} className="px-3 py-1.5 font-semibold text-blue-900 text-xs">
                      {g.Folio || "Sin remisión (ajuste)"}
                      {g.ConfirmadaEn && <span className="font-normal text-blue-600 ml-2">confirmada {g.ConfirmadaEn}</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right text-xs text-blue-600">{g.lineas.length} líneas</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-xs font-semibold text-blue-900">{g.Masters || "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-bold text-blue-900">{fmtNum(g.Kg)}</td>
                    <td className="px-3 py-1.5 text-center">
                      {puedeCrear && (
                        <button onClick={() => onDescongelar(g.Folio || "Sin remisión", g.lineas)}
                          className="bg-blue-600 text-white rounded px-2.5 py-1 text-xs font-semibold hover:bg-blue-700 whitespace-nowrap">
                          Descongelar todo
                        </button>
                      )}
                    </td>
                  </tr>
                  {g.lineas.map(r => (
                    <tr key={`${g.clave}|${r.Lote}|${r.Clase}|${r.Talla}`} className="hover:bg-gray-50">
                      <td className="px-3 py-1.5 pl-6 font-mono text-xs">{r.Lote}</td>
                      <td className="px-3 py-1.5"><span className="font-mono text-xs text-gray-500">{r.Clase}</span> {r.DescripcionClase}</td>
                      <td className="px-3 py-1.5">{r.DescripcionTalla}</td>
                      <td className="px-3 py-1.5 text-xs text-gray-500">{fmtDia(r.FechaIngreso)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.DiasAlPiso ?? "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.Masters ?? "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmtNum(r.Kg)}</td>
                      <td className="px-3 py-1.5 text-center">
                        {puedeCrear && (
                          <button onClick={() => onDescongelar(`${r.FolioRemision || ""} · ${r.Lote}`, [r])}
                            className="border border-blue-300 text-blue-700 rounded px-2.5 py-0.5 text-xs font-semibold hover:bg-blue-50 whitespace-nowrap">
                            Descongelar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ── Página ───────────────────────────────────────────────────────── */
export default function DescongeladoPage() {
  const puedeCrear  = usePuede("descongelado", "crear");
  const puedeCerrar = usePuede("descongelado", "cerrar");
  const puedeBorrar = usePuede("descongelado", "eliminar");
  const { aviso, mostrarAlerta, pedirConfirmacion, cerrar } = useAviso();

  const [fecha, setFecha]   = useState(hoyGT());
  const [hojas, setHojas]   = useState([]);
  const [sel, setSel]       = useState(null);     // hoja abierta en detalle
  const [clases, setClases] = useState([]);
  const [tallas, setTallas] = useState([]);
  const [areas, setAreas]   = useState([]);
  const [saldo, setSaldo]   = useState([]);   // lo que hay al piso del área
  const [empleados, setEmpleados] = useState([]);
  const [cargando, setCargando]   = useState(false);
  const [error, setError]         = useState("");
  const [auxiliares, setAuxiliares] = useState([]);
  const [resumen, setResumen] = useState(null);  // totales de la jornada (lo ingresado no se pierde)
  const [modal, setModal]   = useState(null);    // { titulo, lineas } del modal de descongelar
  const [horaFin, setHoraFin] = useState("");    // hora de finalización de la hoja del día

  // La hoja NO se abre a mano: la abre el primer descongelado del día. Es la cabecera del
  // formulario de papel (hora, encargado, personas), y pedirla antes de que haya algo que bajar
  // obligaba a entender un paso que no significa nada por sí solo.
  const hojaAbierta = hojas.find(h => h.Estatus === "Abierta") || null;

  const fetchHojas = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch(`${API}/hojas?fecha=${fecha}`, { headers: authHeader() });
      const data = await leerJSON(res);
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setHojas(Array.isArray(data) ? data : []);
      setError("");
    } catch (e) {
      setHojas([]);
      setError(e.message || "No se pudo conectar con el servidor");
    } finally { setCargando(false); }
  }, [fecha]);

  // El saldo al piso se recarga con cada cambio que mueve inventario, porque de él sale la lista
  // que ofrece la sección 1: bajar 200 kg tiene que dejar 200 kg menos disponibles en el acto.
  const fetchSaldo = useCallback(async () => {
    try {
      const [rs, rr] = await Promise.all([
        fetch(`${API}/saldo?bodega=DESCONGELADO&hasta=${fecha}`, { headers: authHeader() }),
        fetch(`${API}/resumen?bodega=DESCONGELADO&fecha=${fecha}`, { headers: authHeader() }),
      ]);
      const data = await leerJSON(rs);
      setSaldo(Array.isArray(data) ? data : []);
      setResumen(rr.ok ? await leerJSON(rr) : null);
      const ra = await fetch(`${API}/auxiliares?bodega=DESCONGELADO&fecha=${fecha}`, { headers: authHeader() });
      const aux = await leerJSON(ra);
      setAuxiliares(Array.isArray(aux) ? aux : []);
    } catch { setSaldo([]); setResumen(null); setAuxiliares([]); }
  }, [fecha]);

  useEffect(() => { fetchHojas(); fetchSaldo(); }, [fetchHojas, fetchSaldo]);

  useEffect(() => {
    const h = { headers: authHeader() };
    fetch("/api/clase", h).then(leerJSON).then(d => Array.isArray(d) && setClases(d.filter(c => c.Activo)));
    fetch("/api/tallas", h).then(leerJSON).then(d => Array.isArray(d) && setTallas(d.filter(t => t.Activo)));
    // Las bodegas que llevan inventario al piso son los destinos posibles de un traslado.
    fetch(`${API}/bodegas`, h).then(leerJSON)
      .then(d => { if (Array.isArray(d)) setAreas(d.filter(b => b.Codigo !== "DESCONGELADO")); });
    fetch("/api/empleados", h).then(leerJSON).then(d => Array.isArray(d) && setEmpleados(d.filter(e => e.Estado === "Activo")));

  }, []);

  const abrirDetalle = async (id) => {
    const res = await fetch(`${API}/hojas/${id}`, { headers: authHeader() });
    const data = await leerJSON(res);
    if (!res.ok) { await mostrarAlerta(data.error || "No se pudo abrir la hoja"); return; }
    setSel(data);
  };

  const post = async (url, body) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(body),
    });
    const data = await leerJSON(res);
    if (!res.ok) { await mostrarAlerta(data.error || `Error ${res.status}`); return null; }
    return data;
  };

  const agregarRenglon = (seccion) => async (f) => {
    if (!await post(`${API}/hojas/${sel.HojaId}/${seccion}`, f)) return false;
    await abrirDetalle(sel.HojaId);
    await Promise.all([fetchHojas(), fetchSaldo()]);
    return true;
  };

  const borrarRenglon = async (id) => {
    if (!(await pedirConfirmacion("¿Quitar este renglón de la hoja?"))) return;
    const res = await fetch(`${API}/renglon/${id}`, { method: "DELETE", headers: authHeader() });
    const data = await leerJSON(res);
    if (!res.ok) { await mostrarAlerta(data.error || "No se pudo quitar"); return; }
    await abrirDetalle(sel.HojaId);
    await Promise.all([fetchHojas(), fetchSaldo()]);
  };

  const cerrarHoja = async () => {
    const dif = sel.KgEntrada - sel.KgDescongelado - sel.KgDevuelto;
    const fin = horaFin || new Date().toLocaleTimeString("es-GT", { hour12: false, hour: "2-digit", minute: "2-digit", timeZone: "America/Guatemala" });
    const msg = `Se va a cerrar la hoja y anotar ${fmtNum(dif)} kg de merma.\n\n`
      + `Entrada ${fmtNum(sel.KgEntrada)} − descongelado ${fmtNum(sel.KgDescongelado)} `
      + `− devuelto ${fmtNum(sel.KgDevuelto)} = ${fmtNum(dif)} kg.`;
    if (!(await pedirConfirmacion(`${msg}

Hora de finalización: ${fin}`))) return;
    const out = await post(`${API}/hojas/${sel.HojaId}/cerrar`, { HoraFin: `${fecha} ${fin}:00` });
    if (!out) return;
    await mostrarAlerta(`Hoja cerrada. Rendimiento de descongelado: ${fmtNum(out.Rendimiento)} %`, "exito");
    await abrirDetalle(sel.HojaId);
    await Promise.all([fetchHojas(), fetchSaldo()]);
  };

  const reabrirHoja = async () => {
    if (!(await pedirConfirmacion("Se va a reabrir la hoja y borrar la merma calculada. Los renglones capturados se conservan."))) return;
    if (!await post(`${API}/hojas/${sel.HojaId}/reabrir`, {})) return;
    await abrirDetalle(sel.HojaId);
    await Promise.all([fetchHojas(), fetchSaldo()]);
  };

  // Descongelar: baja masters del piso a la hoja del día. Si no hay hoja abierta, la abre con la
  // cabecera que pidió el modal — en un solo paso, para que el operador no tenga que saber que
  // existe una "hoja" antes de empezar a trabajar.
  const confirmarDescongelado = async (seleccion, cabecera) => {
    let hojaId = hojaAbierta?.HojaId;
    if (!hojaId) {
      const out = await post(`${API}/hojas`, {
        FechaProduccion: fecha, BodegaCodigo: "DESCONGELADO", Propiedad: "OROPSA",
        Encargado: cabecera?.Encargado, Personas: cabecera?.Personas,
        HoraInicio: cabecera?.HoraInicio ? `${fecha} ${cabecera.HoraInicio}:00` : null,
      });
      if (!out) return;
      hojaId = out.HojaId;
    }
    for (const { linea, Masters } of seleccion) {
      const ok = await post(`${API}/hojas/${hojaId}/entrada`, {
        Lote: linea.Lote, Clase: linea.Clase, Talla: linea.Talla, RemisionId: linea.RemisionId,
        Masters, KgPorMaster: linea.KgPorMaster, UM: "KG",
      });
      if (!ok) break;   // el modal ya mostró el error; no se sigue bajando a ciegas
    }
    setModal(null);
    await Promise.all([fetchHojas(), fetchSaldo()]);
    await abrirDetalle(hojaId);
  };

  const editable = sel?.Estatus === "Abierta" && puedeCrear;

  return (
    <div className="space-y-4">
      {aviso && <AvisoModal {...aviso} onCerrar={() => cerrar(true)} onCancelar={() => cerrar(false)} />}
      {modal && (
        <ModalDescongelar titulo={modal.titulo} lineas={modal.lineas} hojaAbierta={hojaAbierta}
          empleados={empleados} auxiliares={auxiliares}
          onConfirmar={confirmarDescongelado} onCerrar={() => setModal(null)} />
      )}

      {/* Barra superior */}
      <div className="bg-white border border-gray-300 rounded-lg px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-gray-600">Jornada</label>
          <input type="date" value={fecha} onChange={e => { setFecha(e.target.value); setSel(null); }}
            className="border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>
        <button onClick={() => { fetchHojas(); fetchSaldo(); }}
          className="border border-gray-300 rounded px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50">
          Actualizar
        </button>
        {hojaAbierta && (
          <span className="ml-auto text-xs text-gray-500">
            Hoja abierta <b className="font-mono">#{hojaAbierta.HojaId}</b>
            {hojaAbierta.NombreEncargado ? ` · ${hojaAbierta.NombreEncargado}` : ""}
          </span>
        )}
      </div>

      {error && <div className="bg-red-50 border border-red-300 text-red-700 text-sm px-4 py-2 rounded">⚠ {error}</div>}

      <InventarioPiso saldo={saldo} resumen={resumen} puedeCrear={puedeCrear}
        onDescongelar={(titulo, lineas) => setModal({ titulo, lineas })} />

      {/* Lista de hojas de la jornada */}
      <div className="bg-white border border-gray-300 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Hoja</th>
              <th className="px-3 py-2 text-left font-semibold">Inicio</th>
              <th className="px-3 py-2 text-left font-semibold">Propiedad</th>
              <th className="px-3 py-2 text-left font-semibold">Encargado</th>
              <th className="px-3 py-2 text-right font-semibold">Entrada</th>
              <th className="px-3 py-2 text-right font-semibold">Descongelado</th>
              <th className="px-3 py-2 text-right font-semibold">Merma</th>
              <th className="px-3 py-2 text-right font-semibold">Rend.</th>
              <th className="px-3 py-2 text-center font-semibold">Estatus</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {cargando && hojas.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Cargando…</td></tr>
            ) : hojas.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                Sin hojas de descongelado el {fmtDia(fecha)}</td></tr>
            ) : hojas.map(h => (
              <tr key={h.HojaId} onClick={() => abrirDetalle(h.HojaId)}
                className={`cursor-pointer hover:bg-blue-50 ${sel?.HojaId === h.HojaId ? "bg-blue-50" : ""}`}>
                <td className="px-3 py-2 font-mono text-xs font-semibold">#{h.HojaId}</td>
                <td className="px-3 py-2 tabular-nums">{h.HoraInicio?.slice(11) || "—"}</td>
                <td className="px-3 py-2 text-xs">{h.Propiedad}</td>
                <td className="px-3 py-2 truncate max-w-[14rem]">{h.NombreEncargado || h.Encargado || "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtNum(h.KgEntrada)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtNum(h.KgDescongelado)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtNum(h.KgMerma)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${colorRendimiento(h.Rendimiento)}`}>
                  {h.Rendimiento != null ? `${fmtNum(h.Rendimiento)}%` : "—"}
                </td>
                <td className="px-3 py-2 text-center">
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${ESTATUS_BADGE[h.Estatus]}`}>{h.Estatus}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detalle de la hoja seleccionada */}
      {sel && (
        <div className="space-y-4">
          <div className="bg-gray-800 text-white rounded-lg px-4 py-3 flex flex-wrap items-center gap-4">
            <div>
              <h2 className="font-bold">Descongelado de Materia Prima — Hoja #{sel.HojaId}</h2>
              <p className="text-gray-300 text-xs mt-0.5">
                {fmtDia(sel.FechaProduccion)} · {sel.Propiedad} · {sel.NombreEncargado || sel.Encargado}
                {sel.Personas ? ` · ${sel.Personas} personas` : ""}
                {sel.HoraInicio ? ` · inicio ${sel.HoraInicio.slice(11)}` : ""}
                {sel.HoraFin ? ` · fin ${sel.HoraFin.slice(11)}` : ""}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {sel.Estatus === "Abierta" && puedeCerrar && (
                <>
                  <label className="text-xs text-gray-300">Hora fin</label>
                  <input type="time" value={horaFin} onChange={e => setHoraFin(e.target.value)}
                    title="Si se deja vacío se usa la hora actual"
                    className="bg-gray-700 border border-gray-500 rounded px-2 py-1 text-sm text-white" />
                  <button onClick={cerrarHoja}
                    className="bg-green-600 rounded px-4 py-1.5 text-sm font-semibold hover:bg-green-700">
                    Cerrar hoja
                  </button>
                </>
              )}
              {sel.Estatus === "Cerrada" && puedeCerrar && (
                <button onClick={reabrirHoja}
                  className="bg-amber-600 rounded px-4 py-1.5 text-sm font-semibold hover:bg-amber-700">
                  Reabrir
                </button>
              )}
              <button onClick={() => setSel(null)}
                className="border border-gray-500 rounded px-3 py-1.5 text-sm hover:bg-gray-700">Cerrar vista</button>
            </div>
          </div>

          <SeccionEntrada hoja={sel} puedeEditar={editable}
            onBorrar={puedeBorrar ? borrarRenglon : () => {}} />
          <SeccionSalida hoja={sel} areas={areas} puedeEditar={editable}
            onAgregar={agregarRenglon("salida")} onBorrar={puedeBorrar ? borrarRenglon : () => {}} />
          <SeccionDevoluciones hoja={sel} clases={clases} tallas={tallas} puedeEditar={editable}
            onAgregar={agregarRenglon("devolucion")} onBorrar={puedeBorrar ? borrarRenglon : () => {}} />
          <Cuadre hoja={sel} />
        </div>
      )}
    </div>
  );
}
