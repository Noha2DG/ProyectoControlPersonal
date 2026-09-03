import { useCallback, useRef, useState } from "react";

// Arrastrar un modal tomándolo por su encabezado. Devuelve el estilo que va en el panel y los
// manejadores que van en el asa (el encabezado).
//
// El desplazamiento se aplica como `transform: translate` SOBRE la posición que el modal ya tenía,
// en vez de pasarlo a top/left absolutos: así el centrado por flex del contenedor sigue siendo el
// punto de partida — el modal abre donde siempre y solo se corre si alguien lo arrastra. También
// sobrevive a que la ventana cambie de tamaño, porque el centro se recalcula solo.
//
// Usa captura de puntero en vez de escuchas en `window`: el navegador garantiza que los eventos
// sigan llegando al asa aunque el cursor se salga del modal o de la propia ventana —justo lo que
// pasa al arrastrar rápido— y no quedan escuchas sueltas si el modal se desmonta a medio arrastre.
export function useArrastrable() {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  // El punto donde se agarró, no el último punto visto: restar siempre contra el origen evita que
  // se acumule el error de redondeo de cada movimiento y que el modal "resbale" bajo el cursor.
  const origen = useRef(null);

  const onPointerDown = useCallback((e) => {
    // Solo el botón principal, y nunca desde un control: un encabezado puede llevar una X de cerrar
    // y arrastrar no debe robarle el clic.
    if (e.button !== 0 || e.target.closest?.("button, a, input, select, textarea")) return;
    origen.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [pos.x, pos.y]);

  const onPointerMove = useCallback((e) => {
    if (!origen.current) return;
    // Tope de media pantalla por eje: sin él se puede soltar el modal fuera de la vista y no queda
    // nada de dónde agarrarlo para traerlo de vuelta.
    const limitar = (v, tope) => Math.max(-tope, Math.min(tope, v));
    setPos({
      x: limitar(e.clientX - origen.current.x, window.innerWidth / 2),
      y: limitar(e.clientY - origen.current.y, window.innerHeight / 2),
    });
  }, []);

  const onPointerUp = useCallback((e) => {
    origen.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  return {
    estilo: { transform: `translate(${pos.x}px, ${pos.y}px)` },
    // El asa además necesita las clases `cursor-move select-none touch-none` — se dejan al llamador
    // para no pisar el className que el encabezado ya trae.
    asa: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}
