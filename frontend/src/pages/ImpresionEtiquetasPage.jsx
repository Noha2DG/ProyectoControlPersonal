import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { authHeader } from "../context/AuthContext.jsx";

// Busca la impresora Zebra en Browser Print (SDK cargado global en index.html). Se vuelve a llamar
// justo antes de cada impresión (no se reusa un device guardado de cuando se entró a la pantalla):
// el handle USB de Browser Print puede quedar inválido si la conexión se corta un momento
// ("Failed to write to device: Error writing to port, connection closed"), aunque la impresora
// siga físicamente bien — hay que redetectarla en cada intento, no cachearla para toda la sesión.
// getDefaultDevice a veces devuelve un dispositivo sin "name" ("No value for name") — se prefiere
// getLocalDevices, que sí trae el nombre real.
function detectarDispositivo() {
  return new Promise((resolve, reject) => {
    if (!window.BrowserPrint) { reject(new Error("El SDK de Browser Print no cargó — revisa que el servicio esté instalado y corriendo.")); return; }
    window.BrowserPrint.getLocalDevices(
      (lista) => {
        const valido = (lista || []).find(d => d && d.name);
        if (valido) { resolve(valido); return; }
        window.BrowserPrint.getDefaultDevice(
          "printer",
          (dev) => {
            if (dev && dev.name) resolve(dev);
            else reject(new Error("Se detectó la impresora pero sin nombre válido — probá reiniciar Browser Print."));
          },
          (err) => reject(new Error("No se encontró impresora Zebra conectada: " + err))
        );
      },
      (err) => reject(new Error("No se pudo listar impresoras Zebra: " + err)),
      "printer"
    );
  });
}

function enviarZPL(device, zpl) {
  return new Promise((resolve, reject) => {
    device.send(zpl, () => resolve(), (err) => reject(new Error(String(err))));
  });
}

// Consulta el estatus de hardware con ~HQES. Es "best effort": si el canal de lectura no responde
// en 3s se continúa solo con la detección del dispositivo (no todos los enlaces exponen lectura),
// pero si SÍ responde y reporta errores (sin rollo, cabezal abierto...), quien llama bloquea la
// impresión ANTES de registrar nada en la base de datos.
function leerEstadoImpresora(device) {
  return new Promise((resolve) => {
    let terminado = false;
    const listo = (r) => { if (!terminado) { terminado = true; resolve(r); } };
    setTimeout(() => listo(null), 3000);
    try {
      device.sendThenRead("~HQES", (texto) => {
        const m = /ERRORS:\s*(\d)\s+([0-9A-Fa-f]+)\s+([0-9A-Fa-f]+)/.exec(String(texto || ""));
        if (!m) { listo(null); return; }
        if (m[1] !== "1") { listo({ error: false }); return; }
        const flags = parseInt(m[3], 16);
        const causas = [];
        if (flags & 0x1) causas.push("sin papel/rollo");
        if (flags & 0x2) causas.push("sin ribbon");
        if (flags & 0x4) causas.push("cabezal abierto");
        if (flags & 0x8) causas.push("falla en el cortador");
        listo({ error: true, detalle: causas.length ? causas.join(", ") : `código de error ${m[2]} ${m[3]}` });
      }, () => listo(null));
    } catch {
      listo(null);
    }
  });
}

// Detecta la impresora Y verifica su estatus físico. Se llama ANTES de registrar etiquetas en la
// base de datos — si Browser Print está caído, el USB suelto o la impresora reporta un problema,
// se aborta sin consumir cupo ni crear correlativos huérfanos.
async function verificarImpresora() {
  const device = await detectarDispositivo();
  const estado = await leerEstadoImpresora(device);
  if (estado?.error) throw new Error(`la impresora reporta un problema: ${estado.detalle}. Corrígelo y vuelve a intentar.`);
  return device;
}

