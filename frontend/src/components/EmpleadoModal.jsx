import { useState, useEffect, useRef } from "react";
import { authHeader } from "../context/AuthContext.jsx";

const EMPTY = {
  Codigo: "",
  FechaIngreso: "",
  Sexo: "",
  EstadoCivil: "",
  CodigoEtalent: "",
  DPI: 0,
};

const EMPTY_DETALLE = {
  PrimerNombre: "", SegundoNombre: "", TercerNombre: "",
  PrimerApellido: "", SegundoApellido: "", ApellidoCasada: "",
  PaisNacimiento: "", FechaNacimiento: "", DepartamentoNacimiento: "", MunicipioNacimiento: "", Etnia: "",
  Nacionalidad: "", PaisDPI: "", DepartamentoDPI: "", MunicipioDPI: "", VencimientoDPI: "",
  NIT: "", SeguroSocial: "", Celular: "", Telefono: "", PermisoTrabajo: "",
  TituloPersonal: "", NumeroHijos: 0, NivelAcademico: "", TipoSangre: "", Beneficiario: "", Profesion: "",
};

const toInputDate = (val) => {
  if (!val) return "";
  const d = new Date(val);
  if (isNaN(d.getTime()) || d.getFullYear() < 1900) return "";
  return d.toISOString().split("T")[0];
};

