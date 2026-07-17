import { useState, useEffect } from "react";
import { useAuth, authHeader } from "./context/AuthContext.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import KioscoPage from "./pages/KioscoPage.jsx";
import TransferenciasPage from "./pages/TransferenciasPage.jsx";
import UsuariosPage from "./pages/UsuariosPage.jsx";
import AreasPage from "./pages/AreasPage.jsx";
import MovimientosAdminPage from "./pages/MovimientosAdminPage.jsx";
import TransferenciasAdminPage from "./pages/TransferenciasAdminPage.jsx";
import PlanificacionPage from "./pages/PlanificacionPage.jsx";
import TiposPermisoPage from "./pages/TiposPermisoPage.jsx";
import PermisosPage from "./pages/PermisosPage.jsx";
import EquipoUniformesPage from "./pages/EquipoUniformesPage.jsx";
import CatalogosPage from "./pages/CatalogosPage.jsx";
import DestajoPage from "./pages/DestajoPage.jsx";
import EtiquetadoPage from "./pages/EtiquetadoPage.jsx";
import ImpresionEtiquetasPage from "./pages/ImpresionEtiquetasPage.jsx";
import EmpleadosTable from "./components/EmpleadosTable.jsx";
import EmpleadoModal from "./components/EmpleadoModal.jsx";
import BajaModal from "./components/BajaModal.jsx";
import ConfirmModal from "./components/ConfirmModal.jsx";

const API = "/api/empleados";

// ── Helper de permisos ─────────────────────────────────────────────
// Si permisos es null (usuario creado antes del sistema de permisos),
// se aplica el fallback según el rol guardado.
function hasPerm(user, mod, accion) {
  if (user?.rol === "admin" && !user?.permisos) return true;
  if (user?.permisos != null) return !!user.permisos[mod]?.[accion];
  // Fallback legacy: sin permisos configurados → acceso por rol
  if (user?.rol === "rrhh" || user?.rol === "readonly") {
    return mod === "empleados" && accion === "ver";
  }
  if (user?.rol === "kiosco") {
    return (mod === "kiosco" || mod === "kiosco_areas" || mod === "equipo") && accion === "ver";
  }
  return false;
}

// ── Íconos SVG inline ──────────────────────────────────────────────
const Icon = {
  empleados: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />,
  kiosco:    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />,
  transf:    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />,
  areas:     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />,
  usuarios:  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />,
  planif:    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />,
  tiposPermiso: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
  permisos:  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />,
  catalogos: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />,
  destajo:   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 7.5L12 3l9 4.5M3 7.5l9 4.5m0 0l9-4.5M3 7.5v9l9 4.5m0-13.5v13.5m0 0l9-4.5v-9" />,
  etiquetado: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.169.659 1.591l9.581 9.581a2.25 2.25 0 003.182 0l4.318-4.318a2.25 2.25 0 000-3.182L10.16 3.66A2.25 2.25 0 008.568 3zM6 6h.008v.008H6V6z" />,
  imprimir: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" />,
};

