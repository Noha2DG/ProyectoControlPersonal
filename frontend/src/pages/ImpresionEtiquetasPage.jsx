import { useState, useEffect, useCallback, Fragment } from "react";
import { authHeader, usePuede } from "../context/AuthContext.jsx";
import { useColWidths, Th, Colgroup } from "../components/ResizableTh.jsx";
import ConsultarEtiquetaModal from "../components/ConsultarEtiquetaModal.jsx";
import AvisoModal from "../components/AvisoModal.jsx";
import { useAviso } from "../hooks/useAviso.js";

// Toda la impresión física la hace BarTender leyendo ColaEtiquetaBartender por ODBC. Esta pantalla
// ya no habla con ninguna impresora: reserva correlativos y abre BarTender con el rango recién
// creado. El camino anterior (ZPL armado en el backend y enviado por Zebra Browser Print desde el
// navegador) se retiró en agosto 2026 junto con lib/zpl.ts, la tabla DisenoEtiqueta y el XML de
// prueba para Zebra.

const COL_DEFAULTS = {
  fecha: 120, pedido: 110, cliente: 150, proceso: 140, lote: 130, declarado: 100, generadas: 100,
  enPapel: 100, escaneadas: 100, linea: 140, acciones: 220,
};
const COLS = Object.keys(COL_DEFAULTS);

const LINEA_BADGE = {
  Completo:   "bg-green-100 text-green-700",
  Incompleto: "bg-orange-100 text-orange-700",
  Sobrante:   "bg-red-100 text-red-700",
};
function cuadreLinea(objetivo, escaneado) {
  if (objetivo == null || escaneado == null) return null;
  if (escaneado === objetivo) return "Completo";
  return escaneado < objetivo ? "Incompleto" : "Sobrante";
}

const HIST_COL_DEFAULTS = { correlativo: 110, estatus: 90, impresoPor: 110, fecha: 130, veces: 100, acciones: 110 };
const HIST_COLS = Object.keys(HIST_COL_DEFAULTS);

// Navega al protocolo oroetiqueta://, que un manejador registrado en Windows traduce al comando de
// BarTender (ver herramientas/bartender/). Se usa un <a> con clic sintético y no
// window.location.href: Chromium trata mejor el clic sobre un enlace para protocolos externos, y no
// deja una navegación fallida en el historial si el protocolo no está instalado en esta PC.
function lanzarProtocolo(url) {
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.style.display = "none";
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
}

