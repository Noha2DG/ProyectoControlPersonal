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

/* ── La cabecera de la hoja del día ────────────────────── */
// La hoja NO se abre a mano: la abre el primer movimiento del día, sea descongelar o devolver. Por
// eso sus datos —  los del encabezado del formulario de papel—  se piden dentro del modal que esté
// haciendo ese primer movimiento, y no en una pantalla aparte que no significaría nada por sí sola.
function CabeceraNuevaHoja({ cab, setCab, empleados, auxiliares }) {
  const [personasTocado, setPersonasTocado] = useState(false);

  // Personas son los AUXILIARES: todos los que pasaron por el área en la jornada, menos el
  // encargado, que va aparte. Se recalcula al elegir encargado —  si él mismo aparece en la lista,
  // el número baja solo—  y deja de recalcularse en cuanto alguien lo escribe a mano.
  const sinEncargado = auxiliares.filter(a => a.Codigo !== cab.Encargado);
  useEffect(() => {
    if (!personasTocado) setCab(c => ({ ...c, Personas: String(sinEncargado.length) }));
  }, [sinEncargado.length, personasTocado, setCab]);

  return (
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
             title={sinEncargado.map(a => `${a.Codigo} ${a.Nombre}`).join(", ")}>
            {sinEncargado.length} auxiliar{sinEncargado.length !== 1 ? "es" : ""} pasaron por el área
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
  );
}

