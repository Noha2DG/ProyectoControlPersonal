import { useState } from "react";

const MOTIVOS = [
  "Despido",
  "Renuncia",
  "Fin de contrato",
  "Mutuo acuerdo",
  "Abandono de trabajo",
  "Incapacidad",
  "Fallecimiento",
  "Otro",
];

function hoy() {
  return new Date().toISOString().split("T")[0];
}

export default function BajaModal({ empleado, onConfirm, onClose }) {
  const [form, setForm] = useState({
    FechaBaja: hoy(),
    Motivo: "",
    Recontratable: null,
    Observaciones: "",
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (form.Recontratable === null) return;
    onConfirm(form);
  };

  const recontratableInvalido = form.Recontratable === null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">

        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">Dar de Baja</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">

          {/* Info empleado */}
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <p className="text-sm font-semibold text-gray-900">{empleado?.NombreCompleto}</p>
            <p className="text-xs text-gray-500 font-mono mt-0.5">{empleado?.Codigo}</p>
          </div>

          {/* Fecha de baja */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Fecha de baja *</label>
            <input
              required
              type="date"
              value={form.FechaBaja}
              max={hoy()}
              onChange={e => setForm(f => ({ ...f, FechaBaja: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
            />
          </div>

          {/* Motivo */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Motivo de baja *</label>
            <select
              required
              value={form.Motivo}
              onChange={e => setForm(f => ({ ...f, Motivo: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
            >
              <option value="">Seleccionar motivo...</option>
              {MOTIVOS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          {/* Recontratable */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">
              ¿Es recontratable? *
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, Recontratable: true }))}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold border-2 transition ${
                  form.Recontratable === true
                    ? "bg-green-500 text-white border-green-500"
                    : "bg-white text-gray-600 border-gray-300 hover:border-green-400"
                }`}
              >
                Sí
              </button>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, Recontratable: false }))}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold border-2 transition ${
                  form.Recontratable === false
                    ? "bg-red-500 text-white border-red-500"
                    : "bg-white text-gray-600 border-gray-300 hover:border-red-400"
                }`}
              >
                No (conflictivo)
              </button>
            </div>
            {recontratableInvalido && form.Motivo && (
              <p className="text-xs text-red-500 mt-1">Seleccione si es recontratable</p>
            )}
          </div>

          {/* Observaciones */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Observaciones <span className="text-gray-400 font-normal">(opcional)</span>
            </label>
            <textarea
              value={form.Observaciones}
              onChange={e => setForm(f => ({ ...f, Observaciones: e.target.value }))}
              placeholder="Detalles adicionales..."
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!form.Motivo || recontratableInvalido}
              className="px-5 py-2 text-sm bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition disabled:opacity-40"
            >
              Confirmar Baja
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