// Envía los bloques ZPL en tandas (no un solo string gigante): da progreso real en pantalla y,
// si el envío falla a medias, el error lleva .enviadas/.restantes para que quien llama ofrezca
// reintentar exactamente lo que faltó (los correlativos ya están registrados, no se crean nuevos).
const ETIQUETAS_POR_TANDA = 25;
async function enviarBloques(device, bloques, onProgreso) {
  let enviadas = 0;
  while (enviadas < bloques.length) {
    const tanda = bloques.slice(enviadas, enviadas + ETIQUETAS_POR_TANDA);
    try {
      await enviarZPL(device, tanda.map((b) => b.Zpl).join("\n"));
    } catch (err) {
      const fallo = new Error(err.message);
      fallo.enviadas = enviadas;
      fallo.restantes = bloques.slice(enviadas);
      throw fallo;
    }
    enviadas += tanda.length;
    onProgreso?.(enviadas, bloques.length);
  }
}

// px en pantalla — límites de la maqueta (no un tamaño fijo): la escala se calcula para que la
// etiqueta quepa dentro de este recuadro sea cual sea su proporción real, en vez de forzar siempre
// el mismo ancho en pantalla (eso hacía que una etiqueta angosta y larga como 3x1 se viera gigante
// y desproporcionada — necesitaba un scroll enorme para verla completa).
const ANCHO_MAX_VISTA = 420;
const ALTO_MAX_VISTA = 420;

// Campos disponibles en la etiqueta — espejo de CAMPOS_DISENO/ETIQUETA_CAMPO_LABEL en backend/src/lib/zpl.ts.
// Los que no son de la orden real (Color/Origen/Congelación/Área/Fecha) vienen ocultos por defecto;
// se activan y se reposicionan desde el checklist de abajo cuando algún pedido los necesita.
const ETIQUETA_CAMPOS = [
  { key: "pedido", label: "Pedido", render: d => <span className="text-lg font-bold whitespace-nowrap">{d.codigoPedido}</span> },
  { key: "clienteSubcliente", label: "Cliente-Subcliente", render: d => <span className="text-sm whitespace-nowrap">{d.cliente}{d.subcliente ? `-${d.subcliente}` : ""}</span> },
  { key: "lote", label: "Lote", render: d => <span className="text-base font-mono font-semibold whitespace-nowrap">{d.lote}</span> },
  { key: "procesoTallaPresentacion", label: "Proceso + Talla + Presentación", render: d => <span className="text-sm whitespace-nowrap">{d.proceso} {d.talla}  {d.presentacion}</span> },
  { key: "color", label: "Color", render: d => <span className="text-sm whitespace-nowrap">{d.color || "-"}</span> },
  { key: "origen", label: "Origen", render: d => <span className="text-sm whitespace-nowrap">{d.origen || "-"}</span> },
  { key: "congelacion", label: "Congelación", render: d => <span className="text-sm whitespace-nowrap">{d.congelacion || "-"}</span> },
  { key: "area", label: "Área", render: d => <span className="text-sm whitespace-nowrap">{d.area || "-"}</span> },
  { key: "fechaProduccion", label: "Fecha Producción", render: d => <span className="text-sm whitespace-nowrap">{d.fechaProduccion || "-"}</span> },
  { key: "qr", label: "Código QR", render: () => <div className="w-14 h-14 border-2 border-gray-700 flex items-center justify-center text-[9px] text-gray-500 text-center">QR</div> },
  { key: "correlativoTexto", label: "Correlativo (texto)", render: d => <span className="text-xs text-gray-400 italic whitespace-nowrap">{d.correlativo === "(pendiente)" ? "correlativo se asigna al confirmar" : d.correlativo}</span> },
];

// Caja arrastrable de un campo de la etiqueta — componente propio (no se puede definir dentro de
// VistaPreviaModal: React recrearía el tipo de componente en cada render y perdería el estado).
function CampoArrastrable({ nombre, posiciones, escala, editando, onIniciarArrastre, children }) {
  return (
    <div onMouseDown={onIniciarArrastre(nombre)}
      className={`absolute ${editando ? "cursor-move ring-1 ring-dashed ring-blue-400" : ""}`}
      style={{ left: posiciones[nombre].X * escala, top: posiciones[nombre].Y * escala }}>
      {children}
    </div>
  );
}

