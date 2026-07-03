import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "../context/AuthContext.jsx";

const DIAS  = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

function fechaLarga() {
  const d = new Date();
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

function formatDuracion(minutos) {
  if (minutos == null || minutos < 0) return "—";
  if (minutos < 60) return `${minutos}m`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/* ── Modal selector de áreas ───────────────────────────────────────── */
function AreaSelectorModal({ areas, onSelect, onClose }) {
  const [busqueda, setBusqueda] = useState("");
  // areas tiene: { CodigoArea, Nombre, Cantidad, ocupacion, disponible, bloqueada }
  const disponibles = areas.filter(a => !a.bloqueada);
  const filtradas = disponibles.filter(a =>
    a.Nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
    a.CodigoArea.toLowerCase().includes(busqueda.toLowerCase())
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[80vh]">
        <div className="px-5 py-4 border-b flex items-center justify-between shrink-0">
          <h2 className="font-semibold text-gray-800">Seleccionar Área de Entrada</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <div className="px-5 py-3 border-b shrink-0">
          <input
            autoFocus
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar área..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
        <div className="overflow-y-auto p-4 grid grid-cols-3 gap-2">
          {filtradas.map(area => {
            const llena = area.disponible === 0;
            return (
              <button key={area.CodigoArea}
                onClick={() => !llena && onSelect(area)}
                disabled={llena}
                className={`border rounded-lg px-3 py-2 text-left transition-all ${
                  llena
                    ? "bg-red-50 border-red-200 cursor-not-allowed opacity-70"
                    : "bg-blue-50 hover:bg-blue-600 hover:text-white border-blue-200 group"
                }`}>
                <span className={`block text-xs font-mono ${llena ? "text-red-400" : "text-blue-400 group-hover:text-blue-100"}`}>
                  {area.CodigoArea}
                </span>
                <span className={`text-xs font-semibold leading-tight ${llena ? "text-red-700" : "text-blue-900 group-hover:text-white"}`}>
                  {area.Nombre}
                </span>
                <span className={`block text-xs mt-0.5 ${llena ? "text-red-500 font-semibold" : "text-blue-500 group-hover:text-blue-200"}`}>
                  {llena ? "Llena" : `${area.disponible} disponible${area.disponible !== 1 ? "s" : ""}`}
                </span>
              </button>
            );
          })}
          {filtradas.length === 0 && (
            <p className="col-span-3 text-center text-gray-400 text-sm py-6">Sin resultados</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Página principal ──────────────────────────────────────────────── */
export default function TransferenciasPage() {
  const { logout } = useAuth();
  const [fecha, setFecha]         = useState(fechaLarga());
  const [areas, setAreas]         = useState([]);
  const [registros, setRegistros] = useState([]);
  const [cargando, setCargando]   = useState(false);
  const [modalAreas, setModalAreas] = useState(false);

  // Area Entrada
  const [areaEntradaInput, setAreaEntradaInput] = useState("");
  const [areaEntrada, setAreaEntrada]           = useState(null);

  // Area Salida (read-only)
  const [areaSalida, setAreaSalida] = useState(null);

  // Carnet + empleado
  const [carnetInput, setCarnetInput] = useState("");
  const [empleado, setEmpleado]       = useState(null);
  const [escaneando, setEscaneando]   = useState(false);
  const [errorMsg, setErrorMsg]       = useState("");
  const [avisoAreas, setAvisoAreas]       = useState("");
  const [avisoRegistros, setAvisoRegistros] = useState("");

  const areaRef   = useRef(null);
  const carnetRef = useRef(null);
  const resultadoTimerRef = useRef(null);

  // Ingreso masivo: tras un escaneo exitoso se muestra el nombre ~1s y se limpia
  // solo el resultado del carnet — el Área Entrada se mantiene para la siguiente persona.
  const limpiarResultado = useCallback(() => {
    if (resultadoTimerRef.current) clearTimeout(resultadoTimerRef.current);
    resultadoTimerRef.current = setTimeout(() => {
      setEmpleado(null);
      setAreaSalida(null);
    }, 1000);
  }, []);

  useEffect(() => () => { if (resultadoTimerRef.current) clearTimeout(resultadoTimerRef.current); }, []);

  // Mantener el foco en el input de Carnet (lector de código de barras),
  // salvo cuando el usuario está escribiendo en Área Entrada o hay un modal abierto.
  useEffect(() => {
    if (modalAreas) return;
    const refocus = () => {
      if (document.activeElement === areaRef.current) return;
      carnetRef.current?.focus();
    };
    document.addEventListener("click", refocus);
    return () => document.removeEventListener("click", refocus);
  }, [modalAreas]);

  function mensajeError(res) {
    if (res.status === 401) return "Sesión expirada o sin permiso — vuelva a iniciar sesión";
    return `Error del servidor (${res.status})`;
  }

  useEffect(() => {
    const id = setInterval(() => setFecha(fechaLarga()), 60000);
    return () => clearInterval(id);
  }, []);

  const fetchAreas = useCallback(async () => {
    try {
      const token = localStorage.getItem("cp_token");
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch("/api/planificacion/kiosco", { headers });
      if (!res.ok) throw new Error(mensajeError(res));
      const data = await res.json();
      if (Array.isArray(data)) { setAreas(data); setAvisoAreas(""); }
    } catch (err) {
      setAvisoAreas(`No se pudo cargar la planificación de áreas: ${err.message || "sin conexión"}`);
    }
  }, []);

  useEffect(() => { fetchAreas(); }, [fetchAreas]);

  // Refrescar disponibilidad cada 30 seg (junto con registros)
  useEffect(() => {
    const id = setInterval(fetchAreas, 30000);
    return () => clearInterval(id);
  }, [fetchAreas]);

  const fetchRegistros = useCallback(async () => {
    setCargando(true);
    try {
      const token = localStorage.getItem("cp_token");
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const params = areaEntrada ? `?area=${encodeURIComponent(areaEntrada.CodigoArea)}` : "";
      const res = await fetch(`/api/transferencias/hoy${params}`, { headers });
      if (!res.ok) throw new Error(mensajeError(res));
      const data = await res.json();
      if (Array.isArray(data)) { setRegistros(data); setAvisoRegistros(""); }
    } catch (err) {
      setAvisoRegistros(`No se pudo cargar las transferencias de hoy: ${err.message || "sin conexión"}`);
    }
    finally { setCargando(false); }
  }, [areaEntrada]);

  useEffect(() => { fetchRegistros(); }, [fetchRegistros]);

  useEffect(() => {
    const id = setInterval(fetchRegistros, 30000);
    return () => clearInterval(id);
  }, [fetchRegistros]);

  // Validar área por código (contra planificación)
  const aplicarAreaCodigo = (cod) => {
    const codUp = cod.trim().toUpperCase();
    if (!codUp) { setAreaEntrada(null); setErrorMsg("Ingrese el código de área"); return; }
    const found = areas.find(a => a.CodigoArea === codUp);
    if (!found) {
      setAreaEntrada(null);
      setErrorMsg(`Área "${codUp}" no encontrada`);
    } else if (found.bloqueada) {
      setAreaEntrada(null);
      setErrorMsg(`Área "${codUp}" no está programada para hoy`);
    } else if (found.disponible === 0) {
      setAreaEntrada(null);
      setErrorMsg(`Área "${codUp}" está llena (${found.ocupacion}/${found.Cantidad})`);
    } else {
      setAreaEntrada(found);
      setAreaSalida(null);
      setEmpleado(null);
      setErrorMsg("");
      carnetRef.current?.focus();
    }
  };

  const handleAreaKey = (e) => {
    if (e.key !== "Enter" && e.key !== "Tab") return;
    e.preventDefault();
    aplicarAreaCodigo(areaEntradaInput);
  };

  // Selección desde modal
  const handleSelectArea = (area) => {
    setAreaEntradaInput(area.CodigoArea);
    setAreaEntrada(area);
    setAreaSalida(null);
    setEmpleado(null);
    setErrorMsg("");
    setModalAreas(false);
    carnetRef.current?.focus();
  };

  // Escanear carnet
  const handleCarnetKey = async (e) => {
    if (e.key !== "Enter" && e.key !== "Tab") return;
    e.preventDefault();
    const cod = carnetInput.trim().toUpperCase();
    if (!cod) return;
    if (!areaEntrada) {
      setErrorMsg("Primero seleccione el Área de Entrada");
      areaRef.current?.focus();
      return;
    }
    if (resultadoTimerRef.current) clearTimeout(resultadoTimerRef.current);
    setCarnetInput("");
    setEscaneando(true);
    setErrorMsg("");
    setEmpleado(null);
    setAreaSalida(null);

    try {
      const token = localStorage.getItem("cp_token");
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch("/api/transferencias", {
        method: "POST",
        headers,
        body: JSON.stringify({ Codigo: cod, CodigoArea: areaEntrada.CodigoArea }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "Error al registrar");
        await fetchAreas(); // refrescar por si cambió la ocupación
      } else {
        setEmpleado(data.empleado);
        setAreaSalida(data.ultimaArea || null);
        limpiarResultado();
        await Promise.all([fetchRegistros(), fetchAreas()]);
      }
    } catch {
      setErrorMsg("No se pudo conectar con el servidor");
    } finally {
      setEscaneando(false);
      carnetRef.current?.focus();
    }
  };

  const limpiarSesion = () => {
    if (resultadoTimerRef.current) clearTimeout(resultadoTimerRef.current);
    setAreaEntradaInput(""); setAreaEntrada(null);
    setAreaSalida(null); setEmpleado(null);
    setCarnetInput(""); setErrorMsg("");
    // fetchRegistros() no se llama aquí: al limpiar areaEntrada, su identidad cambia
    // (deja de filtrar por área) y el useEffect de abajo dispara el refetch solo.
    areaRef.current?.focus();
  };

  const abiertos = registros.filter(r => !r.HoraSalida);
  const cerrados = registros.filter(r =>  r.HoraSalida);

  return (
    <div className="min-h-screen bg-gray-200 flex flex-col select-none font-sans">

      {/* Encabezado */}
      <div className="bg-gray-300 border-b border-gray-400 px-6 py-3 flex items-center justify-between shadow shrink-0">
        <div>
          <h1 className="text-3xl font-black tracking-wide text-gray-800 uppercase">Transferencias</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs font-semibold text-gray-600 bg-white border border-gray-400 px-3 py-0.5 rounded">Fecha</span>
            <span className="text-xs font-bold text-gray-800 bg-white border border-gray-400 px-3 py-0.5 rounded">{fecha}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchRegistros}
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
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Cerrar sesión
          </button>
        </div>
      </div>

      {/* Aviso de conexión/sesión — visible para no ocultar fallas como listas vacías silenciosas */}
      {(avisoAreas || avisoRegistros) && (
        <div className="bg-red-600 text-white text-sm font-semibold px-6 py-2 flex flex-col gap-0.5 shrink-0">
          {avisoAreas && <span>⚠ {avisoAreas}</span>}
          {avisoRegistros && <span>⚠ {avisoRegistros}</span>}
        </div>
      )}

      {/* Cuerpo */}
      <div className="flex gap-4 px-6 py-4 shrink-1 overflow-x-auto">

        {/* Formulario */}
        <div className="w-[800px] shrink-0">
          <div className="bg-white border border-gray-400 rounded shadow-sm">

            {/* Area Entrada */}
            <div className="flex items-center border-b border-gray-300 px-4 py-3 gap-3">
              <span className="w-32 text-sm font-semibold text-gray-700 shrink-0">Area Entrada</span>
              <input
                ref={areaRef}
                value={areaEntradaInput}
                onChange={e => { setAreaEntradaInput(e.target.value.toUpperCase()); setAreaEntrada(null); }}
                onKeyDown={handleAreaKey}
                onDoubleClick={() => setModalAreas(true)}
                title="Escriba el código o doble clic para seleccionar"
                placeholder="Código"
                maxLength={10}
                className="w-24 border border-gray-400 rounded px-2 py-1 text-sm font-mono text-center uppercase focus:outline-none focus:ring-2 focus:ring-blue-400 cursor-text"
              />
              <div className={`flex-1 border rounded px-3 py-1 text-sm min-h-[32px] flex items-center ${
                areaEntrada ? "border-green-400 bg-green-50 text-green-800 font-semibold" : "border-gray-300 bg-gray-50 text-gray-400"
              }`}>
                {areaEntrada ? areaEntrada.Nombre : <span className="italic text-xs">Doble clic para buscar área </span>}
              </div>
              <button onClick={() => setModalAreas(true)} title="Buscar área"
                className="shrink-0 p-1.5 rounded border border-gray-300 hover:bg-blue-50 hover:border-blue-400 transition text-gray-500 hover:text-blue-600">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
              {areaEntrada && (
                <svg className="w-5 h-5 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>

            {/* Area Salida */}
            <div className="flex items-center border-b border-gray-300 px-4 py-3 gap-3">
              <span className="w-32 text-sm font-semibold text-gray-700 shrink-0">Area Salida</span>
              <div className="w-24 border border-gray-200 rounded px-2 py-1 text-sm font-mono text-center bg-gray-100 text-gray-500 min-h-[32px] flex items-center justify-center">
                {areaSalida?.Codigo || "—"}
              </div>
              <div className="flex-1 border border-gray-200 rounded px-3 py-1 text-sm min-h-[32px] flex items-center bg-gray-100 text-gray-500">
                {areaSalida ? areaSalida.Nombre : "Sin área previa"}
              </div>
              <span className="w-10 shrink-0" />
            </div>

            {/* Carnet */}
            <div className="flex items-center px-4 py-3 gap-3">
              <span className="w-32 text-sm font-semibold text-gray-700 shrink-0">Carnet</span>
              <input
                ref={carnetRef}
                value={carnetInput}
                onChange={e => setCarnetInput(e.target.value.toUpperCase())}
                onKeyDown={handleCarnetKey}
                placeholder="Escanear..."
                autoComplete="off"
                autoFocus
                disabled={escaneando}
                className="w-24 border border-gray-400 rounded px-2 py-1 text-sm font-mono text-center uppercase focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
              />
              <div className={`flex-1 border rounded px-3 py-1 text-sm min-h-[32px] flex items-center gap-2 ${
                empleado ? "border-green-400 bg-green-50 text-green-800 font-semibold" : "border-gray-300 bg-gray-50 text-gray-400"
              }`}>
                {escaneando
                  ? <span className="flex items-center gap-2 text-gray-500"><div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />Procesando...</span>
                  : empleado
                    ? <>
                        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                        {empleado.NombreCompleto}
                      </>
                    : "—"}
              </div>
              <span className="w-10 shrink-0" />
            </div>
          </div>

          {/* Error */}
          {errorMsg && (
            <div className="mt-2 bg-red-50 border border-red-300 text-red-700 text-sm px-4 py-2 rounded flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              {errorMsg}
            </div>
          )}
        </div>
      </div>

      {/* Tabla */}
      <div className="px-6 pb-6 flex-1 overflow-auto">
        <div className="bg-white border border-gray-400 rounded shadow-sm overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-200 border-b border-gray-400">
                <th className="px-3 py-2 text-left font-semibold text-gray-600 border-r border-gray-300">Empleado</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600 border-r border-gray-300">Nombre</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600 border-r border-gray-300">Área</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600 border-r border-gray-300">Nombre del Área</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600 border-r border-gray-300 whitespace-nowrap">H. Entrada</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600 border-r border-gray-300 whitespace-nowrap">H. Salida</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600 whitespace-nowrap">Duración</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {cargando && registros.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Cargando...</td></tr>
              ) : registros.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Sin transferencias hoy</td></tr>
              ) : registros.map((r, i) => {
                const abierto = !r.HoraSalida;
                return (
                  <tr key={r.id} className={`${i % 2 === 0 ? "bg-white" : "bg-gray-50"}`}>
                    <td className="px-3 py-1.5 font-mono text-gray-700 border-r border-gray-200 whitespace-nowrap">{r.Codigo}</td>
                    <td className="px-3 py-1.5 text-gray-900 border-r border-gray-200 whitespace-nowrap">{r.NombreCompleto}</td>
                    <td className="px-3 py-1.5 text-center font-mono font-bold text-blue-700 border-r border-gray-200">{r.CodigoArea}</td>
                    <td className="px-3 py-1.5 text-gray-800 border-r border-gray-200 whitespace-nowrap">{r.NombreArea}</td>
                    <td className="px-3 py-1.5 text-center font-mono text-gray-600 border-r border-gray-200 whitespace-nowrap">{r.HoraEntrada}</td>
                    <td className="px-3 py-1.5 text-center font-mono border-r border-gray-200 whitespace-nowrap">
                      {abierto
                        ? <span className="text-green-600 font-semibold">En curso</span>
                        : <span className="text-gray-600">{r.HoraSalida}</span>}
                    </td>
                    <td className="px-3 py-1.5 text-center whitespace-nowrap">
                      <span className={`font-semibold ${abierto ? "text-green-700" : "text-gray-700"}`}>
                        {formatDuracion(r.Minutos)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="bg-gray-100 border-t border-gray-300 px-4 py-1.5 flex items-center justify-between">
            <span className="text-xs text-gray-500">
              {abiertos.length > 0 && <span className="text-green-700 font-semibold mr-3">{abiertos.length} en curso</span>}
              {cerrados.length > 0 && <span>{cerrados.length} cerrado{cerrados.length !== 1 ? "s" : ""}</span>}
            </span>
            <span className="text-xs text-gray-400">
              {areaEntrada ? `Últimas 20 en ${areaEntrada.CodigoArea}` : "Últimas 15"} · Actualiza cada 30 seg
            </span>
          </div>
        </div>
      </div>

      {/* Modal selector de áreas */}
      {modalAreas && (
        <AreaSelectorModal
          areas={areas}
          onSelect={handleSelectArea}
          onClose={() => { setModalAreas(false); areaRef.current?.focus(); }}
        />
      )}
    </div>
  );
}