/* ── Modal: descongelar ───────────────────────────────── */
// Confirma tres cosas a la vez —  cuántos masters bajaron de verdad, a dónde van y (si alguien lo
// pesó) cuánto pesaron—  y con eso el producto queda descongelado. No hay un segundo paso:
// presionar el botón ES la confirmación de que ya se hizo.
//
// Se elige, no se teclea. Esto se llena en el teléfono del área, donde escribir a mano
// "G430TM03-E02-9", el producto y la talla es una errata garantizada — y una errata acá inventa un
// lote que no existe y rompe la trazabilidad del despacho.
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

  const set = (l, k) => (v) => setFila(f => ({ ...f, [clave(l)]: { ...f[clave(l)], [k]: v } }));
  const de = (l) => fila[clave(l)] ?? { masters: "0", destino: "", peso: "" };

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
        activas.map(l => ({ linea: l, Masters: mastersDe(l), Peso: pesar ? pesoDe(l) : null,
                            destino: pagoDestino(de(l).destino) })),
        hojaAbierta ? null : cab,
        { NumeroTermo: termo.trim() || null },
      );
    } finally { setGuardando(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl min-w-0 flex flex-col max-h-[92vh]">
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

        <div className="px-5 py-3 overflow-y-auto overflow-x-auto">
          <table className="w-full text-sm min-w-[34rem]">
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
              Quedan <b>{faltanM} master{faltanM !== 1 ? "s" : ""}</b> sin bajar. Siguen al piso
              hasta que se descongelen o se devuelvan a bodega.
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
            <CabeceraNuevaHoja cab={cab} setCab={setCab} empleados={empleados} auxiliares={auxiliares} />
          )}
        </div>

        <div className="px-5 py-3 border-t flex flex-wrap items-center gap-x-3 gap-y-2 shrink-0">
          <span className="text-xs text-gray-500 w-full sm:w-auto">
            {hojaAbierta
              ? <>Se agrega a la hoja <b>#{hojaAbierta.HojaId}</b>{hojaAbierta.NombreEncargado ? ` · ${hojaAbierta.NombreEncargado}` : ""}</>
              : "Se abrirá la hoja del día"}
            {sinDestino.length > 0 && <span className="text-amber-700 font-semibold"> · falta el destino de {sinDestino.length} línea{sinDestino.length !== 1 ? "s" : ""}</span>}
          </span>
          <button onClick={onCerrar}
            className="ml-auto shrink-0 border border-gray-300 rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={!listo || guardando}
            className="shrink-0 whitespace-nowrap bg-blue-600 hover:bg-blue-700 text-white rounded px-5 py-1.5 text-sm font-semibold disabled:opacity-40">
            {guardando ? "Guardando…" : `Descongelar ${totalM} master${totalM !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Modal: devolver a bodega ─────────────────────────────────────── */
// Devolver NO es elegir kilos: es elegir CAJAS, con su correlativo. El piso lleva lote y kilos y no
// tiene forma de nombrar un master, así que devolver desde ahí dejaría a bodega con kilos que no
// puede posicionar y con los masters marcados 'Salido' para siempre.
//
// La identidad la conserva la remisión, que guarda cada MasterId que despachó. Por eso acá no se
// escanea nada —  en Descongelado no hay lector—  sino que se marca de la lista que salió, agrupada
// por el polín del que vino, que es como la planta la devuelve: casi siempre el polín completo.
function ModalDevolver({ titulo, datos, hojaAbierta, empleados, auxiliares, onConfirmar, onCerrar }) {
  const [sel, setSel] = useState(() => new Set());
  const [expandido, setExpandido] = useState(() => new Set());
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [cab, setCab] = useState({ Encargado: "", Personas: "", HoraInicio: horaGT() });

  const polines = datos?.polines ?? [];
  const todos = polines.flatMap(p => p.Masters);
  const claveLote = m => `${m.Lote}|${m.Clase}|${m.Talla}`;

  // Un master cuyo producto YA se descongeló no puede regresar: sus kilos salieron del piso y
  // devolverlo dejaría el saldo en negativo. El tope se cuenta por lote, y se tapa acá en vez de
  // dejar que el servidor rechace el lote entero después de marcar veinte casillas.
  const usadosPorLote = useMemo(() => {
    const m = new Map();
    for (const x of todos) if (sel.has(x.MasterId)) m.set(claveLote(x), (m.get(claveLote(x)) ?? 0) + 1);
    return m;
  }, [sel, todos]);

  const cabe = (m) => sel.has(m.MasterId) || (usadosPorLote.get(claveLote(m)) ?? 0) < m.AlPiso;
  const bloqueado = (m) => !sel.has(m.MasterId) && m.AlPiso <= 0;

  const alternar = (id) => setSel(s => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  // Marcar el polín entero es el gesto normal; se saltan las cajas cuyo producto ya se descongeló.
  const alternarPolin = (p) => setSel(s => {
    const n = new Set(s);
    const marcados = p.Masters.filter(m => n.has(m.MasterId)).length;
    if (marcados === p.Masters.length) { for (const m of p.Masters) n.delete(m.MasterId); return n; }
    const usados = new Map(usadosPorLote);
    for (const m of p.Masters) {
      if (n.has(m.MasterId)) continue;
      const k = claveLote(m);
      if ((usados.get(k) ?? 0) < m.AlPiso) { n.add(m.MasterId); usados.set(k, (usados.get(k) ?? 0) + 1); }
    }
    return n;
  });

  const marcados = todos.filter(m => sel.has(m.MasterId));
  const totalKg = Number(marcados.reduce((s, m) => s + m.KgPorMaster, 0).toFixed(2));
  const listo = marcados.length > 0 && motivo.trim() && (hojaAbierta || cab.Encargado) && !datos?.Vencida;

  const confirmar = async () => {
    setGuardando(true);
    try { await onConfirmar(marcados.map(m => m.MasterId), motivo.trim(), hojaAbierta ? null : cab); }
    finally { setGuardando(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl min-w-0 flex flex-col max-h-[92vh]">
        <div className="px-5 py-3 border-b flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-bold text-gray-800">Devolver a bodega</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {titulo}
              {datos?.ConfirmadaEn && ` · confirmada ${datos.ConfirmadaEn}`}
              {datos?.Dias != null && ` · hace ${datos.Dias} día${datos.Dias !== 1 ? "s" : ""}`}
            </p>
          </div>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="px-5 py-2.5 bg-gray-50 border-b flex items-center gap-2 shrink-0">
          <label className="text-xs font-semibold text-gray-600 shrink-0">Por qué regresa</label>
          <input value={motivo} onChange={e => setMotivo(e.target.value)}
            placeholder="No se alcanzó a procesar, se pidió de más…"
            className="flex-1 min-w-0 border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>

        <div className="px-5 py-3 overflow-y-auto">
          {datos?.Vencida && (
            <p className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              Esta remisión se confirmó hace <b>{datos.Dias} días</b> y el plazo para devolver es de {datos.DiasLimite}.
              Pasado ese plazo la devolución la tiene que hacer un administrador.
            </p>
          )}
          {polines.length === 0 && (
            <p className="py-6 text-center text-gray-400 text-xs">
              Esta remisión ya no tiene cajas que devolver.
            </p>
          )}

          {polines.map(p => {
            const nSel = p.Masters.filter(m => sel.has(m.MasterId)).length;
            const abierto = expandido.has(p.PalletId);
            return (
              <div key={p.PalletId} className="border border-gray-200 rounded mb-2 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50">
                  <input type="checkbox" checked={nSel === p.Masters.length && nSel > 0}
                    ref={el => { if (el) el.indeterminate = nSel > 0 && nSel < p.Masters.length; }}
                    onChange={() => alternarPolin(p)} className="w-4 h-4 cursor-pointer" />
                  <button onClick={() => setExpandido(s => {
                      const n = new Set(s); n.has(p.PalletId) ? n.delete(p.PalletId) : n.add(p.PalletId); return n;
                    })}
                    className="flex-1 min-w-0 text-left">
                    <span className="font-mono font-bold text-sm text-gray-800">{p.Codigo}</span>
                    <span className="text-xs text-gray-500 ml-2">{p.Estatus}</span>
                    <span className="text-xs text-gray-500 ml-2">
                      · {nSel} de {p.Masters.length} caja{p.Masters.length !== 1 ? "s" : ""}
                    </span>
                  </button>
                  <span className="text-gray-400 text-xs font-bold w-4 text-center">{abierto ? "▾" : "▸"}</span>
                </div>
                {abierto && (
                  <div className="divide-y divide-gray-100">
                    {p.Masters.map(m => (
                      <label key={m.MasterId}
                        className={`flex items-center gap-2 px-3 py-1.5 text-xs
                          ${bloqueado(m) ? "opacity-40" : "hover:bg-gray-50 cursor-pointer"}`}>
                        <input type="checkbox" checked={sel.has(m.MasterId)}
                          disabled={!cabe(m)} onChange={() => alternar(m.MasterId)}
                          className="w-4 h-4 ml-5 cursor-pointer" />
                        <span className="font-mono text-gray-700">{m.Correlativo}</span>
                        <span className="font-mono text-gray-400">{m.Lote}</span>
                        <span className="text-gray-500">{m.Clase} · {m.DescripcionTalla}</span>
                        <span className="ml-auto tabular-nums text-gray-600">{fmtNum(m.KgPorMaster)} kg</span>
                        {bloqueado(m) && <span className="text-amber-600 shrink-0">ya descongelado</span>}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {!hojaAbierta && marcados.length > 0 && (
            <CabeceraNuevaHoja cab={cab} setCab={setCab} empleados={empleados} auxiliares={auxiliares} />
          )}
        </div>

        <div className="px-5 py-3 border-t flex flex-wrap items-center gap-x-3 gap-y-2 shrink-0">
          <span className="text-xs text-gray-500 w-full sm:w-auto">
            {marcados.length > 0
              ? <>Regresan <b>{marcados.length}</b> caja{marcados.length !== 1 ? "s" : ""} · {fmtNum(totalKg)} kg ·
                  se crea un polín de devolución que bodega tiene que ubicar</>
              : "Marque las cajas que regresan"}
          </span>
          <button onClick={onCerrar}
            className="ml-auto shrink-0 border border-gray-300 rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={!listo || guardando}
            className="shrink-0 whitespace-nowrap bg-amber-600 hover:bg-amber-700 text-white rounded px-5 py-1.5 text-sm font-semibold disabled:opacity-40">
            {guardando ? "Guardando…" : `Devolver ${marcados.length} caja${marcados.length !== 1 ? "s" : ""}`}
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
function InventarioPiso({ saldo, resumen, puedeCrear, onDescongelar, onDevolver }) {
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
                <th className="px-3 py-2 w-44"></th>
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
                    <td className="px-3 py-1.5 text-center whitespace-nowrap">
                      {puedeCrear && (<>
                        <button onClick={() => onDescongelar(g.Folio || "Sin remisión", g.lineas)}
                          className="bg-blue-600 text-white rounded px-3 py-1 text-xs font-semibold hover:bg-blue-700">
                          Descongelar todo
                        </button>
                        {/* Devolver va SOLO a nivel de remisión: se rastrea por las cajas que ella
                            despachó, y un polín que regresa suele traer varios lotes. El producto
                            que entró por un ajuste no tiene remisión detrás, así que no se puede
                            devolver — no hay de dónde sacar los correlativos. */}
                        {g.clave !== "sin-remision" && (
                          <button onClick={() => onDevolver(g.clave, g.Folio)}
                            title="Regresar cajas a bodega sin descongelar"
                            className="ml-1.5 border border-amber-300 text-amber-700 rounded px-2 py-1 text-xs font-semibold hover:bg-amber-50">
                            Devolver
                          </button>
                        )}
                      </>)}
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
                      <td className="px-3 py-1.5 text-center whitespace-nowrap">
                        {/* Siempre visibles, nunca escondidos tras el hover: esto se usa en el
                            teléfono del área y ahí no existe pasar el mouse por encima. */}
                        {puedeCrear && (
                          <button onClick={() => onDescongelar(`${r.FolioRemision || ""} · ${r.Lote}`, [r])}
                            className="border border-blue-300 text-blue-700 rounded px-2.5 py-0.5 text-xs font-semibold hover:bg-blue-50">
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
// Producto que bajó del piso y regresa sin descongelar. SOLO SE LEE: la captura vive en la lista
// del piso, con el botón "Devolver", porque ahí el producto ya está escrito y solo hay que
// señalarlo. Este formulario pedía teclear lote, producto y talla a mano — en el teléfono del área
// eso es una errata garantizada, y una errata acá inventa un lote que no existe.
function SeccionDevoluciones({ hoja, puedeBorrar, onBorrar }) {
  const [abierto, setAbierto] = useState((hoja.devoluciones?.length ?? 0) > 0);

  return (
    <section className="bg-white border border-gray-300 rounded-lg overflow-hidden">
      <header className="bg-gray-100 border-b border-gray-300 px-4 py-2 flex items-center gap-3">
        <button onClick={() => setAbierto(a => !a)}
          className="text-gray-500 hover:text-gray-800 text-xs font-bold w-4">{abierto ? "▾" : "▸"}</button>
        <h3 className="font-bold text-sm text-gray-700">DEVOLUCIONES A BODEGA</h3>
        <span className="text-xs text-gray-500">
          {hoja.devoluciones.length === 0 ? "ninguna" : `${hoja.devoluciones.length} renglón${hoja.devoluciones.length !== 1 ? "es" : ""} · sin descongelar`}
        </span>
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
                <th className="px-3 py-2 text-left font-semibold">Remisión</th>
                <th className="px-3 py-2 text-right font-semibold">Masters</th>
                <th className="px-3 py-2 text-right font-semibold">Kg</th>
                <th className="px-3 py-2 text-left font-semibold">Motivo</th>
                <th className="px-3 py-2 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {hoja.devoluciones.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-400 text-xs">
                  Nada devuelto. Use <b>Devolver</b> en la lista del piso para regresar a bodega lo que
                  no se alcanzó a descongelar.</td></tr>
              )}
              {hoja.devoluciones.map(l => (
                <tr key={l.MovimientoId} className="hover:bg-gray-50">
                  <td className="px-3 py-1.5 font-mono text-xs">{l.Lote}</td>
                  <td className="px-3 py-1.5 text-xs"><span className="font-mono text-gray-500">{l.Clase}</span> {l.DescripcionClase}</td>
                  <td className="px-3 py-1.5 text-xs">{l.DescripcionTalla}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-blue-700">{l.FolioRemision || "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{l.Masters ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmtNum(l.PesoKg)}</td>
                  <td className="px-3 py-1.5 text-xs text-gray-600 truncate max-w-[18rem]">{l.Motivo || "—"}</td>
                  <td className="px-3 py-1.5 text-center">
                    {puedeBorrar && (
                      <button onClick={() => onBorrar(l.MovimientoId)}
                        title="Quitar la devolución y regresar el producto al piso"
                        className="text-gray-400 hover:text-red-600 text-lg leading-none px-1.5">&times;</button>
                    )}
                  </td>
                </tr>
              ))}
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
  const [destinos, setDestinos] = useState([]);
  const [saldo, setSaldo]   = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [cargando, setCargando]   = useState(false);
  const [error, setError]         = useState("");
  const [auxiliares, setAuxiliares] = useState([]);
  const [resumen, setResumen] = useState(null);
  const [modal, setModal]   = useState(null);   // { titulo, lineas } — descongelar
  const [devol, setDevol]   = useState(null);   // { titulo, datos }    — devolver
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

  // La hoja del día la abre el PRIMER movimiento, sea descongelar o devolver. Devuelve su id, o
  // null si no se pudo abrir (el modal se queda como está y el operador no pierde lo capturado).
  const asegurarHoja = async (cabecera) => {
    if (hojaAbierta?.HojaId) return hojaAbierta.HojaId;
    const out = await post(`${API}/hojas`, {
      FechaProduccion: fecha, BodegaCodigo: "DESCONGELADO", Propiedad: "OROPSA",
      Encargado: cabecera?.Encargado, Personas: cabecera?.Personas,
      HoraInicio: cabecera?.HoraInicio ? `${fecha} ${cabecera.HoraInicio}:00` : null,
    });
    return out ? out.HojaId : null;
  };

  // Descongelar: UN solo viaje al servidor con todas las líneas. Antes era un POST por línea desde
  // el navegador y si el quinto fallaba, los cuatro anteriores ya estaban escritos.
  const confirmarDescongelado = async (seleccion, cabecera, extra) => {
    const hojaId = await asegurarHoja(cabecera);
    if (!hojaId) return;
    const out = await post(`${API}/hojas/${hojaId}/descongelar`, {
      ...extra,
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

  // Devolver: se pregunta primero QUÉ cajas despachó esa remisión y siguen al piso. No hace falta
  // que exista una hoja para consultarlo — la hoja se abre al confirmar.
  const abrirDevolver = async (remisionId, folio) => {
    const res = await fetch(`${API}/devolvibles?remision=${remisionId}&bodega=DESCONGELADO`, { headers: authHeader() });
    const data = await leerJSON(res);
    if (!res.ok) { await mostrarAlerta(data.error || "No se pudo leer la remisión"); return; }
    setDevol({ titulo: folio || `Remisión ${remisionId}`, datos: data });
  };

  const confirmarDevolucion = async (masters, motivo, cabecera) => {
    const hojaId = await asegurarHoja(cabecera);
    if (!hojaId) return;
    const out = await post(`${API}/hojas/${hojaId}/devolver`, { Motivo: motivo, Masters: masters });
    if (!out) return;
    setDevol(null);
    await recargar(hojaId);
    await mostrarAlerta(
      `Regresaron ${out.Masters} caja${out.Masters !== 1 ? "s" : ""} (${fmtNum(out.KgDevuelto)} kg) en el polín ` +
      `${out.Polin}. Bodega tiene que ubicarlo: aparece sin posición.`, "exito");
  };

  const corregirRenglon = async (id, cambios) => {
    if (!await post(`${API}/renglon/${id}`, cambios, "PUT")) return false;
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
        <ModalDescongelar key={modal.titulo} titulo={modal.titulo} lineas={modal.lineas}
          hojaAbierta={hojaAbierta} destinos={destinos} empleados={empleados} auxiliares={auxiliares}
          onConfirmar={confirmarDescongelado} onCerrar={() => setModal(null)} />
      )}
      {devol && (
        <ModalDevolver key={devol.titulo} titulo={devol.titulo} datos={devol.datos}
          hojaAbierta={hojaAbierta} empleados={empleados} auxiliares={auxiliares}
          onConfirmar={confirmarDevolucion} onCerrar={() => setDevol(null)} />
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
        onDescongelar={(titulo, lineas) => setModal({ titulo, lineas })}
        onDevolver={abrirDevolver} />

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
          <SeccionDevoluciones hoja={sel}
            puedeBorrar={sel.Estatus === "Abierta" && puedeBorrar} onBorrar={borrarRenglon} />
        </div>
      )}
    </div>
  );
}
