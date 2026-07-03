import { useState, useEffect, useCallback } from "react";
import { authHeader } from "../context/AuthContext.jsx";

function hoy() { return new Date().toLocaleDateString("sv-SE"); }

// Combo de texto con búsqueda — igual al patrón usado en Pedidos para catálogos largos (Clase)
function ComboBuscable({ options, value, onChange, placeholder, required, disabled }) {
  const selected = options.find(o => String(o.value) === String(value));
  const [query, setQuery] = useState(selected ? selected.label : "");
  const [open, setOpen] = useState(false);

  useEffect(() => { setQuery(selected ? selected.label : ""); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = query.trim().toLowerCase();
  const filtradas = (q ? options.filter(o => o.label.toLowerCase().includes(q)) : options).slice(0, 50);

  const handleSelect = (opt) => { setQuery(opt.label); setOpen(false); onChange(opt.value); };
  const handleChange = (e) => { setQuery(e.target.value); setOpen(true); if (value) onChange(""); };

  return (
    <div className="relative">
      <input type="text" required={required} disabled={disabled} value={query} onChange={handleChange}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => { setOpen(false); setQuery(selected ? selected.label : ""); }, 150)}
        placeholder={placeholder} autoComplete="off"
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100" />
      {open && !disabled && filtradas.length > 0 && (
        <ul className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {filtradas.map(o => (
            <li key={o.value} onMouseDown={() => handleSelect(o)} className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer">{o.label}</li>
          ))}
        </ul>
      )}
      {open && !disabled && filtradas.length === 0 && (
        <ul className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg">
          <li className="px-3 py-2 text-sm text-gray-400">Sin resultados</li>
        </ul>
      )}
    </div>
  );
}

