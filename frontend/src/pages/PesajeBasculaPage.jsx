import { useState, useEffect, useRef, useCallback } from "react";
import { authHeader, useAuth, usePuede } from "../context/AuthContext.jsx";
import { useBascula } from "../hooks/useBascula.js";

// Pesaje en báscula (#/pesaje) — corre en el Chrome del cabezal, junto a la app Báscula Puente.
//
//  1. Inicio de sesión: solo "pase su carnet". De su área de hoy salen la bodega y el modo; si el
//     área no los define, se le pregunta.
//  2. Pesaje: elige talla, lote (del inventario al piso de su bodega) y tipo de empaque. Pone la
//     caja; si el peso queda estable DENTRO del rango, al retirarla se guarda (GUARDADO #n). Bajo o
//     sobrepeso NO se guarda (SIN GUARDAR). En "producto terminado" se escanea un carnet por bandeja.
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
                {[["PERSONA", "Producto terminado", "carnet por cada bandeja"], ["PRODUCTO", "Por producto", "sin carnet por caja"]].map(([v, t, d]) => (
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
// Dos vistas según el modo de la sesión (sale del área de la pesadora):
//   - PRODUCTO TERMINADO (Modo PERSONA): fondo índigo para distinguirla. Lote y tipo de producto del
//     piso, pero el producto CAMBIA (BF T-ON → Empanizado coco…) y gana peso con las harinas, así que
//     se elige el producto que sale y el destino (exportación con pedido / venta local). Carnet de UNA
//     persona antes de cada bandeja. Peso libre salvo que el tipo de empaque elegido tenga rango.
//   - POR PRODUCTO: lote, tipo de producto, talla y tipo de empaque (obligatorio), sin carnet.
// En las dos, si el área lo pide (Empanizado), el número de carrito es obligatorio, como el termo en Pelado.
const UMBRAL_LIBRE_G = 30;

function Pesaje({ sesion, b, onCerrar }) {
  const puedeAnular = usePuede("pesaje_bascula", "anular_caja");
  const pt = sesion.Modo === "PERSONA";
  const pideCarrito = Number(sesion.PideCarrito) === 1;
  const [cat, setCat] = useState({ empaques: [], tallas: [], lotes: [], clases: [], pedidos: [] });
  const [trabajo, setTrabajo] = useState(() => {
    const t = leerLS(claveTrabajo(sesion.BalanzaCodigo)) ?? {};
    // Versión anterior guardaba "LOTE|CLASE" en un solo campo.
    const [lote, clase] = String(t.lote ?? "").includes("|") ? t.lote.split("|") : [t.lote ?? "", t.clase ?? ""];
    return {
      talla: t.talla ?? "", lote, clase, empaque: t.empaque ?? "",
      claseSalida: t.claseSalida ?? "", destino: t.destino ?? "", pedido: t.pedido ?? "", carrito: t.carrito ?? "",
    };
  });
  const [persona, setPersona] = useState(null); // { Codigo, NombreCompleto }
  const [carnetCaja, setCarnetCaja] = useState("");
  const [errorCarnet, setErrorCarnet] = useState("");
  const [aviso, setAviso] = useState(null); // { tipo: "guardado"|"sin_guardar"|"pendiente"|"error", texto, detalle }
  const [resumen, setResumen] = useState({ Cajas: 0, NetoG: 0, ultimas: [] });
  const [cola, setCola] = useState([]); // pesadas por enviar (red caída)
  const [buscarLote, setBuscarLote] = useState("");
  const [lotesBuscados, setLotesBuscados] = useState([]);
  const carnetRef = useRef(null);
  const candidatoRef = useRef(null);   // último peso estable que SÍ se guarda, con bandeja en la pesa
  const fueraRef = useRef(null);       // último peso estable FUERA del rango
  const actividadRef = useRef(Date.now());
  const set = (k) => (e) => setTrabajo(t => ({ ...t, [k]: e.target.value }));

  const empaque = cat.empaques.find(e => e.Codigo === trabajo.empaque) ?? null;
  const conRango = Boolean(empaque?.ConRango);
  const loteSel = trabajo.lote && trabajo.clase ? { Lote: trabajo.lote, Clase: trabajo.clase } : null;
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

  // Lo que falta para poder guardar una bandeja, en el orden en que se llena la pantalla.
  const faltan = [
    !trabajo.lote && "lote", trabajo.lote && !trabajo.clase && "tipo de producto", !trabajo.talla && "talla",
    !pt && !empaque && "tipo de empaque",
    pt && !trabajo.claseSalida && "producto que sale",
    pt && !trabajo.destino && "destino",
    pt && trabajo.destino === "EXPORTACION" && !trabajo.pedido && "pedido",
    pideCarrito && !trabajo.carrito.trim() && "número de carrito",
  ].filter(Boolean);
  const faltaCarnet = pt && !persona;

  useEffect(() => { escribirLS(claveTrabajo(sesion.BalanzaCodigo), trabajo); }, [trabajo, sesion.BalanzaCodigo]);

  // Empaque: con uno solo activo queda puesto (solo en "por producto", donde es obligatorio); uno
  // guardado que ya no está activo se limpia. Pedido que ya no está en proceso, también.
  useEffect(() => {
    if (!cat.empaques.length && !cat.pedidos.length) return;
    setTrabajo(t => {
      let n = t;
      if (t.empaque && !cat.empaques.some(e => e.Codigo === t.empaque)) n = { ...n, empaque: "" };
      if (!pt && !n.empaque && cat.empaques.length === 1) n = { ...n, empaque: cat.empaques[0].Codigo };
      if (t.pedido && !cat.pedidos.some(p => p.CodigoPedido === t.pedido)) n = { ...n, pedido: "" };
      return n;
    });
  }, [cat.empaques, cat.pedidos]); // eslint-disable-line react-hooks/exhaustive-deps

  const cargarResumen = useCallback(async () => {
    try { setResumen(await api(`/api/pesaje-bascula/sesion/${sesion.SesionId}/resumen`)); } catch { /* siguiente */ }
  }, [sesion.SesionId]);

  // Catálogos al entrar y cada minuto (un tipo de empaque o pedido nuevo aparece solo).
  const cargarCatalogos = useCallback(() =>
    api(`/api/pesaje-bascula/sesion/${sesion.SesionId}/catalogos`).then(setCat).catch(e => setAviso({ tipo: "error", texto: "ERROR", detalle: e.message })),
  [sesion.SesionId]);
  useEffect(() => {
    cargarCatalogos();
    cargarResumen();
    const id = setInterval(cargarCatalogos, 60_000);
    return () => clearInterval(id);
  }, [cargarCatalogos, cargarResumen]);

  useEffect(() => {
    const q = buscarLote.trim();
    if (q.length < 2) { setLotesBuscados([]); return; }
    const id = setTimeout(() => api(`/api/pesaje-bascula/lotes?q=${encodeURIComponent(q)}`).then(setLotesBuscados).catch(() => {}), 300);
    return () => clearTimeout(id);
  }, [buscarLote]);

  useEffect(() => {
    const id = setInterval(() => { if (Date.now() - actividadRef.current > INACTIVIDAD_MS) onCerrar("15 min sin pesar"); }, 30_000);
    return () => clearInterval(id);
  }, [onCerrar]);

  // Producto terminado: el foco vive en el carnet de la bandeja mientras falte.
  useEffect(() => { if (faltaCarnet) carnetRef.current?.focus(); }, [faltaCarnet, aviso]);

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
        setAviso({ tipo: "pendiente", texto: "PENDIENTE DE ENVIAR", detalle: "sin conexión; se reintenta solo" });
      } else {
        setCola(c => c.filter(x => x.Uuid !== p.Uuid));
        setAviso({ tipo: "sin_guardar", texto: "SIN GUARDAR", detalle: e.message });
      }
    }
  }, [cargarResumen, onCerrar]);

  useEffect(() => {
    if (!cola.length) return undefined;
    const id = setInterval(() => cola.forEach(enviar), REINTENTO_MS);
    return () => clearInterval(id);
  }, [cola, enviar]);

  // "Bandeja retirada" = el peso baja de la mitad del mínimo (con rango) o de 30 g (peso libre).
  const vacioBajo = conRango ? Math.max(UMBRAL_VACIO_G, Math.round(empaque.MinG / 2)) : UMBRAL_LIBRE_G;

  // Regla de guardado: el último peso ESTABLE con la bandeja en la pesa decide; al retirarla se guarda
  // si todo está completo (y dentro del rango, si lo hay). Si no, SIN GUARDAR con el motivo.
  useEffect(() => {
    if (!b.vigente) return;
    if (b.gramos >= vacioBajo) {
      if (b.estable) {
        actividadRef.current = Date.now();
        const dentro = !conRango || (b.gramos >= empaque.MinG && b.gramos <= empaque.MaxG);
        if (dentro) { candidatoRef.current = b.gramos; fueraRef.current = null; }
        else { fueraRef.current = b.gramos; candidatoRef.current = null; }
        if (aviso?.tipo === "guardado" || aviso?.tipo === "sin_guardar") setAviso(null);
      }
      return;
    }
    const gramos = candidatoRef.current, fuera = fueraRef.current;
    candidatoRef.current = null; fueraRef.current = null;
    if (fuera !== null && conRango) {
      setAviso({ tipo: "sin_guardar", texto: "SIN GUARDAR", detalle: `${g(fuera)} g ${fuera < empaque.MinG ? "bajo peso" : "sobrepeso"} (rango ${g(empaque.MinG)}–${g(empaque.MaxG)} g)` });
      return;
    }
    if (gramos === null) return;
    if (faltan.length) { setAviso({ tipo: "sin_guardar", texto: "SIN GUARDAR", detalle: `falta: ${faltan.join(", ")}` }); return; }
    if (faltaCarnet) { setAviso({ tipo: "sin_guardar", texto: "SIN GUARDAR", detalle: "falta el carnet de esta bandeja" }); return; }
    const p = {
      Uuid: uuid(), SesionId: sesion.SesionId, EmpaqueCodigo: empaque?.Codigo ?? null, Lote: loteSel.Lote, Clase: loteSel.Clase,
      Talla: Number(trabajo.talla), PersonaCodigo: pt ? persona.Codigo : null, PesoBrutoG: gramos,
      Carrito: pideCarrito ? trabajo.carrito.trim() : null,
      ClaseSalida: pt ? trabajo.claseSalida : null, Destino: pt ? trabajo.destino : null,
      CodigoPedido: pt && trabajo.destino === "EXPORTACION" ? trabajo.pedido : null,
      nombrePersona: persona?.NombreCompleto,
    };
    if (pt) setPersona(null); // un carnet por cada bandeja
    enviar(p);
  }, [b.vigente, b.gramos, b.estable]); // eslint-disable-line react-hooks/exhaustive-deps

  const anularUltima = async () => {
    const u = resumen.ultimas[0];
    if (!u) return;
    const motivo = window.prompt(`Anular la bandeja de ${g(u.PesoBrutoG)} g (${u.Hora}). ¿Por qué?`);
    if (!motivo?.trim()) return;
    try { await api(`/api/pesaje-bascula/pesadas/${u.PesadaId}/anular`, { method: "POST", body: JSON.stringify({ motivo }) }); cargarResumen(); }
    catch (e) { setAviso({ tipo: "error", texto: "NO SE ANULÓ", detalle: e.message }); }
  };

  // Color y textos del recuadro: SIEMPRE según el peso. Lo que falta para poder guardar va en un aviso
  // aparte arriba; antes reemplazaba el color y en rango se veía gris (usuario, 17 nov 2026).
  const faltaTodo = [...faltan, faltaCarnet && "carnet de la bandeja"].filter(Boolean);
  let fondo = "bg-slate-700", estado = "SIN LECTURA", sub = "revise la báscula o la app Báscula Puente";
  if (b.vigente) {
    if (b.gramos < vacioBajo) {
      fondo = "bg-slate-800"; estado = "PESA VACÍA";
      sub = conRango ? `debe pesar ${g(empaque.MinG)} – ${g(empaque.MaxG)} g` : "ponga la bandeja";
      if (b.gramos >= UMBRAL_VACIO_G) sub += ` · marca ${g(b.gramos)} g: ¿tarar la báscula?`;
    }
    else if (conRango && b.gramos < empaque.MinG) { fondo = "bg-amber-400 text-amber-950"; estado = "BAJO PESO"; sub = `faltan ${g(empaque.MinG - b.gramos)} g · no se guarda`; }
    else if (conRango && b.gramos > empaque.MaxG) { fondo = "bg-red-600"; estado = "SOBREPESO"; sub = `sobran ${g(b.gramos - empaque.MaxG)} g · no se guarda`; }
    else { fondo = "bg-emerald-600"; estado = conRango ? "PESO CORRECTO" : "PESO REGISTRABLE"; sub = b.estable ? "retire la bandeja para guardar" : "esperando que se estabilice"; }
    if (faltaTodo.length && b.gramos >= vacioBajo) sub = "no se guardará: complete lo que falta";
  }
  const insignia = aviso && {
    guardado: "bg-white text-emerald-700", sin_guardar: "bg-white text-red-700", pendiente: "bg-white text-amber-700", error: "bg-white text-red-700",
  }[aviso.tipo];
  const icono = aviso && { guardado: "✓", sin_guardar: "✗", pendiente: "…", error: "!" }[aviso.tipo];

  // Producto terminado se distingue por el fondo índigo (usuario, 17 nov 2026).
  const tema = pt
    ? { pagina: "bg-indigo-950", barra: "bg-indigo-800", campo: "bg-indigo-900 border-indigo-600", panel: "bg-indigo-900/70", etiqueta: "PRODUCTO TERMINADO", chip: "bg-amber-400 text-amber-950" }
    : { pagina: "bg-slate-900", barra: "bg-slate-800", campo: "bg-slate-800 border-slate-600", panel: "bg-slate-800", etiqueta: "POR PRODUCTO", chip: "bg-violet-500/30 text-violet-200" };
  const sel = `w-full rounded-lg border px-3 py-2 text-base text-white focus:outline-none focus:border-blue-400 ${tema.campo}`;
  const etq = "text-[11px] text-slate-300 uppercase tracking-wide";

  return (
    // 100dvh y no h-screen (100vh): en Chrome de Android 100vh incluye la barra de direcciones y la
    // barra del rango quedaba cortada abajo.
    <div className={`${tema.pagina} text-white flex flex-col`} style={{ height: "100dvh" }}>
      <header className={`h-12 shrink-0 flex items-center px-4 gap-3 ${tema.barra}`}>
        <span className="font-mono font-bold">{sesion.BalanzaCodigo}</span>
        <span className="text-slate-200 font-semibold">{sesion.BodegaNombre ?? "—"}</span>
        <span className={`text-xs font-bold rounded px-2 py-0.5 ${tema.chip}`}>{tema.etiqueta}</span>
        {cola.length > 0 && <span className="text-xs bg-amber-500/30 text-amber-200 rounded px-2 py-0.5">{cola.length} por enviar</span>}
        <span className="ml-auto text-sm">Operadora: <b>{sesion.Operadora}</b> <span className="text-slate-400 font-mono">{sesion.OperadoraCodigo}</span></span>
        <button onClick={() => onCerrar("salió")} className="ml-2 px-3 py-1.5 rounded-lg bg-white/10 text-sm">Salir</button>
      </header>

      <div className="flex-1 flex gap-3 p-3 min-h-0">
        {/* Lo que se está trabajando */}
        <div className="w-[320px] shrink-0 flex flex-col gap-2 min-h-0 overflow-y-auto pr-1">
          <label className={etq}>Lote (piso de {sesion.BodegaNombre ?? "la bodega"})
            <select value={trabajo.lote} onChange={e => elegirLote(e.target.value)} className={sel + " mt-0.5 font-mono"}>
              <option value="">— elija —</option>
              {lotesUnicos.map(l => <option key={l} value={l}>{l} · {kgLote(l).toLocaleString("es", { maximumFractionDigits: 0 })} kg</option>)}
              {trabajo.lote && !lotesUnicos.includes(trabajo.lote) && <option value={trabajo.lote}>{trabajo.lote} (buscado)</option>}
            </select>
          </label>
          <div>
            <input value={buscarLote} onChange={e => setBuscarLote(e.target.value)} placeholder="¿No está? Buscar otro lote…"
              className={`w-full rounded-lg border px-3 py-1.5 text-sm ${tema.campo}`} />
            {lotesBuscados.length > 0 && (
              <div className="mt-1 max-h-28 overflow-auto rounded-lg border border-slate-600 bg-slate-800">
                {lotesBuscados.map(l => (
                  <button key={`${l.Lote}|${l.Clase}`} onClick={() => { setTrabajo(t => ({ ...t, lote: l.Lote, clase: l.Clase })); setBuscarLote(""); }}
                    className="block w-full text-left px-3 py-1.5 text-sm font-mono hover:bg-slate-700">{l.Lote} · {l.Clase}{l.ClaseDesc ? ` · ${l.ClaseDesc}` : ""}</button>
                ))}
              </div>
            )}
          </div>
          <label className={etq}>Tipo de producto (del lote)
            <select value={trabajo.clase} disabled={!trabajo.lote} onChange={set("clase")} className={sel + " mt-0.5 disabled:opacity-50"}>
              <option value="">{trabajo.lote ? "— elija —" : "elija primero el lote"}</option>
              {clasesDelLote.map(([c, d]) => <option key={c} value={c}>{c}{d ? ` · ${d}` : ""}</option>)}
            </select>
          </label>
          <label className={etq}>Talla
            <select value={trabajo.talla} onChange={set("talla")} className={sel + " mt-0.5"}>
              <option value="">— elija —</option>
              {cat.tallas.map(t => <option key={t.Codigo} value={t.Codigo}>{t.Descripcion} ({t.Codigo})</option>)}
            </select>
          </label>


          {pideCarrito && (
            <label className={etq}>N.º de carrito *
              <input value={trabajo.carrito} onChange={e => setTrabajo(t => ({ ...t, carrito: e.target.value.toUpperCase() }))} autoComplete="off"
                placeholder="obligatorio" className={sel + " mt-0.5 font-mono tracking-widest"} />
            </label>
          )}

          {pt && (
            <div className={`rounded-xl p-3 border ${persona ? "bg-violet-600/30 border-violet-300/60" : "bg-violet-600/50 border-violet-200 animate-pulse"}`}>
              <p className="text-[11px] text-violet-100 uppercase">Carnet de esta bandeja *</p>
              {persona ? (
                <>
                  <p className="text-lg font-bold leading-tight">{persona.NombreCompleto}</p>
                  <p className="text-sm text-violet-200 font-mono">{persona.Codigo} <button onClick={() => setPersona(null)} className="ml-2 underline">cambiar</button></p>
                </>
              ) : (
                <form onSubmit={e => { e.preventDefault(); if (carnetCaja.trim()) leerCarnet(carnetCaja.trim().toUpperCase()); }}>
                  <input ref={carnetRef} value={carnetCaja} onChange={e => setCarnetCaja(e.target.value.toUpperCase())} autoComplete="off"
                    placeholder="ESCANEE EL CARNET" className="mt-1 w-full rounded-lg bg-amber-300 text-amber-950 placeholder:text-amber-900 placeholder:font-bold border-2 border-amber-100 px-3 py-2.5 font-mono text-lg font-bold tracking-widest text-center focus:outline-none focus:ring-4 focus:ring-amber-200" />
                  {errorCarnet && <p className="text-xs text-red-200 mt-1">{errorCarnet}</p>}
                </form>
              )}
            </div>
          )}
        </div>

        {/* El peso */}
        <div className="flex-1 flex flex-col gap-3 min-w-0">
          <div className={`flex-1 min-h-0 rounded-2xl ${fondo} flex flex-col items-center justify-center relative px-4`}>
            <div className="absolute top-3 left-3">
              {!b.vigente ? (
                <span className="rounded-full bg-black/30 px-3 py-1.5 text-base font-bold">SIN LECTURA</span>
              ) : b.estable ? (
                <span className="rounded-full bg-emerald-200 text-emerald-900 px-3 py-1.5 text-base font-bold">● ESTABLE</span>
              ) : (
                <span className="rounded-full bg-black/30 px-3 py-1.5 text-base font-bold animate-pulse">◌ MOVIENDO</span>
              )}
            </div>
            {aviso && (
              <div className="absolute top-3 right-3 max-w-[70%]">
                <div className={`flex items-center gap-2 rounded-2xl px-4 py-1.5 text-lg font-bold shadow ${insignia}`}>
                  <span>{icono}</span><span>{aviso.texto}</span>
                  {aviso.detalle && <span className="text-sm font-medium opacity-80 truncate">· {aviso.detalle}</span>}
                </div>
              </div>
            )}
            {/* Lo que falta para poder guardar: aviso aparte, sin tapar el color del peso. */}
            {faltaTodo.length > 0 && (
              <div className="absolute top-14 left-3 right-3 flex justify-center">
                <div className="rounded-xl bg-amber-300 text-amber-950 px-4 py-1.5 text-lg font-bold shadow">
                  FALTA: {faltaTodo.join(" · ").toUpperCase()}
                </div>
              </div>
            )}
            <p className="text-xl font-bold mb-1 opacity-90">
              {conRango ? `Debe pesar ${g(empaque.MinG)} – ${g(empaque.MaxG)} g` : "Peso libre"}
            </p>
            <p className="text-[110px] leading-none font-bold font-mono tracking-tight">{b.vigente ? g(b.gramos) : "—"}<span className="text-4xl ml-2 font-semibold">g</span></p>
            <p className="text-2xl font-bold mt-2 tracking-wide text-center">{estado}</p>
            {sub && <p className="text-base mt-0.5 opacity-80 text-center">{sub}</p>}
          </div>
          {conRango && (() => {
            const lo = empaque.MinG * 0.85, hi = empaque.MaxG * 1.15, w = hi - lo;
            const pct = v => Math.min(100, Math.max(0, ((v - lo) / w) * 100));
            const marca = b.vigente ? pct(b.gramos) : null;
            return (
              <div className="shrink-0 relative h-10 rounded-xl overflow-hidden flex text-sm font-bold">
                <div style={{ width: `${pct(empaque.MinG)}%` }} className="bg-amber-400 text-amber-950 flex items-center justify-center">BAJO</div>
                <div style={{ width: `${pct(empaque.MaxG) - pct(empaque.MinG)}%` }} className="bg-emerald-500 flex items-center justify-center whitespace-nowrap min-w-[120px]">
                  {g(empaque.MinG)} – {g(empaque.MaxG)} g
                </div>
                <div className="flex-1 bg-red-500 flex items-center justify-center">SOBREPESO</div>
                {marca !== null && <div style={{ left: `calc(${marca}% - 3px)` }} className="absolute top-0 bottom-0 w-1.5 bg-white shadow-[0_0_6px_rgba(0,0,0,0.6)]" />}
              </div>
            );
          })()}
        </div>

        {/* Lo que sale (producto, destino, pedido, empaque) y contadores */}
        <div className="w-[300px] shrink-0 flex flex-col gap-2 min-h-0 overflow-y-auto pl-1">
          <div className="flex flex-col gap-2">
            {pt && (
              <>
                <label className={etq}>Producto que sale
                  <select value={trabajo.claseSalida} onChange={set("claseSalida")} className={sel + " mt-0.5"}>
                    <option value="">— elija —</option>
                    {cat.clases.map(c => <option key={c.Clase} value={c.Clase}>{c.Clase} · {c.Descripcion}</option>)}
                  </select>
                </label>
                <div className={etq}>Destino
                  <div className="mt-0.5 grid grid-cols-2 gap-2">
                    {[["EXPORTACION", "Exportación"], ["LOCAL", "Venta local"]].map(([v, t]) => (
                      <button key={v} onClick={() => setTrabajo(x => ({ ...x, destino: v, pedido: v === "LOCAL" ? "" : x.pedido }))}
                        className={`py-2 rounded-lg border text-sm font-bold normal-case ${trabajo.destino === v ? "bg-amber-400 text-amber-950 border-amber-300" : `${tema.campo} text-white`}`}>{t}</button>
                    ))}
                  </div>
                </div>
                {trabajo.destino === "EXPORTACION" && (
                  <label className={etq}>Pedido de exportación
                    <select value={trabajo.pedido} onChange={set("pedido")} className={sel + " mt-0.5"}>
                      <option value="">— elija —</option>
                      {cat.pedidos.map(p => <option key={p.CodigoPedido} value={p.CodigoPedido}>{p.CodigoPedido} · {p.Cliente}</option>)}
                    </select>
                    {cat.pedidos.length === 0 && <span className="block mt-1 text-amber-300 normal-case">No hay pedidos de exportación en proceso.</span>}
                  </label>
                )}
              </>
            )}
  
            <label className={etq}>Tipo de empaque{pt ? " (opcional)" : ""}
              <select value={trabajo.empaque} onChange={set("empaque")} className={sel + " mt-0.5"}>
                <option value="">{pt ? "— peso libre —" : "— elija —"}</option>
                {cat.empaques.map(e => <option key={e.Codigo} value={e.Codigo}>{e.Nombre}{e.ConRango ? ` · ${g(e.MinG)}–${g(e.MaxG)} g` : " · libre"}</option>)}
              </select>
            </label>
          </div>
          <div className={`${tema.panel} rounded-xl px-3 py-2 flex items-baseline gap-2 mt-1`}><span className="text-xs text-slate-300">Bandejas hoy</span><span className="text-2xl font-bold">{g(resumen.Cajas)}</span><span className="text-xs text-slate-300 ml-auto">{(resumen.NetoG / 1000).toLocaleString("es", { maximumFractionDigits: 1 })} kg</span></div>
          <div className={`${tema.panel} rounded-xl p-3 flex-1 min-h-[90px] overflow-auto`}>
            <p className="text-xs text-slate-300 mb-2">Últimas guardadas</p>
            <ul className="space-y-1.5 text-sm font-mono">
              {resumen.ultimas.map(u => (
                <li key={u.PesadaId} className="flex justify-between gap-2"><span>{g(u.PesoBrutoG)} g</span><span className="text-emerald-300 truncate">✓ {u.PersonaCodigo ?? u.Hora}</span></li>
              ))}
            </ul>
            <p className="text-[11px] text-slate-400 mt-3">Lo que sale "sin guardar" no aparece aquí.</p>
          </div>
          {puedeAnular && resumen.ultimas.length > 0 && (
            <button onClick={anularUltima} className="rounded-xl bg-white/10 py-2.5 text-sm">Anular última (supervisor)</button>
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
