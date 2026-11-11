// Materia Prima tomada del inventario al piso: tomar (y unificar), bajar al piso, descarte y deshacer.
// La regla de negocio vive en backend/src/lib/destajoPiso.ts; acá solo se escoge y se confirma.
import { useState, useEffect, useMemo, Fragment } from "react";
import { fmtNum } from "../utils/numero.js";
import { authHeader } from "../context/AuthContext.jsx";
import InventarioPisoModal from "./InventarioPisoModal.jsx";

const API = "/api/destajo-piso";
const enc = encodeURIComponent;

async function leerJSON(res) {
  try { return await res.json(); } catch { return {}; }
}
// La bodega escogida se recuerda por navegador: el encargado de Pelado siempre abre en Pelado.
const PREF_BODEGA = "materiaprima_piso_bodega";
function leerPref() { try { return localStorage.getItem(PREF_BODEGA) || ""; } catch { return ""; } }
function guardarPref(v) { try { localStorage.setItem(PREF_BODEGA, v); } catch { /* sin almacenamiento */ } }

function Marco({ titulo, ancho = "max-w-lg", onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-white rounded-xl shadow-xl w-full ${ancho} max-h-full flex flex-col`} onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
          <h3 className="text-lg font-bold text-gray-800">{titulo}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Tomar del piso ──────────────────────────────────────────────────────────────────────────────
export function TomarDelPisoModal({ onHecho, onClose }) {
  const [bodegas, setBodegas] = useState([]);
  const [bodega, setBodega] = useState(leerPref());
  const [lineas, setLineas] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [sel, setSel] = useState({});        // Clave → { kg, piscinaId, ciclo, termos? }
  // Las líneas con termos se abren hacia abajo y se toma termo por termo: termos = { termo → kg }
  // ("" es lo que queda sin termo identificado).
  const [abiertas, setAbiertas] = useState(() => new Set());
  const [piscinas, setPiscinas] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [hecho, setHecho] = useState(null);
  const [imprimir, setImprimir] = useState(false);   // vista previa del inventario al piso
  const [unificando, setUnificando] = useState(false);   // paso de escoger el lote al unificar
  const [base, setBase] = useState("");                   // el lote de origen que da el código

  useEffect(() => {
    fetch(`${API}/bodegas`, { headers: authHeader() }).then(leerJSON).then(d => {
      if (!Array.isArray(d)) return;
      setBodegas(d);
      setBodega(b => (d.some(x => x.Codigo === b) ? b : d[0]?.Codigo || ""));
    });
  }, []);

  useEffect(() => {
    if (!bodega) return;
    guardarPref(bodega);
    let vigente = true;
    setCargando(true); setError(""); setSel({}); setAbiertas(new Set());
    fetch(`${API}/saldo?bodega=${enc(bodega)}`, { headers: authHeader() }).then(leerJSON).then(d => {
      if (!vigente) return;
      // Días al piso de menor a mayor, igual que el inventario impreso; con los mismos días se queda
      // el orden del servidor (fecha del lote, remisión).
      if (Array.isArray(d)) setLineas([...d].sort((a, b) => (a.DiasAlPiso ?? 0) - (b.DiasAlPiso ?? 0)));
      else { setLineas([]); setError(d.error || "No se pudo leer el piso"); }
    }).catch(e => { if (vigente) setError(e.message); })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [bodega]);

  // Solo si hay códigos que no se pudieron leer: el encargado escoge la piscina a mano.
  const hayIlegibles = lineas.some(l => !l.Legible);
  useEffect(() => {
    if (!hayIlegibles || piscinas.length) return;
    fetch("/api/piscina", { headers: authHeader() }).then(leerJSON).then(d => { if (Array.isArray(d)) setPiscinas(d.filter(p => p.Activo)); });
  }, [hayIlegibles, piscinas.length]);

  const elegidas = lineas.filter(l => sel[l.Clave]);
  const conTermos = l => (l.TermosDetalle?.length ?? 0) > 0;
  const llaveTermo = t => t.Termo ?? "";
  const kgDe = l => conTermos(l)
    ? Object.values(sel[l.Clave]?.termos ?? {}).reduce((x, v) => x + Number(v || 0), 0)
    : Number(sel[l.Clave]?.kg ?? 0);
  const fincaDe = l => l.Legible ? l.CodigoFinca : piscinas.find(p => p.PiscinaId === Number(sel[l.Clave]?.piscinaId))?.CodigoFinca;
  const fincas = new Set(elegidas.map(fincaDe).filter(Boolean));
  const totalKg = elegidas.reduce((s, l) => s + kgDe(l), 0);

  // Candidatos a dar el código al unificar: los lotes de origen marcados, el de más kilos primero
  // (casi siempre es el que se usa). Ninguno viene escogido: lo decide el encargado.
  const candidatos = (() => {
    const m = new Map();
    for (const l of elegidas) {
      if (!m.has(l.Lote)) m.set(l.Lote, { Lote: l.Lote, codigo: l.LoteDestajo, kg: 0 });
      m.get(l.Lote).kg += kgDe(l);
    }
    return [...m.values()].sort((a, b) => b.kg - a.kg);
  })();
  // Sifones y lotes genéricos (EM00-E00, TM00-E00) van siempre solos.
  const solos = [...new Set(elegidas.filter(l => l.NoUnificable).map(l => l.Lote))];
  const puedeUnificar = candidatos.length >= 2 && fincas.size === 1 && solos.length === 0;
  const clasesMarcadas = [...new Set(elegidas.map(l => l.Clase))];

  // Qué lotes saldrían sin unificar: uno por código + clase.
  const vista = useMemo(() => {
    const m = new Map();
    for (const l of elegidas) {
      const codigo = l.LoteDestajo || "(piscina escogida)";
      const k = `${codigo}|${l.Clase}`;
      if (!m.has(k)) m.set(k, { codigo, clase: l.Clase, kg: 0, n: 0, existe: l.ExisteHoy });
      const g = m.get(k); g.kg += kgDe(l); g.n += 1;
    }
    return [...m.values()];
  }, [elegidas, sel]);   // eslint-disable-line react-hooks/exhaustive-deps

  const problema = (() => {
    for (const l of elegidas) {
      if (conTermos(l)) {
        for (const t of l.TermosDetalle) {
          const v = sel[l.Clave].termos[llaveTermo(t)];
          if (v === undefined) continue;
          const nombre = t.Termo ? `termo ${t.Termo}` : "sin termo";
          if (!(Number(v) > 0)) return `${l.Lote} ${nombre}: los kilos deben ser mayores que cero`;
          if (Number(v) > t.Kg + 0.001) return `${l.Lote} ${nombre}: al piso solo hay ${fmtNum(t.Kg)} kg`;
        }
      }
      const kg = kgDe(l);
      if (!(kg > 0)) return `${l.Lote}: los kilos deben ser mayores que cero`;
      if (kg > l.Kg + 0.001) return `${l.Lote}: al piso solo hay ${fmtNum(l.Kg)} kg`;
      if (!l.Legible && !sel[l.Clave]?.piscinaId) return `${l.Lote}: escoja la piscina`;
    }
    return "";
  })();

  // Marcar la línea completa = todos sus termos.
  const nuevaSel = l => ({ kg: l.Kg, piscinaId: "", ciclo: "",
    ...(conTermos(l) ? { termos: Object.fromEntries(l.TermosDetalle.map(t => [llaveTermo(t), t.Kg])) } : {}) });
  const alternar = (l) => setSel(s => {
    const n = { ...s };
    if (n[l.Clave]) delete n[l.Clave]; else n[l.Clave] = nuevaSel(l);
    return n;
  });
  const alternarTermo = (l, t) => setSel(s => {
    const n = { ...s };
    const actual = n[l.Clave] ?? { ...nuevaSel(l), termos: {} };
    const termos = { ...actual.termos };
    const k = llaveTermo(t);
    if (k in termos) delete termos[k]; else termos[k] = t.Kg;
    if (Object.keys(termos).length === 0) delete n[l.Clave]; else n[l.Clave] = { ...actual, termos };
    return n;
  });
  const cambiarTermo = (l, t, v) => setSel(s => ({
    ...s, [l.Clave]: { ...s[l.Clave], termos: { ...s[l.Clave].termos, [llaveTermo(t)]: v } } }));
  const abrir = (l) => setAbiertas(prev => {
    const n = new Set(prev);
    if (n.has(l.Clave)) n.delete(l.Clave); else n.add(l.Clave);
    return n;
  });
  const cambiar = (l, campo, v) => setSel(s => ({ ...s, [l.Clave]: { ...s[l.Clave], [campo]: v } }));
  const todas = lineas.length > 0 && elegidas.length === lineas.length;
  const alternarTodas = () => setSel(todas ? {} : Object.fromEntries(lineas.map(l => [l.Clave, nuevaSel(l)])));

  const tomar = async (unificar) => {
    if (problema) { setError(problema); return; }
    setGuardando(true); setError("");
    try {
      const res = await fetch(`${API}/tomar`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({
          Bodega: bodega, Unificar: unificar, ...(unificar ? { BaseLote: base } : {}),
          // Una línea por termo escogido: el servidor guarda de qué termo salió cada toma.
          Lineas: elegidas.flatMap(l => {
            const base = {
              RemisionId: l.RemisionId, Lote: l.Lote, Clase: l.Clase, Talla: l.Talla, FechaLote: l.FechaLote,
              ...(!l.Legible ? { PiscinaId: Number(sel[l.Clave].piscinaId), Ciclo: sel[l.Clave].ciclo ? Number(sel[l.Clave].ciclo) : null } : {}),
            };
            if (!conTermos(l)) return [{ ...base, Kg: kgDe(l) }];
            return Object.entries(sel[l.Clave].termos).map(([k, v]) => ({ ...base, Termo: k || null, Kg: Number(v) }));
          }),
        }),
      });
      const d = await leerJSON(res);
      if (!res.ok) { setError(d.error || "No se pudo tomar del piso"); return; }
      setHecho(d.lotes || []);
    } catch (e) {
      setError(e.message || "No se pudo conectar con el servidor");
    } finally { setGuardando(false); }
  };

  if (hecho) {
    return (
      <Marco titulo="Tomado del piso" onClose={() => onHecho()}>
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-gray-600">Quedaron en Materia Prima:</p>
          <ul className="space-y-1">
            {hecho.map(l => (
              <li key={`${l.Lote}-${l.Clase}`} className="flex justify-between text-sm bg-green-50 border border-green-200 rounded px-3 py-2">
                <span className="font-mono font-bold text-gray-800">{l.Lote} <span className="text-gray-500">{l.Clase}</span></span>
                <span className="text-gray-700">{fmtNum(l.Kg)} kg · {l.Lineas} línea{l.Lineas !== 1 ? "s" : ""}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end pt-1">
            <button onClick={() => onHecho()} className="px-5 py-2 text-sm bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition">Listo</button>
          </div>
        </div>
      </Marco>
    );
  }

  if (unificando) {
    const escogido = candidatos.find(c => c.Lote === base);
    return (
      <Marco titulo="Unificar en un lote" onClose={onClose}>
        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          <p className="text-sm text-gray-600">
            ¿Con cuál lote se unifica? Todo lo marcado — <b>{elegidas.length}</b> líneas, <b>{fmtNum(totalKg)}</b> kg — entra a ese lote.
          </p>
          <div className="space-y-2">
            {candidatos.map(c => (
              <label key={c.Lote}
                className={`flex items-center gap-3 border rounded-lg px-3 py-2.5 cursor-pointer transition ${base === c.Lote ? "border-blue-600 bg-blue-50" : "border-gray-200 hover:bg-gray-50"}`}>
                <input type="radio" name="base" checked={base === c.Lote} onChange={() => setBase(c.Lote)} className="w-4 h-4" />
                <span className="flex-1 min-w-0">
                  <span className="block font-mono font-bold text-gray-800">{c.codigo || c.Lote}</span>
                  <span className="block text-xs text-gray-500">de {c.Lote}</span>
                </span>
                <span className="text-sm font-semibold text-gray-700 whitespace-nowrap">{fmtNum(c.kg)} kg</span>
              </label>
            ))}
          </div>
          {clasesMarcadas.length > 1 && (
            <p className="text-xs text-amber-700">Hay {clasesMarcadas.length} clases ({clasesMarcadas.join(", ")}): se crea un lote por clase con ese mismo código.</p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => { setUnificando(false); setError(""); }}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition">Volver</button>
            <button onClick={() => tomar(true)} disabled={guardando || !escogido}
              className="px-5 py-2 text-sm bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition disabled:opacity-40 disabled:cursor-not-allowed">
              {guardando ? "Guardando…" : escogido ? `Unificar en ${escogido.codigo || escogido.Lote}` : "Escoja un lote"}
            </button>
          </div>
        </div>
      </Marco>
    );
  }

  return (
    <Marco titulo="Tomar del piso" ancho="max-w-5xl" onClose={onClose}>
      <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3 shrink-0">
        <label className="text-xs font-medium text-gray-500">Piso de</label>
        <select value={bodega} onChange={e => setBodega(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
          {bodegas.map(b => <option key={b.Codigo} value={b.Codigo}>{b.Nombre}</option>)}
        </select>
        <span className="text-xs text-gray-400">El peso es el de la báscula de Descongelado: no se teclea.</span>
        <button onClick={() => setImprimir(true)} disabled={cargando || lineas.length === 0}
          title="Lo que hay al piso de esta bodega, agrupado por clase"
          className="ml-auto px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition disabled:opacity-40 disabled:cursor-not-allowed">
          Imprimir inventario
        </button>
      </div>

      <div className="overflow-auto flex-1 min-h-0">
        {cargando ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : lineas.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400">
            {error || "No hay nada al piso. Lo que Descongelado traslada a esta bodega aparece aquí."}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
              <tr>
                <th className="px-3 py-2 w-8"><input type="checkbox" checked={todas} onChange={alternarTodas} className="w-4 h-4" /></th>
                <th className="px-3 py-2 text-left">Lote de origen</th>
                <th className="px-3 py-2 text-left">Clase</th>
                <th className="px-3 py-2 text-left">Talla</th>
                <th className="px-3 py-2 text-right">Al piso</th>
                <th className="px-3 py-2 text-right w-28">Tomar kg</th>
                <th className="px-3 py-2 text-left w-28">Termo</th>
                <th className="px-3 py-2 text-left">Lote de Destajo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lineas.map(l => {
                const s = sel[l.Clave];
                const termos = conTermos(l);
                const abierta = termos && abiertas.has(l.Clave);
                const nTermos = termos ? Object.keys(s?.termos ?? {}).length : 0;
                return (
                  <Fragment key={l.Clave}>
                  {/* Rojo claro: lleva 2 días o más al piso. Marcada, manda el azul de lo escogido. */}
                  <tr className={s ? "bg-blue-50" : l.DiasAlPiso >= 2 ? "bg-red-50 hover:bg-red-100" : "hover:bg-gray-50"}>
                    <td className="px-3 py-2"><input type="checkbox" checked={!!s} onChange={() => alternar(l)} className="w-4 h-4" /></td>
                    <td className={`px-3 py-2 font-mono text-gray-800 whitespace-nowrap ${termos ? "cursor-pointer select-none" : ""}`}
                      onClick={termos ? () => abrir(l) : undefined}
                      title={termos ? (abierta ? "Ocultar los termos" : "Ver los termos y tomar de ahí") : undefined}>
                      {termos && <span className="inline-block w-4 text-blue-600 font-sans">{abierta ? "▾" : "▸"}</span>}
                      {l.Lote}
                      {l.NombreFinca && <span className="block text-[11px] font-sans text-gray-400">{l.NombreFinca}</span>}
                      {/* Lo que no viene de Descongelado se marca: el rojo se tiene que revisar antes. */}
                      {l.EsBajado && <span className="block text-[11px] font-sans text-amber-700">Bajado de la mesa{l.EsRojo ? " · rojo a revisar" : ""}</span>}
                      {l.EsCola && <span className="block text-[11px] font-sans text-emerald-700">Cola de Descabezado</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-700" title={l.Clase}>{l.DescripcionClase || l.Clase}</td>
                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{l.Talla === 900 ? <span className="text-gray-300">—</span> : l.DescripcionTalla}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <span className="font-semibold text-gray-800">{fmtNum(l.Kg)}</span>
                      {/* Desde la primera entrada de esta línea al piso; de 2 días en adelante se resalta. */}
                      <span className={`block text-[11px] ${l.DiasAlPiso >= 2 ? "text-red-600 font-semibold" : l.DiasAlPiso >= 1 ? "text-amber-700" : "text-gray-400"}`}>
                        {l.DiasAlPiso === 0 ? "entró hoy" : `${l.DiasAlPiso} día${l.DiasAlPiso !== 1 ? "s" : ""} al piso`}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {/* Con termos, lo tomado es la suma de los termos marcados (se ajusta abajo). */}
                      {s && termos && <span className="font-semibold text-blue-700 whitespace-nowrap">{fmtNum(kgDe(l))}</span>}
                      {s && !termos && (
                        <input type="number" step="0.01" min="0" max={l.Kg} value={s.kg} onChange={e => cambiar(l, "kg", e.target.value)}
                          className="w-24 border border-gray-300 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400" />
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {termos ? (
                        <button type="button" onClick={() => abrir(l)}
                          className="text-xs font-medium text-blue-700 hover:underline">
                          {s ? `${nTermos} de ${l.TermosDetalle.length}` : l.TermosDetalle.length} termo{l.TermosDetalle.length !== 1 ? "s" : ""}
                        </button>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {l.Legible ? (
                        <>
                          <span className="font-mono font-semibold text-gray-800">{l.LoteDestajo}</span>
                          {l.ExisteHoy === "MANUAL" && <span className="block text-[11px] text-red-600">ya existe capturado a mano</span>}
                          {l.ExisteHoy && l.ExisteHoy !== "MANUAL" && <span className="block text-[11px] text-gray-400">se suma al de hoy</span>}
                        </>
                      ) : s ? (
                        <div className="flex gap-1">
                          <select value={s.piscinaId} onChange={e => cambiar(l, "piscinaId", e.target.value)}
                            className="border border-amber-300 rounded px-1 py-1 text-xs max-w-[9rem]">
                            <option value="">Piscina…</option>
                            {piscinas.map(p => <option key={p.PiscinaId} value={p.PiscinaId}>{p.Nombre}</option>)}
                          </select>
                          <input type="number" min="1" placeholder="Ciclo" value={s.ciclo} onChange={e => cambiar(l, "ciclo", e.target.value)}
                            className="w-16 border border-amber-300 rounded px-1 py-1 text-xs" />
                        </div>
                      ) : (
                        <span className="text-xs text-amber-700">código no reconocido</span>
                      )}
                    </td>
                  </tr>
                  {abierta && l.TermosDetalle.map(t => {
                    const k = llaveTermo(t);
                    const v = s?.termos?.[k];
                    const marcado = v !== undefined;
                    return (
                      <tr key={`${l.Clave}#${k}`} className={marcado ? "bg-blue-50/60" : "bg-slate-50"}>
                        <td className="px-3 py-1.5" />
                        <td className="pl-8 pr-3 py-1.5" colSpan={3}>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={marcado} onChange={() => alternarTermo(l, t)} className="w-4 h-4" />
                            {t.Termo
                              ? <span className="text-gray-700">Termo <b className="font-mono">{t.Termo}</b></span>
                              : <span className="text-gray-500 italic">Sin termo identificado</span>}
                          </label>
                        </td>
                        <td className="px-3 py-1.5 text-right text-gray-700 whitespace-nowrap">{fmtNum(t.Kg)}</td>
                        <td className="px-3 py-1.5 text-right">
                          {marcado && (
                            <input type="number" step="0.01" min="0" max={t.Kg} value={v} onChange={e => cambiarTermo(l, t, e.target.value)}
                              className="w-24 border border-gray-300 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400" />
                          )}
                        </td>
                        <td colSpan={2} />
                      </tr>
                    );
                  })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="px-5 py-3 border-t border-gray-200 shrink-0 space-y-2">
        {elegidas.length > 0 && (
          <div className="text-xs text-gray-600 flex flex-wrap gap-x-4 gap-y-1">
            <span><b>{elegidas.length}</b> línea{elegidas.length !== 1 ? "s" : ""} · <b>{fmtNum(totalKg)}</b> kg</span>
            <span className="text-gray-400">Sin unificar: {vista.map(v => `${v.codigo} ${v.clase} (${fmtNum(v.kg)} kg)`).join(" · ")}</span>
          </div>
        )}
        {fincas.size > 1 && (
          <p className="text-xs text-amber-700">Para unificar, todas las líneas tienen que ser de la misma finca.</p>
        )}
        {solos.length > 0 && candidatos.length >= 2 && (
          <p className="text-xs text-amber-700">{solos.join(", ")}: sifón y lotes genéricos (00-E00) no se unifican, van solos.</p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition">Cancelar</button>
          <button onClick={() => { if (problema) { setError(problema); return; } setBase(""); setError(""); setUnificando(true); }}
            disabled={guardando || !puedeUnificar}
            title="Todo lo marcado en un solo lote: en el paso siguiente se escoge cuál"
            className="px-4 py-2 text-sm font-semibold rounded-lg border border-blue-600 text-blue-700 hover:bg-blue-50 transition disabled:opacity-40 disabled:cursor-not-allowed">
            Unificar en un lote
          </button>
          <button onClick={() => tomar(false)} disabled={guardando || elegidas.length === 0}
            className="px-5 py-2 text-sm bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition disabled:opacity-40 disabled:cursor-not-allowed">
            {guardando ? "Guardando…" : `Crear lote${vista.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>

      {imprimir && (
        <InventarioPisoModal nombreBodega={bodegas.find(b => b.Codigo === bodega)?.Nombre ?? bodega}
          lineas={lineas} onCerrar={() => setImprimir(false)} />
      )}
    </Marco>
  );
}

// ── Bajar al piso / Descarte ────────────────────────────────────────────────────────────────────
// El rojo NO es descarte: se separa y se vuelve a revisar, así que se BAJA al piso.
const MOTIVOS_DESCARTE = ["Descarte", "Otro"];
const MOTIVOS_BAJADO = [{ valor: "Sobrante", texto: "Sobrante" }, { valor: "Rojo", texto: "Rojo (a revisar)" }];

export function AjusteLoteModal({ tipo, lote, tallas, onHecho, onClose }) {
  const bajar = tipo === "bajar";
  const [peso, setPeso] = useState("");
  const [termo, setTermo] = useState("");
  const [talla, setTalla] = useState("");
  const [bodega, setBodega] = useState("");
  const [bodegas, setBodegas] = useState([]);
  const [motivo, setMotivo] = useState(bajar ? MOTIVOS_BAJADO[0].valor : MOTIVOS_DESCARTE[0]);
  const [nota, setNota] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!bajar) return;
    fetch(`${API}/bodegas`, { headers: authHeader() }).then(leerJSON).then(d => { if (Array.isArray(d)) setBodegas(d); });
  }, [bajar]);

  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true); setError("");
    try {
      const res = await fetch(`${API}/lote/${enc(lote.Lote)}/${enc(lote.Clase)}/${bajar ? "bajar" : "descarte"}`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ Peso: Number(peso), Talla: bajar ? talla || null : null, Nota: nota || null,
                               Motivo: motivo, ...(bajar ? { Bodega: bodega || null, NumeroTermo: termo.trim() } : {}) }),
      });
      const d = await leerJSON(res);
      if (!res.ok) { setError(d.error || "No se pudo guardar"); return; }
      onHecho();
    } catch (err) {
      setError(err.message || "No se pudo conectar con el servidor");
    } finally { setGuardando(false); }
  };

  return (
    <Marco titulo={`${bajar ? "Bajar al piso" : "Descarte"} — ${lote.Lote} ${lote.Clase}`} onClose={onClose}>
      <form onSubmit={guardar} className="px-5 py-4 space-y-4">
        <p className="text-xs text-gray-500">
          {bajar
            ? "Lo que no se terminó en la mesa, o el rojo que se separa para revisarlo otra vez, vuelve al inventario al piso y se toma otro día desde \"Tomar del piso\". No cuenta en el rendimiento de este lote."
            : "Merma del lote. No va al piso y sí cuenta en el rendimiento. El rojo no es descarte: se baja al piso."}
          {" "}Quedan <b>{fmtNum(Math.max(lote.Pendiente, 0))} {lote.UM}</b> sin pesar.
        </p>
        <div className={`grid gap-4 ${bajar ? "grid-cols-3" : "grid-cols-1"}`}>
          {bajar && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1"># Termo *</label>
              <input required autoFocus type="text" maxLength={20} value={termo} onChange={e => setTermo(e.target.value)}
                title="El termo en que queda al piso"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Peso ({lote.UM}) *</label>
            <input required autoFocus={!bajar} type="number" step="0.01" min="0.01" value={peso} onChange={e => setPeso(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          {/* El descarte no lleva talla (usuario, 9 nov 2026): va sin talla (900). */}
          {bajar && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Talla</label>
              <select value={talla} onChange={e => setTalla(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                <option value="">Sin talla</option>
                {tallas.map(t => <option key={t.Codigo} value={t.Codigo}>{t.Descripcion}</option>)}
              </select>
            </div>
          )}
        </div>
        {bajar && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Motivo *</label>
            <div className="flex gap-2">
              {MOTIVOS_BAJADO.map(m => (
                <button type="button" key={m.valor} onClick={() => setMotivo(m.valor)}
                  className={`px-3 py-1.5 text-sm rounded-lg border transition ${motivo === m.valor ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
                  {m.texto}
                </button>
              ))}
            </div>
          </div>
        )}
        {bajar ? (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">A qué piso</label>
            <select value={bodega} onChange={e => setBodega(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="">El piso del que salió el lote</option>
              {bodegas.map(b => <option key={b.Codigo} value={b.Codigo}>{b.Nombre}</option>)}
            </select>
          </div>
        ) : (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Motivo *</label>
            <div className="flex gap-2">
              {MOTIVOS_DESCARTE.map(m => (
                <button type="button" key={m} onClick={() => setMotivo(m)}
                  className={`px-3 py-1.5 text-sm rounded-lg border transition ${motivo === m ? "bg-red-600 text-white border-red-600" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Nota</label>
          <input type="text" maxLength={150} value={nota} onChange={e => setNota(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-3 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition">Cancelar</button>
          <button type="submit" disabled={guardando}
            className={`px-5 py-2 text-sm text-white font-semibold rounded-lg transition disabled:opacity-50 ${bajar ? "bg-blue-600 hover:bg-blue-700" : "bg-red-600 hover:bg-red-700"}`}>
            {guardando ? "Guardando…" : bajar ? "Bajar al piso" : "Registrar descarte"}
          </button>
        </div>
      </form>
    </Marco>
  );
}

// ── Cola de un lote entero ──────────────────────────────────────────────────────────────────────
// En Descabezado lo que se pesa por persona es la CABEZA (el pago). La cola no va a nadie: se pesa el
// termo lleno y entra al piso de Pelado. El número de termo se teclea (no es el del pesaje de cabeza).
// El modal se queda abierto para seguir registrando termos durante el día.
const CLASES_COLA = ["D30", "D33", "D34", "D35"];   // las mismas que valida backend/src/lib/destajoPiso.ts

export function ColaModal({ lote, tallas, clases = [], onRegistrado, onClose }) {
  // Se muestra la descripción de la clase ("CULTIVO COLA COLA SIFON"), no el código: es como la
  // conoce el área.
  const descr = c => clases.find(x => x.Clase === c)?.Descripcion ?? c;
  const [termo, setTermo] = useState("");
  const [peso, setPeso] = useState("");
  const [claseCola, setClaseCola] = useState(lote.ClaseCola || CLASES_COLA[0]);
  const [talla, setTalla] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [hechos, setHechos] = useState([]);   // los termos registrados con este modal abierto

  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true); setError("");
    try {
      const res = await fetch(`${API}/lote/${enc(lote.Lote)}/${enc(lote.Clase)}/cola`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ NumeroTermo: termo.trim(), Peso: Number(peso), ClaseCola: claseCola, Talla: talla || null }),
      });
      const d = await leerJSON(res);
      if (!res.ok) { setError(d.error || "No se pudo registrar"); return; }
      setHechos(h => [...h, { termo: termo.trim(), peso: Number(peso), claseCola }]);
      setTermo(""); setPeso("");
      onRegistrado();
    } catch (err) {
      setError(err.message || "No se pudo conectar con el servidor");
    } finally { setGuardando(false); }
  };

  return (
    <Marco titulo={`Cola — ${lote.Lote} ${lote.Clase}`} onClose={onClose}>
      <form onSubmit={guardar} className="px-5 py-4 space-y-4">
        <p className="text-xs text-gray-500">
          Un registro por termo lleno. La cola queda <b>por trasladar</b>: al cerrar la transacción de Descabezado
          se escoge si va al piso de Pelado o al de Clasificado Cola. Lo pesado por persona es la cabeza (el pago)
          y no cambia.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">N° de termo *</label>
            <input required autoFocus type="text" maxLength={20} value={termo} onChange={e => setTermo(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Peso ({lote.UM}) *</label>
            <input required type="number" step="0.01" min="0.01" value={peso} onChange={e => setPeso(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Clase de la cola *</label>
          <div className="grid grid-cols-2 gap-1.5">
            {CLASES_COLA.map(c => (
              <button type="button" key={c} onClick={() => setClaseCola(c)}
                className={`px-2.5 py-1.5 text-sm text-left rounded-lg border transition ${claseCola === c ? "bg-emerald-600 text-white border-emerald-600" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
                {descr(c)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Talla</label>
          <select value={talla} onChange={e => setTalla(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
            <option value="">Sin talla</option>
            {tallas.map(t => <option key={t.Codigo} value={t.Codigo}>{t.Descripcion}</option>)}
          </select>
        </div>
        {hechos.length > 0 && (
          <div className="text-xs bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 space-y-0.5">
            {hechos.map((h, i) => (
              <p key={i} className="flex justify-between gap-3"><span>Termo <b className="font-mono">{h.termo}</b> · {descr(h.claseCola)}</span><span className="whitespace-nowrap">{fmtNum(h.peso)} {lote.UM}</span></p>
            ))}
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-3 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
            {hechos.length ? "Listo" : "Cancelar"}
          </button>
          <button type="submit" disabled={guardando}
            className="px-5 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg transition disabled:opacity-50">
            {guardando ? "Guardando…" : "Registrar termo"}
          </button>
        </div>
      </form>
    </Marco>
  );
}

// ── Cerrar una transacción: lo producido pasa al piso del siguiente proceso ─────────────────────
// Pelado: lo pesado de la transacción va al proceso que escoja el encargado (depende del cliente; no
// se propone ninguno). Descabezado: lo pesado es cabeza y no se traslada; lo que sale es la cola de los
// termos, cada uno a Pelado o a Clasificado Cola. Ver backend/src/lib/destajoPiso.ts.
export function CerrarTransaccionModal({ transaccionId, onHecho, onClose }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [destino, setDestino] = useState("");
  const [porTermo, setPorTermo] = useState({});   // MovimientoId → bodega
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vigente = true;
    fetch(`${API}/transaccion/${transaccionId}/cierre`, { headers: authHeader() }).then(leerJSON).then(d => {
      if (!vigente) return;
      if (!d.Modo) { setError(d.error || "No se pudo leer la transacción"); return; }
      setInfo(d);
      setDestino(d.DestinoSugerido ?? "");
      setPorTermo(Object.fromEntries(d.ColaPendiente.map(c => [c.MovimientoId, d.DestinoSugerido])));
    });
    return () => { vigente = false; };
  }, [transaccionId]);

  const cerrar = async () => {
    setGuardando(true); setError("");
    try {
      const res = await fetch(`/api/transacciones-produccion/${transaccionId}`, {
        method: "PUT", headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ Estado: "Cerrada", ...(info.Modo === "PELADO" ? { Destino: destino } : { DestinosCola: porTermo }) }),
      });
      const d = await leerJSON(res);
      if (!res.ok) { setError(d.error || "No se pudo cerrar"); return; }
      onHecho(d);
    } catch (e) {
      setError(e.message || "No se pudo conectar con el servidor");
    } finally { setGuardando(false); }
  };

  const nombre = c => info?.Destinos.find(d => d.Codigo === c)?.Nombre ?? c;
  const kgCola = (info?.ColaPendiente ?? []).reduce((s, c) => s + c.Peso, 0);
  const todosA = c => setPorTermo(Object.fromEntries(info.ColaPendiente.map(x => [x.MovimientoId, c])));

  return (
    <Marco titulo="Cerrar transacción" onClose={onClose}>
      <div className="px-5 py-4 space-y-4 overflow-y-auto">
        {!info ? (
          error ? <p className="text-sm text-red-600">{error}</p>
                : <div className="flex justify-center py-6"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <>
            <div className="text-sm text-gray-700">
              <p><span className="font-mono font-bold">{info.Lote}</span> · {info.DescripcionProceso}</p>
              <p className="text-gray-500">{info.DescripcionClasePT}{info.Talla !== 900 ? ` · ${info.DescripcionTalla}` : ""}</p>
            </div>

            {info.Modo === "PELADO" ? (
              info.Procesado > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm">Lo pelado, <b>{fmtNum(info.Procesado)} {info.UM}</b>, pasa al inventario al piso de:</p>
                  <select value={destino} onChange={e => setDestino(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                    <option value="" disabled>Escoja la bodega…</option>
                    {info.Destinos.map(d => <option key={d.Codigo} value={d.Codigo}>{d.Nombre}</option>)}
                  </select>
                </div>
              ) : (
                <p className="text-sm text-gray-500">No hay nada pesado en esta transacción: se cierra sin trasladar nada.</p>
              )
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">Lo pesado aquí es cabeza y no se traslada. Lo que pasa al siguiente proceso es la cola de los termos.</p>
                {info.ColaPendiente.length === 0 ? (
                  <p className="text-sm text-amber-700">No hay cola por trasladar en este lote. Si faltan termos, regístrelos antes de cerrar (botón "Cola (termo)" del lote).</p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                      <span>Cola por trasladar: <b>{info.ColaPendiente.length}</b> termo{info.ColaPendiente.length !== 1 ? "s" : ""} · <b>{fmtNum(kgCola)} {info.UM}</b></span>
                      <span className="ml-auto">Todos a:</span>
                      {info.Destinos.map(d => (
                        <button key={d.Codigo} type="button" onClick={() => todosA(d.Codigo)}
                          className="px-2 py-1 rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50 transition">{d.Nombre}</button>
                      ))}
                    </div>
                    <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                      {info.ColaPendiente.map(c => (
                        <div key={c.MovimientoId} className="flex items-center gap-3 px-3 py-2 text-sm">
                          <span className="flex-1 min-w-0 truncate">
                            Termo <b className="font-mono">{c.NumeroTermo}</b> · {c.DescripcionClase}{c.Talla !== 900 ? ` · ${c.DescripcionTalla}` : ""}
                          </span>
                          <span className="whitespace-nowrap font-semibold">{fmtNum(c.Peso)} {c.UM}</span>
                          <select value={porTermo[c.MovimientoId] ?? ""} onChange={e => setPorTermo(p => ({ ...p, [c.MovimientoId]: e.target.value }))}
                            className="border border-gray-300 rounded px-2 py-1 text-sm">
                            {info.Destinos.map(d => <option key={d.Codigo} value={d.Codigo}>{d.Nombre}</option>)}
                          </select>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            <p className="text-xs text-gray-400">Al cerrar ya no se pueden registrar pesajes en esta transacción.</p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-3 pt-1">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition">Cancelar</button>
              <button onClick={cerrar} disabled={guardando || (info.Modo === "PELADO" && info.Procesado > 0 && !destino)}
                className="px-5 py-2 text-sm bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg transition disabled:opacity-50">
                {guardando ? "Cerrando…"
                  : info.Modo === "PELADO" && info.Procesado > 0 ? (destino ? `Cerrar y trasladar a ${nombre(destino)}` : "Escoja la bodega")
                  : info.Modo === "DESCABEZADO" && info.ColaPendiente.length ? "Cerrar y trasladar la cola"
                  : "Cerrar"}
              </button>
            </div>
          </>
        )}
      </div>
    </Marco>
  );
}

// ── Movimientos del piso de un lote ─────────────────────────────────────────────────────────────
const TITULO = { DESTAJO: "Tomado del piso", COLA: "Cola (termos)", PROCESADO: "Trasladado al cerrar transacciones",
                 BAJADO: "Bajado al piso", DESCARTE: "Descarte" };
// Lo trasladado al cerrar no se deshace aquí: se deshace reabriendo la transacción.
const DESHACER = { DESTAJO: "Devolver al piso", COLA: "Deshacer", PROCESADO: null, BAJADO: "Deshacer", DESCARTE: "Deshacer" };

export function MovimientosPisoLote({ lote, recarga, puedeEditar, onCambio }) {
  const [movs, setMovs] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let vigente = true;
    setError("");
    fetch(`${API}/lote/${enc(lote.Lote)}/${enc(lote.Clase)}`, { headers: authHeader() }).then(leerJSON).then(d => {
      if (!vigente) return;
      if (Array.isArray(d.Movimientos)) setMovs(d.Movimientos); else { setMovs([]); setError(d.error || ""); }
    });
    return () => { vigente = false; };
  }, [lote.Lote, lote.Clase, recarga]);

  const deshacer = async (m) => {
    const que = m.Tipo === "DESTAJO"
      ? `¿Devolver al piso ${fmtNum(m.PesoKg)} kg de ${m.LoteOrigen}? El lote baja su ingreso${movs.length === 1 ? " (y se elimina si se queda sin nada)" : ""}.`
      : m.Tipo === "COLA"
      ? `¿Deshacer el termo ${m.NumeroTermo} de cola (${fmtNum(m.Peso)} ${m.UM})? Sale del piso de Pelado.`
      : `¿Deshacer este ${TITULO[m.Tipo].toLowerCase()} de ${fmtNum(m.Peso)} ${m.UM}?`;
    if (!confirm(que)) return;
    const res = await fetch(`${API}/movimiento/${m.MovimientoId}`, { method: "DELETE", headers: authHeader() });
    const d = await leerJSON(res);
    if (!res.ok) { alert(d.error || "No se pudo deshacer"); return; }
    onCambio(d);
  };

  if (error) return <p className="text-xs text-red-600 mb-3">{error}</p>;
  if (!movs.length) return null;

  return (
    <div className="bg-white rounded-xl shadow mb-4 divide-y divide-gray-100">
      {["DESTAJO", "COLA", "PROCESADO", "BAJADO", "DESCARTE"].map(tipo => {
        const lista = movs.filter(m => m.Tipo === tipo);
        if (!lista.length) return null;
        return (
          <div key={tipo} className="px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">{TITULO[tipo]}</p>
            {lista.map(m => (
              <div key={m.MovimientoId} className="flex items-center gap-3 text-sm py-1">
                <span className="flex-1 min-w-0 truncate text-gray-700">
                  {tipo === "DESTAJO" && <><span className="font-mono">{m.LoteOrigen}</span>{m.FolioRemision ? ` · ${m.FolioRemision}` : ""}{m.NumeroTermo && <> · Termo <span className="font-mono font-semibold">{m.NumeroTermo}</span></>}</>}
                  {tipo === "BAJADO" && <>{m.NumeroTermo && <>Termo <span className="font-mono font-semibold">{m.NumeroTermo}</span> · </>}{m.Motivo ? `${m.Motivo} · ` : ""}{m.NombreBodega} · {m.Fecha}</>}
                  {tipo === "DESCARTE" && <>{m.Motivo || "Descarte"}</>}
                  {tipo === "COLA" && <>Termo <span className="font-mono font-semibold">{m.NumeroTermo}</span> · {m.DescripcionClase || m.Clase} · {m.NombreBodega
                    ? <span className="text-emerald-700">→ {m.NombreBodega}</span>
                    : <span className="text-amber-700">por trasladar</span>}</>}
                  {tipo === "PROCESADO" && <>{m.DescripcionClase || m.Clase} · <span className="text-emerald-700">→ {m.NombreBodega}</span> · {m.Fecha}</>}
                  {m.Talla !== 900 && <span className="text-gray-400"> · {m.DescripcionTalla}</span>}
                </span>
                <span className="font-semibold text-gray-800 whitespace-nowrap">
                  {tipo === "DESTAJO" ? `${fmtNum(m.PesoKg)} kg` : `${fmtNum(m.Peso)} ${m.UM}`}
                </span>
                {puedeEditar && DESHACER[tipo] && (
                  <button onClick={() => deshacer(m)}
                    className="text-xs text-gray-500 hover:text-red-600 px-2 py-0.5 rounded hover:bg-red-50 transition whitespace-nowrap">
                    {DESHACER[tipo]}
                  </button>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
