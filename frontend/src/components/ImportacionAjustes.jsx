import { useState } from "react";
import { usePuede } from "../context/AuthContext.jsx";
import { API, enviar, fLb } from "../utils/importaciones.js";
import { input, btnPri, btnSec, caja, Campo, Modal, Aviso } from "./ImportacionUI.jsx";

// Ajustes de Importaciones: quién recibe el reporte, los proveedores y los dos parámetros que se
// editan (días de pago sugeridos y libras por contenedor). La cuenta que ENVÍA no está aquí: vive en
// el .env del servidor (ver backend/src/lib/correo.ts).
export default function ImportacionAjustes({ opciones, onCambio }) {
  const puede = usePuede("importaciones", "editar");
  return (
    <div className="space-y-6 max-w-5xl">
      <Destinatarios lista={opciones.destinatarios} puede={puede} onCambio={onCambio} />
      <Proveedores lista={opciones.proveedores} puede={puede} onCambio={onCambio} />
      <Parametros opciones={opciones} puede={puede} onCambio={onCambio} />
    </div>
  );
}

function Encabezado({ titulo, ayuda, onNuevo, puede }) {
  return (
    <div className="flex flex-wrap items-end gap-2 mb-2">
      <div className="mr-auto">
        <h3 className="text-base font-bold text-gray-800">{titulo}</h3>
        {ayuda && <p className="text-sm text-gray-600">{ayuda}</p>}
      </div>
      {puede && onNuevo && <button onClick={onNuevo} className={btnPri}>+ Agregar</button>}
    </div>
  );
}

const si = (v) => (v ? "Sí" : "No");

