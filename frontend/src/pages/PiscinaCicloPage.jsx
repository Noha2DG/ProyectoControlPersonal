import { useState, useEffect, useCallback } from "react";
import { authHeader } from "../context/AuthContext.jsx";

function PiscinaModal({ item, codigoFinca, onSave, onClose }) {
  const isEdit = !!item;
  const [nombre, setNombre] = useState(item?.Nombre || "");
  const handleSubmit = e => { e.preventDefault(); onSave({ CodigoFinca: codigoFinca, Nombre: nombre, PiscinaId: item?.PiscinaId }); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">{isEdit ? "Editar Piscina" : "Nueva Piscina"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Nombre / Código de la piscina *</label>
            <input required value={nombre} onChange={e => setNombre(e.target.value)} maxLength={20}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-400" />
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

function CicloModal({ item, piscinaId, onSave, onClose }) {
  const isEdit = !!item;
  const [form, setForm] = useState({
    Anio: item?.Anio || new Date().getFullYear(),
    Ciclo: item?.Ciclo || "",
    FechaInicio: item?.FechaInicio?.slice(0, 10) || "",
    FechaCierre: item?.FechaCierre?.slice(0, 10) || "",
  });
  const set = f => e => setForm(p => ({ ...p, [f]: e.target.value }));
  const handleSubmit = e => { e.preventDefault(); onSave({ ...form, PiscinaId: piscinaId, CicloId: item?.CicloId }); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">{isEdit ? "Editar Ciclo" : "Nuevo Ciclo"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Año *</label>
              <input required type="number" disabled={isEdit} value={form.Anio} onChange={set("Anio")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Ciclo *</label>
              <input required type="number" disabled={isEdit} value={form.Ciclo} onChange={set("Ciclo")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Fecha Inicio</label>
            <input type="date" value={form.FechaInicio} onChange={set("FechaInicio")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Fecha Cierre</label>
            <input type="date" value={form.FechaCierre} onChange={set("FechaCierre")}
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

export default function PiscinaCicloPage() {
  const [fincas, setFincas] = useState([]);
  const [codigoFinca, setCodigoFinca] = useState("");
  const [piscinas, setPiscinas] = useState([]);
  const [piscinaSel, setPiscinaSel] = useState(null);
  const [ciclos, setCiclos] = useState([]);
  const [loadingPiscinas, setLoadingPiscinas] = useState(false);
  const [loadingCiclos, setLoadingCiclos] = useState(false);
  const [modalPiscina, setModalPiscina] = useState({ open: false, item: null });
  const [modalCiclo, setModalCiclo] = useState({ open: false, item: null });

  useEffect(() => {
    fetch("/api/finca", { headers: authHeader() }).then(r => r.json()).then(d => {
      if (Array.isArray(d)) { setFincas(d.filter(f => f.Activo)); if (d.length) setCodigoFinca(d[0].Codigo); }
    });
  }, []);

  const fetchPiscinas = useCallback(async () => {
    if (!codigoFinca) return;
    setLoadingPiscinas(true);
    try {
      const res = await fetch(`/api/piscina?finca=${codigoFinca}`, { headers: authHeader() });
      const data = await res.json();
      if (Array.isArray(data)) setPiscinas(data);
    } finally { setLoadingPiscinas(false); }
  }, [codigoFinca]);

  useEffect(() => { setPiscinaSel(null); setCiclos([]); fetchPiscinas(); }, [codigoFinca, fetchPiscinas]);

  const fetchCiclos = useCallback(async (piscinaId) => {
    setLoadingCiclos(true);
    try {
      const res = await fetch(`/api/ciclo?piscinaId=${piscinaId}`, { headers: authHeader() });
      const data = await res.json();
      if (Array.isArray(data)) setCiclos(data);
    } finally { setLoadingCiclos(false); }
  }, []);

  const seleccionarPiscina = (p) => { setPiscinaSel(p); fetchCiclos(p.PiscinaId); };

  const handleSavePiscina = async (form) => {
    const isEdit = !!form.PiscinaId;
    const res = await fetch(isEdit ? `/api/piscina/${form.PiscinaId}` : "/api/piscina", {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(form),
    });
    if (res.ok) { setModalPiscina({ open: false, item: null }); fetchPiscinas(); }
    else { const e = await res.json(); alert("Error: " + e.error); }
  };

  const handleTogglePiscina = async (p) => {
    if (p.Activo) {
      if (!confirm(`¿Desactivar la piscina "${p.Nombre}"?`)) return;
      await fetch(`/api/piscina/${p.PiscinaId}`, { method: "DELETE", headers: authHeader() });
    } else {
      await fetch(`/api/piscina/${p.PiscinaId}`, {
        method: "PUT", headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ ...p, Activo: true }),
      });
    }
    fetchPiscinas();
  };

  const handleSaveCiclo = async (form) => {
    const isEdit = !!form.CicloId;
    const res = await fetch(isEdit ? `/api/ciclo/${form.CicloId}` : "/api/ciclo", {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(form),
    });
    if (res.ok) { setModalCiclo({ open: false, item: null }); fetchCiclos(piscinaSel.PiscinaId); }
    else { const e = await res.json(); alert("Error: " + e.error); }
  };

  const handleToggleCiclo = async (c) => {
    if (c.Activo) {
      if (!confirm("¿Desactivar este ciclo?")) return;
      await fetch(`/api/ciclo/${c.CicloId}`, { method: "DELETE", headers: authHeader() });
    } else {
      await fetch(`/api/ciclo/${c.CicloId}`, {
        method: "PUT", headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ ...c, Activo: true }),
      });
    }
    fetchCiclos(piscinaSel.PiscinaId);
  };

  const fmtFecha = (f) => f ? f.slice(0, 10) : "—";

  return (
    <div className="flex gap-4">
      {/* Columna Piscinas */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap gap-3 items-center mb-4">
          <label className="text-sm font-medium text-gray-600">Finca</label>
          <select value={codigoFinca} onChange={e => setCodigoFinca(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
            {fincas.map(f => <option key={f.Codigo} value={f.Codigo}>{f.Codigo} — {f.Descripcion}</option>)}
          </select>
          <span className="text-sm text-gray-500 ml-auto">{piscinas.length} piscina{piscinas.length !== 1 ? "s" : ""}</span>
          <button onClick={() => setModalPiscina({ open: true, item: null })} disabled={!codigoFinca}
            className="bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
            + Nueva Piscina
          </button>
        </div>

        {loadingPiscinas ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                  <th className="px-4 py-3 text-left">Piscina</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                  <th className="px-4 py-3 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {piscinas.map(p => (
                  <tr key={p.PiscinaId}
                    onClick={() => seleccionarPiscina(p)}
                    className={`cursor-pointer transition ${piscinaSel?.PiscinaId === p.PiscinaId ? "bg-blue-50" : "hover:bg-gray-50"} ${!p.Activo ? "opacity-50" : ""}`}>
                    <td className="px-4 py-3 font-mono font-semibold text-gray-700">{p.Nombre}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${p.Activo ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                        {p.Activo ? "Activa" : "Inactiva"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                      <div className="flex justify-center gap-2">
                        <button onClick={() => setModalPiscina({ open: true, item: p })}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition">Editar</button>
                        <button onClick={() => handleTogglePiscina(p)}
                          className={`text-xs font-medium px-2 py-1 rounded transition ${p.Activo ? "text-red-500 hover:text-red-700 hover:bg-red-50" : "text-green-600 hover:text-green-800 hover:bg-green-50"}`}>
                          {p.Activo ? "Desactivar" : "Activar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {piscinas.length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400">Sin piscinas para esta finca</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Columna Ciclos */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap gap-3 items-center mb-4">
          <h3 className="text-sm font-medium text-gray-600">
            Ciclos {piscinaSel ? <span className="font-mono font-bold text-gray-800">— {piscinaSel.Nombre}</span> : ""}
          </h3>
          <button onClick={() => setModalCiclo({ open: true, item: null })} disabled={!piscinaSel}
            className="ml-auto bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
            + Nuevo Ciclo
          </button>
        </div>

        {!piscinaSel ? (
          <div className="bg-white rounded-xl shadow px-4 py-8 text-center text-gray-400 text-sm">Seleccione una piscina para ver sus ciclos</div>
        ) : loadingCiclos ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                  <th className="px-4 py-3 text-left">Año</th>
                  <th className="px-4 py-3 text-left">Ciclo</th>
                  <th className="px-4 py-3 text-left">Inicio</th>
                  <th className="px-4 py-3 text-left">Cierre</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                  <th className="px-4 py-3 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ciclos.map(c => (
                  <tr key={c.CicloId} className={`hover:bg-gray-50 transition ${!c.Activo ? "opacity-50" : ""}`}>
                    <td className="px-4 py-3 font-mono text-gray-700">{c.Anio}</td>
                    <td className="px-4 py-3 font-mono text-gray-700">{c.Ciclo}</td>
                    <td className="px-4 py-3 text-gray-600">{fmtFecha(c.FechaInicio)}</td>
                    <td className="px-4 py-3 text-gray-600">{fmtFecha(c.FechaCierre)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${c.Activo ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                        {c.Activo ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex justify-center gap-2">
                        <button onClick={() => setModalCiclo({ open: true, item: c })}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition">Editar</button>
                        <button onClick={() => handleToggleCiclo(c)}
                          className={`text-xs font-medium px-2 py-1 rounded transition ${c.Activo ? "text-red-500 hover:text-red-700 hover:bg-red-50" : "text-green-600 hover:text-green-800 hover:bg-green-50"}`}>
                          {c.Activo ? "Desactivar" : "Activar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {ciclos.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Sin ciclos para esta piscina</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalPiscina.open && (
        <PiscinaModal item={modalPiscina.item} codigoFinca={codigoFinca} onSave={handleSavePiscina} onClose={() => setModalPiscina({ open: false, item: null })} />
      )}
      {modalCiclo.open && piscinaSel && (
        <CicloModal item={modalCiclo.item} piscinaId={piscinaSel.PiscinaId} onSave={handleSaveCiclo} onClose={() => setModalCiclo({ open: false, item: null })} />
      )}
    </div>
  );
}
