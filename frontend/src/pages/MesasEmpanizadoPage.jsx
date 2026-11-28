import { useState, useEffect, useMemo } from "react";
import { authHeader, usePuede } from "../context/AuthContext.jsx";

// Catálogos → Mesas de Empanizado (20 nov 2026). Igual que Mesas de Pelado pero con POSICIÓN FIJA:
// cada mesa o banda tiene sus puestos numerados (el número está impreso en la mesa) y cada persona
// ocupa uno. En la báscula la pesadora solo escanea el carnet: la posición sale de aquí y queda
// guardada en cada bandeja. Cada cambio deja historial con la fecha desde la que cuenta.
// Backend: /api/empanizado/mesas y /api/empanizado/posiciones (lib/posicionEmpanizado.ts).

const API = "/api/empanizado";
const hoyGT = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
const titulo = s => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase().replace(/(^|\s)\p{L}/gu, c => c.toUpperCase());
const TIPOS = [{ valor: "MESA", label: "Mesa", cls: "bg-amber-100 text-amber-800" }, { valor: "BANDA", label: "Banda", cls: "bg-purple-100 text-purple-700" }];
const tipoDe = v => TIPOS.find(t => t.valor === v) ?? TIPOS[0];
const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400";

async function pedir(url, opciones = {}) {
  const res = await fetch(url, { ...opciones, headers: { "Content-Type": "application/json", ...authHeader(), ...(opciones.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Error de servidor");
  return data;
}

function Modal({ titulo: t, onClose, children, ancho = "max-w-md" }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className={`bg-white rounded-2xl shadow-xl w-full ${ancho} max-h-[90vh] overflow-y-auto`}>
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">{t}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

export default function MesasEmpanizadoPage() {
  const [vista, setVista] = useState("posiciones");
  return (
    <div>
      <div className="flex gap-1 bg-gray-200 rounded-lg p-1 mb-4 w-fit">
        {[["posiciones", "Personas por posición"], ["catalogo", "Catálogo de mesas y bandas"]].map(([k, l]) => (
          <button key={k} onClick={() => setVista(k)}
            className={`px-3 py-1 rounded-md text-sm font-medium transition ${vista === k ? "bg-white shadow text-amber-700" : "text-gray-600 hover:text-gray-800"}`}>{l}</button>
        ))}
      </div>
      {vista === "posiciones" ? <Posiciones /> : <Catalogo />}
    </div>
  );
}

// ── Personas por posición ─────────────────────────────────────────────────────────────────────
function Posiciones() {
  const puedeEditar = usePuede("mesas_empanizado", "editar");
  const [fecha, setFecha] = useState(hoyGT());
  const [mesas, setMesas] = useState([]);
  const [posiciones, setPosiciones] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [asignar, setAsignar] = useState(null);   // { mesa, posicion } o { persona }
  const [acciones, setAcciones] = useState(null); // la asignación sobre la que se hizo clic
  const [sinPuesto, setSinPuesto] = useState(null); // { dias, personas } — pesaron sin banda ni puesto
  const esHoy = fecha === hoyGT();

  const cargar = async () => {
    setCargando(true); setError("");
    try {
      const [m, p, s] = await Promise.all([pedir(`${API}/mesas`), pedir(`${API}/posiciones?fecha=${fecha}`),
        pedir(`${API}/sin-posicion`).catch(() => null)]);
      setMesas(m.filter(x => x.Activa)); setPosiciones(p.posiciones); setSinPuesto(s);
    } catch (e) { setError(e.message); } finally { setCargando(false); }
  };
  useEffect(() => { cargar(); }, [fecha]); // eslint-disable-line react-hooks/exhaustive-deps

  const ocupante = useMemo(() => new Map(posiciones.map(p => [`${p.MesaCodigo}#${p.Posicion}`, p])), [posiciones]);
  const total = posiciones.length;

  // Los números impresos van corridos en toda el área (Banda 1 del 1 al 27, Banda 2 del 28 al 55,
  // Mesa 1 del 56 al 61 y el 83…; usuario, 23 nov 2026), así que una mesa no siempre empieza en 1.
  // Cada tarjeta muestra los puestos ocupados y los libres que quedan ENTRE dos de los suyos, si
  // ninguna otra mesa usa ese tramo. Una mesa vacía muestra del 1 a sus Posiciones, como antes.
  const numerosDe = m => {
    const propios = posiciones.filter(p => p.MesaCodigo === m.Codigo).map(p => Number(p.Posicion)).sort((a, b) => a - b);
    if (!propios.length) return Array.from({ length: m.Posiciones }, (_, i) => i + 1);
    const ajenos = new Set(posiciones.filter(p => p.MesaCodigo !== m.Codigo).map(p => Number(p.Posicion)));
    const nums = [propios[0]];
    for (let i = 1; i < propios.length; i++) {
      const hueco = [];
      for (let n = propios[i - 1] + 1; n < propios[i]; n++) hueco.push(n);
      if (!hueco.some(n => ajenos.has(n))) nums.push(...hueco);
      nums.push(propios[i]);
    }
    return nums;
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="text-sm text-gray-600 flex items-center gap-2">Día
          <input type="date" value={fecha} max={hoyGT()} onChange={e => setFecha(e.target.value || hoyGT())} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
        </label>
        {!esHoy && <button onClick={() => setFecha(hoyGT())} className="text-sm text-amber-700 underline">volver a hoy</button>}
        <span className="text-sm text-gray-500">{total} persona{total !== 1 ? "s" : ""} con posición{esHoy ? "" : " ese día"}</span>
        {puedeEditar && esHoy && (
          <button onClick={() => setAsignar({})} className="ml-auto bg-amber-500 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-amber-600 transition">+ Asignar persona</button>
        )}
      </div>
      {error && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}
      {!esHoy && <p className="mb-3 text-xs text-gray-500">Vista de un día pasado: solo consulta. Los cambios se hacen sobre hoy.</p>}

      {/* Quienes pesaron bandejas en los últimos días sin banda ni puesto: sus bandejas se guardan sin
          posición. Como la "Banda temporal" de Pelado (usuario, 28 nov 2026). */}
      {!cargando && sinPuesto && (
        <div className={`mb-4 rounded-xl border ${sinPuesto.personas.length ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-white"}`}>
          <div className="px-4 py-2.5 flex items-center gap-2">
            <span className="font-bold text-gray-800">Sin puesto</span>
            <span className="text-xs text-gray-500">pesaron en Empanizado en los últimos {sinPuesto.dias} días y no tienen banda ni puesto</span>
            <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full ${sinPuesto.personas.length ? "bg-amber-200 text-amber-900" : "bg-gray-100 text-gray-500"}`}>{sinPuesto.personas.length}</span>
          </div>
          {sinPuesto.personas.length === 0 ? (
            <p className="px-4 pb-3 text-sm text-gray-500">Todos los que pesaron tienen su puesto.</p>
          ) : (
            <ul className="divide-y divide-amber-100 border-t border-amber-200">
              {sinPuesto.personas.map(p => (
                <li key={p.Codigo} className="flex items-center gap-3 px-4 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate text-gray-800">{titulo(p.Nombre)} <span className="text-xs text-gray-400 font-mono">{p.Codigo}</span></span>
                  <span className="text-xs text-gray-500 whitespace-nowrap">
                    {p.BandejasHoy ? <b className="text-amber-800">{p.BandejasHoy} hoy · </b> : null}{p.Bandejas} bandejas · último día {p.UltimoDia.split("-").reverse().join("/")}
                  </span>
                  {puedeEditar && esHoy && (
                    <button onClick={() => setAsignar({ persona: { Codigo: p.Codigo, Nombre: p.Nombre, MesaCodigo: null } })}
                      className="shrink-0 text-xs font-semibold px-3 py-1 rounded-lg bg-amber-500 text-white hover:bg-amber-600">Asignar</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {cargando ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : mesas.length === 0 ? (
        <div className="bg-white rounded-xl shadow p-8 text-center text-gray-500">
          Todavía no hay mesas ni bandas. Créelas en <b>Catálogo de mesas y bandas</b> con su número de posiciones.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {mesas.map(m => {
            const numeros = numerosDe(m);
            const ocupadas = numeros.filter(n => ocupante.get(`${m.Codigo}#${n}`)).length;
            return (
              <div key={m.Codigo} className="bg-white rounded-xl shadow overflow-hidden">
                <div className="px-4 py-2.5 border-b flex items-center gap-2">
                  <span className="font-bold text-gray-800">{m.Nombre}</span>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${tipoDe(m.Tipo).cls}`}>{tipoDe(m.Tipo).label}</span>
                  <span className="ml-auto text-xs text-gray-500">{ocupadas}/{numeros.length} ocupadas</span>
                </div>
                <ul className="divide-y divide-gray-50">
                  {numeros.map((n, i) => {
                    const p = ocupante.get(`${m.Codigo}#${n}`);
                    const salto = i > 0 && n - numeros[i - 1] > 1;
                    return (
                      <li key={n} className={`flex items-center gap-3 px-4 py-1.5 ${salto ? "border-t-2 border-dashed border-gray-200" : ""}`}>
                        <span className={`w-8 h-7 shrink-0 rounded-md flex items-center justify-center text-sm font-bold ${p ? "bg-slate-800 text-white" : "border-2 border-dashed border-gray-300 text-gray-400"}`}>{n}</span>
                        {p ? (
                          <button onClick={() => puedeEditar && esHoy && setAcciones(p)} disabled={!puedeEditar || !esHoy}
                            className="min-w-0 flex-1 text-left text-sm text-gray-800 truncate hover:text-amber-700 disabled:hover:text-gray-800">
                            {titulo(p.Nombre)} <span className="text-xs text-gray-400 font-mono">{p.Codigo}</span>
                          </button>
                        ) : puedeEditar && esHoy ? (
                          <button onClick={() => setAsignar({ mesa: m.Codigo, posicion: n })} className="text-sm text-gray-400 italic hover:text-amber-700">libre · asignar</button>
                        ) : <span className="text-sm text-gray-400 italic">libre</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {asignar && <AsignarModal inicial={asignar} mesas={mesas} ocupante={ocupante} posiciones={posiciones} numerosDe={numerosDe} onClose={() => setAsignar(null)} onGuardado={() => { setAsignar(null); cargar(); }} />}
      {acciones && <AccionesModal a={acciones} onClose={() => setAcciones(null)}
        onMover={() => { setAsignar({ persona: acciones }); setAcciones(null); }}
        onListo={() => { setAcciones(null); cargar(); }} />}
    </div>
  );
}

function AsignarModal({ inicial, mesas, ocupante, posiciones, numerosDe, onClose, onGuardado }) {
  const [personas, setPersonas] = useState([]);
  const [busqueda, setBusqueda] = useState("");
  const [elegida, setElegida] = useState(inicial.persona ?? null);
  const [form, setForm] = useState({ MesaCodigo: inicial.mesa ?? "", Posicion: inicial.posicion ?? "", Fecha: hoyGT(), Motivo: "" });
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { if (!inicial.persona) pedir(`${API}/personas`).then(setPersonas).catch(e => setError(e.message)); }, [inicial.persona]);
  const q = busqueda.trim().toLowerCase();
  const encontradas = q.length < 2 ? [] : personas.filter(p => p.Codigo.toLowerCase().includes(q) || p.Nombre.toLowerCase().includes(q)).slice(0, 8);
  const mesa = mesas.find(m => m.Codigo === form.MesaCodigo);
  const nombreMesa = c => mesas.find(m => m.Codigo === c)?.Nombre ?? c;

  const guardar = async e => {
    e.preventDefault();
    setGuardando(true); setError("");
    try {
      await pedir(`${API}/posiciones`, { method: "POST", body: JSON.stringify({ Codigo: elegida.Codigo, ...form, Posicion: Number(form.Posicion) }) });
      onGuardado();
    } catch (err) { setError(err.message); } finally { setGuardando(false); }
  };

  return (
    <Modal titulo={inicial.persona ? `${inicial.persona.MesaCodigo ? "Mover a" : "Asignar a"} ${titulo(inicial.persona.Nombre)}` : "Asignar persona a una posición"} onClose={onClose}>
      <form onSubmit={guardar} className="space-y-4">
        {!elegida ? (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Persona (código o nombre)</label>
            <input autoFocus value={busqueda} onChange={e => setBusqueda(e.target.value)} className={inputCls} placeholder="Escriba al menos 2 letras" />
            <ul className="mt-2 divide-y border rounded-lg empty:hidden">
              {encontradas.map(p => (
                <li key={p.Codigo}>
                  <button type="button" onClick={() => setElegida(p)} className="w-full text-left px-3 py-2 text-sm hover:bg-amber-50">
                    {titulo(p.Nombre)} <span className="text-xs text-gray-400 font-mono">{p.Codigo}</span>
                    {p.MesaCodigo && <span className="ml-2 text-xs text-amber-700">ya en {nombreMesa(p.MesaCodigo)} #{p.Posicion}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm">
            <b>{titulo(elegida.Nombre)}</b> <span className="font-mono text-xs text-gray-500">{elegida.Codigo}</span>
            {elegida.MesaCodigo && <span className="block text-xs text-amber-700">Ahora en {nombreMesa(elegida.MesaCodigo)} · posición {elegida.Posicion}</span>}
            {!inicial.persona && <button type="button" onClick={() => setElegida(null)} className="block text-xs underline text-gray-500 mt-1">cambiar persona</button>}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Mesa o banda</label>
            <select required value={form.MesaCodigo} onChange={e => setForm(f => ({ ...f, MesaCodigo: e.target.value, Posicion: "" }))} className={inputCls}>
              <option value="">— elija —</option>
              {mesas.map(m => <option key={m.Codigo} value={m.Codigo}>{m.Nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Posición</label>
            <select required value={form.Posicion} onChange={e => setForm(f => ({ ...f, Posicion: e.target.value }))} disabled={!mesa} className={inputCls + " disabled:bg-gray-100"}>
              <option value="">—</option>
              {/* Los mismos números que la tarjeta de la mesa (corridos en toda el área: la Banda 2 va del
                  28 al 55, no del 1). Uno que ya ocupa alguien en otra mesa se ve, pero no se puede elegir. */}
              {mesa && numerosDe(mesa).map(n => {
                const o = ocupante.get(`${mesa.Codigo}#${n}`) ?? posiciones.find(p => Number(p.Posicion) === n);
                const propia = o && elegida && o.Codigo === elegida.Codigo;
                const otraMesa = o && o.MesaCodigo !== mesa.Codigo ? ` (${nombreMesa(o.MesaCodigo)})` : "";
                return <option key={n} value={n} disabled={!!o && !propia}>{n}{o ? ` · ${titulo(o.Nombre).split(" ")[0]}${otraMesa}` : " · libre"}</option>;
              })}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Desde</label>
            <input type="date" required value={form.Fecha} max={hoyGT()} onChange={e => setForm(f => ({ ...f, Fecha: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Motivo (opcional)</label>
            <input value={form.Motivo} onChange={e => setForm(f => ({ ...f, Motivo: e.target.value }))} maxLength={200} className={inputCls} />
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancelar</button>
          <button type="submit" disabled={!elegida || guardando} className="px-5 py-2 text-sm bg-amber-500 text-white font-semibold rounded-lg hover:bg-amber-600 disabled:opacity-50">{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}

function AccionesModal({ a, onClose, onMover, onListo }) {
  const [historial, setHistorial] = useState(null);
  const [quitar, setQuitar] = useState({ UltimoDia: hoyGT(), Motivo: "" });
  const [error, setError] = useState("");
  useEffect(() => { pedir(`${API}/posiciones/empleado/${a.Codigo}`).then(setHistorial).catch(e => setError(e.message)); }, [a.Codigo]);

  const hacer = async (fn) => { setError(""); try { await fn(); onListo(); } catch (e) { setError(e.message); } };
  const quitarDe = () => hacer(() => pedir(`${API}/posiciones/${a.Codigo}/quitar`, { method: "PUT", body: JSON.stringify(quitar) }));
  const deshacer = () => {
    if (!confirm("¿Deshacer esta asignación? Úselo solo si se capturó por error.")) return;
    hacer(() => pedir(`${API}/posiciones/${a.AsignacionId}`, { method: "DELETE" }));
  };

  return (
    <Modal titulo={titulo(a.Nombre)} onClose={onClose} ancho="max-w-lg">
      <p className="text-sm text-gray-600 mb-4"><span className="font-mono">{a.Codigo}</span> · {a.MesaCodigo} posición <b>{a.Posicion}</b> desde {a.FechaInicio}</p>
      <div className="flex flex-wrap gap-2 mb-5">
        <button onClick={onMover} className="px-4 py-2 text-sm bg-amber-500 text-white font-semibold rounded-lg hover:bg-amber-600">Mover a otra posición</button>
        <button onClick={deshacer} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Deshacer (fue error)</button>
      </div>
      <div className="rounded-lg border p-3 mb-5">
        <p className="text-sm font-semibold text-gray-700 mb-2">Quitar de la posición</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-500">Último día<input type="date" value={quitar.UltimoDia} onChange={e => setQuitar(q => ({ ...q, UltimoDia: e.target.value }))} className={inputCls + " mt-1"} /></label>
          <label className="text-xs text-gray-500">Motivo<input value={quitar.Motivo} onChange={e => setQuitar(q => ({ ...q, Motivo: e.target.value }))} maxLength={200} className={inputCls + " mt-1"} /></label>
        </div>
        <button onClick={quitarDe} className="mt-2 px-4 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50">Quitar</button>
      </div>
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      <p className="text-sm font-semibold text-gray-700 mb-1">Historial</p>
      <ul className="text-xs text-gray-600 space-y-1">
        {(historial ?? []).map(h => (
          <li key={h.AsignacionId}>{h.MesaNombre} #{h.Posicion} · {h.FechaInicio} → {h.FechaFin ?? "hoy"}{h.MotivoCierre ? ` · ${h.MotivoCierre}` : ""}</li>
        ))}
        {historial === null && <li>Cargando…</li>}
      </ul>
    </Modal>
  );
}

// ── Catálogo de mesas y bandas ────────────────────────────────────────────────────────────────
function Catalogo() {
  const puedeEditar = usePuede("mesas_empanizado", "editar");
  const [items, setItems] = useState([]);
  const [modal, setModal] = useState(null); // { item } | { nuevo: true }
  const [error, setError] = useState("");
  const cargar = () => pedir(`${API}/mesas`).then(setItems).catch(e => setError(e.message));
  useEffect(() => { cargar(); }, []);

  const guardar = async (form, esEdicion) => {
    await pedir(esEdicion ? `${API}/mesas/${form.Codigo}` : `${API}/mesas`, { method: esEdicion ? "PUT" : "POST", body: JSON.stringify(form) });
    setModal(null); cargar();
  };
  const alternar = async (m) => {
    setError("");
    try { await pedir(`${API}/mesas/${m.Codigo}`, { method: "PUT", body: JSON.stringify({ ...m, Activa: !m.Activa }) }); cargar(); }
    catch (e) { setError(e.message); }
  };
  const siguienteOrden = items.reduce((mx, i) => Math.max(mx, i.Orden), 0) + 1;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm text-gray-500">{items.length} mesas y bandas</span>
        {puedeEditar && <button onClick={() => setModal({ nuevo: true })} className="ml-auto bg-amber-500 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-amber-600">+ Nueva mesa o banda</button>}
      </div>
      {error && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
              <th className="px-4 py-3 text-left">Orden</th><th className="px-4 py-3 text-left">Código</th><th className="px-4 py-3 text-left">Nombre</th>
              <th className="px-4 py-3 text-left">Tipo</th><th className="px-4 py-3 text-right">Posiciones</th><th className="px-4 py-3 text-right">Ocupadas</th>
              <th className="px-4 py-3 text-center">Estado</th><th className="px-4 py-3 text-center">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map(m => (
              <tr key={m.Codigo} className={!m.Activa ? "opacity-50" : ""}>
                <td className="px-4 py-2.5 text-gray-500">{m.Orden}</td>
                <td className="px-4 py-2.5 font-mono font-bold text-gray-700">{m.Codigo}</td>
                <td className="px-4 py-2.5 font-semibold">{m.Nombre}</td>
                <td className="px-4 py-2.5"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${tipoDe(m.Tipo).cls}`}>{tipoDe(m.Tipo).label}</span></td>
                <td className="px-4 py-2.5 text-right">{m.Posiciones}</td>
                <td className="px-4 py-2.5 text-right">{m.Personas}</td>
                <td className="px-4 py-2.5 text-center"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${m.Activa ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>{m.Activa ? "Activa" : "Inactiva"}</span></td>
                <td className="px-4 py-2.5 text-center">
                  {puedeEditar && <>
                    <button onClick={() => setModal({ item: m })} className="text-amber-700 text-xs font-medium px-2 py-1 rounded hover:bg-amber-50">Editar</button>
                    <button onClick={() => alternar(m)} className={`text-xs font-medium px-2 py-1 rounded ${m.Activa ? "text-red-500 hover:bg-red-50" : "text-green-600 hover:bg-green-50"}`}>{m.Activa ? "Desactivar" : "Activar"}</button>
                  </>}
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Sin mesas todavía</td></tr>}
          </tbody>
        </table>
      </div>
      {modal && <MesaModal item={modal.item} siguienteOrden={siguienteOrden} onSave={guardar} onClose={() => setModal(null)} />}
    </div>
  );
}

function MesaModal({ item, siguienteOrden, onSave, onClose }) {
  const esEdicion = !!item;
  const [form, setForm] = useState(item ? { ...item } : { Codigo: "", Nombre: "", Tipo: "MESA", Posiciones: 8, Orden: siguienteOrden });
  const [error, setError] = useState("");
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const enviar = async e => { e.preventDefault(); setError(""); try { await onSave(form, esEdicion); } catch (err) { setError(err.message); } };
  return (
    <Modal titulo={esEdicion ? "Editar mesa o banda" : "Nueva mesa o banda"} onClose={onClose}>
      <form onSubmit={enviar} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-500">Código *<input required disabled={esEdicion} value={form.Codigo} onChange={set("Codigo")} maxLength={10} placeholder="EMESA1" className={inputCls + " mt-1 font-mono uppercase disabled:bg-gray-100"} /></label>
          <label className="text-xs text-gray-500">Nombre *<input required value={form.Nombre} onChange={set("Nombre")} maxLength={50} placeholder="MESA 1" className={inputCls + " mt-1 uppercase"} /></label>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <label className="text-xs text-gray-500">Tipo *
            <select value={form.Tipo} onChange={set("Tipo")} className={inputCls + " mt-1"}>{TIPOS.map(t => <option key={t.valor} value={t.valor}>{t.label}</option>)}</select>
          </label>
          <label className="text-xs text-gray-500">Posiciones *<input required type="number" min={1} max={200} value={form.Posiciones} onChange={set("Posiciones")} className={inputCls + " mt-1"} /></label>
          <label className="text-xs text-gray-500">Orden *<input required type="number" value={form.Orden} onChange={set("Orden")} className={inputCls + " mt-1"} /></label>
        </div>
        <p className="text-xs text-gray-500">Posiciones = cuántos puestos numerados tiene (los números impresos en la mesa o banda).</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancelar</button>
          <button type="submit" className="px-5 py-2 text-sm bg-amber-500 text-white font-semibold rounded-lg hover:bg-amber-600">{esEdicion ? "Guardar" : "Crear"}</button>
        </div>
      </form>
    </Modal>
  );
}
