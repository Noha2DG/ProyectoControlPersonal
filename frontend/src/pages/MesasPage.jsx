import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import { authHeader, usePuede } from "../context/AuthContext.jsx";
import { urlDeMesa } from "../utils/mesas.js";
import MesasPersonasPage from "./MesasPersonasPage.jsx";

const API = "/api/mesas";

// Peladoras: MESA 1–8. Aprendizaje: APRENDIZAJE 1–4 (numeración propia). Banda: quienes se quedan sin producción en su área y
// se mandan a pelar para completar el día (ver backend/scripts/createMesas.ts).
const TIPOS = [
  { valor: "PELADORAS", label: "Peladoras", clase: "bg-blue-100 text-blue-700" },
  { valor: "APRENDIZAJE", label: "Aprendizaje", clase: "bg-amber-100 text-amber-700" },
  { valor: "BANDA", label: "Banda", clase: "bg-purple-100 text-purple-700" },
];
const tipoDe = valor => TIPOS.find(t => t.valor === valor) ?? TIPOS[0];

const EMPTY = { Codigo: "", Nombre: "", Tipo: "PELADORAS", Orden: "" };

function MesaModal({ item, siguienteOrden, onSave, onClose }) {
  const isEdit = !!item;
  const [form, setForm] = useState(isEdit ? { ...item } : { ...EMPTY, Orden: siguienteOrden });
  const set = f => e => setForm(p => ({ ...p, [f]: e.target.value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">{isEdit ? "Editar Mesa" : "Nueva Mesa"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={e => { e.preventDefault(); onSave(form, isEdit); }} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Código *</label>
            <input required disabled={isEdit} value={form.Codigo} onChange={set("Codigo")} maxLength={10} placeholder="MESA13"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Nombre *</label>
            <input required value={form.Nombre} onChange={set("Nombre")} maxLength={50} placeholder="MESA 13"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Tipo *</label>
              <select required value={form.Tipo} onChange={set("Tipo")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                {TIPOS.map(t => <option key={t.valor} value={t.valor}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Orden *</label>
              <input required type="number" step="1" value={form.Orden} onChange={set("Orden")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
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

// Letrero para pegar en la mesa (plastificado: el área es húmeda), dos por hoja carta. El QR abre la
// producción de hoy de esa mesa en el celular del supervisor (#/mesa/:codigo, pide sesión y el
// permiso mesas.reporte).
function LetreroMesa({ mesa }) {
  return (
    <div className="border-2 border-black rounded-xl flex flex-col items-center justify-center gap-3 py-6"
      style={{ breakInside: "avoid", height: "11.5cm" }}>
      <p className="text-5xl font-black tracking-wide">{mesa.Nombre}</p>
      <QRCodeSVG value={urlDeMesa(mesa.Codigo)} size={230} />
      <p className="text-base">Escanea para ver la producción de hoy</p>
    </div>
  );
}

// Pestaña "Mesas de Pelado" de Catálogos: el catálogo de mesas y el tablero de personas por mesa.
export default function MesasPage() {
  const [vista, setVista] = useState("personas");
  return (
    <div>
      <div className="flex gap-1 bg-gray-200 rounded-lg p-1 mb-4 w-fit">
        {[["personas", "Personas por mesa"], ["catalogo", "Catálogo de mesas"]].map(([k, l]) => (
          <button key={k} onClick={() => setVista(k)}
            className={`px-3 py-1 rounded-md text-sm font-medium transition ${vista === k ? "bg-white shadow text-blue-700" : "text-gray-600 hover:text-gray-800"}`}>
            {l}
          </button>
        ))}
      </div>
      {vista === "personas" ? <MesasPersonasPage /> : <CatalogoMesas />}
    </div>
  );
}

function CatalogoMesas() {
  const puedeCrear = usePuede("mesas", "crear");
  const puedeEditar = usePuede("mesas", "editar");
  const puedeEliminar = usePuede("mesas", "eliminar");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, item: null });
  const [filtro, setFiltro] = useState("Activo");
  const [aImprimir, setAImprimir] = useState(null);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await fetch(API, { headers: authHeader() });
      const data = await res.json();
      if (Array.isArray(data)) setItems(data);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchItems(); }, []);

  // Dispara el diálogo de impresión cuando los letreros ya están montados en #print-root.
  useEffect(() => {
    if (!aImprimir) return;
    const alTerminar = () => setAImprimir(null);
    window.addEventListener("afterprint", alTerminar);
    const id = setTimeout(() => window.print(), 50);
    return () => { clearTimeout(id); window.removeEventListener("afterprint", alTerminar); };
  }, [aImprimir]);

  const handleSave = async (form, isEdit) => {
    const res = await fetch(isEdit ? `${API}/${form.Codigo}` : API, {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(form),
    });
    if (res.ok) { setModal({ open: false, item: null }); fetchItems(); }
    else { const e = await res.json(); alert("Error: " + e.error); }
  };

  const handleToggle = async (item) => {
    if (item.Activa) {
      if (!confirm(`¿Desactivar "${item.Nombre}"?`)) return;
      const res = await fetch(`${API}/${item.Codigo}`, { method: "DELETE", headers: authHeader() });
      if (!res.ok) { const e = await res.json(); alert("Error: " + e.error); }
    } else {
      await fetch(`${API}/${item.Codigo}`, {
        method: "PUT", headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ ...item, Activa: true }),
      });
    }
    fetchItems();
  };

  const filtrados = items.filter(i => filtro === "Todos" || (filtro === "Activo" ? i.Activa : !i.Activa));
  const siguienteOrden = items.filter(i => i.Tipo !== "BANDA").reduce((max, i) => Math.max(max, i.Orden), 0) + 1;

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <div className="flex gap-1 bg-gray-200 rounded-lg p-1">
          {["Activo", "Inactivo", "Todos"].map(f => (
            <button key={f} onClick={() => setFiltro(f)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition ${filtro === f ? "bg-white shadow text-blue-700" : "text-gray-600 hover:text-gray-800"}`}>
              {f}
            </button>
          ))}
        </div>
        <span className="text-sm text-gray-500 ml-auto">{filtrados.length} mesa{filtrados.length !== 1 ? "s" : ""}</span>
        <button onClick={() => setAImprimir(items.filter(i => i.Activa))} disabled={!items.some(i => i.Activa)}
          className="border border-gray-300 text-gray-700 text-sm font-semibold px-4 py-2 rounded-lg hover:bg-gray-50 transition disabled:opacity-40">
          Imprimir QR de todas
        </button>
        {puedeCrear && (
          <button onClick={() => setModal({ open: true, item: null })}
            className="bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition">
            + Nueva Mesa
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="bg-white rounded-xl shadow overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                <th className="px-4 py-3 text-left">Orden</th>
                <th className="px-4 py-3 text-left">Código</th>
                <th className="px-4 py-3 text-left">Nombre</th>
                <th className="px-4 py-3 text-left">Tipo</th>
                <th className="px-4 py-3 text-right">Personas</th>
                <th className="px-4 py-3 text-center">Estado</th>
                <th className="px-4 py-3 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtrados.map(item => (
                <tr key={item.Codigo} className={`hover:bg-gray-50 transition ${!item.Activa ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3 text-gray-500">{item.Orden}</td>
                  <td className="px-4 py-3 font-mono font-bold text-gray-700">{item.Codigo}</td>
                  <td className="px-4 py-3 text-gray-900 font-semibold">{item.Nombre}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${tipoDe(item.Tipo).clase}`}>
                      {tipoDe(item.Tipo).label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">{item.Personas}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${item.Activa ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                      {item.Activa ? "Activa" : "Inactiva"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center gap-2">
                      {item.Activa && (
                        <button onClick={() => setAImprimir([item])}
                          className="text-gray-600 hover:text-gray-800 text-xs font-medium px-2 py-1 rounded hover:bg-gray-100 transition">QR</button>
                      )}
                      {puedeEditar && (
                        <button onClick={() => setModal({ open: true, item })}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition">Editar</button>
                      )}
                      {((item.Activa && puedeEliminar) || (!item.Activa && puedeEditar)) && (
                        <button onClick={() => handleToggle(item)}
                          className={`text-xs font-medium px-2 py-1 rounded transition ${item.Activa ? "text-red-500 hover:text-red-700 hover:bg-red-50" : "text-green-600 hover:text-green-800 hover:bg-green-50"}`}>
                          {item.Activa ? "Desactivar" : "Activar"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Sin registros</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modal.open && (
        <MesaModal item={modal.item} siguienteOrden={siguienteOrden} onSave={handleSave}
          onClose={() => setModal({ open: false, item: null })} />
      )}

      {aImprimir && createPortal(
        <div className="hidden print:block">
          <style>{"@media print { @page { size: letter; margin: 1.2cm; } }"}</style>
          <div className="flex flex-col gap-[1cm]">
            {aImprimir.map(m => <LetreroMesa key={m.Codigo} mesa={m} />)}
          </div>
        </div>,
        document.getElementById("print-root")
      )}
    </div>
  );
}
