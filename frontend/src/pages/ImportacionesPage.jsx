import { useState, useEffect, useCallback, useMemo } from "react";
import { usePuede } from "../context/AuthContext.jsx";
import {
  API, pedir, enviar, fLb, fUsd, fFecha, contenedores, estadoChip, pagoChip, textoDifPago, plural, diasEntre,
} from "../utils/importaciones.js";
import { input, btn, btnPri, btnSec, btnPeligro, caja, Chip, Campo, Modal, Aviso } from "../components/ImportacionUI.jsx";
import ImportacionForm from "../components/ImportacionForm.jsx";
import ImportacionEnvioModal, { ImportacionEnvioVer } from "../components/ImportacionEnvioModal.jsx";
import ImportacionCalendario from "../components/ImportacionCalendario.jsx";
import ImportacionAjustes from "../components/ImportacionAjustes.jsx";

// Importaciones de materia prima: las proformas que se piden a proveedores del extranjero (lo que
// antes vivía en la hoja BASE DAtos de «Pedidos Taiwan.xlsx»). Cada solicitud se registra en una sola
// pantalla, se envía por correo a la lista de distribución y se sigue hasta Recibida / Pagada.
// Backend: backend/src/routes/importaciones.ts. Solo proformas reales: el plan "Por pedir" del Excel
// queda fuera.
const PESTANAS = [["lista", "Materia prima solicitada"], ["calendario", "Calendario"], ["ajustes", "Ajustes"]];

const FILTROS = [
  ["activas", "Por recibir", s => s.Estado === "CONFIRMADA"],
  ["pagar", "Por pagar", s => s.Estado !== "ANULADA" && s.EstadoPago !== "PAGADA"],
  ["recibidas", "Recibidas", s => s.Estado === "RECIBIDA"],
  ["anuladas", "Anuladas", s => s.Estado === "ANULADA"],
  ["todas", "Todas", () => true],
];

export default function ImportacionesPage() {
  const [pestana, setPestana] = useState("lista");
  const [opciones, setOpciones] = useState(null);
  const [solicitudes, setSolicitudes] = useState(null);
  const [abierta, setAbierta] = useState(null);   // SolicitudId en detalle
  const [form, setForm] = useState(null);         // { solicitud } — null = cerrado; solicitud null = nueva
  const [recienCreada, setRecienCreada] = useState(null); // folio, para el aviso al abrir su detalle
  const [error, setError] = useState(null);

  const cargarOpciones = useCallback(() => pedir(`${API}/opciones`).then(setOpciones).catch(e => setError(e.message)), []);
  const cargarSolicitudes = useCallback(() => pedir(`${API}/solicitudes`).then(setSolicitudes).catch(e => setError(e.message)), []);
  useEffect(() => { cargarOpciones(); cargarSolicitudes(); }, [cargarOpciones, cargarSolicitudes]);

  // Descripciones ya usadas, para autocompletar (en el Excel se repiten casi siempre las mismas).
  const descripciones = useMemo(() => [...new Set((solicitudes ?? []).flatMap(s => s.lineas.map(l => l.Descripcion)).filter(Boolean))].sort(), [solicitudes]);

  const abrir = (id) => { setPestana("lista"); setForm(null); setRecienCreada(null); setAbierta(id); };

  if (error && !opciones) return <Aviso>{error}</Aviso>;
  if (!opciones || !solicitudes) return <p className="text-sm text-gray-400">Cargando…</p>;

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-gray-200 rounded-lg p-1 w-fit max-w-full overflow-x-auto">
        {PESTANAS.map(([k, t]) => (
          <button key={k} onClick={() => { setPestana(k); setForm(null); if (k !== "lista") setAbierta(null); }}
            className={`px-3 py-1 rounded-md text-sm font-medium transition whitespace-nowrap ${pestana === k ? "bg-white shadow text-blue-700" : "text-gray-600 hover:text-gray-800"}`}>
            {t}
          </button>
        ))}
      </div>

      {form ? (
        <ImportacionForm opciones={opciones} solicitud={form.solicitud} descripciones={descripciones}
          onCancelar={() => setForm(null)}
          onGuardado={(id, nueva, folio) => { setForm(null); cargarSolicitudes(); setRecienCreada(nueva ? folio : null); setAbierta(id); setPestana("lista"); }} />
      ) : pestana === "lista" ? (
        abierta
          ? <Detalle key={`${abierta}-${recienCreada ?? ""}`} id={abierta} opciones={opciones} recienCreada={recienCreada}
              onVolver={() => { setAbierta(null); setRecienCreada(null); }}
              onEditar={s => setForm({ solicitud: s })} onCambio={cargarSolicitudes} onBorrada={() => { setAbierta(null); cargarSolicitudes(); }} />
          : <Lista solicitudes={solicitudes} hoy={opciones.hoy} onAbrir={abrir} onNueva={() => setForm({ solicitud: null })} />
      ) : pestana === "calendario" ? (
        <ImportacionCalendario solicitudes={solicitudes} hoy={opciones.hoy} onAbrir={abrir} />
      ) : (
        <ImportacionAjustes opciones={opciones} onCambio={cargarOpciones} />
      )}
    </div>
  );
}

