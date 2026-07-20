import { useCallback, useRef, useState } from "react";

const MIN_WIDTH = 40;

// Ancho de columnas ajustable por el usuario, persistido por navegador.
// storageKey debe ser único por tabla (ej. "permisos", "usuarios").
// defaults = { columnKey: anchoPx }
export function useColWidths(storageKey, defaults) {
  const [widths, setWidths] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`colw:${storageKey}`) || "{}");
      return { ...defaults, ...saved };
    } catch {
      return { ...defaults };
    }
  });

  const dragRef = useRef(null);

  const startResize = useCallback((key) => (e) => {
    e.preventDefault();
    dragRef.current = { key, startX: e.clientX, startWidth: widths[key] ?? defaults[key] ?? 120 };

    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const next = Math.max(MIN_WIDTH, d.startWidth + (ev.clientX - d.startX));
      setWidths(w => ({ ...w, [d.key]: next }));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setWidths(w => {
        localStorage.setItem(`colw:${storageKey}`, JSON.stringify(w));
        return w;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [widths, defaults, storageKey]);

  return [widths, startResize];
}

// <th> con handle de arrastre en el borde derecho para ajustar el ancho.
export function Th({ children, width, onResizeStart, className = "" }) {
  return (
    <th className={`relative ${className}`} style={width ? { width } : undefined}>
      {children}
      {onResizeStart && (
        <span
          onMouseDown={onResizeStart}
          className="absolute top-0 right-0 z-10 h-full w-1.5 cursor-col-resize select-none hover:bg-blue-400/60 active:bg-blue-500/80"
        />
      )}
    </th>
  );
}

// <colgroup> a partir de una lista ordenada de column keys y el estado de anchos.
export function Colgroup({ columns, widths }) {
  return (
    <colgroup>
      {columns.map(key => (
        <col key={key} style={widths[key] ? { width: widths[key] } : undefined} />
      ))}
    </colgroup>
  );
}
