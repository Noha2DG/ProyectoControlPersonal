import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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

// ── Ordenamiento por encabezado ───────────────────────────────────────────────────────────────────

// Ciclo de tres estados al hacer clic: ascendente → descendente → sin orden. El tercer estado existe
// porque el orden natural (el que manda el backend) suele significar algo — el más reciente primero,
// el correlativo de captura — y sin él no habría forma de recuperarlo salvo recargando.
//
// A propósito NO se persiste, a diferencia del ancho de columna: volver días después y encontrar la
// tabla ordenada por un criterio que uno ya no recuerda haber elegido se lee como un error de datos.
export function useOrden(inicial = null) {
  const [orden, setOrden] = useState(inicial);
  const alternar = useCallback((key) => {
    setOrden(o => (o?.key !== key ? { key, dir: "asc" } : o.dir === "asc" ? { key, dir: "desc" } : null));
  }, []);
  return [orden, alternar];
}

// Los espacios de más se colapsan ANTES de comparar porque el HTML ya los colapsa al pintar: hay
// nombres capturados como "CARMEN  XIOMARA" (dos espacios) y, como en la colación el espacio va
// antes que cualquier letra, sin esto se ordenaban delante de "CARMEN ARACELI" — correcto según el
// dato, pero en pantalla se lee como un orden roto. El criterio es que ordene por lo que se ve.
const normalizar = t => String(t).replace(/\s+/g, " ").trim();

function comparar(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  // numeric:true para que ABC0002 quede antes que ABC0010 (comparando como texto, "10" < "2").
  // sensitivity:"base" para que los acentos no manden a Álvarez después de Zamora.
  return normalizar(a).localeCompare(normalizar(b), "es", { numeric: true, sensitivity: "base" });
}

// `valores` mapea la key de columna a una función que saca de la fila el valor con el que comparar.
// Es lo que separa ordenar de "ordenar por el texto pintado": Duración se muestra como "4h 36m" pero
// se ordena por Minutos, y una fecha se ordena por su ISO aunque en pantalla salga dd/mm/aaaa.
// Una columna sin entrada en `valores` simplemente no se ordena.
export function ordenarFilas(filas, orden, valores) {
  const valorDe = orden && valores[orden.key];
  if (!valorDe) return filas;
  const signo = orden.dir === "asc" ? 1 : -1;
  return [...filas].sort((a, b) => {
    const va = valorDe(a), vb = valorDe(b);
    const aVacio = va == null || va === "";
    const bVacio = vb == null || vb === "";
    // Los vacíos van al final en AMBOS sentidos (por eso quedan fuera del signo): una salida "En
    // curso" o un dato faltante no debería adueñarse del primer lugar solo por invertir el orden.
    if (aVacio || bVacio) return aVacio && bVacio ? 0 : aVacio ? 1 : -1;
    return signo * comparar(va, vb);
  });
}

