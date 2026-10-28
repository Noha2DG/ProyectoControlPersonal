import { useState, useEffect, useRef } from "react";

// Se ESCANEA, no se elige de una lista: el operador tiene el polín o la caja enfrente, y elegir de un
// listado es donde se cuela el error de agarrar el de al lado. Queda abierto entre escaneo y escaneo
// para poder correr varios seguidos, con el historial de la tanda a la vista.
// Vive aquí (nació en RemisionesPage) porque Pallets necesita el mismo modal para bajar cajas de un
// polín: mismo lector, mismo candado contra doble envío, mismo manejo de foco.
//
// `tono` es lo único que distingue cargar de quitar: los dos modales son idénticos en forma, así que
// sin color el operador no tiene cómo notar que está en el destructivo. `verbo` es el participio que
// se cuenta al pie ("3 agregados" / "3 quitados").
// `pideMotivo` (devolver un polín a bodega) exige escribir por qué ANTES de escanear, igual que la
// línea del contenedor; el motivo se queda puesto para toda la tanda y llega como tercer argumento.
const TONOS = {
  azul: { chip: "bg-blue-50 text-blue-600", input: "border-blue-300 focus:ring-blue-400", boton: "bg-blue-600 hover:bg-blue-700" },
  rojo: { chip: "bg-red-50 text-red-600", input: "border-red-300 focus:ring-red-400", boton: "bg-red-600 hover:bg-red-700" },
  // Ámbar = movimiento entre polines (traer cajas de otro, incluso sellado): ni ingreso normal
  // (azul) ni destructivo (rojo), pero sí algo que conviene que el operador note.
  ambar: { chip: "bg-amber-50 text-amber-600", input: "border-amber-300 focus:ring-amber-400", boton: "bg-amber-600 hover:bg-amber-700" },
};

