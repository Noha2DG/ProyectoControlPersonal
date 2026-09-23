// Descongelado de Materia Prima — la versión en pantalla del formulario FR-7.13-13.
//
// La pantalla ya NO copia la forma del papel. El papel tiene dos secciones —  lo que entró y lo que
// salió pesado—  porque una hoja no puede restar sola: hay que escribir los dos números para poder
// compararlos después. Acá el sistema resta, así que pedir la misma línea dos veces (una para
// declararla y otra para buscarla en un combo y ponerle peso y destino) era trabajo que solo
// existía para imitar una limitación del papel. Una jornada de dieciséis lotes eran treinta y dos
// capturas para dieciséis movimientos reales.
//
// Ahora es un solo gesto: en el inventario al piso se elige qué bajar, se dice a dónde va y con eso
// queda descongelado. La hoja se muestra en UNA tabla donde lo declarado y lo pesado son dos
// columnas de la misma fila, con su diferencia al lado — que es la pregunta que el papel obliga a
// contestar cruzando dos secciones con el dedo.
//
// Lo que NO cambió es el modelo: sigue habiendo dos movimientos de kardex por renglón (el consumo
// del piso a la hoja y el traslado de la hoja al área siguiente), porque la hoja sigue siendo un
// lugar por el que el producto pasa. Cambió la pantalla, no el inventario.
import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import { fmtNum } from "../utils/numero.js";
import { authHeader, usePuede } from "../context/AuthContext.jsx";
import { useAviso } from "../hooks/useAviso.js";
import AvisoModal from "../components/AvisoModal.jsx";
import EmpleadoAutocomplete from "../components/EmpleadoAutocomplete.jsx";

const API = "/api/descongelado";

const hoyGT = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });

const horaGT = () =>
  new Date().toLocaleTimeString("es-GT", { hour12: false, hour: "2-digit", minute: "2-digit", timeZone: "America/Guatemala" });

// Las fechas puras (YYYY-MM-DD) se parten a mano: new Date("2026-09-21") se interpreta como
// medianoche UTC y en Guatemala se muestra un día antes (ver utils/fecha.js).
const fmtDia = (iso) => {
  if (!iso) return "—";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

async function leerJSON(res) { try { return await res.json(); } catch { return {}; } }

// Un rendimiento por debajo del 90 % o por encima del 100 % casi siempre es un error de captura,
// no un dato de proceso: se marca en ámbar para que salte a la vista sin bloquear el cierre.
function colorRendimiento(r) {
  if (r == null) return "text-gray-400";
  if (r > 100 || r < 90) return "text-amber-600";
  return "text-gray-800";
}

/* ── Destino ──────────────────────────────────────────────────────── */
// A dónde va lo descongelado: una BODEGA VIRTUAL del catálogo, y nada más.
//
// La bodega es la unidad con la que se lleva el inventario al piso, así que es también la única
// altura a la que el destino significa algo. Ofrecer además el área de abajo —  "Pelado Selecto" en
// vez de "Pelado"—  hacía escoger entre treinta y ocho opciones para mover el saldo de catorce
// lugares: el operador tenía que acertarle a una distinción que el inventario después ignora.
//
// La lista viene de /bodegas, que ya filtra Activo = 1 y LlevaPiso = 1 y las ordena por el flujo
// del proceso. Las que solo existen como origen de polín (Bodega, Devoluciones) no aparecen: ahí no
// se puede dejar producto a granel.
const pagoDestino = (v) => v ? { BodegaDestino: v } : null;

function SelectorDestino({ destinos, value, onChange, ancho = "w-full", vacio = "¿A dónde va?…", chico = false }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className={`${ancho} border rounded ${chico ? "px-1.5 py-0.5 text-xs" : "px-2 py-1 text-sm"}
        ${value ? "border-gray-300" : "border-amber-400 bg-amber-50"}
        focus:outline-none focus:ring-2 focus:ring-blue-400`}>
      <option value="">{vacio}</option>
      {destinos.map(b => <option key={b.Codigo} value={b.Codigo}>{b.Nombre}</option>)}
    </select>
  );
}

const valorDestinoDe = (l) => l?.BodegaDestino || "";
const nombreDestinoDe = (l) => l?.NombreBodegaDestino || l?.BodegaDestino || "—";

