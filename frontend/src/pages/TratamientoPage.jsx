// Tratamiento de Camarón (químico) — la hoja "TRATAMIENTO DE CAMARON" en pantalla.
//
// Cada renglón del papel es un TERMO y se captura en dos momentos, como se llena la hoja:
//   - Entrada: se escoge del inventario al piso (lote, clase, talla y fecha del lote vienen de ahí,
//     no se teclean), con número de termo, hora de inicio, químico y kg sin tratar, que se pesan:
//     una línea del piso se reparte en varios termos. Esos kilos salen del piso en ese momento.
//     El conteo inicial ya no se pide (usuario, 10 nov 2026).
//   - Salida: hora, conteo final, kg tratadas y a dónde va. Lo tratado entra al piso del destino ahí
//     mismo, sin esperar a que se cierre la hoja.
// Lo que el papel calcula a mano lo calcula el sistema: TIEMPO (salida − inicio), el % PICK-UP y los
// totales del turno. El CORTE ya lo dice la clase (E41 = "PELADO P&D T-OFF") y por eso no se pide.
//
// Pick-up = (tratadas − sin tratar) ÷ sin tratar. Negativo o arriba del máximo es una ALERTA (poco
// tiempo, otra dosis…): se marca en rojo o ámbar, nunca se escribe como 0 ni bloquea nada.
//
// El cliente de la hoja es el PREVISTO: Empaque lo puede cambiar al escanear el master según tallas y
// prioridades, así que es una referencia y no separa el inventario. Ver backend/src/lib/tratamiento.ts.
import { useState, useEffect, useCallback, useMemo } from "react";
import { fmtNum } from "../utils/numero.js";
import { authHeader, usePuede } from "../context/AuthContext.jsx";
import { useAviso } from "../hooks/useAviso.js";
import AvisoModal from "../components/AvisoModal.jsx";
import EmpleadoAutocomplete from "../components/EmpleadoAutocomplete.jsx";
import HojaTratamientoModal from "../components/HojaTratamientoModal.jsx";
import ReporteTratamientoModal from "../components/ReporteTratamientoModal.jsx";

const API = "/api/tratamiento";

const hoyGT = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
const horaGT = () =>
  new Date().toLocaleTimeString("es-GT", { hour12: false, hour: "2-digit", minute: "2-digit", timeZone: "America/Guatemala" });

// Las fechas puras se parten a mano: new Date("2026-10-17") es medianoche UTC y en Guatemala se
// muestra un día antes (ver utils/fecha.js).
const fmtDia = (iso) => {
  if (!iso) return "—";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};
const hora = (dt) => (dt ? String(dt).slice(11, 16) : "");
const fmtTiempo = (min) => {
  if (min == null) return "—";
  const h = Math.floor(min / 60), m = min % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
};

async function leerJSON(res) { try { return await res.json(); } catch { return {}; } }

const pickupDe = (sin, trat) => {
  const s = Number(sin), t = Number(trat);
  if (!(s > 0) || !(t > 0)) return null;
  return Number((((t - s) / s) * 100).toFixed(1));
};
const alertaDe = (p, max) => (p == null ? null : p < 0 ? "PERDIDA" : p > max ? "EXCEDE" : null);

function Pickup({ valor, alerta, grande = false }) {
  if (valor == null) return <span className="text-gray-400">—</span>;
  const cls = alerta === "PERDIDA" ? "text-red-600" : alerta === "EXCEDE" ? "text-amber-600" : "text-green-700";
  const titulo = alerta === "PERDIDA" ? "Salió pesando menos de lo que entró: revisar tiempo y dosis"
               : alerta === "EXCEDE" ? "Pasa del máximo de pick-up" : undefined;
  return (
    <span title={titulo} className={`font-semibold ${cls} ${grande ? "text-xl" : ""}`}>
      {valor > 0 ? "+" : ""}{fmtNum(valor, 1)} %{alerta ? " ⚠" : ""}
    </span>
  );
}

