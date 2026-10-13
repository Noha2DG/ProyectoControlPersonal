import { useState, useEffect, useCallback, useMemo } from "react";
import { authHeader, usePuede } from "../context/AuthContext.jsx";
import { fmtNum } from "../utils/numero.js";

// Catálogos → Tarifas: cómo y cuánto se paga en cada área, base del futuro módulo de planillas.
// Tablas y reglas: backend/scripts/createTarifas.ts y backend/src/lib/tarifas.ts.
//
// Cada grupo tiene una modalidad (OBRA: destajo por talla, decidido por la clase; TIEMPO: por hora;
// POOL: libras del área repartidas según horas — estas dos decididas por el área) y VERSIONES con
// vigencia. Un borrador se edita libre; al aprobarlo entra en vigor y la versión anterior se cierra
// sola el día antes. Una aprobada no se edita: el cambio de precio es una versión nueva (el botón
// copia la vigente). Así cualquier día pasado se puede volver a pagar con la tarifa que tenía.
const API = "/api/tarifas";

const MODALIDAD = {
  OBRA: { label: "Obra", ayuda: "Libras de cada persona × tarifa de su talla. El grupo lo decide la clase." },
  TIEMPO: { label: "Tiempo", ayuda: "Horas de la persona en el área × tarifa por hora. El grupo lo decide el área." },
  POOL: { label: "Pool", ayuda: "Unidades del área × tarifa, repartido entre quienes trabajaron según sus horas. El grupo lo decide el área." },
};
const UNIDAD = { LB: "libra", KG: "kilo", CAJA: "caja", MASTER: "master", PIEZA: "pieza", HORA: "hora" };

const ESTADOS = {
  BORRADOR: "bg-amber-50 text-amber-800 border border-amber-300",
  APROBADO: "bg-emerald-50 text-emerald-800 border border-emerald-300",
  ANULADO: "bg-gray-100 text-gray-500 border border-gray-300",
};
const ESTADO_LABEL = { BORRADOR: "Borrador", APROBADO: "Aprobada", ANULADO: "Anulada" };

const input = "border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";
const btn = "px-4 py-2 text-sm font-semibold rounded-lg transition disabled:opacity-50";