export default function EmpleadoModal({ empleado, onSave, onClose }) {
  const isEdit = !!empleado;
  const [form, setForm] = useState(EMPTY);
  const [detalle, setDetalle] = useState(EMPTY_DETALLE);
  const [fotoKey, setFotoKey] = useState(Date.now());
  const [fotoError, setFotoError] = useState(false);
  const fileRef = useRef(null);
  const codigoTocado = useRef(false);

  useEffect(() => {
    if (empleado) {
      setForm({
        Codigo: empleado.Codigo || "",
        FechaIngreso: toInputDate(empleado.FechaIngreso),
        Sexo: empleado.Sexo || "",
        EstadoCivil: empleado.EstadoCivil || "",
        CodigoEtalent: empleado.CodigoEtalent || "",
        DPI: empleado.DPI || 0,
      });
      setDetalle({
        ...EMPTY_DETALLE,
        ...Object.fromEntries(Object.keys(EMPTY_DETALLE).map(k => [k, empleado[k] ?? EMPTY_DETALLE[k]])),
        FechaNacimiento: toInputDate(empleado.FechaNacimiento),
        VencimientoDPI: toInputDate(empleado.VencimientoDPI),
      });
    }
  }, [empleado]);

  // Sugiere el código (3 letras del apellido + correlativo) mientras se crea un empleado nuevo
  useEffect(() => {
    if (isEdit || codigoTocado.current) return;
    const apellido = detalle.PrimerApellido.trim();
    if (!apellido) return;
    const t = setTimeout(() => {
      fetch(`/api/empleados/siguiente-codigo?apellido=${encodeURIComponent(apellido)}`, { headers: authHeader() })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.codigo && !codigoTocado.current) setForm(f => ({ ...f, Codigo: d.codigo })); })
        .catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [detalle.PrimerApellido, isEdit]);

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));
  const setD = (field) => (e) => setDetalle(d => ({ ...d, [field]: e.target.value }));
  const setCodigoManual = (e) => { codigoTocado.current = true; setForm(f => ({ ...f, Codigo: e.target.value })); };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!detalle.PrimerNombre.trim() || !detalle.PrimerApellido.trim()) {
      alert("Primer Nombre y Primer Apellido son obligatorios.");
      return;
    }
    onSave({ ...form, ...detalle });
  };

  const handleFotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !empleado?.Codigo) return;
    const fd = new FormData();
    fd.append("foto", file);
    await fetch(`/api/fotos/${empleado.Codigo}`, {
      method: "POST",
      headers: authHeader(),
      body: fd,
    });
    setFotoKey(Date.now());
    setFotoError(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">
            {isEdit ? "Editar Empleado" : "Nuevo Empleado"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 grid grid-cols-2 gap-4 overflow-y-auto flex-1">

          {/* Foto — solo en edición */}
          {isEdit && (
            <div className="col-span-2 flex items-center gap-4">
              <div
                className="w-20 h-24 rounded-lg overflow-hidden bg-gray-100 border border-gray-200 flex items-center justify-center cursor-pointer flex-shrink-0"
                onClick={() => fileRef.current?.click()}
                title="Clic para cambiar foto"
              >
                {!fotoError ? (
                  <img
                    key={fotoKey}
                    src={`/uploads/fotos/${empleado.Codigo}.jpg?t=${fotoKey}`}
                    alt="Foto"
                    className="w-full h-full object-cover"
                    onError={() => setFotoError(true)}
                  />
                ) : (
                  <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Fotografía</p>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium border border-blue-200 px-3 py-1 rounded-lg hover:bg-blue-50 transition"
                >
                  {fotoError ? "Subir foto" : "Cambiar foto"}
                </button>
                <p className="text-xs text-gray-400 mt-1">JPG, PNG · máx. 5 MB</p>
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFotoChange} />
            </div>
          )}

          <div className="col-span-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">Código *</label>
            <input
              required
              disabled={isEdit}
              value={form.Codigo}
              onChange={setCodigoManual}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100"
              placeholder={isEdit ? "" : "Se genera al ingresar el Primer Apellido"}
            />
          </div>

          <div className="col-span-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">Código Etalent</label>
            <input
              value={form.CodigoEtalent}
              onChange={set("CodigoEtalent")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="Opcional"
            />
          </div>

          <div className="col-span-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">Fecha de Ingreso</label>
            <input
              type="date"
              value={form.FechaIngreso}
              onChange={set("FechaIngreso")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          <div className="col-span-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">Sexo</label>
            <select
              value={form.Sexo}
              onChange={set("Sexo")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="">Seleccionar...</option>
              <option value="Masculino">Masculino</option>
              <option value="Femenino">Femenino</option>
            </select>
          </div>

          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">No. DPI</label>
            <input
              type="number"
              min="0"
              max="9999999999999"
              value={form.DPI || ""}
              onChange={e => setForm(f => ({ ...f, DPI: e.target.value ? Number(e.target.value) : 0 }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="Número de DPI (13 dígitos)"
            />
          </div>

          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Estado Civil</label>
            <select
              value={form.EstadoCivil}
              onChange={set("EstadoCivil")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="">Seleccionar...</option>
              <option value="Soltero">Soltero</option>
              <option value="Casado">Casado</option>
              <option value="Divorciado">Divorciado</option>
              <option value="Viudo">Viudo</option>
              <option value="Union Libre">Unión Libre</option>
            </select>
          </div>

            <div className="col-span-2 -mb-1 mt-1 text-xs font-semibold text-gray-400 uppercase tracking-wider">Datos Personales</div>

            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Primer Nombre *</label>
              <input required value={detalle.PrimerNombre} onChange={setD("PrimerNombre")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Segundo Nombre</label>
              <input value={detalle.SegundoNombre} onChange={setD("SegundoNombre")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Tercer Nombre</label>
              <input value={detalle.TercerNombre} onChange={setD("TercerNombre")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Primer Apellido *</label>
              <input required value={detalle.PrimerApellido} onChange={setD("PrimerApellido")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Segundo Apellido</label>
              <input value={detalle.SegundoApellido} onChange={setD("SegundoApellido")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Apellido de Casada</label>
              <input value={detalle.ApellidoCasada} onChange={setD("ApellidoCasada")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">País de Nacimiento</label>
              <input value={detalle.PaisNacimiento} onChange={setD("PaisNacimiento")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Fecha de Nacimiento</label>
              <input type="date" value={detalle.FechaNacimiento} onChange={setD("FechaNacimiento")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Departamento</label>
              <input value={detalle.DepartamentoNacimiento} onChange={setD("DepartamentoNacimiento")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Municipio</label>
              <input value={detalle.MunicipioNacimiento} onChange={setD("MunicipioNacimiento")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Etnia</label>
              <input value={detalle.Etnia} onChange={setD("Etnia")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>

            <div className="col-span-2 -mb-1 mt-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Datos de Identificación</div>

            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Nacionalidad</label>
              <input value={detalle.Nacionalidad} onChange={setD("Nacionalidad")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">País de DPI</label>
              <input value={detalle.PaisDPI} onChange={setD("PaisDPI")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Departamento de DPI</label>
              <input value={detalle.DepartamentoDPI} onChange={setD("DepartamentoDPI")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Municipio de DPI</label>
              <input value={detalle.MunicipioDPI} onChange={setD("MunicipioDPI")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Vencimiento DPI</label>
              <input type="date" value={detalle.VencimientoDPI} onChange={setD("VencimientoDPI")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">NIT</label>
              <input value={detalle.NIT} onChange={setD("NIT")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Seguro Social</label>
              <input value={detalle.SeguroSocial} onChange={setD("SeguroSocial")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Celular</label>
              <input value={detalle.Celular} onChange={setD("Celular")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Teléfono</label>
              <input value={detalle.Telefono} onChange={setD("Telefono")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Permiso de Trabajo</label>
              <input value={detalle.PermisoTrabajo} onChange={setD("PermisoTrabajo")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>

            <div className="col-span-2 -mb-1 mt-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Otros Datos</div>

            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Título Personal</label>
              <select value={detalle.TituloPersonal} onChange={setD("TituloPersonal")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                <option value="">Seleccionar...</option>
                <option value="Señor">Señor</option>
                <option value="Señora">Señora</option>
                <option value="Señorita">Señorita</option>
                <option value="Licenciado/a">Licenciado/a</option>
                <option value="Ingeniero/a">Ingeniero/a</option>
                <option value="Doctor/a">Doctor/a</option>
              </select>
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Número de Hijos</label>
              <input type="number" min="0" value={detalle.NumeroHijos}
                onChange={e => setDetalle(d => ({ ...d, NumeroHijos: e.target.value ? Number(e.target.value) : 0 }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Nivel Académico</label>
              <select value={detalle.NivelAcademico} onChange={setD("NivelAcademico")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                <option value="">Seleccionar...</option>
                <option value="Sabe leer y/o escribir">Sabe leer y/o escribir</option>
                <option value="Primaria">Primaria</option>
                <option value="Básico">Básico</option>
                <option value="Diversificado">Diversificado</option>
                <option value="Universitario">Universitario</option>
              </select>
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Tipo de Sangre</label>
              <select value={detalle.TipoSangre} onChange={setD("TipoSangre")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                <option value="">Sin Especificar</option>
                <option value="A+">A+</option><option value="A-">A-</option>
                <option value="B+">B+</option><option value="B-">B-</option>
                <option value="AB+">AB+</option><option value="AB-">AB-</option>
                <option value="O+">O+</option><option value="O-">O-</option>
              </select>
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Profesión</label>
              <input value={detalle.Profesion} onChange={setD("Profesion")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">Beneficiario</label>
              <input value={detalle.Beneficiario} onChange={setD("Beneficiario")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>

          <div className="col-span-2 flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-sm bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition"
            >
              {isEdit ? "Guardar cambios" : "Crear Empleado"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
