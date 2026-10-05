import { useState, useEffect, useMemo } from "react";
import { useAuth, authHeader } from "../context/AuthContext.jsx";
import { calcularLbsPorPersona, calcularRankingPorArea, esAprendiz, DIAS_APRENDIZAJE } from "../utils/destajo.js";

const DIAS = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

// Pantalla 100% pasiva (nadie escanea nada, es solo para mirar) — project_ranking_produccion_pantalla_design.
// Separada por área (primero Pelado y Devenado, luego Descabezado) con una diapositiva de transición
// entre una y otra — cada área es su propio ranking, no una columna dentro de uno combinado.
// Todas las personas de cada área, de 10 en 10 por diapositiva. Dentro de cada área, los recién
// ingresados (esAprendiz, destajo.js) van en un ranking aparte "Aprendizaje" después del general:
// su propio puesto 1 y su propio semáforo, sin competir contra el personal con experiencia.
// Paginar es solo de pantalla: el backend ya devuelve a todos en una sola consulta.
const POR_PAGINA = 10;
const MS_DIAPOSITIVA = 10_000;
// 4 s no alcanzaban para leer "Cambiando a …" desde lejos antes de que entraran los nombres.
const MS_TRANSICION = 7_000;

// El ranking se mueve durante el turno: refrescar los datos del backend es independiente del avance
// de diapositivas (esto no reinicia el ciclo de paginación, solo actualiza los números y posiciones).
// Cada 3 min y no en "tiempo real": cada consulta recalcula el área de TODAS las pesadas del día, y
// en la tarde son miles compitiendo por el mismo pool de 3 conexiones que usa el pesaje.
const MS_REFRESCO = 180_000;
// Si una consulta falla no se espera el ciclo completo: con 3 min la pantalla quedaba en rojo todo
// ese tiempo por un corte de red de segundos.
const MS_REINTENTO = 30_000;

// La pantalla de pared nunca se recarga sola (Chromium en kiosco en una Orange Pi, sin teclado): los
// datos se refrescan, pero el código se quedaba en el del día que arrancó y ningún despliegue llegaba.
// Cada tanto se pide el index.html y, si apunta a otro bundle que el cargado, se recarga. Solo con
// respuestas buenas y con el bundle nuevo ya servible: recargar con el servidor caído o a media
// compilación dejaría la pantalla en blanco, y en blanco ya no hay JavaScript que la vuelva a recargar.
const MS_REVISAR_VERSION = 300_000;
const RE_BUNDLE = /\/assets\/index-[\w-]+\.js/;

function bundleCargado() {
  for (const sc of document.scripts) {
    const m = (sc.getAttribute("src") || "").match(RE_BUNDLE);
    if (m) return m[0];
  }
  return null;
}

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
  { key: "reprocesoDescolado", campo: "LbReprocesoDescolado", nombre: "REPROCESO DESCOLADO", texto: "text-cyan-700",
    fondo: "fondo-olas-cyan", olas: ["rgba(255,255,255,0.14)", "rgba(255,255,255,0.24)", "#cffafe"] },
  { key: "reprocesoCorte", campo: "LbReprocesoCorte", nombre: "REPROCESO CORTE", texto: "text-rose-700",
    fondo: "fondo-olas-rose", olas: ["rgba(255,255,255,0.14)", "rgba(255,255,255,0.24)", "#ffe4e6"] },
];

// Tema de las hojas de Aprendizaje: verde lima de "brote". No ámbar, que es el color del puesto 1
// (medalla, halo y confeti) y le quitaría protagonismo al primer lugar; tampoco ninguno de los
// colores de área, para que el cambio se note aunque la hoja sea de la misma área que la anterior.
const OLAS_APRENDIZ = ["rgba(255,255,255,0.14)", "rgba(255,255,255,0.24)", "#ecfccb"];

