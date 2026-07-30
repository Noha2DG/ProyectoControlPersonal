import { useState, useEffect, useRef } from "react";
import { useAuth, authHeader } from "../context/AuthContext.jsx";
import { LB_POR_KG } from "../utils/destajo.js";

const DIAS = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

// Nombres de área tal como los devuelve la BD (Areas.Nombre) — mismos literales que usa el Reporte
// de Producción para partir las libras en sus dos columnas.
const AREA_DESCABEZADO = "DESCABEZADO";
const AREA_PELADO = "PELADO Y DEVENADO";

// La pantalla se limpia sola. El resultado dura bastante más que en el kiosco de Entrada/Salida
// (2 s) porque ahí la persona solo confirma que marcó, y aquí tiene que leer un detalle parada.
const SEGUNDOS = { ok: 20, vacio: 12, error: 5 };

// Solo las últimas 4 pesadas. En un panel de 7" cada renglón que se agrega obliga a achicar la
// letra de todos, y lo que la persona viene a ver es su total del día, no su historial completo.
// Lo que no cabe se resume en la línea de abajo.
const MAX_FILAS = 4;

// ── Paleta ────────────────────────────────────────────────────────────────────────────────────
// Fondo claro, no oscuro. En una planta bien iluminada una pantalla oscura emite poca luz y el
// reflejo del techo se le monta encima; con fondo blanco el panel emite a máxima luminancia y ese
// reflejo pesa mucho menos. Además el texto claro sobre fondo oscuro produce halación (las letras
// "sangran"), que golpea justo a quien ya tiene la vista cansada.
//
// Todos los tonos de texto son -600 o más oscuros: sobre blanco, un blue-400 se queda en 2:1 y
// desaparece. Contrastes contra blanco: slate-900 17.9:1 · slate-600 7.6:1 · blue-700 6.7:1 ·
// emerald-700 5.6:1 · amber-700 5.1:1 · red-700 6.5:1 (el objetivo era 7:1 en lo que se lee y no
// bajar de 4.5:1 en ningún dato). La separación entre tarjetas se hace con bordes de 2px y no con
// rellenos grises, porque cada relleno gris baja la luminancia que estamos tratando de aprovechar.
// Borde "neón" gris: el trazo de 2px es el tubo y las dos sombras son el halo — un anillo difuso
// pegado al borde y un resplandor más abierto. Sobre blanco un borde plano se pierde; el halo le da
// volumen al recuadro sin recurrir a un relleno gris, que bajaría la luminancia de la pantalla.
// El halo se mantiene corto (3px de anillo + 12px de resplandor) porque las tarjetas están
// separadas por 12px: uno más abierto haría que los halos de dos tarjetas vecinas se tocaran y el
// espacio entre ellas se viera sucio en vez de luminoso.
//
// Las variantes no comparten utilidades en conflicto (fondo, borde y sombra se declaran una sola
// vez en cada una): si se apilaran "bg-white" y "bg-amber-50" en la misma cadena, cuál gana lo
// decide el orden del CSS generado y no el de la cadena, y el resultado sería impredecible.
const TARJETA_BASE = "border-2 rounded-xl";
const TARJETA = `${TARJETA_BASE} bg-white border-slate-400 shadow-[0_0_0_3px_rgba(148,163,184,0.16),0_0_12px_1px_rgba(100,116,139,0.20)]`;
const TARJETA_ORO = `${TARJETA_BASE} bg-amber-50 border-amber-500 shadow-[0_0_0_4px_rgba(245,158,11,0.25),0_0_20px_4px_rgba(217,119,6,0.32)]`;

