import { useState, useEffect, useRef, useCallback } from "react";
import { authHeader, useAuth, usePuede } from "../context/AuthContext.jsx";
import { useBascula } from "../hooks/useBascula.js";

// Pesaje en báscula (#/pesaje) — corre en el Chrome del cabezal, junto a la app Báscula Puente.
//
//  1. Inicio de sesión: solo "pase su carnet". De su área de hoy salen la bodega y el modo; si el
//     área no los define, se le pregunta.
//  2. Pesaje: elige talla, lote (del inventario al piso de su bodega) y tipo de empaque. Pone la
//     caja; si el peso queda estable DENTRO del rango, al retirarla se guarda (GUARDADO #n). Bajo o
//     sobrepeso NO se guarda (SIN GUARDAR). En modo "por persona" se escanea un carnet por cada caja.
//
// El servidor vuelve a validar todo (rango, sesión, lote, persona): esta pantalla solo adelanta.
// Si la red falla, la caja queda en cola y se reintenta con el mismo identificador: no se duplica.

const UMBRAL_VACIO_G = 20;
const REINTENTO_MS = 5000;
const INACTIVIDAD_MS = 15 * 60 * 1000;

async function api(url, opciones = {}) {
  const res = await fetch(url, { ...opciones, headers: { "Content-Type": "application/json", ...authHeader(), ...(opciones.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Error ${res.status}`); e.status = res.status; e.datos = data; throw e; }
  return data;
}

function uuid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const g = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("es"));
const claveSesion = (bal) => `pesaje_sesion_${bal}`;
const claveTrabajo = (bal) => `pesaje_trabajo_${bal}`;
const leerLS = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const escribirLS = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };

// ─── Inicio de sesión ─────────────────────────────────────────────────────────────────────────
function Login({ balanza, conectado, onSesion, onSalirSistema }) {
  const [carnet, setCarnet] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [pregunta, setPregunta] = useState(null); // { necesita, bodegas, operadora, area, carnet }
  const [eleccion, setEleccion] = useState({ bodega: "", modo: "" });
  const ref = useRef(null);

  useEffect(() => { if (!pregunta) ref.current?.focus(); }, [pregunta, error]);

  const entrar = async (codigo, extra = {}) => {
    if (!codigo || enviando) return;
    setEnviando(true); setError("");
    try {
      const r = await api("/api/pesaje-bascula/sesion", { method: "POST", body: JSON.stringify({ balanza, carnet: codigo, ...extra }) });
      if (r.necesita) { setPregunta({ ...r, carnet: codigo }); setEleccion({ bodega: "", modo: "" }); }
      else onSesion(r.sesion);
    } catch (e) { setError(e.message); setPregunta(null); }
    finally { setEnviando(false); setCarnet(""); }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col" onClick={() => !pregunta && ref.current?.focus()}>
      <div className="px-6 py-4 flex items-center gap-3 border-b border-white/10">
        <span className="font-mono font-bold text-lg">{balanza || "—"}</span>
        <span className={`text-sm ${conectado ? "text-emerald-400" : "text-amber-400"}`}>{conectado ? "báscula conectada" : "sin conexión con la app de la báscula"}</span>
        <button onClick={onSalirSistema} className="ml-auto text-xs text-slate-500 hover:text-slate-300">salir del sistema</button>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8 text-center">
        {!pregunta ? (
          <>
            <p className="text-slate-400 text-base uppercase tracking-[0.3em]">Inicio de sesión</p>
            <p className="text-6xl font-bold">Pase su carnet</p>
            <form onSubmit={e => { e.preventDefault(); entrar(carnet.trim().toUpperCase()); }}>
              <input ref={ref} value={carnet} onChange={e => setCarnet(e.target.value.toUpperCase())} autoFocus autoComplete="off"
                className="w-[420px] h-16 rounded-xl border-2 border-blue-400 bg-white/5 text-center font-mono text-2xl tracking-widest text-blue-100 focus:outline-none" />
            </form>
            {enviando && <p className="text-slate-400">Verificando…</p>}
            {!balanza && <p className="text-amber-300 max-w-xl">Esta pantalla aún no sabe en qué báscula está. Revise que la app Báscula Puente esté abierta y configurada.</p>}
            {error && <div className="w-[560px] rounded-xl bg-red-500/15 border border-red-400/40 px-4 py-3 text-base text-red-200">{error}</div>}
          </>
        ) : (
          <div className="w-[640px] space-y-5">
            <p className="text-2xl font-bold">{pregunta.operadora}</p>
            <p className="text-slate-400">Su área ({pregunta.area}) no define {[pregunta.necesita.bodega && "la bodega", pregunta.necesita.modo && "el modo"].filter(Boolean).join(" ni ")}: elija.</p>
            {pregunta.necesita.bodega && (
              <div className="grid grid-cols-3 gap-2 max-h-64 overflow-auto">
                {pregunta.bodegas.map(b => (
                  <button key={b.Codigo} onClick={() => setEleccion(x => ({ ...x, bodega: b.Codigo }))}
                    className={`py-3 rounded-xl border text-base ${eleccion.bodega === b.Codigo ? "bg-blue-600 border-blue-400" : "border-white/20 hover:bg-white/10"}`}>{b.Nombre}</button>
                ))}
              </div>
            )}
            {pregunta.necesita.modo && (
              <div className="grid grid-cols-2 gap-3">
                {[["PERSONA", "Por persona", "carnet por cada caja"], ["PRODUCTO", "Por producto", "sin carnet por caja"]].map(([v, t, d]) => (
                  <button key={v} onClick={() => setEleccion(x => ({ ...x, modo: v }))}
                    className={`py-4 rounded-xl border ${eleccion.modo === v ? "bg-blue-600 border-blue-400" : "border-white/20 hover:bg-white/10"}`}>
                    <span className="block text-xl font-bold">{t}</span><span className="text-sm text-slate-300">{d}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-center gap-3">
              <button onClick={() => setPregunta(null)} className="px-6 py-3 rounded-xl border border-white/20">Cancelar</button>
              <button disabled={(pregunta.necesita.bodega && !eleccion.bodega) || (pregunta.necesita.modo && !eleccion.modo) || enviando}
                onClick={() => entrar(pregunta.carnet, { bodega: eleccion.bodega || undefined, modo: eleccion.modo || undefined })}
                className="px-8 py-3 rounded-xl bg-blue-600 font-bold disabled:opacity-40">Entrar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pantalla de pesaje ───────────────────────────────────────────────────────────────────────
function Pesaje({ sesion, b, onCerrar }) {
  const puedeAnular = usePuede("pesaje_bascula", "anular_caja");
  const porPersona = sesion.Modo === "PERSONA";
  const [cat, setCat] = useState({ empaques: [], tallas: [], lotes: [] });
  const [trabajo, setTrabajo] = useState(() => {
    const t = leerLS(claveTrabajo(sesion.BalanzaCodigo)) ?? {};
    // Versión anterior guardaba "LOTE|CLASE" en un solo campo.
    const [lote, clase] = String(t.lote ?? "").includes("|") ? t.lote.split("|") : [t.lote ?? "", t.clase ?? ""];
    return { talla: t.talla ?? "", lote, clase, empaque: t.empaque ?? "" };
  });
  const [persona, setPersona] = useState(null); // { Codigo, NombreCompleto }
  const [carnetCaja, setCarnetCaja] = useState("");
  const [errorCarnet, setErrorCarnet] = useState("");
  const [aviso, setAviso] = useState(null); // { tipo: "guardado"|"sin_guardar"|"pendiente"|"error", texto }
  const [resumen, setResumen] = useState({ Cajas: 0, NetoG: 0, ultimas: [] });
  const [cola, setCola] = useState([]); // pesadas por enviar (red caída)
  const [buscarLote, setBuscarLote] = useState("");
  const [lotesBuscados, setLotesBuscados] = useState([]);
  const carnetRef = useRef(null);
  const candidatoRef = useRef(null);   // { gramos } último estable DENTRO del rango con caja en el plato
  const fueraRef = useRef(null);       // último estable FUERA del rango
  const actividadRef = useRef(Date.now());

  const empaque = cat.empaques.find(e => e.Codigo === trabajo.empaque) ?? null;
  // Lote, tipo de producto (Clase) y talla se eligen por separado (usuario, 17 nov 2026). Las opciones
  // salen del piso de la bodega y de lo buscado; la talla, del catálogo completo.
  const loteSel = trabajo.lote && trabajo.clase ? { Lote: trabajo.lote, Clase: trabajo.clase } : null;
  const listo = Boolean(empaque && loteSel && trabajo.talla);
  const lotesUnicos = [...new Map(cat.lotes.map(l => [l.Lote, l])).keys()];
  const kgLote = (lote) => cat.lotes.filter(l => l.Lote === lote).reduce((s, l) => s + l.Kg, 0);
  const clasesDelLote = (() => {
    const m = new Map();
    for (const l of [...cat.lotes, ...lotesBuscados]) if (l.Lote === trabajo.lote) m.set(l.Clase, l.ClaseDesc ?? "");
    if (trabajo.clase && trabajo.lote && !m.has(trabajo.clase)) m.set(trabajo.clase, "");
    return [...m.entries()];
  })();
  const elegirLote = (lote) => setTrabajo(t => {
    const clases = [...new Set([...cat.lotes, ...lotesBuscados].filter(l => l.Lote === lote).map(l => l.Clase))];
    return { ...t, lote, clase: clases.length === 1 ? clases[0] : (clases.includes(t.clase) ? t.clase : "") };
  });

  useEffect(() => { escribirLS(claveTrabajo(sesion.BalanzaCodigo), trabajo); }, [trabajo, sesion.BalanzaCodigo]);

  // Con un solo tipo de empaque activo no hay nada que elegir: queda puesto. Sin empaque la pantalla
  // no evalúa ni guarda, y al retirar la caja no decía nada (17 nov 2026, BAL-01: 0 pesadas).
  // También se limpia un empaque guardado que ya no está activo.
  useEffect(() => {
    if (!cat.empaques.length) return;
    const existe = cat.empaques.some(e => e.Codigo === trabajo.empaque);
    if (!existe) setTrabajo(t => ({ ...t, empaque: cat.empaques.length === 1 ? cat.empaques[0].Codigo : "" }));
  }, [cat.empaques]); // eslint-disable-line react-hooks/exhaustive-deps

  const cargarResumen = useCallback(async () => {
    try { setResumen(await api(`/api/pesaje-bascula/sesion/${sesion.SesionId}/resumen`)); } catch { /* siguiente */ }
  }, [sesion.SesionId]);

  // Catálogos al entrar y cada minuto: un tipo de empaque creado con la sesión ya abierta aparece
  // solo (17 nov 2026: YENS480 se creó después de entrar y la lista seguía vacía).
  const cargarCatalogos = useCallback(() =>
    api(`/api/pesaje-bascula/sesion/${sesion.SesionId}/catalogos`).then(setCat).catch(e => setAviso({ tipo: "error", texto: e.message })),
  [sesion.SesionId]);
  useEffect(() => {
    cargarCatalogos();
    cargarResumen();
    const id = setInterval(cargarCatalogos, 60_000);
    return () => clearInterval(id);
  }, [cargarCatalogos, cargarResumen]);

  // Buscar un lote que no esté al piso.
  useEffect(() => {
    const q = buscarLote.trim();
    if (q.length < 2) { setLotesBuscados([]); return; }
    const id = setTimeout(() => api(`/api/pesaje-bascula/lotes?q=${encodeURIComponent(q)}`).then(setLotesBuscados).catch(() => {}), 300);
    return () => clearTimeout(id);
  }, [buscarLote]);

  // Cerrar por inactividad (el servidor también lo exige).
  useEffect(() => {
    const id = setInterval(() => { if (Date.now() - actividadRef.current > INACTIVIDAD_MS) onCerrar("15 min sin pesar"); }, 30_000);
    return () => clearInterval(id);
  }, [onCerrar]);

  // En modo persona, el foco vive en el campo del carnet de la caja.
  useEffect(() => { if (porPersona && !persona) carnetRef.current?.focus(); }, [porPersona, persona, aviso]);

  const leerCarnet = async (codigo) => {
    setErrorCarnet("");
    try { setPersona(await api(`/api/pesaje-bascula/persona/${encodeURIComponent(codigo)}`)); actividadRef.current = Date.now(); }
    catch (e) { setErrorCarnet(e.message); }
    finally { setCarnetCaja(""); }
  };

  const enviar = useCallback(async (p) => {
    try {
      const r = await api("/api/pesaje-bascula/pesadas", { method: "POST", body: JSON.stringify(p) });
      setCola(c => c.filter(x => x.Uuid !== p.Uuid));
      setAviso({ tipo: "guardado", texto: `GUARDADO #${r.Numero ?? ""}`, detalle: `${g(p.PesoBrutoG)} g${p.nombrePersona ? " · " + p.nombrePersona : ""}` });
      cargarResumen();
    } catch (e) {
      if (e.status === 409 && e.datos?.sesionCerrada) { onCerrar(e.message); return; }
      if (!e.status || e.status >= 500) {
        setCola(c => (c.some(x => x.Uuid === p.Uuid) ? c : [...c, p]));
        setAviso({ tipo: "pendiente", texto: "PENDIENTE DE ENVIAR", detalle: "sin conexión con el servidor; se reintenta solo" });
      } else {
        setCola(c => c.filter(x => x.Uuid !== p.Uuid));
        setAviso({ tipo: "sin_guardar", texto: "SIN GUARDAR", detalle: e.message });
      }
    }
  }, [cargarResumen, onCerrar]);

  // Reintento de la cola.
  useEffect(() => {
    if (!cola.length) return undefined;
    const id = setInterval(() => cola.forEach(enviar), REINTENTO_MS);
    return () => clearInterval(id);
  }, [cola, enviar]);

  // "Caja retirada" = el peso baja de la MITAD del mínimo del empaque, no de 20 g fijos: el plato de
  // BAL-01 marcaba 172 g vacío (algo encima o sin tarar) y nunca bajaba de 20 → nunca se guardaba.
  const vacioBajo = empaque ? Math.max(UMBRAL_VACIO_G, Math.round(empaque.MinG / 2)) : UMBRAL_VACIO_G;

  // Regla de guardado: el último peso estable con caja en el plato decide; al retirar la caja se guarda
  // si estaba dentro del rango, y se avisa SIN GUARDAR si estaba fuera.
  useEffect(() => {
    if (!b.vigente || !empaque) return;
    if (b.gramos >= vacioBajo) {
      if (b.estable) {
        actividadRef.current = Date.now();
        const dentro = b.gramos >= empaque.MinG && b.gramos <= empaque.MaxG;
        if (dentro) { candidatoRef.current = b.gramos; fueraRef.current = null; }
        else { fueraRef.current = b.gramos; candidatoRef.current = null; }
        if (aviso?.tipo === "guardado" || aviso?.tipo === "sin_guardar") setAviso(null);
      }
      return;
    }
    // Plato vacío: se retiró la caja.
    const gramos = candidatoRef.current, fuera = fueraRef.current;
    candidatoRef.current = null; fueraRef.current = null;
    if (fuera !== null) {
      setAviso({ tipo: "sin_guardar", texto: "SIN GUARDAR", detalle: `${g(fuera)} g ${fuera < empaque.MinG ? "bajo peso" : "sobrepeso"} (rango ${g(empaque.MinG)}–${g(empaque.MaxG)} g)` });
      return;
    }
    if (gramos === null) return;
    if (!listo) { setAviso({ tipo: "sin_guardar", texto: "SIN GUARDAR", detalle: "elija talla, lote y tipo de empaque" }); return; }
    if (porPersona && !persona) { setAviso({ tipo: "sin_guardar", texto: "SIN GUARDAR", detalle: "falta escanear el carnet de esta caja" }); return; }
    const p = {
      Uuid: uuid(), SesionId: sesion.SesionId, EmpaqueCodigo: empaque.Codigo, Lote: loteSel.Lote, Clase: loteSel.Clase,
      Talla: Number(trabajo.talla), PersonaCodigo: porPersona ? persona.Codigo : null, PesoBrutoG: gramos,
      nombrePersona: persona?.NombreCompleto,
    };
    if (porPersona) setPersona(null); // un carnet por cada caja
    enviar(p);
  }, [b.vigente, b.gramos, b.estable]); // eslint-disable-line react-hooks/exhaustive-deps

  const anularUltima = async () => {
    const u = resumen.ultimas[0];
    if (!u) return;
    const motivo = window.prompt(`Anular la caja de ${g(u.PesoBrutoG)} g (${u.Hora}). ¿Por qué?`);
    if (!motivo?.trim()) return;
    try { await api(`/api/pesaje-bascula/pesadas/${u.PesadaId}/anular`, { method: "POST", body: JSON.stringify({ motivo }) }); cargarResumen(); }
    catch (e) { setAviso({ tipo: "error", texto: "NO SE ANULÓ", detalle: e.message }); }
  };

  // Color del peso.
  let fondo = "bg-slate-700", estado = "SIN LECTURA", sub = "revise la báscula o la app Báscula Puente";
  if (b.vigente) {
    if (!empaque) { fondo = "bg-slate-700"; estado = "ELIJA EL TIPO DE EMPAQUE"; sub = "sin tipo de empaque no se evalúa ni se guarda"; }
    else if (b.gramos < vacioBajo) {
      fondo = "bg-slate-800"; estado = "PLATO VACÍO";
      sub = `rango ${g(empaque.MinG)} – ${g(empaque.MaxG)} g` + (b.gramos >= UMBRAL_VACIO_G ? ` · el plato marca ${g(b.gramos)} g: ¿tarar la báscula?` : "");
    }
    else if (b.gramos < empaque.MinG) { fondo = "bg-amber-400 text-amber-950"; estado = "BAJO PESO"; sub = `faltan ${g(empaque.MinG - b.gramos)} g · no se guarda`; }
    else if (b.gramos > empaque.MaxG) { fondo = "bg-red-600"; estado = "SOBREPESO"; sub = `sobran ${g(b.gramos - empaque.MaxG)} g · no se guarda`; }
    else { fondo = "bg-emerald-600"; estado = b.estable ? "PESO CORRECTO · ESTABLE" : "PESO CORRECTO"; sub = b.estable ? "retire la caja para guardar" : "esperando que se estabilice"; }
  }
  const insignia = aviso && {
    guardado: "bg-white text-emerald-700", sin_guardar: "bg-white text-red-700", pendiente: "bg-white text-amber-700", error: "bg-white text-red-700",
  }[aviso.tipo];
  const icono = aviso && { guardado: "✓", sin_guardar: "✗", pendiente: "…", error: "!" }[aviso.tipo];

  const sel = "w-full rounded-xl bg-slate-800 border border-slate-600 px-3 py-3 text-lg text-white focus:outline-none focus:border-blue-400";

  return (
    <div className="h-screen bg-slate-900 text-white flex flex-col">
      <header className="h-14 shrink-0 flex items-center px-5 gap-3 bg-slate-800">
        <span className="font-mono font-bold text-lg">{sesion.BalanzaCodigo}</span>
        <span className="text-slate-200 font-semibold">{sesion.BodegaNombre ?? "—"}</span>
        <span className="text-xs bg-violet-500/30 text-violet-200 rounded px-2 py-0.5">{porPersona ? "Por persona" : "Por producto"}</span>
        {cola.length > 0 && <span className="text-xs bg-amber-500/30 text-amber-200 rounded px-2 py-0.5">{cola.length} por enviar</span>}
        <span className="ml-auto text-sm">Operadora: <b>{sesion.Operadora}</b> <span className="text-slate-400 font-mono">{sesion.OperadoraCodigo}</span></span>
        <button onClick={() => onCerrar("salió")} className="ml-3 px-4 py-2 rounded-lg bg-white/10 text-sm">Salir</button>
      </header>

      <div className="flex-1 flex gap-4 p-4 min-h-0">
        <div className="w-[330px] shrink-0 flex flex-col gap-3 min-h-0">
          <label className="text-xs text-slate-400 uppercase">Lote (al piso de {sesion.BodegaNombre ?? "la bodega"})
            <select value={trabajo.lote} onChange={e => elegirLote(e.target.value)} className={sel + " mt-1 font-mono"}>
              <option value="">— elija —</option>
              {lotesUnicos.map(l => <option key={l} value={l}>{l} · {kgLote(l).toLocaleString("es", { maximumFractionDigits: 0 })} kg</option>)}
              {trabajo.lote && !lotesUnicos.includes(trabajo.lote) && <option value={trabajo.lote}>{trabajo.lote} (buscado)</option>}
            </select>
          </label>
          <div>
            <input value={buscarLote} onChange={e => setBuscarLote(e.target.value)} placeholder="¿No está? Buscar otro lote…"
              className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm" />
            {lotesBuscados.length > 0 && (
              <div className="mt-1 max-h-32 overflow-auto rounded-lg border border-slate-700 bg-slate-800">
                {lotesBuscados.map(l => (
                  <button key={`${l.Lote}|${l.Clase}`} onClick={() => { setTrabajo(t => ({ ...t, lote: l.Lote, clase: l.Clase })); setBuscarLote(""); }}
                    className="block w-full text-left px-3 py-1.5 text-sm font-mono hover:bg-slate-700">{l.Lote} · {l.Clase}{l.ClaseDesc ? ` · ${l.ClaseDesc}` : ""}</button>
                ))}
              </div>
            )}
          </div>
          <label className="text-xs text-slate-400 uppercase">Tipo de producto
            <select value={trabajo.clase} disabled={!trabajo.lote} onChange={e => setTrabajo(t => ({ ...t, clase: e.target.value }))} className={sel + " mt-1 disabled:opacity-50"}>
              <option value="">{trabajo.lote ? "— elija —" : "elija primero el lote"}</option>
              {clasesDelLote.map(([c, d]) => <option key={c} value={c}>{c}{d ? ` · ${d}` : ""}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-400 uppercase">Talla
            <select value={trabajo.talla} onChange={e => setTrabajo(t => ({ ...t, talla: e.target.value }))} className={sel + " mt-1"}>
              <option value="">— elija —</option>
              {cat.tallas.map(t => <option key={t.Codigo} value={t.Codigo}>{t.Descripcion} ({t.Codigo})</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-400 uppercase">Tipo de empaque
            <select value={trabajo.empaque} onChange={e => setTrabajo(t => ({ ...t, empaque: e.target.value }))} className={sel + " mt-1"}>
              <option value="">— elija —</option>
              {cat.empaques.map(e => <option key={e.Codigo} value={e.Codigo}>{e.Nombre}</option>)}
            </select>
          </label>
          {empaque && <p className="text-xs text-slate-400">neto {g(empaque.PesoNetoG)} g · bruto {g(empaque.PesoBrutoG)} g · guarda {g(empaque.MinG)}–{g(empaque.MaxG)} g</p>}
          {cat.empaques.length === 0 && <p className="text-xs text-amber-300">No hay tipos de empaque activos (Básculas → Tipos de empaque).</p>}

          {porPersona && (
            <div className="mt-auto rounded-xl p-4 border bg-violet-600/20 border-violet-400/40">
              <p className="text-xs text-violet-200 uppercase">Carnet de esta caja</p>
              {persona ? (
                <>
                  <p className="text-xl font-bold">{persona.NombreCompleto}</p>
                  <p className="text-sm text-violet-200 font-mono">{persona.Codigo}</p>
                  <button onClick={() => setPersona(null)} className="text-xs text-violet-300 underline mt-1">cambiar</button>
                </>
              ) : (
                <form onSubmit={e => { e.preventDefault(); if (carnetCaja.trim()) leerCarnet(carnetCaja.trim().toUpperCase()); }}>
                  <input ref={carnetRef} value={carnetCaja} onChange={e => setCarnetCaja(e.target.value.toUpperCase())} autoComplete="off"
                    placeholder="escanee el carnet" className="mt-1 w-full rounded-lg bg-white/10 border border-violet-300/50 px-3 py-2 font-mono text-lg tracking-widest" />
                  {errorCarnet && <p className="text-xs text-red-300 mt-1">{errorCarnet}</p>}
                </form>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 flex flex-col gap-4 min-w-0">
          <div className={`flex-1 rounded-2xl ${fondo} flex flex-col items-center justify-center relative`}>
            {/* Estable / moviendo: siempre a la vista, esté o no en rango. */}
            <div className="absolute top-4 left-4">
              {!b.vigente ? (
                <span className="rounded-full bg-black/30 px-4 py-2 text-lg font-bold">SIN LECTURA</span>
              ) : b.estable ? (
                // Verde suave: se distingue del verde fuerte de "peso correcto" (usuario, 17 nov 2026).
                <span className="rounded-full bg-emerald-200 text-emerald-900 px-4 py-2 text-lg font-bold">● ESTABLE</span>
              ) : (
                <span className="rounded-full bg-black/30 px-4 py-2 text-lg font-bold animate-pulse">◌ MOVIENDO</span>
              )}
            </div>
            {aviso && (
              <div className={`absolute top-4 right-4 left-4 flex justify-end`}>
                <div className={`flex items-center gap-2 rounded-full px-5 py-2 text-xl font-bold shadow ${insignia}`}>
                  <span>{icono}</span>{aviso.texto}
                  {aviso.detalle && <span className="text-sm font-medium opacity-80">· {aviso.detalle}</span>}
                </div>
              </div>
            )}
            {/* El rango que debe pesar, siempre a la vista (usuario, 17 nov 2026). */}
            {empaque && (
              <p className="text-2xl font-bold mb-2 opacity-90">
                Debe pesar {g(empaque.MinG)} – {g(empaque.MaxG)} g
              </p>
            )}
            <p className="text-[150px] leading-none font-bold font-mono tracking-tight">{b.vigente ? g(b.gramos) : "—"}<span className="text-5xl ml-3 font-semibold">g</span></p>
            <p className="text-3xl font-bold mt-3 tracking-wide">{estado}</p>
            {sub && <p className="text-lg mt-1 opacity-80">{sub}</p>}
          </div>
          {empaque && (() => {
            // Barra: de (mín − 15 %) a (máx + 15 %), con una marca donde está el peso.
            const lo = empaque.MinG * 0.85, hi = empaque.MaxG * 1.15, w = hi - lo;
            const pct = v => Math.min(100, Math.max(0, ((v - lo) / w) * 100));
            const marca = b.vigente ? pct(b.gramos) : null;
            return (
              <div className="shrink-0">
                <div className="relative h-12 rounded-xl overflow-hidden flex text-base font-bold">
                  <div style={{ width: `${pct(empaque.MinG)}%` }} className="bg-amber-400 text-amber-950 flex items-center justify-center">BAJO</div>
                  <div style={{ width: `${pct(empaque.MaxG) - pct(empaque.MinG)}%` }} className="bg-emerald-500 flex items-center justify-center whitespace-nowrap min-w-[140px]">
                    {g(empaque.MinG)} – {g(empaque.MaxG)} g
                  </div>
                  <div className="flex-1 bg-red-500 flex items-center justify-center">SOBREPESO</div>
                  {marca !== null && <div style={{ left: `calc(${marca}% - 3px)` }} className="absolute top-0 bottom-0 w-1.5 bg-white shadow-[0_0_6px_rgba(0,0,0,0.6)]" />}
                </div>
              </div>
            );
          })()}
        </div>

        <div className="w-[250px] shrink-0 flex flex-col gap-3 min-h-0">
          <div className="bg-slate-800 rounded-xl p-4"><p className="text-xs text-slate-400">Cajas hoy (báscula)</p><p className="text-3xl font-bold">{g(resumen.Cajas)}</p><p className="text-xs text-slate-400">{(resumen.NetoG / 1000).toLocaleString("es", { maximumFractionDigits: 1 })} kg netos</p></div>
          <div className="bg-slate-800 rounded-xl p-4 flex-1 min-h-0 overflow-auto">
            <p className="text-xs text-slate-400 mb-2">Últimas cajas guardadas</p>
            <ul className="space-y-1.5 text-sm font-mono">
              {resumen.ultimas.map(u => (
                <li key={u.PesadaId} className="flex justify-between gap-2"><span>{g(u.PesoBrutoG)} g</span><span className="text-emerald-400 truncate">✓ {u.PersonaCodigo ?? u.Hora}</span></li>
              ))}
            </ul>
            <p className="text-[11px] text-slate-500 mt-3">Fuera de rango no se guarda: no aparece aquí.</p>
          </div>
          {puedeAnular && resumen.ultimas.length > 0 && (
            <button onClick={anularUltima} className="rounded-xl bg-white/10 py-3 text-sm">Anular última (supervisor)</button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PesajeBasculaPage() {
  const { logout } = useAuth();
  const [sesion, setSesion] = useState(null);
  const [mensaje, setMensaje] = useState("");
  const cerrarRef = useRef(null);
  const b = useBascula({ alCerrarSesion: () => cerrarRef.current?.("cerrada desde Básculas") });
  const balanza = b.balanza;

  // Al abrir o recargar: retoma la sesión de esta báscula si sigue válida.
  useEffect(() => {
    if (!balanza) return;
    const id = leerLS(claveSesion(balanza));
    if (!id) return;
    api(`/api/pesaje-bascula/sesion/${id}`)
      .then(s => setSesion(s))
      .catch(e => { escribirLS(claveSesion(balanza), null); if (e.status === 409) setMensaje(e.message); });
  }, [balanza]);

  const cerrar = useCallback(async (motivo) => {
    if (sesion) {
      api(`/api/pesaje-bascula/sesion/${sesion.SesionId}/cerrar`, { method: "POST", body: JSON.stringify({ motivo }) }).catch(() => {});
      escribirLS(claveSesion(sesion.BalanzaCodigo), null);
    }
    setSesion(null);
    setMensaje(motivo && motivo !== "salió" ? `Sesión cerrada: ${motivo}` : "");
  }, [sesion]);
  cerrarRef.current = cerrar;

  if (!sesion) {
    return (
      <>
        {mensaje && <div className="fixed top-16 left-1/2 -translate-x-1/2 z-10 rounded-xl bg-amber-500/20 border border-amber-400/50 px-4 py-2 text-amber-100">{mensaje}</div>}
        <Login balanza={balanza} conectado={b.conectado}
          onSesion={(s) => { escribirLS(claveSesion(s.BalanzaCodigo), s.SesionId); setMensaje(""); setSesion(s); }}
          onSalirSistema={() => { logout(); window.location.hash = ""; }} />
      </>
    );
  }
  return <Pesaje sesion={sesion} b={b} onCerrar={cerrar} />;
}