function Flecha({ dir }) {
  if (!dir) {
    // Doble flecha SIEMPRE visible, aunque tenue: si solo apareciera al pasar el mouse no habría
    // forma de saber qué columnas ordenan sin ir probando una por una. Se refuerza al hover.
    return (
      <svg viewBox="0 0 14 18" aria-hidden className="w-3.5 h-4 shrink-0 text-gray-400 group-hover:text-gray-600 transition">
        <path d="M7 1L12 7.5H2L7 1Z" fill="currentColor" />
        <path d="M7 17L2 10.5H12L7 17Z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 14 18" aria-hidden className="w-3.5 h-4 shrink-0 text-blue-600">
      {dir === "asc"
        ? <path d="M7 3L13 12.5H1L7 3Z" fill="currentColor" />
        : <path d="M7 15L1 5.5H13L7 15Z" fill="currentColor" />}
    </svg>
  );
}

// ── Filtro por columna ────────────────────────────────────────────────────────────────────────────

// Embudo en el encabezado que abre una lista buscable de los valores presentes. `opciones` viene ya
// armada por la página: { valor, etiqueta, cuenta }.
//
// Se dibuja con portal a document.body y posición fija porque las tablas viven dentro de
// contenedores con overflow (scroll horizontal y alto máximo): un popover posicionado dentro del
// <th> quedaría recortado por ese contenedor justo al desplegarse.
export function FiltroColumna({ opciones, valor, onCambio, etiqueta = "Filtrar" }) {
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [pos, setPos] = useState(null);
  const botonRef = useRef(null);
  const panelRef = useRef(null);
  const activo = Boolean(valor);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e) => {
      if (panelRef.current?.contains(e.target) || botonRef.current?.contains(e.target)) return;
      setAbierto(false);
    };
    const tecla = (e) => { if (e.key === "Escape") setAbierto(false); };
    // El popover es fijo: si la página se desplaza mientras está abierto quedaría flotando lejos de
    // su columna, así que se cierra en vez de perseguir el encabezado.
    const cerrar = () => setAbierto(false);
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla);
    window.addEventListener("scroll", cerrar, true);
    window.addEventListener("resize", cerrar);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla);
      window.removeEventListener("scroll", cerrar, true);
      window.removeEventListener("resize", cerrar);
    };
  }, [abierto]);

  const alternar = () => {
    if (abierto) { setAbierto(false); return; }
    const r = botonRef.current.getBoundingClientRect();
    const ANCHO = 260;
    // Si la columna está muy a la derecha el panel se alinea por su borde derecho, para no salirse.
    const left = Math.max(8, Math.min(r.left, window.innerWidth - ANCHO - 8));
    setPos({ top: r.bottom + 4, left, ancho: ANCHO });
    setBusqueda("");
    setAbierto(true);
  };

  const q = busqueda.trim().toLowerCase();
  const visibles = q ? opciones.filter(o => o.etiqueta.toLowerCase().includes(q)) : opciones;

  const elegir = (v) => { onCambio(v); setAbierto(false); };

  return (
    <>
      <button
        ref={botonRef}
        type="button"
        onClick={alternar}
        title={activo ? `Filtrado por ${valor} — clic para cambiar` : etiqueta}
        className={`shrink-0 rounded p-0.5 transition ${activo ? "text-blue-600 bg-blue-100" : "text-gray-400 hover:text-gray-700 hover:bg-gray-200"}`}
      >
        <svg viewBox="0 0 16 16" aria-hidden className="w-3.5 h-3.5">
          <path d="M1.5 2.5h13l-5 6v5l-3 1.5v-6.5l-5-6Z" fill="currentColor" />
        </svg>
      </button>

      {abierto && pos && createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.ancho, zIndex: 60 }}
          className="bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden"
        >
          <div className="p-2 border-b border-gray-100">
            <input
              autoFocus
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar…"
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs normal-case font-normal tracking-normal focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1 text-xs normal-case font-normal tracking-normal">
            <li>
              <button type="button" onClick={() => elegir("")}
                className={`w-full text-left px-3 py-1.5 hover:bg-blue-50 ${!activo ? "font-semibold text-blue-700" : "text-gray-700"}`}>
                Todos <span className="text-gray-400">({opciones.length})</span>
              </button>
            </li>
            {visibles.map(o => (
              <li key={o.valor}>
                <button type="button" onClick={() => elegir(o.valor)}
                  className={`w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-blue-50 ${valor === o.valor ? "font-semibold text-blue-700" : "text-gray-700"}`}>
                  <span className="truncate flex-1" title={o.etiqueta}>{o.etiqueta}</span>
                  {o.cuenta != null && <span className="text-gray-400 shrink-0">{o.cuenta}</span>}
                </button>
              </li>
            ))}
            {visibles.length === 0 && (
              <li className="px-3 py-3 text-center text-gray-400">Sin coincidencias</li>
            )}
          </ul>
        </div>,
        document.body
      )}
    </>
  );
}

// <th> con handle de arrastre en el borde derecho para ajustar el ancho.
// Si recibe sortKey + orden + onOrdenar, el rótulo se vuelve un botón que ordena por esa columna.
// `filtro` es un slot opcional (normalmente un <FiltroColumna/>) que se dibuja pegado al rótulo.
export function Th({ children, width, onResizeStart, className = "", sortKey, orden, onOrdenar, title, filtro }) {
  const activo = Boolean(sortKey) && orden?.key === sortKey;
  const ordenable = Boolean(sortKey && onOrdenar);

  return (
    <th
      className={`relative ${className}`}
      style={width ? { width } : undefined}
      title={title}
      aria-sort={!ordenable ? undefined : activo ? (orden.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <span className="inline-flex items-center gap-1 align-middle max-w-full">
        {ordenable ? (
          // El botón envuelve solo el rótulo, no el <th> entero: así el handle de arrastre del borde
          // derecho queda fuera y redimensionar nunca dispara un ordenamiento por accidente.
          <button
            type="button"
            onClick={() => onOrdenar(sortKey)}
            title={activo ? (orden.dir === "asc" ? "Orden ascendente — clic para invertir" : "Orden descendente — clic para quitar el orden") : "Ordenar por esta columna"}
            className={`group inline-flex items-center gap-1.5 transition hover:text-gray-900 ${activo ? "text-blue-700 font-bold" : ""}`}
          >
            <span>{children}</span>
            <Flecha dir={activo ? orden.dir : null} />
          </button>
        ) : children}
        {filtro}
      </span>
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
