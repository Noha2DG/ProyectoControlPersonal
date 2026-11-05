import { useState, useEffect } from "react";
import { API, pedir, enviar, plural } from "../utils/importaciones.js";
import { input, btnPri, btnSec, Modal, Aviso } from "./ImportacionUI.jsx";

const RE_CORREO = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

// Enviar el reporte de una solicitud. Marcados de entrada: los de Ajustes con "recibe por defecto".
// El contacto del proveedor aparece aparte y sin marcar: mandarle el reporte es decisión de cada vez.
export default function ImportacionEnvioModal({ solicitud, opciones, onEnviado, onCerrar }) {
  const lista = opciones.destinatarios.filter(d => d.Activo);
  const [marcados, setMarcados] = useState(() => new Set(lista.filter(d => d.RecibePorDefecto).map(d => d.Correo)));
  const [conProveedor, setConProveedor] = useState(false);
  const [extra, setExtra] = useState("");
  const [asunto, setAsunto] = useState("");
  const [html, setHtml] = useState(null);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    pedir(`${API}/solicitudes/${solicitud.SolicitudId}/correo`)
      .then(r => { setAsunto(r.asunto); setHtml(r.html); })
      .catch(e => setError(e.message));
  }, [solicitud.SolicitudId]);

  const extras = extra.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
  const malos = extras.filter(x => !RE_CORREO.test(x));
  const para = [
    ...lista.filter(d => marcados.has(d.Correo)).map(d => ({ Nombre: d.Nombre, Correo: d.Correo })),
    ...(conProveedor && solicitud.CorreoProveedor ? [{ Nombre: `${solicitud.ProveedorCorto} (proveedor)`, Correo: solicitud.CorreoProveedor }] : []),
    ...extras.filter(x => RE_CORREO.test(x)).map(x => ({ Nombre: x, Correo: x.toLowerCase() })),
  ];
  const unicos = [...new Map(para.map(p => [p.Correo.toLowerCase(), p])).values()];

  const alternar = (correo) => setMarcados(s => { const n = new Set(s); n.has(correo) ? n.delete(correo) : n.add(correo); return n; });

  const mandar = async () => {
    setError(null); setEnviando(true);
    try {
      const r = await enviar(`${API}/solicitudes/${solicitud.SolicitudId}/enviar`, "POST", { Para: unicos, Asunto: asunto });
      onEnviado(r);
    } catch (e) { setError(e.message); } finally { setEnviando(false); }
  };

  const sinCorreo = !opciones.correo.configurado;
  return (
    <Modal titulo={`Enviar ${solicitud.Folio}`} subtitulo="El reporte completo va en el cuerpo del correo" ancho="max-w-3xl" onCerrar={onCerrar}
      pie={<>
        <button onClick={onCerrar} className={btnSec}>Cancelar</button>
        <button onClick={mandar} disabled={enviando || sinCorreo || !unicos.length || malos.length > 0 || !html} className={btnPri}>
          {enviando ? "Enviando…" : `Enviar a ${unicos.length}`}
        </button>
      </>}>
      {sinCorreo && <Aviso>El servidor no tiene correo configurado: avisa a sistemas para poder enviar.</Aviso>}
      {error && <Aviso>{error}</Aviso>}

      <div>
        <p className="text-sm font-medium text-gray-700 mb-1">Para · {unicos.length} persona{plural(unicos.length)}</p>
        {lista.length === 0 && <p className="text-sm text-gray-500">No hay lista de distribución. Agrégala en la pestaña Ajustes, o escribe los correos abajo.</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {lista.map(d => (
            <label key={d.DestinatarioId} className="flex items-start gap-2 border border-gray-200 rounded-lg px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
              <input type="checkbox" checked={marcados.has(d.Correo)} onChange={() => alternar(d.Correo)} className="mt-0.5" />
              <span className="min-w-0">
                <span className="block font-medium text-gray-800 truncate">{d.Nombre}{d.Area ? <span className="text-gray-400 font-normal"> · {d.Area}</span> : null}</span>
                <span className="block text-xs text-gray-500 truncate">{d.Correo}</span>
              </span>
            </label>
          ))}
          {solicitud.CorreoProveedor && (
            <label className="flex items-start gap-2 border border-dashed border-gray-300 rounded-lg px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
              <input type="checkbox" checked={conProveedor} onChange={e => setConProveedor(e.target.checked)} className="mt-0.5" />
              <span className="min-w-0">
                <span className="block font-medium text-gray-800 truncate">{solicitud.ProveedorCorto} <span className="text-gray-400 font-normal">· Proveedor</span></span>
                <span className="block text-xs text-gray-500 truncate">{solicitud.CorreoProveedor}</span>
              </span>
            </label>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-gray-700">Otros correos, separados por coma</span>
          <input value={extra} onChange={e => setExtra(e.target.value)} className={input} placeholder="nombre@esteromar.gt" />
          {malos.length > 0 && <span className="text-xs text-red-700">No parece correo: {malos.join(", ")}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-gray-700">Asunto</span>
          <input value={asunto} onChange={e => setAsunto(e.target.value)} maxLength={250} className={input} />
        </label>
      </div>

      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <p className="text-xs text-gray-500 bg-gray-50 px-3 py-1.5 border-b border-gray-200">
          Así se verá{opciones.correo.remitente ? ` · sale de ${opciones.correo.remitente}` : ""}
        </p>
        {html ? <iframe title="Vista previa del correo" srcDoc={html} sandbox="" className="w-full h-[420px] bg-white" />
          : <p className="text-sm text-gray-400 p-4">Cargando…</p>}
      </div>
    </Modal>
  );
}

// Lo que se envió en un envío anterior, armado con la copia que guardó el servidor.
export function ImportacionEnvioVer({ envioId, onCerrar }) {
  const [e, setE] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { pedir(`${API}/envios/${envioId}`).then(setE).catch(x => setError(x.message)); }, [envioId]);
  return (
    <Modal titulo={e ? e.Asunto : "Correo enviado"} ancho="max-w-3xl" onCerrar={onCerrar}
      subtitulo={e ? `${e.EnviadoEn} · ${e.EnviadoPor} · ${e.Para.length} destinatario${plural(e.Para.length)}` : null}
      pie={<button onClick={onCerrar} className={btnSec}>Cerrar</button>}>
      {error && <Aviso>{error}</Aviso>}
      {e && (
        <>
          {e.Estado === "ERROR" && <Aviso>No se envió: {e.Error}</Aviso>}
          {e.Estado === "ENVIADO" && e.Error && <Aviso tipo="aviso">{e.Error}</Aviso>}
          <p className="text-sm text-gray-700"><b>Para:</b> {e.Para.map(p => (p.Nombre !== p.Correo ? `${p.Nombre} <${p.Correo}>` : p.Correo)).join(", ")}</p>
          <iframe title="Correo enviado" srcDoc={e.html} sandbox="" className="w-full h-[460px] border border-gray-200 rounded-lg bg-white" />
        </>
      )}
    </Modal>
  );
}
