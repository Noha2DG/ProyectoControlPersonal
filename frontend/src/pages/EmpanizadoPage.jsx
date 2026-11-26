import { Fragment, useState, useEffect, useMemo, useCallback } from "react";
import { authHeader, usePuede } from "../context/AuthContext.jsx";
import { exportarProduccionEmpanizado } from "../utils/exportExcel.js";
import { calcularLbHora, totalLbHora, LB_POR_KG } from "../utils/destajo.js";

// Empanizado (#/empanizado, 20 nov 2026). Para el encargado o chequeador de Empanizado:
//   Al piso          lo que mandó Tratamiento (ya con el pick-up): se escoge y se TOMA → nace el lote.
//   Lotes abiertos   lo tomado, lo bajado, el descarte y lo pesado en la báscula por producto y
//                    destino (exportación / venta local). La ganancia por la harina se mide, sin meta.
//                    Al cerrar, lo pesado pasa al piso de Túnel.
//   Cerrados         consulta y reabrir (si Túnel no lo ha usado).
//   Producción       bandejas y kilos por persona con su mesa y posición: base del pago de
//                    Empanizado, aparte del de Pelado.
// El personal (mesas, bandas y posiciones) NO se maneja aquí: Catálogos → Mesas de Empanizado.

const API = "/api/empanizado";
const hoyGT = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
const kg = (n, d = 2) => (n == null ? "—" : Number(n).toLocaleString("es-GT", { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (n) => (n == null ? "—" : `${n > 0 ? "+" : ""}${Number(n).toLocaleString("es-GT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`);
const titulo = s => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase().replace(/(^|\s)\p{L}/gu, c => c.toUpperCase());
const DESTINO = { EXPORTACION: { txt: "Exportación", cls: "bg-blue-100 text-blue-800" }, LOCAL: { txt: "Venta local", cls: "bg-orange-100 text-orange-800" } };
const TIPO_MOV = { TOMA_EMPANIZADO: "Tomado del piso", BAJADO: "Bajado al piso", DESCARTE: "Descarte", PROCESADO: "Trasladado a Túnel" };
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
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white">
          <h2 className="text-base font-semibold text-gray-800">{t}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

const Aviso = ({ tipo = "error", children }) => !children ? null : (
  <div className={`mb-3 rounded-lg border px-3 py-2 text-sm ${tipo === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-700"}`}>{children}</div>
);

export default function EmpanizadoPage() {
  const puedeVer = usePuede("empanizado", "ver");
  const puedeReporte = usePuede("empanizado", "reporte");
  const pestanas = [
    puedeVer && ["piso", "Al piso"], puedeVer && ["abiertos", "Lotes abiertos"], puedeVer && ["cerrados", "Cerrados"],
    puedeReporte && ["produccion", "Producción por persona"],
  ].filter(Boolean);
  const [tab, setTab] = useState(pestanas[0]?.[0]);
  const [cuentaAbiertos, setCuentaAbiertos] = useState(null);

  return (
    <div>
      <div className="flex flex-wrap gap-1 bg-gray-200 rounded-lg p-1 mb-5 w-fit">
        {pestanas.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${tab === k ? "bg-white shadow text-amber-700" : "text-gray-600 hover:text-gray-800"}`}>
            {l}{k === "abiertos" && cuentaAbiertos != null ? ` (${cuentaAbiertos})` : ""}
          </button>
        ))}
      </div>
      {tab === "piso" && <AlPiso onTomado={() => setTab("abiertos")} />}
      {tab === "abiertos" && <Lotes estado="Abierto" onCuenta={setCuentaAbiertos} />}
      {tab === "cerrados" && <Lotes estado="Cerrado" />}
      {tab === "produccion" && <Produccion />}
    </div>
  );
}

// ── Al piso ───────────────────────────────────────────────────────────────────────────────────
// Igual que "Tomar del piso" de Destajo (usuario, 23 nov 2026): una fila por lote, con sus TERMOS
// adentro. Marcar el lote toma todos sus termos; abriéndolo (▸) se escoge termo por termo y se
// ajustan los kilos. Lo que llega de Tratamiento trae su termo; lo bajado, el termo en que se dejó.
function AlPiso({ onTomado }) {
  const puedeEditar = usePuede("empanizado", "editar");
  const [lineas, setLineas] = useState(null);
  const [sel, setSel] = useState({});              // Clave → { kg } o { termos: { termo → kg } }
  const [abiertas, setAbiertas] = useState(() => new Set());
  const [error, setError] = useState("");
  const [tomando, setTomando] = useState(false);

  const cargar = useCallback(() => pedir(`${API}/piso`)
    .then(l => { setLineas([...l].sort((a, b) => (b.DiasAlPiso ?? 0) - (a.DiasAlPiso ?? 0))); setSel({}); })
    .catch(e => setError(e.message)), []);
  useEffect(() => { cargar(); }, [cargar]);

  const conTermos = l => (l.TermosDetalle?.length ?? 0) > 0;
  const llaveTermo = t => t.Termo ?? "";
  const kgDe = l => conTermos(l)
    ? Object.values(sel[l.Clave]?.termos ?? {}).reduce((x, v) => x + Number(v || 0), 0)
    : Number(sel[l.Clave]?.kg ?? 0);
  const nuevaSel = l => conTermos(l)
    ? { termos: Object.fromEntries(l.TermosDetalle.map(t => [llaveTermo(t), String(t.Kg)])) }
    : { kg: String(l.Kg) };
  const alternar = l => setSel(x => { const n = { ...x }; if (n[l.Clave]) delete n[l.Clave]; else n[l.Clave] = nuevaSel(l); return n; });
  const alternarTermo = (l, t) => setSel(x => {
    const n = { ...x };
    const termos = { ...(n[l.Clave]?.termos ?? {}) };
    const k = llaveTermo(t);
    if (k in termos) delete termos[k]; else termos[k] = String(t.Kg);
    if (Object.keys(termos).length === 0) delete n[l.Clave]; else n[l.Clave] = { termos };
    return n;
  });
  const cambiarTermo = (l, t, v) => setSel(x => ({ ...x, [l.Clave]: { termos: { ...x[l.Clave].termos, [llaveTermo(t)]: v } } }));
  const abrir = l => setAbiertas(p => { const n = new Set(p); if (n.has(l.Clave)) n.delete(l.Clave); else n.add(l.Clave); return n; });

  const total = lineas?.reduce((a, l) => a + l.Kg, 0) ?? 0;
  const elegidas = (lineas ?? []).filter(l => sel[l.Clave]);
  const kgElegido = elegidas.reduce((a, l) => a + kgDe(l), 0);
  const todas = !!lineas?.length && elegidas.length === lineas.length;
  const alternarTodas = () => setSel(todas ? {} : Object.fromEntries(lineas.map(l => [l.Clave, nuevaSel(l)])));

  const problema = (() => {
    for (const l of elegidas) {
      if (conTermos(l)) {
        for (const t of l.TermosDetalle) {
          const v = sel[l.Clave].termos[llaveTermo(t)];
          if (v === undefined) continue;
          const nombre = t.Termo ? `termo ${t.Termo}` : "sin termo";
          if (!(Number(v) > 0)) return `${l.Lote} ${nombre}: los kilos deben ser mayores que cero`;
          if (Number(v) > t.Kg + 0.001) return `${l.Lote} ${nombre}: al piso solo hay ${kg(t.Kg)} kg`;
        }
      }
      if (!(kgDe(l) > 0)) return `${l.Lote}: los kilos deben ser mayores que cero`;
      if (kgDe(l) > l.Kg + 0.001) return `${l.Lote}: al piso solo hay ${kg(l.Kg)} kg`;
    }
    return "";
  })();

  const tomar = async () => {
    if (problema) { setError(problema); return; }
    setError(""); setTomando(true);
    try {
      const r = await pedir(`${API}/tomar`, { method: "POST", body: JSON.stringify({
        // Una línea por termo escogido: el servidor guarda de qué termo salió cada toma.
        lineas: elegidas.flatMap(l => {
          const base = { RemisionId: l.RemisionId, Lote: l.Lote, Clase: l.Clase, Talla: l.Talla, FechaLote: l.FechaLote };
          if (!conTermos(l)) return [{ ...base, Kg: kgDe(l) }];
          return Object.entries(sel[l.Clave].termos).map(([k, v]) => ({ ...base, Termo: k || null, Kg: Number(v) }));
        }),
      }) });
      alert(r.lotes.map(x => `${x.Lote} ${x.Clase} · ${kg(x.Kg)} kg ${x.Nuevo ? "(lote nuevo)" : "(sumado al lote abierto)"}`).join("\n"));
      onTomado();
    } catch (e) { setError(e.message); cargar(); } finally { setTomando(false); }
  };

  if (!lineas) return <div className="py-16 text-center text-gray-400">{error || "Cargando…"}</div>;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <span className="px-4 py-2 rounded-lg bg-white shadow text-sm">Al piso <b>{kg(total)} kg</b> · {lineas.length} lote{lineas.length !== 1 ? "s" : ""}</span>
        <span className="text-xs text-gray-500">Lo que mandó Tratamiento, por termo: el peso es el de su báscula, ya con el pick-up.</span>
        {puedeEditar && (
          <button disabled={!elegidas.length || tomando} onClick={tomar}
            className="ml-auto bg-emerald-600 text-white text-sm font-semibold px-5 py-2.5 rounded-lg hover:bg-emerald-700 disabled:opacity-40">
            {tomando ? "Tomando…" : `Tomar del piso${elegidas.length ? ` · ${kg(kgElegido)} kg` : ""}`}
          </button>
        )}
      </div>
      <Aviso>{error}</Aviso>
      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
              {puedeEditar && <th className="px-3 py-3 w-8"><input type="checkbox" checked={todas} onChange={alternarTodas} className="w-4 h-4 accent-amber-500" /></th>}
              <th className="px-3 py-3 text-left">Lote</th><th className="px-3 py-3 text-left">Producto</th><th className="px-3 py-3 text-left">Talla</th>
              <th className="px-3 py-3 text-right">Al piso (kg)</th>
              {puedeEditar && <th className="px-3 py-3 text-right w-28">Tomar (kg)</th>}
              <th className="px-3 py-3 text-left w-28">Termos</th>
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
                  <tr className={s ? "bg-amber-50" : l.DiasAlPiso >= 2 ? "bg-red-50 hover:bg-red-100" : "hover:bg-gray-50"}>
                    {puedeEditar && <td className="px-3 py-2"><input type="checkbox" checked={!!s} onChange={() => alternar(l)} className="w-4 h-4 accent-amber-500" /></td>}
                    <td className={`px-3 py-2 font-mono font-semibold whitespace-nowrap ${termos ? "cursor-pointer select-none" : ""}`} onClick={termos ? () => abrir(l) : undefined}
                      title={termos ? (abierta ? "Ocultar los termos" : "Ver los termos y tomar de ahí") : undefined}>
                      {termos && <span className="inline-block w-4 text-amber-600 font-sans">{abierta ? "▾" : "▸"}</span>}
                      {l.Lote}
                      {l.LoteDia && l.LoteDia !== l.Lote && <span className="block text-[11px] font-sans font-normal text-emerald-700" title="Se pesa con el lote del día, como en Pelado">→ {l.LoteDia} hoy</span>}
                      {l.EsBajado && <span className="block text-[11px] font-sans font-normal text-amber-700">Bajado de la mesa</span>}
                      {l.FolioRemision && <span className="block text-[11px] font-sans font-normal text-gray-400">{l.FolioRemision}</span>}
                    </td>
                    <td className="px-3 py-2">{l.Clase} <span className="text-gray-500">{l.DescripcionClase}</span></td>
                    <td className="px-3 py-2">{l.DescripcionTalla}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <span className="font-semibold">{kg(l.Kg)}</span>
                      <span className={`block text-[11px] ${l.DiasAlPiso >= 2 ? "text-red-600 font-semibold" : l.DiasAlPiso >= 1 ? "text-amber-700" : "text-gray-400"}`}>
                        {l.DiasAlPiso === 0 ? "entró hoy" : `${l.DiasAlPiso} día${l.DiasAlPiso !== 1 ? "s" : ""} al piso`}
                      </span>
                    </td>
                    {puedeEditar && (
                      <td className="px-3 py-2 text-right">
                        {s && termos && <span className="font-semibold text-amber-700">{kg(kgDe(l))}</span>}
                        {s && !termos && <input type="number" step="0.01" min="0.01" max={l.Kg} value={s.kg}
                          onChange={e => setSel(x => ({ ...x, [l.Clave]: { kg: e.target.value } }))}
                          className="w-24 border border-amber-300 rounded px-2 py-1 text-right" />}
                      </td>
                    )}
                    <td className="px-3 py-2 whitespace-nowrap">
                      {termos ? (
                        <button type="button" onClick={() => abrir(l)} className="text-xs font-medium text-amber-700 hover:underline">
                          {s ? `${nTermos} de ${l.TermosDetalle.length}` : l.TermosDetalle.length} termo{l.TermosDetalle.length !== 1 ? "s" : ""}
                        </button>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                  {abierta && l.TermosDetalle.map(t => {
                    const k = llaveTermo(t);
                    const v = s?.termos?.[k];
                    const marcado = v !== undefined;
                    return (
                      <tr key={`${l.Clave}#${k}`} className={marcado ? "bg-amber-50/60" : "bg-slate-50"}>
                        {puedeEditar && <td />}
                        <td className="pl-8 pr-3 py-1.5" colSpan={3}>
                          <label className="flex items-center gap-2 cursor-pointer">
                            {puedeEditar && <input type="checkbox" checked={marcado} onChange={() => alternarTermo(l, t)} className="w-4 h-4 accent-amber-500" />}
                            {t.Termo ? <span>Termo <b className="font-mono">{t.Termo}</b></span> : <span className="text-gray-500 italic">Sin termo identificado</span>}
                          </label>
                        </td>
                        <td className="px-3 py-1.5 text-right">{kg(t.Kg)}</td>
                        {puedeEditar && (
                          <td className="px-3 py-1.5 text-right">
                            {marcado && <input type="number" step="0.01" min="0.01" max={t.Kg} value={v} onChange={e => cambiarTermo(l, t, e.target.value)}
                              className="w-24 border border-amber-300 rounded px-2 py-1 text-right" />}
                          </td>
                        )}
                        <td />
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
            {lineas.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">No hay nada al piso de Empanizado</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Lotes ─────────────────────────────────────────────────────────────────────────────────────
function Lotes({ estado, onCuenta }) {
  const puedeEditar = usePuede("empanizado", "editar");
  const abiertos = estado === "Abierto";
  const [desde, setDesde] = useState(hoyGT());
  const [hasta, setHasta] = useState(hoyGT());
  const [lotes, setLotes] = useState(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [ajuste, setAjuste] = useState(null);   // { lote, tipo: "bajar" | "descarte" }
  const [detalle, setDetalle] = useState(null); // LoteEmpanizadoId

  const cargar = useCallback(() => {
    const url = abiertos ? `${API}/lotes?estado=Abierto` : `${API}/lotes?estado=Cerrado&desde=${desde}&hasta=${hasta}`;
    return pedir(url).then(l => { setLotes(l); onCuenta?.(abiertos ? l.length : null); }).catch(e => setError(e.message));
  }, [abiertos, desde, hasta, onCuenta]);
  useEffect(() => { cargar(); }, [cargar]);
  // Abiertos: las bandejas llegan de la báscula; se refresca cada minuto si la pestaña está a la vista.
  useEffect(() => {
    if (!abiertos) return undefined;
    const id = setInterval(() => { if (!document.hidden) cargar(); }, 60_000);
    return () => clearInterval(id);
  }, [abiertos, cargar]);

  const cerrar = async (l) => {
    const resumen = l.Salidas.map(s => `  ${s.ClaseSalida} ${s.DescripcionTalla ?? s.Talla} ${DESTINO[s.Destino]?.txt ?? s.Destino}: ${kg(s.Kg)} kg`).join("\n");
    if (!confirm(`Cerrar ${l.Lote} y trasladar a TÚNEL ${kg(l.Pesado)} kg:\n${resumen}\n\nDespués la báscula ya no acepta bandejas de este lote.`)) return;
    setError(""); setOk("");
    try { await pedir(`${API}/lotes/${l.LoteEmpanizadoId}/cerrar`, { method: "POST" }); setOk(`${l.Lote} cerrado: ${kg(l.Pesado)} kg pasaron a Túnel.`); cargar(); }
    catch (e) { setError(e.message); }
  };
  const reabrir = async (l) => {
    if (!confirm(`Reabrir ${l.Lote}? Lo trasladado a Túnel se saca de su piso.`)) return;
    setError(""); setOk("");
    try { await pedir(`${API}/lotes/${l.LoteEmpanizadoId}/reabrir`, { method: "POST" }); setOk(`${l.Lote} reabierto.`); cargar(); }
    catch (e) { setError(e.message); }
  };

  return (
    <div>
      {!abiertos && (
        <div className="flex flex-wrap items-center gap-2 mb-4 text-sm">
          <span className="text-gray-600">Cerrados del</span>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5" />
          <span className="text-gray-600">al</span>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5" />
        </div>
      )}
      <Aviso>{error}</Aviso>
      <Aviso tipo="ok">{ok}</Aviso>
      {!lotes ? <div className="py-16 text-center text-gray-400">Cargando…</div>
        : lotes.length === 0 ? (
          <div className="bg-white rounded-xl shadow p-10 text-center text-gray-500">
            {abiertos ? <>No hay lotes abiertos. Tome del piso en la pestaña <b>Al piso</b>.</> : "No se cerró ningún lote en esas fechas."}
          </div>
        ) : (
          <div className="space-y-4">
            {lotes.map(l => (
              <TarjetaLote key={l.LoteEmpanizadoId} l={l} puedeEditar={puedeEditar}
                onDetalle={() => setDetalle(l.LoteEmpanizadoId)} onAjuste={tipo => setAjuste({ lote: l, tipo })}
                onCerrar={() => cerrar(l)} onReabrir={() => reabrir(l)} />
            ))}
          </div>
        )}
      {ajuste && <AjusteModal {...ajuste} onClose={() => setAjuste(null)} onListo={() => { setAjuste(null); cargar(); }} />}
      {detalle && <DetalleModal id={detalle} puedeEditar={puedeEditar} onClose={() => { setDetalle(null); cargar(); }} />}
    </div>
  );
}

function TarjetaLote({ l, puedeEditar, onDetalle, onAjuste, onCerrar, onReabrir }) {
  const abierto = l.Estado === "Abierto";
  const queda = l.Tomado - l.Bajado - l.Descarte;
  return (
    <div className={`bg-white rounded-xl shadow p-4 border-2 ${abierto ? "border-amber-300" : "border-transparent"}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-xl font-bold font-mono">{l.Lote}</span>
        <span className="text-gray-500">{l.Clase} {l.DescripcionClase} · {l.DescripcionTalla} · tomado {l.Fecha}{l.FechaLote && l.FechaLote !== l.Fecha ? ` · lote del ${l.FechaLote}` : ""}</span>
        <span className={`ml-auto text-xs px-2 py-1 rounded font-semibold ${abierto ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
          {abierto ? "ABIERTO" : `CERRADO ${l.CerradoEn ?? ""}`}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-3 text-center">
        <Cifra t="Tomado del piso" v={`${kg(l.Tomado)} kg`} />
        <Cifra t="Bajado al piso" v={l.Bajado ? `−${kg(l.Bajado)} kg` : "—"} />
        <Cifra t="Descarte" v={l.Descarte ? `−${kg(l.Descarte)} kg` : "—"} />
        <Cifra t={`Pesado · ${l.Bandejas} bandejas · ${l.Personas} personas`} v={`${kg(l.Pesado)} kg`} fuerte />
        <Cifra t="Ganancia (harina)" v={pct(l.GananciaPct)} verde={l.GananciaPct != null && l.GananciaPct >= 0} rojo={l.GananciaPct != null && l.GananciaPct < 0} />
      </div>
      <table className="w-full text-sm mt-4">
        <thead><tr className="text-left text-gray-500 border-b text-xs uppercase tracking-wide">
          <th className="py-1.5">Producto que sale</th><th>Destino</th><th>Pedido</th><th className="text-right">Bandejas</th><th className="text-right">Personas</th><th className="text-right">Kg</th>
        </tr></thead>
        <tbody>
          {l.Salidas.map((s, i) => (
            <tr key={i} className="border-b border-gray-50">
              <td className="py-1.5">{s.ClaseSalida} <span className="text-gray-500">{s.DescripcionClaseSalida}</span> · <b>{s.DescripcionTalla ?? s.Talla}</b></td>
              <td><span className={`px-2 py-0.5 rounded text-xs font-semibold ${DESTINO[s.Destino]?.cls ?? "bg-gray-100"}`}>{DESTINO[s.Destino]?.txt ?? s.Destino ?? "—"}</span></td>
              <td className="text-gray-600">{s.CodigoPedido ? `${s.CodigoPedido}${s.Cliente ? ` · ${s.Cliente}` : ""}` : "—"}</td>
              <td className="text-right">{s.Bandejas}</td><td className="text-right">{s.Personas}</td>
              <td className="text-right font-semibold">{kg(s.Kg)}</td>
            </tr>
          ))}
          {l.Salidas.length === 0 && <tr><td colSpan={6} className="py-3 text-center text-gray-400">Todavía no hay bandejas pesadas en la báscula</td></tr>}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-2 mt-4">
        <button onClick={onDetalle} className="px-4 py-2 rounded-lg bg-slate-100 text-sm hover:bg-slate-200">Ver detalle</button>
        {puedeEditar && abierto && <>
          <button disabled={queda <= 0} onClick={() => onAjuste("bajar")} className="px-4 py-2 rounded-lg bg-slate-100 text-sm hover:bg-slate-200 disabled:opacity-40">↩ Bajar al piso</button>
          <button disabled={queda <= 0} onClick={() => onAjuste("descarte")} className="px-4 py-2 rounded-lg bg-slate-100 text-sm hover:bg-slate-200 disabled:opacity-40">Descarte</button>
          <button onClick={onCerrar} disabled={!(l.Pesado > 0)} title={l.Pesado > 0 ? "" : "Sin bandejas pesadas"}
            className="ml-auto px-5 py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold hover:bg-slate-900 disabled:opacity-40">Cerrar lote → TÚNEL</button>
        </>}
        {puedeEditar && !abierto && <button onClick={onReabrir} className="ml-auto px-4 py-2 rounded-lg border border-gray-300 text-sm hover:bg-gray-50">Reabrir</button>}
      </div>
    </div>
  );
}

const Cifra = ({ t, v, fuerte, verde, rojo }) => (
  <div className={`rounded-lg p-2 ${verde ? "bg-emerald-50" : rojo ? "bg-red-50" : "bg-slate-50"}`}>
    <div className={`text-[11px] ${verde ? "text-emerald-700" : rojo ? "text-red-700" : "text-gray-500"}`}>{t}</div>
    <div className={`text-lg font-bold ${fuerte ? "text-slate-900" : ""} ${verde ? "text-emerald-700" : rojo ? "text-red-700" : ""}`}>{v}</div>
  </div>
);

// Bajar al piso: kilos, talla y el termo en que queda; regresa al piso de Empanizado (usuario, 23 nov
// 2026, igual que en Pelado). Descarte: kilos y motivo, no regresa al piso.
function AjusteModal({ lote, tipo, onClose, onListo }) {
  const bajar = tipo === "bajar";
  const queda = lote.Tomado - lote.Bajado - lote.Descarte;
  const [form, setForm] = useState({ Kg: "", Termo: "", Talla: String(lote.Talla ?? ""), Motivo: bajar ? "Sobrante" : "" });
  const [tallas, setTallas] = useState([]);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    if (bajar) fetch("/api/tallas", { headers: authHeader() }).then(r => r.json()).then(d => { if (Array.isArray(d)) setTallas(d.filter(t => t.Activo !== false && t.Activo !== 0)); }).catch(() => {});
  }, [bajar]);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const enviar = async e => {
    e.preventDefault(); setError(""); setGuardando(true);
    try {
      await pedir(`${API}/lotes/${lote.LoteEmpanizadoId}/${bajar ? "bajar" : "descarte"}`, { method: "POST", body: JSON.stringify(
        bajar ? { Kg: Number(form.Kg), Termo: form.Termo.trim(), Talla: Number(form.Talla), Motivo: form.Motivo } : { Kg: Number(form.Kg), Motivo: form.Motivo }) });
      onListo();
    } catch (err) { setError(err.message); } finally { setGuardando(false); }
  };
  return (
    <Modal titulo={`${bajar ? "Bajar al piso" : "Descarte"} · ${lote.Lote}`} onClose={onClose}>
      <form onSubmit={enviar} className="space-y-4">
        <p className="text-sm text-gray-600">
          {bajar ? "Lo que no se trabajó regresa al piso de Empanizado, en el termo que indique, y se vuelve a tomar otro día desde Al piso." : "Merma: no regresa al piso."}
          {" "}Quedan <b>{kg(queda)} kg</b> de lo tomado.
        </p>
        {bajar ? (
          <div className="grid grid-cols-3 gap-3">
            <label className="text-xs text-gray-500"># Termo *<input required autoFocus maxLength={20} value={form.Termo} onChange={set("Termo")} className={inputCls + " mt-1 font-mono"} /></label>
            <label className="text-xs text-gray-500">Kilos *<input required type="number" step="0.01" min="0.01" max={queda} value={form.Kg} onChange={set("Kg")} className={inputCls + " mt-1"} /></label>
            <label className="text-xs text-gray-500">Talla *
              <select required value={form.Talla} onChange={set("Talla")} className={inputCls + " mt-1"}>
                <option value="">— elija —</option>
                {tallas.map(t => <option key={t.Codigo} value={t.Codigo}>{t.Descripcion} ({t.Codigo})</option>)}
                {form.Talla && !tallas.some(t => String(t.Codigo) === form.Talla) && <option value={form.Talla}>{lote.DescripcionTalla ?? form.Talla}</option>}
              </select>
            </label>
          </div>
        ) : (
          <label className="block text-xs text-gray-500">Kilos *<input required autoFocus type="number" step="0.01" min="0.01" max={queda} value={form.Kg} onChange={set("Kg")} className={inputCls + " mt-1"} /></label>
        )}
        <label className="block text-xs text-gray-500">{bajar ? "Nota" : "Motivo *"}<input required={!bajar} value={form.Motivo} onChange={set("Motivo")} maxLength={200} className={inputCls + " mt-1"} /></label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">Cancelar</button>
          <button type="submit" disabled={guardando} className="px-5 py-2 text-sm bg-amber-500 text-white font-semibold rounded-lg hover:bg-amber-600 disabled:opacity-50">
            {guardando ? "Guardando…" : bajar ? "Bajar al piso" : "Registrar descarte"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DetalleModal({ id, puedeEditar, onClose }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  const cargar = useCallback(() => pedir(`${API}/lotes/${id}`).then(setD).catch(e => setError(e.message)), [id]);
  useEffect(() => { cargar(); }, [cargar]);
  const deshacer = async (m) => {
    if (!confirm(`¿Deshacer "${TIPO_MOV[m.Tipo]}" de ${kg(m.PesoKg)} kg?`)) return;
    setError("");
    try { const r = await pedir(`${API}/movimientos/${m.MovimientoId}`, { method: "DELETE" }); if (r.LoteBorrado) { onClose(); return; } cargar(); }
    catch (e) { setError(e.message); }
  };
  return (
    <Modal titulo={d ? `${d.Lote} · ${d.Clase} · ${d.DescripcionTalla}` : "Lote"} onClose={onClose} ancho="max-w-3xl">
      <Aviso>{error}</Aviso>
      {!d ? <p className="text-gray-400">Cargando…</p> : (
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Movimientos del lote</h3>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-1">Cuándo</th><th>Qué</th><th>Detalle</th><th className="text-right">Kg</th><th /></tr></thead>
              <tbody>
                {d.Movimientos.map(m => (
                  <tr key={m.MovimientoId} className="border-b border-gray-50">
                    <td className="py-1.5 text-gray-600">{m.FechaHora}</td>
                    <td>{TIPO_MOV[m.Tipo] ?? m.Tipo}</td>
                    <td className="text-gray-600">{m.NumeroTermo && <span className="font-mono">Termo {m.NumeroTermo} · </span>}{m.Tipo === "PROCESADO" ? `${m.Clase} · ${m.Motivo ?? ""}` : m.Tipo === "BAJADO" ? `talla ${m.Talla}${m.Motivo ? ` · ${m.Motivo}` : ""}` : m.Motivo ?? (m.FolioRemision ? m.FolioRemision : "")} <span className="text-xs text-gray-400">{m.RegistradoPor}</span></td>
                    <td className="text-right font-semibold">{kg(m.PesoKg)}</td>
                    <td className="text-right">
                      {puedeEditar && d.Estado === "Abierto" && m.Tipo !== "PROCESADO" && (
                        <button onClick={() => deshacer(m)} className="text-xs text-red-600 hover:underline">{m.Tipo === "TOMA_EMPANIZADO" ? "Devolver al piso" : "Deshacer"}</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Pesado por persona</h3>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-1">Posición</th><th>Persona</th><th className="text-right">Bandejas</th><th className="text-right">Kg</th></tr></thead>
              <tbody>
                {d.PorPersona.map(p => (
                  <tr key={p.Codigo} className="border-b border-gray-50">
                    <td className="py-1.5 font-mono">{p.MesaCodigo ? `${p.MesaCodigo} #${p.Posicion}` : <span className="text-gray-400">sin posición</span>}</td>
                    <td>{titulo(p.Nombre)} <span className="text-xs text-gray-400 font-mono">{p.Codigo}</span></td>
                    <td className="text-right">{p.Bandejas}</td><td className="text-right font-semibold">{kg(p.Kg)}</td>
                  </tr>
                ))}
                {d.PorPersona.length === 0 && <tr><td colSpan={4} className="py-3 text-center text-gray-400">Sin bandejas pesadas</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Producción por persona ────────────────────────────────────────────────────────────────────
function Produccion() {
  const [desde, setDesde] = useState(hoyGT());
  const [hasta, setHasta] = useState(hoyGT());
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [abierta, setAbierta] = useState(null);

  const cargar = useCallback(() => { setError(""); return pedir(`${API}/reporte?desde=${desde}&hasta=${hasta}`).then(setDatos).catch(e => setError(e.message)); }, [desde, hasta]);
  useEffect(() => { cargar(); }, [cargar]);

  const porPersona = useMemo(() => {
    const m = new Map();
    for (const f of datos?.filas ?? []) {
      const x = m.get(f.Codigo) ?? { Codigo: f.Codigo, Nombre: f.Nombre, MesaCodigo: f.MesaCodigo, MesaNombre: f.MesaNombre, Posicion: f.Posicion, Bandejas: 0, Kg: 0, BajoPeso: 0, SobrePeso: 0, Dias: new Set(), filas: [] };
      x.Bandejas += f.Bandejas; x.Kg += f.Kg; x.BajoPeso += f.BajoPeso ?? 0; x.SobrePeso += f.SobrePeso ?? 0; x.Dias.add(f.Fecha); x.filas.push(f);
      if (f.MesaCodigo) { x.MesaCodigo = f.MesaCodigo; x.MesaNombre = f.MesaNombre; x.Posicion = f.Posicion; } // la más reciente
      m.set(f.Codigo, x);
    }
    // Lb/hora con el MISMO cálculo de destajo (calcularLbHora): bloques desde la entrada al área del día
    // hasta cada bandeja, sin pausas en áreas sin paga; libra válida ÷ horas (usuario, 26 nov 2026).
    const t = datos?.tiempos;
    const tasa = new Map();
    let ponderada = null;
    if (t) {
      const entradasDe = new Map();
      for (const [c, i, s] of t.entradas) (entradasDe.get(c) ?? entradasDe.set(c, []).get(c)).push([i, s]);
      const entrada = (c, h) => {
        let mejor = null;
        for (const [i, s] of entradasDe.get(c) ?? []) if (i <= h && (s == null || s >= h) && (mejor == null || i > mejor)) mejor = i;
        return mejor;
      };
      const pesadas = t.bandejas.map(([c, h, g]) => ({ IdEmpleado: c, Nombre: c, FechaHora: h, Kilos: g / 1000, EntradaArea: entrada(c, h) }));
      const pausas = t.pausas.map(([c, i, s]) => ({ IdEmpleado: c, FechaHora: i, FechaSalida: s }));
      const filasLb = calcularLbHora(pesadas, () => ({ key: "EMPANIZADO", campos: {} }), pausas);
      for (const f of filasLb) tasa.set(f.IdEmpleado, f.LbPorHora);
      ponderada = totalLbHora(filasLb).PromedioLbHora;
    }
    const lista = [...m.values()].map(x => ({ ...x, Dias: x.Dias.size, Lb: x.Kg * LB_POR_KG, LbHora: tasa.get(x.Codigo) ?? null }))
      .sort((a, b) => (a.MesaCodigo == null) - (b.MesaCodigo == null) || String(a.MesaNombre ?? "").localeCompare(String(b.MesaNombre ?? ""), "es", { numeric: true }) || (a.Posicion ?? 0) - (b.Posicion ?? 0));
    lista.ponderada = ponderada;
    return lista;
  }, [datos]);
  const tot = porPersona.reduce((s, p) => ({ b: s.b + p.Bandejas, lb: s.lb + p.Lb }), { b: 0, lb: 0 });
  // Barra de Lb/hora de cada fila: escala común (la más alta, o el ritmo del día si alguien no lo alcanza).
  const escalaLbH = Math.max(1, porPersona.ponderada ?? 0, ...porPersona.map(p => p.LbHora ?? 0));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4 text-sm">
        <span className="text-gray-600">Del</span>
        <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5" />
        <span className="text-gray-600">al</span>
        <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5" />
        <button onClick={cargar} className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200">Actualizar</button>
        <button disabled={!datos?.filas?.length} onClick={() => exportarProduccionEmpanizado(porPersona, datos.filas, desde, hasta)}
          className="ml-auto px-4 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-40">Excel</button>
      </div>
      <Aviso>{error}</Aviso>
      {/* El ritmo del día (Lb/hora ponderada) es el hilo de todo el reporte: tarjeta principal, línea
          punteada en la gráfica y marca en la barra de cada persona (usuario, 26 nov 2026: "dale color"). */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Dato t="Personas" v={porPersona.length.toLocaleString("es-GT")} />
        <Dato t="Bandejas" v={tot.b.toLocaleString("es-GT")} />
        <Dato t="Libras" v={kg(tot.lb)} u="lb" />
        <div className="rounded-xl p-3 shadow-sm text-white" style={{ background: AMBAR }}>
          <div className="text-[11px] uppercase tracking-wider text-amber-100 font-semibold">Lb/hora ponderada</div>
          <div className="text-3xl font-extrabold tabular-nums leading-tight">{porPersona.ponderada == null ? "—" : kg(porPersona.ponderada)}</div>
          <div className="text-[11px] text-amber-100">ritmo del día · libra válida ÷ horas</div>
        </div>
      </div>
      {datos?.tiempos && <RitmoDelDia bandejas={datos.tiempos.bandejas} ponderada={porPersona.ponderada} />}
      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-amber-50 text-amber-900/70 uppercase text-xs tracking-wider">
              <th className="px-3 py-3 text-left">Mesa / banda</th><th className="px-3 py-3 text-left">Pos.</th><th className="px-3 py-3 text-left">Persona</th>
              <th className="px-3 py-3 text-right">Bandejas</th>
              <th className="px-3 py-3 text-right" title="Libra válida ÷ horas: desde su entrada al área del día hasta cada bandeja, sin cafetería ni permisos (mismo cálculo que destajo). La raya gris es el ritmo del día.">Lb/hora</th>
              <th className="px-3 py-3 text-right">Libras</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {porPersona.map((p, i) => (
              <FilaPersona key={p.Codigo} p={p} abierta={abierta === p.Codigo} onClick={() => setAbierta(a => (a === p.Codigo ? null : p.Codigo))}
                escala={escalaLbH} ponderada={porPersona.ponderada}
                nuevaMesa={i > 0 && (p.MesaNombre ?? "") !== (porPersona[i - 1].MesaNombre ?? "")} />
            ))}
            {datos && porPersona.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Sin bandejas pesadas en esas fechas</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">Solo bandejas guardadas y no anuladas, pesadas en modo Empanizado. Lb/hora: mismo cálculo que destajo (desde la entrada al área del día hasta cada bandeja, sin cafetería ni permisos); la ponderada es el total de libras válidas entre el total de horas. "—" = sin entrada al área ese día. En la barra, la raya gris es el ritmo del día; en ámbar, quien lo alcanza o supera. La posición es la que la persona tenía el día que pesó.</p>
    </div>
  );
}

const AMBAR = "#D97706"; // amber-600: el color de Empanizado; validado (contraste ≥ 3:1 sobre blanco)

const Dato = ({ t, v, u }) => (
  <div className="rounded-xl bg-white shadow-sm border-t-4 border-amber-200 p-3">
    <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold">{t}</div>
    <div className="text-2xl font-bold text-stone-800 tabular-nums leading-tight">{v}{u && <span className="ml-1 text-sm font-semibold text-stone-500">{u}</span>}</div>
  </div>
);

// Ritmo del día: libras por persona en cada hora del reloj = libras pesadas en esa hora ÷ personas que
// pesaron en esa hora (en un rango de varios días, persona-día). Línea punteada = ritmo del día
// (Lb/hora ponderada). Una sola serie: sin leyenda, la tarjeta la nombra (usuario, 26 nov 2026).
function RitmoDelDia({ bandejas, ponderada }) {
  const [hover, setHover] = useState(null);
  const horas = useMemo(() => {
    const m = new Map();
    for (const [c, t, g] of bandejas) {
      const h = Number(t.slice(11, 13));
      const x = m.get(h) ?? { g: 0, b: 0, p: new Set() };
      x.g += g; x.b += 1; x.p.add(`${t.slice(0, 10)}|${c}`);
      m.set(h, x);
    }
    if (!m.size) return [];
    const hs = [...m.keys()], out = [];
    for (let h = Math.min(...hs); h <= Math.max(...hs); h++) {
      const x = m.get(h);
      const lb = x ? (x.g / 1000) * LB_POR_KG : 0;
      out.push({ h, lb, b: x?.b ?? 0, personas: x?.p.size ?? 0, lbp: x ? lb / x.p.size : null });
    }
    return out;
  }, [bandejas]);
  if (!horas.length) return null;

  const W = 960, H = 250, L = 46, R = 20, T = 26, B = 30;
  const vals = horas.map(x => x.lbp).filter(v => v != null);
  const bruto = Math.max(...vals, ponderada ?? 0) * 1.15;
  const paso = [1, 2, 2.5, 5, 10, 20, 25, 50].find(s => bruto / s <= 5) ?? 100;
  const tope = Math.ceil(bruto / paso) * paso;
  const n = horas.length;
  const X = i => (n === 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const Y = v => T + (1 - v / tope) * (H - T - B);
  const ancho = n === 1 ? W - L - R : (W - L - R) / (n - 1);
  // La línea se corta donde una hora no tuvo bandejas (no se inventa el tramo).
  let d = "", abierto = false;
  horas.forEach((x, i) => {
    if (x.lbp == null) { abierto = false; return; }
    d += `${abierto ? "L" : "M"}${X(i)},${Y(x.lbp)} `; abierto = true;
  });
  const pico = horas.reduce((a, x, i) => (x.lbp != null && (a < 0 || x.lbp > horas[a].lbp) ? i : a), -1);
  const ultimo = horas.map(x => x.lbp != null).lastIndexOf(true);
  const etiqueta = h => `${h}:00`;
  const hv = hover != null ? horas[hover] : null;

  return (
    <div className="bg-white rounded-xl shadow p-4 mb-4">
      <div className="flex flex-wrap items-baseline gap-x-3 mb-1">
        <h3 className="font-bold text-stone-800">Ritmo del día</h3>
        <p className="text-xs text-stone-500">Libras por persona en cada hora: lo pesado en esa hora ÷ las personas que pesaron.</p>
      </div>
      <div className="relative" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
          aria-label={`Libras por persona en cada hora, de ${etiqueta(horas[0].h)} a ${etiqueta(horas[n - 1].h)}`}>
          {Array.from({ length: Math.round(tope / paso) + 1 }, (_, k) => k * paso).map(v => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="#e7e5e4" strokeWidth="1" />
              <text x={L - 8} y={Y(v) + 4} textAnchor="end" fontSize="11" fill="#78716c">{v.toLocaleString("es-GT")}</text>
            </g>
          ))}
          {horas.map((x, i) => (
            <text key={x.h} x={X(i)} y={H - 8} textAnchor="middle" fontSize="11" fill={hover === i ? "#292524" : "#78716c"} fontWeight={hover === i ? 700 : 400}>{etiqueta(x.h)}</text>
          ))}
          {ponderada != null && (
            <g>
              <line x1={L} x2={W - R} y1={Y(ponderada)} y2={Y(ponderada)} stroke="#78716c" strokeWidth="1.5" strokeDasharray="5 4" />
              <text x={W - R} y={Y(ponderada) - 6} textAnchor="end" fontSize="11" fill="#57534e" fontWeight="600">ritmo del día {kg(ponderada)}</text>
            </g>
          )}
          {hv && <line x1={X(hover)} x2={X(hover)} y1={T - 6} y2={H - B} stroke="#d6d3d1" strokeWidth="1" />}
          <path d={d} fill="none" stroke={AMBAR} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {horas.map((x, i) => x.lbp != null && (
            <circle key={x.h} cx={X(i)} cy={Y(x.lbp)} r={hover === i ? 6 : 4} fill={AMBAR} stroke="#fff" strokeWidth="2" />
          ))}
          {[...new Set([pico, ultimo])].filter(i => i >= 0 && i !== hover).map(i => (
            <text key={`l${i}`} x={X(i)} y={Y(horas[i].lbp) - 10} textAnchor="middle" fontSize="11" fontWeight="700" fill="#292524">{kg(horas[i].lbp, 1)}</text>
          ))}
          {horas.map((x, i) => (
            <rect key={`h${x.h}`} x={X(i) - ancho / 2} y={0} width={ancho} height={H} fill="transparent"
              onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
          ))}
        </svg>
        {hv && (
          <div className="pointer-events-none absolute top-0 z-10 rounded-lg bg-stone-800 text-white text-xs px-3 py-2 shadow-lg whitespace-nowrap"
            style={{ left: `${(X(hover) / W) * 100}%`, transform: `translateX(${X(hover) > W * 0.75 ? "-105%" : "8px"})` }}>
            <div className="font-bold mb-0.5">{etiqueta(hv.h)} – {etiqueta(hv.h + 1)}</div>
            {hv.lbp == null ? <div className="text-stone-300">Sin bandejas</div> : (<>
              <div><span className="font-bold text-amber-300">{kg(hv.lbp)}</span> lb por persona</div>
              <div className="text-stone-300">{kg(hv.lb)} lb · {hv.b.toLocaleString("es-GT")} bandejas · {hv.personas} personas</div>
            </>)}
          </div>
        )}
      </div>
      <details className="mt-1 text-xs">
        <summary className="cursor-pointer text-stone-500 hover:text-stone-700">Ver por hora</summary>
        <table className="mt-2 w-full max-w-xl text-xs tabular-nums">
          <thead><tr className="text-stone-500 text-left"><th className="py-1">Hora</th><th className="text-right">Personas</th><th className="text-right">Bandejas</th><th className="text-right">Libras</th><th className="text-right">Lb por persona</th></tr></thead>
          <tbody className="divide-y divide-stone-100">
            {horas.map(x => (
              <tr key={x.h}><td className="py-0.5">{etiqueta(x.h)} – {etiqueta(x.h + 1)}</td><td className="text-right">{x.personas}</td>
                <td className="text-right">{x.b.toLocaleString("es-GT")}</td><td className="text-right">{kg(x.lb)}</td><td className="text-right font-semibold">{x.lbp == null ? "—" : kg(x.lbp)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function FilaPersona({ p, abierta, onClick, escala, ponderada, nuevaMesa }) {
  const arriba = p.LbHora != null && ponderada != null && p.LbHora >= ponderada;
  return (
    <>
      <tr onClick={onClick} className={`cursor-pointer hover:bg-amber-50 ${nuevaMesa ? "border-t-2 border-amber-200" : ""}`}>
        <td className="px-3 py-2">{p.MesaNombre
          ? <span className="inline-block rounded-md bg-amber-100 text-amber-900 px-2 py-0.5 text-xs font-semibold">{p.MesaNombre}</span>
          : <span className="text-gray-400">sin posición</span>}</td>
        <td className="px-3 py-2 font-mono font-bold text-stone-700">{p.Posicion ?? ""}</td>
        <td className="px-3 py-2">{titulo(p.Nombre)} <span className="text-xs text-gray-400 font-mono">{p.Codigo}</span></td>
        <td className="px-3 py-2 text-right tabular-nums">{p.Bandejas.toLocaleString("es-GT")}</td>
        <td className="px-3 py-2">
          <div className="flex items-center justify-end gap-2">
            <div className="relative hidden sm:block h-2 w-28 rounded-full bg-amber-100" aria-hidden="true">
              {p.LbHora != null && <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (p.LbHora / escala) * 100)}%`, background: AMBAR }} />}
              {ponderada != null && <div className="absolute -top-1 -bottom-1 w-0.5 rounded bg-stone-500" style={{ left: `${(ponderada / escala) * 100}%` }} />}
            </div>
            <span className={`w-12 text-right tabular-nums ${arriba ? "font-bold text-amber-700" : "font-semibold text-stone-700"}`}>
              {p.LbHora == null ? <span className="text-gray-400 font-normal">—</span> : kg(p.LbHora)}
            </span>
          </div>
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{kg(p.Lb)}</td>
      </tr>
      {abierta && (
        <tr><td colSpan={6} className="bg-slate-50 px-6 py-2">
          <table className="w-full text-xs">
            <thead><tr className="text-gray-500 text-left"><th className="py-1">Fecha</th><th>Lote</th><th>Producto</th><th>Destino</th><th>Horario</th><th className="text-right">Bandejas</th><th className="text-right">Libras</th></tr></thead>
            <tbody>
              {p.filas.map((f, i) => (
                <tr key={i}><td className="py-0.5">{f.Fecha}</td><td className="font-mono">{f.Lote}</td><td>{f.ClaseSalida} {f.DescripcionClaseSalida} · {f.DescripcionTalla}</td>
                  <td>{DESTINO[f.Destino]?.txt ?? f.Destino}</td><td>{f.Primera}–{f.Ultima}</td><td className="text-right">{f.Bandejas}</td><td className="text-right">{kg(f.Kg * LB_POR_KG)}</td></tr>
              ))}
            </tbody>
          </table>
        </td></tr>
      )}
    </>
  );
}