/* ── Modal: descongelar ───────────────────────────────────────────── */
// El único punto de captura del módulo. Confirma tres cosas a la vez —  cuántos masters bajaron de
// verdad, a dónde van y (si alguien lo pesó) cuánto pesaron—  y con eso el producto queda
// descongelado. No hay un segundo paso: presionar el botón ES la confirmación de que ya se hizo.
//
// Los kilos declarados se DERIVAN de los masters y no se teclean nunca: si se pudieran escribir
// habría dos verdades sobre el mismo peso y el cuadre del día dejaría de significar algo.
//
// Sirve para una remisión entera o para una línea suelta. En el primer caso el destino se pone una
// vez arriba y baja a todas las líneas, porque lo normal es que una remisión entera vaya al mismo
// lado; la que no, se corrige en su propia fila.
function ModalDescongelar({ titulo, lineas, hojaAbierta, destinos, empleados, auxiliares, onConfirmar, onCerrar }) {
  const clave = l => `${l.RemisionId ?? "-"}|${l.Lote}|${l.Clase}|${l.Talla}`;

  const [fila, setFila] = useState(() => Object.fromEntries(lineas.map(l =>
    [clave(l), { masters: String(l.Masters ?? 0), destino: "", peso: "" }])));
  const [termo, setTermo] = useState("");
  const [pesar, setPesar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [cab, setCab] = useState({ Encargado: "", Personas: "", HoraInicio: horaGT() });
  const [personasTocado, setPersonasTocado] = useState(false);

  const set = (l, k) => (v) => setFila(f => ({ ...f, [clave(l)]: { ...f[clave(l)], [k]: v } }));
  const de = (l) => fila[clave(l)] ?? { masters: "0", destino: "", peso: "" };

  // Personas son los AUXILIARES: todos los que pasaron por el área en la jornada, menos el
  // encargado, que va aparte. Se recalcula al elegir encargado —  si él mismo aparece en la lista,
  // el número baja solo—  y deja de recalcularse en cuanto alguien lo escribe a mano.
  const auxiliaresSinEncargado = auxiliares.filter(a => a.Codigo !== cab.Encargado);
  useEffect(() => {
    if (!personasTocado) setCab(c => ({ ...c, Personas: String(auxiliaresSinEncargado.length) }));
  }, [auxiliaresSinEncargado.length, personasTocado]);

  const mastersDe = l => Math.max(0, Math.min(Number(de(l).masters) || 0, l.Masters ?? 0));
  const kgDe = l => Number((mastersDe(l) * (l.KgPorMaster || 0)).toFixed(2));
  const pesoDe = l => { const p = Number(de(l).peso); return p > 0 ? p : kgDe(l); };

  const activas = lineas.filter(l => mastersDe(l) > 0);
  const totalM = activas.reduce((s, l) => s + mastersDe(l), 0);
  const totalKg = Number(activas.reduce((s, l) => s + kgDe(l), 0).toFixed(2));
  const totalPesado = Number(activas.reduce((s, l) => s + pesoDe(l), 0).toFixed(2));
  const faltanM = lineas.reduce((s, l) => s + Math.max(0, (l.Masters ?? 0) - mastersDe(l)), 0);
  const sinDestino = activas.filter(l => !de(l).destino);

  const listo = totalM > 0 && sinDestino.length === 0 && (hojaAbierta || cab.Encargado);

  // "Enviar todo a" no es un valor aparte: escribe el destino en cada fila, para que después se
  // pueda cambiar una sin que el resto se mueva.
  const aplicarATodas = (v) => setFila(f => {
    const n = { ...f };
    for (const l of lineas) if (mastersDe(l) > 0) n[clave(l)] = { ...n[clave(l)], destino: v };
    return n;
  });
  const destinoComun = activas.length && activas.every(l => de(l).destino === de(activas[0]).destino)
    ? de(activas[0]).destino : "";

  const confirmar = async () => {
    setGuardando(true);
    try {
      await onConfirmar(
        activas.map(l => ({ linea: l, Masters: mastersDe(l), Peso: pesar ? pesoDe(l) : null, destino: pagoDestino(de(l).destino) })),
        hojaAbierta ? null : cab,
        termo.trim() || null,
      );
    } finally { setGuardando(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl flex flex-col max-h-[92vh]">
        <div className="px-5 py-3 border-b flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-bold text-gray-800">Descongelar</h2>
            <p className="text-xs text-gray-500 mt-0.5">{titulo}</p>
          </div>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        {/* Controles que aplican a todo el lote */}
        <div className="px-5 py-2.5 bg-gray-50 border-b flex flex-wrap items-center gap-3 shrink-0">
          {lineas.length > 1 && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-gray-600">Enviar todo a</label>
              <SelectorDestino destinos={destinos} value={destinoComun} onChange={aplicarATodas}
                ancho="w-60" vacio="Escoja la bodega…" />
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-gray-600">Termo N°</label>
            <input value={termo} onChange={e => setTermo(e.target.value)} placeholder="opcional"
              className="w-24 border border-gray-300 rounded px-2 py-1 text-sm" />
          </div>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
            <input type="checkbox" checked={pesar} onChange={e => setPesar(e.target.checked)} />
            Pesé en báscula
          </label>
        </div>

        <div className="px-5 py-3 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 uppercase border-b">
              <tr>
                <th className="py-2 text-left font-semibold">Lote</th>
                <th className="py-2 text-left font-semibold">Producto</th>
                <th className="py-2 text-left font-semibold">Talla</th>
                <th className="py-2 text-right font-semibold">Al piso</th>
                <th className="py-2 text-right font-semibold">Masters</th>
                <th className="py-2 text-right font-semibold">Kg</th>
                {pesar && <th className="py-2 text-right font-semibold">Pesado</th>}
                <th className="py-2 text-left font-semibold pl-3">Destino</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lineas.map(l => {
                const m = mastersDe(l);
                const falta = (l.Masters ?? 0) - m;
                return (
                  <tr key={clave(l)} className={m === 0 ? "opacity-40" : ""}>
                    <td className="py-1.5 font-mono text-xs">{l.Lote}</td>
                    <td className="py-1.5 text-xs">
                      <span className="font-mono text-gray-500">{l.Clase}</span> {l.DescripcionClase}
                    </td>
                    <td className="py-1.5 text-xs">{l.DescripcionTalla}</td>
                    <td className="py-1.5 text-right tabular-nums text-xs text-gray-500">
                      {l.Masters} m · {fmtNum(l.Kg)}
                    </td>
                    <td className="py-1.5 text-right">
                      <input type="number" min="0" max={l.Masters} step="1" value={de(l).masters}
                        onChange={e => set(l, "masters")(e.target.value)}
                        className={`w-16 border rounded px-2 py-1 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-400
                          ${falta > 0 && m > 0 ? "border-amber-400 bg-amber-50" : "border-gray-300"}`} />
                    </td>
                    <td className="py-1.5 text-right tabular-nums font-semibold w-20">{fmtNum(kgDe(l))}</td>
                    {pesar && (
                      <td className="py-1.5 text-right">
                        <input type="number" min="0" step="0.01" value={de(l).peso}
                          onChange={e => set(l, "peso")(e.target.value)} placeholder={fmtNum(kgDe(l))}
                          className="w-24 border border-gray-300 rounded px-2 py-1 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-400" />
                      </td>
                    )}
                    <td className="py-1.5 pl-3">
                      {m > 0 && (
                        <SelectorDestino destinos={destinos} value={de(l).destino}
                          onChange={set(l, "destino")} ancho="w-56" chico />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2">
              <tr>
                <td colSpan={4} className="py-2 text-right text-xs font-bold text-gray-600 uppercase">Total</td>
                <td className="py-2 text-right tabular-nums font-bold">{totalM} m</td>
                <td className="py-2 text-right tabular-nums font-bold">{fmtNum(totalKg)}</td>
                {pesar && <td className="py-2 text-right tabular-nums font-bold">{fmtNum(totalPesado)}</td>}
                <td></td>
              </tr>
            </tfoot>
          </table>

          {faltanM > 0 && (
            <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              Quedan <b>{faltanM} master{faltanM !== 1 ? "s" : ""}</b> sin bajar. Siguen al piso hasta que se
              descongelen o se devuelvan a bodega.
            </p>
          )}
          {pesar && Math.abs(totalPesado - totalKg) > 0.001 && (
            <p className="mt-2 text-xs text-gray-600">
              {totalPesado < totalKg
                ? <>Pesaron <b>{fmtNum(totalKg - totalPesado)} kg menos</b> que lo declarado — esa diferencia sale como merma al cerrar la hoja.</>
                : <>Pesaron <b>{fmtNum(totalPesado - totalKg)} kg más</b> que lo declarado. Revise la báscula: la hoja no cierra si sale más de lo que entró.</>}
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

        <div className="px-5 py-3 border-t flex items-center gap-3 shrink-0">
          <span className="text-xs text-gray-500">
            {hojaAbierta
              ? <>Se agrega a la hoja <b>#{hojaAbierta.HojaId}</b>{hojaAbierta.NombreEncargado ? ` · ${hojaAbierta.NombreEncargado}` : ""}</>
              : "Se abrirá la hoja del día"}
            {sinDestino.length > 0 && <span className="text-amber-700 font-semibold"> · falta el destino de {sinDestino.length} línea{sinDestino.length !== 1 ? "s" : ""}</span>}
          </span>
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
// solo cuando se descongela; nadie lo teclea ni lo arrastra de un día a otro.
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
    if (!g) { g = { clave, Folio: r.FolioRemision, ConfirmadaEn: r.ConfirmadaEn, lineas: [], Kg: 0, Masters: 0 }; grupos.push(g); }
    g.lineas.push(r); g.Kg += r.Kg; g.Masters += r.Masters || 0;
  }

  return (
    <section className="bg-white border border-gray-300 rounded-lg overflow-hidden">
      <header className="bg-gray-100 border-b border-gray-300 px-4 py-2 flex items-center gap-3">
        <button onClick={() => setAbierto(a => !a)}
          className="text-gray-500 hover:text-gray-800 text-xs font-bold w-4">{abierto ? "▾" : "▸"}</button>
        <h3 className="font-bold text-sm text-gray-700">AL PISO</h3>
        <span className="text-xs text-gray-500">
          sin descongelar · {grupos.length} {grupos.length === 1 ? "remisión" : "remisiones"}
        </span>
        <span className="ml-auto flex items-baseline gap-4 text-sm">
          {resumen && resumen.IngresadoKg > 0 && (
            <span className="text-xs text-gray-500">
              Ingresó hoy <b className="font-mono tabular-nums text-gray-700">{fmtNum(resumen.IngresadoKg)} kg</b>
            </span>
          )}
          <span className="font-mono tabular-nums font-bold text-gray-800">
            {fmtNum(totalKg)} kg {totalM > 0 && <span className="font-normal text-gray-500">· {totalM} masters</span>}
          </span>
        </span>
      </header>
      {abierto && (
        <div className="overflow-x-auto max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Lote</th>
                <th className="px-3 py-2 text-left font-semibold">Producto</th>
                <th className="px-3 py-2 text-left font-semibold">Talla</th>
                <th className="px-3 py-2 text-left font-semibold">Entró</th>
                <th className="px-3 py-2 text-right font-semibold">Días</th>
                <th className="px-3 py-2 text-right font-semibold">Masters</th>
                <th className="px-3 py-2 text-right font-semibold">Kg</th>
                <th className="px-3 py-2 w-32"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {saldo.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400 text-xs">
                  Nada al piso. El producto aparece aquí cuando bodega confirma una remisión al área.</td></tr>
              ) : grupos.map(g => (
                <Fragment key={g.clave}>
                  <tr className="bg-blue-50 border-t border-blue-200">
                    <td colSpan={4} className="px-3 py-1.5 font-semibold text-blue-900 text-xs">
                      {g.Folio || "Sin remisión (ajuste)"}
                      {g.ConfirmadaEn && <span className="font-normal text-blue-600 ml-2">confirmada {g.ConfirmadaEn}</span>}
                      <span className="font-normal text-blue-600 ml-2">· {g.lineas.length} línea{g.lineas.length !== 1 ? "s" : ""}</span>
                    </td>
                    <td className="px-3 py-1.5"></td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-xs font-semibold text-blue-900">{g.Masters || "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-bold text-blue-900">{fmtNum(g.Kg)}</td>
                    <td className="px-3 py-1.5 text-center">
                      {puedeCrear && (
                        <button onClick={() => onDescongelar(g.Folio || "Sin remisión", g.lineas)}
                          className="bg-blue-600 text-white rounded px-3 py-1 text-xs font-semibold hover:bg-blue-700 whitespace-nowrap">
                          Descongelar todo
                        </button>
                      )}
                    </td>
                  </tr>
                  {g.lineas.map(r => (
                    <tr key={`${g.clave}|${r.Lote}|${r.Clase}|${r.Talla}`} className="hover:bg-gray-50">
                      <td className="px-3 py-1.5 pl-6 font-mono text-xs">{r.Lote}</td>
                      <td className="px-3 py-1.5 text-xs"><span className="font-mono text-gray-500">{r.Clase}</span> {r.DescripcionClase}</td>
                      <td className="px-3 py-1.5 text-xs">{r.DescripcionTalla}</td>
                      <td className="px-3 py-1.5 text-xs text-gray-500">{fmtDia(r.FechaIngreso)}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums text-xs ${r.DiasAlPiso > 2 ? "text-amber-600 font-bold" : "text-gray-500"}`}>
                        {r.DiasAlPiso ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.Masters ?? "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmtNum(r.Kg)}</td>
                      <td className="px-3 py-1.5 text-center">
                        {/* Siempre visible, nunca escondido tras el hover: esto se usa en el
                            handheld del área y ahí no existe pasar el mouse por encima. */}
                        {puedeCrear && (
                          <button onClick={() => onDescongelar(`${r.FolioRemision || ""} · ${r.Lote}`, [r])}
                            className="border border-blue-300 text-blue-700 rounded px-2.5 py-0.5 text-xs font-semibold hover:bg-blue-50 whitespace-nowrap">
                            Solo este
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

/* ── La hoja: lo descongelado ─────────────────────────────────────── */
// UNA tabla donde antes había dos. Cada fila es un renglón real —  bajó del piso y se fue al área
// siguiente—  con lo declarado y lo pesado uno al lado del otro. En el papel eso son dos secciones
// que hay que cruzar con el dedo para saber si cuadran; acá la diferencia es una columna.
//
// Las filas se arman por ConsumoId, no comparando lote y talla: una misma línea puede irse partida
// a dos áreas distintas y ahí la comparación de campos deja de distinguir cuál es cuál.
function filasDeHoja(hoja) {
  const filas = [];
  const traslados = hoja.descongelado || [];
  for (const e of hoja.entrada || []) {
    const hijos = traslados.filter(d => d.ConsumoId === e.MovimientoId);
    if (!hijos.length) filas.push({ clave: `e${e.MovimientoId}`, entrada: e, salida: null, ref: e });
    else hijos.forEach((d, i) => filas.push({ clave: `d${d.MovimientoId}`, entrada: i === 0 ? e : null, salida: d, ref: d }));
  }
  // Renglones del flujo de dos pasos, anteriores a ConsumoId: no tienen a quién pegarse, así que
  // van sueltos en vez de desaparecer de la pantalla.
  for (const d of traslados) if (!d.ConsumoId) filas.push({ clave: `d${d.MovimientoId}`, entrada: null, salida: d, ref: d });
  return filas;
}

function TablaDescongelado({ hoja, destinos, puedeEditar, puedeBorrar, onCorregir, onBorrar }) {
  const [editando, setEditando] = useState(null);   // MovimientoId del traslado en edición
  const [f, setF] = useState({ peso: "", destino: "", termo: "" });

  const filas = filasDeHoja(hoja);

  const empezar = (d) => {
    setEditando(d.MovimientoId);
    setF({ peso: String(d.PesoKg ?? ""), destino: valorDestinoDe(d), termo: d.NumeroTermo || "" });
  };
  const guardar = async () => {
    const ok = await onCorregir(editando, { Peso: Number(f.peso), NumeroTermo: f.termo, ...pagoDestino(f.destino) });
    if (ok) setEditando(null);
  };

  return (
    <section className="bg-white border border-gray-300 rounded-lg overflow-hidden">
      <header className="bg-gray-100 border-b border-gray-300 px-4 py-2 flex items-center gap-3">
        <h3 className="font-bold text-sm text-gray-700">DESCONGELADO</h3>
        <span className="text-xs text-gray-500">{filas.length} renglón{filas.length !== 1 ? "es" : ""}</span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Lote</th>
              <th className="px-3 py-2 text-left font-semibold">Producto</th>
              <th className="px-3 py-2 text-left font-semibold">Talla</th>
              <th className="px-3 py-2 text-left font-semibold">Remisión</th>
              <th className="px-3 py-2 text-right font-semibold">Masters</th>
              <th className="px-3 py-2 text-right font-semibold">Declarado</th>
              <th className="px-3 py-2 text-right font-semibold">Pesado</th>
              <th className="px-3 py-2 text-right font-semibold">Dif.</th>
              <th className="px-3 py-2 text-left font-semibold">Enviado a</th>
              <th className="px-3 py-2 text-left font-semibold">Termo</th>
              <th className="px-3 py-2 w-20"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filas.length === 0 && (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400 text-xs">
                Todavía no se ha descongelado nada. Use <b>Descongelar</b> en el inventario al piso.</td></tr>
            )}
            {filas.map(({ clave, entrada, salida, ref }) => {
              const dif = entrada && salida ? Number((entrada.PesoKg - salida.PesoKg).toFixed(2)) : null;
              const enEdicion = salida && editando === salida.MovimientoId;
              return (
                <tr key={clave} className={enEdicion ? "bg-blue-50" : "hover:bg-gray-50"}>
                  <td className="px-3 py-1.5 font-mono text-xs">{ref.Lote}</td>
                  <td className="px-3 py-1.5 text-xs">
                    <span className="font-mono text-gray-500">{ref.Clase}</span> {ref.DescripcionClase}
                  </td>
                  <td className="px-3 py-1.5 text-xs">{ref.DescripcionTalla}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-blue-700">{ref.FolioRemision || "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{entrada?.Masters ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{entrada ? fmtNum(entrada.PesoKg) : "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">
                    {enEdicion
                      ? <input type="number" min="0" step="0.01" value={f.peso} autoFocus
                          onChange={e => setF(p => ({ ...p, peso: e.target.value }))}
                          className="w-24 border border-gray-300 rounded px-2 py-0.5 text-sm text-right tabular-nums" />
                      : salida ? fmtNum(salida.PesoKg)
                      : <span className="text-amber-600 text-xs font-normal">sin despachar</span>}
                  </td>
                  <td className={`px-3 py-1.5 text-right tabular-nums text-xs ${dif > 0.004 ? "text-amber-600 font-semibold" : "text-gray-400"}`}>
                    {dif == null ? "—" : dif === 0 ? "—" : fmtNum(dif)}
                  </td>
                  <td className="px-3 py-1.5 text-xs">
                    {enEdicion
                      ? <SelectorDestino destinos={destinos} value={f.destino}
                          onChange={v => setF(p => ({ ...p, destino: v }))} ancho="w-48" chico />
                      : nombreDestinoDe(salida)}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs">
                    {enEdicion
                      ? <input value={f.termo} onChange={e => setF(p => ({ ...p, termo: e.target.value }))}
                          className="w-16 border border-gray-300 rounded px-2 py-0.5 text-sm" />
                      : (salida?.NumeroTermo || "—")}
                  </td>
                  <td className="px-3 py-1.5 text-center whitespace-nowrap">
                    {enEdicion ? (
                      <>
                        <button onClick={guardar} title="Guardar"
                          className="text-green-600 hover:text-green-800 font-bold px-1">✓</button>
                        <button onClick={() => setEditando(null)} title="Cancelar"
                          className="text-gray-400 hover:text-gray-600 font-bold px-1">✕</button>
                      </>
                    ) : (
                      <>
                        {puedeEditar && salida && (
                          <button onClick={() => empezar(salida)} title="Corregir peso, destino o termo"
                            className="text-gray-400 hover:text-blue-600 text-base px-1.5">✎</button>
                        )}
                        {puedeBorrar && (
                          <button onClick={() => onBorrar(ref.MovimientoId)} title="Quitar el renglón y devolverlo al piso"
                            className="text-gray-400 hover:text-red-600 text-lg leading-none px-1.5">&times;</button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-gray-100 border-t-2 border-gray-300">
            <tr className="font-bold">
              <td colSpan={5} className="px-3 py-2 text-right text-xs text-gray-600 uppercase">Totales</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNum(hoja.KgEntrada)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-base">{fmtNum(hoja.KgDescongelado)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-xs">
                {fmtNum(Number((hoja.KgEntrada - hoja.KgDescongelado).toFixed(2)))}
              </td>
              <td colSpan={3}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/* ── Devoluciones a bodega ────────────────────────────────────────── */
// Producto que bajó del piso y regresa sin descongelar. Va colapsada porque es la excepción: en las
// hojas reales del 21-sep no hubo ninguna.
function SeccionDevoluciones({ hoja, clases, tallas, puedeEditar, onAgregar, onBorrar }) {
  const vacio = { Lote: "", Clase: "", Talla: "900", Masters: "", Peso: "", Motivo: "" };
  const [f, setF] = useState(vacio);
  const [abierto, setAbierto] = useState((hoja.devoluciones?.length ?? 0) > 0);
  const set = k => v => setF(p => ({ ...p, [k]: v }));
  const agregar = async () => { if (await onAgregar(f)) setF(vacio); };

  return (
    <section className="bg-white border border-gray-300 rounded-lg overflow-hidden">
      <header className="bg-gray-100 border-b border-gray-300 px-4 py-2 flex items-center gap-3">
        <button onClick={() => setAbierto(a => !a)}
          className="text-gray-500 hover:text-gray-800 text-xs font-bold w-4">{abierto ? "▾" : "▸"}</button>
        <h3 className="font-bold text-sm text-gray-700">DEVOLUCIONES A BODEGA</h3>
        <span className="text-xs text-gray-500">sin descongelar</span>
        <span className="ml-auto font-mono tabular-nums text-sm font-bold text-gray-800">{fmtNum(hoja.KgDevuelto)} kg</span>
      </header>
      {abierto && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Lote</th>
                <th className="px-3 py-2 text-left font-semibold">Producto</th>
                <th className="px-3 py-2 text-left font-semibold">Talla</th>
                <th className="px-3 py-2 text-right font-semibold">Masters</th>
                <th className="px-3 py-2 text-right font-semibold">Kg</th>
                <th className="px-3 py-2 text-left font-semibold">Motivo</th>
                <th className="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {hoja.devoluciones.length === 0 && !puedeEditar && (
                <tr><td colSpan={7} className="px-4 py-4 text-center text-gray-400 text-xs">Sin devoluciones.</td></tr>
              )}
              {hoja.devoluciones.map(l => (
                <tr key={l.MovimientoId} className="hover:bg-gray-50">
                  <td className="px-3 py-1.5 font-mono text-xs">{l.Lote}</td>
                  <td className="px-3 py-1.5 text-xs"><span className="font-mono text-gray-500">{l.Clase}</span> {l.DescripcionClase}</td>
                  <td className="px-3 py-1.5 text-xs">{l.DescripcionTalla}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{l.Masters ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmtNum(l.PesoKg)}</td>
                  <td className="px-3 py-1.5 text-xs text-gray-600">{l.Motivo || "—"}</td>
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
                  <td className="px-3 py-2">
                    <input value={f.Lote} onChange={e => set("Lote")(e.target.value.toUpperCase())} placeholder="Lote"
                      className="w-32 border border-gray-300 rounded px-2 py-1 text-sm" />
                  </td>
                  <td className="px-3 py-2">
                    <select value={f.Clase} onChange={e => set("Clase")(e.target.value)}
                      className="w-40 border border-gray-300 rounded px-2 py-1 text-sm">
                      <option value="">Producto…</option>
                      {clases.map(c => <option key={c.Clase} value={c.Clase}>{c.Clase} {c.Descripcion}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select value={f.Talla} onChange={e => set("Talla")(e.target.value)}
                      className="w-28 border border-gray-300 rounded px-2 py-1 text-sm">
                      {tallas.map(t => <option key={t.Codigo} value={t.Codigo}>{t.Descripcion}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input type="number" min="0" step="1" value={f.Masters} onChange={e => set("Masters")(e.target.value)}
                      className="w-20 border border-gray-300 rounded px-2 py-1 text-sm text-right tabular-nums" />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input type="number" min="0" step="0.01" value={f.Peso} onChange={e => set("Peso")(e.target.value)}
                      placeholder="0.00"
                      className="w-24 border border-gray-300 rounded px-2 py-1 text-sm text-right tabular-nums" />
                  </td>
                  <td className="px-3 py-2">
                    <input value={f.Motivo} onChange={e => set("Motivo")(e.target.value)} placeholder="Por qué regresa"
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm" />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button onClick={agregar} disabled={!f.Lote || !f.Clase || !(Number(f.Peso) > 0)}
                      className="bg-blue-600 text-white rounded px-2 py-1 text-xs font-semibold hover:bg-blue-700 disabled:opacity-40">+</button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ── El cuadre, como tiras de números ─────────────────────────────── */
// Era una tabla al final de la pantalla. Es una resta de cuatro términos: cabe en una línea y así
// se lee sin bajar, que es donde importa mientras la hoja está abierta.
function Cuadre({ hoja }) {
  const pendiente = Number((hoja.KgEntrada - hoja.KgDescongelado - hoja.KgDevuelto - hoja.KgMerma).toFixed(2));
  const tiles = [
    { t: "Entrada declarada", v: hoja.KgEntrada, c: "text-gray-800" },
    { t: "Descongelado", v: hoja.KgDescongelado, c: "text-blue-700" },
    { t: "Devuelto a bodega", v: hoja.KgDevuelto, c: "text-gray-800" },
    { t: hoja.Estatus === "Cerrada" ? "Merma" : "Merma al cerrar",
      v: hoja.Estatus === "Cerrada" ? hoja.KgMerma : pendiente,
      c: (hoja.Estatus === "Cerrada" ? hoja.KgMerma : pendiente) > 0.004 ? "text-amber-600" : "text-gray-400" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-gray-300 border border-gray-300 rounded-lg overflow-hidden">
      {tiles.map(x => (
        <div key={x.t} className="bg-white px-4 py-2.5">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold truncate">{x.t}</div>
          <div className={`font-mono tabular-nums text-lg font-bold ${x.c}`}>{fmtNum(x.v)}<span className="text-xs font-normal text-gray-400 ml-1">kg</span></div>
        </div>
      ))}
      <div className="bg-white px-4 py-2.5">
        <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Rendimiento</div>
        <div className={`font-mono tabular-nums text-lg font-bold ${colorRendimiento(hoja.Rendimiento)}`}>
          {hoja.Rendimiento != null ? `${fmtNum(hoja.Rendimiento)}%` : "—"}
        </div>
      </div>
    </div>
  );
}

/* ── Página ───────────────────────────────────────────────────────── */
export default function DescongeladoPage() {
  const puedeCrear  = usePuede("descongelado", "crear");
  const puedeEditar = usePuede("descongelado", "editar");
  const puedeCerrar = usePuede("descongelado", "cerrar");
  const puedeBorrar = usePuede("descongelado", "eliminar");
  const { aviso, mostrarAlerta, pedirConfirmacion, cerrar } = useAviso();

  const [fecha, setFecha]   = useState(hoyGT());
  const [hojas, setHojas]   = useState([]);
  const [selId, setSelId]   = useState(null);
  const [sel, setSel]       = useState(null);     // la hoja con sus renglones
  const [clases, setClases] = useState([]);
  const [tallas, setTallas] = useState([]);
  const [destinos, setDestinos] = useState([]);
  const [saldo, setSaldo]   = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [cargando, setCargando]   = useState(false);
  const [error, setError]         = useState("");
  const [auxiliares, setAuxiliares] = useState([]);
  const [resumen, setResumen] = useState(null);
  const [modal, setModal]   = useState(null);
  const [horaFin, setHoraFin] = useState("");

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

  // El saldo al piso se recarga con cada cambio que mueve inventario: bajar 200 kg tiene que dejar
  // 200 kg menos disponibles en el acto.
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
    // Los destinos son las bodegas virtuales que llevan inventario al piso. La propia bodega de la
    // hoja se quita: mandarse producto a uno mismo no es un traslado.
    fetch(`${API}/bodegas`, h).then(leerJSON)
      .then(d => { if (Array.isArray(d)) setDestinos(d.filter(b => b.Codigo !== "DESCONGELADO")); });
    fetch("/api/empleados", h).then(leerJSON).then(d => Array.isArray(d) && setEmpleados(d.filter(e => e.Estado === "Activo")));
  }, []);

  // selId se marca ANTES de pedir el detalle, no después: es lo que corta el ciclo del efecto de
  // más abajo. Si se marcara al recibir la respuesta, una hoja que no carga dejaría selId en null y
  // el efecto volvería a pedirla en cada render, para siempre.
  const abrirDetalle = useCallback(async (id) => {
    setSelId(id);
    const res = await fetch(`${API}/hojas/${id}`, { headers: authHeader() });
    const data = await leerJSON(res);
    if (!res.ok) { setSel(null); setError(data.error || "No se pudo abrir la hoja"); return; }
    setSel(data);
  }, []);

  // Con una sola hoja en la jornada —  que es el caso normal—  se abre sola. Obligar a hacer clic en
  // una tabla de una fila para ver el trabajo del día era un paso sin contenido.
  useEffect(() => {
    if (hojas.length === 1 && selId !== hojas[0].HojaId) abrirDetalle(hojas[0].HojaId);
    if (hojas.length === 0 && selId !== null) { setSel(null); setSelId(null); }
  }, [hojas, selId, abrirDetalle]);

  const post = async (url, body, metodo = "POST") => {
    const res = await fetch(url, {
      method: metodo,
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(body),
    });
    const data = await leerJSON(res);
    if (!res.ok) { await mostrarAlerta(data.error || `Error ${res.status}`); return null; }
    return data;
  };

  const recargar = async (id) => {
    await Promise.all([fetchHojas(), fetchSaldo()]);
    if (id) await abrirDetalle(id);
  };

  // Descongelar: UN solo viaje al servidor con todas las líneas. Antes era un POST por línea desde
  // el navegador y si el quinto fallaba, los cuatro anteriores ya estaban escritos.
  const confirmarDescongelado = async (seleccion, cabecera, termo) => {
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
    const out = await post(`${API}/hojas/${hojaId}/descongelar`, {
      NumeroTermo: termo,
      lineas: seleccion.map(s => ({
        Lote: s.linea.Lote, Clase: s.linea.Clase, Talla: s.linea.Talla, RemisionId: s.linea.RemisionId,
        Masters: s.Masters, KgPorMaster: s.linea.KgPorMaster, UM: "KG",
        PesoReal: s.Peso, ...s.destino,
      })),
    });
    // El modal se queda abierto si algo falló: lo capturado no se pierde y se corrige en su sitio.
    if (!out) return;
    setModal(null);
    await recargar(hojaId);
  };

  const corregirRenglon = async (id, cambios) => {
    if (!await post(`${API}/renglon/${id}`, cambios, "PUT")) return false;
    await recargar(sel.HojaId);
    return true;
  };

  const agregarDevolucion = async (f) => {
    if (!await post(`${API}/hojas/${sel.HojaId}/devolucion`, f)) return false;
    await recargar(sel.HojaId);
    return true;
  };

  const borrarRenglon = async (id) => {
    if (!(await pedirConfirmacion("¿Quitar este renglón? Lo que había bajado regresa al inventario al piso."))) return;
    const res = await fetch(`${API}/renglon/${id}`, { method: "DELETE", headers: authHeader() });
    const data = await leerJSON(res);
    if (!res.ok) { await mostrarAlerta(data.error || "No se pudo quitar"); return; }
    await recargar(sel.HojaId);
  };

  const cerrarHoja = async () => {
    const dif = sel.KgEntrada - sel.KgDescongelado - sel.KgDevuelto;
    const fin = horaFin || horaGT();
    const msg = `Se va a cerrar la hoja y anotar ${fmtNum(dif)} kg de merma.\n\n`
      + `Entrada ${fmtNum(sel.KgEntrada)} − descongelado ${fmtNum(sel.KgDescongelado)} `
      + `− devuelto ${fmtNum(sel.KgDevuelto)} = ${fmtNum(dif)} kg.`;
    if (!(await pedirConfirmacion(`${msg}\n\nHora de finalización: ${fin}`))) return;
    const out = await post(`${API}/hojas/${sel.HojaId}/cerrar`, { HoraFin: `${fecha} ${fin}:00` });
    if (!out) return;
    await mostrarAlerta(`Hoja cerrada. Rendimiento de descongelado: ${fmtNum(out.Rendimiento)} %`, "exito");
    await recargar(sel.HojaId);
  };

  const reabrirHoja = async () => {
    if (!(await pedirConfirmacion("Se va a reabrir la hoja y borrar la merma calculada. Los renglones capturados se conservan."))) return;
    if (!await post(`${API}/hojas/${sel.HojaId}/reabrir`, {})) return;
    await recargar(sel.HojaId);
  };

  const editable = sel?.Estatus === "Abierta" && puedeCrear;

  const cabecera = useMemo(() => {
    if (!sel) return "";
    return [fmtDia(sel.FechaProduccion), sel.Propiedad, sel.NombreEncargado || sel.Encargado,
            sel.Personas ? `${sel.Personas} personas` : null,
            sel.HoraInicio ? `inicio ${sel.HoraInicio.slice(11)}` : null,
            sel.HoraFin ? `fin ${sel.HoraFin.slice(11)}` : null].filter(Boolean).join(" · ");
  }, [sel]);

  return (
    <div className="space-y-4">
      {aviso && <AvisoModal {...aviso} onCerrar={() => cerrar(true)} onCancelar={() => cerrar(false)} />}
      {/* El key ata el estado del modal al lote que se está bajando: abrir otro no puede heredar
          los masters ni los destinos del anterior. */}
      {modal && (
        <ModalDescongelar key={modal.titulo} titulo={modal.titulo} lineas={modal.lineas} hojaAbierta={hojaAbierta}
          destinos={destinos} empleados={empleados} auxiliares={auxiliares}
          onConfirmar={confirmarDescongelado} onCerrar={() => setModal(null)} />
      )}

      {/* Barra superior */}
      <div className="bg-white border border-gray-300 rounded-lg px-4 py-3 flex flex-wrap items-center gap-3">
        <h1 className="font-bold text-gray-800">Descongelado de Materia Prima</h1>
        <div className="flex items-center gap-2 ml-2">
          <label className="text-sm font-semibold text-gray-600">Jornada</label>
          <input type="date" value={fecha} onChange={e => { setFecha(e.target.value); setSel(null); setSelId(null); }}
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

      {/* Con más de una hoja (OROPSA y maquila no se mezclan) hay que escoger cuál se ve. Con una
          sola no se dibuja nada: ya está abierta abajo. */}
      {hojas.length > 1 && (
        <div className="bg-white border border-gray-300 rounded-lg px-4 py-2 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-gray-500 uppercase mr-1">Hojas de la jornada</span>
          {hojas.map(h => (
            <button key={h.HojaId} onClick={() => abrirDetalle(h.HojaId)}
              className={`rounded px-3 py-1 text-xs font-semibold border ${
                selId === h.HojaId ? "bg-blue-600 text-white border-blue-600"
                                   : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
              #{h.HojaId} · {h.Propiedad} · {fmtNum(h.KgDescongelado)} kg
              <span className={`ml-1.5 font-normal ${h.Estatus === "Abierta" ? "text-green-500" : "opacity-60"}`}>
                {h.Estatus}
              </span>
            </button>
          ))}
        </div>
      )}

      {cargando && hojas.length === 0 && (
        <div className="bg-white border border-gray-300 rounded-lg px-4 py-8 text-center text-gray-400 text-sm">Cargando…</div>
      )}
      {!cargando && hojas.length === 0 && (
        <div className="bg-white border border-gray-300 rounded-lg px-4 py-8 text-center text-gray-400 text-sm">
          Sin hojas de descongelado el {fmtDia(fecha)}. La hoja se abre sola al descongelar el primer master.
        </div>
      )}

      {/* La hoja */}
      {sel && (
        <div className="space-y-3">
          <div className="bg-gray-800 text-white rounded-lg px-4 py-3 flex flex-wrap items-center gap-4">
            <div>
              <h2 className="font-bold">Hoja #{sel.HojaId}</h2>
              <p className="text-gray-300 text-xs mt-0.5">{cabecera}</p>
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
            </div>
          </div>

          <Cuadre hoja={sel} />
          <TablaDescongelado hoja={sel} destinos={destinos}
            puedeEditar={sel.Estatus === "Abierta" && puedeEditar}
            puedeBorrar={sel.Estatus === "Abierta" && puedeBorrar}
            onCorregir={corregirRenglon} onBorrar={borrarRenglon} />
          <SeccionDevoluciones hoja={sel} clases={clases} tallas={tallas} puedeEditar={editable}
            onAgregar={agregarDevolucion} onBorrar={puedeBorrar ? borrarRenglon : () => {}} />
        </div>
      )}
    </div>
  );
}
