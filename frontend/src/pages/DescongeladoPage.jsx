// Descongelado de Materia Prima — la versión en pantalla del formulario FR-7.13-13.
//
// La pantalla ya NO copia la forma del papel. El papel tiene dos secciones —  lo que entró y lo que
// salió pesado—  porque una hoja no puede restar sola: hay que escribir los dos números para poder
// compararlos después. Acá el sistema resta, así que pedir la misma línea dos veces (una para
// declararla y otra para buscarla en un combo y ponerle peso y destino) era trabajo que solo
// existía para imitar una limitación del papel. Una jornada de dieciséis lotes eran treinta y dos
// capturas para dieciséis movimientos reales.
//
// Ahora es un solo gesto: en el inventario al piso se elige qué bajar, se dice a dónde va y con eso
// queda descongelado. La hoja se muestra en UNA tabla donde lo declarado y lo pesado son dos
// columnas de la misma fila, con su diferencia al lado — que es la pregunta que el papel obliga a
// contestar cruzando dos secciones con el dedo.
//
// Lo que NO cambió es el modelo: sigue habiendo dos movimientos de kardex por renglón (el consumo
// del piso a la hoja y el traslado de la hoja al área siguiente), porque la hoja sigue siendo un
// lugar por el que el producto pasa. Cambió la pantalla, no el inventario.
import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import { fmtNum } from "../utils/numero.js";
import { authHeader, usePuede } from "../context/AuthContext.jsx";
import { useAviso } from "../hooks/useAviso.js";
import AvisoModal from "../components/AvisoModal.jsx";
import EmpleadoAutocomplete from "../components/EmpleadoAutocomplete.jsx";
import HojaDescongeladoModal from "../components/HojaDescongeladoModal.jsx";
import ReporteDescongeladoModal from "../components/ReporteDescongeladoModal.jsx";

const API = "/api/descongelado";

const hoyGT = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });

const horaGT = () =>
  new Date().toLocaleTimeString("es-GT", { hour12: false, hour: "2-digit", minute: "2-digit", timeZone: "America/Guatemala" });

// Las fechas puras (YYYY-MM-DD) se parten a mano: new Date("2026-09-21") se interpreta como
// medianoche UTC y en Guatemala se muestra un día antes (ver utils/fecha.js).
const fmtDia = (iso) => {
  if (!iso) return "—";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

async function leerJSON(res) { try { return await res.json(); } catch { return {}; } }

// Un rendimiento por debajo del 90 % o por encima del 100 % casi siempre es un error de captura,
// no un dato de proceso: se marca en ámbar para que salte a la vista sin bloquear el cierre.
function colorRendimiento(r) {
  if (r == null) return "text-gray-400";
  if (r > 100 || r < 90) return "text-amber-600";
  return "text-gray-800";
}

/* ── Destino ──────────────────────────────────────────────────────── */
// A dónde va lo descongelado: una BODEGA VIRTUAL del catálogo, y nada más.
//
// La bodega es la unidad con la que se lleva el inventario al piso, así que es también la única
// altura a la que el destino significa algo. Ofrecer además el área de abajo —  "Pelado Selecto" en
// vez de "Pelado"—  hacía escoger entre treinta y ocho opciones para mover el saldo de catorce
// lugares: el operador tenía que acertarle a una distinción que el inventario después ignora.
//
// La lista viene de /bodegas, que ya filtra Activo = 1 y LlevaPiso = 1 y las ordena por el flujo
// del proceso. Las que solo existen como origen de polín (Bodega, Devoluciones) no aparecen: ahí no
// se puede dejar producto a granel.
const pagoDestino = (v) => v ? { BodegaDestino: v } : null;

function SelectorDestino({ destinos, value, onChange, ancho = "w-full", vacio = "¿A dónde va?…", chico = false }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className={`${ancho} border rounded ${chico ? "px-1.5 py-0.5 text-xs" : "px-2 py-1 text-sm"}
        ${value ? "border-gray-300" : "border-amber-400 bg-amber-50"}
        focus:outline-none focus:ring-2 focus:ring-blue-400`}>
      <option value="">{vacio}</option>
      {destinos.map(b => <option key={b.Codigo} value={b.Codigo}>{b.Nombre}</option>)}
    </select>
  );
}

const valorDestinoDe = (l) => l?.BodegaDestino || "";
const nombreDestinoDe = (l) => l?.NombreBodegaDestino || l?.BodegaDestino || "—";

/* ── La cabecera de la hoja del día ───────────────────────────────── */
// La hoja NO se abre a mano: la abre el primer movimiento del día, sea descongelar o devolver. Por
// eso sus datos —  los del encabezado del formulario de papel—  se piden dentro del modal que esté
// haciendo ese primer movimiento, y no en una pantalla aparte que no significaría nada por sí sola.
//
// Al abrir se pide SOLO quién es el encargado y a qué hora arrancó. Cuántas personas trabajaron se
// cuenta al CERRAR: a la hora del primer movimiento todavía no ha llegado todo el turno, y el
// número que se tomaba acá era siempre el de los primeros que marcaron.
//
// El encargado se ESCOGE de quienes marcaron en el área, no se teclea: en el teléfono escribir un
// código de empleado es una errata segura, y la lista ya está en la pantalla. Si el encargado
// todavía no marcó —  o no marca en esa área—, "Otro empleado" abre el buscador de siempre.
function CabeceraNuevaHoja({ cab, setCab, empleados, auxiliares, inicioSugerido }) {
  const [otro, setOtro] = useState(false);
  const buscar = otro || auxiliares.length === 0;

  return (
    <div className="mt-4 pt-3 border-t">
      <p className="text-xs font-semibold text-gray-600 mb-2">
        No hay hoja abierta hoy — se abre una con estos datos (es la cabecera del formulario de papel).
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0">
          <label className="block text-xs text-gray-500 mb-1">Encargado del área</label>
          {buscar ? (
            <div className="flex items-center gap-2">
              <EmpleadoAutocomplete empleados={empleados} value={cab.Encargado}
                onSelect={cod => setCab(c => ({ ...c, Encargado: cod }))} />
              {auxiliares.length > 0 && (
                <button type="button" onClick={() => { setOtro(false); setCab(c => ({ ...c, Encargado: "" })); }}
                  className="text-xs text-blue-600 hover:underline whitespace-nowrap">Ver lista</button>
              )}
            </div>
          ) : (
            <select value={cab.Encargado}
              onChange={e => {
                if (e.target.value === "__otro") { setOtro(true); setCab(c => ({ ...c, Encargado: "" })); }
                else setCab(c => ({ ...c, Encargado: e.target.value }));
              }}
              className={`w-64 max-w-full border rounded px-2 py-1.5 text-sm
                ${cab.Encargado ? "border-gray-300" : "border-amber-400 bg-amber-50"}`}>
              <option value="">Escoja al encargado…</option>
              {auxiliares.map(a => (
                <option key={a.Codigo} value={a.Codigo}>{a.Nombre} · {a.Codigo}{a.Presente ? " (en el área)" : ""}</option>
              ))}
              <option value="__otro">Otro empleado…</option>
            </select>
          )}
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Hora inicio</label>
          <input type="time" value={cab.HoraInicio}
            onChange={e => setCab(c => ({ ...c, HoraInicio: e.target.value }))}
            className="border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>
      </div>
      <p className="text-xs text-gray-400 mt-2">
        {inicioSugerido && cab.HoraInicio === inicioSugerido.Hora
          ? `Hora de inicio tomada del ${inicioSugerido.Motivo}. `
          : ""}
        Las personas del turno se cuentan al cerrar la hoja.
      </p>
    </div>
  );
}