function Marco({ titulo, ancho = "max-w-lg", onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-white rounded-xl shadow-xl w-full ${ancho} max-h-full flex flex-col`} onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
          <h3 className="text-lg font-bold text-gray-800">{titulo}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <div className="px-5 py-4 overflow-y-auto space-y-4">{children}</div>
      </div>
    </div>
  );
}

const campo = "w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";
const Etiqueta = ({ children }) => <label className="block text-xs text-gray-500 mb-1">{children}</label>;

function Botones({ onCancelar, onAceptar, texto, ocupado, deshabilitado }) {
  return (
    <div className="flex justify-end gap-3 pt-1">
      <button onClick={onCancelar} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancelar</button>
      <button onClick={onAceptar} disabled={ocupado || deshabilitado}
        className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg disabled:opacity-50">
        {ocupado ? "Guardando…" : texto}
      </button>
    </div>
  );
}

/* ── Tratar lo marcado del piso ───────────────────────────────────── */
// La hoja NO se abre a mano: se marca lo del piso, "Tratar" y se escoge el cliente de un pedido
// activo. Si ese cliente ya tiene hoja abierta en la jornada, los termos se suman a esa; si no, se
// abre una —  una hoja por cliente, como dice el papel— , así nunca queda una hoja vacía.
//
// Un termo no carga 1000 kg (usuario, 10 nov 2026): cada línea del piso se REPARTE en los termos que
// haga falta y los kg de cada termo se teclean (antes cada línea entraba completa en un solo termo,
// decisión del 22 oct). Lo que no se asigna sigue al piso para otro turno. La hora se pone
// una vez para todos ("〃" en el papel) y se corrige por termo; el químico ya no se pide aquí.
let llaveRenglon = 0;
// El químico no se pide al meter a tratamiento (usuario, 10 nov 2026): se corrige en "Editar" si hace falta.
const termoNuevo = (hora) => ({ key: ++llaveRenglon, NumeroTermo: "", Kg: "", HoraInicio: hora, Aceptar: false });
const claveLinea = (l) => `${l.RemisionId ?? ""}|${l.Lote}|${l.Clase}|${l.Talla}|${l.FechaLote ?? ""}`;
// Lo mismo que acepta el servidor como diferencia de báscula (lib/tratamiento.ts, MARGEN_DIFERENCIA).
const tolerancia = (alPiso) => Math.max(1, alPiso * 0.10);

// La línea del piso como una barra de avance que se llena con sus termos: cada segmento es un termo
// con su número y sus kg; lo rayado en ámbar es lo que todavía queda al piso. Lo que PASA de lo
// declarado al piso se pinta en rojo, dentro del mismo termo que se pasó, y una raya marca hasta
// dónde llegaba el piso.
const CIAN = ["#0891b2", "#0e7490"];   // cyan-600 / cyan-700, alternados para separar termos
const ROJO = "#dc2626";                 // red-600
function BarraTermos({ alPiso, termos }) {
  const conKg = termos.filter(t => Number(t.Kg) > 0);
  const asignado = conKg.reduce((s, t) => s + Number(t.Kg), 0);
  const escala = Math.max(alPiso, asignado) || 1;
  const queda = alPiso - asignado;
  const pasa = asignado - alPiso > 0.001;
  // Dónde empieza cada termo dentro de la barra (kg acumulados de los anteriores).
  const inicios = conKg.map((_, i) => conKg.slice(0, i).reduce((s, t) => s + Number(t.Kg), 0));
  return (
    <div className="relative flex h-7 w-full overflow-hidden rounded-md border border-gray-300 bg-white">
      {conKg.map((t, i) => {
        const kg = Number(t.Kg);
        const desde = inicios[i];
        // Qué parte de este termo cae después de lo declarado al piso (0 a 100 % del segmento).
        const dentro = Math.max(0, Math.min(kg, alPiso - desde));
        const pctDentro = (dentro / kg) * 100;
        const color = CIAN[i % 2];
        const fondo = pctDentro >= 100 ? color : `linear-gradient(to right, ${color} 0 ${pctDentro}%, ${ROJO} ${pctDentro}% 100%)`;
        const pct = (kg / escala) * 100;
        return (
          <div key={t.key} title={`Termo ${t.NumeroTermo || "sin número"} · ${fmtNum(kg)} kg${pctDentro < 100 ? ` · ${fmtNum(kg - dentro)} kg de más` : ""}`}
            style={{ width: `${pct}%`, background: fondo }}
            className="flex items-center justify-center overflow-hidden whitespace-nowrap border-r border-white/70 px-1 text-[11px] font-semibold text-white transition-[width] duration-200 motion-reduce:transition-none">
            {pct > 8 && <span className="truncate"><span className="font-mono">{t.NumeroTermo ? `T${t.NumeroTermo}` : "T?"}</span> · {fmtNum(kg, 0)}</span>}
          </div>
        );
      })}
      {queda > 0.001 && (
        <div className="flex flex-1 items-center justify-center overflow-hidden whitespace-nowrap px-2 text-[11px] font-semibold text-amber-800"
          style={{ backgroundImage: "repeating-linear-gradient(135deg, #fde68a 0 6px, #fef3c7 6px 12px)" }}>
          queda {fmtNum(queda)} kg
        </div>
      )}
      {pasa && (
        <div aria-hidden className="pointer-events-none absolute inset-y-0 w-0.5 bg-gray-900"
          style={{ left: `calc(${(alPiso / escala) * 100}% - 1px)` }} title="Hasta aquí llega lo declarado al piso" />
      )}
    </div>
  );
}

const Paso = ({ n, children }) => (
  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500"><span className="text-blue-600">{n}</span> · {children}</p>
);

function ModalTratar({ lineas, fecha, hojas, clientes, empleados, pedirConfirmacion, onConfirmar, onCerrar }) {
  const [filtro, setFiltro] = useState("");
  const [cliente, setCliente] = useState("");
  const [encargado, setEncargado] = useState("");
  const [inicioHoja, setInicioHoja] = useState(horaGT());
  const [horaComun, setHoraComun] = useState(horaGT());
  // Una tarjeta por línea marcada, cada una con sus termos. Empieza con un termo vacío.
  const [grupos, setGrupos] = useState(() => lineas.map(l => ({ linea: l, termos: [termoNuevo(horaGT())] })));
  const [errorEn, setErrorEn] = useState(null);   // { key, error }
  const [ocupado, setOcupado] = useState(false);

  const lista = useMemo(() => {
    const f = filtro.trim().toUpperCase();
    if (!f) return clientes;
    return clientes.filter(c => c.RazonSocial.toUpperCase().includes(f) ||
      c.Pedidos.some(p => String(p.CodigoPedido).toUpperCase().includes(f) || String(p.Descripcion ?? "").toUpperCase().includes(f)));
  }, [clientes, filtro]);
  const hojaDelCliente = cliente ? hojas.find(h => h.Estatus === "Abierta" && h.ClienteCodigo === Number(cliente)) : null;

  const editarTermo = (lkey, tkey, campo, valor) => setGrupos(gs => gs.map(g => (claveLinea(g.linea) !== lkey ? g
    : { ...g, termos: g.termos.map(t => (t.key === tkey ? { ...t, [campo]: valor, Aceptar: false } : t)) })));
  const agregarTermo = (lkey) => setGrupos(gs => gs.map(g => (claveLinea(g.linea) !== lkey ? g
    : { ...g, termos: [...g.termos, termoNuevo(horaComun)] })));
  const quitarTermo = (lkey, tkey) => setGrupos(gs => gs.map(g => (claveLinea(g.linea) !== lkey ? g
    : { ...g, termos: g.termos.filter(t => t.key !== tkey) })));
  const quitarLinea = (lkey) => setGrupos(gs => gs.filter(g => claveLinea(g.linea) !== lkey));
  const aTodos = (campo, valor) => setGrupos(gs => gs.map(g => ({ ...g, termos: g.termos.map(t => ({ ...t, [campo]: valor })) })));

  const todos = grupos.flatMap(g => g.termos.map(t => ({ g, t })));
  const totalKg = todos.reduce((s, x) => s + (Number(x.t.Kg) || 0), 0);
  // Lo que sigue al piso se cuenta línea por línea: lo que sobra en una no tapa lo que falta en otra.
  const siguenAlPiso = grupos.reduce((s, g) =>
    s + Math.max(0, g.linea.Kg - g.termos.reduce((x, t) => x + (Number(t.Kg) || 0), 0)), 0);
  // Lo que impide guardar, dicho en concreto; null si se puede.
  const problema = (() => {
    if (!cliente) return "Escoja el pedido del cliente.";
    if (!todos.length) return "No quedó ningún termo.";
    if (todos.some(x => !x.t.NumeroTermo.trim())) return "Falta el número de algún termo.";
    if (todos.some(x => !(Number(x.t.Kg) > 0))) return "Falta pesar algún termo.";
    if (todos.some(x => !x.t.HoraInicio)) return "Falta la hora de inicio de algún termo.";
    const vistos = new Set();
    for (const x of todos) {
      const n = x.t.NumeroTermo.trim().toUpperCase();
      if (vistos.has(n)) return `El termo ${x.t.NumeroTermo.trim()} está dos veces.`;
      vistos.add(n);
    }
    for (const g of grupos) {
      const kg = g.termos.reduce((s, t) => s + (Number(t.Kg) || 0), 0);
      if (kg - g.linea.Kg > tolerancia(g.linea.Kg)) return `${g.linea.Lote}: los termos suman ${fmtNum(kg)} kg y al piso hay ${fmtNum(g.linea.Kg)} kg.`;
    }
    return null;
  })();

  const guardar = async (estado = grupos) => {
    setOcupado(true); setErrorEn(null);
    const planos = estado.flatMap(g => g.termos.map(t => ({ g, t })));
    const r = await onConfirmar({
      ClienteCodigo: Number(cliente), Encargado: encargado || null, HoraInicio: inicioHoja, FechaProduccion: fecha,
      Termos: planos.map(({ g, t }) => ({
        RemisionId: g.linea.RemisionId, Lote: g.linea.Lote, Clase: g.linea.Clase, Talla: g.linea.Talla, FechaLote: g.linea.FechaLote,
        NumeroTermo: t.NumeroTermo.trim(), HoraInicio: t.HoraInicio, Quimico: null,
        KgSinTratar: Number(t.Kg), AceptarDiferencia: t.Aceptar,
      })),
    });
    setOcupado(false);
    if (!r) return;   // guardado: el padre cierra
    const fallo = r.Indice != null ? planos[r.Indice] : null;
    // Un termo que pesa un poco más de lo que queda al piso: se pregunta, y si es báscula se reintenta
    // con ese termo aceptado. Nada quedó escrito en el intento anterior.
    if (r.Codigo === "DIFERENCIA" && fallo &&
        await pedirConfirmacion(`${r.error} Si acepta, los ${fmtNum(r.Exceso)} kg de más quedan registrados como diferencia de báscula.`)) {
      const nuevo = estado.map(g => ({ ...g, termos: g.termos.map(t => (t.key === fallo.t.key ? { ...t, Aceptar: true } : t)) }));
      setGrupos(nuevo);
      return guardar(nuevo);
    }
    setErrorEn({ key: fallo?.t.key ?? null, error: r.error });
  };

  return (
    <Marco titulo={`Tratar ${grupos.length} línea${grupos.length !== 1 ? "s" : ""} del piso`} ancho="max-w-5xl" onClose={onCerrar}>
      {/* 1 · Pedido: solo clientes con pedido activo */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <Paso n="1">Pedido del cliente</Paso>
          <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar cliente o pedido…"
            className="ml-auto w-full sm:w-64 border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        {clientes.length === 0 ? (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            No hay pedidos activos. Ponga un pedido en Proceso (Pedidos) para poder tratar.
          </p>
        ) : (
          // Un cliente por renglón: el nombre y, al lado, sus pedidos activos (el texto completo en el
          // title cuando no cabe).
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 max-h-40 overflow-y-auto pr-1">
            {lista.map(c => {
              const activo = cliente === String(c.Codigo);
              const pedidos = c.Pedidos.map(p => `${p.CodigoPedido}${p.Descripcion ? ` ${p.Descripcion}` : ""}`).join(" · ");
              return (
                <button key={c.Codigo} type="button" onClick={() => setCliente(String(c.Codigo))} title={`${c.RazonSocial} — ${pedidos}`}
                  className={`flex min-w-0 items-baseline gap-2 rounded-md border px-2.5 py-1.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                    activo ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600" : "border-gray-200 hover:border-blue-300 hover:bg-gray-50"}`}>
                  <span className={`shrink-0 text-sm font-semibold ${activo ? "text-blue-800" : "text-gray-800"}`}>{c.RazonSocial}</span>
                  <span className="min-w-0 truncate text-xs text-gray-500">{pedidos}</span>
                </button>
              );
            })}
            {lista.length === 0 && <p className="text-sm text-gray-400 px-1 py-2">Ningún pedido activo coincide con "{filtro}".</p>}
          </div>
        )}
        {cliente && (hojaDelCliente ? (
          <p className="text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
            Los termos se suman a la hoja abierta <b>#{hojaDelCliente.HojaId}</b> de este cliente.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-4 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            <p className="text-sm text-green-800 self-center">Se abre una hoja nueva para este cliente.</p>
            <div className="min-w-0">
              <Etiqueta>Encargado</Etiqueta>
              <EmpleadoAutocomplete empleados={empleados} value={encargado} onSelect={setEncargado} />
            </div>
            <div>
              <Etiqueta>Inicio de la hoja</Etiqueta>
              <input type="time" value={inicioHoja} onChange={e => setInicioHoja(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white" />
            </div>
          </div>
        ))}
      </section>

      {/* 2 · Termos: cada línea se reparte en los termos que haga falta */}
      <section className="space-y-3 border-t border-gray-200 pt-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="self-end pb-2"><Paso n="2">Termos</Paso></div>
          <div className="ml-auto">
            <Etiqueta>Inicio trat. (todos)</Etiqueta>
            <input type="time" value={horaComun} onChange={e => { setHoraComun(e.target.value); aTodos("HoraInicio", e.target.value); }}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
        </div>

        {grupos.map(g => {
          const lkey = claveLinea(g.linea);
          const asignado = g.termos.reduce((s, t) => s + (Number(t.Kg) || 0), 0);
          const pasa = asignado - g.linea.Kg;
          return (
            <div key={lkey} className={`rounded-lg border p-3 space-y-2 ${pasa > 0.001 ? "border-red-300 bg-red-50/40" : "border-gray-200 bg-gray-50/60"}`}>
              {/* Lote, avance y kilos en un renglón: la barra es el avance de lo asignado contra lo declarado al piso. */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <div className="min-w-0 shrink-0">
                  <span className="font-mono font-bold text-gray-800">{g.linea.Lote}</span>
                  <span className="block text-xs text-gray-500">{g.linea.Clase} · {g.linea.DescripcionTalla}{g.linea.FechaLote ? ` · prod. ${fmtDia(g.linea.FechaLote)}` : ""}</span>
                </div>
                <div className="min-w-[14rem] flex-1"><BarraTermos alPiso={g.linea.Kg} termos={g.termos} /></div>
                <div className="shrink-0 text-right text-sm leading-tight whitespace-nowrap">
                  <span className={`font-semibold ${pasa > 0.001 ? "text-red-600" : "text-gray-800"}`}>{fmtNum(asignado)}</span>
                  <span className="text-gray-500"> de {fmtNum(g.linea.Kg)} kg</span>
                  <span className={`block text-xs ${pasa > 0.001 ? "font-semibold text-red-600" : "text-gray-400"}`}>
                    {pasa > 0.001 ? `+${fmtNum(pasa)} kg sobre lo del piso` : "declarado al piso"}
                  </span>
                </div>
                {grupos.length > 1 && (
                  <button type="button" onClick={() => quitarLinea(lkey)} title="No tratar esta línea" aria-label="No tratar esta línea"
                    className="shrink-0 text-xs text-gray-400 underline hover:text-red-600">quitar</button>
                )}
              </div>
              {pasa > 0.001 && (
                <p className="text-xs text-red-600">
                  {pasa > tolerancia(g.linea.Kg)
                    ? "Pasa de lo declarado al piso: revise los pesos de los termos."
                    : "Pasa de lo declarado al piso: al guardar se pregunta si es diferencia de báscula."}
                </p>
              )}

              <div className="grid grid-cols-[5.5rem_7.5rem_6.5rem_2rem] items-center gap-x-2 gap-y-1.5 text-sm">
                <span className="text-[11px] uppercase text-gray-400"># Termo</span>
                <span className="text-[11px] uppercase text-gray-400">Kg sin tratar</span>
                <span className="text-[11px] uppercase text-gray-400">Inicio</span>
                <span />
                {g.termos.map(t => {
                  const malo = errorEn?.key === t.key;
                  return (
                    <div key={t.key} className={`contents ${malo ? "[&>*]:ring-2 [&>*]:ring-red-400" : ""}`}>
                      <input value={t.NumeroTermo} onChange={e => editarTermo(lkey, t.key, "NumeroTermo", e.target.value)} placeholder="#"
                        aria-label="Número de termo"
                        className={`w-full rounded border px-2 py-1 font-mono font-semibold ${t.NumeroTermo.trim() ? "border-gray-300 bg-white" : "border-amber-400 bg-amber-50"}`} />
                      <div className="relative">
                        <input type="number" inputMode="decimal" step="0.01" min="0" value={t.Kg} placeholder="pesar"
                          onChange={e => editarTermo(lkey, t.key, "Kg", e.target.value)} aria-label="Kg sin tratar"
                          className={`w-full rounded border py-1 pl-2 pr-7 text-right ${Number(t.Kg) > 0 ? "border-gray-300 bg-white" : "border-amber-400 bg-amber-50"}`} />
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">kg</span>
                      </div>
                      <input type="time" value={t.HoraInicio} onChange={e => editarTermo(lkey, t.key, "HoraInicio", e.target.value)} aria-label="Inicio"
                        className="w-full rounded border border-gray-300 bg-white px-1.5 py-1" />
                      {g.termos.length > 1 ? (
                        <button type="button" onClick={() => quitarTermo(lkey, t.key)} title="Quitar este termo" aria-label="Quitar este termo"
                          className="h-7 w-7 rounded text-lg leading-none text-gray-400 hover:bg-red-50 hover:text-red-600">&times;</button>
                      ) : <span />}
                    </div>
                  );
                })}
              </div>
              <button type="button" onClick={() => agregarTermo(lkey)}
                className="rounded border border-dashed border-cyan-600 px-3 py-1 text-xs font-semibold text-cyan-700 hover:bg-cyan-50">
                + Otro termo
              </button>
            </div>
          );
        })}
      </section>

      {errorEn && <p className="text-sm text-red-600">{errorEn.error} No se guardó nada: corrija y vuelva a intentar.</p>}
      <div className="flex items-center justify-between gap-3 flex-wrap border-t border-gray-200 pt-3">
        <p className="text-sm text-gray-600">
          {todos.length} termo{todos.length !== 1 ? "s" : ""} · <b>{fmtNum(totalKg)} kg</b> a tratar
          {siguenAlPiso > 0.001 && <span className="text-amber-700"> · {fmtNum(siguenAlPiso)} kg siguen al piso</span>}
          {problema && <span className="block text-xs text-gray-400">{problema}</span>}
        </p>
        <Botones texto="Meter a tratamiento" ocupado={ocupado} deshabilitado={!!problema} onCancelar={onCerrar} onAceptar={() => guardar()} />
      </div>
    </Marco>
  );
}

/* ── Salida de varios termos juntos ───────────────────────────────── */
// Los termos que entraron juntos salen juntos (en el papel, de dos o tres a la misma hora): la hora
// y el destino se ponen una vez; los kg tratadas y el conteo final son de cada termo, porque cada uno
// se pesa.
function ModalSalidas({ termos, destinos, destinoSugerido, pickupMaximo, onConfirmar, onCerrar }) {
  const [horaSalida, setHoraSalida] = useState(horaGT());
  const [destino, setDestino] = useState(destinoSugerido || "");
  const [filas, setFilas] = useState(() => termos.map(t => ({ t, ConteoFinal: "", KgTratadas: "" })));
  const [errorEn, setErrorEn] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const set = (id, campo, v) => setFilas(fs => fs.map(f => (f.t.TermoId === id ? { ...f, [campo]: v } : f)));
  const completo = horaSalida && destino && filas.every(f => Number(f.KgTratadas) > 0);
  // Totales de lo que sale junto. El pick-up del total es solo de los termos ya pesados: contar los
  // kg sin tratar de uno que falta pesar se leería como pérdida.
  const totalSin = filas.reduce((s, f) => s + Number(f.t.KgSinTratar || 0), 0);
  const pesados = filas.filter(f => Number(f.KgTratadas) > 0);
  const totalTrat = pesados.reduce((s, f) => s + Number(f.KgTratadas), 0);
  const pTotal = pickupDe(pesados.reduce((s, f) => s + Number(f.t.KgSinTratar || 0), 0), totalTrat);
  const faltan = filas.length - pesados.length;

  return (
    <Marco titulo={`Salida de ${termos.length} termo${termos.length !== 1 ? "s" : ""}`} ancho="max-w-3xl" onClose={onCerrar}>
      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <Etiqueta>Salida trat.</Etiqueta>
          <input type="time" value={horaSalida} onChange={e => setHoraSalida(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
        </div>
        <div className="min-w-[12rem]">
          <Etiqueta>Va a</Etiqueta>
          <select value={destino} onChange={e => setDestino(e.target.value)} className={`${campo} ${destino ? "" : "border-amber-400 bg-amber-50"}`}>
            <option value="">¿A dónde va?…</option>
            {destinos.map(d => <option key={d.Codigo} value={d.Codigo}>{d.Nombre}</option>)}
          </select>
        </div>
      </div>
      <div className="border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="text-left px-2 py-2"># Termo</th><th className="text-left px-2 py-2">Lote</th><th className="text-left px-2 py-2">Entró</th>
              <th className="text-right px-2 py-2">Kg sin tratar</th><th className="text-left px-2 py-2">Conteo fin.</th>
              <th className="text-left px-2 py-2">Kg tratadas</th><th className="text-right px-2 py-2">% Pick-up</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filas.map((f, i) => {
              const p = pickupDe(f.t.KgSinTratar, f.KgTratadas);
              return (
                <tr key={f.t.TermoId} className={errorEn?.Indice === i ? "bg-red-50" : ""}>
                  <td className="px-2 py-1.5 font-mono font-semibold">{f.t.NumeroTermo}</td>
                  <td className="px-2 py-1.5"><span className="font-mono">{f.t.Lote}</span> <span className="text-xs text-gray-500">{f.t.DescripcionTalla}</span></td>
                  <td className="px-2 py-1.5">{hora(f.t.HoraInicio)}</td>
                  <td className="px-2 py-1.5 text-right">{fmtNum(f.t.KgSinTratar)}</td>
                  <td className="px-2 py-1.5">
                    <input type="number" inputMode="numeric" value={f.ConteoFinal} onChange={e => set(f.t.TermoId, "ConteoFinal", e.target.value)}
                      className="w-20 border border-gray-300 rounded px-2 py-1 text-sm" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" inputMode="decimal" step="0.01" value={f.KgTratadas} placeholder="pesar" onChange={e => set(f.t.TermoId, "KgTratadas", e.target.value)}
                      className={`w-24 border rounded px-2 py-1 text-sm ${Number(f.KgTratadas) > 0 ? "border-gray-300" : "border-amber-400 bg-amber-50"}`} />
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap"><Pickup valor={p} alerta={alertaDe(p, pickupMaximo)} /></td>
                </tr>
              );
            })}
          </tbody>
          {filas.length > 1 && (
            <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-semibold text-gray-800">
              <tr>
                <td className="px-2 py-2 text-xs uppercase text-gray-500" colSpan={3}>Total · {filas.length} termos</td>
                <td className="px-2 py-2 text-right whitespace-nowrap">{fmtNum(totalSin)}</td>
                <td />
                <td className="px-2 py-2 whitespace-nowrap">
                  {/* Alineado con el texto de las casillas de arriba (w-24 + px-2). */}
                  <span className="inline-block w-24 px-2">{fmtNum(totalTrat)}</span>
                  {faltan > 0 && <span className="block px-2 text-[11px] font-normal text-amber-700">falta{faltan > 1 ? "n" : ""} {faltan} por pesar</span>}
                </td>
                <td className="px-2 py-2 text-right whitespace-nowrap"><Pickup valor={pTotal} alerta={alertaDe(pTotal, pickupMaximo)} /></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {errorEn && <p className="text-sm text-red-600">{errorEn.error} No se guardó nada: corrija y vuelva a intentar.</p>}
      <Botones texto="Registrar salida" ocupado={ocupado} deshabilitado={!completo} onCancelar={onCerrar}
        onAceptar={async () => {
          setOcupado(true); setErrorEn(null);
          const r = await onConfirmar({
            HoraSalida: horaSalida, BodegaDestino: destino,
            Salidas: filas.map(f => ({ TermoId: f.t.TermoId, KgTratadas: Number(f.KgTratadas), ConteoFinal: f.ConteoFinal === "" ? null : Number(f.ConteoFinal) })),
          });
          setOcupado(false);
          if (r) setErrorEn({ Indice: r.Indice ?? null, error: r.error });
        }} />
    </Marco>
  );
}

/* ── Entrada del termo ────────────────────────────────────────────── */
function ModalEntrada({ linea, termo, quimicos, quimicoSugerido, onConfirmar, onCerrar }) {
  const editando = !!termo;
  const [f, setF] = useState(() => editando ? {
    NumeroTermo: termo.NumeroTermo ?? "", HoraInicio: hora(termo.HoraInicio),
    Quimico: termo.QuimicoCodigo ?? "", KgSinTratar: String(termo.KgSinTratar),
  } : { NumeroTermo: "", HoraInicio: horaGT(), Quimico: quimicoSugerido ?? "", KgSinTratar: "" });
  const [ocupado, setOcupado] = useState(false);
  const set = (k) => (e) => setF(x => ({ ...x, [k]: e.target.value }));
  const base = editando ? termo : linea;
  // Los kg sin tratar se pesan por termo (10 nov 2026), así que se corrigen aquí mientras el termo
  // no haya salido; el servidor revisa que alcance lo del piso.
  const yaSalio = editando && termo.KgTratadas != null;

  return (
    <Marco titulo={editando ? `Corregir termo ${termo.NumeroTermo}` : "Termo nuevo"} onClose={onCerrar}>
      <div className="text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
        <p><span className="font-mono font-bold">{base.Lote}</span> · {base.DescripcionTalla}</p>
        <p className="text-gray-500 text-xs">{base.Clase} {base.DescripcionClase}{base.FechaLote ? ` · prod. ${fmtDia(base.FechaLote)}` : ""}</p>
        {!editando && <p className="text-xs mt-1">Al piso: <b>{fmtNum(linea.Kg)} kg</b></p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Etiqueta># Termo</Etiqueta><input value={f.NumeroTermo} onChange={set("NumeroTermo")} className={campo} autoFocus /></div>
        <div><Etiqueta>Inicio trat.</Etiqueta><input type="time" value={f.HoraInicio} onChange={set("HoraInicio")} className={campo} /></div>
        <div className="col-span-2">
          <Etiqueta>Tipo de químico</Etiqueta>
          <select value={f.Quimico} onChange={set("Quimico")} className={campo}>
            <option value="">—</option>
            {quimicos.map(q => <option key={q.Codigo} value={q.Codigo}>{q.Nombre}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <Etiqueta>Kg sin tratar</Etiqueta>
          <input type="number" inputMode="decimal" step="0.01" value={f.KgSinTratar} onChange={set("KgSinTratar")} disabled={yaSalio}
            className={`${campo} ${yaSalio ? "bg-gray-100" : ""}`} />
          {yaSalio && <p className="text-xs text-gray-400 mt-1">El termo ya salió: para cambiar los kg, quite primero la salida.</p>}
        </div>
      </div>
      <Botones texto={editando ? "Guardar" : "Registrar entrada"} ocupado={ocupado}
        deshabilitado={!f.NumeroTermo.trim() || !f.HoraInicio || !(Number(f.KgSinTratar) > 0)} onCancelar={onCerrar}
        onAceptar={async () => {
          setOcupado(true);
          const datos = { ...f, KgSinTratar: Number(f.KgSinTratar) };
          if (yaSalio) delete datos.KgSinTratar;
          await onConfirmar(datos);
          setOcupado(false);
        }} />
    </Marco>
  );
}

/* ── Salida del termo ─────────────────────────────────────────────── */
function ModalSalida({ termo, destinos, destinoSugerido, pickupMaximo, onConfirmar, onCerrar }) {
  const [f, setF] = useState({
    HoraSalida: hora(termo.HoraSalida) || horaGT(), ConteoFinal: termo.ConteoFinal ?? "",
    KgTratadas: termo.KgTratadas != null ? String(termo.KgTratadas) : "",
    BodegaDestino: termo.BodegaDestino || destinoSugerido || "",
  });
  const [ocupado, setOcupado] = useState(false);
  const set = (k) => (e) => setF(x => ({ ...x, [k]: e.target.value }));
  const p = pickupDe(termo.KgSinTratar, f.KgTratadas);
  const alerta = alertaDe(p, pickupMaximo);

  return (
    <Marco titulo={`Salida del termo ${termo.NumeroTermo}`} onClose={onCerrar}>
      <div className="text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
        <p><span className="font-mono font-bold">{termo.Lote}</span> · {termo.DescripcionTalla}</p>
        <p className="text-xs text-gray-500">Entró a las {hora(termo.HoraInicio)} con <b>{fmtNum(termo.KgSinTratar)} kg</b> sin tratar</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Etiqueta>Salida trat.</Etiqueta><input type="time" value={f.HoraSalida} onChange={set("HoraSalida")} className={campo} /></div>
        <div><Etiqueta>Conteo final</Etiqueta><input type="number" inputMode="numeric" value={f.ConteoFinal} onChange={set("ConteoFinal")} className={campo} /></div>
        <div><Etiqueta>Kg tratadas</Etiqueta><input type="number" inputMode="decimal" step="0.01" value={f.KgTratadas} onChange={set("KgTratadas")} className={campo} autoFocus /></div>
        <div>
          <Etiqueta>Va a</Etiqueta>
          <select value={f.BodegaDestino} onChange={set("BodegaDestino")} className={`${campo} ${f.BodegaDestino ? "" : "border-amber-400 bg-amber-50"}`}>
            <option value="">¿A dónde va?…</option>
            {destinos.map(d => <option key={d.Codigo} value={d.Codigo}>{d.Nombre}</option>)}
          </select>
        </div>
      </div>
      <div className="flex items-center justify-between border-t pt-3">
        <span className="text-sm text-gray-600">% Pick-up</span>
        <Pickup valor={p} alerta={alerta} grande />
      </div>
      {alerta === "PERDIDA" && <p className="text-xs text-red-600">Sale pesando menos de lo que entró. Se registra tal cual, como alerta: revise tiempo y dosis.</p>}
      {alerta === "EXCEDE" && <p className="text-xs text-amber-700">Pasa del máximo de {pickupMaximo} %. Se registra, pero conviene revisar el peso o la dosis.</p>}
      <Botones texto="Registrar salida" ocupado={ocupado}
        deshabilitado={!f.HoraSalida || !(Number(f.KgTratadas) > 0) || !f.BodegaDestino} onCancelar={onCerrar}
        onAceptar={async () => {
          setOcupado(true);
          await onConfirmar({ ...f, ConteoFinal: f.ConteoFinal === "" ? null : Number(f.ConteoFinal), KgTratadas: Number(f.KgTratadas) });
          setOcupado(false);
        }} />
    </Marco>
  );
}

/* ── Cerrar la hoja ───────────────────────────────────────────────── */
// La diferencia de báscula la decide el encargado: lo que queda al piso de un lote que ya se
// terminó se da por terminado y queda registrado como diferencia. Viene marcado si es poco (hasta
// 2 kg o el 3 % de lo tomado); lo demás se deja al piso salvo que el encargado lo marque.
function ModalCerrar({ hoja, onConfirmar, onCerrar }) {
  const ultima = hoja.Termos.map(t => hora(t.HoraSalida)).filter(Boolean).sort().pop() || horaGT();
  const [fin, setFin] = useState(ultima);
  const pendientes = hoja.Lineas.filter(l => l.KgAlPiso > 0.001);
  const [marcadas, setMarcadas] = useState(() =>
    new Set(pendientes.filter(l => l.KgAlPiso <= Math.max(2, l.KgTomado * 0.03)).map(l => l.Clave)));
  const [ocupado, setOcupado] = useState(false);
  const enTermo = hoja.Termos.filter(t => t.KgTratadas == null);
  const t = hoja.Totales;

  return (
    <Marco titulo={`Cerrar hoja #${hoja.HojaId}`} ancho="max-w-xl" onClose={onCerrar}>
      {enTermo.length > 0 ? (
        <p className="text-sm text-red-600">Falta la salida de {enTermo.length} termo{enTermo.length > 1 ? "s" : ""}: {enTermo.map(x => x.NumeroTermo).join(", ")}.</p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2 text-center text-sm">
            <div><p className="text-xs text-gray-500">Recibidos</p><p className="font-semibold">{fmtNum(t.KgRecibidos)}</p></div>
            <div><p className="text-xs text-gray-500">Tratados</p><p className="font-semibold">{fmtNum(t.KgTratados)}</p></div>
            <div><p className="text-xs text-gray-500">Ganados</p><p className="font-semibold">{fmtNum(t.KgGanados)}</p></div>
            <div><p className="text-xs text-gray-500">Pick-up</p><Pickup valor={t.Pickup} alerta={t.Alerta} /></div>
          </div>
          <div>
            <Etiqueta>Hora fin</Etiqueta>
            <input type="time" value={fin} onChange={e => setFin(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
            <p className="text-xs text-gray-400 mt-1">Las personas se cuentan del marcaje del área dentro del horario de la hoja.</p>
          </div>
          {pendientes.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1">Lotes que todavía tienen kilos al piso</p>
              <p className="text-xs text-gray-500 mb-2">Marque los que ya se terminaron: lo que queda es diferencia de báscula y sale del piso. Los que no marque siguen al piso para otra hoja.</p>
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                {pendientes.map(l => {
                  const pct = l.KgTomado > 0 ? (l.KgAlPiso / l.KgTomado) * 100 : 0;
                  return (
                    <label key={l.Clave} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={marcadas.has(l.Clave)}
                        onChange={e => setMarcadas(s => { const n = new Set(s); e.target.checked ? n.add(l.Clave) : n.delete(l.Clave); return n; })} />
                      <span className="flex-1 min-w-0 truncate"><span className="font-mono">{l.Lote}</span> · {l.Clase} · {l.DescripcionTalla}</span>
                      <span className={`whitespace-nowrap ${pct > 3 ? "text-amber-700 font-semibold" : "text-gray-600"}`}>
                        {fmtNum(l.KgAlPiso)} kg <span className="text-xs">({fmtNum(pct, 1)} % de lo tomado)</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
      <Botones texto="Cerrar hoja" ocupado={ocupado} deshabilitado={enTermo.length > 0} onCancelar={onCerrar}
        onAceptar={async () => { setOcupado(true); await onConfirmar({ HoraFin: fin, Terminar: [...marcadas] }); setOcupado(false); }} />
    </Marco>
  );
}

/* ── Inventario al piso de Tratamiento ────────────────────────────── */
// Se marca lo que se va a tratar (una línea, varias o todas) y "Tratar" abre la captura con el
// cliente. Ya no hace falta abrir la hoja antes.
function InventarioPiso({ saldo, puedeTratar, marcadas, setMarcadas, onTratar }) {
  const total = saldo.reduce((s, l) => s + l.Kg, 0);
  const sel = saldo.filter(l => marcadas.has(claveLinea(l)));
  const kgSel = sel.reduce((s, l) => s + l.Kg, 0);
  const todas = saldo.length > 0 && sel.length === saldo.length;
  const alternar = (l) => setMarcadas(m => { const n = new Set(m); const k = claveLinea(l); n.has(k) ? n.delete(k) : n.add(k); return n; });
  return (
    <div className="bg-white border border-gray-300 rounded-lg">
      <div className="px-4 py-2.5 border-b flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-gray-800">Inventario al piso de Tratamiento</h2>
        <span className="text-xs text-gray-500">{saldo.length} línea{saldo.length !== 1 ? "s" : ""} · {fmtNum(total)} kg</span>
        {puedeTratar && saldo.length > 0 && (
          <button onClick={() => onTratar(sel)} disabled={!sel.length}
            className="ml-auto bg-blue-600 text-white rounded px-3 py-1.5 text-xs font-semibold hover:bg-blue-700 disabled:opacity-40">
            {sel.length ? `Tratar (${sel.length} línea${sel.length !== 1 ? "s" : ""} · ${fmtNum(kgSel)} kg)` : "Marque lo que va a tratar"}
          </button>
        )}
      </div>
      {saldo.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-gray-400">No hay producto al piso. Llega al cerrar las transacciones de Pelado con destino Tratamiento.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                {puedeTratar && (
                  <th className="px-3 py-2 w-8">
                    <input type="checkbox" checked={todas} title="Marcar todo"
                      onChange={e => setMarcadas(e.target.checked ? new Set(saldo.map(claveLinea)) : new Set())} />
                  </th>
                )}
                <th className="text-left px-3 py-2">Lote</th><th className="text-left px-3 py-2">Clase</th>
                <th className="text-left px-3 py-2">Talla</th><th className="text-left px-3 py-2">Prod.</th>
                <th className="text-right px-3 py-2">Días al piso</th><th className="text-right px-3 py-2">Kg</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {saldo.map(l => {
                const k = claveLinea(l);
                return (
                  <tr key={k} onClick={puedeTratar ? () => alternar(l) : undefined}
                    className={`${puedeTratar ? "cursor-pointer hover:bg-gray-50" : ""} ${marcadas.has(k) ? "bg-blue-50" : ""}`}>
                    {puedeTratar && (
                      <td className="px-3 py-1.5"><input type="checkbox" checked={marcadas.has(k)} onChange={() => alternar(l)} onClick={e => e.stopPropagation()} /></td>
                    )}
                    <td className="px-3 py-1.5 font-mono whitespace-nowrap">{l.Lote}</td>
                    <td className="px-3 py-1.5"><span className="font-semibold">{l.Clase}</span> <span className="text-xs text-gray-500">{l.DescripcionClase}</span></td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{l.DescripcionTalla}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-gray-500">{fmtDia(l.FechaLote)}</td>
                    <td className={`px-3 py-1.5 text-right ${l.DiasAlPiso > 2 ? "text-amber-700 font-semibold" : ""}`}>{l.DiasAlPiso ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right font-semibold whitespace-nowrap">{fmtNum(l.Kg)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Los termos de la hoja ────────────────────────────────────────── */
// Los termos sin salida se marcan para sacarlos juntos ("Registrar salida"); "Corregir salida" sigue
// siendo de uno en uno.
function TablaTermos({ hoja, abierta, puedeCrear, puedeEditar, puedeBorrar, onSalidas, onCorregirSalida, onEditar, onQuitarSalida, onBorrar }) {
  const [marcados, setMarcados] = useState(new Set());
  const pendientes = hoja.Termos.filter(t => t.KgTratadas == null);
  const marcables = abierta && puedeCrear && pendientes.length > 0;
  const sel = pendientes.filter(t => marcados.has(t.TermoId));
  useEffect(() => { setMarcados(new Set()); }, [hoja]);
  const alternar = (id) => setMarcados(m => { const n = new Set(m); n.has(id) ? n.delete(id) : n.add(id); return n; });
  if (!hoja.Termos.length) {
    return <div className="bg-white border border-gray-300 rounded-lg px-4 py-6 text-center text-sm text-gray-400">
      Sin termos todavía. Marque lo del inventario al piso y use "Tratar".
    </div>;
  }
  return (
    <div className="bg-white border border-gray-300 rounded-lg overflow-x-auto">
      {marcables && (
        <div className="px-3 py-2 border-b flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">{pendientes.length} termo{pendientes.length !== 1 ? "s" : ""} sin salida</span>
          <button onClick={() => onSalidas(sel)} disabled={!sel.length}
            className="ml-auto bg-blue-600 text-white rounded px-3 py-1.5 text-xs font-semibold hover:bg-blue-700 disabled:opacity-40">
            {sel.length ? `Registrar salida (${sel.length})` : "Marque los termos que salen"}
          </button>
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
          <tr>
            {marcables && (
              <th className="px-2 py-2 w-8">
                <input type="checkbox" title="Marcar todos los que no han salido" checked={sel.length === pendientes.length}
                  onChange={e => setMarcados(e.target.checked ? new Set(pendientes.map(t => t.TermoId)) : new Set())} />
              </th>
            )}
            <th className="text-left px-2 py-2"># Termo</th><th className="text-left px-2 py-2">Lote</th><th className="text-left px-2 py-2">Talla</th>
            <th className="text-left px-2 py-2">Inicio</th><th className="text-left px-2 py-2">Salida</th>
            <th className="text-right px-2 py-2">Conteo fin.</th>
            <th className="text-left px-2 py-2">Tiempo</th><th className="text-left px-2 py-2">Químico</th><th className="text-left px-2 py-2">Corte</th>
            <th className="text-right px-2 py-2">Kg sin tratar</th><th className="text-right px-2 py-2">Kg tratadas</th>
            <th className="text-right px-2 py-2">% Pick-up</th><th className="text-left px-2 py-2">Va a</th><th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {hoja.Termos.map(t => (
            <tr key={t.TermoId} className={t.Alerta === "PERDIDA" ? "bg-red-50" : t.Alerta === "EXCEDE" ? "bg-amber-50" : t.KgTratadas == null ? "bg-blue-50/40" : ""}>
              {marcables && (
                <td className="px-2 py-1.5">
                  {t.KgTratadas == null && <input type="checkbox" checked={marcados.has(t.TermoId)} onChange={() => alternar(t.TermoId)} />}
                </td>
              )}
              <td className="px-2 py-1.5 font-mono font-semibold">{t.NumeroTermo}</td>
              <td className="px-2 py-1.5 font-mono whitespace-nowrap">{t.Lote}</td>
              <td className="px-2 py-1.5 whitespace-nowrap">{t.DescripcionTalla}</td>
              <td className="px-2 py-1.5">{hora(t.HoraInicio)}</td>
              <td className="px-2 py-1.5">{hora(t.HoraSalida) || <span className="text-blue-600 text-xs">en termo</span>}</td>
              <td className="px-2 py-1.5 text-right">{t.ConteoFinal ?? "—"}</td>
              <td className="px-2 py-1.5 whitespace-nowrap">{fmtTiempo(t.Minutos)}</td>
              <td className="px-2 py-1.5">{t.NombreQuimico || "—"}</td>
              <td className="px-2 py-1.5 text-xs text-gray-600 max-w-[10rem] truncate" title={t.DescripcionClase}>{t.Clase} {t.DescripcionClase}</td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap">
                {fmtNum(t.KgSinTratar)}
                {t.KgDiferencia ? <span className="block text-[10px] text-gray-400" title="Diferencia de báscula aceptada al registrar">+{fmtNum(t.KgDiferencia)} dif.</span> : null}
              </td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap">{t.KgTratadas != null ? fmtNum(t.KgTratadas) : "—"}</td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap"><Pickup valor={t.Pickup} alerta={t.Alerta} /></td>
              <td className="px-2 py-1.5 whitespace-nowrap">{t.NombreDestino || "—"}</td>
              <td className="px-2 py-1.5 whitespace-nowrap text-right space-x-1">
                {abierta && puedeCrear && (
                  <button onClick={() => (t.KgTratadas == null ? onSalidas([t]) : onCorregirSalida(t))}
                    className={`text-xs font-semibold rounded px-2 py-1 border ${t.KgTratadas == null ? "bg-blue-600 text-white border-blue-600 hover:bg-blue-700" : "text-blue-700 border-blue-300 hover:bg-blue-50"}`}>
                    {t.KgTratadas == null ? "Salida" : "Corregir salida"}
                  </button>
                )}
                {abierta && puedeEditar && <button onClick={() => onEditar(t)} className="text-xs text-gray-600 border border-gray-300 rounded px-2 py-1 hover:bg-gray-50">Editar</button>}
                {abierta && puedeEditar && t.KgTratadas != null && (
                  <button onClick={() => onQuitarSalida(t)} className="text-xs text-amber-700 border border-amber-300 rounded px-2 py-1 hover:bg-amber-50">Quitar salida</button>
                )}
                {abierta && puedeBorrar && <button onClick={() => onBorrar(t)} className="text-xs text-red-600 border border-red-200 rounded px-2 py-1 hover:bg-red-50">Quitar</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Totales({ t, pickupMaximo }) {
  return (
    <div className="bg-white border border-gray-300 rounded-lg px-4 py-3">
      <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Totales del turno</p>
      <div className={`grid grid-cols-2 gap-3 ${t.KgEnTermo > 0.001 ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
        <div><p className="text-xs text-gray-500">Kg recibidos</p><p className="text-xl font-semibold">{fmtNum(t.KgRecibidos)}</p></div>
        {/* Ganados y pick-up son de lo que ya salió: lo que sigue en el termo va aparte o "recibidos"
            contra "tratados" se lee como pérdida. */}
        {t.KgEnTermo > 0.001 && <div><p className="text-xs text-gray-500">En termo</p><p className="text-xl font-semibold text-blue-700">{fmtNum(t.KgEnTermo)}</p></div>}
        <div><p className="text-xs text-gray-500">Kg tratados</p><p className="text-xl font-semibold">{fmtNum(t.KgTratados)}</p></div>
        <div><p className="text-xs text-gray-500">Kg ganados</p><p className={`text-xl font-semibold ${t.KgGanados < 0 ? "text-red-600" : ""}`}>{fmtNum(t.KgGanados)}</p></div>
        <div><p className="text-xs text-gray-500">% Pick-up</p><Pickup valor={t.Pickup} alerta={t.Alerta} grande /></div>
      </div>
      <p className="text-xs text-gray-400 mt-2">
        Pick-up = (tratadas − sin tratar) ÷ sin tratar, de los termos que ya salieron. Alerta si es negativo o pasa de {pickupMaximo} %.
        {t.EnTermo > 0 ? ` ${t.EnTermo} termo${t.EnTermo > 1 ? "s" : ""} todavía en termo.` : ""}
        {t.Alertas > 0 ? ` ${t.Alertas} termo${t.Alertas > 1 ? "s" : ""} con alerta.` : ""}
      </p>
    </div>
  );
}

/* ── Insumos (solo el consumo) ────────────────────────────────────── */
function Insumos({ hoja, editable, onGuardar }) {
  const inicial = useMemo(() => Object.fromEntries(hoja.Insumos.map(i => [i.Codigo, i.Cantidad ?? ""])), [hoja]);
  const [valores, setValores] = useState(inicial);
  useEffect(() => setValores(inicial), [inicial]);
  const cambiado = hoja.Insumos.some(i => String(valores[i.Codigo] ?? "") !== String(inicial[i.Codigo] ?? ""));
  return (
    <div className="bg-white border border-gray-300 rounded-lg px-4 py-3">
      <div className="flex items-center mb-2">
        <p className="text-xs font-semibold text-gray-500 uppercase">Insumos — consumo de la hoja</p>
        {editable && cambiado && (
          <button onClick={() => onGuardar(hoja.Insumos.map(i => ({ Codigo: i.Codigo, Cantidad: valores[i.Codigo] })))}
            className="ml-auto text-xs font-semibold bg-blue-600 text-white rounded px-3 py-1 hover:bg-blue-700">Guardar insumos</button>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {hoja.Insumos.map(i => (
          <div key={i.Codigo}>
            <Etiqueta>{i.Nombre} ({i.UM.toLowerCase()})</Etiqueta>
            {editable ? (
              <input type="number" inputMode="decimal" step="0.01" min="0" value={valores[i.Codigo] ?? ""}
                onChange={e => setValores(v => ({ ...v, [i.Codigo]: e.target.value }))} className={campo} />
            ) : <p className="text-sm font-semibold">{i.Cantidad != null ? fmtNum(i.Cantidad) : "—"}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TratamientoPage() {
  const puedeCrear  = usePuede("tratamiento", "crear");
  const puedeEditar = usePuede("tratamiento", "editar");
  const puedeCerrar = usePuede("tratamiento", "cerrar");
  const puedeBorrar = usePuede("tratamiento", "eliminar");
  const { aviso, mostrarAlerta, pedirConfirmacion, cerrar } = useAviso();

  const [fecha, setFecha] = useState(hoyGT());
  const [hojas, setHojas] = useState([]);
  const [selId, setSelId] = useState(null);
  const [sel, setSel] = useState(null);
  const [saldo, setSaldo] = useState([]);
  const [cat, setCat] = useState({ Destinos: [], Insumos: [], Clientes: [], PickupMaximo: 20 });
  const [empleados, setEmpleados] = useState([]);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null);   // { tipo: "nueva" | "entrada" | "editar" | "salida" | "cerrar", ... }
  const [imprimir, setImprimir] = useState(false);   // la hoja seleccionada, para imprimir / PDF
  const [reporte, setReporte] = useState(false);     // el reporte de la jornada completa
  const [marcadas, setMarcadas] = useState(new Set());   // líneas del piso marcadas para tratar

  const quimicos = cat.Insumos.filter(i => i.EsQuimico);

  const fetchHojas = useCallback(async () => {
    try {
      const res = await fetch(`${API}/hojas?fecha=${fecha}`, { headers: authHeader() });
      const data = await leerJSON(res);
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setHojas(Array.isArray(data) ? data : []);
      setError("");
    } catch (e) { setHojas([]); setError(e.message || "No se pudo conectar con el servidor"); }
  }, [fecha]);

  const fetchSaldo = useCallback(async () => {
    const res = await fetch(`${API}/saldo`, { headers: authHeader() });
    const data = await leerJSON(res);
    setSaldo(Array.isArray(data) ? data : []);
  }, []);

  const abrirDetalle = useCallback(async (id) => {
    setSelId(id);
    const res = await fetch(`${API}/hojas/${id}`, { headers: authHeader() });
    const data = await leerJSON(res);
    if (!res.ok) { setSel(null); setError(data.error || "No se pudo abrir la hoja"); return; }
    setSel(data);
  }, []);

  useEffect(() => { fetchHojas(); fetchSaldo(); }, [fetchHojas, fetchSaldo]);
  useEffect(() => {
    fetch(`${API}/catalogos`, { headers: authHeader() }).then(leerJSON).then(d => d?.Destinos && setCat(d));
    fetch("/api/empleados", { headers: authHeader() }).then(leerJSON).then(d => Array.isArray(d) && setEmpleados(d.filter(e => e.Estado === "Activo")));
  }, []);
  // Con una sola hoja se abre sola; si la seleccionada ya no es de la jornada, se suelta.
  useEffect(() => {
    if (hojas.length === 1 && selId !== hojas[0].HojaId) abrirDetalle(hojas[0].HojaId);
    if (selId != null && !hojas.some(h => h.HojaId === selId)) { setSel(null); setSelId(null); }
  }, [hojas, selId, abrirDetalle]);

  const enviar = async (url, body, metodo = "POST") => {
    const res = await fetch(url, { method: metodo, headers: { "Content-Type": "application/json", ...authHeader() },
                                   body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await leerJSON(res);
    return { ok: res.ok, status: res.status, data };
  };
  const recargar = async (id = sel?.HojaId) => {
    await Promise.all([fetchHojas(), fetchSaldo()]);
    if (id) await abrirDetalle(id);
  };
  const conAviso = async (r) => {
    if (!r.ok) { await mostrarAlerta(r.data.error || `Error ${r.status}`); return false; }
    return true;
  };

  const abierta = sel?.Estatus === "Abierta";
  // El destino de la salida se sugiere del termo anterior de la hoja: casi siempre es el mismo en
  // todo el turno ("〃" en el papel).
  const destinoSugerido = [...(sel?.Termos ?? [])].reverse().find(t => t.BodegaDestino)?.BodegaDestino
    ?? cat.Destinos.find(d => d.Codigo === "TUNEL")?.Codigo ?? "";

  // Devuelve null si se guardó; si no, el error (con el renglón que falló) para que el modal lo marque.
  const tratar = async (datos) => {
    const r = await enviar(`${API}/tratar`, datos);
    if (!r.ok) return { error: r.data.error || `Error ${r.status}`, ...r.data };
    setModal(null);
    setMarcadas(new Set());
    await recargar(r.data.HojaId);
    return null;
  };

  const registrarSalidas = async (datos) => {
    const r = await enviar(`${API}/salidas`, datos);
    if (!r.ok) return { error: r.data.error || `Error ${r.status}`, ...r.data };
    setModal(null);
    await recargar();
    return null;
  };

  const editarEntrada = async (termo, datos) => {
    if (!(await conAviso(await enviar(`${API}/termos/${termo.TermoId}`, datos, "PUT")))) return;
    setModal(null);
    await recargar();
  };

  const registrarSalida = async (termo, datos) => {
    const r = await enviar(`${API}/termos/${termo.TermoId}/salida`, datos, "PUT");
    if (!(await conAviso(r))) return;
    setModal(null);
    await recargar();
  };

  const quitarSalida = async (termo) => {
    if (!(await pedirConfirmacion(`¿Quitar la salida del termo ${termo.NumeroTermo}? Lo tratado sale del piso de ${termo.NombreDestino} y el termo vuelve a quedar en termo.`))) return;
    if (await conAviso(await enviar(`${API}/termos/${termo.TermoId}/salida`, undefined, "DELETE"))) await recargar();
  };

  const borrarTermo = async (termo) => {
    if (!(await pedirConfirmacion(`¿Quitar el termo ${termo.NumeroTermo}? Sus ${fmtNum(termo.KgSinTratar)} kg vuelven al inventario al piso de Tratamiento.`))) return;
    if (await conAviso(await enviar(`${API}/termos/${termo.TermoId}`, undefined, "DELETE"))) await recargar();
  };

  const guardarInsumos = async (lista) => {
    if (await conAviso(await enviar(`${API}/hojas/${sel.HojaId}/insumos`, { Insumos: lista }, "PUT"))) await recargar();
  };

  const cambiarCliente = async (codigo) => {
    if (await conAviso(await enviar(`${API}/hojas/${sel.HojaId}`, { ClienteCodigo: Number(codigo) }, "PUT"))) await recargar();
  };

  const cerrarHoja = async (datos) => {
    if (!(await conAviso(await enviar(`${API}/hojas/${sel.HojaId}/cerrar`, datos)))) return;
    setModal(null);
    await recargar();
    // Cerrar es el momento de sacar el papel: la vista previa se abre sola, ya con los totales finales.
    setImprimir(true);
  };

  const reabrirHoja = async () => {
    if (!(await pedirConfirmacion("Se va a reabrir la hoja. Las diferencias de báscula que dejó el cierre se borran y esos kilos vuelven al piso."))) return;
    if (await conAviso(await enviar(`${API}/hojas/${sel.HojaId}/reabrir`, {}))) await recargar();
  };

  const eliminarHoja = async () => {
    if (!(await pedirConfirmacion(`¿Eliminar la hoja #${sel.HojaId}? Está vacía.`))) return;
    if (!(await conAviso(await enviar(`${API}/hojas/${sel.HojaId}`, undefined, "DELETE")))) return;
    setSel(null); setSelId(null);
    await recargar(null);
  };

  return (
    <div className="space-y-4">
      {aviso && <AvisoModal {...aviso} onCerrar={() => cerrar(true)} onCancelar={() => cerrar(false)} />}
      {modal?.tipo === "tratar" && (
        <ModalTratar lineas={modal.lineas} fecha={fecha} hojas={hojas} clientes={cat.Clientes} empleados={empleados}
          pedirConfirmacion={pedirConfirmacion}
          onConfirmar={tratar} onCerrar={() => setModal(null)} />
      )}
      {modal?.tipo === "salidas" && (
        <ModalSalidas termos={modal.termos} destinos={cat.Destinos} destinoSugerido={destinoSugerido} pickupMaximo={cat.PickupMaximo}
          onConfirmar={registrarSalidas} onCerrar={() => setModal(null)} />
      )}
      {modal?.tipo === "editar" && (
        <ModalEntrada termo={modal.termo} quimicos={quimicos} onConfirmar={d => editarEntrada(modal.termo, d)} onCerrar={() => setModal(null)} />
      )}
      {modal?.tipo === "salida" && (
        <ModalSalida termo={modal.termo} destinos={cat.Destinos} destinoSugerido={destinoSugerido} pickupMaximo={cat.PickupMaximo}
          onConfirmar={d => registrarSalida(modal.termo, d)} onCerrar={() => setModal(null)} />
      )}
      {modal?.tipo === "cerrar" && sel && <ModalCerrar hoja={sel} onConfirmar={cerrarHoja} onCerrar={() => setModal(null)} />}
      {imprimir && sel && <HojaTratamientoModal hoja={sel} pickupMaximo={cat.PickupMaximo} onCerrar={() => setImprimir(false)} />}
      {reporte && <ReporteTratamientoModal fecha={fecha} onCerrar={() => setReporte(false)} />}

      <div className="bg-white border border-gray-300 rounded-lg px-4 py-3 flex flex-wrap items-center gap-3">
        <h1 className="font-bold text-gray-800">Tratamiento de Camarón</h1>
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-gray-600">Jornada</label>
          <input type="date" value={fecha} onChange={e => { setFecha(e.target.value); setSel(null); setSelId(null); }}
            className="border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>
        <button onClick={() => recargar()} className="border border-gray-300 rounded px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50">Actualizar</button>
        {/* El reporte es del DÍA (todas las hojas), no de una: por eso vive en la barra de la jornada. */}
        <button onClick={() => setReporte(true)} className="border border-blue-300 text-blue-700 rounded px-3 py-1.5 text-xs font-semibold hover:bg-blue-50">
          Reporte del día
        </button>

      </div>

      {error && <div className="bg-red-50 border border-red-300 text-red-700 text-sm px-4 py-2 rounded">⚠ {error}</div>}

      <InventarioPiso saldo={saldo} puedeTratar={puedeCrear} marcadas={marcadas} setMarcadas={setMarcadas}
        onTratar={lineas => setModal({ tipo: "tratar", lineas })} />

      {hojas.length > 0 ? (
        <div className="bg-white border border-gray-300 rounded-lg px-4 py-2 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-gray-500 uppercase mr-1">Hojas de la jornada</span>
          {hojas.map(h => (
            <button key={h.HojaId} onClick={() => abrirDetalle(h.HojaId)}
              className={`rounded px-3 py-1 text-xs font-semibold border ${selId === h.HojaId ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
              #{h.HojaId} · {h.NombreCliente || "sin cliente"} · {h.Termos} termo{h.Termos !== 1 ? "s" : ""}
              <span className={`ml-1.5 font-normal ${h.Estatus === "Abierta" ? "text-green-500" : "opacity-60"}`}>{h.Estatus}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="bg-white border border-gray-300 rounded-lg px-4 py-8 text-center text-gray-400 text-sm">
          Sin hojas de tratamiento el {fmtDia(fecha)}. Marque lo del inventario al piso y use "Tratar": la hoja del cliente se abre sola.
        </div>
      )}

      {sel && (
        <div className="space-y-3">
          <div className="bg-gray-800 text-white rounded-lg px-4 py-3 flex flex-wrap items-center gap-4">
            <div className="min-w-0">
              <h2 className="font-bold">Hoja #{sel.HojaId} · {sel.NombreCliente || "sin cliente"}</h2>
              <p className="text-gray-300 text-xs mt-0.5">
                {[fmtDia(sel.FechaProduccion), sel.NombreEncargado || sel.Encargado,
                  sel.HoraInicio ? `inicio ${hora(sel.HoraInicio)}` : null, sel.HoraFin ? `fin ${hora(sel.HoraFin)}` : null,
                  sel.Personas != null ? `${sel.Personas} persona${sel.Personas !== 1 ? "s" : ""}` : null,
                  sel.Estatus].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button onClick={() => setImprimir(true)}
                title={abierta ? "Se imprime como borrador: la hoja sigue abierta" : "Imprimir o guardar como PDF"}
                className="border border-gray-500 rounded px-4 py-1.5 text-sm font-semibold hover:bg-gray-700">
                Imprimir
              </button>
              {abierta && puedeEditar && (
                <select value={sel.ClienteCodigo ?? ""} onChange={e => cambiarCliente(e.target.value)} title="Cliente previsto"
                  className="bg-gray-700 border border-gray-500 rounded px-2 py-1 text-xs max-w-[14rem]">
                  {!cat.Clientes.some(c => c.Codigo === sel.ClienteCodigo) && sel.ClienteCodigo != null && (
                    <option value={sel.ClienteCodigo}>{sel.NombreCliente} (sin pedido activo)</option>
                  )}
                  {cat.Clientes.map(c => <option key={c.Codigo} value={c.Codigo}>{c.RazonSocial}</option>)}
                </select>
              )}
              {abierta && puedeBorrar && sel.Termos.length === 0 && (
                <button onClick={eliminarHoja} className="border border-gray-500 rounded px-3 py-1.5 text-sm hover:bg-gray-700">Eliminar</button>
              )}
              {abierta && puedeCerrar && (
                <button onClick={() => setModal({ tipo: "cerrar" })} className="bg-green-600 rounded px-4 py-1.5 text-sm font-semibold hover:bg-green-700">Cerrar hoja</button>
              )}
              {!abierta && puedeCerrar && (
                <button onClick={reabrirHoja} className="bg-amber-600 rounded px-4 py-1.5 text-sm font-semibold hover:bg-amber-700">Reabrir</button>
              )}
            </div>
          </div>

          <Totales t={sel.Totales} pickupMaximo={cat.PickupMaximo} />
          <TablaTermos hoja={sel} abierta={abierta} puedeCrear={puedeCrear} puedeEditar={puedeEditar} puedeBorrar={puedeBorrar}
            onSalidas={ts => setModal({ tipo: "salidas", termos: ts })} onCorregirSalida={t => setModal({ tipo: "salida", termo: t })}
            onEditar={t => setModal({ tipo: "editar", termo: t })}
            onQuitarSalida={quitarSalida} onBorrar={borrarTermo} />
          <Insumos hoja={sel} editable={abierta && puedeEditar} onGuardar={guardarInsumos} />

          {!abierta && sel.Lineas.some(l => l.KgDiferencia > 0) && (
            <div className="bg-white border border-gray-300 rounded-lg px-4 py-3 text-sm">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Diferencias de báscula al cerrar</p>
              {sel.Lineas.filter(l => l.KgDiferencia > 0).map(l => (
                <p key={l.Clave}><span className="font-mono">{l.Lote}</span> · {l.Clase} · {l.DescripcionTalla ?? l.Talla}: <b>{fmtNum(l.KgDiferencia)} kg</b></p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
