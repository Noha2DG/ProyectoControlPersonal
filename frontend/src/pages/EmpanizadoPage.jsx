import { useState, useEffect, useMemo, useCallback } from "react";
import { authHeader, usePuede } from "../context/AuthContext.jsx";
import { exportarProduccionEmpanizado } from "../utils/exportExcel.js";

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
const kg = (n, d = 2) => (n == null ? "—" : Number(n).toLocaleString("es", { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (n) => (n == null ? "—" : `${n > 0 ? "+" : ""}${Number(n).toLocaleString("es", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`);
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
function AlPiso({ onTomado }) {
  const puedeEditar = usePuede("empanizado", "editar");
  const [lineas, setLineas] = useState(null);
  const [marcadas, setMarcadas] = useState({}); // Clave → kg a tomar (texto)
  const [error, setError] = useState("");
  const [tomando, setTomando] = useState(false);

  const cargar = useCallback(() => pedir(`${API}/piso`).then(l => { setLineas(l); setMarcadas({}); }).catch(e => setError(e.message)), []);
  useEffect(() => { cargar(); }, [cargar]);

  const total = lineas?.reduce((s, l) => s + l.Kg, 0) ?? 0;
  const elegidas = (lineas ?? []).filter(l => marcadas[l.Clave] != null);
  const kgElegido = elegidas.reduce((s, l) => s + (Number(marcadas[l.Clave]) || 0), 0);
  const alternar = (l) => setMarcadas(m => { const n = { ...m }; if (n[l.Clave] != null) delete n[l.Clave]; else n[l.Clave] = String(l.Kg); return n; });

  const tomar = async () => {
    setError(""); setTomando(true);
    try {
      const r = await pedir(`${API}/tomar`, { method: "POST", body: JSON.stringify({
        lineas: elegidas.map(l => ({ RemisionId: l.RemisionId, Lote: l.Lote, Clase: l.Clase, Talla: l.Talla, FechaLote: l.FechaLote, Kg: Number(marcadas[l.Clave]) })),
      }) });
      alert(r.lotes.map(x => `${x.Lote} ${x.Clase} · ${kg(x.Kg)} kg ${x.Nuevo ? "(lote nuevo)" : "(sumado al lote abierto)"}`).join("\n"));
      onTomado();
    } catch (e) { setError(e.message); cargar(); } finally { setTomando(false); }
  };

  if (!lineas) return <div className="py-16 text-center text-gray-400">{error || "Cargando…"}</div>;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <span className="px-4 py-2 rounded-lg bg-white shadow text-sm">Al piso <b>{kg(total)} kg</b> · {lineas.length} línea{lineas.length !== 1 ? "s" : ""}</span>
        <span className="text-xs text-gray-500">Lo que mandó Tratamiento: ya es el peso final con el pick-up.</span>
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
              {puedeEditar && <th className="px-3 py-3 w-8" />}
              <th className="px-3 py-3 text-left">Lote</th><th className="px-3 py-3 text-left">Producto</th><th className="px-3 py-3 text-left">Talla</th>
              <th className="px-3 py-3 text-left">Fecha lote</th><th className="px-3 py-3 text-left">Llegó</th>
              <th className="px-3 py-3 text-right">Al piso (kg)</th>{puedeEditar && <th className="px-3 py-3 text-right">Tomar (kg)</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lineas.map(l => {
              const sel = marcadas[l.Clave] != null;
              return (
                <tr key={l.Clave} className={sel ? "bg-amber-50" : "hover:bg-gray-50"}>
                  {puedeEditar && <td className="px-3 py-2"><input type="checkbox" checked={sel} onChange={() => alternar(l)} className="w-4 h-4 accent-amber-500" /></td>}
                  <td className="px-3 py-2 font-mono font-semibold">{l.Lote}{l.EsBajado && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-sans">bajado</span>}</td>
                  <td className="px-3 py-2">{l.Clase} <span className="text-gray-500">{l.DescripcionClase}</span></td>
                  <td className="px-3 py-2">{l.DescripcionTalla}</td>
                  <td className="px-3 py-2 text-gray-600">{l.FechaLote ?? "—"}</td>
                  <td className="px-3 py-2 text-gray-600">{l.FechaIngreso ?? "—"}{l.FolioRemision ? ` · ${l.FolioRemision}` : ""}</td>
                  <td className="px-3 py-2 text-right font-semibold">{kg(l.Kg)}</td>
                  {puedeEditar && (
                    <td className="px-3 py-2 text-right">
                      {sel && <input type="number" step="0.01" min="0.01" max={l.Kg} value={marcadas[l.Clave]}
                        onChange={e => setMarcadas(m => ({ ...m, [l.Clave]: e.target.value }))}
                        className="w-28 border border-amber-300 rounded px-2 py-1 text-right" />}
                    </td>
                  )}
                </tr>
              );
            })}
            {lineas.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">No hay nada al piso de Empanizado</td></tr>}
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
        <span className="text-gray-500">{l.Clase} {l.DescripcionClase} · {l.DescripcionTalla} · tomado {l.Fecha}{l.FechaLote ? ` · lote del ${l.FechaLote}` : ""}</span>
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

function AjusteModal({ lote, tipo, onClose, onListo }) {
  const bajar = tipo === "bajar";
  const queda = lote.Tomado - lote.Bajado - lote.Descarte;
  const [form, setForm] = useState({ Kg: "", Motivo: bajar ? "Sobrante" : "" });
  const [error, setError] = useState("");
  const enviar = async e => {
    e.preventDefault(); setError("");
    try { await pedir(`${API}/lotes/${lote.LoteEmpanizadoId}/${bajar ? "bajar" : "descarte"}`, { method: "POST", body: JSON.stringify({ Kg: Number(form.Kg), Motivo: form.Motivo }) }); onListo(); }
    catch (err) { setError(err.message); }
  };
  return (
    <Modal titulo={`${bajar ? "Bajar al piso" : "Descarte"} · ${lote.Lote}`} onClose={onClose}>
      <form onSubmit={enviar} className="space-y-4">
        <p className="text-sm text-gray-600">{bajar ? "Lo que no se trabajó regresa al piso de Empanizado y se puede volver a tomar otro día." : "Merma: no regresa al piso."} Quedan {kg(queda)} kg de lo tomado.</p>
        <label className="block text-xs text-gray-500">Kilos *<input required autoFocus type="number" step="0.01" min="0.01" max={queda} value={form.Kg} onChange={e => setForm(f => ({ ...f, Kg: e.target.value }))} className={inputCls + " mt-1"} /></label>
        <label className="block text-xs text-gray-500">Motivo {bajar ? "" : "*"}<input required={!bajar} value={form.Motivo} onChange={e => setForm(f => ({ ...f, Motivo: e.target.value }))} maxLength={200} className={inputCls + " mt-1"} /></label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">Cancelar</button>
          <button type="submit" className="px-5 py-2 text-sm bg-amber-500 text-white font-semibold rounded-lg hover:bg-amber-600">Guardar</button>
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
                    <td className="text-gray-600">{m.Tipo === "PROCESADO" ? `${m.Clase} · ${m.Motivo ?? ""}` : m.Motivo ?? (m.FolioRemision ? m.FolioRemision : "")} <span className="text-xs text-gray-400">{m.RegistradoPor}</span></td>
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
      const x = m.get(f.Codigo) ?? { Codigo: f.Codigo, Nombre: f.Nombre, MesaCodigo: f.MesaCodigo, MesaNombre: f.MesaNombre, Posicion: f.Posicion, Bandejas: 0, Kg: 0, Dias: new Set(), filas: [] };
      x.Bandejas += f.Bandejas; x.Kg += f.Kg; x.Dias.add(f.Fecha); x.filas.push(f);
      if (f.MesaCodigo) { x.MesaCodigo = f.MesaCodigo; x.MesaNombre = f.MesaNombre; x.Posicion = f.Posicion; } // la más reciente
      m.set(f.Codigo, x);
    }
    return [...m.values()].map(x => ({ ...x, Dias: x.Dias.size }))
      .sort((a, b) => (a.MesaCodigo == null) - (b.MesaCodigo == null) || String(a.MesaNombre ?? "").localeCompare(String(b.MesaNombre ?? ""), "es", { numeric: true }) || (a.Posicion ?? 0) - (b.Posicion ?? 0));
  }, [datos]);
  const tot = porPersona.reduce((s, p) => ({ b: s.b + p.Bandejas, k: s.k + p.Kg }), { b: 0, k: 0 });

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
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Cifra t="Personas" v={porPersona.length} /><Cifra t="Bandejas" v={tot.b.toLocaleString("es")} /><Cifra t="Kilos" v={`${kg(tot.k)} kg`} fuerte />
      </div>
      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
              <th className="px-3 py-3 text-left">Mesa / banda</th><th className="px-3 py-3 text-left">Pos.</th><th className="px-3 py-3 text-left">Persona</th>
              <th className="px-3 py-3 text-right">Días</th><th className="px-3 py-3 text-right">Bandejas</th><th className="px-3 py-3 text-right">Kg</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {porPersona.map(p => (
              <FilaPersona key={p.Codigo} p={p} abierta={abierta === p.Codigo} onClick={() => setAbierta(a => (a === p.Codigo ? null : p.Codigo))} />
            ))}
            {datos && porPersona.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Sin bandejas pesadas en esas fechas</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">Solo bandejas guardadas y no anuladas, pesadas en la báscula en modo Empanizado. La posición es la que la persona tenía el día que pesó.</p>
    </div>
  );
}

function FilaPersona({ p, abierta, onClick }) {
  return (
    <>
      <tr onClick={onClick} className="cursor-pointer hover:bg-amber-50">
        <td className="px-3 py-2">{p.MesaNombre ?? <span className="text-gray-400">sin posición</span>}</td>
        <td className="px-3 py-2 font-mono font-bold">{p.Posicion ?? ""}</td>
        <td className="px-3 py-2">{titulo(p.Nombre)} <span className="text-xs text-gray-400 font-mono">{p.Codigo}</span></td>
        <td className="px-3 py-2 text-right">{p.Dias}</td>
        <td className="px-3 py-2 text-right">{p.Bandejas}</td>
        <td className="px-3 py-2 text-right font-semibold">{kg(p.Kg)}</td>
      </tr>
      {abierta && (
        <tr><td colSpan={6} className="bg-slate-50 px-6 py-2">
          <table className="w-full text-xs">
            <thead><tr className="text-gray-500 text-left"><th className="py-1">Fecha</th><th>Lote</th><th>Producto</th><th>Destino</th><th>Horario</th><th className="text-right">Bandejas</th><th className="text-right">Kg</th></tr></thead>
            <tbody>
              {p.filas.map((f, i) => (
                <tr key={i}><td className="py-0.5">{f.Fecha}</td><td className="font-mono">{f.Lote}</td><td>{f.ClaseSalida} {f.DescripcionClaseSalida} · {f.DescripcionTalla}</td>
                  <td>{DESTINO[f.Destino]?.txt ?? f.Destino}</td><td>{f.Primera}–{f.Ultima}</td><td className="text-right">{f.Bandejas}</td><td className="text-right">{kg(f.Kg)}</td></tr>
              ))}
            </tbody>
          </table>
        </td></tr>
      )}
    </>
  );
}
