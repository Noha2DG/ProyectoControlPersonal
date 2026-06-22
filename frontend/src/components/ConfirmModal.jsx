export default function ConfirmModal({ empleado, ultimaBaja, onConfirm, onClose }) {
  const noRecontratable = ultimaBaja && ultimaBaja.Recontratable === false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
        <h2 className="text-base font-semibold text-green-700 mb-3">Confirmar Recontratación</h2>

        <p className="text-sm text-gray-700 mb-3">
          ¿Reactivar a{" "}
          <span className="font-semibold text-gray-900">{empleado?.NombreCompleto}</span>?
        </p>

        {/* Info de la última baja */}
        {ultimaBaja && (
          <div className={`rounded-lg p-3 mb-4 text-xs space-y-1 border ${
            noRecontratable
              ? "bg-red-50 border-red-300 text-red-800"
              : "bg-gray-50 border-gray-200 text-gray-600"
          }`}>
            {noRecontratable && (
              <p className="font-bold text-red-700 mb-1">⚠ Este empleado fue marcado como NO recontratable</p>
            )}
            <p><span className="font-medium">Última baja:</span> {ultimaBaja.FechaBaja}</p>
            <p><span className="font-medium">Motivo:</span> {ultimaBaja.Motivo}</p>
            {ultimaBaja.Observaciones && (
              <p><span className="font-medium">Observaciones:</span> {ultimaBaja.Observaciones}</p>
            )}
            <p><span className="font-medium">Registrado por:</span> {ultimaBaja.RegistradoPor}</p>
          </div>
        )}

        {noRecontratable ? (
          <p className="text-xs text-red-600 font-medium mb-5">
            No se puede reactivar: el empleado quedó marcado como no recontratable.
          </p>
        ) : (
          <p className="text-xs text-gray-500 mb-5">
            Se registrará hoy como nueva fecha de ingreso y el estado volverá a{" "}
            <span className="text-green-600 font-medium">Activo</span>.
          </p>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={noRecontratable}
            title={noRecontratable ? "Empleado no recontratable" : undefined}
            className="px-4 py-2 text-sm bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition disabled:bg-gray-300 disabled:cursor-not-allowed disabled:hover:bg-gray-300"
          >
            Reactivar
          </button>
        </div>
      </div>
    </div>
  );
}
