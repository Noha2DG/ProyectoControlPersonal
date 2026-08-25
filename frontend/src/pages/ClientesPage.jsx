import { useState, useEffect, useCallback } from "react";
import { authHeader, usePuede } from "../context/AuthContext.jsx";
import { useColWidths, useOrden, ordenarFilas, Th, Colgroup } from "../components/ResizableTh.jsx";

const PAISES = ["GT", "US", "MX", "TW"];

// Separa la cartera para las remisiones: una "Venta local" solo ofrece clientes Local y una
// "Exportación" solo los de Exportación. NO se deriva del País — INDUPECASA está registrada como GT
// pero vende marcas de EE.UU., así que el país es una pista, no la regla.
const TIPOS_CLIENTE = [
  { valor: "Local", label: "Local" },
  { valor: "Exportacion", label: "Exportación" },
];
const TIPO_BADGE = {
  Local:       "bg-emerald-100 text-emerald-700",
  Exportacion: "bg-indigo-100 text-indigo-700",
};

const CLIENTES_COL_DEFAULTS = { codigo: 100, razonSocial: 220, pais: 80, tipo: 110, estado: 100, acciones: 150 };
const CLIENTES_COLS = Object.keys(CLIENTES_COL_DEFAULTS);
const SUB_COL_DEFAULTS = { codigo: 120, razonSocial: 220, diseno: 210, estado: 100, acciones: 150 };
const SUB_COLS = Object.keys(SUB_COL_DEFAULTS);

// Solo el nombre del archivo: la ruta completa es de red y no cabe en la celda, pero se deja
// como title para poder verificarla sin abrir el modal.
const nombreBtw = (ruta) => (ruta ? ruta.split(/[\\/]/).pop() : null);

