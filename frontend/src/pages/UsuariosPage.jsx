import { useState, useEffect } from "react";
import { authHeader, useAuth } from "../context/AuthContext.jsx";

const API = "/api/usuarios";

// ── Estructura de módulos y acciones ──────────────────────────────────
// Cada grupo (separador) organiza visualmente la matriz
const MODULOS = [
  // ── Gestión de personal
  { key: "empleados",      label: "Empleados",                      acciones: ["ver","crear","editar","baja"],     grupo: "Personal" },
  // ── Kioscos físicos (tablets dedicadas)
  { key: "kiosco",         label: "Kiosco · Entrada / Salida",      acciones: ["ver"],                             grupo: "Kioscos"  },
  { key: "kiosco_areas",   label: "Kiosco · Transferencia de Áreas", acciones: ["ver"],                            grupo: "Kioscos"  },
  { key: "equipo",         label: "Kiosco · Entrega de Uniformes",  acciones: ["ver"],                             grupo: "Kioscos"  },
  // ── Módulo de Entradas/Salidas (corrección admin)
  { key: "movimientos",    label: "Entradas / Salidas — Corrección", acciones: ["ver","editar","eliminar"],         grupo: "Admin"    },
  // ── Módulo de Transferencias (corrección + futuras páginas)
  { key: "transferencias", label: "Transferencias — Corrección",     acciones: ["ver","editar","eliminar"],         grupo: "Admin"    },
  // ── Planificación
  { key: "planificacion",  label: "Planificación por Área",         acciones: ["ver","editar"],                    grupo: "Config"   },
  // ── Destajo (producción)
  { key: "destajo",        label: "Destajo — Materia Prima y Pesaje", acciones: ["ver","crear","editar","eliminar"], grupo: "Operación" },
  { key: "etiquetado",     label: "Etiquetado — Orden de Trabajo",   acciones: ["ver","crear","editar","eliminar","imprimir"], grupo: "Operación" },
  { key: "bodega",         label: "Bodega — Pallets y Escaneo",      acciones: ["ver","escanear","editar","eliminar"], grupo: "Operación" },
  // ── Configuración
  { key: "areas",          label: "Áreas",                          acciones: ["ver","crear","editar","eliminar"], grupo: "Config"   },
  { key: "permisos",       label: "Permisos",                       acciones: ["ver","crear","editar","eliminar"], grupo: "Config"   },
  { key: "tipos_permiso",  label: "Tipos de Permiso",                acciones: ["ver","crear","editar","eliminar"], grupo: "Config"   },
  { key: "usuarios",       label: "Usuarios",                       acciones: ["ver","crear","editar","eliminar"], grupo: "Config"   },
  { key: "catalogos",      label: "Catálogos de Producción",        acciones: ["ver","crear","editar","eliminar"], grupo: "Config"   },
];

// Etiqueta de cada acción en la matriz de permisos — cualquier acción que un módulo
// declare en su lista `acciones` aparece aquí automáticamente como checkbox propio.
// (Antes la matriz tenía 4 columnas fijas Ver/Crear/Editar/Baja-Elim y una acción como
// "escanear" o "imprimir" que no encajaba en ninguna quedaba sin forma de marcarse desde
// aquí — solo el botón de preset completo la activaba.)
const ACCION_LABELS = {
  ver: "Ver", crear: "Crear", editar: "Editar", eliminar: "Eliminar",
  baja: "Dar de baja", escanear: "Escanear", imprimir: "Imprimir",
};

// Deriva la matriz de permisos de MODULOS en vez de enumerarla a mano por rol:
// así un módulo nuevo (como Bodega en su momento) aparece automáticamente con
// todo en true para "admin" y todo en false para el resto, sin tener que
// recordar tocar cada preset por separado.
function permisosPara(valor) {
  return MODULOS.reduce((acc, m) => {
    acc[m.key] = Object.fromEntries(m.acciones.map(a => [a, valor]));
    return acc;
  }, {});
}

const EMPTY_PERMISOS = permisosPara(false);

const KIOSCO_KEYS = ["kiosco", "kiosco_areas", "equipo"];

const PRESETS = {
  admin:        permisosPara(true),
  readonly:     { ...EMPTY_PERMISOS, empleados: { ...EMPTY_PERMISOS.empleados, ver: true } },
  kiosco:       { ...EMPTY_PERMISOS, kiosco: { ver: true } },
  kiosco_areas: { ...EMPTY_PERMISOS, kiosco_areas: { ver: true } },
  equipo:       { ...EMPTY_PERMISOS, equipo: { ver: true } },
};

function mergePermisos(stored) {
  return MODULOS.reduce((acc, m) => {
    acc[m.key] = { ...EMPTY_PERMISOS[m.key], ...(stored?.[m.key] || {}) };
    return acc;
  }, {});
}

