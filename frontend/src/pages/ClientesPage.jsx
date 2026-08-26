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

// Cómo se resume una lista de diseños en una celda: el predeterminado (que el backend devuelve
// primero) y cuántos más hay. Mostrarlos todos ensancharía la columna por un dato que solo importa
// al abrir el modal; la ruta completa de cada uno queda en el title.
const resumenDisenos = (lista) => {
  if (!lista.length) return null;
  return lista.length === 1 ? lista[0].Nombre : `${lista[0].Nombre} +${lista.length - 1}`;
};

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

// Los .btw de BarTender que le tocan a un cliente/subcliente. Son VARIOS desde el 26 ago 2026: un
// mismo subcliente puede tener el master de 1 lb, el de 4/5 lb y el provisional, y quién elige es
// el operador al momento de imprimir. Este modal gestiona la lista; el modal de elegir vive en
// Impresión de Etiquetas.
//
// El explorador de Windows NO se abre a propósito: el navegador falsea la ruta de
// <input type="file"> ("C:\fakepath\..."), así que la lista de archivos viene del backend leyendo
// la carpeta de red configurada. La ruta que se guarda de ahí siempre existe y siempre la alcanza
// la PC de BarTender.
function DisenosModal({ titulo, disenos, puedeEditar, onAgregar, onPredeterminado, onRenombrar, onQuitar, onClose }) {
  const [estado, setEstado] = useState(null);   // null = cargando
  const [error, setError] = useState("");
  const [agregando, setAgregando] = useState(disenos.length === 0);
  // Se marcan VARIOS archivos y entran todos de una: un cliente estrena su carpeta con tres o
  // cuatro artes, y agregarlos de uno en uno significaba reabrir este formulario por cada uno.
  const [marcados, setMarcados] = useState([]);
  const [rutaManual, setRutaManual] = useState("");
  const [nombre, setNombre] = useState("");
  const [filtro, setFiltro] = useState("");
  const [editandoId, setEditandoId] = useState(null);
  const [editandoNombre, setEditandoNombre] = useState("");

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
  // Las rutas se comparan normalizadas: BTW_CARPETA puede venir con barras al derecho
  // ("C:/Etiquetas") y lo guardado traerlas al revés, y Windows además no distingue mayúsculas.
  // Sin esto, un archivo ya asignado se ofrecería como nuevo y chocaría contra la unicidad.
  const norm = (r) => String(r).toLowerCase().replace(/\//g, "\\");
  const yaAsignadas = new Set(disenos.map(d => norm(d.RutaBtw)));

  // El filtro busca también en la RUTA, no solo en el nombre: pegar una ruta completa —lo natural
  // cuando se la pasaron a uno por mensaje— dejaba la lista vacía y parecía que la carpeta no
  // tenía nada.
  const q = norm(filtro.trim());
  const visibles = archivos.filter(a => !q || norm(`${a.Carpeta} ${a.Nombre} ${a.Ruta}`).includes(q));

  // Solo se puede validar la forma de una ruta escrita a mano: absoluta (C:\… o \\servidor\…) y
  // terminada en .btw. Mismo criterio que aplica el backend cuando no alcanza la carpeta.
  const rutaConFormato = /^([a-zA-Z]:[\\/]|\\\\[^\\/]+[\\/])/.test(rutaManual.trim()) && /\.btw$/i.test(rutaManual.trim());
  const puedeAgregar = estado?.Legible ? marcados.length > 0 : rutaConFormato;

  const alternar = (ruta) =>
    setMarcados(prev => prev.includes(ruta) ? prev.filter(r => r !== ruta) : [...prev, ruta]);

  const limpiarAlta = () => { setMarcados([]); setRutaManual(""); setNombre(""); setFiltro(""); };

  // Las altas van UNA POR UNA y en orden, no en paralelo: el backend marca como predeterminado al
  // primero que entra en un grupo vacío, y con peticiones simultáneas ese "primero" sería el que
  // ganara la carrera. El nombre escrito solo aplica cuando se marcó un archivo; con varios, cada
  // uno toma el suyo, que es lo único que los distingue.
  const confirmarAlta = async () => {
    const rutas = estado?.Legible ? marcados : [rutaManual.trim()];
    for (const ruta of rutas) {
      await onAgregar({ RutaBtw: ruta, Nombre: rutas.length === 1 ? nombre.trim() : "" });
    }
    limpiarAlta();
    setAgregando(false);
  };

  const guardarNombre = async (d) => {
    const limpio = editandoNombre.trim();
    setEditandoId(null);
    if (limpio && limpio !== d.Nombre) await onRenombrar(d.DisenoId, limpio);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 flex flex-col max-h-[85vh]">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">Diseños de etiqueta — {titulo}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <div className="px-6 py-4 flex-1 overflow-y-auto space-y-4">
          {/* Lo que ya está asignado. La estrella marca cuál se usa sin preguntar: es el que abre
              BarTender cuando hay uno solo, y el que viene preseleccionado en el modal de impresión. */}
          {disenos.length > 0 && (
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
              {disenos.map(d => (
                <div key={d.DisenoId} className="px-3 py-2 flex items-center gap-2">
                  <button type="button" disabled={!puedeEditar || d.EsPredeterminado}
                    onClick={() => onPredeterminado(d.DisenoId)}
                    title={d.EsPredeterminado ? "Se usa sin preguntar" : "Usar este por omisión"}
                    className={`text-base leading-none shrink-0 ${d.EsPredeterminado ? "text-amber-500" : "text-gray-300 hover:text-amber-400"} disabled:cursor-default`}>
                    {d.EsPredeterminado ? "★" : "☆"}
                  </button>
                  <div className="min-w-0 flex-1">
                    {editandoId === d.DisenoId ? (
                      <input value={editandoNombre} autoFocus
                        onChange={e => setEditandoNombre(e.target.value)}
                        onBlur={() => guardarNombre(d)}
                        onKeyDown={e => { if (e.key === "Enter") guardarNombre(d); if (e.key === "Escape") setEditandoId(null); }}
                        className="w-full border border-blue-300 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                    ) : (
                      <button type="button" disabled={!puedeEditar}
                        onClick={() => { setEditandoId(d.DisenoId); setEditandoNombre(d.Nombre); }}
                        title={puedeEditar ? "Clic para renombrar" : d.Nombre}
                        className="text-sm text-gray-800 truncate block text-left w-full disabled:cursor-default">
                        {d.Nombre}
                      </button>
                    )}
                    <div className="text-xs text-gray-400 truncate" title={d.RutaBtw}>{d.Archivo}</div>
                  </div>
                  {puedeEditar && (
                    <button type="button" onClick={() => onQuitar(d.DisenoId)}
                      title="Quitar de la lista"
                      className="text-red-400 hover:text-red-600 text-xs font-medium px-2 py-1 rounded hover:bg-red-50 transition shrink-0">
                      Quitar
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {puedeEditar && !agregando && (
            <button type="button" onClick={() => setAgregando(true)}
              className="text-blue-600 hover:text-blue-800 text-sm font-medium">
              + Agregar diseño
            </button>
          )}

          {puedeEditar && agregando && (
            <div className="border border-blue-200 bg-blue-50/40 rounded-lg p-3 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Nombre</label>
                <input value={marcados.length > 1 ? "" : nombre} onChange={e => setNombre(e.target.value)}
                  disabled={marcados.length > 1}
                  placeholder={marcados.length > 1
                    ? `${marcados.length} marcados — cada uno toma el nombre de su archivo`
                    : "Master 4/5 lb — el que lee el operador al imprimir"}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100 disabled:text-gray-400" />
              </div>

              {error ? (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>
              ) : estado === null ? (
                <div className="flex justify-center py-6"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
              ) : !estado.Legible ? (
                /* El servidor no alcanza la carpeta (caso de producción: backend en internet, diseños
                   en la red de la oficina). Se escribe la ruta tal como la ve la PC de BarTender. */
                <>
                  <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2">
                    {estado.Motivo}
                  </div>
                  <label className="block text-xs font-medium text-gray-500">Ruta del archivo .btw</label>
                  <input value={rutaManual} onChange={e => setRutaManual(e.target.value)}
                    placeholder="\\servidor\etiquetas\GREAT GARDEN\master.btw"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  {rutaManual.trim() && !rutaConFormato && (
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
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-xs text-gray-400 truncate" title={estado.Carpeta}>Carpeta: {estado.Carpeta}</p>
                    <p className="text-xs text-gray-400 shrink-0">
                      {visibles.length} de {archivos.length} archivo{archivos.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <input value={filtro} onChange={e => setFiltro(e.target.value)}
                    placeholder="Buscar por nombre, carpeta o ruta…"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  {/* Se marcan varios: la idea es dejar cargados de una vez todos los artes distintos
                      del cliente. Los que ya están asignados salen apagados para no chocar contra la
                      unicidad de (cliente, subcliente, archivo). */}
                  <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-52 overflow-y-auto bg-white">
                    {visibles.map(a => {
                      const yaEsta = yaAsignadas.has(norm(a.Ruta));
                      const marcado = marcados.includes(a.Ruta);
                      return (
                        <button key={a.Ruta} type="button" disabled={yaEsta}
                          onClick={() => { alternar(a.Ruta); if (!nombre.trim() && !marcado) setNombre(String(a.Nombre).replace(/\.btw$/i, "")); }}
                          className={`w-full text-left px-3 py-2 flex items-start gap-2 transition ${marcado ? "bg-blue-50" : "hover:bg-gray-50"} disabled:bg-gray-50 disabled:cursor-default`}>
                          <span className={`mt-0.5 w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center text-[10px] leading-none ${
                            yaEsta ? "border-gray-200 text-gray-300" : marcado ? "border-blue-600 bg-blue-600 text-white" : "border-gray-300 text-transparent"}`}>
                            ✓
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={`block text-sm truncate ${yaEsta ? "text-gray-400" : "text-gray-800"}`} title={a.Ruta}>{a.Nombre}</span>
                            {a.Carpeta !== "." && <span className="block text-xs text-gray-400 truncate">{a.Carpeta}</span>}
                          </span>
                          {yaEsta && <span className="text-[10px] text-gray-400 shrink-0 mt-1">ya agregado</span>}
                        </button>
                      );
                    })}
                    {visibles.length === 0 && (
                      <div className="px-3 py-6 text-center text-gray-400 text-sm">
                        {archivos.length === 0 ? "No hay archivos .btw en la carpeta" : "Ningún diseño coincide con la búsqueda"}
                      </div>
                    )}
                  </div>
                  {marcados.length > 0 && (
                    <p className="text-xs text-blue-700">{marcados.length} diseño{marcados.length === 1 ? "" : "s"} marcado{marcados.length === 1 ? "" : "s"}</p>
                  )}
                </>
              )}

              <div className="flex justify-end gap-2">
                {disenos.length > 0 && (
                  <button type="button" onClick={() => { setAgregando(false); limpiarAlta(); }}
                    className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 transition">Cancelar</button>
                )}
                <button type="button" onClick={confirmarAlta} disabled={!puedeAgregar}
                  className="bg-blue-600 text-white text-sm font-semibold px-4 py-1.5 rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
                  {marcados.length > 1 ? `Agregar ${marcados.length}` : "Agregar"}
                </button>
              </div>
            </div>
          )}

          {disenos.length === 0 && !agregando && (
            <p className="text-sm text-gray-400">Sin diseños asignados.</p>
          )}
        </div>

        <div className="px-6 py-4 border-t flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition">Cerrar</button>
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
                        // Ordena por el diseño que se ve primero en la celda: el predeterminado.
                        diseno: x => disenosDe(x.CodigoSubcliente)[0]?.Nombre || "",
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

  // Los diseños de un subcliente ("" = los del cliente), ya con el predeterminado al frente: es el
  // orden en que los devuelve el backend y el mismo en que se ofrecen al imprimir.
  const disenosDe = (codigoSubcliente) =>
    disenos.filter(d => d.CodigoSubcliente === (codigoSubcliente ?? "") && d.Activo);

  const agregarDiseno = async ({ RutaBtw, Nombre }) => {
    const res = await fetch("/api/diseno-etiqueta-cliente", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({
        CodigoCliente: clienteSel.Codigo,
        CodigoSubcliente: modalDiseno.sub,
        RutaBtw, Nombre,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { alert(data.error || "No se pudo agregar el diseño"); return; }
    fetchDisenos(clienteSel.Codigo);
  };

  const predeterminarDiseno = async (disenoId) => {
    const res = await fetch(`/api/diseno-etiqueta-cliente/${disenoId}/predeterminado`,
      { method: "PUT", headers: authHeader() });
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error || "No se pudo cambiar el predeterminado"); return; }
    fetchDisenos(clienteSel.Codigo);
  };

  const renombrarDiseno = async (disenoId, Nombre) => {
    const res = await fetch(`/api/diseno-etiqueta-cliente/${disenoId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ Nombre }),
    });
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error || "No se pudo renombrar"); return; }
    fetchDisenos(clienteSel.Codigo);
  };

  const quitarDiseno = async (disenoId) => {
    await fetch(`/api/diseno-etiqueta-cliente/${disenoId}`, { method: "DELETE", headers: authHeader() });
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
            <span className="text-xs font-medium text-gray-500 shrink-0">Diseños por defecto del cliente</span>
            <div className="min-w-0 flex-1 text-right">
              {puedeEditar ? (
                <button onClick={() => setModalDiseno({ sub: "", titulo: clienteSel.RazonSocial })}
                  className={`text-xs font-medium truncate max-w-full inline-block ${disenosDe("").length ? "text-blue-600 hover:text-blue-800" : "text-gray-400 hover:text-blue-600"}`}
                  title={disenosDe("").map(d => d.RutaBtw).join("\n") || "Sin diseño asignado"}>
                  {resumenDisenos(disenosDe("")) || "+ Asignar"}
                </button>
              ) : (
                <span className="text-xs text-gray-700 truncate inline-block max-w-full">
                  {resumenDisenos(disenosDe("")) || "—"}
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
                        const propios = disenosDe(s.CodigoSubcliente);
                        const propio = resumenDisenos(propios);
                        const heredado = resumenDisenos(disenosDe(""));
                        const abrir = () => setModalDiseno({ sub: s.CodigoSubcliente, titulo: s.RazonSocial });
                        if (propio) {
                          const detalle = propios.map(d => `${d.EsPredeterminado ? "★ " : ""}${d.Nombre} — ${d.RutaBtw}`).join("\n");
                          return puedeEditar ? (
                            <button onClick={abrir}
                              className="text-blue-600 hover:text-blue-800 text-xs font-medium truncate max-w-full block text-left" title={detalle}>
                              {propio}
                            </button>
                          ) : <span className="text-xs text-gray-700 truncate block" title={detalle}>{propio}</span>;
                        }
                        return puedeEditar ? (
                          <button onClick={abrir}
                            className="text-xs text-gray-400 hover:text-blue-600 truncate max-w-full block text-left"
                            title={heredado ? `Usa los diseños del cliente: ${heredado}` : "Sin diseño asignado"}>
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
        <DisenosModal titulo={modalDiseno.titulo} disenos={disenosDe(modalDiseno.sub)} puedeEditar={puedeEditar}
          onAgregar={agregarDiseno} onPredeterminado={predeterminarDiseno} onRenombrar={renombrarDiseno}
          onQuitar={quitarDiseno} onClose={() => setModalDiseno(null)} />
      )}
    </div>
  );
}