function IconBrote({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21v-9" />
      <path d="M12 12C12 8 9 5 4 5c0 4 3 7 8 7z" />
      <path d="M12 10c0-3.5 2.5-6 7-6 0 3.5-2.5 6-7 6z" />
    </svg>
  );
}

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
      {/* Tamaños pensados para 10 filas en 1920×1080 (~85 px por fila): los topes del clamp quedan
          por encima de lo que da el vh a esa resolución, para que no recorten el tamaño en la tele. */}
      <div className="relative shrink-0 w-[clamp(2.75rem,7.5vh,6rem)] h-[clamp(2.75rem,7.5vh,6rem)]">
        {primero && (
          <>
            <span className="absolute inset-0 rounded-full bg-amber-500/40 motion-safe:animate-ping" />
            <Confeti />
          </>
        )}
        <div className={`relative w-full h-full rounded-full border-4 flex items-center justify-center ${estilo.anillo}`}>
          <span className={`text-[clamp(1.25rem,3.8vh,3rem)] font-extrabold tabular-nums leading-none ${estilo.texto}`}>
            {fila.Puesto}
          </span>
        </div>
      </div>
      <p className="flex-1 min-w-0 text-[clamp(1.4rem,6.48vh,4.5rem)] leading-[1.15] font-extrabold text-slate-900 uppercase truncate">
        {fila.Nombre}
      </p>
      <p className={`shrink-0 text-[clamp(1.6rem,6.48vh,4.5rem)] font-mono font-extrabold tabular-nums leading-none ${colorTexto}`}>
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
// Hacia una hoja de Aprendizaje las olas son lima y no del color del área: el nombre del área sigue
// en su color dentro de la tarjeta, pero lo primero que se ve de lejos es que viene aprendizaje.
function Transicion({ seccion }) {
  const fondo = seccion.aprendiz ? "fondo-olas-lime" : seccion.fondo;
  const olas = seccion.aprendiz ? OLAS_APRENDIZ : seccion.olas;
  return (
    <div className={`relative flex-1 min-h-0 rounded-2xl overflow-hidden animate-[fadeIn_0.4s_ease] ${fondo}`}>
      <CapaOlas color={olas[0]} alturaClase="h-[58%]" duracion={16} />
      <CapaOlas color={olas[1]} alturaClase="h-[42%]" duracion={11} reversa />
      <CapaOlas color={olas[2]} alturaClase="h-[26%]" duracion={7} />

      <div className="absolute inset-0 flex items-center justify-center">
        {/* La tarjeta ocupa el 85% de la hoja (ancho y alto) y el resto deja ver las olas del color
            del área. Letras pensadas para leerse desde el fondo de la planta en 1920×1080: el nombre
            del área ronda los 160 px y se parte en dos renglones ("PELADO Y / DEVENADO") sin salirse
            de la tarjeta. Los topes del clamp quedan por encima de lo que da el vh a esa resolución. */}
        <div className="w-[85%] h-[85%] bg-white/90 rounded-3xl shadow-2xl px-[4vw] py-[4vh] flex flex-col items-center justify-center gap-[2.5vh]">
          <svg className={`shrink-0 w-[clamp(3rem,13vh,10rem)] h-[clamp(3rem,13vh,10rem)] ${seccion.texto}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
          <p className="text-[clamp(1.25rem,5vh,4rem)] leading-none font-bold uppercase tracking-widest text-slate-500">Cambiando a</p>
          <p className={`text-[clamp(2.5rem,15vh,11rem)] leading-[1.05] font-extrabold uppercase tracking-wide text-center ${seccion.texto}`}>{seccion.nombre}</p>
          {seccion.aprendiz && (
            <p className="mt-[1vh] px-[3vw] py-[1vh] rounded-full bg-lime-600 text-white font-extrabold uppercase tracking-widest leading-none text-[clamp(1.5rem,7vh,5.5rem)] flex items-center gap-[1vw]">
              <IconBrote className="w-[1em] h-[1em]" />
              Aprendizaje
            </p>
          )}
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
    const cargado = bundleCargado();
    if (!cargado) return; // npm run dev: no hay bundle compilado que comparar
    const id = setInterval(async () => {
      try {
        const res = await fetch("/", { cache: "no-store" });
        if (!res.ok) return;
        const nuevo = (await res.text()).match(RE_BUNDLE)?.[0];
        if (!nuevo || nuevo === cargado) return;
        const js = await fetch(nuevo, { method: "HEAD", cache: "no-store" });
        if (js.ok) window.location.reload();
      } catch { /* sin red: se vuelve a intentar en la próxima vuelta */ }
    }, MS_REVISAR_VERSION);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelado = false;
    let id;
    // setTimeout encadenado y no setInterval: la espera depende de cómo salió la consulta anterior
    // (ciclo normal si salió bien, reintento corto si falló).
    const cargar = async () => {
      let ok = false;
      // Sin tope, un WiFi que se cae a media consulta deja el fetch colgado y nunca se reprograma el siguiente.
      const control = new AbortController();
      const corte = setTimeout(() => control.abort(), 20_000);
      try {
        const res = await fetch("/api/reportes/ranking-produccion", { headers: authHeader(), signal: control.signal });
        const data = await res.json();
        if (cancelado) return;
        if (!res.ok) { setError(data.error || "No se pudo cargar el ranking"); return; }
        setPersonas(calcularLbsPorPersona(data.ranking));
        setError("");
        setActualizado(new Date());
        ok = true;
      } catch {
        if (!cancelado) setError("Sin conexión con el servidor");
      } finally {
        clearTimeout(corte);
        if (!cancelado) {
          setCargando(false);
          id = setTimeout(cargar, ok ? MS_REFRESCO : MS_REINTENTO);
        }
      }
    };
    cargar();
    return () => { cancelado = true; clearTimeout(id); };
  }, []);

  // Dos secciones por área (general y aprendizaje), solo las que tienen a alguien produciendo hoy,
  // paginadas de POR_PAGINA en POR_PAGINA. Una sección vacía no entra en la secuencia, ni ella ni
  // su transición — no tiene sentido "cambiar a Descabezado" para mostrar una pantalla sin nadie.
  const secciones = useMemo(() => {
    return SECCIONES_CONFIG
      .flatMap(cfg => [false, true].map(aprendiz => {
        const datos = calcularRankingPorArea(personas.filter(p => esAprendiz(p) === aprendiz), cfg.campo);
        const paginas = [];
        for (let i = 0; i < datos.length; i += POR_PAGINA) paginas.push(datos.slice(i, i + POR_PAGINA));
        return { ...cfg, key: aprendiz ? `${cfg.key}-aprendiz` : cfg.key, aprendiz, paginas, total: datos.length };
      }))
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
  // refresco de datos (cada 2 min) genera un array de frames nuevo con el mismo tamaño.
  useEffect(() => {
    if (frames.length <= 1) return;
    const actual = frames[frameIndex % frames.length];
    const duracion = actual?.tipo === "transicion" ? MS_TRANSICION : MS_DIAPOSITIVA;
    const id = setTimeout(() => setFrameIndex(i => (i + 1) % frames.length), duracion);
    return () => clearTimeout(id);
  }, [frameIndex, frames.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const frameActual = frames.length ? frames[frameIndex % frames.length] : null;
  const tituloArea = frameActual?.tipo === "pagina" ? ` — ${frameActual.seccion.nombre}` : "";
  const enAprendizaje = frameActual?.tipo === "pagina" && frameActual.seccion.aprendiz;

  return (
    <div className={`h-screen overflow-hidden flex flex-col select-none transition-colors duration-500 ${enAprendizaje ? "bg-lime-50" : "bg-white"}`}>
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
          cuando el sufijo de área (" — DESCABEZADO") lo alarga. La fecha va encima de la hora (no al
          lado) para dejarle al título ~70vw: el más largo, "… — REPROCESO DESCOLADO", cabe entero. */}
      {/* En las hojas de Aprendizaje toda la pantalla cambia de tono (barra, franja y fondo), no solo
          un letrero: de lejos se distingue antes de leer cualquier nombre. */}
      <div className={`relative text-white flex items-center justify-end px-5 py-2 shrink-0 transition-colors duration-500 ${enAprendizaje ? "bg-lime-700" : "bg-blue-800"}`}>
        <h1 className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 max-w-[70vw] truncate text-center text-[clamp(1.25rem,3.7vh,3rem)] leading-tight font-bold tracking-wide uppercase">
          Ranking de Producción{tituloArea}
        </h1>
        <div className="flex flex-col items-end leading-tight pr-8">
          <span className={`text-[clamp(0.75rem,1.5vh,0.9rem)] ${enAprendizaje ? "text-lime-100" : "text-blue-200"}`}>{fecha}</span>
          <span className="text-[clamp(1.25rem,3.4vh,2rem)] font-mono tabular-nums">{hora}</span>
        </div>
      </div>

      {/* Franja y no sufijo en el título: "… — REPROCESO DESCOLADO · APRENDIZAJE" no cabe, y una
          banda de color se distingue desde lejos antes de leer cualquier nombre. */}
      {enAprendizaje && (
        <div className="bg-lime-300 text-lime-950 font-extrabold uppercase tracking-widest py-1 shrink-0 text-[clamp(1rem,3vh,2rem)] flex items-center justify-center gap-3">
          <IconBrote className="w-[1.1em] h-[1.1em]" />
          Aprendizaje · menos de {DIAS_APRENDIZAJE} días en la empresa
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col px-4 py-3 gap-3">
        {cargando ? (
          <EstadoCentral>
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </EstadoCentral>
        ) : error && !actualizado ? (
          // Solo tapa la pantalla si nunca hubo datos: con un ranking ya cargado, un fallo deja los
          // últimos números a la vista y avisa en el pie.
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
              {/* Relleno invisible: con menos de 10 personas las filas no se estiran a media pantalla. */}
              {Array.from({ length: POR_PAGINA - frameActual.filas.length }, (_, i) => (
                <div key={`vacio-${i}`} className="flex-1 min-h-0" />
              ))}
            </div>

            <div className="flex items-center justify-between shrink-0 pt-1">
              <span className={`text-[clamp(0.75rem,1.5vh,0.9rem)] ${error ? "text-red-600 font-semibold" : "text-slate-400"}`}>
                {actualizado && `Actualizado ${actualizado.toLocaleTimeString("es-GT", { hour12: false })}`}
                {error && ` · ${error}, reintentando…`}
              </span>
              <span className="text-[clamp(0.75rem,1.5vh,0.9rem)] text-slate-400">
                {frameActual.seccion.paginas.length > 1 && `Página ${frameActual.pagina + 1} de ${frameActual.seccion.paginas.length} · `}
                {frameActual.seccion.total} persona{frameActual.seccion.total !== 1 ? "s" : ""} en {frameActual.seccion.nombre.toLowerCase()}
                {frameActual.seccion.aprendiz && " (aprendizaje)"}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