function derivarRol(p) {
  if (JSON.stringify(mergePermisos(p)) === JSON.stringify(PRESETS.admin)) return "admin";
  const soloPantallas = MODULOS.every(m => KIOSCO_KEYS.includes(m.key) || !p?.[m.key]?.ver);
  if (soloPantallas && KIOSCO_KEYS.some(k => p?.[k]?.ver)) return "kiosco";
  return "readonly";
}

const EMPTY_FORM = {
  username: "", password: "", nombre: "",
  rol: "readonly", activo: true,
  permisos: mergePermisos(PRESETS.readonly),
};

// ── Modal ─────────────────────────────────────────────────────────────
function UsuarioModal({ usuario, onSave, onClose }) {
  const isEdit = !!usuario;
  const [form, setForm] = useState(() => {
    if (isEdit) {
      // Si no tiene permisos aún, usar el preset que corresponde a su rol actual
      const fallbackPreset = PRESETS[usuario.rol] ?? PRESETS.readonly;
      const p = usuario.permisos ?? fallbackPreset;
      return { nombre: usuario.nombre, rol: usuario.rol, activo: !!usuario.activo, password: "", permisos: mergePermisos(p) };
    }
    return { ...EMPTY_FORM, permisos: mergePermisos(PRESETS.readonly) };
  });
  const [error, setError] = useState("");

  const set = (f) => (e) =>
    setForm(v => ({ ...v, [f]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const applyPreset = (presetKey) => {
    setForm(v => ({ ...v, rol: presetKey, permisos: mergePermisos(PRESETS[presetKey]) }));
  };

  const togglePerm = (mod, accion) => {
    setForm(v => ({
      ...v,
      permisos: {
        ...v.permisos,
        [mod]: { ...v.permisos[mod], [accion]: !v.permisos[mod][accion] }
      }
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const rolFinal = derivarRol(form.permisos);
    try {
      await onSave({ ...form, rol: rolFinal });
    } catch (err) {
      setError(err.message);
    }
  };

  const hasPerm = (mod, accion) => !!form.permisos[mod]?.[accion];

  const presetActivo = (key) => JSON.stringify(form.permisos) === JSON.stringify(mergePermisos(PRESETS[key]));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white z-10">
          <h2 className="text-base font-semibold text-gray-800">
            {isEdit ? "Editar Usuario" : "Nuevo Usuario"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {/* Campos de datos */}
          <div className="grid grid-cols-1 gap-4">
            {!isEdit && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Nombre de usuario *</label>
                <input required value={form.username} onChange={set("username")}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="ej: jperez" />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Nombre completo *</label>
              <input required value={form.nombre} onChange={set("nombre")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                placeholder="Juan Pérez" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {isEdit ? "Nueva contraseña (vacío = no cambiar)" : "Contraseña *"}
              </label>
              <input type="password" required={!isEdit} value={form.password} onChange={set("password")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                placeholder={isEdit ? "••••••••" : "Mínimo 6 caracteres"}
                minLength={isEdit && !form.password ? 0 : 6} />
            </div>
          </div>

          {/* Permisos */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Pantallas y acciones</p>

            {/* Presets rápidos */}
            <div className="flex flex-wrap gap-2 mb-3">
              {[
                { key: "admin",       label: "Administrador"   },
                { key: "readonly",    label: "Solo lectura"    },
                { key: "kiosco",      label: "Kiosco E/S"      },
                { key: "kiosco_areas",label: "Kiosco Áreas"    },
                { key: "equipo",      label: "Kiosco Uniformes"},
              ].map(p => (
                <button key={p.key} type="button" onClick={() => applyPreset(p.key)}
                  className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition ${
                    presetActivo(p.key)
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-gray-50 text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-600"
                  }`}>
                  {p.label}
                </button>
              ))}
              <span className="ml-auto text-xs text-gray-400 self-center">o personaliza abajo</span>
            </div>

            {/* Matriz de permisos */}
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 uppercase tracking-wider">
                    <th className="px-3 py-2 text-left font-semibold">Módulo</th>
                    <th className="px-3 py-2 text-left font-semibold">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {MODULOS.reduce((acc, m, i) => {
                    const prevGrupo = i > 0 ? MODULOS[i - 1].grupo : null;
                    if (m.grupo !== prevGrupo) {
                      acc.push(
                        <tr key={`sep-${m.grupo}`}>
                          <td colSpan={2} className="px-3 py-1 bg-gray-50 text-gray-400 text-xs font-semibold uppercase tracking-wider border-t border-gray-200">
                            {m.grupo}
                          </td>
                        </tr>
                      );
                    }
                    acc.push(
                      <tr key={m.key} className="hover:bg-gray-50 border-t border-gray-100">
                        <td className="px-3 py-2.5 font-medium text-gray-700 text-xs align-top whitespace-nowrap">{m.label}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                            {m.acciones.map(accion => (
                              <label key={accion} className="flex items-center gap-1.5 text-gray-600 cursor-pointer">
                                <input type="checkbox" checked={hasPerm(m.key, accion)}
                                  onChange={() => togglePerm(m.key, accion)}
                                  className="w-4 h-4 accent-blue-600 cursor-pointer" />
                                {ACCION_LABELS[accion] ?? accion}
                              </label>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                    return acc;
                  }, [])}
                </tbody>
              </table>
            </div>
          </div>

          {isEdit && (
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={form.activo} onChange={set("activo")}
                className="w-4 h-4 accent-blue-600" />
              Usuario activo
            </label>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
              Cancelar
            </button>
            <button type="submit"
              className="px-5 py-2 text-sm bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition">
              {isEdit ? "Guardar cambios" : "Crear usuario"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Página principal ─────────────────────────────────────────────────
export default function UsuariosPage() {
  const { user, refreshUser } = useAuth();
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, usuario: null });
  const [confirmDelete, setConfirmDelete] = useState(null);

  const fetchUsuarios = async () => {
    setLoading(true);
    try {
      const res = await fetch(API, { headers: authHeader() });
      setUsuarios(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsuarios(); }, []);

  const handleSave = async (formData) => {
    const isEdit = !!modal.usuario;
    const url = isEdit ? `${API}/${modal.usuario.id}` : API;
    const method = isEdit ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(formData),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setModal({ open: false, usuario: null });
    // Si te editaste a ti mismo, la sesión activa sigue autorizando con el rol/permisos
    // viejos (van embebidos en el JWT) hasta reemitir el token.
    if (isEdit && modal.usuario.id === user?.id) await refreshUser();
    fetchUsuarios();
  };

  const handleDelete = async (id) => {
    const res = await fetch(`${API}/${id}`, { method: "DELETE", headers: authHeader() });
    const data = await res.json();
    if (!res.ok) { alert(data.error); return; }
    setConfirmDelete(null);
    fetchUsuarios();
  };

  const ROL_META = {
    admin:    { label: "Administrador", cls: "bg-yellow-100 text-yellow-800" },
    readonly: { label: "Solo lectura",  cls: "bg-blue-100 text-blue-700"    },
    rrhh:     { label: "RRHH",          cls: "bg-blue-100 text-blue-700"    },
    kiosco:   { label: "Kiosco",        cls: "bg-purple-100 text-purple-700" },
  };
  const rolMeta = (r) => ROL_META[r] ?? { label: r, cls: "bg-gray-100 text-gray-600" };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-gray-800">Usuarios del sistema</h2>
          <p className="text-sm text-gray-500">Gestión de acceso y permisos</p>
        </div>
        <button onClick={() => setModal({ open: true, usuario: null })}
          className="bg-blue-600 text-white font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm">
          + Nuevo usuario
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                <th className="px-5 py-3 text-left">Usuario</th>
                <th className="px-5 py-3 text-left">Nombre</th>
                <th className="px-5 py-3 text-left">Rol</th>
                <th className="px-5 py-3 text-left">Acceso a módulos</th>
                <th className="px-5 py-3 text-center">Estado</th>
                <th className="px-5 py-3 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {usuarios.map(u => {
                // Legacy admin (sin permisos) = acceso total
                const esLegacyAdmin = u.rol === "admin" && !u.permisos;
                const rolEfectivo = esLegacyAdmin ? "admin" : derivarRol(u.permisos);
                const meta = rolMeta(rolEfectivo);
                const modulosActivos = MODULOS.filter(m =>
                  esLegacyAdmin || u.permisos?.[m.key]?.ver
                ).map(m => m.label);
                return (
                  <tr key={u.id} className="hover:bg-gray-50 transition">
                    <td className="px-5 py-3 font-mono text-gray-700">{u.username}</td>
                    <td className="px-5 py-3 font-medium text-gray-900">{u.nombre}</td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${meta.cls}`}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1">
                        {modulosActivos.length === 0
                          ? <span className="text-gray-400 text-xs">Sin acceso</span>
                          : modulosActivos.map(m => (
                              <span key={m} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                                {m}
                              </span>
                            ))}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        u.activo ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                      }`}>
                        {u.activo ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <div className="flex justify-center gap-2">
                        <button onClick={() => setModal({ open: true, usuario: u })}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition">
                          Editar
                        </button>
                        <button onClick={() => setConfirmDelete(u)}
                          className="text-red-500 hover:text-red-700 text-xs font-medium px-2 py-1 rounded hover:bg-red-50 transition">
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal.open && (
        <UsuarioModal usuario={modal.usuario} onSave={handleSave}
          onClose={() => setModal({ open: false, usuario: null })} />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-2">Eliminar usuario</h2>
            <p className="text-sm text-gray-600 mb-6">
              ¿Eliminar a <span className="font-semibold">{confirmDelete.nombre}</span> ({confirmDelete.username})?
              Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
                Cancelar
              </button>
              <button onClick={() => handleDelete(confirmDelete.id)}
                className="px-4 py-2 text-sm bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition">
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
