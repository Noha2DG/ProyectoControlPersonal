import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth, authHeader } from "../context/AuthContext.jsx";

const DIAS  = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

function fechaLarga() {
  const d = new Date();
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

function fechaCorta() {
  const d = new Date();
  return `${d.getDate()} de ${MESES[d.getMonth()]}`;
}

const ESTADO_CLS = {
  Pendiente:  "bg-yellow-100 text-yellow-700",
  Completo:   "bg-green-100 text-green-700",
  Incompleto: "bg-red-100 text-red-700",
};

export default function EquipoUniformesPage() {
  const { logout } = useAuth();
  const [fecha, setFecha]   = useState(fechaLarga());
  const [tipos, setTipos]   = useState([]);
  const [registros, setRegistros] = useState([]);
  const [cargando, setCargando]   = useState(false);

  const [codigoInput, setCodigoInput] = useState("");
  const [empleados, setEmpleados]     = useState([]);
  const [sugerenciasAbiertas, setSugerenciasAbiertas] = useState(false);
  const [empleado, setEmpleado]       = useState(null);
  const [entrega, setEntrega]         = useState(null); // null = sin asignar hoy
  const [seleccion, setSeleccion]     = useState({});   // { CodigoTipoEquipo: boolean }
  const [extraSeleccion, setExtraSeleccion] = useState({}); // equipo adicional a agregar a medio turno
  const [escaneando, setEscaneando]   = useState(false);
  const [guardando, setGuardando]     = useState(false);
  const [agregando, setAgregando]     = useState(false);
  const [errorMsg, setErrorMsg]       = useState("");
  const [exito, setExito]             = useState("");
  const [avisoTipos, setAvisoTipos]       = useState("");
  const [avisoRegistros, setAvisoRegistros] = useState("");

  const codigoRef = useRef(null);

  function mensajeError(res) {
    if (res.status === 401) return "Sesión expirada o sin permiso — vuelva a iniciar sesión";
    return `Error del servidor (${res.status})`;
  }

  useEffect(() => {
    const id = setInterval(() => setFecha(fechaLarga()), 60000);
    return () => clearInterval(id);
  }, []);

  const fetchTipos = useCallback(async () => {
    try {
      const res = await fetch("/api/equipo/tipos", { headers: authHeader() });
      if (!res.ok) throw new Error(mensajeError(res));
      const data = await res.json();
      if (Array.isArray(data)) { setTipos(data); setAvisoTipos(""); }
    } catch (err) {
      setAvisoTipos(`No se pudo cargar el catálogo de equipo: ${err.message || "sin conexión"}`);
    }
  }, []);

  useEffect(() => { fetchTipos(); }, [fetchTipos]);
  useEffect(() => {
    const id = setInterval(fetchTipos, 30000);
    return () => clearInterval(id);
  }, [fetchTipos]);

  useEffect(() => {
    fetch("/api/empleados", { headers: authHeader() })
      .then(r => r.ok ? r.json() : [])
      .then(d => { if (Array.isArray(d)) setEmpleados(d.filter(e => e.Estado === "Activo")); })
      .catch(() => {});
  }, []);

  const fetchRegistros = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch("/api/equipo/hoy", { headers: authHeader() });
      if (!res.ok) throw new Error(mensajeError(res));
      const data = await res.json();
      if (Array.isArray(data)) { setRegistros(data); setAvisoRegistros(""); }
    } catch (err) {
      setAvisoRegistros(`No se pudo cargar las entregas de hoy: ${err.message || "sin conexión"}`);
    }
    finally { setCargando(false); }
  }, []);

  useEffect(() => { fetchRegistros(); }, [fetchRegistros]);
  useEffect(() => {
    const id = setInterval(fetchRegistros, 30000);
    return () => clearInterval(id);
  }, [fetchRegistros]);

  const limpiarSesion = () => {
    setCodigoInput(""); setEmpleado(null); setEntrega(null);
    setSeleccion({}); setExtraSeleccion({}); setErrorMsg(""); setExito("");
    setSugerenciasAbiertas(false);
    fetchRegistros();
    codigoRef.current?.focus();
  };

  const buscarEmpleado = async (cod) => {
    if (!cod) return;
    setSugerenciasAbiertas(false);
    setCodigoInput("");
    setEscaneando(true);
    setErrorMsg(""); setExito("");
    setEmpleado(null); setEntrega(null); setSeleccion({}); setExtraSeleccion({});

    try {
      const res = await fetch(`/api/equipo/entrega/${encodeURIComponent(cod)}`, { headers: authHeader() });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "Error al consultar empleado");
      } else {
        setEmpleado(data.empleado);
        setEntrega(data.entrega);
        if (data.entrega && !data.entrega.FechaHoraDevolucion) {
          // Modo devolución: por defecto se asume que devolvió todo, el operador desmarca lo faltante
          const init = {};
          for (const it of data.entrega.items) init[it.CodigoTipoEquipo] = true;
          setSeleccion(init);
        }
      }
    } catch {
      setErrorMsg("No se pudo conectar con el servidor");
    } finally {
      setEscaneando(false);
      codigoRef.current?.focus();
    }
  };

  const handleCodigoKey = (e) => {
    if (e.key !== "Enter" && e.key !== "Tab") return;
    e.preventDefault();
    buscarEmpleado(codigoInput.trim().toUpperCase());
  };

  const handleSelectSugerencia = (emp) => {
    buscarEmpleado(emp.Codigo);
  };

  const q = codigoInput.trim().toLowerCase();
  const sugerencias = q
    ? empleados.filter(e =>
        e.Codigo.toLowerCase().includes(q) || e.NombreCompleto.toLowerCase().includes(q)
      ).slice(0, 8)
    : [];

  const toggleItem = (codigo) => setSeleccion(s => ({ ...s, [codigo]: !s[codigo] }));
  const toggleExtra = (codigo) => setExtraSeleccion(s => ({ ...s, [codigo]: !s[codigo] }));

  const handleAsignar = async () => {
    const items = Object.keys(seleccion).filter(k => seleccion[k]);
    if (items.length === 0) { setErrorMsg("Seleccione al menos una prenda"); return; }
    setGuardando(true); setErrorMsg("");
    try {
      const res = await fetch("/api/equipo/entrega", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ Codigo: empleado.Codigo, items }),
      });
      const data = await res.json();
      if (!res.ok) { setErrorMsg(data.error || "Error al asignar equipo"); return; }
      setExito("Equipo asignado correctamente");
      await fetchRegistros();
      setTimeout(limpiarSesion, 2000);
    } catch {
      setErrorMsg("No se pudo conectar con el servidor");
    } finally {
      setGuardando(false);
    }
  };

  const handleDevolucion = async () => {
    const devueltos = Object.keys(seleccion).filter(k => seleccion[k]);
    setGuardando(true); setErrorMsg("");
    try {
      const res = await fetch(`/api/equipo/entrega/${entrega.id}/devolucion`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ devueltos }),
      });
      const data = await res.json();
      if (!res.ok) { setErrorMsg(data.error || "Error al confirmar devolución"); return; }
      setExito(data.estado === "Completo" ? "Devolución completa confirmada" : "Devolución registrada — faltan prendas");
      await fetchRegistros();
      setTimeout(limpiarSesion, 2500);
    } catch {
      setErrorMsg("No se pudo conectar con el servidor");
    } finally {
      setGuardando(false);
    }
  };

  const handleAgregar = async () => {
    const items = Object.keys(extraSeleccion).filter(k => extraSeleccion[k]);
    if (items.length === 0) { setErrorMsg("Seleccione al menos una prenda para agregar"); return; }
    setAgregando(true); setErrorMsg("");
    try {
      const res = await fetch(`/api/equipo/entrega/${entrega.id}/agregar`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok) { setErrorMsg(data.error || "Error al agregar equipo"); return; }
      setEntrega(e => ({ ...e, items: data.items }));
      setSeleccion(s => {
        const next = { ...s };
        for (const codigo of items) next[codigo] = true;
        return next;
      });
      setExtraSeleccion({});
      setExito("Equipo adicional agregado");
      await fetchRegistros();
    } catch {
      setErrorMsg("No se pudo conectar con el servidor");
    } finally {
      setAgregando(false);
    }
  };

  const modo = !empleado ? null
    : !entrega ? "asignar"
    : !entrega.FechaHoraDevolucion ? "devolver"
    : "cerrado";

  const itemsDisponiblesParaAgregar = modo === "devolver"
    ? tipos.filter(t => !entrega.items.some(it => it.CodigoTipoEquipo === t.Codigo))
    : [];

  const incompletos = registros.filter(r => r.Estado === "Incompleto");

  return (
    <div className="min-h-screen bg-gray-200 flex flex-col select-none font-sans">

      {/* Encabezado */}
      <div className="bg-gray-300 border-b border-gray-400 px-6 py-3 flex items-center justify-between shadow shrink-0">
        <div>
          <h1 className="text-3xl font-black tracking-wide text-gray-800 uppercase">Entrega de Uniformes</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs font-semibold text-gray-600 bg-white border border-gray-400 px-3 py-0.5 rounded">Fecha</span>
            <span className="text-xs font-bold text-gray-800 bg-white border border-gray-400 px-3 py-0.5 rounded">{fecha}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { fetchTipos(); fetchRegistros(); }}
            className="bg-gray-100 border border-gray-400 rounded px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-white transition flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Actualizar
          </button>
          <button onClick={limpiarSesion}
            className="bg-gray-100 border border-gray-400 rounded px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-white transition">
            Limpiar
          </button>
          <button onClick={() => { logout(); window.location.hash = ""; }}
            className="bg-red-600 text-white border border-red-700 rounded px-3 py-1.5 text-xs font-semibold hover:bg-red-700 transition flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Cerrar sesión
          </button>
        </div>
      </div>

      {/* Aviso de conexión/sesión — visible para no ocultar fallas como listas vacías silenciosas */}
      {(avisoTipos || avisoRegistros) && (
        <div className="bg-red-600 text-white text-sm font-semibold px-6 py-2 flex flex-col gap-0.5 shrink-0">
          {avisoTipos && <span>⚠ {avisoTipos}</span>}
          {avisoRegistros && <span>⚠ {avisoRegistros}</span>}
        </div>
      )}

      {/* Cuerpo */}
      <div className="flex gap-4 px-6 py-4 shrink-1 overflow-x-auto">

        {/* Formulario */}
        <div className="w-[600px] shrink-0">
          <div className="bg-white border border-gray-400 rounded shadow-sm">

            {/* Carnet */}
            <div className="flex items-center border-b border-gray-300 px-4 py-3 gap-3">
              <span className="w-28 text-sm font-semibold text-gray-700 shrink-0">Carnet</span>
              <div className="relative w-56">
                <input
                  ref={codigoRef}
                  value={codigoInput}
                  onChange={e => { setCodigoInput(e.target.value.toUpperCase()); setSugerenciasAbiertas(true); }}
                  onKeyDown={handleCodigoKey}
                  onFocus={() => setSugerenciasAbiertas(true)}
                  onBlur={() => setTimeout(() => setSugerenciasAbiertas(false), 150)}
                  placeholder="Escanear o buscar..."
                  autoFocus
                  autoComplete="off"
                  disabled={escaneando}
                  className="w-full border border-gray-400 rounded px-2 py-1 text-sm font-mono text-center uppercase focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
                />
                {sugerenciasAbiertas && sugerencias.length > 0 && (
                  <ul className="absolute z-20 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-56 overflow-y-auto text-left">
                    {sugerencias.map(e => (
                      <li key={e.Codigo} onMouseDown={() => handleSelectSugerencia(e)}
                        className="px-3 py-2 text-xs hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0">
                        <span className="font-mono font-bold text-gray-700">{e.Codigo}</span>
                        <span className="text-gray-600"> — {e.NombreCompleto}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className={`flex-1 border rounded px-3 py-1 text-sm min-h-[32px] flex items-center ${
                empleado ? "border-blue-300 bg-blue-50 text-blue-900 font-semibold" : "border-gray-300 bg-gray-50 text-gray-400"
              }`}>
                {escaneando
                  ? <span className="flex items-center gap-2 text-gray-500"><div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />Procesando...</span>
                  : empleado ? empleado.NombreCompleto : "—"}
              </div>
            </div>

            {modo === "asignar" && (
              <div className="px-4 py-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Equipo a asignar</p>
                {tipos.length === 0 ? (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
                    No se pudo cargar el catálogo de equipo. Presione "Actualizar" arriba o recargue la página.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {tipos.map(t => (
                      <label key={t.Codigo} className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 text-sm cursor-pointer hover:bg-blue-50">
                        <input type="checkbox" checked={!!seleccion[t.Codigo]} onChange={() => toggleItem(t.Codigo)}
                          className="w-4 h-4 accent-blue-600 cursor-pointer" />
                        {t.Nombre}
                      </label>
                    ))}
                  </div>
                )}
                <button onClick={handleAsignar} disabled={guardando || tipos.length === 0}
                  className="mt-3 w-full bg-blue-600 text-white font-semibold py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
                  {guardando ? "Guardando..." : "Guardar asignación"}
                </button>
              </div>
            )}

            {modo === "devolver" && (
              <div className="px-4 py-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Confirmar devolución de equipo</p>
                <div className="grid grid-cols-2 gap-2">
                  {entrega.items.map(it => (
                    <label key={it.CodigoTipoEquipo} className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 text-sm cursor-pointer hover:bg-green-50">
                      <input type="checkbox" checked={!!seleccion[it.CodigoTipoEquipo]} onChange={() => toggleItem(it.CodigoTipoEquipo)}
                        className="w-4 h-4 accent-green-600 cursor-pointer" />
                      {it.Nombre}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-2">Desmarque las prendas que no fueron devueltas.</p>
                <button onClick={handleDevolucion} disabled={guardando}
                  className="mt-3 w-full bg-green-600 text-white font-semibold py-2 rounded-lg hover:bg-green-700 transition disabled:opacity-50">
                  {guardando ? "Guardando..." : "Confirmar devolución"}
                </button>

                {itemsDisponiblesParaAgregar.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-gray-200">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      Agregar equipo (cambio de área a medio turno)
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {itemsDisponiblesParaAgregar.map(t => (
                        <label key={t.Codigo} className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 text-sm cursor-pointer hover:bg-blue-50">
                          <input type="checkbox" checked={!!extraSeleccion[t.Codigo]} onChange={() => toggleExtra(t.Codigo)}
                            className="w-4 h-4 accent-blue-600 cursor-pointer" />
                          {t.Nombre}
                        </label>
                      ))}
                    </div>
                    <button onClick={handleAgregar} disabled={agregando}
                      className="mt-3 w-full bg-blue-600 text-white font-semibold py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
                      {agregando ? "Agregando..." : "Agregar equipo"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {modo === "cerrado" && (
              <div className="px-4 py-3">
                <p className="text-sm text-gray-600">
                  Hoy ya se registró la entrega y devolución de equipo de este empleado.
                </p>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {entrega.items.map(it => (
                    <div key={it.CodigoTipoEquipo} className={`flex items-center gap-2 border rounded-lg px-3 py-2 text-sm ${
                      it.Devuelto ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"
                    }`}>
                      {it.Devuelto ? "✓" : "✗"} {it.Nombre}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Mensajes */}
          {errorMsg && (
            <div className="mt-2 bg-red-50 border border-red-300 text-red-700 text-sm px-4 py-2 rounded flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              {errorMsg}
            </div>
          )}
          {exito && (
            <div className="mt-2 bg-green-50 border border-green-300 text-green-700 text-sm px-4 py-2 rounded flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {exito}
            </div>
          )}
        </div>
      </div>

      {/* Tabla + panel de incompletos */}
      <div className="flex gap-4 px-6 pb-6 flex-1 overflow-auto">

        <div className="flex-1 min-w-0 bg-white border border-gray-400 rounded shadow-sm overflow-hidden self-start">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-200 border-b border-gray-400">
                <th className="px-3 py-2 text-left font-semibold text-gray-600 border-r border-gray-300 whitespace-nowrap">Empleado</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600 border-r border-gray-300">Nombre</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600 border-r border-gray-300">Equipo</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600 border-r border-gray-300 whitespace-nowrap">H. Entrega</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600 border-r border-gray-300 whitespace-nowrap">H. Devolución</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600 whitespace-nowrap">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {cargando && registros.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Cargando...</td></tr>
              ) : registros.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Sin entregas de equipo hoy</td></tr>
              ) : registros.map((r, i) => (
                <tr key={r.id} className={`${i % 2 === 0 ? "bg-white" : "bg-gray-50"}`}>
                  <td className="px-3 py-1.5 font-mono text-gray-700 border-r border-gray-200 whitespace-nowrap">{r.Codigo}</td>
                  <td className="px-3 py-1.5 text-gray-900 border-r border-gray-200 whitespace-nowrap">{r.NombreCompleto}</td>
                  <td className="px-3 py-1.5 border-r border-gray-200">
                    <div className="flex flex-wrap gap-1">
                      {r.items.map(it => (
                        <span key={it.Nombre} className={`px-1.5 py-0.5 rounded text-xs ${it.Devuelto ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                          {it.Nombre}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-center font-mono text-gray-600 border-r border-gray-200 whitespace-nowrap">{r.HoraEntrega}</td>
                  <td className="px-3 py-1.5 text-center font-mono text-gray-600 border-r border-gray-200 whitespace-nowrap">{r.HoraDevolucion || "—"}</td>
                  <td className="px-3 py-1.5 text-center whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${ESTADO_CLS[r.Estado] || "bg-gray-100 text-gray-600"}`}>
                      {r.Estado}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="bg-gray-100 border-t border-gray-300 px-4 py-1.5 flex items-center justify-between">
            <span className="text-xs text-gray-500">{registros.length} entrega{registros.length !== 1 ? "s" : ""} hoy</span>
            <span className="text-xs text-gray-400">Actualiza cada 30 seg</span>
          </div>
        </div>

        {/* Panel: equipo incompleto del día */}
        <div className="w-80 shrink-0 bg-white border border-red-300 rounded shadow-sm overflow-hidden self-start">
          <div className="bg-red-50 border-b border-red-300 px-3 py-2 flex items-center justify-between">
            <span className="text-xs font-bold text-red-700 uppercase tracking-wide">Equipo incompleto · {fechaCorta()}</span>
            <span className="bg-red-600 text-white text-xs font-bold rounded-full px-2 py-0.5">{incompletos.length}</span>
          </div>
          <div className="divide-y divide-gray-100 max-h-[420px] overflow-y-auto">
            {incompletos.length === 0 ? (
              <p className="px-3 py-6 text-center text-gray-400 text-xs">Sin pendientes — todo el equipo fue devuelto</p>
            ) : incompletos.map(r => (
              <div key={r.id} className="px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-gray-600">{r.Codigo}</span>
                  <span className="text-xs text-gray-400">{r.HoraDevolucion}</span>
                </div>
                <p className="text-sm font-medium text-gray-900 leading-tight">{r.NombreCompleto}</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {r.items.filter(it => !it.Devuelto).map(it => (
                    <span key={it.Nombre} className="px-1.5 py-0.5 rounded text-xs bg-red-100 text-red-700 font-medium">
                      ✗ {it.Nombre}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
