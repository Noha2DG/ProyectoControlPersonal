// Pesar por termo — Descongelado (usuario, 9 nov 2026).
//
// Un lote de cien masters o más se descongela de a poco: unos cuantos masters por termo y cada termo
// pasa por la báscula. Este panel se abre desde una línea de AL PISO y se queda abierto mientras se
// pesa el lote. Por cada termo se escriben tres cosas, con Enter entre una y otra:
//   número del termo → masters (repite el del termo anterior) → kilos de la báscula.
// Cada Enter final REGISTRA el termo: llega al piso del destino en ese momento.
//
// - Los masters salen de las líneas del lote en el orden del piso (la remisión más vieja primero).
//   Si al lote le quedan menos de los que lleva el termo, se agrega otro lote ("+ Unir lote") y el
//   resto sale de ese: juntar lotes en un termo es UNIFICAR, con las reglas de siempre, y todo llega al destino
//   como el primer lote (la "base").
// - Lo pesado contra lo declarado tiene un rango, −5 % a +2 %. Fuera de él se pide confirmar.
// - Sin peso relleno: el único número que se pide es el de la báscula. En octubre la pantalla traía
//   lo declarado puesto y todas las hojas salieron con pesado = declarado.
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { fmtNum } from "../utils/numero.js";
import { authHeader } from "../context/AuthContext.jsx";

const API = "/api/descongelado";

// El mismo rango que RANGO_TERMO en backend/src/routes/descongelado.ts.
export const RANGO = { abajo: -5, arriba: 2 };
export const pctDif = (p, d) => (d > 0.001 ? (p - d) / d * 100 : 0);
export const fueraDeRango = (pct) => pct < RANGO.abajo - 1e-9 || pct > RANGO.arriba + 1e-9;
export const textoPct = (pct) => `${pct > 0.04 ? "+" : pct < -0.04 ? "−" : ""}${Math.abs(pct).toFixed(1)} %`;
const r2 = (n) => Number(n.toFixed(2));
async function leerJSON(res) { try { return await res.json(); } catch { return {}; } }

const claveLote = (r) => `${r.Lote}|${r.Clase}|${r.Talla}`;
const llaveDe = (r) => ({ RemisionId: r.RemisionId ?? null, Lote: r.Lote, Clase: r.Clase, Talla: r.Talla, FechaLote: r.FechaLote ?? null });
const horaDe = (f) => (f ? String(f).slice(11, 16) : "");

/** Los termos de una hoja: sus consumos y traslados juntados por PesadaId, el más viejo primero. */
export function termosDeHoja(hoja) {
  const porId = new Map();
  for (const e of hoja?.entrada || []) {
    if (e.PesadaId == null) continue;
    const t = porId.get(e.PesadaId) ?? { PesadaId: e.PesadaId, Termo: e.NumeroTermo, Hora: e.FechaHora, partes: [], traslados: [], Masters: 0, Declarado: 0, Pesado: 0 };
    t.partes.push(e);
    t.Masters += e.Masters || 0;
    t.Declarado += e.PesoKg;
    porId.set(e.PesadaId, t);
  }
  for (const d of hoja?.descongelado || []) {
    const t = d.PesadaId != null ? porId.get(d.PesadaId) : null;
    if (t) { t.traslados.push(d); t.Pesado += d.PesoKg; }
  }
  return [...porId.values()].sort((a, b) => a.PesadaId - b.PesadaId).map(t => {
    const d = t.traslados[0];
    const Declarado = r2(t.Declarado), Pesado = r2(t.Pesado);
    // "G643Q009" o, mezclado, "G643Q009 4 + G641Q009 8".
    const porLote = [];
    for (const p of t.partes) {
      const x = porLote.find(y => y.Lote === p.Lote);
      if (x) x.m += p.Masters || 0; else porLote.push({ Lote: p.Lote, m: p.Masters || 0 });
    }
    return {
      ...t, Declarado, Pesado, Dif: pctDif(Pesado, Declarado),
      Lotes: porLote.length > 1 ? porLote.map(x => `${x.Lote} ${x.m}`).join(" + ") : porLote[0]?.Lote ?? "",
      Destino: d?.BodegaDestino ?? "", NombreDestino: d?.NombreBodegaDestino ?? d?.BodegaDestino ?? "—",
      Llave: d ? llaveDe(d) : null,
    };
  });
}