// ── Sección Empleados ──────────────────────────────────────────────
function EmpleadosSection({ canCrear, canEditar, canBaja }) {
  const { logout } = useAuth();
  const [empleados, setEmpleados] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");
  const [filtroEstado, setFiltroEstado] = useState("Activo");
  const [modal, setModal]         = useState({ open: false, empleado: null });
  const [bajaModal, setBajaModal] = useState({ open: false, empleado: null });
  const [confirm, setConfirm]     = useState({ open: false, empleado: null, ultimaBaja: null });

  const fetchEmpleados = async () => {
    setLoading(true);
    try {
      const res = await fetch(API, { headers: authHeader() });
      if (res.status === 401) { logout(); return; }
      const data = await res.json();
      if (Array.isArray(data)) setEmpleados(data);
    } finally { setLoading(false); }
  };
  useEffect(() => { fetchEmpleados(); }, []);

  const handleSave = async (formData) => {
    const isEdit = !!formData.Codigo && empleados.some(e => e.Codigo === formData.Codigo);
    const res = await fetch(isEdit ? `${API}/${formData.Codigo}` : API, {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(formData),
    });
    if (res.ok) { setModal({ open: false, empleado: null }); fetchEmpleados(); }
    else { const err = await res.json(); alert("Error: " + err.error); }
  };

  const handleBaja = async (codigo, datosBaja) => {
    const res = await fetch(`${API}/${codigo}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(datosBaja),
    });
    if (res.ok) { setBajaModal({ open: false, empleado: null }); fetchEmpleados(); }
  };

  const abrirReactivar = (emp) => {
    setConfirm({ open: true, empleado: emp, ultimaBaja: null });
    fetch(`${API}/${emp.Codigo}/bajas`, { headers: authHeader() })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data) && data.length > 0) setConfirm(prev => ({ ...prev, ultimaBaja: data[0] })); })
      .catch(() => {});
  };

  const handleReactivar = async (codigo) => {
    const res = await fetch(`${API}/${codigo}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ Estado: "Activo" }),
    });
    if (res.ok) { setConfirm({ open: false, empleado: null, ultimaBaja: null }); fetchEmpleados(); }
    else { const text = await res.text(); let msg = `HTTP ${res.status}`; try { msg = JSON.parse(text).error ?? msg; } catch { msg = text.slice(0, 120) || msg; } alert("Error al reactivar: " + msg); }
  };

  const q = search.toLowerCase();
  const filtrados = empleados.filter(e => {
    const matchEstado = filtroEstado === "Todos" || e.Estado === filtroEstado;
    const matchSearch = !q || String(e.NombreCompleto ?? "").toLowerCase().includes(q) || String(e.Codigo ?? "").toLowerCase().includes(q) || String(e.DPI ?? "").toLowerCase().includes(q) || String(e.CodigoEtalent ?? "").toLowerCase().includes(q);
    return matchEstado && matchSearch;
  });

  return (
    <>
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <input type="text" placeholder="Buscar por nombre, código, DPI o etalent..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-blue-400" />
        <div className="flex gap-1 bg-gray-200 rounded-lg p-1">
          {["Activo","Baja","Todos"].map(est => (
            <button key={est} onClick={() => setFiltroEstado(est)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition ${filtroEstado === est ? "bg-white shadow text-blue-700" : "text-gray-600 hover:text-gray-800"}`}>
              {est}
            </button>
          ))}
        </div>
        <span className="text-sm text-gray-500 ml-auto">{filtrados.length} empleado{filtrados.length !== 1 ? "s" : ""}</span>
        {canCrear && (
          <button onClick={() => setModal({ open: true, empleado: null })}
            className="bg-blue-600 text-white font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm">
            + Nuevo
          </button>
        )}
      </div>

      <EmpleadosTable empleados={filtrados} loading={loading} isAdmin={canEditar || canBaja}
        onEdit={canEditar ? (emp => setModal({ open: true, empleado: emp })) : null}
        onBaja={canBaja ? (emp => setBajaModal({ open: true, empleado: emp })) : null}
        onReactivar={canEditar ? abrirReactivar : null} />

      {modal.open && (canCrear || (canEditar && modal.empleado)) && (
        <EmpleadoModal empleado={modal.empleado} onSave={handleSave}
          onClose={() => setModal({ open: false, empleado: null })} />
      )}
      {bajaModal.open && canBaja && (
        <BajaModal empleado={bajaModal.empleado}
          onConfirm={(datos) => handleBaja(bajaModal.empleado.Codigo, datos)}
          onClose={() => setBajaModal({ open: false, empleado: null })} />
      )}
      {confirm.open && canEditar && (
        <ConfirmModal empleado={confirm.empleado} ultimaBaja={confirm.ultimaBaja}
          onConfirm={() => handleReactivar(confirm.empleado.Codigo)}
          onClose={() => setConfirm({ open: false, empleado: null, ultimaBaja: null })} />
      )}
    </>
  );
}

// ── Dashboard principal ────────────────────────────────────────────
function Dashboard() {
  const { user, logout } = useAuth();
  const perm = (mod, accion) => hasPerm(user, mod, accion);

  const nav = [];
  if (perm("empleados",      "ver")) nav.push({ key: "empleados", label: "Empleados",          icon: "empleados" });
  if (perm("movimientos",    "ver")) nav.push({ key: "kiosco",    label: "Entradas / Salidas",  icon: "kiosco"   });
  if (perm("transferencias", "ver")) nav.push({ key: "transf",    label: "Transferencias",      icon: "transf"   });
  if (perm("planificacion",   "ver")) nav.push({ key: "planif",    label: "Planificación",       icon: "planif"   });
  if (perm("destajo",        "ver")) nav.push({ key: "destajo",   label: "Destajo",             icon: "destajo"  });
  if (perm("etiquetado",     "ver")) nav.push({ key: "etiquetado", label: "Etiquetado",          icon: "etiquetado" });
  if (perm("etiquetado",     "imprimir")) nav.push({ key: "imprimirEtiquetas", label: "Impresión de Etiquetas", icon: "imprimir" });
  if (perm("areas",          "ver")) nav.push({ key: "areas",     label: "Áreas",               icon: "areas"    });
  if (perm("permisos",       "ver")) nav.push({ key: "permisos",  label: "Permisos",            icon: "permisos" });
  if (perm("tipos_permiso",  "ver")) nav.push({ key: "tiposPermiso", label: "Tipos de Permiso", icon: "tiposPermiso" });
  if (perm("usuarios",       "ver")) nav.push({ key: "usuarios",  label: "Usuarios",            icon: "usuarios" });
  if (perm("catalogos",      "ver")) nav.push({ key: "catalogos", label: "Catálogos",           icon: "catalogos" });

  const [seccion, setSeccion] = useState(nav[0]?.key ?? "empleados");
  // En escritorio el sidebar inicia expandido; en móvil inicia oculto (se abre como overlay)
  // para no robarle ancho a la pantalla angosta.
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia("(min-width: 768px)").matches);

  const seleccionarSeccion = (key) => {
    setSeccion(key);
    if (!window.matchMedia("(min-width: 768px)").matches) setSidebarOpen(false);
  };

  const TITULOS = {
    empleados: "Empleados",
    kiosco:    "Entradas / Salidas — Corrección",
    transf:    "Transferencias — Corrección",
    planif:    "Planificación por Área",
    destajo:   "Destajo — Materia Prima y Pesaje",
    etiquetado: "Etiquetado — Orden de Trabajo",
    imprimirEtiquetas: "Impresión de Etiquetas",
    areas:     "Áreas",
    permisos:  "Permisos",
    tiposPermiso: "Tipos de Permiso",
    usuarios:  "Usuarios",
    catalogos: "Catálogos de Producción",
  };

  const ROL_BADGE = {
    admin:    { label: "Administrador", cls: "bg-yellow-400 text-yellow-900" },
    readonly: { label: "Solo lectura",  cls: "bg-blue-500 text-white"        },
    rrhh:     { label: "RRHH",          cls: "bg-blue-500 text-white"        },
    kiosco:   { label: "Kiosco",        cls: "bg-purple-500 text-white"      },
  };
  const badge = ROL_BADGE[user?.rol] ?? { label: user?.rol, cls: "bg-gray-400 text-white" };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">

      {/* Header */}
      <header className="bg-blue-800 text-white shadow-md z-10 shrink-0">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(o => !o)}
              className="p-1.5 rounded-lg hover:bg-blue-600 transition" title="Menú">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div>
              <h1 className="text-lg font-bold tracking-wide leading-none">ORO BI</h1>
              <p className="text-blue-200 text-xs mt-0.5">Planta Proceso · Oropsa</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {perm("kiosco", "ver") && (
              <a href="#/kiosco" onClick={() => { window.location.hash = "#/kiosco"; }}
                className="hidden sm:flex items-center gap-1.5 text-blue-200 hover:text-white text-xs border border-blue-200 px-2.5 py-1.5 rounded-lg transition">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Kiosco E/S
              </a>
            )}
            {perm("kiosco_areas", "ver") && (
              <a href="#/transferencias" onClick={() => { window.location.hash = "#/transferencias"; }}
                className="hidden sm:flex items-center gap-1.5 text-blue-200 hover:text-white text-xs border border-blue-200 px-2.5 py-1.5 rounded-lg transition">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
                Transferencias Áreas
              </a>
            )}
            {perm("equipo", "ver") && (
              <a href="#/equipo" onClick={() => { window.location.hash = "#/equipo"; }}
                className="hidden sm:flex items-center gap-1.5 text-blue-200 hover:text-white text-xs border border-blue-200 px-2.5 py-1.5 rounded-lg transition">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                Asignación Uniformes
              </a>
            )}

            <div className="hidden sm:block text-right">
              <p className="text-sm font-medium leading-none">{user?.nombre}</p>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>
                {badge.label}
              </span>
            </div>
            <button onClick={logout} title="Cerrar sesión"
              className="text-blue-200 hover:text-white text-sm transition p-1.5 rounded-lg hover:bg-blue-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Cuerpo con sidebar */}
      <div className="flex flex-1 overflow-hidden">

        {/* Fondo oscuro tras el sidebar cuando está abierto como overlay en móvil */}
        {sidebarOpen && (
          <div className="fixed inset-0 bg-black/40 z-30 md:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        <aside className={
          sidebarOpen
            ? "fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-gray-200 shadow-lg flex flex-col transition-transform duration-200 md:static md:z-auto md:w-52 md:shadow-sm"
            : "fixed inset-y-0 left-0 z-40 w-64 -translate-x-full bg-white border-r border-gray-200 shadow-lg flex flex-col transition-transform duration-200 md:static md:translate-x-0 md:z-auto md:w-14 md:shadow-sm md:overflow-hidden"
        }>
          <nav className="flex-1 py-3 overflow-y-auto">
            {nav.map(item => {
              const active = seccion === item.key;
              return (
                <button key={item.key} onClick={() => seleccionarSeccion(item.key)}
                  title={item.label}
                  className={`w-full flex items-center gap-3 px-3.5 py-3 text-sm font-medium transition-all ${
                    active ? "bg-blue-50 text-blue-700 border-r-2 border-blue-600" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  }`}>
                  <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {Icon[item.icon]}
                  </svg>
                  {sidebarOpen && <span className="truncate">{item.label}</span>}
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="flex-1 min-w-0 overflow-auto">
          <div className="px-4 py-4 sm:px-6 sm:py-5">
            {seccion !== "destajo" && <h2 className="text-xl font-bold text-gray-800 mb-5">{TITULOS[seccion]}</h2>}

            {seccion === "empleados" && perm("empleados", "ver") && (
              <EmpleadosSection
                canCrear={perm("empleados", "crear")}
                canEditar={perm("empleados", "editar")}
                canBaja={perm("empleados", "baja")}
              />
            )}
            {seccion === "kiosco"   && perm("movimientos",    "ver") && <MovimientosAdminPage />}
            {seccion === "transf"   && perm("transferencias", "ver") && <TransferenciasAdminPage />}
            {seccion === "planif"   && perm("planificacion",   "ver") && <PlanificacionPage />}
            {seccion === "destajo"  && perm("destajo",         "ver") && <DestajoPage />}
            {seccion === "etiquetado" && perm("etiquetado",    "ver") && <EtiquetadoPage />}
            {seccion === "imprimirEtiquetas" && perm("etiquetado", "imprimir") && <ImpresionEtiquetasPage />}
            {seccion === "areas"    && perm("areas",          "ver") && <AreasPage />}
            {seccion === "permisos" && perm("permisos",       "ver") && <PermisosPage />}
            {seccion === "tiposPermiso" && perm("tipos_permiso", "ver") && <TiposPermisoPage />}
            {seccion === "usuarios" && perm("usuarios",       "ver") && <UsuariosPage />}
            {seccion === "catalogos" && perm("catalogos",     "ver") && <CatalogosPage />}
          </div>
        </main>
      </div>
    </div>
  );
}

// ── App root ───────────────────────────────────────────────────────
export default function App() {
  const { user, loading } = useAuth();
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-blue-700">
      <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin" />
    </div>
  );

  // Pantallas de terminal de kiosco: requieren una sesión con permiso sobre ese módulo.
  // Sin sesión válida, cualquier hash de kiosco cae a LoginPage en vez de exponer la pantalla.
  const KIOSCO_ROUTES = {
    "#/kiosco":        { mod: "kiosco",        Page: KioscoPage },
    "#/transferencias": { mod: "kiosco_areas", Page: TransferenciasPage },
    "#/equipo":        { mod: "equipo",        Page: EquipoUniformesPage },
  };
  const kioscoRoute = KIOSCO_ROUTES[hash];
  if (kioscoRoute) {
    if (!user || !hasPerm(user, kioscoRoute.mod, "ver")) return <LoginPage />;
    const { Page } = kioscoRoute;
    return <Page />;
  }

  if (!user) return <LoginPage />;

  // Si solo tiene acceso a pantallas kiosco → redirigir directamente
  const hasDashboard = ["empleados","movimientos","transferencias","planificacion","areas","permisos","tipos_permiso","usuarios"]
    .some(m => hasPerm(user, m, "ver"));
  if (!hasDashboard) {
    if (hasPerm(user, "kiosco", "ver"))       return <KioscoPage />;
    if (hasPerm(user, "kiosco_areas", "ver")) return <TransferenciasPage />;
    if (hasPerm(user, "equipo", "ver"))       return <EquipoUniformesPage />;
  }

  return <Dashboard />;
}
