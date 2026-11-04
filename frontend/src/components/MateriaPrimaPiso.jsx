// Materia Prima tomada del inventario al piso: tomar (y unificar), bajar al piso, descarte y deshacer.
// La regla de negocio vive en backend/src/lib/destajoPiso.ts; acá solo se escoge y se confirma.
import { useState, useEffect, useMemo } from "react";
import { fmtNum } from "../utils/numero.js";
import { authHeader } from "../context/AuthContext.jsx";

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
  const [sel, setSel] = useState({});        // Clave → { kg, piscinaId, ciclo }
  const [piscinas, setPiscinas] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [hecho, setHecho] = useState(null);
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
    setCargando(true); setError(""); setSel({});
    fetch(`${API}/saldo?bodega=${enc(bodega)}`, { headers: authHeader() }).then(leerJSON).then(d => {
      if (!vigente) return;
      if (Array.isArray(d)) setLineas(d);
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
  const kgDe = l => Number(sel[l.Clave]?.kg ?? 0);
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
      const kg = kgDe(l);
      if (!(kg > 0)) return `${l.Lote}: los kilos deben ser mayores que cero`;
      if (kg > l.Kg + 0.001) return `${l.Lote}: al piso solo hay ${fmtNum(l.Kg)} kg`;
      if (!l.Legible && !sel[l.Clave]?.piscinaId) return `${l.Lote}: escoja la piscina`;
    }
    return "";
  })();

  const alternar = (l) => setSel(s => {
    const n = { ...s };
    if (n[l.Clave]) delete n[l.Clave]; else n[l.Clave] = { kg: l.Kg, piscinaId: "", ciclo: "" };
    return n;
  });
  const cambiar = (l, campo, v) => setSel(s => ({ ...s, [l.Clave]: { ...s[l.Clave], [campo]: v } }));
  const todas = lineas.length > 0 && elegidas.length === lineas.length;
  const alternarTodas = () => setSel(todas ? {} : Object.fromEntries(lineas.map(l => [l.Clave, { kg: l.Kg, piscinaId: "", ciclo: "" }])));

  const tomar = async (unificar) => {
    if (problema) { setError(problema); return; }
    setGuardando(true); setError("");
    try {
      const res = await fetch(`${API}/tomar`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({
          Bodega: bodega, Unificar: unificar, ...(unificar ? { BaseLote: base } : {}),
          Lineas: elegidas.map(l => ({
            RemisionId: l.RemisionId, Lote: l.Lote, Clase: l.Clase, Talla: l.Talla, FechaLote: l.FechaLote,
            Kg: kgDe(l),
            ...(!l.Legible ? { PiscinaId: Number(sel[l.Clave].piscinaId), Ciclo: sel[l.Clave].ciclo ? Number(sel[l.Clave].ciclo) : null } : {}),
          })),
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
                <th className="px-3 py-2 text-left">Viene de</th>
                <th className="px-3 py-2 text-right">Al piso</th>
                <th className="px-3 py-2 text-right w-28">Tomar kg</th>
                <th className="px-3 py-2 text-left">Lote de Destajo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lineas.map(l => {
                const s = sel[l.Clave];
                return (
                  <tr key={l.Clave} className={s ? "bg-blue-50" : "hover:bg-gray-50"}>
                    <td className="px-3 py-2"><input type="checkbox" checked={!!s} onChange={() => alternar(l)} className="w-4 h-4" /></td>
                    <td className="px-3 py-2 font-mono text-gray-800 whitespace-nowrap">
                      {l.Lote}
                      {l.NombreFinca && <span className="block text-[11px] font-sans text-gray-400">{l.NombreFinca}</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-gray-700">{l.Clase}</td>
                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{l.Talla === 900 ? <span className="text-gray-300">—</span> : l.DescripcionTalla}</td>
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                      {l.EsBajado ? <span className="text-amber-700">Bajado de la mesa{l.EsRojo ? " · rojo a revisar" : ""}</span> : (l.FolioRemision || "—")}
                      <span className="block text-[11px] text-gray-400">{l.DiasAlPiso === 0 ? "hoy" : `${l.DiasAlPiso} día${l.DiasAlPiso !== 1 ? "s" : ""} al piso`}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-gray-800 whitespace-nowrap">{fmtNum(l.Kg)}</td>
                    <td className="px-3 py-2 text-right">
                      {s && (
                        <input type="number" step="0.01" min="0" max={l.Kg} value={s.kg} onChange={e => cambiar(l, "kg", e.target.value)}
                          className="w-24 border border-gray-300 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400" />
                      )}
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
        body: JSON.stringify({ Peso: Number(peso), Talla: talla || null, Nota: nota || null,
                               Motivo: motivo, ...(bajar ? { Bodega: bodega || null } : {}) }),
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
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Peso ({lote.UM}) *</label>
            <input required autoFocus type="number" step="0.01" min="0.01" value={peso} onChange={e => setPeso(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Talla</label>
            <select value={talla} onChange={e => setTalla(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="">Sin talla</option>
              {tallas.map(t => <option key={t.Codigo} value={t.Codigo}>{t.Descripcion}</option>)}
            </select>
          </div>
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

// ── Movimientos del piso de un lote ─────────────────────────────────────────────────────────────
const TITULO = { DESTAJO: "Tomado del piso", BAJADO: "Bajado al piso", DESCARTE: "Descarte" };
const DESHACER = { DESTAJO: "Devolver al piso", BAJADO: "Deshacer", DESCARTE: "Deshacer" };

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
      {["DESTAJO", "BAJADO", "DESCARTE"].map(tipo => {
        const lista = movs.filter(m => m.Tipo === tipo);
        if (!lista.length) return null;
        return (
          <div key={tipo} className="px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">{TITULO[tipo]}</p>
            {lista.map(m => (
              <div key={m.MovimientoId} className="flex items-center gap-3 text-sm py-1">
                <span className="flex-1 min-w-0 truncate text-gray-700">
                  {tipo === "DESTAJO" && <><span className="font-mono">{m.LoteOrigen}</span>{m.FolioRemision ? ` · ${m.FolioRemision}` : ""}</>}
                  {tipo === "BAJADO" && <>{m.Motivo ? `${m.Motivo} · ` : ""}{m.NombreBodega} · {m.Fecha}</>}
                  {tipo === "DESCARTE" && <>{m.Motivo || "Descarte"}</>}
                  {m.Talla !== 900 && <span className="text-gray-400"> · {m.DescripcionTalla}</span>}
                </span>
                <span className="font-semibold text-gray-800 whitespace-nowrap">
                  {tipo === "DESTAJO" ? `${fmtNum(m.PesoKg)} kg` : `${fmtNum(m.Peso)} ${m.UM}`}
                </span>
                {puedeEditar && (
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