function Destinatarios({ lista, puede, onCambio }) {
  const [editar, setEditar] = useState(null);
  const quitar = async (d) => {
    if (!confirm(`¿Quitar a ${d.Nombre} (${d.Correo}) de la lista? Los envíos anteriores no cambian.`)) return;
    try { await enviar(`${API}/destinatarios/${d.DestinatarioId}`, "DELETE"); onCambio(); } catch (e) { alert(e.message); }
  };
  return (
    <section>
      <Encabezado titulo="Lista de distribución" puede={puede}
        ayuda="Quiénes reciben el reporte de cada solicitud. Los marcados con «por defecto» ya vienen elegidos al enviar."
        onNuevo={() => setEditar({ Nombre: "", Area: "", Correo: "", RecibePorDefecto: true, Activo: true, Orden: lista.length + 1 })} />
      <div className={`${caja} overflow-x-auto`}>
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <tr><th className="px-3 py-2 text-left">Nombre</th><th className="px-3 py-2 text-left">Área</th><th className="px-3 py-2 text-left">Correo</th>
              <th className="px-3 py-2 text-left">Por defecto</th><th className="px-3 py-2 text-left">Activo</th><th className="w-36" /></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lista.length === 0 && <tr><td colSpan={6} className="px-3 py-5 text-center text-gray-400">Nadie en la lista todavía. Agrega a quienes deben recibir el reporte.</td></tr>}
            {lista.map(d => (
              <tr key={d.DestinatarioId} className={d.Activo ? "" : "text-gray-400"}>
                <td className="px-3 py-1.5 font-medium">{d.Nombre}</td><td className="px-3 py-1.5">{d.Area ?? ""}</td>
                <td className="px-3 py-1.5">{d.Correo}</td><td className="px-3 py-1.5">{si(d.RecibePorDefecto)}</td><td className="px-3 py-1.5">{si(d.Activo)}</td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                  {puede && <>
                    <button onClick={() => setEditar(d)} className="text-blue-700 hover:text-blue-900 font-semibold mr-3">Editar</button>
                    <button onClick={() => quitar(d)} className="text-red-700 hover:text-red-900 font-semibold">Quitar</button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editar && (
        <FormModal titulo={editar.DestinatarioId ? "Editar destinatario" : "Agregar destinatario"} inicial={editar}
          url={editar.DestinatarioId ? `${API}/destinatarios/${editar.DestinatarioId}` : `${API}/destinatarios`} metodo={editar.DestinatarioId ? "PUT" : "POST"}
          campos={[["Nombre", "Nombre", "text"], ["Area", "Área (opcional)", "text"], ["Correo", "Correo", "email"], ["Orden", "Orden en la lista", "number"],
            ["RecibePorDefecto", "Viene marcado al enviar", "check"], ["Activo", "Activo", "check"]]}
          onListo={() => { setEditar(null); onCambio(); }} onCerrar={() => setEditar(null)} />
      )}
    </section>
  );
}

function Proveedores({ lista, puede, onCambio }) {
  const [editar, setEditar] = useState(null);
  return (
    <section>
      <Encabezado titulo="Proveedores" puede={puede}
        ayuda="Un proveedor con solicitudes no se borra: se desactiva y deja de aparecer en las nuevas."
        onNuevo={() => setEditar({ Nombre: "", NombreCorto: "", Pais: "EC", Contacto: "", Correo: "", Activo: true })} />
      <div className={`${caja} overflow-x-auto`}>
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <tr><th className="px-3 py-2 text-left">Nombre</th><th className="px-3 py-2 text-left">Corto</th><th className="px-3 py-2 text-left">País</th>
              <th className="px-3 py-2 text-left">Contacto</th><th className="px-3 py-2 text-left">Correo</th><th className="px-3 py-2 text-left">Activo</th><th className="w-20" /></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lista.map(p => (
              <tr key={p.ProveedorId} className={p.Activo ? "" : "text-gray-400"}>
                <td className="px-3 py-1.5 font-medium">{p.Nombre}</td><td className="px-3 py-1.5">{p.NombreCorto}</td><td className="px-3 py-1.5">{p.Pais ?? ""}</td>
                <td className="px-3 py-1.5">{p.Contacto ?? ""}</td><td className="px-3 py-1.5">{p.Correo ?? ""}</td><td className="px-3 py-1.5">{si(p.Activo)}</td>
                <td className="px-3 py-1.5 text-right">{puede && <button onClick={() => setEditar(p)} className="text-blue-700 hover:text-blue-900 font-semibold">Editar</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editar && (
        <FormModal titulo={editar.ProveedorId ? "Editar proveedor" : "Agregar proveedor"} inicial={editar}
          url={editar.ProveedorId ? `${API}/proveedores/${editar.ProveedorId}` : `${API}/proveedores`} metodo={editar.ProveedorId ? "PUT" : "POST"}
          campos={[["Nombre", "Razón social", "text"], ["NombreCorto", "Nombre corto (en listas y calendario)", "text"], ["Pais", "País (código, ej. EC)", "text"],
            ["Contacto", "Contacto (opcional)", "text"], ["Correo", "Correo del contacto (opcional)", "email"], ["Activo", "Activo", "check"]]}
          onListo={() => { setEditar(null); onCambio(); }} onCerrar={() => setEditar(null)} />
      )}
    </section>
  );
}

function FormModal({ titulo, inicial, campos, url, metodo, onListo, onCerrar }) {
  const [v, setV] = useState(() => ({ ...inicial }));
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const guardar = async () => {
    setError(null); setGuardando(true);
    try { await enviar(url, metodo, v); onListo(); } catch (e) { setError(e.message); } finally { setGuardando(false); }
  };
  return (
    <Modal titulo={titulo} onCerrar={onCerrar}
      pie={<><button onClick={onCerrar} className={btnSec}>Cancelar</button><button onClick={guardar} disabled={guardando} className={btnPri}>{guardando ? "Guardando…" : "Guardar"}</button></>}>
      {error && <Aviso>{error}</Aviso>}
      {campos.map(([k, etiqueta, tipo]) => tipo === "check" ? (
        <label key={k} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={Boolean(v[k])} onChange={e => setV(x => ({ ...x, [k]: e.target.checked }))} /> {etiqueta}
        </label>
      ) : (
        <Campo key={k} etiqueta={etiqueta}>
          <input type={tipo} value={v[k] ?? ""} onChange={e => setV(x => ({ ...x, [k]: e.target.value }))} className={input} />
        </Campo>
      ))}
    </Modal>
  );
}

function Parametros({ opciones, puede, onCambio }) {
  const [v, setV] = useState({ diasPago: opciones.parametros.diasPago, lbContenedor: opciones.parametros.lbContenedor });
  const [msg, setMsg] = useState(null);
  const guardar = async () => {
    setMsg(null);
    try {
      await enviar(`${API}/parametros`, "PUT", { diasPago: Number(v.diasPago), lbContenedor: Number(v.lbContenedor) });
      setMsg({ tipo: "ok", txt: "Parámetros guardados." }); onCambio();
    } catch (e) { setMsg({ tipo: "error", txt: e.message }); }
  };
  const c = opciones.correo;
  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className={`${caja} p-4 space-y-3`}>
        <h3 className="text-base font-bold text-gray-800">Parámetros</h3>
        {msg && <Aviso tipo={msg.tipo}>{msg.txt}</Aviso>}
        <Campo etiqueta="Días de pago antes de la llegada" pista="Solo sugiere la fecha de pago al registrar; cada proforma conserva la suya.">
          <input type="number" value={v.diasPago} onChange={e => setV(x => ({ ...x, diasPago: e.target.value }))} disabled={!puede} className={`${input} w-32`} />
        </Campo>
        <Campo etiqueta="Libras por contenedor" pista="Para contar contenedores en la solicitud y en los reportes.">
          <input type="number" value={v.lbContenedor} onChange={e => setV(x => ({ ...x, lbContenedor: e.target.value }))} disabled={!puede} className={`${input} w-32`} />
        </Campo>
        {puede && <div className="flex justify-end"><button onClick={guardar} className={btnPri}>Guardar parámetros</button></div>}
      </div>
      <div className={`${caja} p-4 space-y-3 text-sm`}>
        <h3 className="text-base font-bold text-gray-800">Tallas y correo</h3>
        <p className="text-gray-700">Tallas que se ofrecen (de Catálogos → Tallas):</p>
        <div className="flex flex-wrap gap-1.5">
          {opciones.tallas.map(t => <span key={t.Codigo} className={`px-2 py-0.5 rounded-full border text-xs ${t.Activo ? "border-gray-300" : "border-red-300 text-red-700"}`} title={`Código ${t.Codigo}`}>{t.Descripcion}</span>)}
        </div>
        <p className="text-gray-700">
          Correo de salida: {c.configurado ? <b>{c.remitente}</b> : <span className="text-red-700 font-semibold">sin configurar en el servidor</span>}.
          <span className="block text-xs text-gray-500 mt-1">La cuenta se cambia en el servidor, no aquí. Un contenedor = {fLb(opciones.parametros.lbContenedor)} lb.</span>
        </p>
      </div>
    </section>
  );
}
