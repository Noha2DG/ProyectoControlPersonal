import { Component } from "react";

// Red de seguridad de toda la app. Sin esto, cualquier error dentro de un render deja la pantalla
// COMPLETAMENTE en blanco: React desmonta el árbol entero y no queda ni el menú ni un mensaje. En
// una tablet del andén eso es indistinguible de "el sistema se cayó", y nadie va a abrir la consola
// del navegador para averiguar qué pasó.
//
// Tiene que ser un componente de clase: los hooks no tienen equivalente de componentDidCatch.
export default class ErrorBoundary extends Component {
  state = { error: null, stack: null, copiado: false };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // El componentStack dice EN QUÉ PANTALLA reventó, que es lo primero que uno necesita saber. En
    // el build de producción los nombres van minificados, pero el mensaje del error sobrevive y
    // suele bastar para ubicarlo.
    this.setState({ stack: info?.componentStack ?? null });
    console.error("Error no controlado:", error, info);
  }

  copiar = () => {
    const texto = [
      `Error: ${this.state.error?.message ?? this.state.error}`,
      `URL: ${window.location.href}`,
      `Fecha: ${new Date().toLocaleString("es-GT")}`,
      this.state.error?.stack ?? "",
      this.state.stack ?? "",
    ].join("\n");
    navigator.clipboard?.writeText(texto)
      .then(() => this.setState({ copiado: true }))
      .catch(() => {});
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden">
          <div className="bg-red-600 px-6 py-4">
            <h1 className="text-white text-lg font-bold">La pantalla no se pudo mostrar</h1>
          </div>
          <div className="px-6 py-5 space-y-4">
            <p className="text-sm text-gray-600">
              Algo falló al dibujar esta pantalla. Lo que ya habías guardado no se perdió — el error
              es de visualización, no de datos. Recarga para volver a intentarlo.
            </p>

            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <p className="text-sm font-mono text-red-800 break-words">
                {this.state.error?.message ?? String(this.state.error)}
              </p>
            </div>

            {/* El detalle técnico va plegado: al operador no le sirve, pero es lo primero que se
                necesita para arreglarlo, así que tiene que estar a un clic y ser copiable. */}
            {(this.state.stack || this.state.error?.stack) && (
              <details className="text-xs">
                <summary className="cursor-pointer text-gray-500 hover:text-gray-700 select-none">
                  Ver detalle técnico
                </summary>
                <pre className="mt-2 bg-gray-900 text-gray-100 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
                  {this.state.error?.stack ?? ""}
                  {this.state.stack ?? ""}
                </pre>
              </details>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <button onClick={() => window.location.reload()}
                className="bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition">
                Recargar
              </button>
              {/* Volver al inicio y NO solo recargar: si la pantalla que reventó es la que está en
                  la URL, recargar vuelve a reventar y el usuario queda atrapado en el error. */}
              <button onClick={() => { window.location.hash = "#/"; window.location.reload(); }}
                className="text-sm text-gray-600 border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50 transition">
                Ir al inicio
              </button>
              <button onClick={this.copiar}
                className="text-sm text-gray-600 border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50 transition">
                {this.state.copiado ? "¡Copiado!" : "Copiar detalle"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
