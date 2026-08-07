import { useState, useEffect, useMemo } from "react";
import { useAuth, authHeader } from "../context/AuthContext.jsx";
import { calcularLbsPorPersona, calcularRankingPorArea } from "../utils/destajo.js";

const DIAS = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

// Pantalla 100% pasiva (nadie escanea nada, es solo para mirar) — project_ranking_produccion_pantalla_design.
// Separada por área (primero Pelado y Devenado, luego Descabezado) con una diapositiva de transición
// entre una y otra — cada área es su propio ranking, no una columna dentro de uno combinado.
const POR_DIAPOSITIVA = 10;
const MS_DIAPOSITIVA = 9_000;
const MS_TRANSICION = 4_000;

// El ranking se mueve durante el turno: refrescar los datos del backend es independiente del avance
// de diapositivas (esto no reinicia el ciclo de paginación, solo actualiza los números y posiciones).
const MS_REFRESCO = 45_000;

// Mismas áreas y nombres que AREAS_DESTAJO (destajo.js), con un color propio cada una (esmeralda
// Pelado, azul Descabezado, violeta Pinchado) para que la pantalla de pared se lea igual que el
// resto del sistema. El orden de acá es el orden de las diapositivas, no el de AREAS_DESTAJO.
const SECCIONES_CONFIG = [
  { key: "pelado", campo: "LbPelado", nombre: "PELADO Y DEVENADO", texto: "text-emerald-700",
    fondo: "fondo-olas-emerald", olas: ["rgba(255,255,255,0.14)", "rgba(255,255,255,0.24)", "#d1fae5"] },
  { key: "descabezado", campo: "LbDescabezado", nombre: "DESCABEZADO", texto: "text-blue-700",
    fondo: "fondo-olas-blue", olas: ["rgba(255,255,255,0.14)", "rgba(255,255,255,0.24)", "#dbeafe"] },
  { key: "pinchado", campo: "LbPinchado", nombre: "PELADO Y PINCHADO", texto: "text-violet-700",
    fondo: "fondo-olas-violet", olas: ["rgba(255,255,255,0.14)", "rgba(255,255,255,0.24)", "#ede9fe"] },
];

// Un solo período (1200 de 2400 de ancho del viewBox) para que el bucle de translateX(-50%) en
// @keyframes deslizarOlas (ver index.css) caiga exacto en el borde del período y no se note.
const OLA_PATH = "M0,100 C300,60 900,140 1200,100 C1500,60 2100,140 2400,100 L2400,200 L0,200 Z";

