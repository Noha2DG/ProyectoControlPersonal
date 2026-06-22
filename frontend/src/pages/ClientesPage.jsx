import { useState, useEffect, useCallback } from "react";
import { authHeader } from "../context/AuthContext.jsx";

const PAISES = ["GT", "US", "MX", "TW"];

function ClienteModal({ item, onSave, onClose }) {
  const isEdit = !!item;
  const [form, setForm] = useState({ Codigo: item?.Codigo || "", RazonSocial: item?.RazonSocial || "", Pais: item?.Pais || "GT" });
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
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">País *</label>
            <select required value={form.Pais} onChange={set("Pais")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              {PAISES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
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

export default function ClientesPage() {
  const [clientes, setClientes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clienteSel, setClienteSel] = useState(null);
  const [subclientes, setSubclientes] = useState([]);
  const [loadingSub, setLoadingSub] = useState(false);
  const [modalCliente, setModalCliente] = useState({ open: false, item: null });
  const [modalSub, setModalSub] = useState({ open: false, item: null });
  const [busqueda, setBusqueda] = useState("");

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

  const seleccionarCliente = (c) => { setClienteSel(c); fetchSubclientes(c.Codigo); };

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
    <div className="flex gap-4">
      {/* Columna Clientes */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap gap-3 items-center mb-4">
          <input type="text" placeholder="Buscar cliente..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-blue-400" />
          <span className="text-sm text-gray-500 ml-auto">{clientesFiltrados.length} cliente{clientesFiltrados.length !== 1 ? "s" : ""}</span>
          <button onClick={() => setModalCliente({ open: true, item: null })}
            className="bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition">
            + Nuevo Cliente
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                  <th className="px-4 py-3 text-left">Código</th>
                  <th className="px-4 py-3 text-left">Razón Social</th>
                  <th className="px-4 py-3 text-left">País</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                  <th className="px-4 py-3 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {clientesFiltrados.map(c => (
                  <tr key={c.Codigo} onClick={() => seleccionarCliente(c)}
                    className={`cursor-pointer transition ${clienteSel?.Codigo === c.Codigo ? "bg-blue-50" : "hover:bg-gray-50"} ${!c.Activo ? "opacity-50" : ""}`}>
                    <td className="px-4 py-3 font-mono font-bold text-gray-700">{c.Codigo}</td>
                    <td className="px-4 py-3 text-gray-900">{c.RazonSocial}</td>
                    <td className="px-4 py-3 text-gray-700">{c.Pais}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${c.Activo ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                        {c.Activo ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                      <div className="flex justify-center gap-2">
                        <button onClick={() => setModalCliente({ open: true, item: c })}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition">Editar</button>
                        <button onClick={() => handleToggleCliente(c)}
                          className={`text-xs font-medium px-2 py-1 rounded transition ${c.Activo ? "text-red-500 hover:text-red-700 hover:bg-red-50" : "text-green-600 hover:text-green-800 hover:bg-green-50"}`}>
                          {c.Activo ? "Desactivar" : "Activar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Columna Subclientes */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap gap-3 items-center mb-4">
          <h3 className="text-sm font-medium text-gray-600">
            Subclientes {clienteSel ? <span className="font-semibold text-gray-800">— {clienteSel.RazonSocial}</span> : ""}
          </h3>
          <button onClick={() => setModalSub({ open: true, item: null })} disabled={!clienteSel}
            className="ml-auto bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
            + Nuevo Subcliente
          </button>
        </div>

        {!clienteSel ? (
          <div className="bg-white rounded-xl shadow px-4 py-8 text-center text-gray-400 text-sm">Seleccione un cliente para ver sus subclientes</div>
        ) : loadingSub ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                  <th className="px-4 py-3 text-left">Código</th>
                  <th className="px-4 py-3 text-left">Razón Social</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                  <th className="px-4 py-3 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {subclientes.map(s => (
                  <tr key={s.CodigoSubcliente} className={`hover:bg-gray-50 transition ${!s.Activo ? "opacity-50" : ""}`}>
                    <td className="px-4 py-3 font-mono font-bold text-gray-700">{s.CodigoSubcliente}</td>
                    <td className="px-4 py-3 text-gray-900">{s.RazonSocial}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${s.Activo ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                        {s.Activo ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex justify-center gap-2">
                        <button onClick={() => setModalSub({ open: true, item: s })}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition">Editar</button>
                        <button onClick={() => handleToggleSub(s)}
                          className={`text-xs font-medium px-2 py-1 rounded transition ${s.Activo ? "text-red-500 hover:text-red-700 hover:bg-red-50" : "text-green-600 hover:text-green-800 hover:bg-green-50"}`}>
                          {s.Activo ? "Desactivar" : "Activar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {subclientes.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">Sin subclientes</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalCliente.open && (
        <ClienteModal item={modalCliente.item} onSave={handleSaveCliente} onClose={() => setModalCliente({ open: false, item: null })} />
      )}
      {modalSub.open && clienteSel && (
        <SubclienteModal item={modalSub.item} codigoCliente={clienteSel.Codigo} onSave={handleSaveSub} onClose={() => setModalSub({ open: false, item: null })} />
      )}
    </div>
  );
}