/* ── Los auxiliares de una hoja ───────────────────────────────────── */
// Un número, "ver lista" al lado y las horas que sumaron en el área. La lista va plegada porque lo
// que se declara en el papel es el número; la lista existe para poder decir quiénes eran.
//
// Todo sale del marcaje DENTRO de la ventana de la hoja (su hora de inicio a su hora de fin), no de
// la jornada: con dos turnos, cada hoja cuenta a su gente y a nadie del otro turno. Las horas son el
// traslape de cada marcaje con esa ventana, así que quien cruzó el cambio de turno reparte sus
// horas entre las dos hojas en vez de sumarlas dos veces.
function fmtHoras(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function ResumenAuxiliares({ datos, cargando, oscuro = false }) {
  const [abierto, setAbierto] = useState(false);
  if (!datos) {
    return <span className={`text-xs ${oscuro ? "text-gray-400" : "text-gray-400"}`}>{cargando ? "Contando…" : "—"}</span>;
  }
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <span className="text-gray-600">Auxiliares</span>
        <b className="text-lg tabular-nums text-gray-900">{datos.Personas}</b>
        {datos.Personas > 0 && (
          <button onClick={() => setAbierto(a => !a)}
            className="text-xs text-blue-600 hover:underline font-semibold">
            {abierto ? "ocultar lista" : "ver lista"}
          </button>
        )}
        <span className="text-gray-300">·</span>
        <b className="tabular-nums text-gray-900">{fmtHoras(datos.Minutos)}</b>
        <span className="text-gray-600">en el área</span>
        {cargando && <span className="text-xs text-gray-400">actualizando…</span>}
      </div>
      <p className="text-xs text-gray-400 mt-0.5">
        de {datos.Desde.slice(11)} a {datos.Hasta.slice(11)}
        {datos.Hasta.slice(0, 10) !== datos.Desde.slice(0, 10) && " del día siguiente"}
        {datos.Presentes > 0 && ` · ${datos.Presentes} ${datos.Presentes === 1 ? "sigue" : "siguen"} en el área`}
        {" · sin contar al encargado"}
      </p>
      {abierto && (
        <div className="mt-2 border border-gray-200 rounded divide-y divide-gray-100 max-h-64 overflow-y-auto">
          {datos.lista.map(a => (
            <div key={a.Codigo} className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <span className="truncate">{a.Nombre}</span>
              <span className="font-mono text-xs text-gray-400">{a.Codigo}</span>
              <span className="ml-auto text-xs text-gray-500 tabular-nums whitespace-nowrap">
                {a.Desde}–{a.Presente ? "ahora" : a.Hasta}
              </span>
              <span className="text-xs tabular-nums font-semibold w-20 text-right whitespace-nowrap">{fmtHoras(a.Minutos)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Modal: cerrar la hoja ────────────────────────────────────────── */
// El cierre es cuando se sabe entero quién trabajó el turno. Las personas no se teclean ni se
// marcan: salen del marcaje en la ventana de la hoja, y el número que ve el encargado es el que el
// servidor va a guardar —  la cuenta la rehace él mismo al cerrar, con la misma hora de fin.
function ModalCerrarHoja({ hoja, onConfirmar, onCerrar }) {
  const inicioOriginal = hoja.HoraInicio ? hoja.HoraInicio.slice(11, 16) : "";
  const [horaInicio, setHoraInicio] = useState(inicioOriginal);
  const [horaFin, setHoraFin] = useState(horaGT());
  const [aux, setAux] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Se recuenta con cada cambio de hora: bajar el fin a las 14:00 saca a quien llegó después, y
  // adelantar el inicio mete a quien trabajó antes de que la hoja se abriera en el sistema.
  useEffect(() => {
    if (!/^\d{2}:\d{2}$/.test(horaFin)) return;
    let vigente = true;
    setCargando(true);
    const desde = /^\d{2}:\d{2}$/.test(horaInicio) ? `&desde=${horaInicio}` : "";
    fetch(`${API}/hojas/${hoja.HojaId}/auxiliares?hasta=${horaFin}${desde}`, { headers: authHeader() })
      .then(leerJSON)
      .then(d => { if (vigente && d && Array.isArray(d.lista)) setAux(d); })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [hoja.HojaId, horaFin, horaInicio]);

  const merma = Number((hoja.KgEntrada - hoja.KgDescongelado - hoja.KgDevuelto).toFixed(2));

  const confirmar = async () => {
    setGuardando(true);
    try {
      await onConfirmar({ HoraFin: horaFin,
                          ...(horaInicio && horaInicio !== inicioOriginal ? { HoraInicio: horaInicio } : {}) });
    }
    finally { setGuardando(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl min-w-0 flex flex-col max-h-[92vh]">
        <div className="px-5 py-3 border-b flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-bold text-gray-800">Cerrar hoja #{hoja.HojaId}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Encargado: {hoja.NombreEncargado || hoja.Encargado || "—"}
              {hoja.HoraInicio && ` · inicio ${hoja.HoraInicio.slice(11)}`}
            </p>
          </div>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="px-5 py-3 overflow-y-auto space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Hora inicio del turno</label>
              <input type="time" value={horaInicio} onChange={e => setHoraInicio(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Hora fin</label>
              <input type="time" value={horaFin} onChange={e => setHoraFin(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm" />
            </div>
          </div>

          {/* La hoja se abre con el primer movimiento que se CAPTURA, y el papel va adelante del
              sistema: el turno pudo haber empezado horas antes. Si el área tiene marcajes antes
              del inicio de la hoja, se dice aquí — con el inicio tarde, esa gente no cuenta. */}
          {aux?.InicioSugerido && (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex flex-wrap items-center gap-2">
              <span>
                La hoja empieza a las <b>{horaInicio || "—"}</b>, pero el {aux.InicioSugerido.Motivo} fue a
                las <b>{aux.InicioSugerido.Hora}</b>. Quien trabajó antes del inicio no se cuenta.
              </span>
              <button onClick={() => setHoraInicio(aux.InicioSugerido.Hora)}
                className="ml-auto bg-amber-600 hover:bg-amber-700 text-white rounded px-3 py-1 font-semibold whitespace-nowrap">
                Usar {aux.InicioSugerido.Hora}
              </button>
            </div>
          )}

          <ResumenAuxiliares datos={aux} cargando={cargando} />

          <p className="text-xs text-gray-600">
            Merma que se anota: <b className={merma > 0.004 ? "text-amber-600" : ""}>{fmtNum(merma)} kg</b>
            <span className="text-gray-400"> = entrada {fmtNum(hoja.KgEntrada)} − descongelado {fmtNum(hoja.KgDescongelado)} − devuelto {fmtNum(hoja.KgDevuelto)}</span>
          </p>
          {merma < -0.004 && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              Salió más de lo que entró ({fmtNum(-merma)} kg de más). Corrija el peso pesado de algún
              renglón con el lápiz antes de cerrar: la hoja no cierra con merma negativa.
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t flex flex-wrap items-center gap-x-3 gap-y-2 shrink-0">
          <span className="text-xs text-gray-500 w-full">
            Al cerrar, el siguiente movimiento abre la hoja del turno que sigue.
          </span>
          <button onClick={onCerrar}
            className="ml-auto shrink-0 border border-gray-300 rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={guardando || merma < -0.004}
            className="shrink-0 whitespace-nowrap bg-green-600 hover:bg-green-700 text-white rounded px-5 py-1.5 text-sm font-semibold disabled:opacity-40">
            {guardando ? "Cerrando…" : "Cerrar hoja"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Modal: descongelar ───────────────────────────────── */
// Confirma tres cosas a la vez —  cuántos masters bajaron de verdad, a dónde van y (si alguien lo
// pesó) cuánto pesaron—  y con eso el producto queda descongelado. No hay un segundo paso:
// presionar el botón ES la confirmación de que ya se hizo.
//
// Se elige, no se teclea. Esto se llena en el teléfono del área, donde escribir a mano
// "G430TM03-E02-9", el producto y la talla es una errata garantizada — y una errata acá inventa un
// lote que no existe y rompe la trazabilidad del despacho.
//
// Los kilos declarados se DERIVAN de los masters y no se teclean nunca: si se pudieran escribir
// habría dos verdades sobre el mismo peso y el cuadre del día dejaría de significar algo.
//
// Sirve para una remisión entera o para una línea suelta. En el primer caso el destino se pone una
// vez arriba y baja a todas las líneas, porque lo normal es que una remisión entera vaya al mismo
// lado; la que no, se corrige en su propia fila.
// "2026-08-13" → "13-08-26": la fecha de producción del lote, para distinguir dos líneas del mismo lote.
function fechaCorta(f) {
  const [a, m, d] = String(f).slice(0, 10).split("-");
  return `${d}-${m}-${a.slice(2)}`;
}

// Llenar un termo con lo marcado del piso. En la planta no se descongela por lote: un termo lleva
// varios lotes juntos (de una o varias remisiones), un lote grande se reparte en varios termos y lo
// que se pesa en báscula es el termo lleno. Por eso aquí se pide UNA vez el número, el peso y el
// destino, y el servidor reparte el peso entre los lotes en proporción a lo declarado.
//
// La CANASTA es para el lote pequeño que conserva su lote original y no va en termo: un solo lote,
// número opcional, y también se pesa.
//
// Reglas (usuario, 26 oct 2026): el termo se pesa siempre, va a un solo destino, y no se mezclan
// productos distintos (C20 con D30 no). Las remisiones sí se pueden mezclar.
function ModalTermo({ seleccion, recipienteInicial, hojaAbierta, destinos, destinoSugerido, empleados, auxiliares, inicioSugerido, onConfirmar, onCerrar }) {
  const [recipiente, setRecipiente] = useState(recipienteInicial);
  const [numero, setNumero] = useState("");
  const [peso, setPeso] = useState("");
  const [destino, setDestino] = useState(destinoSugerido || "");
  const [guardando, setGuardando] = useState(false);
  const [cab, setCab] = useState({ Encargado: "", HoraInicio: inicioSugerido?.Hora || horaGT() });

  const canasta = recipiente === "CANASTA";
  const lotes = [...new Set(seleccion.map(x => x.linea.Lote))];
  const declarado = Number(seleccion.reduce((s, x) => s + x.kg, 0).toFixed(2));
  const masters = seleccion.reduce((s, x) => s + (x.masters ?? 0), 0);
  const pesado = Number(peso);
  const dif = pesado > 0 ? Number((pesado - declarado).toFixed(2)) : null;
  const listo = (canasta || numero.trim()) && pesado > 0 && destino && (hojaAbierta || cab.Encargado)
    && !(canasta && lotes.length > 1);
  const nombre = canasta ? "canasta" : "termo";

  const confirmar = async () => {
    setGuardando(true);
    try {
      await onConfirmar({
        Recipiente: recipiente, NumeroTermo: numero.trim(), PesoReal: pesado, BodegaDestino: destino,
        lineas: seleccion.map(x => ({
          Lote: x.linea.Lote, Clase: x.linea.Clase, Talla: x.linea.Talla, RemisionId: x.linea.RemisionId,
          FechaLote: x.linea.FechaLote, KgPorMaster: x.linea.KgPorMaster, UM: "KG",
          ...(x.masters != null ? { Masters: x.masters } : { Peso: x.kg }),
        })),
      }, hojaAbierta ? null : cab);
    } finally { setGuardando(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl min-w-0 flex flex-col max-h-[92vh]">
        <div className="px-5 py-3 border-b flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            {[["TERMO", "Termo"], ["CANASTA", "Canasta"]].map(([v, t]) => (
              <button key={v} onClick={() => setRecipiente(v)}
                className={`px-4 py-1.5 rounded-md text-sm font-semibold ${recipiente === v ? "bg-white shadow text-gray-800" : "text-gray-500 hover:text-gray-700"}`}>
                {t}
              </button>
            ))}
          </div>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">{canasta ? "Canasta N° (opcional)" : "Termo N°"}</label>
              <input value={numero} onChange={e => setNumero(e.target.value)} autoFocus
                className={`w-full border rounded px-3 py-2 text-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-400
                  ${canasta || numero.trim() ? "border-gray-300" : "border-amber-400 bg-amber-50"}`} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Peso en báscula (kg)</label>
              <input type="number" inputMode="decimal" min="0" step="0.01" value={peso} onChange={e => setPeso(e.target.value)}
                placeholder={`declarado ${fmtNum(declarado)}`}
                className={`w-full border rounded px-3 py-2 text-lg text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-400
                  ${pesado > 0 ? "border-gray-300" : "border-amber-400 bg-amber-50"}`} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Va a</label>
              <SelectorDestino destinos={destinos} value={destino} onChange={setDestino} vacio="Escoja la bodega…" />
            </div>
          </div>

          {canasta && lotes.length > 1 && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              Una canasta lleva <b>un solo lote</b> (el lote pequeño que conserva su lote original). Marcó {lotes.length}: use Termo.
            </p>
          )}

          <div className="border border-gray-200 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Lote</th>
                  <th className="px-3 py-2 text-left font-semibold">Producto</th>
                  <th className="px-3 py-2 text-left font-semibold">Talla</th>
                  <th className="px-3 py-2 text-left font-semibold">Remisión</th>
                  <th className="px-3 py-2 text-right font-semibold">Masters</th>
                  <th className="px-3 py-2 text-right font-semibold">Declarado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {seleccion.map(x => (
                  <tr key={x.clave}>
                    <td className="px-3 py-1.5 font-mono text-xs">
                      {x.linea.Lote}
                      {x.linea.FechaLote && <span className="block font-sans text-[11px] text-gray-400">prod. {fechaCorta(x.linea.FechaLote)}</span>}
                    </td>
                    <td className="px-3 py-1.5 text-xs"><span className="font-mono text-gray-500">{x.linea.Clase}</span> {x.linea.DescripcionClase}</td>
                    <td className="px-3 py-1.5 text-xs">{x.linea.DescripcionTalla}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-blue-700">{x.linea.FolioRemision || "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{x.masters ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(x.kg)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2">
                <tr className="font-bold">
                  <td colSpan={4} className="px-3 py-2 text-right text-xs text-gray-600 uppercase">
                    {lotes.length} lote{lotes.length !== 1 ? "s" : ""} en {canasta ? "la canasta" : "el termo"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{masters || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtNum(declarado)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {dif != null && Math.abs(dif) > 0.004 && (
            <p className={`text-xs ${dif > 0 ? "text-red-700" : "text-gray-600"}`}>
              {dif < 0
                ? <>La báscula marca <b>{fmtNum(-dif)} kg menos</b> que lo declarado: esa diferencia sale como merma al cerrar la hoja.</>
                : <>La báscula marca <b>{fmtNum(dif)} kg más</b> que lo declarado. Revise la báscula: la hoja no cierra si sale más de lo que entró.</>}
            </p>
          )}
          {seleccion.length > 1 && (
            <p className="text-xs text-gray-400">El peso de la báscula se reparte entre los lotes en proporción a lo declarado: cada lote sigue con su código en el piso de destino.</p>
          )}

          {!hojaAbierta && (
            <CabeceraNuevaHoja cab={cab} setCab={setCab} empleados={empleados} auxiliares={auxiliares} inicioSugerido={inicioSugerido} />
          )}
        </div>

        <div className="px-5 py-3 border-t flex flex-wrap items-center gap-x-3 gap-y-2 shrink-0">
          <span className="text-xs text-gray-500 w-full sm:w-auto">
            {hojaAbierta
              ? <>Se agrega a la hoja <b>#{hojaAbierta.HojaId}</b>{hojaAbierta.NombreEncargado ? ` · ${hojaAbierta.NombreEncargado}` : ""}</>
              : "Se abrirá la hoja del día"}
          </span>
          <button onClick={onCerrar}
            className="ml-auto shrink-0 border border-gray-300 rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={!listo || guardando}
            className="shrink-0 whitespace-nowrap bg-blue-600 hover:bg-blue-700 text-white rounded px-5 py-1.5 text-sm font-semibold disabled:opacity-40">
            {guardando ? "Guardando…" : `Guardar ${nombre}${numero.trim() ? ` ${numero.trim()}` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Modal: devolver a bodega ─────────────────────────────────────── */
// Devolver NO es elegir kilos: es elegir CAJAS, con su correlativo. El piso lleva lote y kilos y no
// tiene forma de nombrar un master, así que devolver desde ahí dejaría a bodega con kilos que no
// puede posicionar y con los masters marcados 'Salido' para siempre.
//
// La identidad la conserva la remisión, que guarda cada MasterId que despachó. Por eso acá no se
// escanea nada —  en Descongelado no hay lector—  sino que se marca de la lista que salió, agrupada
// por el polín del que vino, que es como la planta la devuelve: casi siempre el polín completo.
function ModalDevolver({ titulo, datos, hojaAbierta, empleados, auxiliares, inicioSugerido, onConfirmar, onCerrar }) {
  const [sel, setSel] = useState(() => new Set());
  const [expandido, setExpandido] = useState(() => new Set());
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  // El inicio arranca en el inicio real del turno (cierre de la hoja anterior o primer marcaje del
  // área), no en la hora de captura: la hoja casi siempre se abre tarde.
  const [cab, setCab] = useState({ Encargado: "", HoraInicio: inicioSugerido?.Hora || horaGT() });

  const polines = datos?.polines ?? [];
  const todos = polines.flatMap(p => p.Masters);
  const claveLote = m => `${m.Lote}|${m.Clase}|${m.Talla}`;

  // Un master cuyo producto YA se descongeló no puede regresar: sus kilos salieron del piso y
  // devolverlo dejaría el saldo en negativo. El tope se cuenta por lote, y se tapa acá en vez de
  // dejar que el servidor rechace el lote entero después de marcar veinte casillas.
  const usadosPorLote = useMemo(() => {
    const m = new Map();
    for (const x of todos) if (sel.has(x.MasterId)) m.set(claveLote(x), (m.get(claveLote(x)) ?? 0) + 1);
    return m;
  }, [sel, todos]);

  const cabe = (m) => sel.has(m.MasterId) || (usadosPorLote.get(claveLote(m)) ?? 0) < m.AlPiso;
  const bloqueado = (m) => !sel.has(m.MasterId) && m.AlPiso <= 0;

  const alternar = (id) => setSel(s => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  // Marcar el polín entero es el gesto normal; se saltan las cajas cuyo producto ya se descongeló.
  const alternarPolin = (p) => setSel(s => {
    const n = new Set(s);
    const marcados = p.Masters.filter(m => n.has(m.MasterId)).length;
    if (marcados === p.Masters.length) { for (const m of p.Masters) n.delete(m.MasterId); return n; }
    const usados = new Map(usadosPorLote);
    for (const m of p.Masters) {
      if (n.has(m.MasterId)) continue;
      const k = claveLote(m);
      if ((usados.get(k) ?? 0) < m.AlPiso) { n.add(m.MasterId); usados.set(k, (usados.get(k) ?? 0) + 1); }
    }
    return n;
  });

  const marcados = todos.filter(m => sel.has(m.MasterId));
  const totalKg = Number(marcados.reduce((s, m) => s + m.KgPorMaster, 0).toFixed(2));
  const listo = marcados.length > 0 && motivo.trim() && (hojaAbierta || cab.Encargado) && !datos?.Vencida;

  const confirmar = async () => {
    setGuardando(true);
    try { await onConfirmar(marcados.map(m => m.MasterId), motivo.trim(), hojaAbierta ? null : cab); }
    finally { setGuardando(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl min-w-0 flex flex-col max-h-[92vh]">
        <div className="px-5 py-3 border-b flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-bold text-gray-800">Devolver a bodega</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {titulo}
              {datos?.ConfirmadaEn && ` · confirmada ${datos.ConfirmadaEn}`}
              {datos?.Dias != null && ` · hace ${datos.Dias} día${datos.Dias !== 1 ? "s" : ""}`}
            </p>
          </div>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="px-5 py-2.5 bg-gray-50 border-b flex items-center gap-2 shrink-0">
          <label className="text-xs font-semibold text-gray-600 shrink-0">Por qué regresa</label>
          <input value={motivo} onChange={e => setMotivo(e.target.value)}
            placeholder="No se alcanzó a procesar, se pidió de más…"
            className="flex-1 min-w-0 border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>

        <div className="px-5 py-3 overflow-y-auto">
          {datos?.Vencida && (
            <p className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              Esta remisión se confirmó hace <b>{datos.Dias} días</b> y el plazo para devolver es de {datos.DiasLimite}.
              Pasado ese plazo la devolución la tiene que hacer un administrador.
            </p>
          )}
          {polines.length === 0 && (
            <p className="py-6 text-center text-gray-400 text-xs">
              Esta remisión ya no tiene cajas que devolver.
            </p>
          )}

          {polines.map(p => {
            const nSel = p.Masters.filter(m => sel.has(m.MasterId)).length;
            const abierto = expandido.has(p.PalletId);
            return (
              <div key={p.PalletId} className="border border-gray-200 rounded mb-2 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50">
                  <input type="checkbox" checked={nSel === p.Masters.length && nSel > 0}
                    ref={el => { if (el) el.indeterminate = nSel > 0 && nSel < p.Masters.length; }}
                    onChange={() => alternarPolin(p)} className="w-4 h-4 cursor-pointer" />
                  <button onClick={() => setExpandido(s => {
                      const n = new Set(s); n.has(p.PalletId) ? n.delete(p.PalletId) : n.add(p.PalletId); return n;
                    })}
                    className="flex-1 min-w-0 text-left">
                    <span className="font-mono font-bold text-sm text-gray-800">{p.Codigo}</span>
                    <span className="text-xs text-gray-500 ml-2">{p.Estatus}</span>
                    <span className="text-xs text-gray-500 ml-2">
                      · {nSel} de {p.Masters.length} caja{p.Masters.length !== 1 ? "s" : ""}
                    </span>
                  </button>
                  <span className="text-gray-400 text-xs font-bold w-4 text-center">{abierto ? "▾" : "▸"}</span>
                </div>
                {abierto && (
                  <div className="divide-y divide-gray-100">
                    {p.Masters.map(m => (
                      <label key={m.MasterId}
                        className={`flex items-center gap-2 px-3 py-1.5 text-xs
                          ${bloqueado(m) ? "opacity-40" : "hover:bg-gray-50 cursor-pointer"}`}>
                        <input type="checkbox" checked={sel.has(m.MasterId)}
                          disabled={!cabe(m)} onChange={() => alternar(m.MasterId)}
                          className="w-4 h-4 ml-5 cursor-pointer" />
                        <span className="font-mono text-gray-700">{m.Correlativo}</span>
                        <span className="font-mono text-gray-400">{m.Lote}</span>
                        <span className="text-gray-500">{m.Clase} · {m.DescripcionTalla}</span>
                        <span className="ml-auto tabular-nums text-gray-600">{fmtNum(m.KgPorMaster)} kg</span>
                        {bloqueado(m) && <span className="text-amber-600 shrink-0">ya descongelado</span>}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {!hojaAbierta && marcados.length > 0 && (
            <CabeceraNuevaHoja cab={cab} setCab={setCab} empleados={empleados} auxiliares={auxiliares}
              inicioSugerido={inicioSugerido} />
          )}
        </div>

        <div className="px-5 py-3 border-t flex flex-wrap items-center gap-x-3 gap-y-2 shrink-0">
          <span className="text-xs text-gray-500 w-full sm:w-auto">
            {marcados.length > 0
              ? <>Regresan <b>{marcados.length}</b> caja{marcados.length !== 1 ? "s" : ""} · {fmtNum(totalKg)} kg ·
                  se crea un polín de devolución que bodega tiene que ubicar</>
              : "Marque las cajas que regresan"}
          </span>
          <button onClick={onCerrar}
            className="ml-auto shrink-0 border border-gray-300 rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={!listo || guardando}
            className="shrink-0 whitespace-nowrap bg-amber-600 hover:bg-amber-700 text-white rounded px-5 py-1.5 text-sm font-semibold disabled:opacity-40">
            {guardando ? "Guardando…" : `Devolver ${marcados.length} caja${marcados.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Inventario al piso ───────────────────────────────────────────── */
// Lo que el área tiene y todavía no ha bajado. Entra solo cuando bodega confirma la remisión y sale
// solo cuando se descongela; nadie lo teclea ni lo arrastra de un día a otro.
//
// "Días al piso" cuenta desde que el producto ENTRÓ AL ÁREA, no desde la fecha del lote: hay lotes
// congelados del año pasado y su edad de producción no dice nada sobre si el área lo tiene parado.
// Se marca lo que va al termo —  una línea, varias o una remisión completa—  y en cada marcada se dice
// cuántos masters bajan (vienen todos; si el lote no cabe en el termo, se bajan menos y el resto sigue
// al piso para el siguiente termo). Después, "Llenar termo" o "Canasta".
const claveDeLinea = r => `${r.RemisionId ?? "-"}|${r.Lote}|${r.Clase}|${r.Talla}|${r.FechaLote ?? ""}`;

function InventarioPiso({ saldo, resumen, puedeCrear, marcadas, setMarcadas, onLlenar, onDevolver }) {
  const [abierto, setAbierto] = useState(true);
  const totalKg = saldo.reduce((s, r) => s + r.Kg, 0);
  const totalM  = saldo.reduce((s, r) => s + (r.Masters || 0), 0);

  // Agrupado por remisión, conservando el orden que ya trae el backend (la remisión confirmada
  // primero, y dentro de ella el lote más viejo primero). El producto que entró por un ajuste, sin
  // remisión detrás, cae en su propio grupo al final.
  const grupos = [];
  for (const r of saldo) {
    const clave = r.RemisionId ?? "sin-remision";
    let g = grupos.find(x => x.clave === clave);
    if (!g) { g = { clave, Folio: r.FolioRemision, ConfirmadaEn: r.ConfirmadaEn, lineas: [], Kg: 0, Masters: 0 }; grupos.push(g); }
    g.lineas.push(r); g.Kg += r.Kg; g.Masters += r.Masters || 0;
  }

  // Lo marcado: masters si la línea viene contada en masters, kg si no (un ajuste sin masters).
  const conMasters = r => (r.Masters ?? 0) > 0;
  const cantDe = r => {
    const v = Number(marcadas[claveDeLinea(r)]);
    return conMasters(r) ? Math.max(0, Math.min(Math.floor(v) || 0, r.Masters)) : Math.max(0, Math.min(v || 0, r.Kg));
  };
  const seleccion = saldo.filter(r => marcadas[claveDeLinea(r)] != null && cantDe(r) > 0).map(r => ({
    clave: claveDeLinea(r), linea: r,
    masters: conMasters(r) ? cantDe(r) : null,
    kg: conMasters(r) ? Number((cantDe(r) * (r.KgPorMaster || 0)).toFixed(2)) : cantDe(r),
  }));
  const clases = [...new Set(seleccion.map(x => x.linea.Clase))];
  const lotes = [...new Set(seleccion.map(x => x.linea.Lote))];
  const kgSel = seleccion.reduce((s, x) => s + x.kg, 0);
  const mSel = seleccion.reduce((s, x) => s + (x.masters ?? 0), 0);

  const alternar = (r) => setMarcadas(m => {
    const n = { ...m }; const k = claveDeLinea(r);
    if (n[k] != null) delete n[k]; else n[k] = String(conMasters(r) ? r.Masters : r.Kg);
    return n;
  });
  const alternarGrupo = (g) => setMarcadas(m => {
    const n = { ...m };
    const todas = g.lineas.every(r => n[claveDeLinea(r)] != null);
    for (const r of g.lineas) { const k = claveDeLinea(r); if (todas) delete n[k]; else if (n[k] == null) n[k] = String(conMasters(r) ? r.Masters : r.Kg); }
    return n;
  });

  return (
    <section className="bg-white border border-gray-300 rounded-lg overflow-hidden">
      <header className="bg-gray-100 border-b border-gray-300 px-4 py-2 flex items-center gap-3">
        <button onClick={() => setAbierto(a => !a)}
          className="text-gray-500 hover:text-gray-800 text-xs font-bold w-4">{abierto ? "▾" : "▸"}</button>
        <h3 className="font-bold text-sm text-gray-700">AL PISO</h3>
        <span className="text-xs text-gray-500">
          sin descongelar · {grupos.length} {grupos.length === 1 ? "remisión" : "remisiones"}
        </span>
        <span className="ml-auto flex items-baseline gap-4 text-sm">
          {resumen && resumen.IngresadoKg > 0 && (
            <span className="text-xs text-gray-500">
              Ingresó hoy <b className="font-mono tabular-nums text-gray-700">{fmtNum(resumen.IngresadoKg)} kg</b>
            </span>
          )}
          <span className="font-mono tabular-nums font-bold text-gray-800">
            {fmtNum(totalKg)} kg {totalM > 0 && <span className="font-normal text-gray-500">· {totalM} masters</span>}
          </span>
        </span>
      </header>

      {/* La barra de lo marcado: siempre a la vista, arriba de la lista, porque en el teléfono la
          lista es larga y el botón no puede quedar abajo de todo. */}
      {abierto && puedeCrear && saldo.length > 0 && (
        <div className={`px-4 py-2 border-b flex flex-wrap items-center gap-2 ${seleccion.length ? "bg-blue-50 border-blue-200" : "bg-white"}`}>
          {seleccion.length ? (
            <>
              <span className="text-sm text-blue-900">
                <b>{seleccion.length}</b> línea{seleccion.length !== 1 ? "s" : ""} · {lotes.length} lote{lotes.length !== 1 ? "s" : ""}
                {mSel > 0 && <> · <b>{mSel}</b> masters</>} · <b>{fmtNum(kgSel)}</b> kg declarados
              </span>
              {clases.length > 1 && (
                <span className="text-xs font-semibold text-red-700">No se mezclan productos en un termo: {clases.join(" y ")}</span>
              )}
              <span className="ml-auto flex gap-2">
                <button onClick={() => setMarcadas({})} className="border border-gray-300 rounded px-3 py-1.5 text-xs text-gray-600 hover:bg-white">Quitar marcas</button>
                <button onClick={() => onLlenar(seleccion, "CANASTA")} disabled={clases.length > 1 || lotes.length > 1}
                  title={lotes.length > 1 ? "Una canasta lleva un solo lote" : "Lote pequeño que conserva su lote original"}
                  className="border border-blue-400 text-blue-700 rounded px-3 py-1.5 text-xs font-semibold hover:bg-white disabled:opacity-40">
                  Canasta
                </button>
                <button onClick={() => onLlenar(seleccion, "TERMO")} disabled={clases.length > 1}
                  className="bg-blue-600 text-white rounded px-4 py-1.5 text-xs font-semibold hover:bg-blue-700 disabled:opacity-40">
                  Llenar termo
                </button>
              </span>
            </>
          ) : (
            <span className="text-xs text-gray-500">Marque lo que va al termo (pueden ser varios lotes del mismo producto, de una o varias remisiones) y use <b>Llenar termo</b>.</span>
          )}
        </div>
      )}

      {abierto && (
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase sticky top-0 z-10">
              <tr>
                {puedeCrear && <th className="px-3 py-2 w-8"></th>}
                <th className="px-3 py-2 text-left font-semibold">Lote</th>
                <th className="px-3 py-2 text-left font-semibold">Producto</th>
                <th className="px-3 py-2 text-left font-semibold">Talla</th>
                <th className="px-3 py-2 text-left font-semibold">Entró</th>
                <th className="px-3 py-2 text-right font-semibold">Días</th>
                <th className="px-3 py-2 text-right font-semibold">Al piso</th>
                {puedeCrear && <th className="px-3 py-2 text-right font-semibold">Bajar</th>}
                <th className="px-3 py-2 w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {saldo.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400 text-xs">
                  Nada al piso. El producto aparece aquí cuando bodega confirma una remisión al área.</td></tr>
              ) : grupos.map(g => {
                const todas = g.lineas.every(r => marcadas[claveDeLinea(r)] != null);
                const algunas = g.lineas.some(r => marcadas[claveDeLinea(r)] != null);
                return (
                  <Fragment key={g.clave}>
                    <tr className="bg-blue-50 border-t border-blue-200">
                      {puedeCrear && (
                        <td className="px-3 py-1.5">
                          <input type="checkbox" checked={todas} title="Marcar la remisión completa"
                            ref={el => { if (el) el.indeterminate = algunas && !todas; }}
                            onChange={() => alternarGrupo(g)} className="w-4 h-4 cursor-pointer" />
                        </td>
                      )}
                      <td colSpan={5} className="px-3 py-1.5 font-semibold text-blue-900 text-xs">
                        {g.Folio || "Sin remisión (ajuste)"}
                        {g.ConfirmadaEn && <span className="font-normal text-blue-600 ml-2">confirmada {g.ConfirmadaEn}</span>}
                        <span className="font-normal text-blue-600 ml-2">· {g.lineas.length} línea{g.lineas.length !== 1 ? "s" : ""}</span>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-xs font-bold text-blue-900 whitespace-nowrap">
                        {g.Masters ? `${g.Masters} m · ` : ""}{fmtNum(g.Kg)}
                      </td>
                      {puedeCrear && <td></td>}
                      <td className="px-3 py-1.5 text-center whitespace-nowrap">
                        {/* Devolver va SOLO a nivel de remisión: se rastrea por las cajas que ella
                            despachó. El producto que entró por un ajuste no tiene remisión detrás. */}
                        {puedeCrear && g.clave !== "sin-remision" && (
                          <button onClick={() => onDevolver(g.clave, g.Folio)}
                            title="Regresar cajas a bodega sin descongelar"
                            className="border border-amber-300 text-amber-700 rounded px-2 py-1 text-xs font-semibold hover:bg-amber-50">
                            Devolver
                          </button>
                        )}
                      </td>
                    </tr>
                    {g.lineas.map(r => {
                      const k = claveDeLinea(r);
                      const marcada = marcadas[k] != null;
                      return (
                        <tr key={k} className={marcada ? "bg-blue-50/60" : "hover:bg-gray-50"}>
                          {puedeCrear && (
                            <td className="px-3 py-1.5">
                              <input type="checkbox" checked={marcada} onChange={() => alternar(r)} className="w-4 h-4 cursor-pointer" />
                            </td>
                          )}
                          <td className="px-3 py-1.5 pl-6 font-mono text-xs cursor-pointer" onClick={() => puedeCrear && alternar(r)}>
                            {r.Lote}
                            {r.FechaLote && <span className="block font-sans text-[11px] text-gray-400">prod. {fechaCorta(r.FechaLote)}</span>}
                          </td>
                          <td className="px-3 py-1.5 text-xs"><span className="font-mono text-gray-500">{r.Clase}</span> {r.DescripcionClase}</td>
                          <td className="px-3 py-1.5 text-xs">{r.DescripcionTalla}</td>
                          <td className="px-3 py-1.5 text-xs text-gray-500">{fmtDia(r.FechaIngreso)}</td>
                          <td className={`px-3 py-1.5 text-right tabular-nums text-xs ${r.DiasAlPiso > 2 ? "text-amber-600 font-bold" : "text-gray-500"}`}>
                            {r.DiasAlPiso ?? "—"}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                            {conMasters(r) ? <>{r.Masters} m · </> : ""}<span className="font-semibold">{fmtNum(r.Kg)}</span>
                          </td>
                          {puedeCrear && (
                            <td className="px-3 py-1.5 text-right">
                              {marcada && (
                                <input type="number" inputMode="numeric" min="0" max={conMasters(r) ? r.Masters : r.Kg}
                                  step={conMasters(r) ? 1 : 0.01} value={marcadas[k]}
                                  onChange={e => setMarcadas(m => ({ ...m, [k]: e.target.value }))}
                                  title={conMasters(r) ? "Masters que bajan a este termo" : "Kg que bajan a este termo"}
                                  className="w-20 border border-blue-300 rounded px-2 py-1 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-400" />
                              )}
                            </td>
                          )}
                          <td></td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ── La hoja: lo descongelado ─────────────────────────────────────── */
// UNA tabla donde antes había dos. Cada fila es un renglón real —  bajó del piso y se fue al área
// siguiente—  con lo declarado y lo pesado uno al lado del otro. En el papel eso son dos secciones
// que hay que cruzar con el dedo para saber si cuadran; acá la diferencia es una columna.
//
// Las filas se arman por ConsumoId, no comparando lote y talla: una misma línea puede irse partida
// a dos áreas distintas y ahí la comparación de campos deja de distinguir cuál es cuál.
function filasDeHoja(hoja) {
  const filas = [];
  const traslados = hoja.descongelado || [];
  for (const e of hoja.entrada || []) {
    const hijos = traslados.filter(d => d.ConsumoId === e.MovimientoId);
    if (!hijos.length) filas.push({ clave: `e${e.MovimientoId}`, entrada: e, salida: null, ref: e });
    else hijos.forEach((d, i) => filas.push({ clave: `d${d.MovimientoId}`, entrada: i === 0 ? e : null, salida: d, ref: d }));
  }
  // Renglones del flujo de dos pasos, anteriores a ConsumoId: no tienen a quién pegarse, así que
  // van sueltos en vez de desaparecer de la pantalla.
  for (const d of traslados) if (!d.ConsumoId) filas.push({ clave: `d${d.MovimientoId}`, entrada: null, salida: d, ref: d });
  return filas;
}

// Un renglón por TERMO (o canasta), con los lotes que lleva debajo. Se corrige o se quita el termo
// completo: su peso es uno solo (el de la báscula) y está repartido entre sus lotes. Los renglones
// viejos, de antes de que hubiera termos, son cada uno su propio "termo".
const esCanasta = (n) => /^canasta/i.test(n || "");

function termosDeHoja(hoja) {
  const entradas = new Map((hoja.entrada || []).map(e => [e.MovimientoId, e]));
  const termos = new Map();
  for (const d of hoja.descongelado || []) {
    const k = d.TermoOrigenId ?? d.MovimientoId;
    if (!termos.has(k)) termos.set(k, { id: k, numero: d.NumeroTermo, destino: d, lineas: [], declarado: 0, pesado: 0, masters: 0 });
    const t = termos.get(k);
    const e = d.ConsumoId ? entradas.get(d.ConsumoId) : null;
    t.lineas.push({ salida: d, entrada: e });
    t.pesado += d.PesoKg; t.declarado += e ? e.PesoKg : 0; t.masters += e?.Masters ?? 0;
  }
  // Lo que bajó del piso y nunca se despachó (flujo viejo de dos pasos): se muestra suelto.
  const despachados = new Set((hoja.descongelado || []).map(d => d.ConsumoId).filter(Boolean));
  const sueltos = (hoja.entrada || []).filter(e => !despachados.has(e.MovimientoId));
  return { termos: [...termos.values()], sueltos };
}

function TablaDescongelado({ hoja, destinos, puedeEditar, puedeBorrar, onCorregirTermo, onBorrarTermo, onBorrar }) {
  const [editando, setEditando] = useState(null);   // id del termo en edición
  const [f, setF] = useState({ numero: "", peso: "", destino: "", canasta: false });
  const { termos, sueltos } = termosDeHoja(hoja);

  const empezar = (t) => {
    setEditando(t.id);
    const canasta = esCanasta(t.numero);
    setF({ canasta, numero: canasta ? String(t.numero).replace(/^canasta\s*/i, "") : (t.numero || ""),
           peso: String(Number(t.pesado.toFixed(2))), destino: valorDestinoDe(t.destino) });
  };
  const guardar = async () => {
    const ok = await onCorregirTermo(editando, { Recipiente: f.canasta ? "CANASTA" : "TERMO", NumeroTermo: f.numero,
                                                PesoReal: Number(f.peso), BodegaDestino: f.destino });
    if (ok) setEditando(null);
  };

  return (
    <section className="bg-white border border-gray-300 rounded-lg overflow-hidden">
      <header className="bg-gray-100 border-b border-gray-300 px-4 py-2 flex items-center gap-3">
        <h3 className="font-bold text-sm text-gray-700">DESCONGELADO</h3>
        <span className="text-xs text-gray-500">{termos.length} termo{termos.length !== 1 ? "s" : ""}</span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Termo</th>
              <th className="px-3 py-2 text-left font-semibold">Lotes</th>
              <th className="px-3 py-2 text-right font-semibold">Masters</th>
              <th className="px-3 py-2 text-right font-semibold">Declarado</th>
              <th className="px-3 py-2 text-right font-semibold">Pesado</th>
              <th className="px-3 py-2 text-right font-semibold">Dif.</th>
              <th className="px-3 py-2 text-left font-semibold">Enviado a</th>
              <th className="px-3 py-2 w-20"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {termos.length === 0 && sueltos.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400 text-xs">
                Todavía no se ha descongelado nada. Marque lo del piso y use <b>Llenar termo</b>.</td></tr>
            )}
            {termos.map(t => {
              const dif = Number((t.declarado - t.pesado).toFixed(2));
              const enEdicion = editando === t.id;
              return (
                <tr key={t.id} className={`align-top ${enEdicion ? "bg-blue-50" : "hover:bg-gray-50"}`}>
                  <td className="px-3 py-2 font-mono font-bold whitespace-nowrap">
                    {enEdicion ? (
                      <div className="space-y-1">
                        <select value={f.canasta ? "C" : "T"} onChange={e => setF(p => ({ ...p, canasta: e.target.value === "C" }))}
                          className="border border-gray-300 rounded px-1 py-0.5 text-xs font-sans">
                          <option value="T">Termo</option><option value="C">Canasta</option>
                        </select>
                        <input value={f.numero} onChange={e => setF(p => ({ ...p, numero: e.target.value }))} placeholder={f.canasta ? "opcional" : "N°"}
                          className="w-20 border border-gray-300 rounded px-2 py-0.5 text-sm block" />
                      </div>
                    ) : esCanasta(t.numero) ? <span className="font-sans text-xs font-semibold text-emerald-700">{t.numero}</span>
                      : (t.numero || <span className="font-sans text-xs font-normal text-gray-400">sin número</span>)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {t.lineas.map(({ salida: d }) => (
                      <div key={d.MovimientoId} className="whitespace-nowrap">
                        <span className="font-mono">{d.Lote}</span> <span className="text-gray-500">{d.Clase} · {d.DescripcionTalla}</span>
                        {d.FolioRemision && <span className="text-blue-700 ml-1">{d.FolioRemision}</span>}
                      </div>
                    ))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.masters || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtNum(t.declarado)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">
                    {enEdicion
                      ? <input type="number" min="0" step="0.01" value={f.peso} autoFocus
                          onChange={e => setF(p => ({ ...p, peso: e.target.value }))}
                          className="w-24 border border-gray-300 rounded px-2 py-0.5 text-sm text-right tabular-nums" />
                      : fmtNum(t.pesado)}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums text-xs ${dif > 0.004 ? "text-amber-600 font-semibold" : dif < -0.004 ? "text-red-600 font-semibold" : "text-gray-400"}`}>
                    {Math.abs(dif) < 0.005 ? "—" : fmtNum(dif)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {enEdicion
                      ? <SelectorDestino destinos={destinos} value={f.destino} onChange={v => setF(p => ({ ...p, destino: v }))} ancho="w-44" chico />
                      : nombreDestinoDe(t.destino)}
                  </td>
                  <td className="px-3 py-2 text-center whitespace-nowrap">
                    {enEdicion ? (
                      <>
                        <button onClick={guardar} title="Guardar" className="text-green-600 hover:text-green-800 font-bold px-1">✓</button>
                        <button onClick={() => setEditando(null)} title="Cancelar" className="text-gray-400 hover:text-gray-600 font-bold px-1">✕</button>
                      </>
                    ) : (
                      <>
                        {puedeEditar && (
                          <button onClick={() => empezar(t)} title="Corregir número, peso o destino del termo"
                            className="text-gray-400 hover:text-blue-600 text-base px-1.5">✎</button>
                        )}
                        {puedeBorrar && (
                          <button onClick={() => onBorrarTermo(t)} title="Quitar el termo: sus lotes vuelven al piso"
                            className="text-gray-400 hover:text-red-600 text-lg leading-none px-1.5">&times;</button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {sueltos.map(e => (
              <tr key={`e${e.MovimientoId}`} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-xs text-amber-600">sin despachar</td>
                <td className="px-3 py-2 text-xs"><span className="font-mono">{e.Lote}</span> <span className="text-gray-500">{e.Clase} · {e.DescripcionTalla}</span></td>
                <td className="px-3 py-2 text-right tabular-nums">{e.Masters ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtNum(e.PesoKg)}</td>
                <td colSpan={3}></td>
                <td className="px-3 py-2 text-center">
                  {puedeBorrar && (
                    <button onClick={() => onBorrar(e.MovimientoId)} title="Quitar el renglón y devolverlo al piso"
                      className="text-gray-400 hover:text-red-600 text-lg leading-none px-1.5">&times;</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-100 border-t-2 border-gray-300">
            <tr className="font-bold">
              <td colSpan={3} className="px-3 py-2 text-right text-xs text-gray-600 uppercase">Totales</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNum(hoja.KgEntrada)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-base">{fmtNum(hoja.KgDescongelado)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-xs">
                {fmtNum(Number((hoja.KgEntrada - hoja.KgDescongelado).toFixed(2)))}
              </td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/* ── Devoluciones a bodega ────────────────────────────────────────── */
// Producto que bajó del piso y regresa sin descongelar. SOLO SE LEE: la captura vive en la lista
// del piso, con el botón "Devolver", porque ahí el producto ya está escrito y solo hay que
// señalarlo. Este formulario pedía teclear lote, producto y talla a mano — en el teléfono del área
// eso es una errata garantizada, y una errata acá inventa un lote que no existe.
function SeccionDevoluciones({ hoja, puedeBorrar, onBorrar }) {
  const [abierto, setAbierto] = useState((hoja.devoluciones?.length ?? 0) > 0);

  return (
    <section className="bg-white border border-gray-300 rounded-lg overflow-hidden">
      <header className="bg-gray-100 border-b border-gray-300 px-4 py-2 flex items-center gap-3">
        <button onClick={() => setAbierto(a => !a)}
          className="text-gray-500 hover:text-gray-800 text-xs font-bold w-4">{abierto ? "▾" : "▸"}</button>
        <h3 className="font-bold text-sm text-gray-700">DEVOLUCIONES A BODEGA</h3>
        <span className="text-xs text-gray-500">
          {hoja.devoluciones.length === 0 ? "ninguna" : `${hoja.devoluciones.length} renglón${hoja.devoluciones.length !== 1 ? "es" : ""} · sin descongelar`}
        </span>
        <span className="ml-auto font-mono tabular-nums text-sm font-bold text-gray-800">{fmtNum(hoja.KgDevuelto)} kg</span>
      </header>
      {abierto && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Lote</th>
                <th className="px-3 py-2 text-left font-semibold">Producto</th>
                <th className="px-3 py-2 text-left font-semibold">Talla</th>
                <th className="px-3 py-2 text-left font-semibold">Remisión</th>
                <th className="px-3 py-2 text-right font-semibold">Masters</th>
                <th className="px-3 py-2 text-right font-semibold">Kg</th>
                <th className="px-3 py-2 text-left font-semibold">Motivo</th>
                <th className="px-3 py-2 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {hoja.devoluciones.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-400 text-xs">
                  Nada devuelto. Use <b>Devolver</b> en la lista del piso para regresar a bodega lo que
                  no se alcanzó a descongelar.</td></tr>
              )}
              {hoja.devoluciones.map(l => (
                <tr key={l.MovimientoId} className="hover:bg-gray-50">
                  <td className="px-3 py-1.5 font-mono text-xs">{l.Lote}</td>
                  <td className="px-3 py-1.5 text-xs"><span className="font-mono text-gray-500">{l.Clase}</span> {l.DescripcionClase}</td>
                  <td className="px-3 py-1.5 text-xs">{l.DescripcionTalla}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-blue-700">{l.FolioRemision || "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{l.Masters ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmtNum(l.PesoKg)}</td>
                  <td className="px-3 py-1.5 text-xs text-gray-600 truncate max-w-[18rem]">{l.Motivo || "—"}</td>
                  <td className="px-3 py-1.5 text-center">
                    {puedeBorrar && (
                      <button onClick={() => onBorrar(l.MovimientoId)}
                        title="Quitar la devolución y regresar el producto al piso"
                        className="text-gray-400 hover:text-red-600 text-lg leading-none px-1.5">&times;</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ── El cuadre, como tiras de números ─────────────────────────────── */
// Era una tabla al final de la pantalla. Es una resta de cuatro términos: cabe en una línea y así
// se lee sin bajar, que es donde importa mientras la hoja está abierta.
function Cuadre({ hoja }) {
  const pendiente = Number((hoja.KgEntrada - hoja.KgDescongelado - hoja.KgDevuelto - hoja.KgMerma).toFixed(2));
  const tiles = [
    { t: "Entrada declarada", v: hoja.KgEntrada, c: "text-gray-800" },
    { t: "Descongelado", v: hoja.KgDescongelado, c: "text-blue-700" },
    { t: "Devuelto a bodega", v: hoja.KgDevuelto, c: "text-gray-800" },
    { t: hoja.Estatus === "Cerrada" ? "Merma" : "Merma al cerrar",
      v: hoja.Estatus === "Cerrada" ? hoja.KgMerma : pendiente,
      c: (hoja.Estatus === "Cerrada" ? hoja.KgMerma : pendiente) > 0.004 ? "text-amber-600" : "text-gray-400" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-gray-300 border border-gray-300 rounded-lg overflow-hidden">
      {tiles.map(x => (
        <div key={x.t} className="bg-white px-4 py-2.5">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold truncate">{x.t}</div>
          <div className={`font-mono tabular-nums text-lg font-bold ${x.c}`}>{fmtNum(x.v)}<span className="text-xs font-normal text-gray-400 ml-1">kg</span></div>
        </div>
      ))}
      <div className="bg-white px-4 py-2.5">
        <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Rendimiento</div>
        <div className={`font-mono tabular-nums text-lg font-bold ${colorRendimiento(hoja.Rendimiento)}`}>
          {hoja.Rendimiento != null ? `${fmtNum(hoja.Rendimiento)}%` : "—"}
        </div>
      </div>
    </div>
  );
}

/* ── Página ───────────────────────────────────────────────────────── */
export default function DescongeladoPage() {
  const puedeCrear  = usePuede("descongelado", "crear");
  const puedeEditar = usePuede("descongelado", "editar");
  const puedeCerrar = usePuede("descongelado", "cerrar");
  const puedeBorrar = usePuede("descongelado", "eliminar");
  const { aviso, mostrarAlerta, pedirConfirmacion, cerrar } = useAviso();

  const [fecha, setFecha]   = useState(hoyGT());
  const [hojas, setHojas]   = useState([]);
  const [selId, setSelId]   = useState(null);
  const [sel, setSel]       = useState(null);     // la hoja con sus renglones
  const [destinos, setDestinos] = useState([]);
  const [saldo, setSaldo]   = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [cargando, setCargando]   = useState(false);
  const [error, setError]         = useState("");
  const [auxiliares, setAuxiliares] = useState([]);
  const [resumen, setResumen] = useState(null);
  const [modal, setModal]   = useState(null);   // { seleccion, recipiente } — llenar termo o canasta
  const [marcadas, setMarcadas] = useState({});   // clave de la línea del piso → masters (o kg) que bajan
  const [ultimoDestino, setUltimoDestino] = useState("");   // el destino del termo anterior se sugiere
  const [devol, setDevol]   = useState(null);   // { titulo, datos }    — devolver
  const [cierre, setCierre] = useState(false);   // modal de cerrar la hoja
  const [imprimir, setImprimir] = useState(false); // vista previa de la hoja para imprimir / PDF
  const [reporte, setReporte] = useState(false);   // reporte de la jornada completa
  const [inicioSug, setInicioSug] = useState(null);   // { Hora, Motivo } del turno que sigue

  // La hoja NO se abre a mano: la abre el primer descongelado del día. Es la cabecera del
  // formulario de papel (hora, encargado, personas), y pedirla antes de que haya algo que bajar
  // obligaba a entender un paso que no significa nada por sí solo.
  const hojaAbierta = hojas.find(h => h.Estatus === "Abierta") || null;

  const fetchHojas = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch(`${API}/hojas?fecha=${fecha}`, { headers: authHeader() });
      const data = await leerJSON(res);
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setHojas(Array.isArray(data) ? data : []);
      setError("");
    } catch (e) {
      setHojas([]);
      setError(e.message || "No se pudo conectar con el servidor");
    } finally { setCargando(false); }
  }, [fecha]);

  // El saldo al piso se recarga con cada cambio que mueve inventario: bajar 200 kg tiene que dejar
  // 200 kg menos disponibles en el acto.
  const fetchSaldo = useCallback(async () => {
    try {
      const [rs, rr] = await Promise.all([
        fetch(`${API}/saldo?bodega=DESCONGELADO&hasta=${fecha}`, { headers: authHeader() }),
        fetch(`${API}/resumen?bodega=DESCONGELADO&fecha=${fecha}`, { headers: authHeader() }),
      ]);
      const data = await leerJSON(rs);
      setSaldo(Array.isArray(data) ? data : []);
      setResumen(rr.ok ? await leerJSON(rr) : null);
      const ra = await fetch(`${API}/auxiliares?bodega=DESCONGELADO&fecha=${fecha}`, { headers: authHeader() });
      const aux = await leerJSON(ra);
      setAuxiliares(Array.isArray(aux) ? aux : []);
    } catch { setSaldo([]); setResumen(null); setAuxiliares([]); }
  }, [fecha]);

  useEffect(() => { fetchHojas(); fetchSaldo(); }, [fetchHojas, fetchSaldo]);

  useEffect(() => {
    const h = { headers: authHeader() };
    // Los destinos son las bodegas virtuales que llevan inventario al piso. La propia bodega de la
    // hoja se quita: mandarse producto a uno mismo no es un traslado.
    fetch(`${API}/bodegas`, h).then(leerJSON)
      .then(d => { if (Array.isArray(d)) setDestinos(d.filter(b => b.Codigo !== "DESCONGELADO")); });
    fetch("/api/empleados", h).then(leerJSON).then(d => Array.isArray(d) && setEmpleados(d.filter(e => e.Estado === "Activo")));
  }, []);

  // selId se marca ANTES de pedir el detalle, no después: es lo que corta el ciclo del efecto de
  // más abajo. Si se marcara al recibir la respuesta, una hoja que no carga dejaría selId en null y
  // el efecto volvería a pedirla en cada render, para siempre.
  const abrirDetalle = useCallback(async (id) => {
    setSelId(id);
    const res = await fetch(`${API}/hojas/${id}`, { headers: authHeader() });
    const data = await leerJSON(res);
    if (!res.ok) { setSel(null); setError(data.error || "No se pudo abrir la hoja"); return; }
    setSel(data);
  }, []);

  // Con una sola hoja en la jornada —  que es el caso normal—  se abre sola. Obligar a hacer clic en
  // una tabla de una fila para ver el trabajo del día era un paso sin contenido.
  useEffect(() => {
    if (hojas.length === 1 && selId !== hojas[0].HojaId) abrirDetalle(hojas[0].HojaId);
    if (hojas.length === 0 && selId !== null) { setSel(null); setSelId(null); }
  }, [hojas, selId, abrirDetalle]);

  const post = async (url, body, metodo = "POST") => {
    const res = await fetch(url, {
      method: metodo,
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(body),
    });
    const data = await leerJSON(res);
    if (!res.ok) { await mostrarAlerta(data.error || `Error ${res.status}`); return null; }
    return data;
  };

  const recargar = async (id) => {
    await Promise.all([fetchHojas(), fetchSaldo()]);
    if (id) await abrirDetalle(id);
  };

  // La hoja del día la abre el PRIMER movimiento, sea descongelar o devolver. Devuelve su id, o
  // null si no se pudo abrir (el modal se queda como está y el operador no pierde lo capturado).
  const asegurarHoja = async (cabecera) => {
    if (hojaAbierta?.HojaId) return hojaAbierta.HojaId;
    const out = await post(`${API}/hojas`, {
      FechaProduccion: fecha, BodegaCodigo: "DESCONGELADO", Propiedad: "OROPSA",
      Encargado: cabecera?.Encargado,
      HoraInicio: cabecera?.HoraInicio ? `${fecha} ${cabecera.HoraInicio}:00` : null,
    });
    return out ? out.HojaId : null;
  };

  // Llenar un termo: UN viaje al servidor con todo lo marcado. Si algo falla, el modal se queda abierto
  // con lo capturado para corregirlo en su sitio.
  const confirmarTermo = async (datos, cabecera) => {
    const hojaId = await asegurarHoja(cabecera);
    if (!hojaId) return;
    const out = await post(`${API}/hojas/${hojaId}/termo`, datos);
    if (!out) return;
    setUltimoDestino(datos.BodegaDestino);
    setMarcadas({});
    setModal(null);
    await recargar(hojaId);
  };

  // Devolver: se pregunta primero QUÉ cajas despachó esa remisión y siguen al piso. No hace falta
  // que exista una hoja para consultarlo — la hoja se abre al confirmar.
  const abrirDevolver = async (remisionId, folio) => {
    const res = await fetch(`${API}/devolvibles?remision=${remisionId}&bodega=DESCONGELADO`, { headers: authHeader() });
    const data = await leerJSON(res);
    if (!res.ok) { await mostrarAlerta(data.error || "No se pudo leer la remisión"); return; }
    setDevol({ titulo: folio || `Remisión ${remisionId}`, datos: data });
  };

  const confirmarDevolucion = async (masters, motivo, cabecera) => {
    const hojaId = await asegurarHoja(cabecera);
    if (!hojaId) return;
    const out = await post(`${API}/hojas/${hojaId}/devolver`, { Motivo: motivo, Masters: masters });
    if (!out) return;
    setDevol(null);
    await recargar(hojaId);
    await mostrarAlerta(
      `Regresaron ${out.Masters} caja${out.Masters !== 1 ? "s" : ""} (${fmtNum(out.KgDevuelto)} kg) en el polín ` +
      `${out.Polin}. Bodega tiene que ubicarlo: aparece sin posición.`, "exito");
  };

  const corregirTermo = async (id, cambios) => {
    if (!await post(`${API}/termo/${id}`, cambios, "PUT")) return false;
    await recargar(sel.HojaId);
    return true;
  };

  const borrarTermo = async (t) => {
    const cuantos = t.lineas.length;
    if (!(await pedirConfirmacion(`¿Quitar el ${esCanasta(t.numero) ? "la canasta" : `termo ${t.numero || ""}`}? ` +
      `${cuantos === 1 ? "Su lote vuelve" : `Sus ${cuantos} lotes vuelven`} al inventario al piso.`))) return;
    const res = await fetch(`${API}/termo/${t.id}`, { method: "DELETE", headers: authHeader() });
    const data = await leerJSON(res);
    if (!res.ok) { await mostrarAlerta(data.error || "No se pudo quitar"); return; }
    await recargar(sel.HojaId);
  };

  const borrarRenglon = async (id) => {
    if (!(await pedirConfirmacion("¿Quitar este renglón? Lo que había bajado regresa al inventario al piso."))) return;
    const res = await fetch(`${API}/renglon/${id}`, { method: "DELETE", headers: authHeader() });
    const data = await leerJSON(res);
    if (!res.ok) { await mostrarAlerta(data.error || "No se pudo quitar"); return; }
    await recargar(sel.HojaId);
  };

  // Al cerrar se vuelve a preguntar quién pasó por el área: desde que se cargó la pantalla pudo
  // haber llegado gente, y el conteo tiene que ser el del turno completo.
  const abrirCierre = () => setCierre(true);

  // La hora de fin viaja como HH:MM: el servidor la pega al día en que EMPEZÓ la hoja y, si queda
  // antes del inicio, al siguiente. Pegarla aquí a la fecha de la jornada rompía los turnos de noche.
  useEffect(() => {
    let vigente = true;
    fetch(`${API}/inicio-sugerido?bodega=DESCONGELADO&fecha=${fecha}`, { headers: authHeader() })
      .then(leerJSON).then(d => { if (vigente) setInicioSug(d && d.Hora ? d : null); })
      .catch(() => { if (vigente) setInicioSug(null); });
    return () => { vigente = false; };
  }, [fecha, hojas]);

  const cerrarHoja = async ({ HoraFin, HoraInicio }) => {
    const out = await post(`${API}/hojas/${sel.HojaId}/cerrar`,
      { HoraFin: HoraFin || horaGT(), ...(HoraInicio ? { HoraInicio } : {}) });
    if (!out) return;
    setCierre(false);
    await recargar(sel.HojaId);
    // Cerrar es el momento de sacar el papel: la vista previa se abre sola, ya con la merma escrita y
    // el rendimiento, lista para imprimir o guardar como PDF.
    setImprimir(true);
  };

  const reabrirHoja = async () => {
    if (!(await pedirConfirmacion("Se va a reabrir la hoja y borrar la merma calculada. Los renglones capturados se conservan."))) return;
    if (!await post(`${API}/hojas/${sel.HojaId}/reabrir`, {})) return;
    await recargar(sel.HojaId);
  };


  const cabecera = useMemo(() => {
    if (!sel) return "";
    return [fmtDia(sel.FechaProduccion), sel.Propiedad, sel.NombreEncargado || sel.Encargado,
            sel.HoraInicio ? `inicio ${sel.HoraInicio.slice(11)}` : null,
            sel.HoraFin ? `fin ${sel.HoraFin.slice(11)}` : null].filter(Boolean).join(" · ");
  }, [sel]);

  return (
    <div className="space-y-4">
      {aviso && <AvisoModal {...aviso} onCerrar={() => cerrar(true)} onCancelar={() => cerrar(false)} />}
      {/* El key ata el estado del modal al lote que se está bajando: abrir otro no puede heredar
          los masters ni los destinos del anterior. */}
      {modal && (
        <ModalTermo seleccion={modal.seleccion} recipienteInicial={modal.recipiente} inicioSugerido={inicioSug}
          hojaAbierta={hojaAbierta} destinos={destinos} destinoSugerido={ultimoDestino}
          empleados={empleados} auxiliares={auxiliares}
          onConfirmar={confirmarTermo} onCerrar={() => setModal(null)} />
      )}
      {reporte && <ReporteDescongeladoModal fecha={fecha} onCerrar={() => setReporte(false)} />}
      {imprimir && sel && (
        <HojaDescongeladoModal hoja={sel} filas={filasDeHoja(sel)} onCerrar={() => setImprimir(false)} />
      )}
      {cierre && sel && (
        <ModalCerrarHoja hoja={sel}
          onConfirmar={cerrarHoja} onCerrar={() => setCierre(false)} />
      )}
      {devol && (
        <ModalDevolver key={devol.titulo} titulo={devol.titulo} datos={devol.datos} inicioSugerido={inicioSug}
          hojaAbierta={hojaAbierta} empleados={empleados} auxiliares={auxiliares}
          onConfirmar={confirmarDevolucion} onCerrar={() => setDevol(null)} />
      )}

      {/* Barra superior */}
      <div className="bg-white border border-gray-300 rounded-lg px-4 py-3 flex flex-wrap items-center gap-3">
        <h1 className="font-bold text-gray-800">Descongelado de Materia Prima</h1>
        <div className="flex items-center gap-2 ml-2">
          <label className="text-sm font-semibold text-gray-600">Jornada</label>
          <input type="date" value={fecha} onChange={e => { setFecha(e.target.value); setSel(null); setSelId(null); }}
            className="border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>
        <button onClick={() => { fetchHojas(); fetchSaldo(); }}
          className="border border-gray-300 rounded px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50">
          Actualizar
        </button>
        {/* El reporte es del DÍA, no de una hoja: por eso vive en la barra de la jornada. */}
        <button onClick={() => setReporte(true)}
          className="border border-blue-300 text-blue-700 rounded px-3 py-1.5 text-xs font-semibold hover:bg-blue-50">
          Reporte del día
        </button>
        {hojaAbierta && (
          <span className="ml-auto text-xs text-gray-500">
            Hoja abierta <b className="font-mono">#{hojaAbierta.HojaId}</b>
            {hojaAbierta.NombreEncargado ? ` · ${hojaAbierta.NombreEncargado}` : ""}
          </span>
        )}
      </div>

      {error && <div className="bg-red-50 border border-red-300 text-red-700 text-sm px-4 py-2 rounded">⚠ {error}</div>}

      <InventarioPiso saldo={saldo} resumen={resumen} puedeCrear={puedeCrear}
        marcadas={marcadas} setMarcadas={setMarcadas}
        onLlenar={(seleccion, recipiente) => setModal({ seleccion, recipiente })}
        onDevolver={abrirDevolver} />

      {/* Con más de una hoja (OROPSA y maquila no se mezclan) hay que escoger cuál se ve. Con una
          sola no se dibuja nada: ya está abierta abajo. */}
      {hojas.length > 1 && (
        <div className="bg-white border border-gray-300 rounded-lg px-4 py-2 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-gray-500 uppercase mr-1">Hojas de la jornada</span>
          {hojas.map(h => (
            <button key={h.HojaId} onClick={() => abrirDetalle(h.HojaId)}
              className={`rounded px-3 py-1 text-xs font-semibold border ${
                selId === h.HojaId ? "bg-blue-600 text-white border-blue-600"
                                   : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
              #{h.HojaId} · {h.NombreEncargado || h.Encargado || h.Propiedad}
              {h.HoraInicio ? ` · ${h.HoraInicio.slice(11)}–${h.HoraFin ? h.HoraFin.slice(11) : "…"}` : ""}
              {" · "}{fmtNum(h.KgDescongelado)} kg
              <span className={`ml-1.5 font-normal ${h.Estatus === "Abierta" ? "text-green-500" : "opacity-60"}`}>
                {h.Estatus}
              </span>
            </button>
          ))}
        </div>
      )}

      {cargando && hojas.length === 0 && (
        <div className="bg-white border border-gray-300 rounded-lg px-4 py-8 text-center text-gray-400 text-sm">Cargando…</div>
      )}
      {!cargando && hojas.length === 0 && (
        <div className="bg-white border border-gray-300 rounded-lg px-4 py-8 text-center text-gray-400 text-sm">
          Sin hojas de descongelado el {fmtDia(fecha)}. La hoja se abre sola al descongelar el primer master.
        </div>
      )}

      {/* La hoja */}
      {sel && (
        <div className="space-y-3">
          <div className="bg-gray-800 text-white rounded-lg px-4 py-3 flex flex-wrap items-center gap-4">
            <div>
              <h2 className="font-bold">Hoja #{sel.HojaId}</h2>
              <p className="text-gray-300 text-xs mt-0.5">{cabecera}</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => setImprimir(true)}
                title={sel.Estatus === "Cerrada" ? "Imprimir o guardar como PDF" : "Se imprime como borrador: la hoja sigue abierta"}
                className="border border-gray-500 rounded px-4 py-1.5 text-sm font-semibold hover:bg-gray-700">
                Imprimir
              </button>
              {sel.Estatus === "Abierta" && puedeCerrar && (
                <button onClick={abrirCierre}
                  className="bg-green-600 rounded px-4 py-1.5 text-sm font-semibold hover:bg-green-700">
                  Cerrar hoja
                </button>
              )}
              {sel.Estatus === "Cerrada" && puedeCerrar && (
                <button onClick={reabrirHoja}
                  className="bg-amber-600 rounded px-4 py-1.5 text-sm font-semibold hover:bg-amber-700">
                  Reabrir
                </button>
              )}
            </div>
          </div>

          <div className="bg-white border border-gray-300 rounded-lg px-4 py-2.5">
            <ResumenAuxiliares datos={sel.Auxiliares} />
          </div>
          <Cuadre hoja={sel} />
          <TablaDescongelado hoja={sel} destinos={destinos}
            puedeEditar={sel.Estatus === "Abierta" && puedeEditar}
            puedeBorrar={sel.Estatus === "Abierta" && puedeBorrar}
            onCorregirTermo={corregirTermo} onBorrarTermo={borrarTermo} onBorrar={borrarRenglon} />
          <SeccionDevoluciones hoja={sel}
            puedeBorrar={sel.Estatus === "Abierta" && puedeBorrar} onBorrar={borrarRenglon} />
        </div>
      )}
    </div>
  );
}