// Lista de etiquetas impresas hace más de 24h sin master correspondiente en bodega — la señal más
// temprana de una etiqueta perdida, pegada a la caja equivocada, o simplemente olvidada en algún
// rincón de planta. Solo lectura: la corrección real (anular, o investigar y escanearla) se hace
// desde el historial de la captura o desde Bodega.
function AtascadasModal({ atascadas, onCerrar }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl flex flex-col max-h-full">
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-800">Etiquetas impresas sin escanear (+24h)</h2>
            <p className="text-xs text-gray-400 mt-0.5">Puede ser una etiqueta perdida, mal pegada, o el master sigue en planta — vale la pena revisarlo.</p>
          </div>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <div className="overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500 uppercase tracking-wider sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left">Correlativo</th>
                <th className="px-3 py-2 text-left">Pedido</th>
                <th className="px-3 py-2 text-left">Cliente</th>
                <th className="px-3 py-2 text-left">Lote</th>
                <th className="px-3 py-2 text-left">Producto</th>
                <th className="px-3 py-2 text-left">Impreso por</th>
                <th className="px-3 py-2 text-right">Hace</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {atascadas.map(a => (
                <tr key={a.EtiquetaId}>
                  <td className="px-3 py-2 font-mono">{a.Correlativo}</td>
                  <td className="px-3 py-2 font-mono">{a.CodigoPedido}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{a.NombreCliente}{a.NombreSubcliente ? `-${a.NombreSubcliente}` : ""}</td>
                  <td className="px-3 py-2 font-mono whitespace-nowrap">{a.Lote}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{a.DescripcionProceso} {a.DescripcionTalla} {a.DescripcionPresentacion}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{a.RegistradoPor}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-amber-700 font-semibold">{a.HorasDesdeImpresion}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function ImpresionEtiquetasPage() {
  const puedeImprimir = usePuede("etiquetado", "imprimir");
  const puedeEditar = usePuede("etiquetado", "editar");
  const { aviso, mostrarAlerta, pedirConfirmacion, cerrar } = useAviso();
  const [ordenes, setOrdenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [expandidoId, setExpandidoId] = useState(null);
  const [etiquetas, setEtiquetas] = useState([]);
  const [mostrarConsulta, setMostrarConsulta] = useState(false);
  const [atascadas, setAtascadas] = useState([]);
  const [mostrarAtascadas, setMostrarAtascadas] = useState(false);
  const [ordenEnCurso, setOrdenEnCurso] = useState(null);
  // Arranca en hoy: lo normal es etiquetar lo que se produjo el mismo día, y sin filtro la tabla
  // trae hasta 500 capturas históricas. La zona horaria va explícita —igual que en el resto del
  // proyecto— porque toISOString() daría UTC y en Guatemala (UTC-6) eso cambia de día a las 18:00.
  const [fecha, setFecha] = useState(() =>
    new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" }));
  const [widths, startResize] = useColWidths("etiquetas_ordenes", COL_DEFAULTS);
  const [widthsHist, startResizeHist] = useColWidths("etiquetas_historial", HIST_COL_DEFAULTS);

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

  // Alerta de etiquetas impresas hace más de 24h sin master correspondiente en bodega — se carga
  // sola al entrar (no hace falta buscarla) para que el conteo funcione como aviso real, no algo que
  // solo se ve si a alguien se le ocurre revisar.
  const fetchAtascadas = useCallback(async () => {
    const res = await fetch("/api/etiqueta-impresa/atascadas", { headers: authHeader() });
    const data = await res.json();
    if (Array.isArray(data)) setAtascadas(data);
  }, []);
  useEffect(() => { fetchAtascadas(); }, [fetchAtascadas]);

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

  // Marca en la cola lo que el operador dice haber visto salir. Compartido por los dos caminos que
  // llevan a lo mismo: el aviso que sale justo después de imprimir y el botón ámbar de la tabla.
  const marcarImpresas = async (ordenId, desde = null, hasta = null) => {
    try {
      const res = await fetch(`/api/etiqueta-impresa/orden/${ordenId}/confirmar-impresion`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify(desde != null && hasta != null ? { Desde: desde, Hasta: hasta } : {}),
      });
      const data = await res.json();
      if (!res.ok) { await mostrarAlerta("Error: " + data.error); return false; }
      return true;
    } catch (err) {
      await mostrarAlerta("No se pudo confirmar: " + err.message);
      return false;
    } finally {
      fetchOrdenes(fecha);
    }
  };

  // Pide al backend la plantilla y el rango, confirma con el operador y lanza el protocolo.
  // desde/hasta son EtiquetaId numéricos; si van en null, el backend abre todo lo activo de la orden.
  const abrirBartender = async (ordenId, desde = null, hasta = null) => {
    const params = desde != null && hasta != null ? `?desde=${desde}&hasta=${hasta}` : "";
    const res = await fetch(`/api/etiqueta-impresa/orden/${ordenId}/bartender${params}`, { headers: authHeader() });
    const data = await res.json();
    if (!res.ok) { await mostrarAlerta(data.error); return false; }

    const nombre = data.RutaBtw.split(/[\\/]/).pop();
    const confirmado = await pedirConfirmacion(
      `Se abrirá BarTender con:\n\n` +
      `Diseño: ${nombre}\n` +
      `Cliente: ${data.Subcliente || data.Cliente}\n` +
      `Correlativos: ${data.Correlativos} (${data.Etiquetas} etiqueta(s))\n` +
      (data.Pendientes < data.Etiquetas
        ? `Ya impresas en BarTender: ${data.Etiquetas - data.Pendientes} · pendientes: ${data.Pendientes}\n`
        : `Ninguna se ha impreso todavía en BarTender.\n`) + `\n` +
      `Si no ocurre nada, esta PC no tiene instalado el enlace con BarTender ` +
      `(ver herramientas/bartender/instalarProtocolo.ps1).`,
      { textoConfirmar: "Abrir BarTender" }
    );
    if (!confirmado) return false;

    // Deja reservada la tanda ANTES de lanzar. La plantilla de BarTender ya no filtra por rango:
    // lee lo que quedó marcado como "imprimir ahora" (SolicitadoEn), así que su consulta es una
    // línea fija y no hace falta configurar solicitudes de consulta en cada diseño.
    //
    // Si la reserva falla no se abre BarTender: es preferible un error a la vista que una plantilla
    // que salga con la tanda anterior — el operador no tendría cómo notar la diferencia.
    const resReserva = await fetch(`/api/etiqueta-impresa/orden/${ordenId}/reservar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ Desde: data.Desde, Hasta: data.Hasta }),
    });
    const reserva = await resReserva.json();
    if (!resReserva.ok) { await mostrarAlerta("No se pudo preparar la tanda: " + reserva.error); return false; }
    if (!reserva.Reservadas) {
      await mostrarAlerta(
        "No quedó ninguna etiqueta por imprimir en ese rango — ya están todas confirmadas. " +
        "Si necesitas volver a sacarlas, usa la reimpresión.", "advertencia");
      return false;
    }

    lanzarProtocolo(data.Url);

    // El aviso sale AQUÍ, no como un botón que haya que ir a buscar después: este es el momento en
    // que el operador tiene la impresora enfrente. Es el mismo flujo del sistema anterior, que
    // confirmaba por mensaje al terminar de imprimir.
    //
    // Se pregunta por el rango exacto que se acaba de abrir (data.Desde/data.Hasta), no por toda la
    // captura: si alguien abre dos tandas seguidas, cada aviso confirma la suya.
    //
    // Si algún día BarTender avisa solo — la acción del evento "Trabajo de impresión enviado" —
    // esto queda redundante pero inofensivo: la captura ya llega confirmada y no hay nada que marcar.
    const salieron = await pedirConfirmacion(
      `BarTender se abrió con ${data.Correlativos}.

` +
      `Cuando termine de imprimir, confirma aquí.

` +
      `Responde "Sí, salieron" SOLO si viste las etiquetas salir de la impresora. Si algo falló ` +
      `—atasco, impresora apagada, cerraste el diálogo sin imprimir— responde "Todavía no" y ` +
      `quedan pendientes para volver a intentarlo.`,
      { textoConfirmar: "Sí, salieron", textoCancelar: "Todavía no" }
    );
    if (salieron) await marcarImpresas(ordenId, data.Desde, data.Hasta);
    return true;
  };

  // Reserva los correlativos pendientes de la captura y abre BarTender con ese rango recién creado.
  // El registro va primero a propósito: los correlativos deben existir en la cola antes de que
  // BarTender los consulte por ODBC.
  const imprimirPendientes = async (orden) => {
    // Aviso (no bloqueo) si la línea de pedido ya alcanzó su objetivo según lo confirmado en bodega
    // — la línea puede tener una razón legítima para seguir (reemplazo de producto rechazado).
    if (orden.ObjetivoLinea != null && orden.EscaneadoLinea >= orden.ObjetivoLinea) {
      const seguir = await pedirConfirmacion(
        `La línea de este pedido (${orden.CodigoPedido} · ${orden.DescripcionProceso} · ${orden.DescripcionTalla}) ya tiene ` +
        `${orden.EscaneadoLinea}/${orden.ObjetivoLinea} masters escaneados en bodega — ya alcanzó su objetivo.\n\n` +
        `¿Continuar de todas formas generando más etiquetas de esta captura?`,
        { textoConfirmar: "Continuar de todas formas" }
      );
      if (!seguir) return;
    }

    setOrdenEnCurso(orden.OrdenId);
    try {
      const res = await fetch("/api/etiqueta-impresa", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ OrdenId: orden.OrdenId, ConfirmarLineaCompleta: true }),
      });
      const data = await res.json();
      if (res.status === 409 && data.LineaCompleta) { await mostrarAlerta(data.error, "advertencia"); return; }
      if (!res.ok) { await mostrarAlerta("Error: " + data.error); return; }

      // Los correlativos vienen como "E123": el rango que espera BarTender es el número.
      const ids = data.Correlativos.map(c => Number(String(c).replace(/^E/, "")));
      await abrirBartender(orden.OrdenId, Math.min(...ids), Math.max(...ids));
    } catch (err) {
      await mostrarAlerta("No se pudo generar la tanda: " + err.message);
    } finally {
      setOrdenEnCurso(null);
      fetchOrdenes(fecha);
      if (expandidoId === orden.OrdenId) cargarEtiquetas(orden.OrdenId);
    }
  };

  // Confirmación humana de que la tanda salió en papel. Es la salida cuando BarTender no avisa
  // solo; el texto pide ver el papel antes de confirmar, no dar por hecho que salió.
  const confirmarImpresion = async (orden) => {
    const faltan = orden.CantidadMaster - (orden.EnPapel ?? 0);
    const ok = await pedirConfirmacion(
      `Vas a marcar ${faltan} etiqueta(s) de esta captura como impresas en papel.

` +
      `${orden.CodigoPedido} · ${orden.DescripcionProceso} · ${orden.DescripcionTalla}
` +
      `Lote ${orden.Lote}

` +
      `Hazlo SOLO si ya viste salir las etiquetas de la impresora. Quedará registrado que lo ` +
      `confirmaste tú, y una vez marcadas dejan de aparecer como pendientes en BarTender.`,
      { textoConfirmar: "Sí, ya salieron en papel" }
    );
    if (!ok) return;
    setOrdenEnCurso(orden.OrdenId);
    try {
      await marcarImpresas(orden.OrdenId);
    } finally {
      setOrdenEnCurso(null);
    }
  };

  // Anular saca de circulación una etiqueta cuyo master físico nunca va a llegar a bodega (producto
  // dañado/reprocesado antes de sellar) — sin esto quedaba "Activa" para siempre, contando como
  // impresa pero sin poder escanearse jamás.
  const handleAnular = async (etiqueta) => {
    const motivo = prompt("Motivo de la anulación (ej. producto dañado antes de llegar a bodega):");
    if (!motivo || !motivo.trim()) return;
    try {
      const res = await fetch(`/api/etiqueta-impresa/${etiqueta.EtiquetaId}/anular`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ Motivo: motivo.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { await mostrarAlerta("Error: " + data.error); return; }
      cargarEtiquetas(etiqueta.OrdenId);
      fetchOrdenes(fecha);
    } catch (err) {
      await mostrarAlerta("No se pudo anular: " + err.message);
    }
  };

  const handleReactivar = async (etiqueta) => {
    const confirmado = await pedirConfirmacion(
      `¿Reactivar ${etiqueta.Correlativo}? Volverá a contar como etiqueta activa y a poder escanearse en bodega.`,
      { textoConfirmar: "Reactivar" }
    );
    if (!confirmado) return;
    try {
      const res = await fetch(`/api/etiqueta-impresa/${etiqueta.EtiquetaId}/reactivar`, { method: "PUT", headers: authHeader() });
      const data = await res.json();
      if (!res.ok) { await mostrarAlerta("Error: " + data.error); return; }
      cargarEtiquetas(etiqueta.OrdenId);
      fetchOrdenes(fecha);
    } catch (err) {
      await mostrarAlerta("No se pudo reactivar: " + err.message);
    }
  };

  const q = busqueda.toLowerCase();
  const capturas = ordenes
    .filter(o => o.Estatus !== "Cancelada")
    .filter(o => !q
      || o.CodigoPedido.toLowerCase().includes(q)
      || (o.NombreCliente || "").toLowerCase().includes(q)
      || o.Lote.toLowerCase().includes(q));
  // "Sin imprimir" se mide contra lo que BarTender confirmó en papel, no contra los correlativos
  // generados: generar un correlativo no imprime nada, y confundir las dos cosas es justo lo que
  // hacía que una captura se viera completa con la impresora sin tocar.
  const sinImprimir = capturas.filter(o => (o.EnPapel ?? 0) < o.CantidadMaster).length;

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
        <span className="text-sm text-gray-500">{capturas.length} captura{capturas.length !== 1 ? "s" : ""} ({sinImprimir} sin imprimir en BarTender)</span>
        <button onClick={() => setMostrarConsulta(true)}
          className="text-sm text-blue-600 border border-blue-200 rounded-lg px-3 py-2 hover:bg-blue-50 transition">
          Consultar etiqueta
        </button>
        {atascadas.length > 0 && (
          <button onClick={() => setMostrarAtascadas(true)}
            className="text-sm text-amber-700 border border-amber-300 bg-amber-50 rounded-lg px-3 py-2 hover:bg-amber-100 transition font-medium">
            ⚠ {atascadas.length} sin escanear +24h
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="bg-white rounded-xl shadow overflow-x-auto">
          <table className="w-full text-sm table-fixed">
            <Colgroup columns={COLS} widths={widths} />
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                <Th width={widths.fecha} onResizeStart={startResize("fecha")} className="px-4 py-3 text-left whitespace-nowrap">Fecha Producción</Th>
                <Th width={widths.pedido} onResizeStart={startResize("pedido")} className="px-4 py-3 text-left whitespace-nowrap">Pedido</Th>
                <Th width={widths.cliente} onResizeStart={startResize("cliente")} className="px-4 py-3 text-left whitespace-nowrap">Cliente</Th>
                <Th width={widths.proceso} onResizeStart={startResize("proceso")} className="px-4 py-3 text-left whitespace-nowrap">Proceso · Talla</Th>
                <Th width={widths.lote} onResizeStart={startResize("lote")} className="px-4 py-3 text-left whitespace-nowrap">Lote</Th>
                <Th width={widths.declarado} onResizeStart={startResize("declarado")} className="px-4 py-3 text-right whitespace-nowrap">Declarado</Th>
                <Th width={widths.generadas} onResizeStart={startResize("generadas")} className="px-4 py-3 text-right whitespace-nowrap" title="Correlativos reservados en el sistema — todavía no dicen nada del papel">Generadas</Th>
                <Th width={widths.enPapel} onResizeStart={startResize("enPapel")} className="px-4 py-3 text-right whitespace-nowrap" title="Confirmadas por BarTender al mandarlas a la impresora">En papel</Th>
                <Th width={widths.escaneadas} onResizeStart={startResize("escaneadas")} className="px-4 py-3 text-right whitespace-nowrap">Escaneadas</Th>
                <Th width={widths.linea} onResizeStart={startResize("linea")} className="px-4 py-3 text-center whitespace-nowrap">Pedido</Th>
                <Th width={widths.acciones} onResizeStart={startResize("acciones")} className="px-4 py-3 text-center whitespace-nowrap">Acciones</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {capturas.map(o => {
                const pend = o.CantidadMaster - o.Impresas;
                const enPapel = o.EnPapel ?? 0;
                const faltaPapel = o.CantidadMaster - enPapel;
                const cuadre = cuadreLinea(o.ObjetivoLinea, o.EscaneadoLinea);
                return (
                <Fragment key={o.OrdenId}>
                  <tr className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500">{String(o.FechaProduccion).slice(0, 10)}</td>
                    <td className="px-4 py-3 font-mono font-bold text-gray-700 whitespace-nowrap">{o.CodigoPedido}</td>
                    <td className="px-4 py-3 truncate" title={`${o.NombreCliente}${o.NombreSubcliente ? ` - ${o.NombreSubcliente}` : ""}`}>{o.NombreCliente}{o.NombreSubcliente ? ` - ${o.NombreSubcliente}` : ""}</td>
                    <td className="px-4 py-3 truncate" title={`${o.DescripcionProceso} · ${o.DescripcionTalla}`}>{o.DescripcionProceso} · {o.DescripcionTalla}</td>
                    <td className="px-4 py-3 font-mono text-gray-700 truncate" title={o.Lote}>{o.Lote}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{o.CantidadMaster}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{o.Impresas}</td>
                    <td className={`px-4 py-3 text-right whitespace-nowrap font-semibold ${enPapel === 0 ? "text-gray-400" : enPapel >= o.Impresas ? "text-green-700" : "text-amber-700"}`}
                      title={enPapel >= o.Impresas ? "BarTender confirmó todas" : `BarTender confirmó ${enPapel} de ${o.Impresas} generadas`}>
                      {enPapel}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{o.Escaneadas}</td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      {cuadre && (
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${LINEA_BADGE[cuadre]}`} title={`${o.EscaneadoLinea}/${o.ObjetivoLinea} masters de la línea escaneados en bodega`}>
                          {o.EscaneadoLinea}/{o.ObjetivoLinea}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <div className="flex justify-center gap-2">
                        {pend > 0 && puedeImprimir ? (
                          <button onClick={() => imprimirPendientes(o)} disabled={ordenEnCurso === o.OrdenId}
                            title="Reserva los correlativos pendientes y abre BarTender con ese rango"
                            className="px-3 py-1.5 text-xs bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
                            {ordenEnCurso === o.OrdenId ? "Generando..." : `Imprimir pendientes (${pend})`}
                          </button>
                        ) : pend > 0 ? null : faltaPapel > 0 ? (
                          <button onClick={() => confirmarImpresion(o)} disabled={ordenEnCurso === o.OrdenId}
                            title="BarTender no avisó que las imprimió. Si ya viste el papel, confírmalo aquí."
                            className="px-3 py-1.5 text-xs bg-amber-100 text-amber-700 font-semibold rounded-lg hover:bg-amber-200 transition disabled:opacity-50">
                            Falta imprimir {faltaPapel}
                          </button>
                        ) : (
                          <span className="px-3 py-1.5 text-xs bg-green-100 text-green-700 font-semibold rounded-lg">Impreso</span>
                        )}
                        {o.Impresas > 0 && puedeImprimir && (
                          <button onClick={() => abrirBartender(o.OrdenId)} disabled={ordenEnCurso === o.OrdenId}
                            title="Reabre en BarTender los correlativos ya generados de esta captura"
                            className="px-3 py-1.5 text-xs text-indigo-700 border border-indigo-300 font-semibold rounded-lg hover:bg-indigo-50 transition disabled:opacity-50">
                            BarTender
                          </button>
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
                      <td colSpan={11} className="px-4 py-3 bg-gray-50">
                        <table className="w-full text-xs table-fixed">
                          <Colgroup columns={HIST_COLS} widths={widthsHist} />
                          <thead>
                            <tr className="text-gray-500 uppercase tracking-wider">
                              <Th width={widthsHist.correlativo} onResizeStart={startResizeHist("correlativo")} className="px-2 py-1 text-left">Correlativo</Th>
                              <Th width={widthsHist.estatus} onResizeStart={startResizeHist("estatus")} className="px-2 py-1 text-left">Estatus</Th>
                              <Th width={widthsHist.impresoPor} onResizeStart={startResizeHist("impresoPor")} className="px-2 py-1 text-left">Registrado por</Th>
                              <Th width={widthsHist.fecha} onResizeStart={startResizeHist("fecha")} className="px-2 py-1 text-left">Fecha</Th>
                              <Th width={widthsHist.veces} onResizeStart={startResizeHist("veces")} className="px-2 py-1 text-right">Veces impresa</Th>
                              <Th width={widthsHist.acciones} onResizeStart={startResizeHist("acciones")} className="px-2 py-1 text-center">Acciones</Th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {etiquetas.map(e => (
                              <tr key={e.EtiquetaId}>
                                <td className="px-2 py-1 font-mono">{e.Correlativo}</td>
                                <td className="px-2 py-1">{e.Estatus}</td>
                                <td className="px-2 py-1 truncate" title={e.RegistradoPor}>{e.RegistradoPor}</td>
                                <td className="px-2 py-1">{e.CreadoEn?.slice(0, 16).replace("T", " ")}</td>
                                <td className="px-2 py-1 text-right">{e.VecesImpresa}</td>
                                <td className="px-2 py-1 text-center space-x-2">
                                  {e.Estatus === "Activa" && puedeEditar && (
                                    <button onClick={() => handleAnular(e)} className="text-red-600 hover:text-red-800 font-medium">Anular</button>
                                  )}
                                  {e.Estatus === "Anulada" && puedeEditar && (
                                    <button onClick={() => handleReactivar(e)} className="text-blue-600 hover:text-blue-800 font-medium">Reactivar</button>
                                  )}
                                </td>
                              </tr>
                            ))}
                            {etiquetas.length === 0 && (
                              <tr><td colSpan={6} className="px-2 py-3 text-center text-gray-400">Sin etiquetas generadas todavía</td></tr>
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
                <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">Sin capturas para los filtros seleccionados</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {mostrarConsulta && <ConsultarEtiquetaModal onCerrar={() => setMostrarConsulta(false)} />}
      {mostrarAtascadas && <AtascadasModal atascadas={atascadas} onCerrar={() => setMostrarAtascadas(false)} />}
      {aviso && <AvisoModal {...aviso} onCerrar={() => cerrar(true)} onCancelar={() => cerrar(false)} />}
    </div>
  );
}