// ── Lista ────────────────────────────────────────────────────────────

function Lista({ solicitudes, hoy, onAbrir, onNueva }) {
  const puedeCrear = usePuede("importaciones", "crear");
  const [filtro, setFiltro] = useState("todas");
  const [buscar, setBuscar] = useState("");

  const vivas = solicitudes.filter(s => s.Estado !== "ANULADA");
  const porRecibir = vivas.filter(s => s.Estado === "CONFIRMADA");
  const porPagar = vivas.filter(s => s.EstadoPago !== "PAGADA");
  const vencidas = porPagar.filter(s => s.FechaPago < hoy);
  const semana = porRecibir.filter(s => { const d = diasEntre(hoy, s.FechaLlegada); return d >= 0 && d <= 7; });
  const suma = (arr, k) => arr.reduce((a, s) => a + s[k], 0);

  const q = buscar.trim().toLowerCase();
  const f = FILTROS.find(x => x[0] === filtro) ?? FILTROS[4];
  // Lo pendiente primero, por la llegada más próxima; después lo cerrado, lo más reciente arriba.
  const abiertas = solicitudes.filter(s => s.Estado === "CONFIRMADA").sort((a, b) => a.FechaLlegada.localeCompare(b.FechaLlegada));
  const cerradas = solicitudes.filter(s => s.Estado !== "CONFIRMADA").sort((a, b) => b.FechaLlegada.localeCompare(a.FechaLlegada));
  const lista = [...abiertas, ...cerradas].filter(f[2])
    .filter(s => !q || [s.Folio, s.Proforma, s.Proveedor, s.ProveedorCorto].some(x => String(x ?? "").toLowerCase().includes(q)));
  // La suma de abajo es la de lo que se ve (filtro y búsqueda), sin las anuladas: no se reciben ni se
  // pagan. En el filtro "Anuladas" sí se suman, porque es lo único que hay.
  const sumadas = filtro === "anuladas" ? lista : lista.filter(s => s.Estado !== "ANULADA");

  const tarjeta = (titulo, valor, detalle, tono = "") => (
    <div className={`${caja} px-4 py-3 ${tono}`}>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{titulo}</p>
      <p className="text-xl font-bold text-gray-800 tabular-nums">{valor}</p>
      <p className="text-xs text-gray-500">{detalle}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tarjeta("Por recibir", `${fLb(suma(porRecibir, "Libras"))} lb`, `${porRecibir.length} solicitud${plural(porRecibir.length, "es")}`)}
        {tarjeta("Llegan en 7 días", `${semana.length}`, semana.length ? `${fLb(suma(semana, "Libras"))} lb` : "Nada esta semana")}
        {tarjeta("Por pagar", fUsd(suma(porPagar, "TotalUsd")), `${porPagar.length} solicitud${plural(porPagar.length, "es")}`)}
        {tarjeta("Pagos vencidos", fUsd(suma(vencidas, "TotalUsd")), vencidas.length ? `${vencidas.length} solicitud${plural(vencidas.length, "es")}` : "Ninguno",
          vencidas.length ? "border-red-300 bg-red-50/50" : "")}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 bg-gray-200 rounded-lg p-1 overflow-x-auto max-w-full">
          {FILTROS.map(([k, t, fn]) => (
            <button key={k} onClick={() => setFiltro(k)} aria-pressed={filtro === k}
              className={`px-3 py-1 rounded-md text-sm font-medium transition whitespace-nowrap ${filtro === k ? "bg-white shadow text-blue-700" : "text-gray-600 hover:text-gray-800"}`}>
              {t} <span className="text-xs text-gray-400">{solicitudes.filter(fn).length}</span>
            </button>
          ))}
        </div>
        <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar folio, proforma o proveedor…" className={`${input} w-full sm:w-64`} />
        {puedeCrear && <button onClick={onNueva} className={`${btnPri} sm:ml-auto`}>+ Nueva solicitud</button>}
      </div>

      <div className={`${caja} overflow-x-auto`}>
        <table className="w-full text-sm min-w-[920px]">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2 text-left">Folio</th><th className="px-3 py-2 text-left">Proveedor</th><th className="px-3 py-2 text-left">Proforma</th>
              <th className="px-3 py-2 text-left">Llegada</th><th className="px-3 py-2 text-right">Libras</th><th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-left">Estado</th><th className="px-3 py-2 text-left">Pago</th><th className="px-3 py-2 text-left">Correo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lista.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-500">
                {solicitudes.length === 0 ? "Todavía no hay solicitudes. Registra la primera con «+ Nueva solicitud»." : "Ninguna solicitud con este filtro."}
              </td></tr>
            )}
            {lista.map(s => (
              <tr key={s.SolicitudId} onClick={() => onAbrir(s.SolicitudId)} className={`cursor-pointer hover:bg-blue-50 ${s.Estado === "ANULADA" ? "text-gray-400" : ""}`}>
                <td className="px-3 py-2 font-mono font-semibold whitespace-nowrap">{s.Folio}</td>
                <td className="px-3 py-2 whitespace-nowrap">{s.ProveedorCorto}</td>
                <td className="px-3 py-2 text-gray-600">{s.Proforma}</td>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">{fFecha(s.FechaLlegada)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fLb(s.Libras)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fUsd(s.TotalUsd)}</td>
                <td className="px-3 py-2"><Chip c={estadoChip(s, hoy)} /></td>
                <td className="px-3 py-2"><Chip c={pagoChip(s, hoy)} /></td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  {s.Envios ? <span className="text-emerald-700 font-semibold">Enviada{s.Envios > 1 ? ` ×${s.Envios}` : ""}</span>
                    : s.Estado === "ANULADA" ? "" : <span className="text-amber-700">Sin enviar</span>}
                </td>
              </tr>
            ))}
          </tbody>
          {sumadas.length > 0 && (
            <tfoot className="bg-gray-50 font-semibold text-gray-800 border-t border-gray-200">
              <tr>
                <td colSpan={4} className="px-3 py-2">
                  Total · {sumadas.length} solicitud{plural(sumadas.length, "es")}
                  {sumadas.length < lista.length && <span className="ml-1 text-xs font-normal text-gray-500">(sin las anuladas)</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fLb(suma(sumadas, "Libras"))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fUsd(suma(sumadas, "TotalUsd"))}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ── Detalle ──────────────────────────────────────────────────────────

function Detalle({ id, opciones, recienCreada, onVolver, onEditar, onCambio, onBorrada }) {
  const puedeCrear = usePuede("importaciones", "crear");
  const puedeEditar = usePuede("importaciones", "editar");
  const puedeEliminar = usePuede("importaciones", "eliminar");
  const [s, setS] = useState(null);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(recienCreada ? `Solicitud ${recienCreada} registrada. Revisa el reporte y envíalo a los involucrados.` : null);
  const [modal, setModal] = useState(null); // { tipo: "enviar" | "recibir" | "pagar" | "anular" | "envio", ... }

  const cargar = useCallback(() => pedir(`${API}/solicitudes/${id}`).then(setS).catch(e => setError(e.message)), [id]);
  useEffect(() => { cargar(); }, [cargar]);

  const accion = async (ruta, cuerpo, mensaje) => {
    setError(null);
    try {
      await enviar(`${API}/solicitudes/${id}/${ruta}`, "POST", cuerpo);
      setModal(null); setOk(mensaje); cargar(); onCambio();
    } catch (e) { setError(e.message); setModal(null); }
  };
  const borrar = async () => {
    if (!confirm(`¿Borrar la solicitud ${s.Folio}? Nunca se envió por correo, así que no queda rastro.`)) return;
    try { await enviar(`${API}/solicitudes/${id}`, "DELETE"); onBorrada(); } catch (e) { setError(e.message); }
  };

  if (!s) return error ? <Aviso>{error}</Aviso> : <p className="text-sm text-gray-400">Cargando…</p>;
  const hoy = opciones.hoy, cap = opciones.parametros.lbContenedor;
  const n = contenedores(s.Libras, cap);
  const anulada = s.Estado === "ANULADA";
  const dato = (t, v, extra) => (
    <div><dt className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t}</dt><dd className="text-sm text-gray-800">{v}{extra && <span className="block text-xs text-gray-500">{extra}</span>}</dd></div>
  );

  return (
    <div className="space-y-4 max-w-5xl">
      <button onClick={onVolver} className="text-sm text-blue-700 hover:text-blue-900">‹ Volver a la lista</button>
      {ok && <Aviso tipo="ok">{ok}</Aviso>}
      {error && <Aviso>{error}</Aviso>}

      <div className={`${caja} p-4 space-y-4`}>
        <div className="flex flex-wrap items-start gap-3">
          <div className="mr-auto">
            <h3 className="text-xl font-bold text-gray-800 font-mono">{s.Folio}</h3>
            <p className="text-sm text-gray-600">{s.Proveedor} · Proforma <b>{s.Proforma}</b></p>
            <div className="flex flex-wrap gap-1.5 mt-2"><Chip c={estadoChip(s, hoy)} /><Chip c={pagoChip(s, hoy)} />
              {s.Origen === "EXCEL" && <Chip c={{ cls: "bg-gray-50 text-gray-600 border-gray-300", txt: "Cargada del Excel" }} />}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {!anulada && (puedeCrear || puedeEditar) && <button onClick={() => setModal({ tipo: "enviar" })} className={btnPri}>Enviar por correo</button>}
            {!anulada && puedeEditar && <button onClick={() => onEditar(s)} className={btnSec}>Corregir</button>}
            {puedeEditar && s.Estado === "CONFIRMADA" && <button onClick={() => setModal({ tipo: "recibir", fecha: hoy < s.FechaLlegada ? hoy : s.FechaLlegada })} className={btnSec}>Marcar recibida</button>}
            {puedeEditar && !anulada && s.EstadoPago !== "PAGADA" && <button onClick={() => setModal({ tipo: "pagar", fecha: hoy < s.FechaPago ? hoy : s.FechaPago })} className={btnSec}>Marcar pagada</button>}
          </div>
        </div>

        {anulada && <Aviso tipo="aviso">Anulada: {s.MotivoAnulacion}</Aviso>}

        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {dato("Pedido", s.FechaPedido ? fFecha(s.FechaPedido) : "Sin registrar")}
          {dato("Salida", fFecha(s.FechaSalida))}
          {dato("Llegada", fFecha(s.FechaLlegada), s.Estado === "RECIBIDA" ? `Recibida el ${fFecha(s.RecibidaEn)} · ${s.RecibidaPor}` : null)}
          {dato("Pago", fFecha(s.FechaPago), s.EstadoPago === "PAGADA" ? `Pagada el ${fFecha(s.PagadaEn)} · ${s.PagadaPor}` : textoDifPago(s.FechaPago, s.FechaLlegada))}
        </dl>

        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr><th className="px-3 py-2 text-left">Clase</th><th className="px-3 py-2 text-left">Descripción</th><th className="px-3 py-2 text-left">Talla</th>
                <th className="px-3 py-2 text-right">Libras</th><th className="px-3 py-2 text-right">$/lb</th><th className="px-3 py-2 text-right">Total</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100 tabular-nums">
              {s.lineas.map(l => (
                <tr key={l.Linea}>
                  <td className="px-3 py-1.5">{l.Clase}</td><td className="px-3 py-1.5">{l.Descripcion || "—"}</td><td className="px-3 py-1.5 font-medium">{l.TallaDescripcion}</td>
                  <td className="px-3 py-1.5 text-right">{fLb(l.Libras)}</td><td className="px-3 py-1.5 text-right">${l.CostoLb.toFixed(2)}</td><td className="px-3 py-1.5 text-right">{fUsd(l.Total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 font-semibold text-gray-800 tabular-nums">
              <tr><td colSpan={3} className="px-3 py-2">Total · {n} contenedor{plural(n, "es")}</td><td className="px-3 py-2 text-right">{fLb(s.Libras)}</td><td /><td className="px-3 py-2 text-right">{fUsd(s.TotalUsd)}</td></tr>
            </tfoot>
          </table>
        </div>

        {s.Notas && <p className="text-sm text-gray-700"><b>Notas:</b> {s.Notas}</p>}
        <p className="text-xs text-gray-500">
          Registró {s.CreadoPor} · {s.CreadoEn}{s.ModificadoPor ? ` · Última corrección: ${s.ModificadoPor} · ${s.ModificadoEn}` : ""}
        </p>
      </div>

      <div className={`${caja} p-4`}>
        <h4 className="text-sm font-bold text-gray-800 mb-2">Envíos por correo</h4>
        {s.envios.length === 0 ? <p className="text-sm text-gray-500">{anulada ? "No se envió." : "Todavía no se envía a nadie."}</p> : (
          <ul className="divide-y divide-gray-100">
            {s.envios.map(e => (
              <li key={e.EnvioId} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="tabular-nums text-gray-600 w-32">{e.EnviadoEn}</span>
                {e.Estado === "ERROR" ? <span className="text-red-700 font-semibold">No se envió</span> : <span className="text-emerald-700 font-semibold">Enviado</span>}
                <span className="text-gray-700 min-w-0 flex-1 truncate" title={e.Para.map(p => p.Correo).join(", ")}>{e.Para.length} destinatario{plural(e.Para.length)} · {e.EnviadoPor}</span>
                <button onClick={() => setModal({ tipo: "envio", envioId: e.EnvioId })} className="text-blue-700 hover:text-blue-900 font-semibold">Ver</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {puedeEditar && (s.Estado === "RECIBIDA" || s.EstadoPago === "PAGADA" || s.Estado === "CONFIRMADA") && (
        <div className="flex flex-wrap gap-2 justify-end">
          {s.Estado === "RECIBIDA" && <button onClick={() => confirm("¿Deshacer la recepción? Vuelve a quedar por recibir.") && accion("deshacer-recibir", null, "Recepción deshecha.")} className={btnSec}>Deshacer recepción</button>}
          {s.EstadoPago === "PAGADA" && <button onClick={() => confirm("¿Deshacer el pago? Vuelve a quedar pendiente.") && accion("deshacer-pago", null, "Pago deshecho.")} className={btnSec}>Deshacer pago</button>}
          {s.Estado === "CONFIRMADA" && <button onClick={() => setModal({ tipo: "anular", motivo: "" })} className={btnPeligro}>Anular</button>}
          {puedeEliminar && s.Envios === 0 && <button onClick={borrar} className={btnPeligro}>Borrar</button>}
        </div>
      )}

      {modal?.tipo === "enviar" && (
        <ImportacionEnvioModal solicitud={s} opciones={opciones} onCerrar={() => setModal(null)}
          onEnviado={r => { setModal(null); setOk(`Correo enviado a ${r.enviados} destinatario${plural(r.enviados)}.${r.rechazados.length ? ` No aceptados: ${r.rechazados.join(", ")}.` : ""}`); cargar(); onCambio(); }} />
      )}
      {modal?.tipo === "envio" && <ImportacionEnvioVer envioId={modal.envioId} onCerrar={() => setModal(null)} />}
      {(modal?.tipo === "recibir" || modal?.tipo === "pagar") && (
        <Modal titulo={modal.tipo === "recibir" ? `Recibir ${s.Folio}` : `Pago de ${s.Folio}`} onCerrar={() => setModal(null)}
          subtitulo={modal.tipo === "recibir" ? `${fLb(s.Libras)} lb · llegada prevista ${fFecha(s.FechaLlegada)}` : `${fUsd(s.TotalUsd)} · fecha acordada ${fFecha(s.FechaPago)}`}
          pie={<><button onClick={() => setModal(null)} className={btnSec}>Cancelar</button>
            <button onClick={() => accion(modal.tipo, { Fecha: modal.fecha }, modal.tipo === "recibir" ? "Solicitud marcada como recibida." : "Solicitud marcada como pagada.")} className={btnPri}>
              {modal.tipo === "recibir" ? "Marcar recibida" : "Marcar pagada"}</button></>}>
          <Campo etiqueta={modal.tipo === "recibir" ? "¿Qué día llegó?" : "¿Qué día se pagó?"}>
            <input type="date" value={modal.fecha} max={hoy} onChange={e => setModal(m => ({ ...m, fecha: e.target.value }))} className={`${input} w-48`} />
          </Campo>
        </Modal>
      )}
      {modal?.tipo === "anular" && (
        <Modal titulo={`Anular ${s.Folio}`} subtitulo="Queda en el historial con su motivo; ya no cuenta en calendario ni reportes." onCerrar={() => setModal(null)}
          pie={<><button onClick={() => setModal(null)} className={btnSec}>Cancelar</button>
            <button onClick={() => accion("anular", { Motivo: modal.motivo }, "Solicitud anulada.")} disabled={modal.motivo.trim().length < 5} className={`${btn} bg-red-600 text-white hover:bg-red-700`}>Anular</button></>}>
          <Campo etiqueta="Motivo">
            <textarea value={modal.motivo} onChange={e => setModal(m => ({ ...m, motivo: e.target.value }))} rows={3} maxLength={300} className={input} />
          </Campo>
          {s.Envios > 0 && <p className="text-xs text-gray-600">Ya se envió por correo: la anulación no avisa sola. Si hace falta, avisa a los que lo recibieron.</p>}
        </Modal>
      )}
    </div>
  );
}