function reloj() {
  return new Date().toLocaleTimeString("es-GT", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
function fechaLarga() {
  const d = new Date();
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

// Medallero para los 3 primeros puestos (dentro de SU área — el Puesto ya viene calculado sobre el
// ranking de esa área, no sobre la planta completa). Del puesto 4 en adelante el círculo usa el
// color del semáforo.
const MEDALLA = {
  1: { anillo: "border-amber-500 bg-amber-50", texto: "text-amber-700", tarjeta: "bg-amber-50 border-amber-400" },
  2: { anillo: "border-slate-400 bg-slate-50", texto: "text-slate-600", tarjeta: "bg-white border-slate-300" },
  3: { anillo: "border-orange-500 bg-orange-50", texto: "text-orange-700", tarjeta: "bg-white border-orange-300" },
};
const SEMAFORO = {
  verde:    { anillo: "border-emerald-600 bg-emerald-50", texto: "text-emerald-700", tarjeta: "bg-white border-emerald-200" },
  amarillo: { anillo: "border-amber-500 bg-amber-50",     texto: "text-amber-700",   tarjeta: "bg-white border-amber-200" },
  rojo:     { anillo: "border-red-500 bg-red-50",         texto: "text-red-700",     tarjeta: "bg-white border-red-200" },
};

// Ráfaga de confeti del puesto 1: 20 piezas repartidas en círculo (ángulos parejos, no al azar) para
// que sea igual de vistosa en cada montaje sin recalcularse — Math.random() en cada render movería
// las piezas en cada refresco de datos aunque la animación ya hubiera terminado hace rato. El radio
// alterna entre dos valores grandes (110/170, pensados para leerse de lejos en una pantalla de
// pared) para que no quede un anillo perfecto, que se ve artificial. El giro pasa de 360°, no solo
// hasta 360°, para que cada pieza dé al menos una vuelta completa visible en vez de un giro parcial
// que a la distancia se confunde con que no gira.
const CONFETI_COLORES = ["#a855f7", "#38bdf8", "#22d3ee", "#818cf8", "#f472b6"];
const CONFETI = Array.from({ length: 20 }, (_, i) => {
  const angulo = (i / 20) * Math.PI * 2;
  const radio = i % 2 === 0 ? 110 : 170;
  return {
    color: CONFETI_COLORES[i % CONFETI_COLORES.length],
    tx: Math.cos(angulo) * radio,
    ty: Math.sin(angulo) * radio,
    rot: 360 + ((i * 53) % 360),
    delay: (i % 5) * 45,
  };
});

// "infinite" (no "forwards"): el confeti se sigue disparando en ráfagas mientras el puesto 1 siga en
// pantalla, no solo una vez al aparecer — al terminar cada ciclo la pieza vuelve de golpe a su punto
// de partida (opacity 1, sin trasladar) y vuelve a explotar, así que se lee como una fuente continua
// de confeti hasta que RankingProduccionPage cambia de página/sección y desmonta esta fila (por su
// key). El desfase de animationDelay de cada pieza se conserva ciclo a ciclo porque todas comparten
// la misma duración — solo se aplica una vez, al primer arranque.
function Confeti() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-10">
      {CONFETI.map((c, i) => (
        <span
          key={i}
          className="absolute w-[14px] h-[22px] rounded-[2px] animate-[confetiExplota_1.4s_ease-out_infinite]"
          style={{ backgroundColor: c.color, "--tx": `${c.tx}px`, "--ty": `${c.ty}px`, "--rot": `${c.rot}deg`, animationDelay: `${c.delay}ms` }}
        />
      ))}
    </div>
  );
}

// El puesto 1 es el único que se anima — si todas las filas parpadearan la animación dejaría de
// significar algo. Además del borde que respira y el halo del círculo (mismo espíritu que Identidad
// en MiProduccionPage.jsx), el confeti sale del círculo del puesto. Sin overflow-hidden en la fila:
// el confeti y el halo necesitan poder salirse de la tarjeta hacia las filas vecinas. motion-safe
// respeta a quien desactivó animaciones.
function FilaPersona({ fila, valor, colorTexto }) {
  const estilo = MEDALLA[fila.Puesto] ?? SEMAFORO[fila.Semaforo];
  const primero = fila.Puesto === 1;
  return (
    <div className={`relative flex-1 min-h-0 flex items-center gap-4 px-5 rounded-xl border-2 ${estilo.tarjeta} ${
      primero ? "shadow-[0_0_0_4px_rgba(245,158,11,0.25),0_0_24px_6px_rgba(217,119,6,0.35)]" : ""
    }`}>
      {primero && (
        <span className="pointer-events-none absolute inset-0 rounded-xl border-4 border-amber-400/70 motion-safe:animate-pulse" />
      )}
      <div className="relative shrink-0 w-[clamp(2.25rem,6.5vh,3.75rem)] h-[clamp(2.25rem,6.5vh,3.75rem)]">
        {primero && (
          <>
            <span className="absolute inset-0 rounded-full bg-amber-500/40 motion-safe:animate-ping" />
            <Confeti />
          </>
        )}
        <div className={`relative w-full h-full rounded-full border-4 flex items-center justify-center ${estilo.anillo}`}>
          <span className={`text-[clamp(1rem,3vh,1.75rem)] font-extrabold tabular-nums leading-none ${estilo.texto}`}>
            {fila.Puesto}
          </span>
        </div>
      </div>
      <p className="flex-1 min-w-0 text-[clamp(1.1rem,3.6vh,2.1rem)] font-extrabold text-slate-900 uppercase truncate">
        {fila.Nombre}
      </p>
      <p className={`shrink-0 text-[clamp(1.25rem,4vh,2.4rem)] font-mono font-extrabold tabular-nums leading-none ${colorTexto}`}>
        {valor.toFixed(1)}
        <span className="text-[0.4em] text-slate-500 ml-2">LB</span>
      </p>
    </div>
  );
}

// Una capa de olas: el mismo path a distinta altura/opacidad/velocidad da la sensación de
// profundidad (la más alta y transparente atrás, la más baja y sólida adelante, como una orilla).
function CapaOlas({ color, alturaClase, duracion, reversa }) {
  return (
    <svg
      className={`absolute bottom-0 left-0 w-[200%] ${alturaClase}`}
      style={{ animation: `deslizarOlas ${duracion}s linear infinite${reversa ? " reverse" : ""}` }}
      viewBox="0 0 2400 200"
      preserveAspectRatio="none"
    >
      <path d={OLA_PATH} fill={color} />
    </svg>
  );
}

// Diapositiva de corte entre una área y la siguiente — anuncia el cambio antes de que aparezcan
// los nombres, para que quien esté leyendo de lejos no confunda un puesto 1 de Pelado con uno de
// Descabezado al vuelo. El degradado con olas en movimiento (ver .fondo-olas-* en index.css) ya
// adelanta de qué área se trata por su color, antes de leer el texto; la tarjeta clara flotando
// encima es lo que mantiene el texto legible sobre un fondo que no deja de moverse.
function Transicion({ seccion }) {
  return (
    <div className={`relative flex-1 min-h-0 rounded-2xl overflow-hidden animate-[fadeIn_0.4s_ease] ${seccion.fondo}`}>
      <CapaOlas color={seccion.olas[0]} alturaClase="h-[58%]" duracion={16} />
      <CapaOlas color={seccion.olas[1]} alturaClase="h-[42%]" duracion={11} reversa />
      <CapaOlas color={seccion.olas[2]} alturaClase="h-[26%]" duracion={7} />

      <div className="absolute inset-0 flex items-center justify-center p-6">
        <div className="bg-white/90 rounded-2xl shadow-2xl px-12 py-10 flex flex-col items-center gap-3 max-w-[85%]">
          <svg className={`w-[clamp(2.5rem,8vh,4.5rem)] h-[clamp(2.5rem,8vh,4.5rem)] ${seccion.texto}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
          <p className="text-[clamp(0.9rem,2vh,1.1rem)] font-semibold uppercase tracking-widest text-slate-400">Cambiando a</p>
          <p className={`text-[clamp(2rem,7vh,4rem)] font-extrabold uppercase tracking-wide text-center ${seccion.texto}`}>{seccion.nombre}</p>
        </div>
      </div>
    </div>
  );
}

function EstadoCentral({ children }) {
  return <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center gap-3">{children}</div>;
}

export default function RankingProduccionPage() {
  const { logout } = useAuth();
  const [hora, setHora] = useState(reloj());
  const [fecha, setFecha] = useState(fechaLarga());
  const [personas, setPersonas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [actualizado, setActualizado] = useState(null);
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => { setHora(reloj()); setFecha(fechaLarga()); }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelado = false;
    const cargar = async () => {
      try {
        const res = await fetch("/api/reportes/ranking-produccion", { headers: authHeader() });
        const data = await res.json();
        if (cancelado) return;
        if (!res.ok) { setError(data.error || "No se pudo cargar el ranking"); return; }
        setPersonas(calcularLbsPorPersona(data.ranking));
        setError("");
        setActualizado(new Date());
      } catch {
        if (!cancelado) setError("Sin conexión con el servidor");
      } finally {
        if (!cancelado) setCargando(false);
      }
    };
    cargar();
    const id = setInterval(cargar, MS_REFRESCO);
    return () => { cancelado = true; clearInterval(id); };
  }, []);

  // Una sección por área (solo las que tienen a alguien produciendo hoy), cada una paginada en
  // bloques de POR_DIAPOSITIVA. Si un área está vacía, ni ella ni su transición aparecen en la
  // secuencia — no tiene sentido "cambiar a Descabezado" para mostrar una pantalla sin nadie.
  const secciones = useMemo(() => {
    return SECCIONES_CONFIG
      .map(cfg => {
        const datos = calcularRankingPorArea(personas, cfg.campo);
        const paginas = [];
        for (let i = 0; i < datos.length; i += POR_DIAPOSITIVA) paginas.push(datos.slice(i, i + POR_DIAPOSITIVA));
        return { ...cfg, paginas, total: datos.length };
      })
      .filter(s => s.paginas.length > 0);
  }, [personas]);

  // Secuencia plana: todas las diapositivas de una sección, luego (si hay más de una sección) una
  // transición hacia la siguiente. Con una sola sección activa no hay transición — sería "cambiar"
  // hacia la misma área.
  const frames = useMemo(() => {
    const out = [];
    secciones.forEach((s, si) => {
      s.paginas.forEach((filas, pi) => out.push({ tipo: "pagina", seccion: s, filas, pagina: pi }));
      if (secciones.length > 1) out.push({ tipo: "transicion", seccion: secciones[(si + 1) % secciones.length] });
    });
    return out;
  }, [secciones]);

  // Temporizador único que se reprograma solo: cada tipo de diapositiva dura distinto (transición
  // más corta que una página de nombres), así que un setInterval de duración fija no sirve. Depende
  // de frames.length y no de frames en sí para no reiniciar la cuenta regresiva cada vez que el
  // refresco de datos (cada 45s) genera un array de frames nuevo con el mismo tamaño.
  useEffect(() => {
    if (frames.length <= 1) return;
    const actual = frames[frameIndex % frames.length];
    const duracion = actual?.tipo === "transicion" ? MS_TRANSICION : MS_DIAPOSITIVA;
    const id = setTimeout(() => setFrameIndex(i => (i + 1) % frames.length), duracion);
    return () => clearTimeout(id);
  }, [frameIndex, frames.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const frameActual = frames.length ? frames[frameIndex % frames.length] : null;
  const tituloArea = frameActual?.tipo === "pagina" ? ` — ${frameActual.seccion.nombre}` : "";

  return (
    <div className="h-screen overflow-hidden bg-white flex flex-col select-none">
      <button
        onClick={() => { logout(); window.location.hash = ""; }}
        title="Cerrar sesión"
        className="fixed top-1 right-1 z-50 p-2 rounded-full text-blue-200 hover:text-white hover:bg-white/20 transition"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
      </button>

      {/* Título centrado sobre el ancho completo de la barra (absolute + -translate-x-1/2), no sobre
          el espacio que le deja el bloque de fecha/hora — así no se desplaza hacia la izquierda
          cuando el sufijo de área (" — DESCABEZADO") lo alarga. */}
      <div className="relative bg-blue-800 text-white flex items-baseline justify-end px-5 py-2 shrink-0">
        <h1 className="absolute left-1/2 -translate-x-1/2 max-w-[55vw] truncate text-center text-[clamp(1rem,2.4vh,1.4rem)] font-bold tracking-widest uppercase">
          Ranking de Producción{tituloArea}
        </h1>
        <div className="flex items-baseline gap-5 pr-8">
          <span className="text-[clamp(0.75rem,1.5vh,0.9rem)] text-blue-200">{fecha}</span>
          <span className="text-[clamp(1.25rem,3.4vh,2rem)] font-mono tabular-nums">{hora}</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col px-4 py-3 gap-3">
        {cargando ? (
          <EstadoCentral>
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </EstadoCentral>
        ) : error ? (
          <EstadoCentral>
            <p className="text-[clamp(1.25rem,3.6vh,2.4rem)] font-bold text-red-700">{error}</p>
            <p className="text-[clamp(0.875rem,2.2vh,1.35rem)] text-slate-600">Reintentando automáticamente…</p>
          </EstadoCentral>
        ) : !frameActual ? (
          <EstadoCentral>
            <svg className="w-[clamp(2.5rem,9vh,5rem)] h-[clamp(2.5rem,9vh,5rem)] text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 3v18M5 7h14M7 7l-3 7a3 3 0 006 0L7 7zm10 0l-3 7a3 3 0 006 0l-3-7z" />
            </svg>
            <p className="text-[clamp(1.25rem,3.6vh,2.4rem)] font-bold text-slate-900 mt-1">Esperando el inicio de turno</p>
            <p className="text-[clamp(0.875rem,2.2vh,1.35rem)] text-slate-600">El ranking aparecerá aquí en cuanto se registre la primera pesada</p>
            {/* Reloj grande e inconfundible: sin él, una pantalla en blanco con solo un ícono se ve
                como si se hubiera trabado — esto deja claro que sigue viva y actualizándose sola. */}
            <p className="font-mono font-extrabold text-slate-300 tabular-nums leading-none text-[clamp(2.5rem,11vh,5.5rem)] mt-[2vh]">
              {hora.slice(0, 5)}
            </p>
          </EstadoCentral>
        ) : frameActual.tipo === "transicion" ? (
          <Transicion seccion={frameActual.seccion} />
        ) : (
          <>
            <div key={`${frameActual.seccion.key}-${frameActual.pagina}`} className="flex-1 min-h-0 flex flex-col gap-2 animate-[fadeIn_0.5s_ease]">
              {frameActual.filas.map(fila => (
                <FilaPersona key={fila.IdEmpleado} fila={fila} valor={fila[frameActual.seccion.campo]} colorTexto={frameActual.seccion.texto} />
              ))}
            </div>

            <div className="flex items-center justify-between shrink-0 pt-1">
              <span className="text-[clamp(0.75rem,1.5vh,0.9rem)] text-slate-400">
                {actualizado && `Actualizado ${actualizado.toLocaleTimeString("es-GT", { hour12: false })}`}
              </span>
              {frameActual.seccion.paginas.length > 1 && (
                <div className="flex items-center gap-2">
                  {frameActual.seccion.paginas.map((_, i) => (
                    <span key={i} className={`w-2.5 h-2.5 rounded-full ${i === frameActual.pagina ? "bg-blue-700" : "bg-slate-300"}`} />
                  ))}
                </div>
              )}
              <span className="text-[clamp(0.75rem,1.5vh,0.9rem)] text-slate-400">
                {frameActual.seccion.total} persona{frameActual.seccion.total !== 1 ? "s" : ""} en {frameActual.seccion.nombre.toLowerCase()}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