function Caja({ etiqueta, children, nota }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1">{etiqueta}</label>
      {children}
      {nota && <div className="text-[11px] text-gray-500 mt-1 leading-tight">{nota}</div>}
    </div>
  );
}

export default function PesarPorTermo({
  hojasAbiertas, hojaInicial, linea, saldo, destinos, destinoSugerido, puedeEditar, puedeBorrar, onCambio, onCerrar,
}) {
  const [hojaId, setHojaId] = useState(hojaInicial);
  const [hoja, setHoja] = useState(null);
  const [destino, setDestino] = useState(destinoSugerido || "");
  const [extras, setExtras] = useState([]);          // lotes agregados para mezclar (claveLote), en orden
  const [termo, setTermo] = useState("");
  const [masters, setMasters] = useState("");
  const [kg, setKg] = useState("");
  const [error, setError] = useState("");
  const [porConfirmar, setPorConfirmar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [mezcla, setMezcla] = useState(null);         // null | { cargando, candidatos: [{ linea, problema }] }
  const [editando, setEditando] = useState(null);     // { PesadaId, Termo, Kg, confirmar }
  const [quitando, setQuitando] = useState(null);     // PesadaId por confirmar
  const refTermo = useRef(null), refMasters = useRef(null), refKg = useRef(null);
  const mastersPuestos = useRef(false);

  const principal = claveLote(linea);
  const lotesPanel = useMemo(() => [principal, ...extras], [principal, extras]);

  const quedanRef = useRef(0);
  const cargarHoja = useCallback(async (id) => {
    const res = await fetch(`${API}/hojas/${id}`, { headers: authHeader() });
    const data = await leerJSON(res);
    if (!res.ok) { setError(data.error || "No se pudo leer la hoja"); return; }
    setHoja(data);
    // Los masters del termo anterior, una sola vez al abrir: si el lote ya lleva termos, el
    // siguiente casi siempre lleva lo mismo.
    if (!mastersPuestos.current) {
      mastersPuestos.current = true;
      const previos = termosDeHoja(data).filter(t => t.partes.some(p => claveLote(p) === principal));
      const ultimo = previos[previos.length - 1];
      if (ultimo) setMasters(m => m || String(Math.min(ultimo.Masters, quedanRef.current) || ""));
    }
  }, [principal]);
  useEffect(() => { cargarHoja(hojaId); }, [hojaId, cargarHoja]);
  useEffect(() => { refTermo.current?.focus(); }, []);

  // Las líneas al piso de los lotes del panel, en el orden del piso: la remisión más vieja primero.
  const cola = useMemo(
    () => lotesPanel.flatMap(k => saldo.filter(r => claveLote(r) === k && (r.Masters ?? 0) > 0)),
    [lotesPanel, saldo]);
  const quedan = cola.reduce((s, r) => s + r.Masters, 0);
  useEffect(() => { quedanRef.current = quedan; }, [quedan]);
  const lineasPrincipal = cola.filter(r => claveLote(r) === principal);
  const quedanPrincipal = lineasPrincipal.reduce((s, r) => s + r.Masters, 0);

  const todos = useMemo(() => termosDeHoja(hoja), [hoja]);
  const termos = todos.filter(t => t.partes.some(p => lotesPanel.includes(claveLote(p))));
  const pesadosPrincipal = termos.reduce(
    (s, t) => s + t.partes.filter(p => claveLote(p) === principal).reduce((a, p) => a + (p.Masters || 0), 0), 0);
  const totalPrincipal = pesadosPrincipal + quedanPrincipal;

  // La llave con que llega al destino: la del primer termo de este lote en la hoja (así un lote que
  // se pesa en muchos termos, o se reabre el panel, sigue siendo UNA línea en el destino). Si el lote
  // todavía no tiene termos, su primera línea al piso.
  const primero = todos.find(t => t.Llave && t.partes.some(p => claveLote(p) === principal));
  const base = primero?.Llave ?? (lineasPrincipal[0] ? llaveDe(lineasPrincipal[0]) : cola[0] ? llaveDe(cola[0]) : null);

  const m = parseInt(masters, 10);
  const asignado = useMemo(() => {
    if (!(m > 0)) return null;
    let falta = m;
    const partes = [];
    for (const r of cola) {
      if (falta <= 0) break;
      const toma = Math.min(falta, r.Masters);
      partes.push({ linea: r, m: toma });
      falta -= toma;
    }
    return { partes, falta };
  }, [m, cola]);
  const declarado = asignado ? r2(asignado.partes.reduce((s, p) => s + r2(p.m * p.linea.KgPorMaster), 0)) : 0;
  const kgN = Number(kg);
  const pct = kgN > 0 && declarado > 0 ? pctDif(kgN, declarado) : null;
  const fuera = pct != null && fueraDeRango(pct);
  const mezclado = asignado && new Set(asignado.partes.map(p => claveLote(p.linea))).size > 1;
  const faltan = asignado ? asignado.falta : 0;
  const listo = !!destino && !!termo.trim() && !!asignado && faltan === 0 && kgN > 0 && !guardando && !!hoja;

  const registrar = async (confirmado = false) => {
    if (!listo) return;
    if (fuera && !confirmado) { setPorConfirmar(true); return; }
    setGuardando(true); setError("");
    try {
      const res = await fetch(`${API}/hojas/${hojaId}/termo`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({
          BodegaDestino: destino, NumeroTermo: termo.trim(), KgPesado: kgN, Base: base, Confirmado: confirmado,
          lineas: asignado.partes.map(p => ({ ...llaveDe(p.linea), KgPorMaster: p.linea.KgPorMaster, Masters: p.m })),
        }),
      });
      const data = await leerJSON(res);
      if (!res.ok) { setError(data.error || `Error ${res.status}`); return; }
      setTermo(""); setKg(""); setPorConfirmar(false);
      // Si para el siguiente ya no alcanza, se propone lo que queda (se cambia si se va a mezclar).
      const resta = quedan - m;
      if (resta < m) setMasters(resta > 0 ? String(resta) : "");
      await Promise.all([cargarHoja(hojaId), onCambio?.(hojaId, destino)]);
      refTermo.current?.focus();
    } finally { setGuardando(false); }
  };

  const enter = (e, siguiente) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (siguiente) { siguiente.current?.focus(); siguiente.current?.select(); }
    else registrar(false);
  };

  const abrirMezcla = async () => {
    const grupo = linea.GrupoProducto ?? linea.Clase;
    const vistos = new Set(lotesPanel);
    const cand = [];
    for (const r of saldo) {
      const k = claveLote(r);
      if (vistos.has(k) || !((r.Masters ?? 0) > 0) || (r.GrupoProducto ?? r.Clase) !== grupo) continue;
      vistos.add(k);
      cand.push(r);
    }
    // La misma talla primero: es lo que normalmente se junta.
    cand.sort((a, b) => (a.Talla === linea.Talla ? 0 : 1) - (b.Talla === linea.Talla ? 0 : 1));
    setMezcla({ cargando: true, candidatos: [] });
    const lotes = [...new Set([...cola.map(r => r.Lote), ...(base ? [base.Lote] : [])])];
    let prob = {}, okRes = false;
    try {
      const res = await fetch(`${API}/mezcla`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ Lotes: lotes, Candidatos: [...new Set(cand.map(r => r.Lote))] }),
      });
      okRes = res.ok; prob = okRes ? await leerJSON(res) : {};
    } catch { okRes = false; }
    setMezcla({ cargando: false, candidatos: cand.map(r => ({ linea: r, problema: okRes ? (prob[r.Lote] ?? null) : "No se pudo revisar" })) });
  };

  const totalesDe = (r) => saldo.filter(x => claveLote(x) === claveLote(r)).reduce((s, x) => s + (x.Masters || 0), 0);

  const guardarEdicion = async (confirmado = false) => {
    const e = editando;
    const t = termos.find(x => x.PesadaId === e.PesadaId);
    const nuevoKg = Number(e.Kg);
    if (!e.Termo.trim() || !(nuevoKg > 0)) { setError("Escriba el número del termo y los kilos"); return; }
    if (t && fueraDeRango(pctDif(nuevoKg, t.Declarado)) && !confirmado) { setEditando({ ...e, confirmar: true }); return; }
    const res = await fetch(`${API}/termo/${e.PesadaId}`, {
      method: "PUT", headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ NumeroTermo: e.Termo.trim(), KgPesado: nuevoKg, Confirmado: confirmado }),
    });
    const data = await leerJSON(res);
    if (!res.ok) { setError(data.error || `Error ${res.status}`); return; }
    setEditando(null); setError("");
    await Promise.all([cargarHoja(hojaId), onCambio?.(hojaId)]);
  };

  const quitar = async (id) => {
    const res = await fetch(`${API}/termo/${id}`, { method: "DELETE", headers: authHeader() });
    const data = await leerJSON(res);
    setQuitando(null);
    if (!res.ok) { setError(data.error || `Error ${res.status}`); return; }
    setError("");
    await Promise.all([cargarHoja(hojaId), onCambio?.(hojaId)]);
  };

  const remisiones = lineasPrincipal.map(r => `${r.FolioRemision || "sin remisión"} ${r.Masters} m`).join(" · ");
  const nombreExtra = (k) => { const r = saldo.find(x => claveLote(x) === k) || termos.flatMap(t => t.partes).find(p => claveLote(p) === k); return r?.Lote ?? k.split("|")[0]; };
  const lista = [...termos].reverse();
  const sumD = r2(termos.reduce((s, t) => s + t.Declarado, 0)), sumP = r2(termos.reduce((s, t) => s + t.Pesado, 0));
  const sumM = termos.reduce((s, t) => s + t.Masters, 0);
  const unificadoEn = base && (extras.length > 0 || base.Lote !== linea.Lote) ? base.Lote : null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[1080px] min-w-0 flex flex-col my-auto">
        {/* Encabezado */}
        <div className="px-4 sm:px-6 py-3 border-b flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="font-bold text-gray-800 text-lg">Pesar por termo</h3>
          {hojasAbiertas.length > 1 ? (
            <select value={hojaId} onChange={e => { setHoja(null); setHojaId(Number(e.target.value)); }}
              className="border border-gray-300 rounded px-2 py-1 text-sm font-semibold text-gray-700">
              {hojasAbiertas.map(h => <option key={h.HojaId} value={h.HojaId}>Hoja #{h.HojaId}{h.NombreEncargado ? ` · ${h.NombreEncargado}` : ""}</option>)}
            </select>
          ) : (
            <span className="text-sm text-gray-500">
              Hoja #{hojaId}{hojasAbiertas[0]?.NombreEncargado ? ` · ${hojasAbiertas[0].NombreEncargado}` : ""}
            </span>
          )}
          <button onClick={onCerrar} className="ml-auto text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="px-4 sm:px-6 py-4 space-y-4">
          {/* Lote y destino */}
          <div className="flex flex-col md:flex-row items-stretch gap-4">
            <div className="flex-1 min-w-0 border border-gray-200 rounded-lg px-4 py-3 bg-gray-50">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono font-bold text-2xl text-gray-900">{linea.Lote}</span>
                <span className="text-sm"><span className="font-mono text-gray-500">{linea.Clase}</span> {linea.DescripcionClase} · <b>{linea.DescripcionTalla}</b></span>
                {unificadoEn && (
                  <span className="text-xs font-semibold bg-amber-100 text-amber-800 rounded px-2 py-0.5">
                    llega al destino como <span className="font-mono">{unificadoEn}</span>
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {remisiones || "sin masters al piso"} · {fmtNum(linea.KgPorMaster)} kg por master · se pesa primero lo más antiguo
              </div>
              {extras.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {extras.map(k => (
                    <span key={k} className="inline-flex items-center gap-1.5 text-xs bg-white border border-amber-300 rounded-full pl-2.5 pr-1 py-0.5">
                      + <span className="font-mono font-semibold">{nombreExtra(k)}</span>
                      <span className="text-gray-500">{saldo.filter(x => claveLote(x) === k).reduce((s, x) => s + (x.Masters || 0), 0)} m al piso</span>
                      <button onClick={() => setExtras(x => x.filter(y => y !== k))} title="Ya no unir este lote"
                        className="w-5 h-5 rounded-full text-gray-400 hover:text-red-600 hover:bg-red-50">×</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-3 flex items-center gap-3">
                <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-600 rounded-full transition-all"
                    style={{ width: `${totalPrincipal ? (100 * pesadosPrincipal / totalPrincipal) : 0}%` }} />
                </div>
                <span className="text-sm tabular-nums whitespace-nowrap">
                  <b>{pesadosPrincipal}</b> de {totalPrincipal} masters · quedan <b>{quedanPrincipal}</b>
                </span>
              </div>
            </div>
            <div className="md:w-64 border border-gray-200 rounded-lg px-4 py-3">
              <label className="block text-xs font-semibold text-gray-600 mb-1">Va a</label>
              <select value={destino} onChange={e => setDestino(e.target.value)}
                className={`w-full border rounded-md px-3 py-2 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-blue-400
                  ${destino ? "border-gray-300" : "border-amber-400 bg-amber-50"}`}>
                <option value="">Escoja la bodega…</option>
                {destinos.map(b => <option key={b.Codigo} value={b.Codigo}>{b.Nombre}</option>)}
              </select>
              <p className="text-[11px] text-gray-400 mt-1.5">Cada termo llega a ese piso en cuanto se registra.</p>
            </div>
          </div>

          {/* Captura */}
          {quedan === 0 && !guardando ? (
            <div className="border-2 border-green-300 bg-green-50 rounded-xl px-5 py-4 flex flex-wrap items-center gap-3">
              <span className="text-green-800 font-bold">✓ No quedan masters de este lote al piso.</span>
              <span className="text-sm text-green-800">Lo pesado está abajo; se corrige o se quita desde ahí.</span>
              <button onClick={onCerrar} className="ml-auto bg-green-600 hover:bg-green-700 text-white rounded-lg px-5 py-2 font-semibold">Terminar</button>
            </div>
          ) : (
            <div className={`border-2 rounded-xl px-4 sm:px-5 py-4 ${fuera ? "border-red-400 bg-red-50/40" : "border-blue-300 bg-blue-50/40"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <span className="text-sm font-bold text-gray-800">
                  {termos.length + 1}.º termo
                  {quedanPrincipal > 0 && m > quedanPrincipal && <> · a {linea.Lote} solo le quedan {quedanPrincipal} masters</>}
                </span>
                <span className="text-xs text-gray-500">
                  Termo # → <kbd className="px-1 border rounded bg-white">Enter</kbd> → Masters → <kbd className="px-1 border rounded bg-white">Enter</kbd> → Kg → <kbd className="px-1 border rounded bg-white">Enter</kbd> = registrado
                </span>
              </div>

              <div className="flex flex-wrap items-start gap-4">
                <Caja etiqueta="Termo #">
                  <input ref={refTermo} value={termo} onChange={e => { setTermo(e.target.value); setPorConfirmar(false); }}
                    onKeyDown={e => enter(e, refMasters)} inputMode="numeric" maxLength={20}
                    className="w-28 border-2 border-gray-300 rounded-lg px-3 py-2 text-4xl font-bold text-center tabular-nums bg-white focus:outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-100" />
                </Caja>
                <Caja etiqueta="Masters" nota={<span className="block w-28">{termos.length ? "repite el anterior; se cambia si es distinto" : "cuántos lleva este termo"}</span>}>
                  <input ref={refMasters} value={masters} onChange={e => { setMasters(e.target.value.replace(/\D/g, "")); setPorConfirmar(false); }}
                    onKeyDown={e => enter(e, refKg)} inputMode="numeric"
                    className="w-28 border-2 border-gray-300 rounded-lg px-3 py-2 text-4xl font-bold text-center tabular-nums bg-white focus:outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-100" />
                </Caja>
                <Caja etiqueta="Kg de la báscula">
                  <input ref={refKg} value={kg} onChange={e => { setKg(e.target.value.replace(/[^\d.]/g, "")); setPorConfirmar(false); }}
                    onKeyDown={e => enter(e, null)} inputMode="decimal"
                    className={`w-48 sm:w-56 border-2 rounded-lg px-3 py-2 text-4xl font-bold text-right tabular-nums bg-white focus:outline-none focus:ring-4
                      ${fuera ? "border-red-500 focus:ring-red-100" : "border-gray-300 focus:border-blue-600 focus:ring-blue-100"}`} />
                </Caja>
                <div className="pt-5">
                  <div className="text-xs text-gray-500">Declarado</div>
                  <div className="text-2xl tabular-nums text-gray-700">{asignado ? fmtNum(declarado) : "—"} <span className="text-sm">kg</span></div>
                  {asignado && !mezclado && asignado.partes[0] && <div className="text-[11px] text-gray-400">{m} × {fmtNum(asignado.partes[0].linea.KgPorMaster)}</div>}
                </div>
                <div className="pt-5 min-w-[7rem]">
                  <div className="text-xs text-gray-500">Diferencia</div>
                  <div className={`text-2xl tabular-nums font-bold ${pct == null ? "text-gray-300" : fuera ? "text-red-600" : "text-green-700"}`}>
                    {pct == null ? "—" : textoPct(pct)}
                  </div>
                  {pct != null && <div className={`text-[11px] ${fuera ? "text-red-600 font-semibold" : "text-green-700"}`}>{fuera ? "fuera de rango" : "✓ dentro del rango"}</div>}
                </div>
                <div className="ml-auto pt-6">
                  {!porConfirmar && (
                    <button onClick={() => registrar(false)} disabled={!listo}
                      className="px-6 py-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-lg font-bold shadow disabled:opacity-40">
                      {guardando ? "Registrando…" : "Registrar termo ↵"}
                    </button>
                  )}
                </div>
              </div>

              {/* De dónde salen los masters, cuando el termo toma de más de una línea. */}
              {asignado && (mezclado || asignado.partes.length > 1) && (
                <div className="mt-3 border border-gray-200 bg-white rounded-lg px-4 py-1.5 text-sm">
                  {asignado.partes.map(p => (
                    <div key={`${p.linea.RemisionId}|${p.linea.Lote}|${p.linea.Clase}|${p.linea.Talla}|${p.linea.FechaLote}`} className="flex flex-wrap items-center gap-x-4 py-0.5">
                      <span className="font-mono font-bold w-36 truncate">{p.linea.Lote}</span>
                      <span className="text-xs text-gray-600 w-44 truncate">{p.linea.Clase} {p.linea.DescripcionTalla} · <span className="font-mono text-blue-700">{p.linea.FolioRemision || "—"}</span></span>
                      <span className="tabular-nums font-semibold w-16 text-right">{p.m} m</span>
                      <span className="text-xs text-gray-500 tabular-nums">{fmtNum(r2(p.m * p.linea.KgPorMaster))} kg decl.</span>
                      <span className="text-xs text-gray-400">{p.m === p.linea.Masters ? "lo que queda de esta línea" : `le quedan ${p.linea.Masters - p.m}`}</span>
                    </div>
                  ))}
                  {mezclado && <div className="text-[11px] text-gray-500 pt-1 border-t mt-1">Los kilos del termo se reparten entre los lotes según lo declarado. Todo llega como <b className="font-mono">{base?.Lote}</b>.</div>}
                </div>
              )}

              {faltan > 0 && (
                <p className="mt-2 text-sm text-amber-700">
                  Faltan {faltan} masters: al piso solo quedan {quedan} de {extras.length ? "estos lotes" : "este lote"}. Baje los masters o use <b>+ Unir lote</b>.
                </p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button onClick={mezcla ? () => setMezcla(null) : abrirMezcla} className="text-sm text-blue-700 font-semibold hover:underline">
                  {mezcla ? "− No unir" : "+ Unir lote"}
                </button>
              </div>

              {mezcla && (
                <div className="mt-2 border border-blue-200 bg-white rounded-lg px-3 py-2">
                  {mezcla.cargando ? <p className="text-xs text-gray-400">Revisando qué lotes se pueden unir…</p> : (() => {
                    const si = mezcla.candidatos.filter(c => !c.problema), no = mezcla.candidatos.filter(c => c.problema);
                    return (
                      <>
                        {si.length === 0 && <p className="text-xs text-gray-500">No hay otro lote al piso que se pueda unir con este.</p>}
                        <div className="flex flex-wrap gap-2">
                          {si.map(({ linea: r }) => (
                            <button key={claveLote(r)} onClick={() => { setExtras(x => [...x, claveLote(r)]); setMezcla(null); refMasters.current?.focus(); }}
                              className="text-left border border-gray-300 hover:border-blue-500 hover:bg-blue-50 rounded-lg px-3 py-1.5">
                              <span className="font-mono font-bold text-sm">{r.Lote}</span>
                              <span className="block text-[11px] text-gray-500">{r.Clase} · {r.DescripcionTalla} · {totalesDe(r)} m al piso</span>
                            </button>
                          ))}
                        </div>
                        {no.length > 0 && (
                          <p className="text-[11px] text-gray-400 mt-1.5" title={no.map(c => `${c.linea.Lote}: ${c.problema}`).join("\n")}>
                            {no.length} lote{no.length !== 1 ? "s" : ""} del mismo producto no se {no.length !== 1 ? "pueden" : "puede"} unir (otra finca, sifón o genérico).
                          </p>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}

              {porConfirmar && (
                <div className="mt-3 border-2 border-red-300 bg-white rounded-lg px-4 py-3 flex flex-wrap items-center gap-4">
                  <span className="text-3xl">⚠️</span>
                  <div className="flex-1 min-w-[16rem]">
                    <div className="font-bold text-red-700">
                      El termo {termo} pesa {fmtNum(Math.abs(r2(kgN - declarado)))} kg {kgN > declarado ? "más" : "menos"} de lo declarado ({textoPct(pct)}).
                      {" "}El rango es {RANGO.abajo} % a +{RANGO.arriba} %.
                    </div>
                    <div className="text-sm text-gray-600">¿Son <b>{m} masters</b> y la báscula marcó <b>{fmtNum(kgN)} kg</b>? Si sí, se registra y queda marcado en el reporte.</div>
                  </div>
                  <button onClick={() => { setPorConfirmar(false); refKg.current?.focus(); refKg.current?.select(); }}
                    className="px-4 py-3 rounded-lg border-2 border-gray-300 bg-white font-semibold text-gray-700">Corregir</button>
                  <button onClick={() => registrar(true)} disabled={guardando}
                    className="px-4 py-3 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold disabled:opacity-40">Sí, registrar así</button>
                </div>
              )}
            </div>
          )}

          {error && <div className="bg-red-50 border border-red-300 text-red-700 text-sm px-4 py-2 rounded">⚠ {error}</div>}

          {/* Termos registrados */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-gray-50 border-b flex justify-between items-center">
              <span className="text-xs font-semibold text-gray-600 uppercase">Termos registrados ({termos.length})</span>
              <span className="text-xs text-gray-400">el último arriba</span>
            </div>
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 uppercase bg-white sticky top-0">
                  <tr className="border-b">
                    <th className="px-4 py-1.5 text-left font-semibold w-10">#</th>
                    <th className="px-3 py-1.5 text-left font-semibold">Termo</th>
                    <th className="px-3 py-1.5 text-left font-semibold">Hora</th>
                    <th className="px-3 py-1.5 text-left font-semibold">Lote</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Masters</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Declarado</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Pesado</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Dif.</th>
                    <th className="px-3 py-1.5 w-28"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {!hoja && <tr><td colSpan={9} className="px-4 py-4 text-center text-xs text-gray-400">Cargando…</td></tr>}
                  {hoja && lista.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-4 text-center text-xs text-gray-400">Todavía no hay termos de este lote en la hoja.</td></tr>
                  )}
                  {lista.map((t, i) => {
                    const n = lista.length - i;
                    const mal = fueraDeRango(t.Dif);
                    const ed = editando?.PesadaId === t.PesadaId ? editando : null;
                    return (
                      <tr key={t.PesadaId} className={quitando === t.PesadaId ? "bg-red-50" : mal ? "bg-red-50/60" : ""}>
                        <td className="px-4 py-1.5 text-gray-400 tabular-nums">{n}</td>
                        <td className="px-3 py-1.5">
                          {ed ? (
                            <input value={ed.Termo} onChange={e => setEditando({ ...ed, Termo: e.target.value, confirmar: false })} maxLength={20}
                              className="w-16 border border-blue-400 rounded px-1.5 py-0.5 text-sm font-bold text-center" />
                          ) : (
                            <span className="inline-flex items-center justify-center min-w-[2.2rem] px-1.5 py-0.5 rounded bg-gray-800 text-white font-bold tabular-nums">{t.Termo}</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-gray-500 tabular-nums">{horaDe(t.Hora)}</td>
                        <td className="px-3 py-1.5 font-mono text-xs">{t.Lotes}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{t.Masters}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{fmtNum(t.Declarado)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-semibold">
                          {ed ? (
                            <input value={ed.Kg} onChange={e => setEditando({ ...ed, Kg: e.target.value.replace(/[^\d.]/g, ""), confirmar: false })} inputMode="decimal"
                              onKeyDown={e => e.key === "Enter" && guardarEdicion(false)}
                              className="w-24 border border-blue-400 rounded px-1.5 py-0.5 text-sm text-right" />
                          ) : fmtNum(t.Pesado)}
                        </td>
                        <td className={`px-3 py-1.5 text-right tabular-nums whitespace-nowrap ${mal ? "text-red-700 font-bold" : "text-gray-600"}`}>
                          {textoPct(t.Dif)}
                          {mal && <span className="ml-1 text-[10px] font-semibold uppercase bg-red-600 text-white rounded px-1 py-0.5 align-middle">fuera</span>}
                        </td>
                        <td className="px-2 py-1 text-right whitespace-nowrap">
                          {ed ? (
                            ed.confirmar ? (
                              <span className="inline-flex items-center gap-1">
                                <span className="text-[11px] text-red-700">¿fuera de rango?</span>
                                <button onClick={() => guardarEdicion(true)} className="text-xs bg-red-600 text-white rounded px-2 py-1 font-semibold">Sí</button>
                                <button onClick={() => setEditando(null)} className="text-xs border rounded px-2 py-1">No</button>
                              </span>
                            ) : (
                              <span className="inline-flex gap-1">
                                <button onClick={() => guardarEdicion(false)} className="text-xs bg-blue-600 text-white rounded px-2 py-1 font-semibold">Guardar</button>
                                <button onClick={() => setEditando(null)} className="text-xs border rounded px-2 py-1">Cancelar</button>
                              </span>
                            )
                          ) : quitando === t.PesadaId ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="text-[11px] text-red-700">¿Quitar?</span>
                              <button onClick={() => quitar(t.PesadaId)} className="text-xs bg-red-600 text-white rounded px-2 py-1 font-semibold">Sí</button>
                              <button onClick={() => setQuitando(null)} className="text-xs border rounded px-2 py-1">No</button>
                            </span>
                          ) : (
                            <span className="inline-flex gap-1">
                              {puedeEditar && (
                                <button onClick={() => { setEditando({ PesadaId: t.PesadaId, Termo: String(t.Termo ?? ""), Kg: String(t.Pesado), confirmar: false }); setQuitando(null); }}
                                  title="Corregir el número o los kilos" className="px-2 py-1 rounded text-gray-500 hover:text-blue-700 hover:bg-blue-50">✎</button>
                              )}
                              {puedeBorrar && (
                                <button onClick={() => { setQuitando(t.PesadaId); setEditando(null); }}
                                  title="Quitar el termo: sus masters vuelven al piso" className="px-2 py-1 rounded text-gray-500 hover:text-red-700 hover:bg-red-50">🗑</button>
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {termos.length > 0 && (
                  <tfoot className="border-t-2 bg-gray-50">
                    <tr className="font-bold">
                      <td colSpan={4} className="px-4 py-2 text-xs text-gray-600 uppercase">{termos.length} termo{termos.length !== 1 ? "s" : ""}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{sumM}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(sumD)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(sumP)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{textoPct(pctDif(sumP, sumD))}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>

        <div className="px-4 sm:px-6 py-3 border-t flex flex-wrap items-center justify-between gap-2 bg-gray-50 rounded-b-xl">
          <span className="text-xs text-gray-500">
            Rango normal: <b className="text-gray-700">{RANGO.abajo} % a +{RANGO.arriba} %</b> de lo declarado. Fuera de ahí pide confirmar y queda marcado en el reporte.
          </span>
          <button onClick={onCerrar} className="px-5 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 font-semibold hover:bg-gray-100">Terminar</button>
        </div>
      </div>
    </div>
  );
}
