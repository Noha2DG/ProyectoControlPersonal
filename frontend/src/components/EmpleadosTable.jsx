import { useColWidths, Th, Colgroup } from "./ResizableTh.jsx";

const COL_DEFAULTS = { codigo: 110, nombre: 220, ingreso: 110, sexo: 90, civil: 130, dpi: 150, etalent: 110, estado: 100, acciones: 130 };
const BASE_COLS = ["codigo", "nombre", "ingreso", "sexo", "civil", "dpi", "etalent", "estado"];

const fmt = (dateStr) => {
  if (!dateStr) return "-";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr));
  if (!m) return "-";
  const [, y, mo, d] = m;
  if (Number(y) < 1900) return "-";
  return `${d}/${mo}/${y}`;
};

export default function EmpleadosTable({ empleados, loading, isAdmin, onEdit, onBaja, onReactivar }) {
  const [widths, startResize] = useColWidths("empleados", COL_DEFAULTS);
  const COLS = isAdmin ? [...BASE_COLS, "acciones"] : BASE_COLS;

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (empleados.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="text-lg">No se encontraron empleados</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm table-fixed">
          <Colgroup columns={COLS} widths={widths} />
          <thead>
            <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
              <Th width={widths.codigo} onResizeStart={startResize("codigo")} className="px-4 py-3 text-left">Código</Th>
              <Th width={widths.nombre} onResizeStart={startResize("nombre")} className="px-4 py-3 text-left">Nombre Completo</Th>
              <Th width={widths.ingreso} onResizeStart={startResize("ingreso")} className="px-4 py-3 text-left">F. Ingreso</Th>
              <Th width={widths.sexo} onResizeStart={startResize("sexo")} className="px-4 py-3 text-left">Sexo</Th>
              <Th width={widths.civil} onResizeStart={startResize("civil")} className="px-4 py-3 text-left">Estado Civil</Th>
              <Th width={widths.dpi} onResizeStart={startResize("dpi")} className="px-4 py-3 text-left">DPI</Th>
              <Th width={widths.etalent} onResizeStart={startResize("etalent")} className="px-4 py-3 text-left">Etalent</Th>
              <Th width={widths.estado} onResizeStart={startResize("estado")} className="px-4 py-3 text-center">Estado</Th>
              {isAdmin && <Th width={widths.acciones} onResizeStart={startResize("acciones")} className="px-4 py-3 text-center">Acciones</Th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {empleados.map(emp => (
              <tr key={emp.Codigo} className="hover:bg-gray-50 transition">
                <td className="px-4 py-3 font-mono text-gray-700">{emp.Codigo}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{emp.NombreCompleto}</td>
                <td className="px-4 py-3 text-gray-600">{fmt(emp.FechaIngreso)}</td>
                <td className="px-4 py-3 text-gray-600">{emp.Sexo || "-"}</td>
                <td className="px-4 py-3 text-gray-600">{emp.EstadoCivil || "-"}</td>
                <td className="px-4 py-3 font-mono text-gray-600">{emp.DPI > 0 ? emp.DPI : "-"}</td>
                <td className="px-4 py-3 text-gray-600">{emp.CodigoEtalent || "-"}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                    emp.Estado === "Activo"
                      ? "bg-green-100 text-green-700"
                      : "bg-red-100 text-red-600"
                  }`}>
                    {emp.Estado}
                  </span>
                </td>
                {isAdmin && (
                  <td className="px-4 py-3 text-center">
                    {emp.Estado === "Activo" ? (
                      <div className="flex justify-center gap-2">
                        <button
                          onClick={() => onEdit(emp)}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => onBaja(emp)}
                          className="text-red-500 hover:text-red-700 text-xs font-medium px-2 py-1 rounded hover:bg-red-50 transition"
                        >
                          Baja
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => onReactivar(emp)}
                        className="text-green-600 hover:text-green-800 text-xs font-medium px-2 py-1 rounded hover:bg-green-50 transition"
                      >
                        Reactivar
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
