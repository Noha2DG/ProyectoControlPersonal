import { useState, useEffect, useCallback } from "react";
import { authHeader, usePuede } from "../context/AuthContext.jsx";
import { componerCodigoLote, piscinaRequiereCiclo } from "../utils/codigoLote.js";
import { useColWidths, Th, Colgroup } from "../components/ResizableTh.jsx";

const hoy = () => new Date().toLocaleDateString("sv-SE");

const COL_DEFAULTS = { fecha: 100, lote: 140, area: 100, origen: 110, congelacion: 120, masters: 90, estatus: 110, impresion: 140, acciones: 130 };
const COLS = Object.keys(COL_DEFAULTS);

// Áreas de la tabla Areas relevantes para Etiquetado — el catálogo completo trae áreas de todo
// el resto de la planta (RRHH, cafetería, etc.) que no aplican aquí.
const AREAS_ETIQUETADO = ["EF", "ES", "MV", "EY", "RE"]; // Tunel, Masterizado Entero, Masterizado Varios, Reempaque, Reetiquetado

const FORM_VACIO = { Finca: "", PiscinaId: "", Ciclo: "", AreaCodigo: "", FechaProduccion: hoy(), Color: "SC", Origen: "", Congelacion: "", CantidadMaster: "" };

export default function EtiquetadoPage() {
  const puedeCrear = usePuede("etiquetado", "crear");
  const puedeEditar = usePuede("etiquetado", "editar");
  const puedeEliminar = usePuede("etiquetado", "eliminar");
  const [pedidos, setPedidos] = useState([]);
  const [busquedaPedido, setBusquedaPedido] = useState("");
  const [pedidoSel, setPedidoSel] = useState(null);
  const [detalles, setDetalles] = useState([]);
  const [detalleSel, setDetalleSel] = useState(null);

  const [clases, setClases] = useState([]);
  const [procesos, setProcesos] = useState([]);
  const [tallas, setTallas] = useState([]);
  const [presentaciones, setPresentaciones] = useState([]);
  const [empaques, setEmpaques] = useState([]);
  const [fincas, setFincas] = useState([]);
  const [piscinas, setPiscinas] = useState([]);
  const [areas, setAreas] = useState([]);
  const [origenes, setOrigenes] = useState([]);
  const [congelaciones, setCongelaciones] = useState([]);

  const [resumen, setResumen] = useState(null);
  const [capturas, setCapturas] = useState([]);
  const [form, setForm] = useState(FORM_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [loading, setLoading] = useState(true);
  const [widths, startResize] = useColWidths("etiquetado", COL_DEFAULTS);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/pedidos", { headers: authHeader() }).then(r => r.json()),
      fetch("/api/clase", { headers: authHeader() }).then(r => r.json()),
      fetch("/api/procesos", { headers: authHeader() }).then(r => r.json()),
      fetch("/api/tallas", { headers: authHeader() }).then(r => r.json()),
      fetch("/api/presentacion", { headers: authHeader() }).then(r => r.json()),
      fetch("/api/empaques", { headers: authHeader() }).then(r => r.json()),
      fetch("/api/finca", { headers: authHeader() }).then(r => r.json()),
      fetch("/api/areas", { headers: authHeader() }).then(r => r.json()),
      fetch("/api/origen", { headers: authHeader() }).then(r => r.json()),
      fetch("/api/unidades-congelacion", { headers: authHeader() }).then(r => r.json()),
    ]).then(([ped, cl, pc, ta, pr, em, fi, ar, or, co]) => {
      if (Array.isArray(ped)) setPedidos(ped);
      if (Array.isArray(cl)) setClases(cl);
      if (Array.isArray(pc)) setProcesos(pc);
      if (Array.isArray(ta)) setTallas(ta);
      if (Array.isArray(pr)) setPresentaciones(pr);
      if (Array.isArray(em)) setEmpaques(em);
      if (Array.isArray(fi)) setFincas(fi.filter(f => f.Activo));
      if (Array.isArray(ar)) setAreas(ar.filter(a => a.Activa && AREAS_ETIQUETADO.includes(a.Codigo)).sort((a, b) => a.Nombre.localeCompare(b.Nombre)));
      if (Array.isArray(or)) setOrigenes(or.filter(o => o.Activo));
      if (Array.isArray(co)) setCongelaciones(co.filter(c => c.Activo));
    }).finally(() => setLoading(false));
  }, []);

  // Piscinas filtradas por la Finca elegida en el formulario — se limpia la Piscina seleccionada
  // cada vez que cambia la Finca para no dejar una combinación inconsistente.
  useEffect(() => {
    if (!form.Finca) { setPiscinas([]); return; }
    fetch(`/api/piscina?finca=${encodeURIComponent(form.Finca)}`, { headers: authHeader() })
      .then(r => r.json()).then(d => { if (Array.isArray(d)) setPiscinas(d.filter(p => p.Activo)); });
  }, [form.Finca]);

  const descClase = c => clases.find(x => x.Clase === c)?.Descripcion || c;
  const descProcesoDeClase = c => {
    const proceso = clases.find(x => x.Clase === c)?.Proceso;
    return procesos.find(x => x.Proceso === Number(proceso))?.Descripcion || proceso || c;
  };
  const descTalla = t => tallas.find(x => String(x.Codigo) === String(t))?.Descripcion || t;
  const descPresentacion = p => presentaciones.find(x => x.Codigo === p)?.Descripcion || p;
  const descEmpaque = e => empaques.find(x => x.Codigo === e)?.Descripcion || e;

  const seleccionarPedido = async (p) => {
    setPedidoSel(p);
    setDetalleSel(null);
    setResumen(null);
    setCapturas([]);
    const res = await fetch(`/api/detalle-pedido?pedido=${encodeURIComponent(p.CodigoPedido)}`, { headers: authHeader() });
    const data = await res.json();
    if (Array.isArray(data)) setDetalles(data);
  };

  const cargarLinea = useCallback(async (detalleId) => {
    const [rResumen, rCapturas] = await Promise.all([
      fetch(`/api/orden-etiquetado/resumen/${detalleId}`, { headers: authHeader() }),
      fetch(`/api/orden-etiquetado?detalle=${detalleId}`, { headers: authHeader() }),
    ]);
    setResumen(await rResumen.json());
    const dataCapturas = await rCapturas.json();
    if (Array.isArray(dataCapturas)) setCapturas(dataCapturas);
  }, []);

  const [editando, setEditando] = useState(null); // OrdenId de la captura en edición, o null = captura nueva

  const seleccionarLinea = (d) => {
    setDetalleSel(d);
    setForm(FORM_VACIO);
    setEditando(null);
    cargarLinea(d.DetalleId);
  };

  const set = f => e => setForm(p => ({ ...p, [f]: e.target.value }));

  const handleEditar = (captura) => {
    setEditando(captura.OrdenId);
    setForm({
      Finca: captura.CodigoFinca,
      PiscinaId: String(captura.PiscinaId),
      Ciclo: captura.Ciclo,
      AreaCodigo: captura.AreaCodigo || "",
      FechaProduccion: captura.FechaProduccion?.slice(0, 10),
      Color: captura.Color || "SC",
      Origen: captura.Origen,
      Congelacion: captura.Congelacion,
      CantidadMaster: captura.CantidadMaster,
    });
  };

  const cancelarEdicion = () => { setEditando(null); setForm(FORM_VACIO); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!detalleSel) return;
    setGuardando(true);
    try {
      // Finca solo se usa para filtrar Piscina en el formulario, no viaja al backend
      const { PiscinaId, Ciclo, AreaCodigo, FechaProduccion, Color, Origen, Congelacion, CantidadMaster } = form;
      const datos = { PiscinaId, Ciclo, AreaCodigo, FechaProduccion, Color, Origen, Congelacion, CantidadMaster };
      const res = editando
        ? await fetch(`/api/orden-etiquetado/${editando}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", ...authHeader() },
            body: JSON.stringify(datos),
          })
        : await fetch("/api/orden-etiquetado", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeader() },
            body: JSON.stringify({ ...datos, DetalleId: detalleSel.DetalleId }),
          });
      if (res.ok) {
        if (editando) {
          cancelarEdicion();
        } else {
          setForm(FORM_VACIO);
        }
        cargarLinea(detalleSel.DetalleId);
      } else {
        const err = await res.json();
        alert("Error: " + err.error);
      }
    } finally { setGuardando(false); }
  };

  const handleEliminar = async (captura) => {
    if (!confirm("¿Eliminar esta captura? Esta acción no se puede deshacer.")) return;
    await fetch(`/api/orden-etiquetado/${captura.OrdenId}`, { method: "DELETE", headers: authHeader() });
    if (editando === captura.OrdenId) cancelarEdicion();
    cargarLinea(detalleSel.DetalleId);
  };

  const piscinaSel = piscinas.find(p => String(p.PiscinaId) === String(form.PiscinaId));
  // Fincas proveedoras externas y piscinas genéricas (sifones, "00-E00") no manejan ciclo — ver
  // piscinaRequiereCiclo. Antes de elegir Finca se asume requerido (por defecto más restrictivo).
  const requiereCiclo = form.Finca ? piscinaRequiereCiclo(piscinaSel?.Nombre, form.Finca) : true;
  const lotePreview = piscinaSel && (!requiereCiclo || form.Ciclo)
    ? componerCodigoLote(piscinaSel.Nombre, form.FechaProduccion, requiereCiclo ? form.Ciclo : "")
    : null;

  const qPed = busquedaPedido.toLowerCase();
  const pedidosFiltrados = pedidos
    .filter(p => p.Estatus === "Proceso")
    .filter(p => !qPed || p.CodigoPedido.toLowerCase().includes(qPed) || p.Descripcion.toLowerCase().includes(qPed));

  if (loading) return (
    <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
  );

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* Columna 1: Pedidos */}
      <div className="w-full lg:w-64 shrink-0">
        <input type="text" placeholder="Buscar pedido..." value={busquedaPedido} onChange={e => setBusquedaPedido(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-400" />
        <div className="bg-white rounded-xl shadow overflow-y-auto max-h-[70vh]">
          {pedidosFiltrados.map(p => (
            <button key={p.CodigoPedido} onClick={() => seleccionarPedido(p)}
              className={`w-full text-left px-3 py-2.5 border-b border-gray-100 transition ${pedidoSel?.CodigoPedido === p.CodigoPedido ? "bg-blue-50" : "hover:bg-gray-50"}`}>
              <div className="font-mono font-bold text-sm text-gray-700">{p.CodigoPedido}</div>
              <div className="text-xs text-gray-500 truncate">{p.Descripcion}</div>
            </button>
          ))}
          {pedidosFiltrados.length === 0 && <div className="px-3 py-8 text-center text-gray-400 text-sm">Sin pedidos</div>}
        </div>
      </div>

      {/* Columna 2: Líneas del pedido */}
      <div className="w-full lg:w-72 shrink-0">
        <h3 className="text-sm font-medium text-gray-600 mb-3">
          Líneas {pedidoSel ? <span className="font-mono font-bold text-gray-800">— {pedidoSel.CodigoPedido}</span> : ""}
        </h3>
        {!pedidoSel ? (
          <div className="bg-white rounded-xl shadow px-4 py-8 text-center text-gray-400 text-sm">Seleccione un pedido</div>
        ) : (
          <div className="bg-white rounded-xl shadow overflow-y-auto max-h-[70vh]">
            {detalles.map(d => (
              <button key={d.DetalleId} onClick={() => seleccionarLinea(d)}
                className={`w-full text-left px-3 py-2.5 border-b border-gray-100 transition ${detalleSel?.DetalleId === d.DetalleId ? "bg-blue-50" : "hover:bg-gray-50"}`}>
                <div className="text-sm font-semibold text-gray-800">{descProcesoDeClase(d.Clase)} · {descTalla(d.Talla)}</div>
                <div className="text-xs text-gray-500">{descPresentacion(d.Presentacion)} — {d.CantidadCajas} cajas</div>
              </button>
            ))}
            {detalles.length === 0 && <div className="px-3 py-8 text-center text-gray-400 text-sm">Sin líneas en este pedido</div>}
          </div>
        )}
      </div>

      {/* Columna 3: Captura + histórico */}
      <div className="flex-1 min-w-0">
        {!detalleSel ? (
          <div className="bg-white rounded-xl shadow px-4 py-8 text-center text-gray-400 text-sm">Seleccione una línea del pedido para capturar</div>
        ) : (
          <>
            {/* Resumen de la línea */}
            <div className="bg-white rounded-xl shadow px-4 py-4 mb-4">
              <div className="text-sm text-gray-500 mb-1">
                {descClase(detalleSel.Clase)} · {descTalla(detalleSel.Talla)} · {descPresentacion(detalleSel.Presentacion)}
              </div>
              <div className="text-xs text-gray-400 mb-3">
                Master: {descEmpaque(detalleSel.EmpaqueMaster)}{detalleSel.EmpaqueAccesorio ? ` · Caja: ${descEmpaque(detalleSel.EmpaqueAccesorio)}` : ""}
              </div>
              {resumen && (() => {
                // Este resumen muestra el avance REAL (escaneado en bodega), no lo declarado — el
                // candado que bloquea declarar de más sigue comparando contra lo declarado sin
                // cambios (ver calcularResumen en ordenEtiquetado.ts), esto es solo visualización.
                const pendienteEscaneado = resumen.Objetivo - resumen.Escaneado;
                const pct = resumen.Escaneado / Math.max(1, resumen.Objetivo);
                const colorBarra = pct >= 1 ? "bg-green-500" : pct >= 0.5 ? "bg-yellow-400" : "bg-red-500";
                return (
                  <div className="flex items-center gap-4 text-sm">
                    <span><span className="font-semibold text-gray-800">{resumen.Objetivo}</span> <span className="text-gray-400">pedido</span></span>
                    <span><span className="font-semibold text-blue-700">{resumen.Escaneado}</span> <span className="text-gray-400">escaneados</span></span>
                    <span><span className={`font-semibold ${pendienteEscaneado <= 0 ? "text-green-600" : "text-orange-600"}`}>{pendienteEscaneado}</span> <span className="text-gray-400">pendientes</span></span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full transition-colors ${colorBarra}`} style={{ width: `${Math.min(100, pct * 100)}%` }} />
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Formulario de captura */}
            {(editando ? puedeEditar : puedeCrear) && (
            <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow px-4 py-4 mb-4 space-y-3">
              <h4 className="text-sm font-semibold text-gray-700">{editando ? "Editar captura" : "Nueva captura"}</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Finca *</label>
                  <select required value={form.Finca}
                    onChange={e => {
                      const necesitaCiclo = piscinaRequiereCiclo(undefined, e.target.value);
                      setForm(p => ({ ...p, Finca: e.target.value, PiscinaId: "", Ciclo: necesitaCiclo ? p.Ciclo : "" }));
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                    <option value="">Seleccione...</option>
                    {fincas.map(f => <option key={f.Codigo} value={f.Codigo}>{f.Descripcion}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Piscina *</label>
                  <select required disabled={!form.Finca} value={form.PiscinaId}
                    onChange={e => {
                      const nueva = piscinas.find(p => String(p.PiscinaId) === String(e.target.value));
                      const necesitaCiclo = nueva ? piscinaRequiereCiclo(nueva.Nombre, nueva.CodigoFinca) : true;
                      setForm(p => ({ ...p, PiscinaId: e.target.value, Ciclo: necesitaCiclo ? p.Ciclo : "" }));
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100">
                    <option value="">{form.Finca ? "Seleccione..." : "Elija una finca primero"}</option>
                    {piscinas.map(p => <option key={p.PiscinaId} value={p.PiscinaId}>{p.Nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Ciclo{requiereCiclo ? " *" : ""}</label>
                  <input required={requiereCiclo} disabled={!requiereCiclo} value={form.Ciclo} onChange={set("Ciclo")}
                    placeholder={requiereCiclo ? "ej. 8" : "No aplica"}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Área *</label>
                  <select required value={form.AreaCodigo} onChange={set("AreaCodigo")}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                    <option value="">Seleccione...</option>
                    {areas.map(a => <option key={a.Codigo} value={a.Codigo}>{a.Nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Fecha Producción *</label>
                  <input required type="date" value={form.FechaProduccion} onChange={set("FechaProduccion")}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Color</label>
                  <input value={form.Color} onChange={set("Color")} placeholder="ej. sc"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Origen *</label>
                  <select required value={form.Origen} onChange={set("Origen")}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                    <option value="">Seleccione...</option>
                    {origenes.map(o => <option key={o.Codigo} value={o.Codigo}>{o.Descripcion}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Congelación *</label>
                  <select required value={form.Congelacion} onChange={set("Congelacion")}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                    <option value="">Seleccione...</option>
                    {congelaciones.map(c => <option key={c.Codigo} value={c.Codigo}>{c.Descripcion}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Lote</label>
                  <div className={`w-full border rounded-lg px-3 py-2 text-sm font-mono ${lotePreview ? "border-blue-300 bg-blue-50 text-blue-800 font-semibold" : "border-gray-200 bg-gray-50 text-gray-400"}`}>
                    {lotePreview || "Complete piscina, ciclo y fecha"}
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Cantidad Master a trabajar *</label>
                  <input required type="number" min="1" step="1" value={form.CantidadMaster} onChange={set("CantidadMaster")}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              </div>
              <div className="flex justify-end items-center gap-3 pt-1">
                {editando && (
                  <button type="button" onClick={cancelarEdicion} className="text-sm text-gray-500 hover:text-gray-700 transition">
                    Cancelar edición
                  </button>
                )}
                <button type="submit" disabled={guardando}
                  className="px-5 py-2 text-sm bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
                  {guardando ? "Guardando..." : editando ? "Guardar cambios" : "Guardar captura"}
                </button>
              </div>
            </form>
            )}

            {/* Histórico de capturas de esta línea */}
            <div className="bg-white rounded-xl shadow overflow-x-auto">
              <table className="w-full text-sm table-fixed">
                <Colgroup columns={COLS} widths={widths} />
                <thead>
                  <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                    <Th width={widths.fecha} onResizeStart={startResize("fecha")} className="px-4 py-3 text-left whitespace-nowrap">Fecha</Th>
                    <Th width={widths.lote} onResizeStart={startResize("lote")} className="px-4 py-3 text-left whitespace-nowrap">Lote</Th>
                    <Th width={widths.area} onResizeStart={startResize("area")} className="px-4 py-3 text-left whitespace-nowrap">Área</Th>
                    <Th width={widths.origen} onResizeStart={startResize("origen")} className="px-4 py-3 text-left whitespace-nowrap">Origen</Th>
                    <Th width={widths.congelacion} onResizeStart={startResize("congelacion")} className="px-4 py-3 text-left whitespace-nowrap">Congelación</Th>
                    <Th width={widths.masters} onResizeStart={startResize("masters")} className="px-4 py-3 text-right whitespace-nowrap">Masters</Th>
                    <Th width={widths.estatus} onResizeStart={startResize("estatus")} className="px-4 py-3 text-center whitespace-nowrap">Estatus</Th>
                    <Th width={widths.impresion} onResizeStart={startResize("impresion")} className="px-4 py-3 text-center whitespace-nowrap">Impresión</Th>
                    <Th width={widths.acciones} onResizeStart={startResize("acciones")} className="px-4 py-3 text-center whitespace-nowrap">Acciones</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {capturas.map(c => (
                    <tr key={c.OrdenId} className={`hover:bg-gray-50 transition ${c.Estatus === "Cancelada" ? "opacity-50" : ""}`}>
                      <td className="px-4 py-3 whitespace-nowrap">{c.FechaProduccion?.slice(0, 10)}</td>
                      <td className="px-4 py-3 font-mono text-gray-700 whitespace-nowrap">{c.Lote}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{c.NombreArea || <span className="text-gray-400 italic">Sin área</span>}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{c.DescripcionOrigen}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{c.DescripcionCongelacion}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">{c.CantidadMaster}</td>
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${c.Estatus === "Cancelada" ? "bg-red-100 text-red-600" : "bg-yellow-100 text-yellow-700"}`}>
                          {c.Estatus}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        {c.Impresas >= c.CantidadMaster ? (
                          <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                            Impresas ({c.Impresas}/{c.CantidadMaster})
                          </span>
                        ) : c.Impresas > 0 ? (
                          <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">
                            Parcial ({c.Impresas}/{c.CantidadMaster})
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">
                            Sin imprimir
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <div className="flex justify-center gap-2">
                          {puedeEditar && (
                            <button onClick={() => handleEditar(c)} className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition">Editar</button>
                          )}
                          {puedeEliminar && (
                            <button onClick={() => handleEliminar(c)} className="text-red-500 hover:text-red-700 text-xs font-medium px-2 py-1 rounded hover:bg-red-50 transition">Eliminar</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {capturas.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Sin capturas para esta línea</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
