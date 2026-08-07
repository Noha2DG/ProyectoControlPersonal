import { useState } from "react";

// Pide un motivo por escrito antes de una acción que queda registrada en el kardex (anular una
// remisión, desarmar un polín). AvisoModal solo resuelve sí/no; aquí el texto ES parte del registro,
// no un adorno — por eso es requerido y viaja al backend, que también lo exige.
export default function ModalMotivo({ titulo, descripcion, textoConfirmar, onConfirmar, onCerrar }) {
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setEnviando(true);
    try {
      await onConfirmar(motivo.trim());
    } catch (err) {
      setError(err.message);
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-[55] flex items-center justify-center p-4" onClick={onCerrar}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="text-lg font-bold text-gray-800">{titulo}</h3>
          {descripcion && <p className="text-sm text-gray-500 mt-1">{descripcion}</p>}
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Motivo *</label>
            <textarea required rows={3} value={motivo} onChange={e => setMotivo(e.target.value)} autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onCerrar} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition">Cancelar</button>
            <button type="submit" disabled={enviando} className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-50">
              {enviando ? "Aplicando..." : textoConfirmar}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
