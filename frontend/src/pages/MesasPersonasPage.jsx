import { useState, useEffect, useMemo } from "react";
import { authHeader, usePuede } from "../context/AuthContext.jsx";
import { tipoMesa } from "../utils/mesas.js";

// Tablero de personas por mesa (Catálogos → Mesas de Pelado → Personas). La supervisora asigna,
// mueve, cambia la líder o saca a alguien; cada cambio queda en el historial (MesaAsignacion) con la
// fecha desde la que cuenta, así los reportes de días pasados no se mueven.
//
// BANDA es una mesa más (se asigna y se transfiere). La franja "Banda temporal" no es una mesa que se llene: lista a quien pesó en Pelado/Descabezado en los
// últimos 14 días y hoy no tiene mesa — de ahí se le asigna una si va a quedarse fija.
const hoyGT = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
const titulo = s => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase().replace(/(^|\s)\p{L}/gu, c => c.toUpperCase());

async function pedir(url, opciones = {}) {
  const res = await fetch(url, { ...opciones, headers: { "Content-Type": "application/json", ...authHeader(), ...(opciones.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Error de servidor");
  return data;
}

function Modal({ titulo: t, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">{t}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";

function AsignarModal({ persona, mesas, onClose, onGuardado }) {
  const [personas, setPersonas] = useState([]);
  const [busqueda, setBusqueda] = useState("");
  const [elegida, setElegida] = useState(persona ?? null);
  const [form, setForm] = useState({
    MesaCodigo: persona?.MesaCodigo || "",
    EsLider: !!persona?.EsLider, Fecha: hoyGT(), Motivo: "",
  });
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { if (!persona) pedir("/api/mesas/personas").then(setPersonas).catch(e => setError(e.message)); }, [persona]);

  const q = busqueda.trim().toLowerCase();
  const encontradas = q.length < 2 ? [] : personas.filter(p => p.Codigo.toLowerCase().includes(q) || p.Nombre.toLowerCase().includes(q)).slice(0, 8);
  const nombreMesa = c => mesas.find(m => m.Codigo === c)?.Nombre ?? c;

  const guardar = async e => {
    e.preventDefault();
    setGuardando(true); setError("");
    try {
      const r = await pedir("/api/mesas/asignaciones", { method: "POST", body: JSON.stringify({ Codigo: elegida.Codigo, ...form }) });
      if (r.lideresReemplazadas?.length) alert(`La líder anterior (${r.lideresReemplazadas.join(", ")}) sigue en la mesa, ya sin liderazgo.`);
      onGuardado();
    } catch (err) { setError(err.message); } finally { setGuardando(false); }
  };

  return (
    <Modal titulo={persona?.MesaCodigo ? "Mover / cambiar papel" : "Asignar a mesa"} onClose={onClose}>
      <form onSubmit={guardar} className="space-y-4">
        {elegida ? (
          <div className="bg-gray-50 rounded-lg px-3 py-2">
            <p className="font-semibold text-gray-900">{titulo(elegida.Nombre)}</p>
            <p className="text-xs text-gray-500 font-mono">{elegida.Codigo}{elegida.MesaCodigo ? ` · hoy en ${nombreMesa(elegida.MesaCodigo)}` : " · sin mesa"}</p>
            {!persona && <button type="button" onClick={() => setElegida(null)} className="text-xs text-blue-600 mt-1">Cambiar persona</button>}
          </div>
        ) : (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Persona (código o nombre)</label>
            <input autoFocus value={busqueda} onChange={e => setBusqueda(e.target.value)} className={inputCls} placeholder="Ej. MOR0009 o Isabel" />
            <div className="mt-1 divide-y divide-gray-100 border border-gray-100 rounded-lg">
              {encontradas.map(p => (
                <button type="button" key={p.Codigo} onClick={() => setElegida(p)} className="w-full text-left px-3 py-2 hover:bg-blue-50">
                  <span className="text-sm text-gray-900">{titulo(p.Nombre)}</span>
                  <span className="text-xs text-gray-500 font-mono ml-2">{p.Codigo}{p.MesaCodigo ? ` · ${nombreMesa(p.MesaCodigo)}` : ""}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Mesa *</label>
          <select required value={form.MesaCodigo} onChange={e => setForm(f => ({ ...f, MesaCodigo: e.target.value }))} className={inputCls}>
            <option value="">Elegir…</option>
            {mesas.map(m => <option key={m.Codigo} value={m.Codigo}>{m.Nombre} · {tipoMesa(m.Tipo).label}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={form.EsLider} onChange={e => setForm(f => ({ ...f, EsLider: e.target.checked }))} />
          Líder de la mesa <span className="text-xs text-gray-400">(si ya hay una, deja de serlo y sigue en la mesa)</span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Desde *</label>
            <input required type="date" value={form.Fecha} onChange={e => setForm(f => ({ ...f, Fecha: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Motivo</label>
            <input value={form.Motivo} maxLength={200} onChange={e => setForm(f => ({ ...f, Motivo: e.target.value }))} className={inputCls} />
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancelar</button>
          <button type="submit" disabled={!elegida || guardando} className="px-5 py-2 text-sm bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50">Guardar</button>
        </div>
      </form>
    </Modal>
  );
}

function QuitarModal({ persona, onClose, onGuardado }) {
  const [ultimoDia, setUltimoDia] = useState(hoyGT());
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const guardar = async e => {
    e.preventDefault();
    try {
      await pedir(`/api/mesas/asignaciones/${persona.Codigo}/cerrar`, { method: "PUT", body: JSON.stringify({ UltimoDia: ultimoDia, Motivo: motivo }) });
      onGuardado();
    } catch (err) { setError(err.message); }
  };
  return (
    <Modal titulo="Quitar de la mesa" onClose={onClose}>
      <form onSubmit={guardar} className="space-y-4">
        <p className="text-sm text-gray-700">{titulo(persona.Nombre)} <span className="font-mono text-xs text-gray-500">{persona.Codigo}</span></p>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Último día en la mesa *</label>
          <input required type="date" value={ultimoDia} onChange={e => setUltimoDia(e.target.value)} className={inputCls} />
          <p className="text-xs text-gray-400 mt-1">Desde el día siguiente, si pesa, cuenta en Banda temporal.</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Motivo</label>
          <input value={motivo} maxLength={200} onChange={e => setMotivo(e.target.value)} className={inputCls} />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancelar</button>
          <button type="submit" className="px-5 py-2 text-sm bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700">Quitar</button>
        </div>
      </form>
    </Modal>
  );
}

function HistorialModal({ persona, puedeDeshacer, onClose, onGuardado }) {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { pedir(`/api/mesas/asignaciones/empleado/${persona.Codigo}`).then(setFilas).catch(e => setError(e.message)); }, [persona.Codigo]);
  const deshacer = async f => {
    if (!confirm(`¿Deshacer la asignación a ${f.MesaNombre} desde ${f.FechaInicio}? Si cerró una mesa anterior, esa vuelve a quedar vigente.`)) return;
    try { await pedir(`/api/mesas/asignaciones/${f.AsignacionId}`, { method: "DELETE" }); onGuardado(); }
    catch (err) { setError(err.message); }
  };
  return (
    <Modal titulo={`Historial — ${titulo(persona.Nombre)}`} onClose={onClose}>
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
      {!filas ? <p className="text-sm text-gray-400">Cargando…</p> : filas.length === 0 ? <p className="text-sm text-gray-500">Sin historial.</p> : (
        <ul className="space-y-2">
          {filas.map(f => (
            <li key={f.AsignacionId} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-gray-900">{f.MesaNombre}{f.EsLider ? " ★ Líder" : ""}</span>
                <span className="text-xs text-gray-500 tabular-nums">{f.FechaInicio} → {f.FechaFin ?? "hoy"}</span>
              </div>
              {f.Motivo && <p className="text-xs text-gray-500">Motivo: {f.Motivo}</p>}
              {f.MotivoCierre && <p className="text-xs text-gray-500">Cierre: {f.MotivoCierre}</p>}
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-400">{f.RegistradoPor} · {f.CreadoEn}</p>
                {puedeDeshacer && !f.FechaFin && (
                  <button onClick={() => deshacer(f)} className="text-xs text-red-600 hover:text-red-800 font-medium">Deshacer</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export default function MesasPersonasPage() {
  const puedeEditar = usePuede("mesas", "editar");
  const puedeEliminar = usePuede("mesas", "eliminar");
  const [mesas, setMesas] = useState([]);
  const [asignaciones, setAsignaciones] = useState([]);
  const [sinMesa, setSinMesa] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null); // { tipo: "asignar"|"quitar"|"historial", persona }

  const cargar = async () => {
    setCargando(true);
    try {
      const [m, a, s] = await Promise.all([pedir("/api/mesas"), pedir("/api/mesas/asignaciones"), pedir("/api/mesas/sin-mesa?dias=14")]);
      setMesas(m.filter(x => x.Activa)); setAsignaciones(a.asignaciones); setSinMesa(s); setError("");
    } catch (e) { setError(e.message); } finally { setCargando(false); }
  };
  useEffect(() => { cargar(); }, []);

  const mesasAsignables = mesas;
  const porMesa = useMemo(() => {
    const mapa = new Map(mesasAsignables.map(m => [m.Codigo, []]));
    for (const a of asignaciones) mapa.get(a.MesaCodigo)?.push(a);
    return mapa;
  }, [mesasAsignables, asignaciones]);

  const cerrarYRecargar = () => { setModal(null); cargar(); };

  if (cargando && !mesas.length) return <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>;

  // Tarjeta de una persona dentro de la franja de su mesa: nombre completo (sin recortar), código y
  // desde cuándo, y las acciones abajo para que no le quiten ancho al nombre.
  const Persona = ({ p, enBanda }) => (
    <li className={`w-60 rounded-lg border px-3 py-2 ${p.EsLider ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-white"}`}>
      <p className="text-sm font-medium text-gray-900 leading-snug">
        {titulo(p.Nombre)}{p.EsLider && <span className="ml-1 text-xs font-semibold text-amber-700">★ Líder</span>}
      </p>
      <p className="text-xs text-gray-500 font-mono">
        {p.Codigo}{enBanda ? ` · ${p.PesadasHoy > 0 ? "pesó hoy" : `último ${p.UltimoDia}`}` : ` · desde ${p.FechaInicio}`}
      </p>
      <div className="flex gap-1 mt-1 -ml-1.5">
        {puedeEditar && (
          <button onClick={() => setModal({ tipo: "asignar", persona: enBanda ? { ...p, MesaCodigo: null } : p })}
            className="text-xs text-blue-600 hover:bg-blue-50 rounded px-1.5 py-0.5">{enBanda ? "Asignar a mesa" : "Mover"}</button>
        )}
        {!enBanda && puedeEditar && (
          <button onClick={() => setModal({ tipo: "quitar", persona: p })} className="text-xs text-red-500 hover:bg-red-50 rounded px-1.5 py-0.5">Quitar</button>
        )}
        {!enBanda && (
          <button onClick={() => setModal({ tipo: "historial", persona: p })} className="text-xs text-gray-500 hover:bg-gray-100 rounded px-1.5 py-0.5">Historial</button>
        )}
      </div>
    </li>
  );

  // Una franja a todo el ancho por mesa, una debajo de otra; las personas van en fila y bajan de
  // renglón cuando no caben.
  const Franja = ({ nombre, etiqueta, claseEtiqueta, resumen, nota, borde = "border-gray-200", children }) => (
    <section className={`bg-white rounded-xl border ${borde}`}>
      <div className="px-4 py-2.5 border-b border-gray-100 flex flex-wrap items-center gap-2">
        <span className="font-bold text-gray-900">{nombre}</span>
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${claseEtiqueta}`}>{etiqueta}</span>
        <span className="text-sm text-gray-500">{resumen}</span>
        {nota && <span className="text-xs text-gray-500 ml-auto">{nota}</span>}
      </div>
      <ul className="p-3 flex flex-wrap gap-2">{children}</ul>
    </section>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span className="text-sm text-gray-600">{asignaciones.length} personas en mesa hoy</span>
        {error && <span className="text-sm text-red-600">{error}</span>}
        {puedeEditar && (
          <button onClick={() => setModal({ tipo: "asignar", persona: null })}
            className="ml-auto bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition">+ Asignar persona</button>
        )}
      </div>

      <div className="space-y-3">
        {mesasAsignables.map(m => {
          const lista = porMesa.get(m.Codigo) ?? [];
          const tipo = tipoMesa(m.Tipo);
          return (
            <Franja key={m.Codigo} nombre={m.Nombre} etiqueta={tipo.label} claseEtiqueta={tipo.clase}
              resumen={`${lista.length} persona${lista.length !== 1 ? "s" : ""}${lista.some(p => p.EsLider) ? "" : " · sin líder"}`}>
              {lista.map(p => <Persona key={p.Codigo} p={p} />)}
              {lista.length === 0 && <li className="text-xs text-gray-400 px-1 py-2">Sin personas</li>}
            </Franja>
          );
        })}

        <Franja nombre="BANDA TEMPORAL" etiqueta="sin mesa" claseEtiqueta="bg-gray-200 text-gray-700" borde="border-gray-300"
          resumen={`${sinMesa.length} persona${sinMesa.length !== 1 ? "s" : ""}`}
          nota="Pesaron en Pelado o Descabezado en los últimos 14 días y hoy no tienen mesa.">
          {sinMesa.map(p => <Persona key={p.Codigo} p={p} enBanda />)}
          {sinMesa.length === 0 && <li className="text-xs text-gray-400 px-1 py-2">Nadie</li>}
        </Franja>
      </div>

      {modal?.tipo === "asignar" && <AsignarModal persona={modal.persona} mesas={mesasAsignables} onClose={() => setModal(null)} onGuardado={cerrarYRecargar} />}
      {modal?.tipo === "quitar" && <QuitarModal persona={modal.persona} onClose={() => setModal(null)} onGuardado={cerrarYRecargar} />}
      {modal?.tipo === "historial" && <HistorialModal persona={modal.persona} puedeDeshacer={puedeEliminar} onClose={() => setModal(null)} onGuardado={cerrarYRecargar} />}
    </div>
  );
}
