// Piezas de pantalla que comparten las vistas de Importaciones (ImportacionesPage y sus componentes).

export const input = "border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-50 disabled:text-gray-500";
export const btn = "px-4 py-2 text-sm font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed";
export const btnPri = `${btn} bg-blue-600 text-white hover:bg-blue-700`;
export const btnSec = `${btn} bg-white text-gray-700 border border-gray-300 hover:bg-gray-50`;
export const btnPeligro = `${btn} bg-white text-red-700 border border-red-300 hover:bg-red-50`;
export const caja = "bg-white rounded-xl border border-gray-200";

export function Chip({ c }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold border whitespace-nowrap ${c.cls}`}>{c.txt}</span>;
}

export function Campo({ etiqueta, pista, children, className = "" }) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${className}`}>
      <span className="font-medium text-gray-700">{etiqueta}</span>
      {children}
      {pista && <span className="text-xs text-gray-500">{pista}</span>}
    </label>
  );
}

export function Modal({ titulo, subtitulo, children, pie, onCerrar, ancho = "max-w-lg" }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center p-3 overflow-y-auto"
      onMouseDown={e => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div role="dialog" aria-modal="true" className={`bg-white rounded-xl shadow-xl w-full ${ancho} flex flex-col max-h-[calc(100vh-1.5rem)]`}>
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-200">
          <div>
            <h3 className="text-base font-bold text-gray-800">{titulo}</h3>
            {subtitulo && <p className="text-xs text-gray-500 mt-0.5">{subtitulo}</p>}
          </div>
          <button onClick={onCerrar} aria-label="Cerrar" className="text-gray-400 hover:text-gray-700 text-xl leading-none px-1">×</button>
        </header>
        <div className="px-5 py-4 overflow-y-auto space-y-3">{children}</div>
        {pie && <footer className="px-5 py-3 border-t border-gray-200 flex flex-wrap justify-end gap-2">{pie}</footer>}
      </div>
    </div>
  );
}

export function Aviso({ tipo = "error", children }) {
  const cls = tipo === "error" ? "bg-red-50 border-red-300 text-red-800"
    : tipo === "ok" ? "bg-emerald-50 border-emerald-300 text-emerald-800"
    : "bg-amber-50 border-amber-300 text-amber-900";
  return <div role={tipo === "error" ? "alert" : "status"} className={`border rounded-lg px-3 py-2 text-sm ${cls}`}>{children}</div>;
}