export default function ModalEscaneo({
  titulo, descripcion, placeholder, Icono, pideLinea, onEscanear, onCerrar,
  tono = "azul", verbo = "agregado", pideMotivo = false,
}) {
  const [valor, setValor] = useState("");
  const [linea, setLinea] = useState("");
  const [motivo, setMotivo] = useState("");
  // El motivo va en un paso aparte, con "Continuar": si se escribiera en un campo al lado del lector,
  // la primera letra habilitaría el lector y le robaría el foco, y un escaneo con el foco en el
  // motivo dejaría el QR escrito como motivo.
  const [motivoFijo, setMotivoFijo] = useState(!pideMotivo);
  const [historial, setHistorial] = useState([]); // [{ ok, texto }]
  const inputRef = useRef(null);
  const lineaRef = useRef(null);
  const motivoRef = useRef(null);
  // Candado síncrono contra doble envío: un estado llegaría un render tarde y el lector es más
  // rápido que eso. El input NUNCA se deshabilita — deshabilitarlo le quita el foco en el navegador.
  const enviandoRef = useRef(false);
  const colores = TONOS[tono] ?? TONOS.azul;

  // La línea del contenedor se captura ANTES de escanear y se mantiene hasta cambiarla: se estiba
  // una línea completa y recién ahí se pasa a la siguiente.
  const lineaNum = Number(linea);
  const lineaLista = (!pideLinea || (Number.isInteger(lineaNum) && lineaNum > 0)) && motivoFijo;

  useEffect(() => {
    // Mientras falte el motivo o la línea, el foco va ahí; una vez puestos, al lector.
    if (!motivoFijo) motivoRef.current?.focus();
    else if (lineaLista) inputRef.current?.focus();
    else lineaRef.current?.focus();
  }, [historial, lineaLista, motivoFijo]);

  const fijarMotivo = (e) => {
    e.preventDefault();
    if (motivo.trim()) setMotivoFijo(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const v = valor.trim();
    if (!v || enviandoRef.current || !lineaLista) return;
    enviandoRef.current = true;
    setValor("");
    try {
      const texto = await onEscanear(v, lineaLista && pideLinea ? lineaNum : null, pideMotivo ? motivo.trim() : undefined);
      setHistorial(h => [{ ok: true, texto }, ...h]);
    } catch (err) {
      setHistorial(h => [{ ok: false, texto: `${v}: ${err.message}` }, ...h]);
    } finally {
      enviandoRef.current = false;
      inputRef.current?.focus();
    }
  };

  const aciertos = historial.filter(h => h.ok).length;

  return (
    <div className="fixed inset-0 bg-black/40 z-[55] flex items-center justify-center p-4" onClick={onCerrar}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-full flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <span className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 ${colores.chip}`}>
              {/* Opcional: sin esta guarda, un llamador que olvide el ícono revienta el render
                  entero con "Element type is invalid" y deja la pantalla en blanco. */}
              {Icono && <Icono className="w-6 h-6" />}
            </span>
            <div>
              <h3 className="text-lg font-bold text-gray-800">{titulo}</h3>
              <p className="text-xs text-gray-500">{descripcion}</p>
            </div>
          </div>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg p-2 text-xl leading-none transition shrink-0">&times;</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1">
          {pideMotivo && !motivoFijo && (
            <form onSubmit={fijarMotivo} className="mb-3">
              <label className="block text-xs font-medium text-gray-500 mb-1">Por qué regresa *</label>
              <div className="flex gap-2">
                <input ref={motivoRef} type="text" value={motivo} onChange={e => setMotivo(e.target.value)}
                  placeholder="No se lo llevaron, cambio de plan…" maxLength={150}
                  className="flex-1 min-w-0 border-2 border-amber-300 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-amber-400" />
                <button type="submit" disabled={!motivo.trim()}
                  className={`shrink-0 px-4 rounded-lg text-sm font-semibold text-white transition disabled:opacity-40 ${colores.boton}`}>
                  Continuar
                </button>
              </div>
            </form>
          )}
          {pideMotivo && motivoFijo && (
            <p className="mb-3 text-xs text-gray-600">
              Por qué regresa: <b>{motivo.trim()}</b>{" "}
              <button type="button" onClick={() => setMotivoFijo(false)} className="text-blue-600 hover:underline">cambiar</button>
            </p>
          )}
          {pideLinea && (
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-500 mb-1">Línea dentro del contenedor *</label>
              <input ref={lineaRef} type="number" min="1" step="1" value={linea} onChange={e => setLinea(e.target.value)}
                placeholder="Ej. 1"
                className="w-full border-2 border-amber-300 rounded-lg px-3 py-2.5 text-base font-mono focus:outline-none focus:ring-2 focus:ring-amber-400" />
              <p className="text-xs text-gray-400 mt-1">
                Todo lo que escanees se registra en esta línea. Cámbiala al pasar a la siguiente.
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {/* El lector solo se habilita con la línea puesta: escanear sin saber dónde se estibó es
                justamente el dato que después no se puede reconstruir. */}
            <input ref={inputRef} type="text" value={valor} onChange={e => setValor(e.target.value)} autoFocus
              placeholder={lineaLista ? placeholder : !motivoFijo ? "Primero escribe por qué regresa" : "Primero indica la línea del contenedor"}
              readOnly={!lineaLista}
              className={`w-full border-2 rounded-lg px-3 py-3 text-base font-mono focus:outline-none focus:ring-2 ${
                lineaLista
                  ? colores.input
                  : "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed focus:ring-gray-200"
              }`} />
          </form>
          {pideLinea && lineaLista && (
            <p className="text-xs text-amber-700 mt-1.5 font-medium">Escaneando hacia la línea {lineaNum}</p>
          )}

          {historial.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-gray-500 mb-2">
                {aciertos} {verbo}{aciertos === 1 ? "" : "s"} en esta tanda
              </p>
              <div className="space-y-1.5">
                {historial.map((h, i) => (
                  <div key={historial.length - i}
                    className={`text-sm px-3 py-2 rounded-lg border ${h.ok ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`}>
                    {h.texto}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex justify-end shrink-0">
          <button onClick={onCerrar} className={`px-4 py-2 rounded-lg text-sm font-semibold text-white transition ${colores.boton}`}>Listo</button>
        </div>
      </div>
    </div>
  );
}