function LoteModal({ item, fincas, clases, tallas, onSave, onClose }) {
  const isEdit = !!item;
  const [form, setForm] = useState({
    CodigoFinca: item?.CodigoFinca || (fincas[0]?.Codigo ?? ""),
    PiscinaId: item?.PiscinaId || "",
    CicloNumero: item?.Ciclo ? String(item.Ciclo) : "",
    Clase: item?.Clase || "",
    TallaReferencia: item?.TallaReferencia ? String(item.TallaReferencia) : "",
    Fecha: item?.Fecha?.slice(0, 10) || hoy(),
    PesoIngreso: item?.PesoIngreso ?? "",
    UM: "KG",
  });
  const [piscinas, setPiscinas] = useState([]);
  const [ultimoCiclo, setUltimoCiclo] = useState(null);
  const set = f => e => setForm(p => ({ ...p, [f]: e.target.value }));
  const setVal = f => val => setForm(p => ({ ...p, [f]: val }));

  // Los sifones (ej. "TM-SIFON") no son piscinas de cultivo — nunca deben llevar ciclo
  const piscinaSeleccionada = piscinas.find(p => String(p.PiscinaId) === String(form.PiscinaId));
  const esSifon = piscinaSeleccionada?.Nombre?.includes("SIFON") ?? false;

  useEffect(() => {
    if (!form.CodigoFinca) { setPiscinas([]); return; }
    fetch(`/api/piscina?finca=${form.CodigoFinca}`, { headers: authHeader() })
      .then(r => r.json()).then(d => { if (Array.isArray(d)) setPiscinas(d.filter(p => p.Activo)); });
  }, [form.CodigoFinca]);

  useEffect(() => {
    if (!form.PiscinaId) { setUltimoCiclo(null); return; }
    fetch(`/api/ciclo?piscinaId=${form.PiscinaId}`, { headers: authHeader() })
      .then(r => r.json()).then(d => {
        if (Array.isArray(d) && d.length > 0) setUltimoCiclo(d[0]); // ya viene Anio DESC, Ciclo DESC
        else setUltimoCiclo(null);
      });
  }, [form.PiscinaId]);

  // Al cargar la piscina, pre-llenar con el último ciclo registrado (solo si es lote nuevo y no es sifón)
  useEffect(() => {
    if (isEdit || esSifon) return;
    setForm(p => ({ ...p, CicloNumero: ultimoCiclo ? String(ultimoCiclo.Ciclo) : "" }));
  }, [ultimoCiclo?.CicloId, esSifon]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = e => { e.preventDefault(); onSave(form); };

  // Vista previa del código de lote (se confirma en el servidor al guardar, donde se asigna el secuencial real del día)
  const isoSemana = (fecha) => {
    const [anio, mes, dia] = fecha.split("-").map(Number);
    const date = new Date(Date.UTC(anio, mes - 1, dia));
    const diaSemanaISO = date.getUTCDay() || 7;
    const jueves = new Date(date);
    jueves.setUTCDate(date.getUTCDate() + 4 - diaSemanaISO);
    const inicioAnio = new Date(Date.UTC(jueves.getUTCFullYear(), 0, 1));
    const semana = Math.ceil((((jueves.getTime() - inicioAnio.getTime()) / 86400000) + 1) / 7);
    return { diaSemanaISO, semana };
  };
  const previewLote = () => {
    if (!form.Fecha || !form.PiscinaId) return null;
    const piscina = piscinas.find(p => String(p.PiscinaId) === String(form.PiscinaId));
    if (!piscina) return null;
    const [anio] = form.Fecha.split("-").map(Number);
    const letra = String.fromCharCode(65 + (anio - 2020));
    const { diaSemanaISO, semana } = isoSemana(form.Fecha);
    const segFecha = `${letra}${diaSemanaISO}${String(semana).padStart(2, "0")}`;
    const [parte1, parte2] = piscina.Nombre.split("-");
    return [`${segFecha}${parte1}`, parte2, form.CicloNumero || "?"].filter(Boolean).join("-");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">{isEdit ? "Editar Lote" : "Nuevo Lote — Materia Prima"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Lote</label>
            <div className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm font-mono text-gray-600">
              {isEdit ? item.Lote : (previewLote() || "Seleccione piscina, ciclo y fecha...")}
            </div>
            {!isEdit && <p className="text-xs text-gray-400 mt-1">Se genera automáticamente al guardar (el secuencial final lo asigna el servidor)</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Finca *</label>
            <select required disabled={isEdit} value={form.CodigoFinca}
              onChange={e => setForm(p => ({ ...p, CodigoFinca: e.target.value, PiscinaId: "", CicloNumero: "" }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100">
              <option value="">Seleccione...</option>
              {fincas.map(f => <option key={f.Codigo} value={f.Codigo}>{f.Codigo} — {f.Descripcion}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Piscina *</label>
            <select required disabled={isEdit || !form.CodigoFinca} value={form.PiscinaId}
              onChange={e => setForm(p => ({ ...p, PiscinaId: e.target.value, CicloNumero: "" }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100">
              <option value="">Seleccione...</option>
              {piscinas.map(p => <option key={p.PiscinaId} value={p.PiscinaId}>{p.Nombre}</option>)}
            </select>
          </div>
          {form.PiscinaId && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Ciclo</label>
              {esSifon ? (
                <div className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-400">
                  Este sifón no maneja ciclo
                </div>
              ) : isEdit ? (
                <div className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-600">
                  {form.CicloNumero ? `Ciclo ${form.CicloNumero}` : "Sin ciclo"}
                </div>
              ) : (
                <input
                  type="number"
                  min="1"
                  value={form.CicloNumero}
                  onChange={e => setForm(p => ({ ...p, CicloNumero: e.target.value }))}
                  placeholder="Número de ciclo"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              )}
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Clase — Materia Prima *</label>
            <ComboBuscable required disabled={isEdit} value={form.Clase} onChange={setVal("Clase")}
              placeholder="Buscar clase..."
              options={clases.map(c => ({ value: c.Clase, label: `${c.Clase} — ${c.Descripcion}` }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Talla de Referencia</label>
            <select value={form.TallaReferencia} onChange={set("TallaReferencia")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="">Seleccione...</option>
              {tallas.map(t => <option key={t.Codigo} value={t.Codigo}>{t.Codigo} — {t.Descripcion}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Fecha de Ingreso</label>
              <div className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-600">
                {form.Fecha}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">UM</label>
              <div className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-600">
                KG
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Peso de Ingreso *</label>
            <input required type="number" step="0.01" value={form.PesoIngreso} onChange={set("PesoIngreso")}
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

function TransaccionModal({ lote, procesos, clases, tallas, almacenes, onSave, onClose }) {
  const [form, setForm] = useState({
    ClasePT: "", Talla: "",
    AlmacenOrigen: lote.AlmacenCodigo || (almacenes[0]?.Codigo ?? ""),
    AlmacenDestino: almacenes[0]?.Codigo ?? "",
    FechaProduccion: hoy(),
  });
  const set = f => e => setForm(p => ({ ...p, [f]: e.target.value }));
  const setVal = f => val => setForm(p => ({ ...p, [f]: val }));

  // El Proceso ya no se elige a mano: cada Clase PT trae su Proceso asignado en el catálogo de Clase.
  const clasePTSel = clases.find(c => c.Clase === form.ClasePT);
  const procesoDerivado = clasePTSel?.Proceso;
  const procesoInfo = procesos.find(p => p.Proceso === procesoDerivado);

  const handleSubmit = e => { e.preventDefault(); onSave({ ...form, Lote: lote.Lote, Proceso: procesoDerivado }); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">Nueva Transacción — {lote.Lote}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Origen (Materia Prima) — Clase</label>
            <div className="border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-600 font-mono">
              {lote.Clase} — {lote.DescripcionClase}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Se convierte en (Clase PT) *</label>
            <ComboBuscable required value={form.ClasePT} onChange={setVal("ClasePT")}
              placeholder="Buscar clase de producto terminado..."
              options={clases.map(c => ({ value: c.Clase, label: `${c.Clase} — ${c.Descripcion}` }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Proceso</label>
            <div className="border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-600">
              {procesoDerivado ? `${procesoDerivado} — ${procesoInfo?.Descripcion ?? ""}` : "Seleccione la Clase PT para determinar el proceso"}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Talla *</label>
            <select required value={form.Talla} onChange={set("Talla")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="">Seleccione...</option>
              {tallas.map(t => <option key={t.Codigo} value={t.Codigo}>{t.Codigo} — {t.Descripcion}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Fecha de Producción *</label>
            <input required type="date" value={form.FechaProduccion} onChange={set("FechaProduccion")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Almacén Origen *</label>
              <select required value={form.AlmacenOrigen} onChange={set("AlmacenOrigen")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                {almacenes.map(a => <option key={a.Codigo} value={a.Codigo}>{a.Codigo}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Almacén Destino *</label>
              <select required value={form.AlmacenDestino} onChange={set("AlmacenDestino")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                {almacenes.map(a => <option key={a.Codigo} value={a.Codigo}>{a.Codigo}</option>)}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition">Cancelar</button>
            <button type="submit" className="px-5 py-2 text-sm bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition">Crear</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function MateriaPrimaPage() {
  const [lotes, setLotes] = useState([]);
  const [fincas, setFincas] = useState([]);
  const [clases, setClases] = useState([]);
  const [procesos, setProcesos] = useState([]);
  const [tallas, setTallas] = useState([]);
  const [almacenes, setAlmacenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loteSel, setLoteSel] = useState(null);
  const [transacciones, setTransacciones] = useState([]);
  const [loadingTrans, setLoadingTrans] = useState(false);
  const [modalLote, setModalLote] = useState({ open: false, item: null });
  const [modalTrans, setModalTrans] = useState(false);
  const [busqueda, setBusqueda] = useState("");

  const fetchLotes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/lotes?fecha=${hoy()}`, { headers: authHeader() });
      const data = await res.json();
      if (Array.isArray(data)) setLotes(data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchLotes();
    Promise.all([
      fetch("/api/finca", { headers: authHeader() }).then(r => r.json()),
      fetch("/api/clase", { headers: authHeader() }).then(r => r.json()),
      fetch("/api/procesos", { headers: authHeader() }).then(r => r.json()),
      fetch("/api/tallas", { headers: authHeader() }).then(r => r.json()),
      fetch("/api/almacenes", { headers: authHeader() }).then(r => r.json()),
    ]).then(([f, c, pr, t, a]) => {
      if (Array.isArray(f)) setFincas(f.filter(x => x.Activo));
      if (Array.isArray(c)) setClases(c.filter(x => x.Activo));
      if (Array.isArray(pr)) setProcesos(pr.filter(x => x.Activo));
      if (Array.isArray(t)) setTallas(t.filter(x => x.Activo));
      if (Array.isArray(a)) setAlmacenes(a.filter(x => x.Activo));
    });
  }, [fetchLotes]);

  const fetchTransacciones = useCallback(async (lote) => {
    setLoadingTrans(true);
    try {
      const res = await fetch(`/api/transacciones-produccion?lote=${encodeURIComponent(lote)}`, { headers: authHeader() });
      const data = await res.json();
      if (Array.isArray(data)) setTransacciones(data);
    } finally { setLoadingTrans(false); }
  }, []);

  const seleccionarLote = (l) => { setLoteSel(l); fetchTransacciones(l.Lote); };

  const handleSaveLote = async (form) => {
    try {
      const isEdit = !!modalLote.item;
      const res = await fetch(isEdit ? `/api/lotes/${modalLote.item.Lote}` : "/api/lotes", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify(form),
      });
      if (res.ok) { setModalLote({ open: false, item: null }); fetchLotes(); }
      else { const e = await res.json(); alert("Error: " + e.error); }
    } catch (err) {
      console.error("Error al guardar el lote:", err);
      alert("No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.");
    }
  };

  const handleEliminarLote = async (l) => {
    if (!confirm(`¿Eliminar el lote ${l.Lote}? Esta acción no se puede deshacer.`)) return;
    try {
      const res = await fetch(`/api/lotes/${l.Lote}`, { method: "DELETE", headers: authHeader() });
      if (res.ok) {
        if (loteSel?.Lote === l.Lote) setLoteSel(null);
        fetchLotes();
      } else { const e = await res.json(); alert("Error: " + e.error); }
    } catch (err) {
      console.error("Error al eliminar el lote:", err);
      alert("No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.");
    }
  };

  const handleSaveTransaccion = async (form) => {
    try {
      const res = await fetch("/api/transacciones-produccion", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify(form),
      });
      if (res.ok) { setModalTrans(false); fetchTransacciones(loteSel.Lote); fetchLotes(); }
      else { const e = await res.json(); alert("Error: " + e.error); }
    } catch (err) {
      console.error("Error al guardar la transacción:", err);
      alert("No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.");
    }
  };

  const handleCerrarTransaccion = async (t) => {
    if (!confirm("¿Cerrar esta transacción de producción?")) return;
    await fetch(`/api/transacciones-produccion/${t.TransaccionId}`, {
      method: "PUT", headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ Estado: "Cerrada" }),
    });
    fetchTransacciones(loteSel.Lote);
  };

  const handleEliminarTransaccion = async (t) => {
    if (!confirm("¿Eliminar esta transacción de producción?")) return;
    try {
      const res = await fetch(`/api/transacciones-produccion/${t.TransaccionId}`, { method: "DELETE", headers: authHeader() });
      if (res.ok) { fetchTransacciones(loteSel.Lote); fetchLotes(); }
      else { const e = await res.json(); alert("Error: " + e.error); }
    } catch (err) {
      console.error("Error al eliminar la transacción:", err);
      alert("No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.");
    }
  };

  const q = busqueda.toLowerCase();
  const lotesFiltrados = lotes.filter(l => !q || l.Lote.toLowerCase().includes(q) || l.NombreFinca.toLowerCase().includes(q));

  return (
    <div className="flex gap-4">
      {/* Columna Lotes */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap gap-3 items-center mb-4">
          <input type="text" placeholder="Buscar lote o finca..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-blue-400" />
          <span className="text-sm text-gray-500 ml-auto">{lotesFiltrados.length} lote{lotesFiltrados.length !== 1 ? "s" : ""}</span>
          <button onClick={() => setModalLote({ open: true, item: null })}
            className="bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition">
            + Nuevo Lote
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="bg-white rounded-xl shadow overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                  <th className="px-3 py-3 text-left whitespace-nowrap">Lote</th>
                  <th className="px-3 py-3 text-left whitespace-nowrap">Finca</th>
                  <th className="px-3 py-3 text-center whitespace-nowrap">Ciclo</th>
                  <th className="px-3 py-3 text-left whitespace-nowrap">Clase</th>
                  <th className="px-3 py-3 text-left whitespace-nowrap">Talla</th>
                  <th className="px-3 py-3 text-right whitespace-nowrap">Peso de Ingreso</th>
                  <th className="px-3 py-3 text-center whitespace-nowrap">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lotesFiltrados.map(l => (
                  <tr key={l.Lote} onClick={() => seleccionarLote(l)}
                    className={`cursor-pointer transition ${loteSel?.Lote === l.Lote ? "bg-blue-50" : "hover:bg-gray-50"} ${!l.Activo ? "opacity-50" : ""}`}>
                    <td className="px-3 py-3 font-mono font-bold text-gray-700 whitespace-nowrap">{l.Lote}</td>
                    <td className="px-3 py-3 text-gray-900 whitespace-nowrap">{l.NombreFinca}</td>
                    <td className="px-3 py-3 text-center font-mono text-gray-600 whitespace-nowrap">
                      {l.Ciclo != null ? <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs font-semibold">{l.Anio}/{l.Ciclo}</span> : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-3 font-mono text-gray-700 whitespace-nowrap">{l.Clase}</td>
                    <td className="px-3 py-3 text-gray-700 whitespace-nowrap">{l.DescripcionTallaReferencia || <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-3 text-right font-semibold text-gray-700 whitespace-nowrap">{Math.round(l.PesoIngreso)} {l.UM}</td>
                    <td className="px-3 py-3 text-center whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <div className="flex justify-center gap-2">
                        <button onClick={() => setModalLote({ open: true, item: l })}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition">Editar</button>
                        {l.Procesado === 0 && (
                          <button onClick={() => handleEliminarLote(l)}
                            className="text-red-500 hover:text-red-700 text-xs font-medium px-2 py-1 rounded hover:bg-red-50 transition">Eliminar</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {lotesFiltrados.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Sin lotes registrados</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Columna Transacciones del lote */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap gap-3 items-center mb-4">
          <h3 className="text-sm font-medium text-gray-600">
            Transacciones {loteSel ? <span className="font-mono font-bold text-gray-800">— {loteSel.Lote}</span> : ""}
          </h3>
          <button onClick={() => setModalTrans(true)} disabled={!loteSel}
            className="ml-auto bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
            + Nueva Transacción
          </button>
        </div>

        {!loteSel ? (
          <div className="bg-white rounded-xl shadow px-4 py-8 text-center text-gray-400 text-sm">Seleccione un lote para ver sus transacciones</div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="bg-white rounded-lg shadow px-3 py-2 text-center">
                <p className="text-xs text-gray-400">Ingreso</p>
                <p className="text-sm font-bold text-gray-800">{loteSel.PesoIngreso.toFixed(2)} {loteSel.UM}</p>
              </div>
              <div className="bg-white rounded-lg shadow px-3 py-2 text-center">
                <p className="text-xs text-gray-400">Procesado</p>
                <p className="text-sm font-bold text-blue-700">{loteSel.Procesado.toFixed(2)} {loteSel.UM}</p>
              </div>
              <div className="bg-white rounded-lg shadow px-3 py-2 text-center">
                <p className="text-xs text-gray-400">Pendiente</p>
                <p className="text-sm font-bold text-amber-600">{loteSel.Pendiente.toFixed(2)} {loteSel.UM}</p>
              </div>
            </div>

            {loadingTrans ? (
              <div className="flex justify-center py-10"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
            ) : (
              <div className="bg-white rounded-xl shadow overflow-hidden overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                      <th className="px-3 py-3 text-left whitespace-nowrap">Proceso</th>
                      <th className="px-3 py-3 text-left whitespace-nowrap">Talla</th>
                      <th className="px-3 py-3 text-center whitespace-nowrap">F. Producción</th>
                      <th className="px-3 py-3 text-right whitespace-nowrap">Procesado</th>
                      <th className="px-3 py-3 text-center whitespace-nowrap">Estado</th>
                      <th className="px-3 py-3 text-center whitespace-nowrap">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {transacciones.map(t => (
                      <tr key={t.TransaccionId} className="hover:bg-gray-50 transition">
                        <td className="px-3 py-3 text-gray-700 whitespace-nowrap">{t.DescripcionProceso}</td>
                        <td className="px-3 py-3 text-gray-700 whitespace-nowrap">{t.DescripcionTalla}</td>
                        <td className="px-3 py-3 text-center text-gray-600 whitespace-nowrap">{t.FechaProduccion?.slice(0, 10)}</td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">{t.Procesado.toFixed(2)}</td>
                        <td className="px-3 py-3 text-center whitespace-nowrap">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${t.Estado === "Abierta" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                            {t.Estado}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center whitespace-nowrap">
                          <div className="flex justify-center gap-2">
                            {t.Estado === "Abierta" && (
                              <button onClick={() => handleCerrarTransaccion(t)}
                                className="text-amber-600 hover:text-amber-700 text-xs font-medium px-2 py-1 rounded hover:bg-amber-50 transition">Cerrar</button>
                            )}
                            {t.Procesado === 0 && (
                              <button onClick={() => handleEliminarTransaccion(t)}
                                className="text-red-500 hover:text-red-700 text-xs font-medium px-2 py-1 rounded hover:bg-red-50 transition">Eliminar</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {transacciones.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Sin transacciones para este lote</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {modalLote.open && (
        <LoteModal item={modalLote.item} fincas={fincas} clases={clases} tallas={tallas}
          onSave={handleSaveLote} onClose={() => setModalLote({ open: false, item: null })} />
      )}
      {modalTrans && loteSel && (
        <TransaccionModal lote={loteSel} procesos={procesos} clases={clases} tallas={tallas} almacenes={almacenes}
          onSave={handleSaveTransaccion} onClose={() => setModalTrans(false)} />
      )}
    </div>
  );
}