// Maqueta HTML de la etiqueta — no es render exacto del ZPL, es para que el operador confirme los
// DATOS (cliente/lote/talla correctos) antes de gastar una etiqueta física, y para reposicionar los
// campos arrastrándolos cuando el diseño real no coincide (guarda las posiciones en DisenoEtiqueta,
// que es lo que también usa el backend al armar el ZPL real).
function VistaPreviaModal({ preview, onConfirmar, onCancelar, confirmando, progreso, onGuardarDiseno }) {
  const { AnchoPuntos, AltoPuntos, Datos: d } = preview;
  const pendientes = preview.orden.CantidadMaster - preview.orden.Impresas;
  const [editando, setEditando] = useState(false);
  const [posiciones, setPosiciones] = useState(preview.Posiciones);
  const [guardando, setGuardando] = useState(false);
  const arrastre = useRef(null);

  useEffect(() => { setPosiciones(preview.Posiciones); }, [preview.Posiciones]);

  const escala = Math.min(ANCHO_MAX_VISTA / AnchoPuntos, ALTO_MAX_VISTA / AltoPuntos);
  const anchoVista = AnchoPuntos * escala;
  const altoVista = AltoPuntos * escala;

  const iniciarArrastre = (campo) => (e) => {
    if (!editando) return;
    const contenedor = e.currentTarget.parentElement.getBoundingClientRect();
    arrastre.current = {
      campo,
      offsetX: e.clientX - contenedor.left - posiciones[campo].X * escala,
      offsetY: e.clientY - contenedor.top - posiciones[campo].Y * escala,
    };
  };
  const moverArrastre = (e) => {
    if (!arrastre.current) return;
    const contenedor = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.round((e.clientX - contenedor.left - arrastre.current.offsetX) / escala));
    const y = Math.max(0, Math.round((e.clientY - contenedor.top - arrastre.current.offsetY) / escala));
    setPosiciones(p => ({ ...p, [arrastre.current.campo]: { ...p[arrastre.current.campo], X: x, Y: y } }));
  };
  const soltarArrastre = () => { arrastre.current = null; };

  const guardarDiseno = async () => {
    setGuardando(true);
    try { await onGuardarDiseno(posiciones); setEditando(false); }
    finally { setGuardando(false); }
  };
  const cancelarEdicion = () => { setPosiciones(preview.Posiciones); setEditando(false); };
  const toggleVisible = (campo) => {
    setPosiciones(p => ({ ...p, [campo]: { ...p[campo], Visible: !p[campo].Visible } }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancelar(); }}>
      <div className={`bg-white rounded-2xl shadow-xl w-full flex flex-col max-h-full transition-all ${editando ? "max-w-3xl" : "max-w-lg"}`}>
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-800">Vista previa de la etiqueta</h2>
            <p className="text-xs text-gray-400 mt-0.5">Tamaño: {preview.Tamano} — verifica que coincida con el rollo cargado en la impresora</p>
          </div>
          <button onClick={onCancelar} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-5 flex flex-col md:flex-row gap-6 overflow-y-auto">
          <div className="mx-auto md:mx-0 shrink-0">
            <div className="relative border-2 border-gray-800 rounded-sm bg-white select-none"
              style={{ width: anchoVista, height: altoVista }}
              onMouseMove={moverArrastre} onMouseUp={soltarArrastre} onMouseLeave={soltarArrastre}>
              {ETIQUETA_CAMPOS.filter(c => posiciones[c.key].Visible).map(c => (
                <CampoArrastrable key={c.key} nombre={c.key} posiciones={posiciones} escala={escala} editando={editando} onIniciarArrastre={iniciarArrastre}>
                  {c.render(d)}
                </CampoArrastrable>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-3 text-center" style={{ width: Math.max(anchoVista, 220) }}>
              {editando
                ? "Arrastra cada campo para reposicionarlo."
                : `Esto es una maqueta de los datos, no el diseño exacto que imprime la Zebra. Al confirmar se imprimirán las ${pendientes} etiqueta${pendientes !== 1 ? "s" : ""} pendientes de esta captura.`}
            </p>
          </div>
          {editando && (
            <div className="flex-1 min-w-0 border-t md:border-t-0 md:border-l border-gray-200 pt-4 md:pt-0 md:pl-6">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Campos de la etiqueta</h3>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {ETIQUETA_CAMPOS.map(c => (
                  <label key={c.key} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-50 rounded px-1.5 py-1">
                    <input type="checkbox" checked={posiciones[c.key].Visible} onChange={() => toggleVisible(c.key)}
                      className="rounded border-gray-300" />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t flex justify-between items-center gap-3 shrink-0">
          {editando ? (
            <>
              <button onClick={cancelarEdicion} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
                Cancelar edición
              </button>
              <button onClick={guardarDiseno} disabled={guardando}
                className="px-5 py-2 text-sm bg-gray-800 text-white font-semibold rounded-lg hover:bg-gray-900 transition disabled:opacity-50">
                {guardando ? "Guardando..." : "Guardar diseño"}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setEditando(true)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
                Editar diseño
              </button>
              <div className="flex gap-3">
                <button onClick={onCancelar} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
                  Cancelar
                </button>
                <button onClick={onConfirmar} disabled={confirmando}
                  className="px-5 py-2 text-sm bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
                  {confirmando
                    ? (progreso ? `Imprimiendo ${progreso.hechas}/${progreso.total}...` : `Imprimiendo ${pendientes}...`)
                    : `Confirmar e imprimir (${pendientes})`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Aparece cuando una tanda falló a medias camino a la impresora: las etiquetas YA quedaron
// registradas (el cupo se consumió), solo faltó el envío físico de una parte. Ofrece reintentar
// exactamente los correlativos que faltaron, sin crear nuevos. Si se cierra, ese mismo rango se
// recupera después con "Reimprimir rango" en el historial de la captura.
function RecuperacionEnvioModal({ fallo, progreso, reintentando, onReintentar, onCerrar }) {
  const primera = fallo.bloques[0].Correlativo;
  const ultima = fallo.bloques[fallo.bloques.length - 1].Correlativo;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="px-6 py-4 border-b">
          <h2 className="text-base font-semibold text-red-700">La impresión se interrumpió</h2>
        </div>
        <div className="px-6 py-4 text-sm text-gray-700 space-y-2">
          <p>Se enviaron <b>{fallo.enviadas}</b> de <b>{fallo.total}</b> etiquetas a la impresora antes del error: <span className="text-red-600">{fallo.mensaje}</span></p>
          <p>
            Las <b>{fallo.bloques.length}</b> restantes (<span className="font-mono">{primera}</span> a <span className="font-mono">{ultima}</span>) ya
            están registradas en el sistema — al reintentar NO se crean correlativos nuevos, solo se vuelve a enviar lo que faltó.
          </p>
          <p className="text-xs text-gray-400">
            Revisa la impresora (rollo, atasco, Browser Print) antes de reintentar. Si cierras esta ventana, puedes recuperar el
            mismo rango después con "Reimprimir rango" en el historial de la captura.
          </p>
        </div>
        <div className="px-6 py-4 border-t flex justify-end gap-3">
          <button onClick={onCerrar} disabled={reintentando}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition disabled:opacity-50">
            Cerrar
          </button>
          <button onClick={onReintentar} disabled={reintentando}
            className="px-5 py-2 text-sm bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition disabled:opacity-50">
            {reintentando
              ? (progreso ? `Enviando ${progreso.hechas}/${progreso.total}...` : "Enviando...")
              : `Reintentar envío (${fallo.bloques.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}

// Reimpresión en bloque por rango de correlativos — la vía de recuperación cuando una tanda
// falló y ya no está abierta la ventana de reintento (o el problema se descubrió después, ej.
// etiquetas ilegibles por cabezal sucio). Exige motivo, igual que la reimpresión individual.
function ReimprimirRangoForm({ enCurso, progreso, onEjecutar }) {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [motivo, setMotivo] = useState("");
  const listo = desde.trim() && hasta.trim() && motivo.trim();
  return (
    <div className="mt-3 pt-3 border-t border-gray-200 flex flex-wrap items-center gap-2">
      <span className="text-xs text-gray-500">Reimprimir rango (recuperar tanda fallida):</span>
      <input type="text" value={desde} onChange={e => setDesde(e.target.value)} placeholder="Desde (ej. E120)"
        className="border border-gray-300 rounded-lg px-2 py-1 text-xs font-mono w-28 focus:outline-none focus:ring-2 focus:ring-orange-400" />
      <input type="text" value={hasta} onChange={e => setHasta(e.target.value)} placeholder="Hasta (ej. E180)"
        className="border border-gray-300 rounded-lg px-2 py-1 text-xs font-mono w-28 focus:outline-none focus:ring-2 focus:ring-orange-400" />
      <input type="text" value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Motivo (ej. atasco a mitad de tanda)"
        className="border border-gray-300 rounded-lg px-2 py-1 text-xs w-64 focus:outline-none focus:ring-2 focus:ring-orange-400" />
      <button disabled={!listo || enCurso} onClick={() => onEjecutar(desde.trim(), hasta.trim(), motivo.trim())}
        className="px-3 py-1.5 text-xs bg-orange-600 text-white font-semibold rounded-lg hover:bg-orange-700 transition disabled:opacity-50">
        {enCurso
          ? (progreso ? `Enviando ${progreso.hechas}/${progreso.total}...` : "Enviando...")
          : "Reimprimir rango"}
      </button>
    </div>
  );
}

export default function ImpresionEtiquetasPage() {
  const [ordenes, setOrdenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [device, setDevice] = useState(null);
  const [deviceError, setDeviceError] = useState("");
  const [expandidoId, setExpandidoId] = useState(null);
  const [etiquetas, setEtiquetas] = useState([]);
  const [ordenEnCurso, setOrdenEnCurso] = useState(null);
  const [preview, setPreview] = useState(null); // { orden, Tamano, AnchoPuntos, AltoPuntos, Datos }
  const [cargandoPreview, setCargandoPreview] = useState(false);
  const [fecha, setFecha] = useState("");
  const [tamanos, setTamanos] = useState([]);
  // "3x1" es el rollo que se usa por defecto hoy en planta (jul 2026, mientras se sigue usando ese
  // tamaño) — el operador puede cambiarlo si carga otro rollo.
  const [tamano, setTamano] = useState("3x1");
  const [progreso, setProgreso] = useState(null); // { hechas, total } durante un envío por tandas
  const [falloEnvio, setFalloEnvio] = useState(null); // { bloques, enviadas, total, mensaje, ordenId } si un envío quedó a medias
  const [reintentando, setReintentando] = useState(false);
  const [rangoEnCurso, setRangoEnCurso] = useState(null); // OrdenId con reimpresión de rango en marcha

  const fetchOrdenes = useCallback(async (fechaFiltro) => {
    setLoading(true);
    try {
      const url = fechaFiltro ? `/api/orden-etiquetado?fecha=${fechaFiltro}` : "/api/orden-etiquetado";
      const res = await fetch(url, { headers: authHeader() });
      const data = await res.json();
      if (Array.isArray(data)) setOrdenes(data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchOrdenes(fecha); }, [fetchOrdenes, fecha]);

  // Catálogo de tamaños de etiqueta (4x2/4x4/3x1/4x6, ver TAMANOS_ETIQUETA en backend/src/lib/zpl.ts)
  // — el operador elige a mano cuál está usando según el rollo físico cargado en la ZT411 en ese
  // momento, no hay forma de detectarlo automáticamente.
  useEffect(() => {
    fetch("/api/diseno-etiqueta/tamanos", { headers: authHeader() })
      .then(res => res.json())
      .then(data => { if (Array.isArray(data) && data.length) setTamanos(data); });
  }, []);

  // Solo para el indicador de estatus en pantalla — antes de cada impresión se vuelve a detectar
  // (ver detectarDispositivo), esto de aquí no se reusa para imprimir.
  useEffect(() => {
    detectarDispositivo()
      .then(dev => { setDevice(dev); setDeviceError(""); })
      .catch(err => setDeviceError(err.message));
  }, []);

  const cargarEtiquetas = useCallback(async (ordenId) => {
    const res = await fetch(`/api/etiqueta-impresa?orden=${ordenId}`, { headers: authHeader() });
    const data = await res.json();
    if (Array.isArray(data)) setEtiquetas(data);
  }, []);

  const toggleExpandir = (orden) => {
    if (expandidoId === orden.OrdenId) { setExpandidoId(null); setEtiquetas([]); return; }
    setExpandidoId(orden.OrdenId);
    cargarEtiquetas(orden.OrdenId);
  };

  const abrirVistaPrevia = async (orden) => {
    setCargandoPreview(true);
    try {
      const res = await fetch(`/api/etiqueta-impresa/vista-previa/${orden.OrdenId}?tamano=${tamano}`, { headers: authHeader() });
      const data = await res.json();
      if (!res.ok) { alert("Error: " + data.error); return; }
      setPreview({ orden, ...data });
    } finally { setCargandoPreview(false); }
  };

  const confirmarImpresion = async () => {
    const orden = preview.orden;
    setOrdenEnCurso(orden.OrdenId);
    setProgreso(null);
    try {
      // 1. Impresora verificada ANTES de registrar nada: si Browser Print está caído o la
      // impresora reporta un problema (sin rollo, cabezal abierto), se aborta aquí sin haber
      // consumido cupo ni creado correlativos huérfanos en la base de datos.
      let dispositivo;
      try {
        dispositivo = await verificarImpresora();
        setDevice(dispositivo); setDeviceError("");
      } catch (err) {
        alert("Impresora no lista — no se registró ninguna etiqueta.\n" + err.message);
        return;
      }
      // 2. Registrar la tanda completa (correlativos + cupo, transacción con candado en backend).
      const res = await fetch("/api/etiqueta-impresa", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ OrdenId: orden.OrdenId, Tamano: preview.Tamano }),
      });
      const data = await res.json();
      if (!res.ok) { alert("Error: " + data.error); return; }
      // 3. Enviar a la impresora en tandas con progreso; si falla a medias, abrir la ventana de
      // recuperación con exactamente los correlativos que faltaron.
      try {
        await enviarBloques(dispositivo, data.Bloques, (hechas, total) => setProgreso({ hechas, total }));
      } catch (err) {
        setPreview(null);
        setFalloEnvio({
          bloques: err.restantes, enviadas: err.enviadas, total: data.Bloques.length,
          mensaje: err.message, ordenId: orden.OrdenId,
        });
        return;
      }
      setPreview(null);
      alert(`Se imprimieron las ${data.Cantidad} etiquetas (${data.Bloques[0].Correlativo} a ${data.Bloques[data.Bloques.length - 1].Correlativo}).`);
    } catch (err) {
      alert("No se pudo imprimir: " + err.message);
    } finally {
      setOrdenEnCurso(null);
      setProgreso(null);
      fetchOrdenes(fecha);
      if (expandidoId === orden.OrdenId) cargarEtiquetas(orden.OrdenId);
    }
  };

  // Reintento desde la ventana de recuperación: reenvía SOLO los bloques que faltaron (ya
  // registrados). Si vuelve a fallar, la ventana se actualiza con lo que siga pendiente.
  const reintentarEnvio = async () => {
    setReintentando(true);
    setProgreso(null);
    try {
      let dispositivo;
      try {
        dispositivo = await verificarImpresora();
        setDevice(dispositivo); setDeviceError("");
      } catch (err) {
        alert("Impresora no lista: " + err.message);
        return;
      }
      try {
        await enviarBloques(dispositivo, falloEnvio.bloques, (hechas, total) => setProgreso({ hechas, total }));
        const ordenId = falloEnvio.ordenId;
        setFalloEnvio(null);
        if (expandidoId === ordenId) cargarEtiquetas(ordenId);
      } catch (err) {
        setFalloEnvio(f => ({
          ...f, enviadas: f.enviadas + err.enviadas, bloques: err.restantes, mensaje: err.message,
        }));
      }
    } finally {
      setReintentando(false);
      setProgreso(null);
    }
  };

  // Reimpresión en bloque por rango de correlativos (recuperación tardía de una tanda fallida).
  const reimprimirRango = async (orden, desde, hasta, motivo) => {
    setRangoEnCurso(orden.OrdenId);
    setProgreso(null);
    try {
      let dispositivo;
      try {
        dispositivo = await verificarImpresora();
        setDevice(dispositivo); setDeviceError("");
      } catch (err) {
        alert("Impresora no lista: " + err.message);
        return;
      }
      const res = await fetch("/api/etiqueta-impresa/reimprimir-bloque", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ OrdenId: orden.OrdenId, Desde: desde, Hasta: hasta, Motivo: motivo }),
      });
      const data = await res.json();
      if (!res.ok) { alert("Error: " + data.error); return; }
      try {
        await enviarBloques(dispositivo, data.Bloques, (hechas, total) => setProgreso({ hechas, total }));
      } catch (err) {
        setFalloEnvio({
          bloques: err.restantes, enviadas: err.enviadas, total: data.Bloques.length,
          mensaje: err.message, ordenId: orden.OrdenId,
        });
        return;
      }
      cargarEtiquetas(orden.OrdenId);
      alert(`Se reimprimieron ${data.Cantidad} etiquetas (${data.Desde} a ${data.Hasta}).`);
    } catch (err) {
      alert("No se pudo reimprimir el rango: " + err.message);
    } finally {
      setRangoEnCurso(null);
      setProgreso(null);
    }
  };

  const guardarDisenoEtiqueta = async (posiciones) => {
    const res = await fetch(`/api/diseno-etiqueta?tamano=${preview.Tamano}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(posiciones),
    });
    const data = await res.json();
    if (!res.ok) { alert("Error: " + data.error); return; }
    setPreview(p => (p ? { ...p, Posiciones: posiciones } : p));
  };

  const handleReimprimir = async (etiqueta) => {
    const motivo = prompt("Motivo de la reimpresión (ej. etiqueta dañada al pegar):");
    if (!motivo || !motivo.trim()) return;
    try {
      // Impresora verificada antes de registrar el evento en el log — mismo criterio que la
      // impresión en bloque: no dejar rastro en BD de algo que físicamente no va a salir.
      const dispositivo = await verificarImpresora();
      setDevice(dispositivo); setDeviceError("");
      const res = await fetch(`/api/etiqueta-impresa/${etiqueta.EtiquetaId}/reimprimir`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ Motivo: motivo.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { alert("Error: " + data.error); return; }
      await enviarZPL(dispositivo, data.Zpl);
      cargarEtiquetas(etiqueta.OrdenId);
    } catch (err) {
      alert("No se pudo reimprimir: " + err.message);
    }
  };

  const q = busqueda.toLowerCase();
  const capturas = ordenes
    .filter(o => o.Estatus !== "Cancelada")
    .filter(o => !q
      || o.CodigoPedido.toLowerCase().includes(q)
      || (o.NombreCliente || "").toLowerCase().includes(q)
      || o.Lote.toLowerCase().includes(q));
  const conPendientes = capturas.filter(o => o.Impresas < o.CantidadMaster).length;

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <input type="text" placeholder="Buscar por pedido, cliente o lote..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-blue-400" />
        <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        {fecha && (
          <button onClick={() => setFecha("")} className="text-xs text-gray-500 hover:text-gray-700 underline">Quitar fecha</button>
        )}
        <label className="flex items-center gap-2 text-sm text-gray-600">
          Rollo cargado:
          <select value={tamano} onChange={e => setTamano(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
            {tamanos.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <span className="text-sm text-gray-500">{capturas.length} captura{capturas.length !== 1 ? "s" : ""} ({conPendientes} pendiente{conPendientes !== 1 ? "s" : ""} de imprimir)</span>
        <div className={`ml-auto text-xs font-medium px-3 py-1.5 rounded-lg ${device ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
          {device ? `Impresora: ${device.name}` : deviceError || "Buscando impresora..."}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="bg-white rounded-xl shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                <th className="px-4 py-3 text-left whitespace-nowrap">Fecha Producción</th>
                <th className="px-4 py-3 text-left whitespace-nowrap">Pedido</th>
                <th className="px-4 py-3 text-left whitespace-nowrap">Cliente</th>
                <th className="px-4 py-3 text-left whitespace-nowrap">Clase · Talla</th>
                <th className="px-4 py-3 text-left whitespace-nowrap">Lote</th>
                <th className="px-4 py-3 text-right whitespace-nowrap">Declarado</th>
                <th className="px-4 py-3 text-right whitespace-nowrap">Impresas</th>
                <th className="px-4 py-3 text-center whitespace-nowrap">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {capturas.map(o => {
                const pend = o.CantidadMaster - o.Impresas;
                return (
                <Fragment key={o.OrdenId}>
                  <tr className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500">{String(o.FechaProduccion).slice(0, 10)}</td>
                    <td className="px-4 py-3 font-mono font-bold text-gray-700 whitespace-nowrap">{o.CodigoPedido}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{o.NombreCliente}{o.NombreSubcliente ? ` - ${o.NombreSubcliente}` : ""}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{o.DescripcionClase} · {o.DescripcionTalla}</td>
                    <td className="px-4 py-3 font-mono text-gray-700 whitespace-nowrap">{o.Lote}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{o.CantidadMaster}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{o.Impresas}</td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <div className="flex justify-center gap-2">
                        {pend > 0 ? (
                          <button onClick={() => abrirVistaPrevia(o)} disabled={cargandoPreview || ordenEnCurso === o.OrdenId}
                            className="px-3 py-1.5 text-xs bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
                            {ordenEnCurso === o.OrdenId ? "Imprimiendo..." : `Imprimir pendientes (${pend})`}
                          </button>
                        ) : (
                          <span className="px-3 py-1.5 text-xs bg-green-100 text-green-700 font-semibold rounded-lg">Completo</span>
                        )}
                        <button onClick={() => toggleExpandir(o)}
                          className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
                          {expandidoId === o.OrdenId ? "Ocultar" : "Historial"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandidoId === o.OrdenId && (
                    <tr>
                      <td colSpan={8} className="px-4 py-3 bg-gray-50">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-500 uppercase tracking-wider">
                              <th className="px-2 py-1 text-left">Correlativo</th>
                              <th className="px-2 py-1 text-left">Tamaño</th>
                              <th className="px-2 py-1 text-left">Estatus</th>
                              <th className="px-2 py-1 text-left">Impreso por</th>
                              <th className="px-2 py-1 text-left">Fecha</th>
                              <th className="px-2 py-1 text-right">Veces impresa</th>
                              <th className="px-2 py-1 text-center">Acciones</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {etiquetas.map(e => (
                              <tr key={e.EtiquetaId}>
                                <td className="px-2 py-1 font-mono">{e.Correlativo}</td>
                                <td className="px-2 py-1">{e.Tamano}</td>
                                <td className="px-2 py-1">{e.Estatus}</td>
                                <td className="px-2 py-1">{e.RegistradoPor}</td>
                                <td className="px-2 py-1">{e.CreadoEn?.slice(0, 16).replace("T", " ")}</td>
                                <td className="px-2 py-1 text-right">{e.VecesImpresa}</td>
                                <td className="px-2 py-1 text-center">
                                  <button onClick={() => handleReimprimir(e)} className="text-orange-600 hover:text-orange-800 font-medium">Reimprimir</button>
                                </td>
                              </tr>
                            ))}
                            {etiquetas.length === 0 && (
                              <tr><td colSpan={7} className="px-2 py-3 text-center text-gray-400">Sin etiquetas impresas todavía</td></tr>
                            )}
                          </tbody>
                        </table>
                        {etiquetas.length > 0 && (
                          <ReimprimirRangoForm enCurso={rangoEnCurso === o.OrdenId} progreso={rangoEnCurso === o.OrdenId ? progreso : null}
                            onEjecutar={(desde, hasta, motivo) => reimprimirRango(o, desde, hasta, motivo)} />
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
                );
              })}
              {capturas.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Sin capturas para los filtros seleccionados</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {preview && (
        <VistaPreviaModal preview={preview} confirmando={ordenEnCurso === preview.orden.OrdenId}
          progreso={ordenEnCurso === preview.orden.OrdenId ? progreso : null}
          onConfirmar={confirmarImpresion} onCancelar={() => setPreview(null)} onGuardarDiseno={guardarDisenoEtiqueta} />
      )}

      {falloEnvio && (
        <RecuperacionEnvioModal fallo={falloEnvio} progreso={progreso} reintentando={reintentando}
          onReintentar={reintentarEnvio}
          onCerrar={() => { setFalloEnvio(null); fetchOrdenes(fecha); }} />
      )}
    </div>
  );
}