function ClienteModal({ item, onSave, onClose }) {
  const isEdit = !!item;
  const [form, setForm] = useState({
    Codigo: item?.Codigo || "", RazonSocial: item?.RazonSocial || "",
    Pais: item?.Pais || "GT", Tipo: item?.Tipo || "Local",
  });
  const set = f => e => setForm(p => ({ ...p, [f]: e.target.value }));
  const handleSubmit = e => { e.preventDefault(); onSave(form); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">{isEdit ? "Editar Cliente" : "Nuevo Cliente"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Código *</label>
            <input required disabled={isEdit} type="number" value={form.Codigo} onChange={set("Codigo")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Razón Social *</label>
            <input required value={form.RazonSocial} onChange={set("RazonSocial")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">País *</label>
              <select required value={form.Pais} onChange={set("Pais")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                {PAISES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Tipo *</label>
              <select required value={form.Tipo} onChange={set("Tipo")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                {TIPOS_CLIENTE.map(t => <option key={t.valor} value={t.valor}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-gray-400 -mt-1">
            El tipo decide en qué remisiones aparece este cliente: los Local en ventas locales, los de Exportación en exportaciones.
          </p>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition">Cancelar</button>
            <button type="submit" className="px-5 py-2 text-sm bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition">{isEdit ? "Guardar" : "Crear"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SubclienteModal({ item, codigoCliente, onSave, onClose }) {
  const isEdit = !!item;
  const [form, setForm] = useState({ CodigoSubcliente: item?.CodigoSubcliente || "", RazonSocial: item?.RazonSocial || "" });
  const set = f => e => setForm(p => ({ ...p, [f]: e.target.value }));
  const handleSubmit = e => { e.preventDefault(); onSave({ ...form, CodigoCliente: codigoCliente }); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">{isEdit ? "Editar Subcliente" : "Nuevo Subcliente"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Código *</label>
            <input required disabled={isEdit} value={form.CodigoSubcliente} onChange={set("CodigoSubcliente")} maxLength={10}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Razón Social *</label>
            <input required value={form.RazonSocial} onChange={set("RazonSocial")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition">Cancelar</button>
            <button type="submit" className="px-5 py-2 text-sm bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition">{isEdit ? "Guardar" : "Crear"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Escoger el .btw de BarTender que le toca a un cliente/subcliente. No abre el explorador de
// Windows a propósito: el navegador falsea la ruta de <input type="file"> ("C:\fakepath\..."), así
// que la lista viene del backend leyendo la carpeta de red configurada. La ruta que se guarda de
// ahí siempre existe y siempre la alcanza la PC de BarTender.
function DisenoBtwModal({ titulo, actual, onSave, onQuitar, onClose }) {
  const [estado, setEstado] = useState(null);   // null = cargando
  const [error, setError] = useState("");
  const [sel, setSel] = useState(actual || "");
  const [filtro, setFiltro] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/diseno-etiqueta-cliente/archivos", { headers: authHeader() });
        const data = await res.json();
        if (!res.ok) { setError(data.error || "No se pudo consultar la carpeta de diseños"); return; }
        setEstado(data);
      } catch (e) { setError(e.message); }
    })();
  }, []);

  const archivos = estado?.Archivos || [];

  const visibles = archivos.filter(a =>
    !filtro || `${a.Carpeta} ${a.Nombre}`.toLowerCase().includes(filtro.toLowerCase()));

  // Solo se puede validar la forma de una ruta escrita a mano: absoluta (C:\… o \\servidor\…) y
  // terminada en .btw. Mismo criterio que aplica el backend cuando no alcanza la carpeta.
  const rutaConFormato = /^([a-zA-Z]:[\\/]|\\\\[^\\/]+[\\/])/.test(sel.trim()) && /\.btw$/i.test(sel.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 flex flex-col max-h-[80vh]">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">Diseño de etiqueta — {titulo}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <div className="px-6 py-4 flex-1 overflow-y-auto space-y-3">
          {error ? (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>
          ) : estado === null ? (
            <div className="flex justify-center py-8"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
          ) : !estado.Legible ? (
            /* El servidor no alcanza la carpeta (caso de producción: backend en internet, diseños
               en la red de la oficina). Se escribe la ruta tal como la ve la PC de BarTender. */
            <>
              <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2">
                {estado.Motivo}
              </div>
              <label className="block text-xs font-medium text-gray-500">Ruta del archivo .btw</label>
              <input value={sel} onChange={e => setSel(e.target.value)} autoFocus
                placeholder="\\servidor\etiquetas\GREAT GARDEN\master.btw"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400" />
              {sel.trim() && !rutaConFormato && (
                <p className="text-xs text-red-500">
                  Debe ser una ruta absoluta y terminar en .btw — por ejemplo <span className="font-mono">\\servidor\etiquetas\arte.btw</span>
                </p>
              )}
              <p className="text-xs text-gray-400">
                Escríbela como la ve la PC donde corre BarTender. Evita las unidades mapeadas
                (<span className="font-mono">Z:\…</span>): pueden apuntar a otro lugar en otra máquina.
              </p>
            </>
          ) : (
            <>
              <p className="text-xs text-gray-400 truncate" title={estado.Carpeta}>Carpeta: {estado.Carpeta}</p>
              <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar diseño…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                {visibles.map(a => (
                  <button key={a.Ruta} type="button" onClick={() => setSel(a.Ruta)}
                    className={`w-full text-left px-3 py-2 transition ${sel === a.Ruta ? "bg-blue-50" : "hover:bg-gray-50"}`}>
                    <div className="text-sm text-gray-800 truncate" title={a.Nombre}>{a.Nombre}</div>
                    {a.Carpeta !== "." && <div className="text-xs text-gray-400 truncate" title={a.Carpeta}>{a.Carpeta}</div>}
                  </button>
                ))}
                {visibles.length === 0 && (
                  <div className="px-3 py-6 text-center text-gray-400 text-sm">
                    {archivos.length === 0 ? "No hay archivos .btw en la carpeta" : "Ningún diseño coincide"}
                  </div>
                )}
              </div>
              {sel && (
                <p className="text-xs text-gray-400 font-mono truncate" title={sel}>{sel}</p>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t flex justify-between gap-3">
          {actual ? (
            <button onClick={onQuitar} className="text-red-500 hover:text-red-700 text-sm font-medium px-3 py-2 rounded hover:bg-red-50 transition">
              Quitar asignación
            </button>
          ) : <span />}
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition">Cancelar</button>
            <button onClick={() => onSave(sel.trim())} disabled={!sel.trim() || (estado && !estado.Legible && !rutaConFormato)}
              className="bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
              Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ClientesPage() {
  const puedeCrear = usePuede("pedidos", "crear");
  const puedeEditar = usePuede("pedidos", "editar");
  const puedeEliminar = usePuede("pedidos", "eliminar");
  const [clientes, setClientes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clienteSel, setClienteSel] = useState(null);
  const [subclientes, setSubclientes] = useState([]);
  const [loadingSub, setLoadingSub] = useState(false);
  const [modalCliente, setModalCliente] = useState({ open: false, item: null });
  const [modalSub, setModalSub] = useState({ open: false, item: null });
  // Diseños .btw asignados al cliente seleccionado. La fila con CodigoSubcliente "" es el diseño
  // por defecto del cliente: se usa cuando el pedido no trae subcliente o cuando ese subcliente
  // no tiene arte propio.
  const [disenos, setDisenos] = useState([]);
  const [modalDiseno, setModalDiseno] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [widthsClientes, startResizeClientes] = useColWidths("clientes", CLIENTES_COL_DEFAULTS);
  const [widthsSub, startResizeSub] = useColWidths("subclientes", SUB_COL_DEFAULTS);
  const [ordenCli, alternarOrdenCli] = useOrden();
  const [ordenSub, alternarOrdenSub] = useOrden();
  const VALORES_CLI = { codigo: c => c.Codigo, razonSocial: c => c.RazonSocial, pais: c => c.Pais,
                        tipo: c => c.Tipo, estado: c => (c.Activo ? "Activo" : "Inactivo") };
  const VALORES_SUB = { codigo: x => x.CodigoSubcliente, razonSocial: x => x.RazonSocial,
                        diseno: x => nombreBtw(rutaDe(x.CodigoSubcliente)) || "",
                        estado: x => (x.Activo ? "Activo" : "Inactivo") };

  const fetchClientes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/clientes", { headers: authHeader() });
      const data = await res.json();
      if (Array.isArray(data)) setClientes(data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchClientes(); }, [fetchClientes]);

  const fetchSubclientes = useCallback(async (codigo) => {
    setLoadingSub(true);
    try {
      const res = await fetch(`/api/subcliente?cliente=${codigo}`, { headers: authHeader() });
      const data = await res.json();
      if (Array.isArray(data)) setSubclientes(data);
    } finally { setLoadingSub(false); }
  }, []);

  const fetchDisenos = useCallback(async (codigo) => {
    try {
      const res = await fetch(`/api/diseno-etiqueta-cliente?cliente=${codigo}`, { headers: authHeader() });
      const data = await res.json();
      setDisenos(Array.isArray(data) ? data : []);
    } catch { setDisenos([]); }
  }, []);

  const seleccionarCliente = (c) => { setClienteSel(c); fetchSubclientes(c.Codigo); fetchDisenos(c.Codigo); };

  const rutaDe = (codigoSubcliente) =>
    disenos.find(d => d.CodigoSubcliente === (codigoSubcliente ?? ""))?.RutaBtw || null;

  const guardarDiseno = async (ruta) => {
    const res = await fetch("/api/diseno-etiqueta-cliente", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({
        CodigoCliente: clienteSel.Codigo,
        CodigoSubcliente: modalDiseno.sub,
        RutaBtw: ruta,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { alert(data.error || "No se pudo guardar el diseño"); return; }
    setModalDiseno(null);
    fetchDisenos(clienteSel.Codigo);
  };

  const quitarDiseno = async () => {
    const sub = modalDiseno.sub === "" ? "-" : modalDiseno.sub;
    await fetch(`/api/diseno-etiqueta-cliente/${clienteSel.Codigo}/${encodeURIComponent(sub)}`,
      { method: "DELETE", headers: authHeader() });
    setModalDiseno(null);
    fetchDisenos(clienteSel.Codigo);
  };

  const handleSaveCliente = async (form) => {
    const isEdit = clientes.some(c => String(c.Codigo) === String(form.Codigo));
    const res = await fetch(isEdit ? `/api/clientes/${form.Codigo}` : "/api/clientes", {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(form),
    });
    if (res.ok) { setModalCliente({ open: false, item: null }); fetchClientes(); }
    else { const e = await res.json(); alert("Error: " + e.error); }
  };

  const handleToggleCliente = async (c) => {
    if (c.Activo) {
      if (!confirm(`¿Desactivar el cliente "${c.RazonSocial}"?`)) return;
      await fetch(`/api/clientes/${c.Codigo}`, { method: "DELETE", headers: authHeader() });
    } else {
      await fetch(`/api/clientes/${c.Codigo}`, {
        method: "PUT", headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ ...c, Activo: true }),
      });
    }
    fetchClientes();
  };

  const handleSaveSub = async (form) => {
    const isEdit = subclientes.some(s => s.CodigoSubcliente === form.CodigoSubcliente);
    const res = await fetch(isEdit ? `/api/subcliente/${form.CodigoCliente}/${form.CodigoSubcliente}` : "/api/subcliente", {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(form),
    });
    if (res.ok) { setModalSub({ open: false, item: null }); fetchSubclientes(clienteSel.Codigo); }
    else { const e = await res.json(); alert("Error: " + e.error); }
  };

  const handleToggleSub = async (s) => {
    if (s.Activo) {
      if (!confirm(`¿Desactivar "${s.RazonSocial}"?`)) return;
      await fetch(`/api/subcliente/${s.CodigoCliente}/${s.CodigoSubcliente}`, { method: "DELETE", headers: authHeader() });
    } else {
      await fetch(`/api/subcliente/${s.CodigoCliente}/${s.CodigoSubcliente}`, {
        method: "PUT", headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ ...s, Activo: true }),
      });
    }
    fetchSubclientes(clienteSel.Codigo);
  };

  const q = busqueda.toLowerCase();
  const clientesFiltrados = clientes.filter(c =>
    !q || String(c.Codigo).includes(q) || c.RazonSocial.toLowerCase().includes(q)
  );

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* Columna Clientes */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap gap-3 items-center mb-4">
          <input type="text" placeholder="Buscar cliente..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-blue-400" />
          <span className="text-sm text-gray-500 ml-auto">{clientesFiltrados.length} cliente{clientesFiltrados.length !== 1 ? "s" : ""}</span>
          {puedeCrear && (
            <button onClick={() => setModalCliente({ open: true, item: null })}
              className="bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition">
              + Nuevo Cliente
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm table-fixed">
              <Colgroup columns={CLIENTES_COLS} widths={widthsClientes} />
              <thead>
                <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                  <Th width={widthsClientes.codigo} onResizeStart={startResizeClientes("codigo")} sortKey="codigo" orden={ordenCli} onOrdenar={alternarOrdenCli} className="px-4 py-3 text-left whitespace-nowrap">Código</Th>
                  <Th width={widthsClientes.razonSocial} onResizeStart={startResizeClientes("razonSocial")} sortKey="razonSocial" orden={ordenCli} onOrdenar={alternarOrdenCli} className="px-4 py-3 text-left whitespace-nowrap">Razón Social</Th>
                  <Th width={widthsClientes.pais} onResizeStart={startResizeClientes("pais")} sortKey="pais" orden={ordenCli} onOrdenar={alternarOrdenCli} className="px-4 py-3 text-left whitespace-nowrap">País</Th>
                  <Th width={widthsClientes.tipo} onResizeStart={startResizeClientes("tipo")} sortKey="tipo" orden={ordenCli} onOrdenar={alternarOrdenCli} className="px-4 py-3 text-center whitespace-nowrap">Tipo</Th>
                  <Th width={widthsClientes.estado} onResizeStart={startResizeClientes("estado")} sortKey="estado" orden={ordenCli} onOrdenar={alternarOrdenCli} className="px-4 py-3 text-center whitespace-nowrap">Estado</Th>
                  <Th width={widthsClientes.acciones} onResizeStart={startResizeClientes("acciones")} className="px-4 py-3 text-center whitespace-nowrap">Acciones</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ordenarFilas(clientesFiltrados, ordenCli, VALORES_CLI).map(c => (
                  <tr key={c.Codigo} onClick={() => seleccionarCliente(c)}
                    className={`cursor-pointer transition ${clienteSel?.Codigo === c.Codigo ? "bg-blue-50" : "hover:bg-gray-50"} ${!c.Activo ? "opacity-50" : ""}`}>
                    <td className="px-4 py-3 font-mono font-bold text-gray-700 whitespace-nowrap">{c.Codigo}</td>
                    <td className="px-4 py-3 text-gray-900 whitespace-nowrap">{c.RazonSocial}</td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{c.Pais}</td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${TIPO_BADGE[c.Tipo] || "bg-gray-100 text-gray-600"}`}>
                        {c.Tipo === "Exportacion" ? "Exportación" : "Local"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${c.Activo ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                        {c.Activo ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <div className="flex justify-center gap-2">
                        {puedeEditar && (
                          <button onClick={() => setModalCliente({ open: true, item: c })}
                            className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition">Editar</button>
                        )}
                        {((c.Activo && puedeEliminar) || (!c.Activo && puedeEditar)) && (
                          <button onClick={() => handleToggleCliente(c)}
                            className={`text-xs font-medium px-2 py-1 rounded transition ${c.Activo ? "text-red-500 hover:text-red-700 hover:bg-red-50" : "text-green-600 hover:text-green-800 hover:bg-green-50"}`}>
                            {c.Activo ? "Desactivar" : "Activar"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </div>

      {/* Columna Subclientes */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap gap-3 items-center mb-4">
          <h3 className="text-sm font-medium text-gray-600">
            Subclientes {clienteSel ? <span className="font-semibold text-gray-800">— {clienteSel.RazonSocial}</span> : ""}
          </h3>
          {puedeCrear && (
            <button onClick={() => setModalSub({ open: true, item: null })} disabled={!clienteSel}
              className="ml-auto bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
              + Nuevo Subcliente
            </button>
          )}
        </div>

        {/* Diseño por defecto del cliente: lo heredan los subclientes que no tienen arte propio, y
            es el que se usa cuando el pedido no lleva subcliente. */}
        {clienteSel && (
          <div className="bg-white rounded-xl shadow px-4 py-3 mb-3 flex items-center gap-3">
            <span className="text-xs font-medium text-gray-500 shrink-0">Diseño por defecto del cliente</span>
            <div className="min-w-0 flex-1 text-right">
              {puedeEditar ? (
                <button onClick={() => setModalDiseno({ sub: "", titulo: clienteSel.RazonSocial, actual: rutaDe("") })}
                  className={`text-xs font-medium truncate max-w-full inline-block ${rutaDe("") ? "text-blue-600 hover:text-blue-800" : "text-gray-400 hover:text-blue-600"}`}
                  title={rutaDe("") || "Sin diseño asignado"}>
                  {nombreBtw(rutaDe("")) || "+ Asignar"}
                </button>
              ) : (
                <span className="text-xs text-gray-700 truncate inline-block max-w-full" title={rutaDe("") || ""}>
                  {nombreBtw(rutaDe("")) || "—"}
                </span>
              )}
            </div>
          </div>
        )}

        {!clienteSel ? (
          <div className="bg-white rounded-xl shadow px-4 py-8 text-center text-gray-400 text-sm">Seleccione un cliente para ver sus subclientes</div>
        ) : loadingSub ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm table-fixed">
              <Colgroup columns={SUB_COLS} widths={widthsSub} />
              <thead>
                <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                  <Th width={widthsSub.codigo} onResizeStart={startResizeSub("codigo")} sortKey="codigo" orden={ordenSub} onOrdenar={alternarOrdenSub} className="px-4 py-3 text-left whitespace-nowrap">Código</Th>
                  <Th width={widthsSub.razonSocial} onResizeStart={startResizeSub("razonSocial")} sortKey="razonSocial" orden={ordenSub} onOrdenar={alternarOrdenSub} className="px-4 py-3 text-left whitespace-nowrap">Razón Social</Th>
                  <Th width={widthsSub.diseno} onResizeStart={startResizeSub("diseno")} sortKey="diseno" orden={ordenSub} onOrdenar={alternarOrdenSub} className="px-4 py-3 text-left whitespace-nowrap">Diseño</Th>
                  <Th width={widthsSub.estado} onResizeStart={startResizeSub("estado")} sortKey="estado" orden={ordenSub} onOrdenar={alternarOrdenSub} className="px-4 py-3 text-center whitespace-nowrap">Estado</Th>
                  <Th width={widthsSub.acciones} onResizeStart={startResizeSub("acciones")} className="px-4 py-3 text-center whitespace-nowrap">Acciones</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ordenarFilas(subclientes, ordenSub, VALORES_SUB).map(s => (
                  <tr key={s.CodigoSubcliente} className={`hover:bg-gray-50 transition ${!s.Activo ? "opacity-50" : ""}`}>
                    <td className="px-4 py-3 font-mono font-bold text-gray-700 whitespace-nowrap">{s.CodigoSubcliente}</td>
                    <td className="px-4 py-3 text-gray-900 truncate" title={s.RazonSocial}>{s.RazonSocial}</td>
                    <td className="px-4 py-3">
                      {(() => {
                        const ruta = rutaDe(s.CodigoSubcliente);
                        const propio = nombreBtw(ruta);
                        const heredado = nombreBtw(rutaDe(""));
                        if (propio) {
                          return puedeEditar ? (
                            <button onClick={() => setModalDiseno({ sub: s.CodigoSubcliente, titulo: s.RazonSocial, actual: ruta })}
                              className="text-blue-600 hover:text-blue-800 text-xs font-medium truncate max-w-full block text-left" title={ruta}>
                              {propio}
                            </button>
                          ) : <span className="text-xs text-gray-700 truncate block" title={ruta}>{propio}</span>;
                        }
                        return puedeEditar ? (
                          <button onClick={() => setModalDiseno({ sub: s.CodigoSubcliente, titulo: s.RazonSocial, actual: null })}
                            className="text-xs text-gray-400 hover:text-blue-600 truncate max-w-full block text-left"
                            title={heredado ? `Usa el diseño del cliente: ${heredado}` : "Sin diseño asignado"}>
                            {heredado ? `↳ ${heredado}` : "+ Asignar"}
                          </button>
                        ) : <span className="text-xs text-gray-400">{heredado ? `↳ ${heredado}` : "—"}</span>;
                      })()}
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${s.Activo ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                        {s.Activo ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <div className="flex justify-center gap-2">
                        {puedeEditar && (
                          <button onClick={() => setModalSub({ open: true, item: s })}
                            className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition">Editar</button>
                        )}
                        {((s.Activo && puedeEliminar) || (!s.Activo && puedeEditar)) && (
                          <button onClick={() => handleToggleSub(s)}
                            className={`text-xs font-medium px-2 py-1 rounded transition ${s.Activo ? "text-red-500 hover:text-red-700 hover:bg-red-50" : "text-green-600 hover:text-green-800 hover:bg-green-50"}`}>
                            {s.Activo ? "Desactivar" : "Activar"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {subclientes.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Sin subclientes</td></tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </div>

      {modalCliente.open && (
        <ClienteModal item={modalCliente.item} onSave={handleSaveCliente} onClose={() => setModalCliente({ open: false, item: null })} />
      )}
      {modalSub.open && clienteSel && (
        <SubclienteModal item={modalSub.item} codigoCliente={clienteSel.Codigo} onSave={handleSaveSub} onClose={() => setModalSub({ open: false, item: null })} />
      )}
      {modalDiseno && clienteSel && (
        <DisenoBtwModal titulo={modalDiseno.titulo} actual={modalDiseno.actual}
          onSave={guardarDiseno} onQuitar={quitarDiseno} onClose={() => setModalDiseno(null)} />
      )}
    </div>
  );
}
