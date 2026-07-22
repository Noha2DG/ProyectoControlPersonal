const ESTILOS = {
  error:       { icono: "✕", franja: "bg-red-500",   fondo: "bg-red-50",   texto: "text-red-800",   iconoFondo: "bg-red-100 text-red-600",   boton: "bg-red-600 hover:bg-red-700" },
  advertencia: { icono: "⚠", franja: "bg-amber-500", fondo: "bg-amber-50", texto: "text-amber-800", iconoFondo: "bg-amber-100 text-amber-600", boton: "bg-amber-600 hover:bg-amber-700" },
  exito:       { icono: "✓", franja: "bg-green-500", fondo: "bg-green-50", texto: "text-green-800", iconoFondo: "bg-green-100 text-green-600", boton: "bg-green-600 hover:bg-green-700" },
};

// Ver useAviso.js — reemplaza alert()/confirm() con esto. z-[60] a propósito: por encima de los
// demás modales de la app (z-50), igual que un alert() nativo siempre queda por encima de todo.
export default function AvisoModal({ tipo = "error", mensaje, confirmar, textoConfirmar, textoCancelar, onCerrar, onCancelar }) {
  const estilo = ESTILOS[tipo] || ESTILOS.error;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !confirmar) onCerrar(); }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className={`h-1.5 ${estilo.franja}`} />
        <div className={`px-6 py-5 ${estilo.fondo} flex gap-3 items-start`}>
          <span className={`w-8 h-8 rounded-full flex items-center justify-center text-base font-bold shrink-0 ${estilo.iconoFondo}`}>
            {estilo.icono}
          </span>
          <p className={`text-sm whitespace-pre-line leading-relaxed pt-1 ${estilo.texto}`}>{mensaje}</p>
        </div>
        <div className="px-6 py-4 flex justify-end gap-3">
          {confirmar && (
            <button onClick={onCancelar} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
              {textoCancelar || "Cancelar"}
            </button>
          )}
          <button onClick={onCerrar} autoFocus className={`px-5 py-2 text-sm text-white font-semibold rounded-lg transition ${estilo.boton}`}>
            {confirmar ? (textoConfirmar || "Confirmar") : "Aceptar"}
          </button>
        </div>
      </div>
    </div>
  );
}
