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

const ANCHO_VISTA = 480; // px en pantalla — la escala hacia puntos ZPL se calcula a partir de esto

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
function VistaPreviaModal({ preview, onConfirmar, onCancelar, confirmando, onGuardarDiseno }) {
  const { AnchoPuntos, AltoPuntos, Datos: d } = preview;
  const pendientes = preview.orden.CantidadMaster - preview.orden.Impresas;
  const [editando, setEditando] = useState(false);
  const [posiciones, setPosiciones] = useState(preview.Posiciones);
  const [guardando, setGuardando] = useState(false);
  const arrastre = useRef(null);

  useEffect(() => { setPosiciones(preview.Posiciones); }, [preview.Posiciones]);

  const escala = ANCHO_VISTA / AnchoPuntos;
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
              style={{ width: ANCHO_VISTA, height: altoVista }}
              onMouseMove={moverArrastre} onMouseUp={soltarArrastre} onMouseLeave={soltarArrastre}>
              {ETIQUETA_CAMPOS.filter(c => posiciones[c.key].Visible).map(c => (
                <CampoArrastrable key={c.key} nombre={c.key} posiciones={posiciones} escala={escala} editando={editando} onIniciarArrastre={iniciarArrastre}>
                  {c.render(d)}
                </CampoArrastrable>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-3 text-center" style={{ width: ANCHO_VISTA }}>
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
                  {confirmando ? `Imprimiendo ${pendientes}...` : `Confirmar e imprimir (${pendientes})`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
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
  const [tamano, setTamano] = useState("4x2");

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
    try {
      const res = await fetch("/api/etiqueta-impresa", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ OrdenId: orden.OrdenId, Tamano: preview.Tamano }),
      });
      const data = await res.json();
      if (!res.ok) { alert("Error: " + data.error); return; }
      const dispositivo = await detectarDispositivo();
      setDevice(dispositivo); setDeviceError("");
      await enviarZPL(dispositivo, data.Zpl);
      setPreview(null);
      fetchOrdenes(fecha);
      if (expandidoId === orden.OrdenId) cargarEtiquetas(orden.OrdenId);
    } catch (err) {
      alert("No se pudo imprimir: " + err.message);
    } finally { setOrdenEnCurso(null); }
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
      const res = await fetch(`/api/etiqueta-impresa/${etiqueta.EtiquetaId}/reimprimir`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ Motivo: motivo.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { alert("Error: " + data.error); return; }
      const dispositivo = await detectarDispositivo();
      setDevice(dispositivo); setDeviceError("");
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
          onConfirmar={confirmarImpresion} onCancelar={() => setPreview(null)} onGuardarDiseno={guardarDisenoEtiqueta} />
      )}
    </div>
  );
}