async function pedir(url, opciones = {}) {
  const res = await fetch(url, {
    ...opciones,
    headers: { ...(opciones.body ? { "Content-Type": "application/json" } : {}), ...authHeader() },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Error en el servidor");
  return data;
}
const enviar = (url, method, body) => pedir(url, { method, body: body ? JSON.stringify(body) : undefined });

// "16/20" antes que "41/50": por el primer número de la descripción (el código no sigue ese orden).
const ordenTalla = (a, b) => (parseInt(a.Descripcion) || 9999) - (parseInt(b.Descripcion) || 9999) || a.Talla - b.Talla;
const vigencia = (d, h) => `${d} → ${h ?? "en adelante"}`;

export default function TarifasPage() {
  const [vista, setVista] = useState("tarifas");
  const [opciones, setOpciones] = useState(null);
  useEffect(() => { pedir(`${API}/opciones`).then(setOpciones).catch(e => alert(e.message)); }, []);

  return (
    <div>
      <div className="flex gap-1 bg-gray-200 rounded-lg p-1 mb-4 w-fit">
        {[["tarifas", "Tarifas"], ["clases", "Clases por grupo"], ["areas", "Áreas por grupo"], ["grupos", "Grupos"], ["salario", "Salario mínimo"]].map(([k, l]) => (
          <button key={k} onClick={() => setVista(k)}
            className={`px-3 py-1 rounded-md text-sm font-medium transition ${vista === k ? "bg-white shadow text-blue-700" : "text-gray-600 hover:text-gray-800"}`}>
            {l}
          </button>
        ))}
      </div>
      {!opciones ? <p className="text-sm text-gray-400">Cargando…</p> : (
        <>
          {vista === "tarifas" && <VistaTarifas opciones={opciones} />}
          {vista === "clases" && <VistaAsignaciones key="clase" tipo="clase" opciones={opciones} />}
          {vista === "areas" && <VistaAsignaciones key="area" tipo="area" opciones={opciones} />}
          {vista === "grupos" && <VistaGrupos opciones={opciones} />}
          {vista === "salario" && <VistaSalario />}
        </>
      )}
    </div>
  );
}

function useGrupos() {
  const [grupos, setGrupos] = useState([]);
  const cargar = useCallback(() => pedir(`${API}/grupos`).then(setGrupos).catch(e => alert(e.message)), []);
  useEffect(() => { cargar(); }, [cargar]);
  return [grupos, cargar];
}

// ── Tarifas: versiones por grupo ─────────────────────────────────────

function VistaTarifas({ opciones }) {
  const puedeEditar = usePuede("tarifas", "editar");
  const [grupos] = useGrupos();
  const activos = grupos.filter(g => g.Activo);
  const [grupo, setGrupo] = useState(null);
  const [versiones, setVersiones] = useState([]);
  const [seleccion, setSeleccion] = useState(null); // VersionId o "nueva"
  const [base, setBase] = useState(null);           // detalle a copiar en una versión nueva

  const g = grupo ?? activos[0]?.Grupo;
  const info = grupos.find(x => x.Grupo === g);
  // TIEMPO basado en el mínimo no lleva versiones: la hora sale sola del salario mínimo vigente.
  const porMinimo = info?.Modalidad === "TIEMPO" && info?.BaseMinimo;
  const [recarga, setRecarga] = useState(0);
  const cargar = () => setRecarga(n => n + 1);
  useEffect(() => {
    if (!g) return;
    let vivo = true;
    pedir(`${API}/versiones?grupo=${encodeURIComponent(g)}`).then(d => { if (vivo) setVersiones(d); }).catch(e => alert(e.message));
    return () => { vivo = false; };
  }, [g, recarga]);

  const nueva = async () => {
    // Copia la versión vigente hoy (o la más reciente aprobada) para cambiar solo lo necesario.
    const ref = versiones.find(v => v.Vigente) ?? versiones.find(v => v.Estado === "APROBADO");
    let detalle = [], salario = null;
    if (ref) { try { ({ detalle, salario } = await pedir(`${API}/versiones/${ref.VersionId}`)); } catch { /* sin copia */ } }
    setBase({
      Grupo: g, GrupoDescripcion: info?.Descripcion, Modalidad: info?.Modalidad, UnidadPago: info?.UnidadPago,
      VigenteDesde: "", VigenteHasta: "", Motivo: "", detalle, salario, copiaDe: ref?.VersionId,
    });
    setSeleccion("nueva");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {activos.map(x => (
          <button key={x.Grupo} onClick={() => { setGrupo(x.Grupo); setSeleccion(null); }}
            className={`px-3 py-1.5 rounded-full text-sm font-semibold border transition ${x.Grupo === g ? "bg-[#0F766E] text-white border-[#0F766E]" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}>
            {x.Descripcion}
            <span className={`ml-1.5 text-[11px] font-medium ${x.Grupo === g ? "text-[#cde7e2]" : "text-gray-400"}`}>{MODALIDAD[x.Modalidad]?.label}</span>
          </button>
        ))}
        {puedeEditar && g && !porMinimo && (
          <button onClick={nueva} className={`${btn} ml-auto bg-blue-600 text-white hover:bg-blue-700`}>+ Nueva versión</button>
        )}
      </div>
      {info && <p className="text-sm text-gray-600">{MODALIDAD[info.Modalidad]?.ayuda}</p>}

      {porMinimo ? <PorMinimo /> : (
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <tr><th className="px-4 py-2 text-left">#</th><th className="px-4 py-2 text-left">Vigencia</th><th className="px-4 py-2 text-left">Estado</th>
              <th className="px-4 py-2 text-right">{info?.Modalidad === "OBRA" ? "Tallas" : "Líneas"}</th><th className="px-4 py-2 text-left">Motivo</th><th className="px-4 py-2 text-left">Aprobó</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {versiones.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Este grupo no tiene versiones.</td></tr>}
            {versiones.map(v => (
              <tr key={v.VersionId} onClick={() => setSeleccion(v.VersionId)}
                className={`cursor-pointer hover:bg-blue-50 ${seleccion === v.VersionId ? "bg-blue-50" : ""}`}>
                <td className="px-4 py-2 font-mono text-gray-500">{v.VersionId}</td>
                <td className="px-4 py-2 whitespace-nowrap tabular-nums">{vigencia(v.VigenteDesde, v.VigenteHasta)}</td>
                <td className="px-4 py-2 whitespace-nowrap">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${ESTADOS[v.Estado]}`}>{ESTADO_LABEL[v.Estado]}</span>
                  {v.Vigente && <span className="ml-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-[#0F766E] text-white">Vigente hoy</span>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{v.Tallas}</td>
                <td className="px-4 py-2 text-gray-600 max-w-xs truncate">{v.Motivo ?? ""}</td>
                <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{v.AprobadoPor ? `${v.AprobadoPor} · ${v.AprobadoEn}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {seleccion === "nueva" && base && (
        <EditorVersion key="nueva" inicial={base} opciones={opciones}
          onListo={id => { cargar(); setSeleccion(id ?? null); }} onCerrar={() => setSeleccion(null)} />
      )}
      {typeof seleccion === "number" && (
        <DetalleVersion key={seleccion} id={seleccion} opciones={opciones}
          onCambio={id => { cargar(); setSeleccion(id === undefined ? seleccion : id); }} onCerrar={() => setSeleccion(null)} />
      )}
    </div>
  );
}

// Grupo de TIEMPO "basado en el mínimo": no se captura nada, la hora sale del salario mínimo vigente.
function PorMinimo() {
  const [s, setS] = useState(null);
  useEffect(() => {
    pedir(`${API}/salario-minimo`)
      .then(filas => setS(filas.find(f => !f.VigenteHasta && f.Categoria === "PLANTA") ?? filas.find(f => !f.VigenteHasta) ?? null))
      .catch(e => alert(e.message));
  }, []);
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 text-sm text-gray-700">
      Este grupo no lleva versiones: la hora se paga con el salario mínimo vigente.
      {s && (
        <p className="mt-2 text-base">
          Q {fmtNum(s.ValorDia, 2)} ÷ {fmtNum(s.HorasJornada, 0)} horas = <span className="font-bold text-gray-900">Q {fmtNum(s.ValorDia / s.HorasJornada, 2)} por hora</span>
          <span className="text-xs text-gray-500"> (vigente desde {s.VigenteDesde})</span>
        </p>
      )}
      <p className="text-xs text-gray-500 mt-2">Cuando registres el mínimo del año nuevo en "Salario mínimo", la hora sube sola. Las horas extra las calcula la planilla.</p>
    </div>
  );
}

function DetalleVersion({ id, opciones, onCambio, onCerrar }) {
  const [v, setV] = useState(null);
  const cargar = useCallback(() => pedir(`${API}/versiones/${id}`).then(setV).catch(e => alert(e.message)), [id]);
  useEffect(() => { cargar(); }, [cargar]);
  if (!v) return <p className="text-sm text-gray-400">Cargando…</p>;
  // key con el estado: al aprobar/anular el editor se rearma en solo lectura con lo guardado.
  return (
    <EditorVersion key={`${v.VersionId}-${v.Estado}`} inicial={v} opciones={opciones} onCerrar={onCerrar}
      onListo={nuevoId => {
        if (nuevoId === null) { onCambio(null); return; } // borrador eliminado
        cargar(); onCambio(undefined);
      }} />
  );
}

// Un borrador se edita aquí mismo; una aprobada o anulada se muestra de solo lectura.
function EditorVersion({ inicial, opciones, onListo, onCerrar }) {
  const puedeEditar = usePuede("tarifas", "editar");
  const puedeAprobar = usePuede("tarifas", "aprobar");
  const esNueva = !inicial.VersionId;
  const editable = puedeEditar && (esNueva || inicial.Estado === "BORRADOR");
  // OBRA lleva una línea por talla; TIEMPO y POOL una sola tarifa sin talla (p. ej. Q por libra
  // empacada en el área, o Q por hora).
  const porTalla = (inicial.Modalidad ?? "OBRA") === "OBRA";
  const unidad = UNIDAD[inicial.UnidadPago] ?? "unidad";
  const [form, setForm] = useState(() => ({
    VigenteDesde: inicial.VigenteDesde ?? "", VigenteHasta: inicial.VigenteHasta ?? "", Motivo: inicial.Motivo ?? "",
    detalle: [...(inicial.detalle ?? [])].filter(d => d.Talla != null).sort(ordenTalla).map(d => ({ ...d, Tarifa: String(d.Tarifa) })),
    unica: String(inicial.detalle?.find(d => d.Talla == null)?.Tarifa ?? ""),
  }));
  const [agregar, setAgregar] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const salario = inicial.salario;
  const horas = salario?.HorasJornada ?? 8;

  const disponibles = useMemo(() => {
    const usadas = new Set(form.detalle.map(d => d.Talla));
    return opciones.tallas.filter(t => !usadas.has(t.Codigo))
      .map(t => ({ Talla: t.Codigo, Descripcion: t.Descripcion })).sort(ordenTalla);
  }, [opciones.tallas, form.detalle]);

  const setLinea = (talla, campo, valor) => setForm(f => ({ ...f, detalle: f.detalle.map(d => (d.Talla === talla ? { ...d, [campo]: valor } : d)) }));
  const quitar = talla => setForm(f => ({ ...f, detalle: f.detalle.filter(d => d.Talla !== talla) }));
  const agregarTalla = () => {
    const t = disponibles.find(x => x.Talla === Number(agregar));
    if (!t) return;
    setForm(f => ({ ...f, detalle: [...f.detalle, { ...t, Tarifa: "" }].sort(ordenTalla) }));
    setAgregar("");
  };

  const accion = async (fn) => {
    setOcupado(true);
    try { await fn(); } catch (e) { alert(e.message); } finally { setOcupado(false); }
  };
  const cuerpo = () => ({
    Grupo: inicial.Grupo, VigenteDesde: form.VigenteDesde, VigenteHasta: form.VigenteHasta || null, Motivo: form.Motivo,
    detalle: porTalla ? form.detalle.map(d => ({ Talla: d.Talla, Tarifa: Number(d.Tarifa) })) : [{ Talla: null, Tarifa: Number(form.unica) }],
  });
  const guardar = () => accion(async () => {
    const r = esNueva ? await enviar(`${API}/versiones`, "POST", cuerpo()) : await enviar(`${API}/versiones/${inicial.VersionId}`, "PUT", cuerpo());
    onListo(r.VersionId);
  });
  const aprobar = () => accion(async () => {
    if (!confirm(`¿Aprobar la versión #${inicial.VersionId}? Entra en vigor el ${form.VigenteDesde} y ya no se podrá editar.`)) return;
    // Lo que está en pantalla es lo que se aprueba: se guarda primero.
    if (editable) await enviar(`${API}/versiones/${inicial.VersionId}`, "PUT", cuerpo());
    const r = await enviar(`${API}/versiones/${inicial.VersionId}/aprobar`, "POST");
    if (r.cambios?.length) alert(r.cambios.join("\n"));
    onListo();
  });
  const anular = () => accion(async () => {
    if (!confirm(`¿Anular la versión #${inicial.VersionId}? Sus días quedan con la versión anterior (si la hay).`)) return;
    const r = await enviar(`${API}/versiones/${inicial.VersionId}/anular`, "POST");
    if (r.cambios?.length) alert(r.cambios.join("\n"));
    onListo();
  });
  const eliminar = () => accion(async () => {
    if (!confirm(`¿Eliminar el borrador #${inicial.VersionId}?`)) return;
    await enviar(`${API}/versiones/${inicial.VersionId}`, "DELETE");
    onListo(null);
  });

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-bold text-gray-900">
          {esNueva ? `Nueva versión — ${inicial.GrupoDescripcion ?? inicial.Grupo}` : `Versión #${inicial.VersionId} — ${inicial.GrupoDescripcion}`}
        </h3>
        {!esNueva && <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${ESTADOS[inicial.Estado]}`}>{ESTADO_LABEL[inicial.Estado]}</span>}
        {esNueva && inicial.copiaDe && <span className="text-xs text-gray-500">copiada de la versión #{inicial.copiaDe}</span>}
        <button onClick={onCerrar} className="ml-auto text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[auto_auto_1fr]">
        <label className="text-xs font-medium text-gray-500">Vigente desde *
          <input type="date" disabled={!editable} value={form.VigenteDesde} onChange={e => setForm(f => ({ ...f, VigenteDesde: e.target.value }))}
            className={`${input} block mt-1 disabled:bg-gray-50`} />
        </label>
        <label className="text-xs font-medium text-gray-500">Hasta (vacío = en adelante)
          <input type="date" disabled={!editable} value={form.VigenteHasta} onChange={e => setForm(f => ({ ...f, VigenteHasta: e.target.value }))}
            className={`${input} block mt-1 disabled:bg-gray-50`} />
        </label>
        <label className="text-xs font-medium text-gray-500">Motivo
          <input disabled={!editable} value={form.Motivo} maxLength={255} placeholder="Ej. ajuste salario mínimo 2027"
            onChange={e => setForm(f => ({ ...f, Motivo: e.target.value }))} className={`${input} block w-full mt-1 disabled:bg-gray-50`} />
        </label>
      </div>

      {!porTalla ? (
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-500">Tarifa (Q por {unidad}) *
            {editable ? (
              <input type="number" step="0.0001" min="0" value={form.unica} onChange={e => setForm(f => ({ ...f, unica: e.target.value }))}
                className={`${input} block mt-1 w-40 text-right`} />
            ) : <span className="block mt-1 text-2xl font-bold text-gray-900 tabular-nums">Q {fmtNum(Number(form.unica), 4)}</span>}
          </label>
          <p className="text-xs text-gray-500">
            {inicial.Modalidad === "POOL"
              ? `Una sola tarifa para toda el área, sin talla ni producto: cada día, ${unidad}s del área × tarifa, repartido entre quienes trabajaron ahí según sus horas.`
              : `Una sola tarifa por ${unidad} para toda el área.`}
          </p>
        </div>
      ) : (
      <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500 uppercase tracking-wide border-b">
            <tr>
              <th className="py-2 pr-3 text-left">Talla</th>
              <th className="py-2 px-3 text-right">Tarifa (Q/lb)</th>
              <th className="py-2 px-3 text-right">Libras por día</th>
              <th className="py-2 px-3 text-right">Lb/hr</th>
              {editable && <th />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {form.detalle.map(d => {
              // La meta no se captura: es lo que hay que pelar para ganar el mínimo del día con esta tarifa.
              const tarifa = Number(d.Tarifa);
              const meta = tarifa > 0 && salario ? salario.ValorDia / tarifa : null;
              return (
                <tr key={d.Talla}>
                  <td className="py-1.5 pr-3 font-medium text-gray-900 whitespace-nowrap">{d.Descripcion} <span className="text-xs text-gray-400 font-mono">{d.Talla}</span></td>
                  <td className="py-1.5 px-3 text-right">
                    {editable ? <input type="number" step="0.0001" min="0" value={d.Tarifa} onChange={e => setLinea(d.Talla, "Tarifa", e.target.value)}
                      className={`${input} w-24 text-right py-1`} /> : <span className="tabular-nums">Q {fmtNum(tarifa, 2)}</span>}
                  </td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-gray-600">{fmtNum(meta, 0)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-gray-600">{meta != null ? fmtNum(meta / horas, 1) : "—"}</td>
                  {editable && <td className="py-1.5 pl-2 text-right"><button onClick={() => quitar(d.Talla)} className="text-xs text-red-600 hover:underline">Quitar</button></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">
        Solo se captura la tarifa. Libras por día y Lb/hr son cálculo:
        {salario
          ? ` salario mínimo vigente (Q ${fmtNum(salario.ValorDia, 2)}) ÷ tarifa, y eso ÷ ${fmtNum(horas, 0)} horas.`
          : " no hay salario mínimo vigente para esta fecha."}
        {" "}Se paga toda libra pesada; una talla que no esté aquí queda "sin tarifa".
      </p>

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <select value={agregar} onChange={e => setAgregar(e.target.value)} className={input}>
            <option value="">Agregar talla…</option>
            {disponibles.map(t => <option key={t.Talla} value={t.Talla}>{t.Descripcion} ({t.Talla})</option>)}
          </select>
          <button onClick={agregarTalla} disabled={!agregar} className={`${btn} border border-gray-300 text-gray-700 hover:bg-gray-50`}>Agregar</button>
        </div>
      )}
      </>
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-2 border-t">
        {editable && !esNueva && <button onClick={eliminar} disabled={ocupado} className={`${btn} text-red-600 border border-red-200 hover:bg-red-50`}>Eliminar borrador</button>}
        {editable && <button onClick={guardar} disabled={ocupado} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>{esNueva ? "Crear borrador" : "Guardar borrador"}</button>}
        {!esNueva && inicial.Estado === "BORRADOR" && puedeAprobar && (
          <button onClick={aprobar} disabled={ocupado}
            className={`${btn} bg-[#0F766E] text-white hover:bg-[#0d6560]`}>Aprobar</button>
        )}
        {inicial.Estado === "APROBADO" && puedeAprobar && (
          <button onClick={anular} disabled={ocupado} className={`${btn} text-red-600 border border-red-200 hover:bg-red-50`}>Anular</button>
        )}
      </div>
      {!esNueva && (
        <p className="text-xs text-gray-400 text-right">
          Creó {inicial.CreadoPor}{inicial.AprobadoPor ? ` · aprobó ${inicial.AprobadoPor} (${inicial.AprobadoEn})` : ""}
        </p>
      )}
    </div>
  );
}

// ── Clases y áreas por grupo ─────────────────────────────────────────
// clase → grupos de OBRA (la clase de la pesada elige la tarifa); área → grupos de TIEMPO y POOL
// (estar en el área es lo que se paga). Mismas reglas de vigencia para las dos.
const ASIGNACION = {
  clase: {
    ruta: "clases", campo: "Clase", etiqueta: "Clase", modalidades: ["OBRA"], vacio: "Sin clases asignadas.",
    ayuda: "Qué clases cobra cada grupo de obra (destajo por talla). Si una clase cambia de grupo, los días anteriores se siguen pagando con el grupo de entonces.",
    opciones: o => o.clases.map(c => ({ valor: c.Clase, texto: `${c.Clase} — ${c.Descripcion}` })),
  },
  area: {
    ruta: "areas", campo: "AreaCodigo", etiqueta: "Área", modalidades: ["TIEMPO", "POOL"], vacio: "Sin áreas asignadas.",
    ayuda: "Qué áreas paga cada grupo de tiempo o pool. Cada área es su propio pool. Para cambiar cómo se paga un área, asígnala a otro grupo desde una fecha: los días anteriores se siguen pagando como antes.",
    opciones: o => o.areas.map(a => ({ valor: a.Codigo, texto: `${a.Codigo} — ${a.Nombre}` })),
  },
};

function VistaAsignaciones({ tipo, opciones }) {
  const cfg = ASIGNACION[tipo];
  const puedeEditar = usePuede("tarifas", "editar");
  const [grupos] = useGrupos();
  const [filas, setFilas] = useState([]);
  const [todas, setTodas] = useState(false);
  const [form, setForm] = useState({ [cfg.campo]: "", Grupo: "", VigenteDesde: opciones.hoy });
  const cargar = useCallback(() => pedir(`${API}/${cfg.ruta}${todas ? "?todas=1" : ""}`).then(setFilas).catch(e => alert(e.message)), [cfg.ruta, todas]);
  useEffect(() => { cargar(); }, [cargar]);

  const accion = async fn => { try { await fn(); cargar(); } catch (e) { alert(e.message); } };
  const asignar = e => {
    e.preventDefault();
    accion(async () => { await enviar(`${API}/${cfg.ruta}`, "POST", form); setForm(f => ({ ...f, [cfg.campo]: "" })); });
  };
  const cerrar = f => {
    const hasta = prompt(`Último día en que ${f.Codigo} se paga con ${f.GrupoDescripcion} (AAAA-MM-DD):`, opciones.hoy);
    if (hasta) accion(() => enviar(`${API}/${cfg.ruta}/${f.Id}/cerrar`, "PUT", { VigenteHasta: hasta }));
  };
  const deshacer = f => {
    if (confirm(`¿Deshacer ${f.Codigo} en ${f.GrupoDescripcion} desde ${f.VigenteDesde}? (Para corregir un error de captura)`))
      accion(() => enviar(`${API}/${cfg.ruta}/${f.Id}`, "DELETE"));
  };
  const gruposValidos = grupos.filter(g => g.Activo && cfg.modalidades.includes(g.Modalidad));

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">{cfg.ayuda}</p>
      {puedeEditar && (
        <form onSubmit={asignar} className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-gray-500">{cfg.etiqueta}
            <select required value={form[cfg.campo]} onChange={e => setForm(f => ({ ...f, [cfg.campo]: e.target.value }))} className={`${input} block mt-1`}>
              <option value="">Elegir…</option>
              {cfg.opciones(opciones).map(o => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-gray-500">Grupo
            <select required value={form.Grupo} onChange={e => setForm(f => ({ ...f, Grupo: e.target.value }))} className={`${input} block mt-1`}>
              <option value="">{gruposValidos.length ? "Elegir…" : `No hay grupos de ${cfg.modalidades.map(m => MODALIDAD[m].label.toLowerCase()).join(" o ")}`}</option>
              {gruposValidos.map(g => <option key={g.Grupo} value={g.Grupo}>{g.Descripcion} ({MODALIDAD[g.Modalidad].label})</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-gray-500">Desde
            <input required type="date" value={form.VigenteDesde} onChange={e => setForm(f => ({ ...f, VigenteDesde: e.target.value }))} className={`${input} block mt-1`} />
          </label>
          <button type="submit" className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>Asignar</button>
        </form>
      )}
      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input type="checkbox" checked={todas} onChange={e => setTodas(e.target.checked)} /> Ver historial (incluye cerradas)
      </label>
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <tr><th className="px-4 py-2 text-left">Grupo</th><th className="px-4 py-2 text-left">{cfg.etiqueta}</th><th className="px-4 py-2 text-left">Vigencia</th><th className="px-4 py-2 text-left">Registró</th><th /></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filas.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">{cfg.vacio}</td></tr>}
            {filas.map(f => (
              <tr key={f.Id} className={f.VigenteHasta ? "text-gray-400" : ""}>
                <td className="px-4 py-2 font-medium">
                  {f.GrupoDescripcion}
                  {f.Modalidad && <span className="ml-1.5 text-xs font-normal text-gray-500">{MODALIDAD[f.Modalidad]?.label}</span>}
                </td>
                <td className="px-4 py-2"><span className="font-mono">{f.Codigo}</span> <span className="text-gray-500">{f.Descripcion}</span></td>
                <td className="px-4 py-2 whitespace-nowrap tabular-nums">{vigencia(f.VigenteDesde, f.VigenteHasta)}</td>
                <td className="px-4 py-2 text-gray-500">{f.CreadoPor}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {puedeEditar && !f.VigenteHasta && (
                    <>
                      <button onClick={() => cerrar(f)} className="text-xs text-gray-600 hover:bg-gray-100 rounded px-1.5 py-0.5">Quitar</button>
                      <button onClick={() => deshacer(f)} className="text-xs text-red-600 hover:bg-red-50 rounded px-1.5 py-0.5">Deshacer</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Grupos ───────────────────────────────────────────────────────────

const GRUPO_VACIO = { Grupo: "", Descripcion: "", Modalidad: "POOL", UnidadPago: "LB", BaseMinimo: false, Orden: "", Activo: true };

function VistaGrupos({ opciones }) {
  const puedeEditar = usePuede("tarifas", "editar");
  const [grupos, cargar] = useGrupos();
  const [modal, setModal] = useState(null); // { item, nuevo }

  const guardar = async form => {
    try {
      if (modal.nuevo) await enviar(`${API}/grupos`, "POST", form);
      else await enviar(`${API}/grupos/${form.Grupo}`, "PUT", form);
      setModal(null); cargar();
    } catch (e) { alert(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <p className="text-sm text-gray-600">Cada grupo dice cómo se paga (obra, tiempo o pool) y por qué unidad. Las clases o áreas que paga se asignan en sus pestañas.</p>
        {puedeEditar && <button onClick={() => setModal({ item: GRUPO_VACIO, nuevo: true })} className={`${btn} ml-auto bg-blue-600 text-white hover:bg-blue-700`}>+ Nuevo grupo</button>}
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <tr><th className="px-4 py-2 text-left">Código</th><th className="px-4 py-2 text-left">Descripción</th><th className="px-4 py-2 text-left">Modalidad</th>
              <th className="px-4 py-2 text-left">Unidad</th><th className="px-4 py-2 text-right">Asignadas</th><th className="px-4 py-2 text-left">Estado</th><th /></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {grupos.map(g => (
              <tr key={g.Grupo} className={g.Activo ? "" : "text-gray-400"}>
                <td className="px-4 py-2 font-mono">{g.Grupo}</td>
                <td className="px-4 py-2 font-medium">{g.Descripcion}</td>
                <td className="px-4 py-2">
                  {MODALIDAD[g.Modalidad]?.label}
                  {g.BaseMinimo && <span className="ml-1.5 text-xs text-gray-500">(salario mínimo)</span>}
                </td>
                <td className="px-4 py-2">{g.UnidadPago}</td>
                <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                  {g.Modalidad === "OBRA" ? `${g.Clases} clase${g.Clases !== 1 ? "s" : ""}` : `${g.Areas} área${g.Areas !== 1 ? "s" : ""}`}
                </td>
                <td className="px-4 py-2">{g.Activo ? "Activo" : "Inactivo"}</td>
                <td className="px-4 py-2 text-right">
                  {puedeEditar && <button onClick={() => setModal({ item: g, nuevo: false })} className="text-xs text-blue-600 hover:bg-blue-50 rounded px-1.5 py-0.5">Editar</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal && <GrupoModal item={modal.item} nuevo={modal.nuevo} opciones={opciones} onSave={guardar} onClose={() => setModal(null)} />}
    </div>
  );
}

function GrupoModal({ item, nuevo, opciones, onSave, onClose }) {
  const [form, setForm] = useState({ ...item });
  const set = f => e => setForm(p => ({ ...p, [f]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  // Ya usado (versiones, clases o áreas): la forma de pago no se cambia, cambiaría días ya pagados.
  const enUso = !nuevo && (item.Versiones > 0 || item.Clases > 0 || item.Areas > 0);
  // Tiempo se paga por HORA; obra y pool por unidades producidas.
  const unidades = form.Modalidad === "TIEMPO" ? ["HORA"] : opciones.unidades.filter(u => u !== "HORA");
  const cambiarModalidad = e => {
    const m = e.target.value;
    setForm(p => ({ ...p, Modalidad: m, UnidadPago: m === "TIEMPO" ? "HORA" : (p.UnidadPago === "HORA" ? "LB" : p.UnidadPago), BaseMinimo: m === "TIEMPO" ? p.BaseMinimo : false }));
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">{nuevo ? "Nuevo grupo" : "Editar grupo"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={e => { e.preventDefault(); onSave(form); }} className="px-6 py-5 space-y-4">
          <label className="block text-xs font-medium text-gray-500">Código *
            <input required disabled={!nuevo} value={form.Grupo} onChange={set("Grupo")} maxLength={20} placeholder="TUNEL_EMP"
              className={`${input} block w-full mt-1 font-mono uppercase disabled:bg-gray-100`} />
          </label>
          <label className="block text-xs font-medium text-gray-500">Descripción *
            <input required value={form.Descripcion} onChange={set("Descripcion")} maxLength={100} placeholder="TUNEL EMPAQUE"
              className={`${input} block w-full mt-1 uppercase`} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium text-gray-500">Modalidad *
              <select required disabled={enUso} value={form.Modalidad} onChange={cambiarModalidad} className={`${input} block w-full mt-1 disabled:bg-gray-100`}>
                {opciones.modalidades.map(m => <option key={m} value={m}>{MODALIDAD[m].label}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium text-gray-500">Unidad de pago *
              <select required disabled={enUso} value={form.UnidadPago} onChange={set("UnidadPago")} className={`${input} block w-full mt-1 disabled:bg-gray-100`}>
                {unidades.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
          </div>
          <p className="text-xs text-gray-500 -mt-2">{MODALIDAD[form.Modalidad]?.ayuda}</p>
          {form.Modalidad === "TIEMPO" && (
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input type="checkbox" disabled={enUso} checked={!!form.BaseMinimo} onChange={set("BaseMinimo")} className="mt-0.5" />
              <span>Basada en el salario mínimo <span className="block text-xs text-gray-500">La hora = salario mínimo ÷ horas de jornada (Q106 ÷ 8). No se captura tarifa y sube sola con el mínimo de cada año.</span></span>
            </label>
          )}
          {enUso && <p className="text-xs text-amber-700">Este grupo ya se usa: su forma de pago no se cambia. Para pagar un área de otra forma, crea otro grupo y pásale el área desde una fecha.</p>}
          <div className="grid grid-cols-2 gap-3 items-end">
            <label className="block text-xs font-medium text-gray-500">Orden
              <input type="number" step="1" value={form.Orden} onChange={set("Orden")} className={`${input} block w-full mt-1`} />
            </label>
            {!nuevo && (
              <label className="flex items-center gap-2 text-sm text-gray-700 pb-2">
                <input type="checkbox" checked={!!form.Activo} onChange={set("Activo")} /> Activo
              </label>
            )}
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition">Cancelar</button>
            <button type="submit" className="px-5 py-2 text-sm bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition">{nuevo ? "Crear" : "Guardar"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Salario mínimo ───────────────────────────────────────────────────

function VistaSalario() {
  const puedeAprobar = usePuede("tarifas", "aprobar");
  const [filas, setFilas] = useState([]);
  const [form, setForm] = useState({ Categoria: "PLANTA", VigenteDesde: "", ValorDia: "", HorasJornada: "8", Acuerdo: "" });
  const cargar = useCallback(() => pedir(`${API}/salario-minimo`).then(setFilas).catch(e => alert(e.message)), []);
  useEffect(() => { cargar(); }, [cargar]);
  const set = f => e => setForm(p => ({ ...p, [f]: e.target.value }));

  const agregar = async e => {
    e.preventDefault();
    try { await enviar(`${API}/salario-minimo`, "POST", form); setForm(f => ({ ...f, VigenteDesde: "", ValorDia: "", Acuerdo: "" })); cargar(); }
    catch (err) { alert(err.message); }
  };
  const deshacer = async f => {
    if (!confirm(`¿Deshacer el mínimo de Q ${fmtNum(f.ValorDia, 2)} desde ${f.VigenteDesde}? (Para corregir un error de captura)`)) return;
    try { await enviar(`${API}/salario-minimo/${f.SalarioMinimoId}`, "DELETE"); cargar(); } catch (err) { alert(err.message); }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Mínimo diario fijado por ley; cambia cada año. Al registrar uno nuevo, el anterior se cierra el día antes.
        La planilla completará hasta este valor a quien no lo alcance con su destajo.
      </p>
      {puedeAprobar && (
        <form onSubmit={agregar} className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-gray-500">Desde *
            <input required type="date" value={form.VigenteDesde} onChange={set("VigenteDesde")} className={`${input} block mt-1`} />
          </label>
          <label className="text-xs font-medium text-gray-500">Valor del día (Q) *
            <input required type="number" step="0.01" min="0" value={form.ValorDia} onChange={set("ValorDia")} className={`${input} block mt-1 w-32`} />
          </label>
          <label className="text-xs font-medium text-gray-500">Horas jornada *
            <input required type="number" step="0.5" min="1" max="24" value={form.HorasJornada} onChange={set("HorasJornada")} className={`${input} block mt-1 w-24`} />
          </label>
          <label className="text-xs font-medium text-gray-500 flex-1 min-w-[12rem]">Acuerdo gubernativo
            <input value={form.Acuerdo} onChange={set("Acuerdo")} maxLength={150} placeholder="Número de acuerdo" className={`${input} block w-full mt-1`} />
          </label>
          <button type="submit" className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>Registrar</button>
        </form>
      )}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <tr><th className="px-4 py-2 text-left">Categoría</th><th className="px-4 py-2 text-left">Vigencia</th><th className="px-4 py-2 text-right">Valor día</th>
              <th className="px-4 py-2 text-right">Horas</th><th className="px-4 py-2 text-left">Acuerdo</th><th className="px-4 py-2 text-left">Registró</th><th /></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filas.map(f => (
              <tr key={f.SalarioMinimoId} className={f.VigenteHasta ? "text-gray-400" : ""}>
                <td className="px-4 py-2">{f.Categoria}</td>
                <td className="px-4 py-2 whitespace-nowrap tabular-nums">{vigencia(f.VigenteDesde, f.VigenteHasta)}</td>
                <td className="px-4 py-2 text-right tabular-nums font-semibold">Q {fmtNum(f.ValorDia, 2)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtNum(f.HorasJornada, 1)}</td>
                <td className="px-4 py-2">{f.Acuerdo ?? ""}</td>
                <td className="px-4 py-2 text-gray-500">{f.CreadoPor}</td>
                <td className="px-4 py-2 text-right">
                  {puedeAprobar && !f.VigenteHasta && <button onClick={() => deshacer(f)} className="text-xs text-red-600 hover:bg-red-50 rounded px-1.5 py-0.5">Deshacer</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