// Tamaños atados a la altura de la ventana (vh) para que la misma pantalla sirva en el panel de 7"
// y en un monitor grande. Los mínimos del clamp están puestos alto a propósito: en 600 px de alto
// el 2.3vh de la tabla daría 14 px, ilegible a un metro — el mínimo lo sube a 16 px y lo que no
// entra se recorta (menos filas), en vez de encoger la letra hasta que no se lea.
const T = {
  titulo:  "text-[clamp(1rem,2.4vh,1.4rem)]",
  reloj:   "text-[clamp(1.25rem,3.4vh,2rem)]",
  nombre:  "text-[clamp(1.25rem,3.6vh,2.4rem)]",
  hero:    "text-[clamp(2.85rem,8vh,4.5rem)]",
  tarjeta: "text-[clamp(1.5rem,4vh,3.4rem)]",
  tabla:   "text-[clamp(1rem,2.3vh,1.4rem)]",
  medio:   "text-[clamp(0.875rem,2.2vh,1.35rem)]",
  chico:   "text-[clamp(0.75rem,1.5vh,0.9rem)]",
  campo:   "text-[clamp(1.25rem,4vh,2.4rem)]",
};

function reloj() {
  return new Date().toLocaleTimeString("es-GT", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function fechaLarga() {
  const d = new Date();
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

const lb = (kilos) => kilos * LB_POR_KG;

// Cuántas filas caben realmente en el espacio que le quedó a la tabla. Antes se mostraba un número
// fijo y en una ventana baja (o en un panel de 7") la tabla se quedaba sin altura y solo se veía el
// encabezado: las filas existían, pero el overflow-hidden de la tarjeta las cortaba.
//
// El alto de fila se deriva del tamaño de letra en vez de medir una fila ya pintada: medir la fila
// haría que el resultado dependa de cuántas filas hay puestas en ese momento, que es justo lo que
// se está calculando. La medición se difiere a un requestAnimationFrame porque el ResizeObserver
// puede dispararse antes de que el layout se asiente y devolver un alto que todavía no es el final.
const INTERLINEADO = 1.5;              // line-height base de Tailwind
const PADDING_FILA = 5;                // py-0.5 arriba y abajo + el borde superior

function useFilasQueCaben(ref) {
  const [caben, setCaben] = useState(3);
  useEffect(() => {
    const cont = ref.current;
    if (!cont) return;
    let pendiente = null;
    let tardio = null;
    const medir = () => {
      const cuerpo = cont.querySelector("tbody");
      const cabecera = cont.querySelector("thead");
      if (!cuerpo || !cabecera) return;
      const alturaFila = parseFloat(getComputedStyle(cuerpo).fontSize) * INTERLINEADO + PADDING_FILA;
      const disponible = cont.clientHeight - cabecera.getBoundingClientRect().height;
      setCaben(Math.max(1, Math.floor(disponible / alturaFila)));
    };
    const programar = () => {
      cancelAnimationFrame(pendiente);
      pendiente = requestAnimationFrame(medir);
    };
    const observador = new ResizeObserver(programar);
    observador.observe(cont);
    // Red de seguridad: el observador dispara una sola vez si el alto ya no cambia, y esa primera
    // medición puede caer antes de que las tipografías terminen de cargar (con métricas distintas
    // el resultado se iba de 7 filas a 3 entre una carga y otra). Se vuelve a medir cuando las
    // fuentes están listas y una vez más pasado el arranque.
    document.fonts?.ready.then(programar).catch(() => {});
    tardio = setTimeout(programar, 400);
    return () => {
      cancelAnimationFrame(pendiente);
      clearTimeout(tardio);
      observador.disconnect();
    };
  }, [ref]);
  return caben;
}

function Identidad({ empleado, puesto }) {
  const primero = puesto?.Puesto === 1;
  return (
    <div className={`${primero ? TARJETA_ORO : TARJETA} relative flex items-center gap-6 px-6 py-2 min-h-0 overflow-hidden`}>
      {/* En primer lugar el recuadro entero se vuelve el premio: borde y halo en oro, más un anillo
          interior que respira. El anillo va en una capa aparte y solo cambia de opacidad — animar
          la tarjeta misma movería el nombre y el puesto, que es justo lo que hay que leer. */}
      {primero && (
        <span className="pointer-events-none absolute inset-0 rounded-[0.6rem] border-4 border-amber-400/60 motion-safe:animate-pulse" />
      )}
      <div className="flex-1 min-w-0">
        <p className={`${T.nombre} font-extrabold text-slate-900 leading-tight uppercase truncate`}>{empleado.Nombre}</p>
        <div className="flex items-center gap-3 mt-1">
          <span className={`${T.medio} font-mono text-slate-600 tracking-widest`}>{empleado.Codigo}</span>
          {empleado.Area && (
            <span className={`${T.medio} px-4 py-0.5 rounded-full border-2 border-emerald-700 bg-emerald-50 text-emerald-800 font-semibold tracking-widest uppercase`}>
              {empleado.Area}
            </span>
          )}
        </div>
      </div>
      {puesto && (
        <div className={`shrink-0 flex items-center gap-4 border-l-2 pl-6 ${primero ? "border-amber-300" : "border-slate-300"}`}>
          <div className="text-right">
            <p className={`${T.medio} font-semibold uppercase tracking-widest ${primero ? "text-amber-700" : "text-slate-700"}`}>
              {primero ? "¡Primer lugar!" : "Puesto del día"}
            </p>
            <p className={`${T.medio} text-slate-600`}>de {puesto.DeCuantos} hoy</p>
          </div>
          <div className="relative shrink-0 w-[clamp(2.25rem,8vh,4.5rem)] h-[clamp(2.25rem,8vh,4.5rem)]">
            {/* Halo que se expande y se desvanece en bucle. Va detrás del círculo (el borde queda
                nítido) y solo aparece en el puesto 1 — si parpadeara en todos dejaría de significar
                algo. motion-safe respeta a quien tenga desactivadas las animaciones en el sistema. */}
            {primero && (
              <span className="absolute inset-0 rounded-full bg-amber-500/40 motion-safe:animate-ping" />
            )}
            <div className={`relative w-full h-full rounded-full border-4 flex items-center justify-center ${
              primero ? "border-amber-600 bg-white" : "border-emerald-700 bg-emerald-50"
            }`}>
              <span className={`${T.tarjeta} font-extrabold tabular-nums leading-none ${primero ? "text-amber-700" : "text-slate-900"}`}>
                {puesto.Puesto}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Resultado({ datos }) {
  const { empleado, pesadas, puesto } = datos;

  const totalKg = pesadas.reduce((s, p) => s + p.Kilos, 0);
  const kgDe = (area) => pesadas.filter(p => p.Area === area).reduce((s, p) => s + p.Kilos, 0);

  const cuerpoRef = useRef(null);
  const caben = useFilasQueCaben(cuerpoRef);
  const ultimas = pesadas.slice(-Math.min(caben, MAX_FILAS));
  const anteriores = pesadas.length - ultimas.length;

  // Proporciones fijas en vez de "identidad y totales toman lo que necesiten y el detalle se queda
  // con las sobras": con ese reparto, en una ventana baja al detalle no le quedaba ni una fila.
  return (
    <div className="flex-1 min-h-0 grid grid-rows-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,2.1fr)] gap-3">
      <Identidad empleado={empleado} puesto={puesto} />

      {/* El total ocupa el ancho grande y las dos áreas se apilan a su derecha: en horizontal
          cabe todo en una sola franja, sin robarle altura al detalle. min-h-0 para que en una
          ventana baja esta franja ceda alto en vez de empujar el detalle fuera de la pantalla. */}
      <div className="grid grid-cols-[3fr_2fr] gap-3 min-h-0 overflow-hidden">
        <div className={`${TARJETA} flex flex-col items-center justify-center py-1 min-h-0 overflow-hidden`}>
          <p className={`${T.medio} text-slate-700 font-semibold uppercase tracking-[0.2em]`}>Total procesado hoy</p>
          <p className={`${T.hero} font-mono font-extrabold text-slate-900 tabular-nums leading-none mt-1`}>
            {lb(totalKg).toFixed(1)}
            <span className="text-[0.35em] text-slate-600 ml-3">LB</span>
          </p>
          <p className={`${T.medio} text-slate-600 font-mono tabular-nums mt-1`}>{totalKg.toFixed(2)} kg</p>
        </div>

        <div className="grid grid-rows-2 gap-3">
          <div className={`${TARJETA} border-l-8 border-l-blue-700 px-5 flex items-center justify-between gap-3`}>
            <p className={`${T.medio} text-blue-800 font-semibold uppercase tracking-widest`}>Descabezado</p>
            <p className={`${T.tarjeta} font-mono font-bold tabular-nums text-blue-700 leading-none`}>
              {lb(kgDe(AREA_DESCABEZADO)).toFixed(1)}<span className="text-[0.4em] text-slate-600 ml-2">lb</span>
            </p>
          </div>
          <div className={`${TARJETA} border-l-8 border-l-emerald-700 px-5 flex items-center justify-between gap-3`}>
            <p className={`${T.medio} text-emerald-800 font-semibold uppercase tracking-widest`}>Pelado y Devenado</p>
            <p className={`${T.tarjeta} font-mono font-bold tabular-nums text-emerald-700 leading-none`}>
              {lb(kgDe(AREA_PELADO)).toFixed(1)}<span className="text-[0.4em] text-slate-600 ml-2">lb</span>
            </p>
          </div>
        </div>
      </div>

      <div className={`${TARJETA} min-h-0 overflow-hidden flex flex-col`}>
        <div ref={cuerpoRef} className="flex-1 min-h-0">
        {/* Sin h-full: cada fila mide lo que mide su texto más su padding. Con h-full las filas se
            estiraban para rellenar la tarjeta, y con dos o tres pesadas quedaban altísimas. */}
        <table className="w-full table-fixed">
          <thead>
            <tr className={`${T.medio} bg-slate-200 text-slate-800 uppercase tracking-widest border-b-2 border-slate-400`}>
              <th className="px-5 py-1.5 text-left font-extrabold w-[14%]">Hora</th>
              <th className="px-5 py-1.5 text-left font-extrabold w-[16%]">Talla</th>
              <th className="px-5 py-1.5 text-left font-extrabold">Producto</th>
              <th className="px-5 py-1.5 text-right font-extrabold w-[16%]">Kg</th>
              <th className="px-5 py-1.5 text-right font-extrabold w-[16%]">Lb</th>
            </tr>
          </thead>
          {/* Franjas alternas: en un panel chico visto de lejos son lo que evita que el ojo salte de
              renglón al recorrer la fila de izquierda a derecha. */}
          {/* Todo el cuerpo en negrita: a un metro de un panel de 7" el grosor del trazo pesa más
              que el tamaño para que un número se distinga de un vistazo. */}
          <tbody className={`${T.tabla} font-mono tabular-nums font-bold`}>
            {ultimas.map((p, i) => (
              <tr key={i} className="even:bg-slate-100">
                <td className="px-5 py-0.5 text-slate-700">{p.Hora}</td>
                <td className="px-5 py-0.5 text-slate-900">{p.DescripcionTalla}</td>
                <td className="px-5 py-0.5 text-slate-800 font-sans font-semibold truncate">{p.Producto}</td>
                <td className="px-5 py-0.5 text-right text-slate-900">{p.Kilos.toFixed(2)}</td>
                <td className="px-5 py-0.5 text-right font-extrabold text-emerald-700">{lb(p.Kilos).toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {/* Esta línea se reserva siempre su espacio (invisible cuando no hay más pesadas): si
            apareciera y desapareciera según el número de filas, cambiaría el alto disponible y el
            cálculo de arriba se realimentaría a sí mismo hasta quedarse en una sola fila. */}
        <p className={`${T.medio} px-5 py-1 border-t-2 border-slate-200 ${anteriores > 0 ? "text-slate-600" : "invisible"}`}>
          {anteriores > 0
            ? `+ ${anteriores} pesada${anteriores !== 1 ? "s" : ""} anterior${anteriores !== 1 ? "es" : ""} de hoy`
            : " "}
        </p>
      </div>
    </div>
  );
}

function SinPesadas({ datos }) {
  const { empleado, ayer } = datos;
  const noEsDestajo = !empleado.EsAreaDestajo;

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      <Identidad empleado={empleado} puesto={null} />

      <div className={`${TARJETA} flex-1 min-h-0 flex flex-col items-center justify-center text-center px-8`}>
        <svg className="w-[clamp(2.5rem,9vh,5rem)] h-[clamp(2.5rem,9vh,5rem)] text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M12 3v18M5 7h14M7 7l-3 7a3 3 0 006 0L7 7zm10 0l-3 7a3 3 0 006 0l-3-7z" />
        </svg>
        {noEsDestajo ? (
          <>
            <p className={`${T.nombre} font-bold text-slate-900 mt-4`}>TU ÁREA NO TRABAJA POR DESTAJO</p>
            <p className={`${T.medio} text-slate-600 mt-2`}>
              {empleado.Area ? `Estás en ${empleado.Area}.` : "No tienes un área asignada en este momento."} Esta pantalla solo muestra libras de Descabezado y Pelado y Devenado.
            </p>
          </>
        ) : (
          <>
            <p className={`${T.nombre} font-bold text-slate-900 mt-4`}>AÚN NO TIENES PESADAS REGISTRADAS HOY</p>
            <p className={`${T.medio} text-slate-600 mt-2`}>Tu primera pesada aparecerá aquí en cuanto la registre el pesador</p>
            {empleado.HoraEntradaArea && (
              <p className={`${T.medio} text-slate-700 mt-4 font-mono`}>Entraste al área a las {empleado.HoraEntradaArea}</p>
            )}
          </>
        )}
        {ayer.Kilos > 0 && (
          <p className={`${T.medio} text-slate-600 mt-6`}>
            Ayer procesaste <span className="text-slate-900 font-mono font-bold tabular-nums">{lb(ayer.Kilos).toFixed(1)} lb</span>
          </p>
        )}
      </div>
    </div>
  );
}

// El input es uno solo en todo el componente, pero cambia de lugar según el estado: al centro y
// grande mientras nadie ha escaneado (es lo único que hay que hacer ahí), y discreto en el pie
// cuando ya se está leyendo un resultado. Como al cambiar de estado el input se vuelve a montar,
// MiProduccionPage le devuelve el foco en un efecto — si no, el lector escribiría en el vacío.
// El input nunca se deshabilita, ni siquiera mientras se consulta: un input deshabilitado no puede
// tener el foco, y en una pantalla sin teclado ni touch nadie puede devolvérselo. Que no se procese
// un escaneo durante la consulta lo resuelve la guarda de consultar().
function CampoEscaneo({ inputRef, valor, onChange, onKeyDown, grande }) {
  const clases = grande
    ? `${T.campo} w-[clamp(11rem,26vw,20rem)] py-2 border-4`
    : `${T.medio} w-44 py-1 border-2`;
  return (
    <input
      ref={inputRef}
      value={valor}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onBlur={() => setTimeout(() => inputRef.current?.focus(), 50)}
      autoFocus
      autoComplete="off"
      className={`${clases} bg-white border-slate-400 rounded-lg px-3 text-center font-mono font-bold text-slate-900 tracking-widest uppercase focus:outline-none focus:border-emerald-600`}
    />
  );
}

function Reposo({ hora, fecha, campo, cargando }) {
  return (
    <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center">
      {/* El título del encabezado es una barra chica que nadie mira de lejos. Repetirlo aquí, grande
          y encima del reloj, es lo que hace que alguien que pasa entienda para qué es la pantalla
          antes de acercarse — si no, de lejos solo se ve un reloj. */}
      <p className={`${T.nombre} font-extrabold text-blue-800 uppercase tracking-wide mb-[2vh]`}>Mi producción de hoy</p>
      <p className="font-mono font-extrabold text-slate-900 tabular-nums leading-none text-[clamp(3rem,17vh,9rem)]">{hora.slice(0, 5)}</p>
      <p className={`${T.medio} text-slate-600 mt-2`}>{fecha}</p>
      <svg className="w-[clamp(2.25rem,7vh,4rem)] h-[clamp(2.25rem,7vh,4rem)] text-slate-400 mt-[4vh]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M3 5h18v14H3V5zm4 4h4v4H7V9zm0 6h10M15 9h2" />
      </svg>
      <p className={`${T.nombre} font-bold text-slate-900 mt-3 tracking-wide`}>PASE SU CARNET POR EL LECTOR</p>
      <p className={`${T.medio} mt-2 font-semibold ${cargando ? "text-emerald-700" : "text-slate-700"}`}>
        {cargando ? "Consultando…" : "y vea las libras que lleva procesadas hoy"}
      </p>
      <div className="mt-[3vh]">{campo}</div>
    </div>
  );
}

export default function MiProduccionPage() {
  const { logout } = useAuth();
  const [hora, setHora] = useState(reloj());
  const [fecha, setFecha] = useState(fechaLarga());
  const [input, setInput] = useState("");
  const [vista, setVista] = useState(null);
  const [restante, setRestante] = useState(null);
  const [cargando, setCargando] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    const id = setInterval(() => { setHora(reloj()); setFecha(fechaLarga()); }, 1000);
    return () => clearInterval(id);
  }, []);

  // Cuenta regresiva de regreso a reposo: un timeout encadenado por segundo. El último tick es el
  // que limpia la pantalla — así todo el cambio de estado ocurre dentro del callback y no en el
  // cuerpo del efecto, que dispararía un render en cascada.
  // Se congela mientras hay una consulta en curso: si la cuenta llegara a cero justo entonces,
  // la pantalla volvería a reposo y el resultado recién pedido aparecería de la nada un instante
  // después, moviendo el input dos veces seguidas.
  useEffect(() => {
    if (restante == null || cargando) return;
    const id = setTimeout(() => {
      if (restante <= 1) { setVista(null); setRestante(null); }
      else setRestante(restante - 1);
    }, 1000);
    return () => clearTimeout(id);
  }, [restante, cargando]);

  // El input cambia de lugar (centro ↔ pie) al cambiar de estado, así que se vuelve a montar y
  // pierde el foco. Sin esto, después de que la pantalla regresa sola a reposo el lector escribiría
  // en el vacío y el siguiente carnet no haría nada.
  useEffect(() => { inputRef.current?.focus(); }, [vista]);

  // Vigilante del foco. El lector de código de barras escribe donde esté el cursor: si el foco se
  // pierde, la pantalla queda muerta y el siguiente carnet no hace nada — y como en planta no hay
  // teclado ni touch, nadie puede devolvérselo a mano. Los eventos puntuales (onBlur, clic, cambio
  // de estado) cubren lo previsible; el intervalo cubre el resto: volver de un salvapantallas, que
  // el navegador recupere el foco tras una notificación del sistema, o cualquier cosa que se lo
  // robe sin avisar. Comparar antes de enfocar evita interrumpir a quien esté escribiendo.
  useEffect(() => {
    const enfocar = () => {
      if (document.activeElement !== inputRef.current) inputRef.current?.focus();
    };
    const id = setInterval(enfocar, 1000);
    window.addEventListener("focus", enfocar);
    document.addEventListener("visibilitychange", enfocar);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", enfocar);
      document.removeEventListener("visibilitychange", enfocar);
    };
  }, []);

  const mostrar = (v) => { setVista(v); setRestante(SEGUNDOS[v.tipo]); };

  const consultar = async (codigo) => {
    const cod = codigo.trim().toUpperCase();
    if (!cod || cargando) return;
    setCargando(true);
    try {
      const res = await fetch(`/api/pesaje/mi-dia/${encodeURIComponent(cod)}`, { headers: authHeader() });
      const data = await res.json();
      if (!res.ok) mostrar({ tipo: "error", mensaje: data.error || "No se pudo consultar" });
      else mostrar({ tipo: data.pesadas.length ? "ok" : "vacio", datos: data });
    } catch {
      mostrar({ tipo: "error", mensaje: "Sin conexión con el servidor" });
    } finally {
      setCargando(false);
      setInput("");
      inputRef.current?.focus();
    }
  };

  const handleKey = (e) => {
    if (e.key !== "Enter" && e.key !== "Tab") return;
    e.preventDefault();
    consultar(input);
  };

  const campo = (grande) => (
    <CampoEscaneo
      inputRef={inputRef}
      valor={input}
      onChange={e => setInput(e.target.value.toUpperCase())}
      onKeyDown={handleKey}
      grande={grande}
    />
  );

  // h-screen + overflow-hidden: es una pantalla fija de planta, nunca debe aparecer una barra de
  // scroll ni quedar contenido abajo que nadie va a ir a buscar.
  return (
    <div
      className="h-screen overflow-hidden bg-white flex flex-col select-none"
      onClick={() => inputRef.current?.focus()}
    >
      <button
        onClick={e => { e.stopPropagation(); logout(); window.location.hash = ""; }}
        title="Cerrar sesión"
        className="fixed top-1 right-1 z-50 p-2 rounded-full text-blue-200 hover:text-white hover:bg-white/20 transition"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
      </button>

      {/* Barra sólida en vez de una línea divisoria: sobre fondo blanco hace falta un ancla que
          separe el encabezado del contenido, y es un área chica, así que no baja la luminancia. */}
      <div className="bg-blue-800 text-white flex items-baseline justify-between px-5 py-2 shrink-0">
        <h1 className={`${T.titulo} font-bold tracking-widest uppercase`}>Mi producción de hoy</h1>
        <div className="flex items-baseline gap-5 pr-8">
          <span className={`${T.chico} text-blue-200`}>{fecha}</span>
          <span className={`${T.reloj} font-mono tabular-nums`}>{hora}</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col px-4 py-3">
        {/* La consulta no reemplaza la pantalla por un "Consultando…" a pantalla completa: eso movía
            el input de sitio a media lectura, desmontándolo y tirando el foco. El aviso va dentro del
            estado actual y el resultado anterior se queda a la vista hasta que llega el nuevo. */}
        {!vista && <Reposo hora={hora} fecha={fecha} campo={campo(true)} cargando={cargando} />}
        {vista?.tipo === "ok" && <Resultado datos={vista.datos} />}
        {vista?.tipo === "vacio" && <SinPesadas datos={vista.datos} />}
        {vista?.tipo === "error" && (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <p className={`${T.nombre} font-bold text-red-700`}>{vista.mensaje}</p>
            <p className={`${T.medio} text-slate-600 mt-3`}>Intente de nuevo o avise a su supervisor</p>
          </div>
        )}
      </div>

      {/* En reposo el input ya está al centro de la pantalla, así que el pie no aparece: una barra
          vacía abajo solo robaría alto. El input existe en un solo lugar por estado, y ese lugar no
          cambia durante la consulta — así se desmonta lo menos posible y el foco no se pierde. */}
      {vista && (
        <div className="relative flex items-center justify-center border-t-2 border-slate-300 px-4 py-2 shrink-0">
          <div className="flex items-center gap-3">
            <span className={`${T.medio} ${cargando ? "text-emerald-700 font-semibold" : "text-slate-600"}`}>
              {cargando ? "Consultando…" : "Pase otro carnet para consultar"}
            </span>
            {campo(false)}
          </div>
          {restante != null && (
            <span className={`${T.chico} text-slate-500 absolute right-4`}>Volviendo a inicio en {restante} s</span>
          )}
        </div>
      )}
    </div>
  );
}
