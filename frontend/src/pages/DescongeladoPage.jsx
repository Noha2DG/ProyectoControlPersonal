// Descongelado de Materia Prima — la versión en pantalla 
// compararlos después. Acá el sistema resta, así que pedir la misma línea dos veces (una para
// declararla y otra para buscarla en un combo y ponerle peso y destino) era trabajo que solo
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
import { LB_POR_KG } from "../utils/destajo.js";
import { authHeader, usePuede } from "../context/AuthContext.jsx";
import { useAviso } from "../hooks/useAviso.js";
import AvisoModal from "../components/AvisoModal.jsx";
import EmpleadoAutocomplete from "../components/EmpleadoAutocomplete.jsx";
import HojaDescongeladoModal, { origenDe } from "../components/HojaDescongeladoModal.jsx";
import ReporteDescongeladoModal from "../components/ReporteDescongeladoModal.jsx";
import InventarioDescongeladoModal, { entregaDe } from "../components/InventarioDescongeladoModal.jsx";
import PesarPorTermo, { termosDeHoja, fueraDeRango, pctDif, textoPct, RANGO } from "../components/PesarPorTermo.jsx";

// Columna Dif. de la tabla de la hoja: en KILOS, pesado − declarado (usuario, 11 nov 2026; antes %).
// El % sigue en el title y es el que decide si el termo está fuera de rango.
const textoKg = (kg) => `${kg > 0.004 ? "+" : kg < -0.004 ? "−" : ""}${fmtNum(Math.abs(kg))}`;

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

/* ── Modal: abrir la hoja del turno ───────────────────────────────── */
// La hoja se abre PRIMERO, a mano, con el encargado y la hora de inicio, y después se va llenando
// con los lotes que se descongelan en el turno (usuario, 26 oct 2026). Antes la abría sola lo
// primero que se descongelaba, con la cabecera metida en ese modal.
// Sin hoja abierta no se puede descongelar.
//
// Al abrir se pide SOLO quién es el encargado y a qué hora arrancó. Cuántas personas trabajaron se
// cuenta al CERRAR: al abrir todavía no ha llegado todo el turno, y el número que se tomaba acá era
// siempre el de los primeros que marcaron.
//
// El encargado se ESCOGE de quienes marcaron en el área, no se teclea: en el teléfono escribir un
// código de empleado es una errata segura, y la lista ya está en la pantalla. Si el encargado
// todavía no marcó —  o no marca en esa área—, "Otro empleado" abre el buscador de siempre.
function ModalAbrirHoja({ fecha, empleados, auxiliares, inicioSugerido, onConfirmar, onCerrar }) {
  // El inicio arranca en el inicio real del turno (cierre de la hoja anterior o primer marcaje del
  // área), no en la hora en que se abre en el sistema.
  const [cab, setCab] = useState({ Encargado: "", HoraInicio: inicioSugerido?.Hora || horaGT() });
  const [guardando, setGuardando] = useState(false);
  const listo = cab.Encargado && /^\d{2}:\d{2}$/.test(cab.HoraInicio);

  const confirmar = async () => {
    setGuardando(true);
    try { await onConfirmar(cab); } finally { setGuardando(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg min-w-0 flex flex-col max-h-[92vh]">
        <div className="px-5 py-3 border-b flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-bold text-gray-800">Abrir hoja de descongelado</h2>
            <p className="text-xs text-gray-500 mt-0.5">Jornada {fmtDia(fecha)} · la cabecera del formulario de papel</p>
          </div>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">
          <CabeceraNuevaHoja cab={cab} setCab={setCab} empleados={empleados} auxiliares={auxiliares} inicioSugerido={inicioSugerido} />
        </div>
        <div className="px-5 py-3 border-t flex items-center gap-3 shrink-0">
          <button onClick={onCerrar}
            className="ml-auto border border-gray-300 rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={!listo || guardando}
            className="whitespace-nowrap bg-blue-600 hover:bg-blue-700 text-white rounded px-5 py-1.5 text-sm font-semibold disabled:opacity-40">
            {guardando ? "Abriendo…" : "Abrir hoja"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CabeceraNuevaHoja({ cab, setCab, empleados, auxiliares, inicioSugerido }) {
  const [otro, setOtro] = useState(false);
  const buscar = otro || auxiliares.length === 0;

  return (
    <div>
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
              <span className="ml-auto text-xs tabular-nums font-semibold w-20 text-right whitespace-nowrap">{fmtHoras(a.Minutos)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// La lista del marcaje en la ventana de la hoja, cada uno con su casilla. Se cuentan los marcados.
function ElegirAuxiliares({ datos, cargando, marcado, onAlternar }) {
  if (!datos) return <span className="text-xs text-gray-400">{cargando ? "Contando…" : "—"}</span>;
  const elegidos = datos.lista.filter(marcado);
  const minutos = elegidos.reduce((t, a) => t + a.Minutos, 0);
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <span className="text-gray-600">Auxiliares de esta hoja</span>
        <b className="text-lg tabular-nums text-gray-900">{elegidos.length}</b>
        <span className="text-xs text-gray-400">de {datos.lista.length} que marcaron · {fmtHoras(minutos)}</span>
        {cargando && <span className="text-xs text-gray-400">actualizando…</span>}
      </div>
      <p className="text-xs text-gray-400 mt-0.5">
        de {datos.Desde.slice(11)} a {datos.Hasta.slice(11)}
        {datos.Hasta.slice(0, 10) !== datos.Desde.slice(0, 10) && " del día siguiente"}
        {" · sin contar al encargado · marque quiénes trabajaron en esta hoja"}
      </p>
      {datos.lista.length > 0 && (
        <div className="mt-2 border border-gray-200 rounded divide-y divide-gray-100 max-h-72 overflow-y-auto">
          {datos.lista.map(a => (
            <label key={a.Codigo} className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer ${marcado(a) ? "" : "bg-gray-50 text-gray-400"}`}>
              <input type="checkbox" checked={marcado(a)} onChange={() => onAlternar(a)} className="w-4 h-4 shrink-0" />
              <span className="truncate">{a.Nombre}</span>
              <span className="font-mono text-xs text-gray-400 shrink-0">{a.Codigo}</span>
              {a.EnOtraHoja && (
                <span className="shrink-0 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800"
                  title="El encargado de esa hoja ya lo contó al cerrarla">
                  va en la hoja #{a.EnOtraHoja}
                </span>
              )}
              <span className="ml-auto text-xs tabular-nums font-semibold w-20 text-right whitespace-nowrap shrink-0">
                {a.Desde}–{a.Hasta}
              </span>
              <span className="text-xs tabular-nums w-16 text-right whitespace-nowrap shrink-0">{fmtHoras(a.Minutos)}</span>
            </label>
          ))}
        </div>
      )}
      {datos.lista.length > 0 && elegidos.length === 0 && (
        <p className="text-xs text-red-700 mt-1">Marque al menos a una persona.</p>
      )}
    </div>
  );
}

/* ── Modal: cerrar la hoja ────────────────────────────────────────── */
// El cierre es cuando se sabe entero quién trabajó el turno. Las personas no se teclean: salen del
// marcaje en la ventana de la hoja. Pero el marcaje dice quién estuvo en el ÁREA, no en qué hoja, y
// con dos hojas abiertas a la vez (los dos turnos juntos, usuario 29 oct 2026) la misma gente caía en
// las dos: el encargado marca de la lista quiénes trabajaron en la suya. Quien ya va en otra hoja de
// la jornada llega sin marcar, con el aviso.
function ModalCerrarHoja({ hoja, onConfirmar, onCerrar }) {
  const [marca, setMarca] = useState({});   // Codigo → true/false; lo que no se tocó toma a.Elegido
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
  // Igual que salidaExcedida en el backend: se cierra con ganancia hasta +2 % de lo que entró.
  const tolerado = Number((hoja.KgEntrada * RANGO.arriba / 100).toFixed(2));
  const excedida = -merma > tolerado + 0.001;

  const lista = aux?.lista ?? [];
  const marcado = a => marca[a.Codigo] ?? a.Elegido;
  const elegidos = lista.filter(marcado);

  const confirmar = async () => {
    setGuardando(true);
    try {
      await onConfirmar({ HoraFin: horaFin, Auxiliares: elegidos.map(a => a.Codigo),
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

          <ElegirAuxiliares datos={aux} cargando={cargando} marcado={marcado}
            onAlternar={a => setMarca(m => ({ ...m, [a.Codigo]: !marcado(a) }))} />

          {/* La merma ya no se enseña al cerrar (usuario, 27 oct 2026): sin báscula, lo descongelado
              es lo declarado y la cuenta da cero. Solo se avisa si una hoja vieja no cuadra. */}
          {excedida ? (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              Salió más de lo que entró ({fmtNum(-merma)} kg de más, más del +{RANGO.arriba} % que se acepta): la hoja no cierra así.
              Revise los pesos de los termos antes de cerrar.
            </p>
          ) : merma < -0.004 && (
            <p className="text-xs text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2">
              Lo pesado salió {fmtNum(-merma)} kg arriba de lo declarado ({textoPct(pctDif(hoja.KgEntrada - merma, hoja.KgEntrada))}): se cierra con esa ganancia.
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t flex flex-wrap items-center gap-x-3 gap-y-2 shrink-0">
          <span className="text-xs text-gray-500 w-full">
            Cada turno cierra su propia hoja, con su encargado y la gente que trabajó en ella.
          </span>
          <button onClick={onCerrar}
            className="ml-auto shrink-0 border border-gray-300 rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={guardando || excedida || !aux || (lista.length > 0 && elegidos.length === 0)}
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
// Los kilos declarados se DERIVAN de los masters y no se teclean nunca: si se pudieran escribir
// habría dos verdades sobre el mismo peso y el cuadre del día dejaría de significar algo.
//
// Sirve para una remisión entera o para una línea suelta. En el primer caso el destino se pone una
// vez arriba y baja a todas las líneas, porque lo normal es que una remisión entera vaya al mismo
// lado; la que no, se corrige en su propia fila.
function fechaCorta(f) {
  const [a, m, d] = String(f).slice(0, 10).split("-");
  return `${d}-${m}-${a.slice(2)}`;
}

// Descongelar lo marcado del piso. No se llevan termos ni canastas. Lo declarado es masters × kg por
// master y no se teclea; lo pesado se anota por renglón y es opcional: vacío, sale lo declarado
// (usuario, 9 nov 2026). La diferencia es la merma de la hoja. Todo lo marcado va a un solo destino;
// las remisiones y los productos se pueden mezclar.
// Con varios lotes del mismo producto se puede UNIFICAR, como en Materia Prima: el encargado escoge
// uno de los lotes y todo llega al destino como ese lote. Por omisión cada lote conserva su código.
// Las clases de entero (C20, C26, P28…) cuentan como un mismo producto. Las demás reglas (misma
// finca, sin maquila, sin sifón ni genéricos) las revisa el servidor.
// Con dos hojas abiertas (los dos turnos juntos) se escoge a cuál va; arranca en la que se está viendo.
function ModalDescongelar({ seleccion, hojasAbiertas, hojaInicial, destinos, destinoSugerido, onConfirmar, onCerrar }) {
  const [destino, setDestino] = useState(destinoSugerido || "");
  const [hojaId, setHojaId] = useState(hojaInicial);
  const hoja = hojasAbiertas.find(h => h.HojaId === hojaId) || null;
  const [base, setBase] = useState("");   // lote en que se unifica; "" = cada lote con su código
  const [pesos, setPesos] = useState({}); // clave del renglón → kg pesados tecleados ("" = lo declarado)
  const [guardando, setGuardando] = useState(false);

  const lotes = [...new Set(seleccion.map(x => x.linea.Lote))];
  const clasesSel = [...new Set(seleccion.map(x => x.linea.Clase))];
  // El servidor manda el grupo de cada línea: con la misma regla con que rechaza, aquí no se ofrece.
  const mezcla = new Set(seleccion.map(x => x.linea.GrupoProducto ?? x.linea.Clase)).size > 1;
  const puedeUnificar = lotes.length > 1 && !mezcla;
  // Los lotes que pueden dar el código, el de más kilos primero (casi siempre es el que se usa).
  const candidatos = lotes
    .map(Lote => ({ Lote, kg: seleccion.filter(x => x.linea.Lote === Lote).reduce((s, x) => s + x.kg, 0) }))
    .sort((a, b) => b.kg - a.kg);
  const unificaEn = puedeUnificar && base ? base : null;
  // Unificado, todo toma la clase del renglón de más kilos de ese lote (igual que el servidor). Solo
  // se dice cuando hay clases mezcladas (C20 con C26), que es cuando cambia algo.
  const claseUnificada = unificaEn && clasesSel.length > 1
    ? [...seleccion].filter(x => x.linea.Lote === unificaEn).sort((a, b) => b.kg - a.kg)[0]?.linea.Clase
    : null;
  const kg = Number(seleccion.reduce((s, x) => s + x.kg, 0).toFixed(2));
  const masters = seleccion.reduce((s, x) => s + (x.masters ?? 0), 0);
  const pesadoDe = x => {
    const v = String(pesos[x.clave] ?? "").trim();
    return v === "" ? null : Number(v);
  };
  const malPesado = seleccion.some(x => { const p = pesadoDe(x); return p != null && !(p > 0); });
  const kgPesado = Number(seleccion.reduce((s, x) => s + (pesadoDe(x) ?? x.kg), 0).toFixed(2));
  const anotados = seleccion.filter(x => pesadoDe(x) != null).length;

  const confirmar = async () => {
    setGuardando(true);
    try {
      await onConfirmar({
        BodegaDestino: destino, BaseLote: unificaEn,
        lineas: seleccion.map(x => ({
          Lote: x.linea.Lote, Clase: x.linea.Clase, Talla: x.linea.Talla, RemisionId: x.linea.RemisionId,
          FechaLote: x.linea.FechaLote, KgPorMaster: x.linea.KgPorMaster, UM: "KG",
          ...(x.masters != null ? { Masters: x.masters } : { Peso: x.kg }),
          ...(pesadoDe(x) != null ? { PesoReal: pesadoDe(x) } : {}),
        })),
      }, hojaId);
    } finally { setGuardando(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl min-w-0 flex flex-col max-h-[92vh]">
        <div className="px-5 py-3 border-b flex items-center justify-between shrink-0">
          <h3 className="font-bold text-gray-800">Descongelar</h3>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-4">
          <div className="max-w-sm">
            <label className="block text-xs font-semibold text-gray-600 mb-1">Va a</label>
            <SelectorDestino destinos={destinos} value={destino} onChange={setDestino} vacio="Escoja la bodega…" />
          </div>

          <div className="border border-gray-200 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Lote</th>
                  <th className="px-3 py-2 text-left font-semibold">Producto</th>
                  <th className="px-3 py-2 text-left font-semibold">Talla</th>
                  <th className="px-3 py-2 text-left font-semibold">Remisión</th>
                  <th className="px-3 py-2 text-right font-semibold">Masters</th>
                  <th className="px-3 py-2 text-right font-semibold">Kg declarado</th>
                  <th className="px-3 py-2 text-right font-semibold">Kg pesado</th>
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
                    <td className="px-3 py-1 text-right">
                      <input type="number" inputMode="decimal" step="0.01" min="0"
                        value={pesos[x.clave] ?? ""} placeholder={fmtNum(x.kg)}
                        onChange={e => setPesos(p => ({ ...p, [x.clave]: e.target.value }))}
                        className={`w-24 border rounded px-2 py-1 text-right tabular-nums text-sm placeholder:text-gray-300
                          ${pesadoDe(x) != null && pesadoDe(x) > x.kg ? "border-amber-400 bg-amber-50" : "border-gray-300"}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2">
                <tr className="font-bold">
                  <td colSpan={4} className="px-3 py-2 text-right text-xs text-gray-600 uppercase">
                    {lotes.length} lote{lotes.length !== 1 ? "s" : ""}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{masters || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtNum(kg)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtNum(kgPesado)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-gray-400 -mt-2">
            Anote lo que marcó la báscula en cada renglón. Si lo deja vacío se toma lo declarado.
            {anotados > 0 && <> Diferencia: <b className={kg - kgPesado > 0.004 ? "text-amber-600" : "text-gray-600"}>{fmtNum(Number((kg - kgPesado).toFixed(2)))} kg</b>.</>}
            {seleccion.some(x => pesadoDe(x) != null && pesadoDe(x) > x.kg) &&
              <span className="text-amber-600"> Hay renglones que pesan más de lo declarado: revíselos, la hoja no cierra si sale más de lo que entró.</span>}
          </p>

          {puedeUnificar && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-gray-600">¿Con qué lote llega al destino?</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[{ Lote: "", kg: null }, ...candidatos].map(c => (
                  <label key={c.Lote || "-"}
                    className={`flex items-center gap-2.5 border rounded-lg px-3 py-2 cursor-pointer transition
                      ${base === c.Lote ? "border-blue-600 bg-blue-50" : "border-gray-200 hover:bg-gray-50"}`}>
                    <input type="radio" name="base-lote" checked={base === c.Lote} onChange={() => setBase(c.Lote)} className="w-4 h-4 shrink-0" />
                    {c.Lote ? (
                      <>
                        <span className="min-w-0 truncate text-sm">Unificar en <span className="font-mono font-bold">{c.Lote}</span></span>
                        <span className="ml-auto text-xs text-gray-500 tabular-nums whitespace-nowrap">{fmtNum(c.kg)} kg</span>
                      </>
                    ) : (
                      <span className="text-sm">Cada lote con su código <span className="text-gray-400">({lotes.length} lotes)</span></span>
                    )}
                  </label>
                ))}
              </div>
              <p className="text-xs text-gray-400">
                {unificaEn
                  ? <>Todo llega al destino como <b className="font-mono text-gray-600">{unificaEn}</b>
                      {claseUnificada && <> con la clase <b className="font-mono text-gray-600">{claseUnificada}</b></>}. En la hoja
                      queda de qué lote, clase y remisión salió cada parte. Solo lotes de la misma finca; maquila, sifón y genéricos no se unifican.</>
                  : "Cada lote llega al piso del destino con su código."}
              </p>
            </div>
          )}
          {lotes.length > 1 && mezcla && (
            <p className="text-xs text-gray-500">
              Van productos distintos ({clasesSel.join(", ")}): cada lote llega con su código. Solo se unifican lotes del mismo producto.
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t flex flex-wrap items-center gap-x-3 gap-y-2 shrink-0">
          {hojasAbiertas.length > 1 ? (
            <label className="text-xs text-gray-500 w-full sm:w-auto flex items-center gap-2">
              Se agrega a la hoja
              <select value={hojaId ?? ""} onChange={e => setHojaId(Number(e.target.value))}
                className="border border-gray-300 rounded px-2 py-1 text-xs font-semibold text-gray-800">
                {hojasAbiertas.map(h => (
                  <option key={h.HojaId} value={h.HojaId}>#{h.HojaId}{h.NombreEncargado ? ` · ${h.NombreEncargado}` : ""}</option>
                ))}
              </select>
            </label>
          ) : (
            <span className="text-xs text-gray-500 w-full sm:w-auto">
              Se agrega a la hoja <b>#{hoja?.HojaId}</b>{hoja?.NombreEncargado ? ` · ${hoja.NombreEncargado}` : ""}
            </span>
          )}
          <button onClick={onCerrar}
            className="ml-auto shrink-0 border border-gray-300 rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={!destino || !hoja || guardando || malPesado}
            className="shrink-0 whitespace-nowrap bg-blue-600 hover:bg-blue-700 text-white rounded px-5 py-1.5 text-sm font-semibold disabled:opacity-40">
            {guardando ? "Guardando…" : `Descongelar ${fmtNum(kgPesado)} kg`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Inventario al piso ───────────────────────────────────────────── */
// Lo que el área tiene y todavía no ha bajado. Entra cuando el área RECIBE los polines que le dejó
// bodega, o cuando bodega confirma la remisión; sale solo cuando se descongela. Nadie lo teclea ni lo
// arrastra de un día a otro.
//
// "Días al piso" cuenta desde que el producto ENTRÓ AL ÁREA, no desde la fecha del lote: hay lotes
// congelados del año pasado y su edad de producción no dice nada sobre si el área lo tiene parado.
// Cada línea con masters tiene "Pesar": abre el panel donde el lote se pesa termo por termo
// (PesarPorTermo, desde el 9 nov 2026). Lo que no se pesa sigue al piso.
//
// Ya no se devuelve a bodega desde aquí (usuario, 28 oct 2026): el botón "Devolver" de cada remisión
// se quitó por una inconsistencia en el proceso. Las devoluciones que ya estaban anotadas se siguen
// viendo en la hoja (SeccionDevoluciones).
const claveDeLinea = r => `${r.RemisionId ?? "-"}|${r.Lote}|${r.Clase}|${r.Talla}|${r.FechaLote ?? ""}`;

// `onAbrirHoja` llega solo cuando no hay hoja abierta y el usuario puede abrirla: en ese caso no se
// marca nada (puedeCrear viene en false) y la barra pide abrir la hoja primero.
// `porLlegarM`: masters que bodega escaneó para el área y no han llegado (ver PorEntregar, abajo).
function InventarioPiso({ saldo, porLlegarM = 0, resumen, puedeCrear, onPesar, onDescongelarKg, onAbrirHoja, onImprimir }) {
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
    if (!g) { g = { clave, Folio: r.FolioRemision, ConfirmadaEn: r.ConfirmadaEn, Estatus: r.EstatusRemision, lineas: [], Kg: 0, Masters: 0 }; grupos.push(g); }
    g.lineas.push(r); g.Kg += r.Kg; g.Masters += r.Masters || 0;
  }

  // Lo que viene contado en masters se pesa por termo (PesarPorTermo). Un ajuste sin masters, que
  // solo trae kilos, se descongela entero con el modal de antes.
  const conMasters = r => (r.Masters ?? 0) > 0;

  return (
    <section className="bg-white border border-gray-300 rounded-lg overflow-hidden">
      <header className="bg-gray-100 border-b border-gray-300 px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button onClick={() => setAbierto(a => !a)}
          className="text-gray-500 hover:text-gray-800 text-xs font-bold w-4">{abierto ? "▾" : "▸"}</button>
        <h3 className="font-bold text-sm text-gray-700">AL PISO</h3>
        <span className="text-xs text-gray-500">
          sin descongelar · {grupos.length} {grupos.length === 1 ? "remisión" : "remisiones"}
          {porLlegarM > 0 && <span className="text-amber-700"> · {porLlegarM} masters por entregar, aún en bodega</span>}
        </span>
        <span className="ml-auto flex items-baseline gap-4 text-sm">
          {resumen && resumen.IngresadoKg > 0 && (
            <span className="text-xs text-gray-500">
              Ingresó hoy <b className="font-mono tabular-nums text-gray-700">{fmtNum(resumen.IngresadoKg)} kg</b>
            </span>
          )}
          <span className="font-mono tabular-nums font-bold text-gray-800">
            {fmtNum(totalKg)} kg <span className="font-normal text-gray-500">· {fmtNum(totalKg * LB_POR_KG)} lb</span> {totalM > 0 && <span className="font-normal text-gray-500">· {totalM} masters</span>}
          </span>
        </span>
        {(saldo.length > 0 || porLlegarM > 0) && (
          <button onClick={onImprimir} title="Imprimir o guardar como PDF lo que está al piso, para contarlo"
            className="border border-blue-300 text-blue-700 bg-white rounded px-3 py-1 text-xs font-semibold hover:bg-blue-50">
            Imprimir
          </button>
        )}
      </header>

      {abierto && onAbrirHoja && saldo.length > 0 && (
        <div className="px-4 py-2 border-b bg-amber-50 border-amber-200 flex flex-wrap items-center gap-2">
          <span className="text-sm text-amber-900">Para descongelar, primero abra la hoja del turno con su encargado y hora de inicio.</span>
          <button onClick={onAbrirHoja}
            className="ml-auto bg-blue-600 text-white rounded px-4 py-1.5 text-xs font-semibold hover:bg-blue-700">
            Abrir hoja
          </button>
        </div>
      )}

      {abierto && puedeCrear && saldo.length > 0 && (
        <div className="px-4 py-2 border-b bg-white">
          <span className="text-xs text-gray-500">
            Use <b>Pesar</b> en el lote que va a descongelar: se anota termo por termo, con lo que marca la báscula, y cada termo llega al destino al registrarlo.
          </span>
        </div>
      )}

      {abierto && (
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Lote</th>
                <th className="px-3 py-2 text-left font-semibold">Producto</th>
                <th className="px-3 py-2 text-left font-semibold">Talla</th>
                <th className="px-3 py-2 text-left font-semibold">Entró</th>
                <th className="px-3 py-2 text-right font-semibold">Días</th>
                <th className="px-3 py-2 text-right font-semibold">Masters</th>
                <th className="px-3 py-2 text-right font-semibold">Kg</th>
                {/* Las libras se derivan de los kilos (usuario, 29 oct 2026): no se capturan. */}
                <th className="px-3 py-2 text-right font-semibold">Lb</th>
                {puedeCrear && <th className="px-3 py-2 w-24"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {saldo.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400 text-xs">
                  Nada al piso. El producto aparece aquí cuando el área lo recibe o bodega confirma la remisión.</td></tr>
              ) : grupos.map(g => {
                return (
                  <Fragment key={g.clave}>
                    <tr className="bg-blue-50 border-t border-blue-200">
                      <td colSpan={5} className="px-3 py-1.5 font-semibold text-blue-900 text-xs">
                        {g.Folio || "Sin remisión (ajuste)"}
                        {g.ConfirmadaEn && <span className="font-normal text-blue-600 ml-2">confirmada {g.ConfirmadaEn}</span>}
                        {/* Lo que el área recibió de una remisión que bodega todavía no confirma. */}
                        {g.Estatus === "Borrador" && <span className="font-normal text-blue-600 ml-2">recibido por el área · bodega aún no la confirma</span>}
                        <span className="font-normal text-blue-600 ml-2">· {g.lineas.length} línea{g.lineas.length !== 1 ? "s" : ""}</span>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-xs font-bold text-blue-900">{g.Masters || ""}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-xs font-bold text-blue-900">{fmtNum(g.Kg)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-xs font-bold text-blue-900">{fmtNum(g.Kg * LB_POR_KG)}</td>
                      {puedeCrear && <td></td>}
                    </tr>
                    {g.lineas.map(r => {
                      const k = claveDeLinea(r);
                      return (
                        <tr key={k} className="hover:bg-gray-50">
                          <td className="px-3 py-1.5 pl-6 font-mono text-xs">
                            {r.Lote}
                            {r.FechaLote && <span className="block font-sans text-[11px] text-gray-400">prod. {fechaCorta(r.FechaLote)}</span>}
                          </td>
                          <td className="px-3 py-1.5 text-xs"><span className="font-mono text-gray-500">{r.Clase}</span> {r.DescripcionClase}</td>
                          <td className="px-3 py-1.5 text-xs">{r.DescripcionTalla}</td>
                          <td className="px-3 py-1.5 text-xs text-gray-500">
                            {fmtDia(r.FechaIngreso)}
                            {/* Quién lo pasó al piso: el área al recibir (verde) o bodega al confirmar (envío directo). */}
                            {entregaDe(r) && (
                              <span className={`block text-[11px] ${r.RecibidosM > 0 ? "text-green-700" : "text-blue-600"}`}>
                                {entregaDe(r)}
                              </span>
                            )}
                          </td>
                          <td className={`px-3 py-1.5 text-right tabular-nums text-xs ${r.DiasAlPiso > 2 ? "text-amber-600 font-bold" : "text-gray-500"}`}>
                            {r.DiasAlPiso ?? "—"}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{conMasters(r) ? r.Masters : ""}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(r.Kg)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{fmtNum(r.Kg * LB_POR_KG)}</td>
                          {puedeCrear && (
                            <td className="px-3 py-1 text-right">
                              {conMasters(r) ? (
                                <button onClick={() => onPesar(r)} title="Pesar este lote termo por termo"
                                  className="bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-1.5 text-xs font-semibold">
                                  Pesar
                                </button>
                              ) : (
                                <button onClick={() => onDescongelarKg([{ clave: k, linea: r, masters: null, kg: r.Kg }])}
                                  title="Sin masters: se descongelan sus kilos"
                                  className="border border-blue-300 text-blue-700 rounded px-3 py-1.5 text-xs font-semibold hover:bg-blue-50">
                                  Descongelar
                                </button>
                              )}
                            </td>
                          )}
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

/* ── Por entregar: lo que bodega dejó y el área recibe ────────────── */
// Lo que bodega ya escaneó para el área y todavía no confirma (usuario, 28 oct 2026). Confirmar es la
// entrega física, pero de madrugada Cindy no está cuando Descongelado empieza: por eso el área marca
// lo que le llegó y usa "Recibir"; eso entra al piso de arriba y ya se puede trabajar. Lo que no se
// marca sigue "aún en bodega" hasta que bodega lo quite de la remisión o la confirme.
//
// Renglón por renglón (un lote y talla de un polín), no el polín entero (usuario, 29 oct 2026): B0357
// trae 35 de 71/90 y 1 de 51/60, y ese master no tiene por qué entrar al piso con los demás. Tocar el
// código del polín marca todos sus renglones de una vez. No hay lector: el código está impreso en su
// hoja (B0349). Un renglón recibido por error se deshace mientras no se haya trabajado.
//
// Lo ya recibido no se queda aquí (usuario, 29 oct 2026): ya está arriba, en el piso, y repetirlo
// llenaba la sección de renglones verdes. Se esconde, con "ver recibidos" para deshacer un error.
//
// Cuántos acepta (2 nov 2026, RS-0112): bodega entrega el polín entero y el área se lo lleva, pero según
// el plan usa solo una parte. Al marcar un renglón se escribe cuántos masters acepta (de entrada, todos);
// el resto queda "por regresar a bodega" y bodega lo escanea de vuelta en un polín de devolución. Lo
// por regresar sigue aquí —  aun con la remisión confirmada—  hasta que regresa, y se puede aceptar si
// el plan cambia.
function PorEntregar({ filas, puedeRecibir, puedeDeshacer, onRecibir, onDeshacer }) {
  const [marcados, setMarcados] = useState({});   // claveRenglon → masters que acepta (texto del campo)
  const [verRecibidos, setVerRecibidos] = useState(false);
  const nRecibidos = filas.filter(r => r.Recibido).length;
  const visibles = verRecibidos ? filas : filas.filter(r => !r.Recibido);

  // Remisión → polín → renglones. Los conteos de cada remisión salen de todas sus filas, no solo
  // de las que se ven.
  const cuenta = {};
  for (const r of filas) {
    const c = cuenta[r.RemisionId] ??= { enBodega: new Set(), todos: new Set(), porRegresarM: 0 };
    c.todos.add(r.PalletId);
    if (!r.Recibido && !r.PorRegresar) c.enBodega.add(r.PalletId);
    if (r.PorRegresar) c.porRegresarM += r.Masters || 0;
  }
  const remisiones = [];
  for (const r of visibles) {
    let rem = remisiones.find(x => x.RemisionId === r.RemisionId);
    if (!rem) { rem = { RemisionId: r.RemisionId, Folio: r.FolioRemision, Estatus: r.EstatusRemision, polines: [] }; remisiones.push(rem); }
    let p = rem.polines.find(x => x.PalletId === r.PalletId);
    if (!p) { p = { PalletId: r.PalletId, Codigo: r.PalletCodigo, lineas: [], Masters: 0 }; rem.polines.push(p); }
    p.lineas.push(r); p.Masters += r.Masters || 0;
  }
  if (!filas.length) return null;

  // Recibida, por regresar o aún en bodega: cada estado es su propia fila (ver porEntregar).
  const clave = l => `${l.RemisionId}|${l.PalletId}|${l.Lote}|${l.Clase}|${l.Talla}|${l.FechaLote ?? ""}|${l.PorRegresar ? "r" : "b"}`;
  const alternar = l => setMarcados(m => {
    const n = { ...m }; const k = clave(l);
    if (n[k] != null) delete n[k]; else n[k] = String(l.Masters);
    return n;
  });
  // El polín entero: lo que sigue aún en bodega (no lo que ya quedó por regresar). Si ya está todo
  // marcado lo desmarca, si no lo marca completo.
  const alternarPolin = p => setMarcados(m => {
    const pend = p.lineas.filter(l => !l.Recibido && !l.PorRegresar);
    const n = { ...m }; const todos = pend.every(l => n[clave(l)] != null);
    for (const l of pend) { if (todos) delete n[clave(l)]; else n[clave(l)] = String(l.Masters); }
    return n;
  });
  // Lo que acepta de un renglón marcado: un entero de 0 a lo que trae; cualquier otra cosa es inválida.
  const aceptaDe = l => {
    const t = String(marcados[clave(l)] ?? "").trim();
    const v = Number(t);
    return t !== "" && Number.isInteger(v) && v >= 0 && v <= (l.Masters || 0) ? v : null;
  };

  return (
    <section className="bg-white border border-amber-300 rounded-lg overflow-hidden">
      <header className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-bold text-sm text-amber-900">POR ENTREGAR</h3>
        <span className="text-xs text-amber-800">
          bodega lo escaneó para el área. Marque lo que va a usar, escriba cuántos masters y use <b>Recibir</b>; lo demás regresa a bodega.
        </span>
        {nRecibidos > 0 && (
          <button onClick={() => setVerRecibidos(v => !v)}
            className="ml-auto text-xs font-semibold text-amber-800 hover:underline whitespace-nowrap">
            {verRecibidos ? "ocultar recibidos" : `ver recibidos (${nRecibidos})`}
          </button>
        )}
      </header>
      {!remisiones.length && (
        <p className="px-4 py-3 text-xs text-gray-500">
          Todo lo que bodega dejó ya está en su piso, arriba. Falta que bodega confirme la remisión.
        </p>
      )}
      {remisiones.map(rem => {
        const lineas = rem.polines.flatMap(p => p.lineas);
        const marc = lineas.filter(l => !l.Recibido && marcados[clave(l)] != null);
        const invalida = marc.some(l => aceptaDe(l) == null);
        const sel = marc.map(l => ({ ...l, Acepta: aceptaDe(l) ?? 0 }));
        const mAcepta = sel.reduce((s, l) => s + l.Acepta, 0);
        const kgAcepta = sel.reduce((s, l) => s + l.Acepta * (l.KgPorMaster || 0), 0);
        const mRegresa = sel.reduce((s, l) => s + (l.Masters - l.Acepta), 0);
        const c = cuenta[rem.RemisionId];
        const enBodega = c.enBodega.size;
        const recibidos = c.todos.size - enBodega;
        const confirmada = rem.Estatus === "Confirmada";
        return (
          <div key={rem.RemisionId} className="border-t border-amber-100 first:border-t-0">
            <div className="px-4 py-2 flex flex-wrap items-center gap-2 bg-white">
              <span className="text-sm font-semibold text-gray-800">{rem.Folio}</span>
              {confirmada
                ? <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">confirmada</span>
                : <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">sin confirmar</span>}
              <span className="text-xs text-gray-500">
                {!confirmada && `${enBodega} polín${enBodega !== 1 ? "es" : ""} con algo aún en bodega`}
                {!confirmada && recibidos > 0 && ` · ${recibidos} recibido${recibidos !== 1 ? "s" : ""}`}
                {c.porRegresarM > 0 && <span className="text-orange-700">{!confirmada && " · "}{c.porRegresarM} master{c.porRegresarM !== 1 ? "s" : ""} por regresar a bodega</span>}
              </span>
              {puedeRecibir && marc.length > 0 && (
                <button onClick={async () => { if (await onRecibir(rem, sel)) setMarcados({}); }} disabled={invalida}
                  className="ml-auto bg-green-600 text-white rounded px-4 py-1.5 text-xs font-semibold hover:bg-green-700 disabled:opacity-40">
                  Recibir {mAcepta} masters · {fmtNum(kgAcepta)} kg{mRegresa > 0 ? ` · ${mRegresa} ${mRegresa === 1 ? "regresa" : "regresan"}` : ""}
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              {/* Ancho fijo para que las columnas de una remisión calcen con las de la siguiente. El
                  ancho mínimo deja lugar a Producto (la única columna libre): con menos, en la tablet
                  se quedaba en cero y su título salía letra por letra. Más angosto, se desliza. */}
              <table className="w-full text-sm table-fixed min-w-[760px]">
                <colgroup>
                  <col className="w-10" /><col className="w-20" /><col className="w-32" /><col />
                  <col className="w-20" /><col className="w-24" /><col className="w-20" /><col className="w-36" />
                </colgroup>
                <thead className="bg-gray-50 text-[11px] text-gray-500 uppercase whitespace-nowrap">
                  <tr>
                    <th className="px-3 py-1.5"></th>
                    <th className="px-3 py-1.5 text-left font-semibold">Polín</th>
                    <th className="px-3 py-1.5 text-left font-semibold">Lote</th>
                    <th className="px-3 py-1.5 text-left font-semibold">Producto</th>
                    <th className="px-3 py-1.5 text-left font-semibold">Talla</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Masters</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Kg</th>
                    <th className="px-3 py-1.5 text-left font-semibold">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {rem.polines.map(p => {
                    const n = p.lineas.length;
                    const hayPendientes = puedeRecibir && p.lineas.some(l => !l.Recibido && !l.PorRegresar);
                    // Qué trae mezclado: B0357 es un solo lote en dos tallas, B0307 dos lotes de una talla.
                    const nLotes = new Set(p.lineas.map(l => l.Lote)).size;
                    const nTallas = new Set(p.lineas.map(l => l.DescripcionTalla)).size;
                    const mezcla = [nLotes > 1 && `${nLotes} lotes`, nTallas > 1 && `${nTallas} tallas`].filter(Boolean).join(", ");
                    return p.lineas.map((l, i) => {
                      const puede = !l.Recibido && puedeRecibir;
                      const marcado = puede && marcados[clave(l)] != null;
                      const acepta = marcado ? aceptaDe(l) : null;
                      return (
                        <tr key={`${p.PalletId}-${i}`}
                          onClick={() => puede && alternar(l)}
                          className={`${i === 0 ? "border-t border-gray-200" : "border-t border-dashed border-gray-100"} ${puede ? "cursor-pointer" : ""}
                            ${l.Recibido ? "bg-green-50/40" : marcado ? "bg-green-50" : l.PorRegresar ? "bg-orange-50/50" : "hover:bg-gray-50"}`}>
                          <td className="px-3 py-1.5 align-top">
                            {puede && (
                              <input type="checkbox" checked={marcado} onChange={() => alternar(l)}
                                onClick={e => e.stopPropagation()} className="w-4 h-4 cursor-pointer"
                                title={l.PorRegresar ? "Sí se va a usar: aceptarlo al piso" : "Marcar para recibir"} />
                            )}
                          </td>
                          {i === 0 && (
                            <td rowSpan={n} onClick={e => { e.stopPropagation(); if (hayPendientes) alternarPolin(p); }}
                              title={hayPendientes && n > 1 ? "Marcar todo el polín" : p.Codigo}
                              className={`px-3 py-1.5 align-top font-mono text-xs font-bold text-gray-800 truncate ${hayPendientes ? "cursor-pointer hover:text-green-700" : ""}`}>
                              {p.Codigo}
                              {n > 1 && <span className="block font-sans font-normal text-[11px] text-gray-400">{mezcla || `${n} renglones`} · {p.Masters} m</span>}
                            </td>
                          )}
                          {/* Lote y producto pasan a otra línea en vez de recortarse: en la tablet no caben. */}
                          <td className="px-3 py-1.5 align-top font-mono text-xs break-all">{l.Lote}</td>
                          <td className="px-3 py-1.5 align-top text-xs break-words"><span className="font-mono text-gray-500">{l.Clase}</span> {l.DescripcionClase}</td>
                          <td className="px-3 py-1.5 align-top text-xs">{l.DescripcionTalla}</td>
                          <td className="px-3 py-1.5 align-top text-right tabular-nums font-semibold" onClick={e => marcado && e.stopPropagation()}>
                            {/* Marcado, se escribe cuántos acepta; de entrada todos. */}
                            {marcado ? (
                              <span className="inline-flex items-center gap-1">
                                <input type="number" inputMode="numeric" min="0" max={l.Masters} step="1"
                                  value={marcados[clave(l)]}
                                  onChange={e => setMarcados(m => ({ ...m, [clave(l)]: e.target.value }))}
                                  title="Masters que acepta al piso; el resto regresa a bodega"
                                  className={`w-12 border rounded px-1 py-0.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-green-400
                                    ${acepta == null ? "border-red-400 bg-red-50" : "border-green-400"}`} />
                                <span className="text-[11px] font-normal text-gray-500">/{l.Masters}</span>
                              </span>
                            ) : l.Masters}
                          </td>
                          <td className="px-3 py-1.5 align-top text-right tabular-nums">
                            {fmtNum(marcado && acepta != null ? acepta * (l.KgPorMaster || 0) : l.Kg)}
                          </td>
                          <td className="px-3 py-1.5 align-top text-xs" onClick={e => e.stopPropagation()}>
                            {l.Recibido ? (
                              // El enlace no se recorta aunque el nombre de quien recibió sea largo.
                              <span className="flex flex-wrap items-center gap-x-2 min-w-0 text-green-700">
                                <span className="whitespace-nowrap">recibido {l.RecibidoEn ? l.RecibidoEn.slice(11) : ""}</span>
                                {puedeDeshacer && !confirmada && (
                                  <button onClick={() => onDeshacer(rem, p, l)} className="shrink-0 text-gray-400 hover:text-red-600 underline"
                                    title="Se marcó por error: el renglón vuelve a 'aún en bodega' y sale del piso">
                                    deshacer
                                  </button>
                                )}
                                {l.RecibidoPor && <span className="block w-full truncate text-[11px] text-green-600" title={l.RecibidoPor}>{l.RecibidoPor}</span>}
                              </span>
                            ) : l.PorRegresar ? (
                              <span className="flex flex-wrap items-center gap-x-2 min-w-0 text-orange-700">
                                <span className="whitespace-nowrap">por regresar a bodega</span>
                                {marcado && acepta != null && acepta < l.Masters && <span className="whitespace-nowrap">· {l.Masters - acepta} siguen</span>}
                                {puedeDeshacer && !confirmada && !marcado && (
                                  <button onClick={() => onDeshacer(rem, p, l)} className="shrink-0 text-gray-400 hover:text-red-600 underline"
                                    title="Se marcó por error: el renglón vuelve a 'aún en bodega'">
                                    deshacer
                                  </button>
                                )}
                                {l.PorRegresarPor && <span className="block w-full truncate text-[11px] text-orange-600" title={l.PorRegresarPor}>{l.PorRegresarPor}</span>}
                              </span>
                            ) : marcado && acepta != null && acepta < l.Masters ? (
                              <span className="text-orange-700">{l.Masters - acepta} {l.Masters - acepta === 1 ? "regresa" : "regresan"} a bodega</span>
                            ) : <span className="text-amber-700">aún en bodega</span>}
                          </td>
                        </tr>
                      );
                    });
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
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
  // Lo devuelto también baja del piso con su consumo, pero va en su propia sección: no es algo que
  // se quedó sin despachar.
  const devueltos = new Set((hoja.devoluciones || []).map(d => d.ConsumoId).filter(Boolean));
  for (const e of hoja.entrada || []) {
    if (devueltos.has(e.MovimientoId)) continue;
    const hijos = traslados.filter(d => d.ConsumoId === e.MovimientoId);
    if (!hijos.length) filas.push({ clave: `e${e.MovimientoId}`, entrada: e, salida: null, ref: e });
    else hijos.forEach((d, i) => filas.push({ clave: `d${d.MovimientoId}`, entrada: i === 0 ? e : null, salida: d, ref: d }));
  }
  // Renglones del flujo de dos pasos, anteriores a ConsumoId: no tienen a quién pegarse, así que
  // van sueltos en vez de desaparecer de la pantalla.
  for (const d of traslados) if (!d.ConsumoId) filas.push({ clave: `d${d.MovimientoId}`, entrada: null, salida: d, ref: d });
  return filas;
}

// Los botones de corregir y quitar, como íconos grandes: con el ✎ y la × de texto en gris claro el
// encargado no los encontraba (usuario, 27 oct 2026).
function BotonIcono({ onClick, title, tipo }) {
  const estilo = {
    editar:   "text-gray-500 hover:text-blue-700 hover:bg-blue-50",
    quitar:   "text-gray-500 hover:text-red-700 hover:bg-red-50",
    guardar:  "text-green-600 hover:text-green-800 hover:bg-green-50",
    cancelar: "text-gray-500 hover:text-gray-800 hover:bg-gray-100",
  }[tipo];
  const trazo = {
    editar:   <path strokeLinecap="round" strokeLinejoin="round" d="M16.86 4.49l2.65 2.65M4 20l4.3-1 11.2-11.2a1.87 1.87 0 0 0 0-2.65l-.65-.65a1.87 1.87 0 0 0-2.65 0L5 15.7 4 20z" />,
    quitar:   <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />,
    guardar:  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />,
    cancelar: <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />,
  }[tipo];
  return (
    <button onClick={onClick} title={title} className={`p-1.5 rounded-md transition ${estilo}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">{trazo}</svg>
    </button>
  );
}

// Un renglón por TERMO (pesar por termo, 9 nov 2026): su número, los masters, lo declarado, lo
// pesado y la diferencia. Agrupados por la línea con que llegaron al destino —  el lote, o el lote en
// que se unificaron— , con su subtotal: un lote de cien masters son diez termos y el encargado quiere
// ver el lote. Lo descongelado antes del 9 nov no tiene termo: va un renglón por lote, como era.
// Cada termo se corrige (número, kilos, destino) o se quita completo; sus masters vuelven al piso.
const llaveDestino = (d) => `${d.BodegaDestino}|${d.RemisionId ?? ""}|${d.Lote}|${d.Clase}|${d.Talla}|${d.FechaLote ?? ""}`;

function TablaDescongelado({ hoja, destinos, puedeEditar, puedeBorrar, onCorregirTermo, onQuitarTermo, onCambiarDestino, onQuitar, onBorrar }) {
  const [editando, setEditando] = useState(null);   // { tipo, id, Termo, Kg, Destino, Declarado }
  const renglones = hoja.descongelado || [];
  const entradas = new Map((hoja.entrada || []).map(e => [e.MovimientoId, e]));
  // Lo que bajó del piso y nunca se despachó (flujo viejo de dos pasos) se muestra suelto. Lo
  // devuelto a bodega también baja con su consumo, pero va en su propia sección.
  const conSalida = new Set([...renglones, ...(hoja.devoluciones || [])].map(d => d.ConsumoId).filter(Boolean));
  const sueltos = (hoja.entrada || []).filter(e => !conSalida.has(e.MovimientoId));

  const filas = [
    ...termosDeHoja(hoja).filter(t => t.traslados.length).map(t => ({
      tipo: "termo", id: t.PesadaId, d: t.traslados[0], Termo: t.Termo, Hora: t.Hora, Lotes: t.Lotes,
      Masters: t.Masters, Declarado: t.Declarado, Pesado: t.Pesado, Dif: t.Dif, orden: t.PesadaId,
    })),
    ...renglones.filter(d => d.PesadaId == null).map(d => {
      const e = entradas.get(d.ConsumoId);
      return {
        tipo: "renglon", id: d.MovimientoId, d, Termo: null, Hora: d.FechaHora, Lotes: origenDe(d).Lote,
        Masters: e?.Masters ?? null, Declarado: e?.PesoKg ?? null, Pesado: d.PesoKg,
        Dif: e ? pctDif(d.PesoKg, e.PesoKg) : null, orden: d.MovimientoId,
      };
    }),
  ].sort((a, b) => a.orden - b.orden);
  const grupos = [];
  for (const f of filas) {
    const k = llaveDestino(f.d);
    let g = grupos.find(x => x.k === k);
    if (!g) { g = { k, d: f.d, filas: [] }; grupos.push(g); }
    g.filas.push(f);
  }
  const suma = (xs, c) => Number(xs.reduce((s, x) => s + (x[c] || 0), 0).toFixed(2));
  const masters = suma(filas, "Masters");
  const declarado = suma(filas.filter(f => f.Declarado != null), "Declarado");
  const pesadoConPar = suma(filas.filter(f => f.Declarado != null), "Pesado");

  const guardar = async () => {
    const e = editando;
    const ok = e.tipo === "termo"
      ? await onCorregirTermo(e.id, { NumeroTermo: e.Termo, KgPesado: e.Kg, BodegaDestino: e.Destino }, e.Declarado)
      : await onCambiarDestino(e.id, e.Destino);
    if (ok) setEditando(null);
  };

  return (
    <section className="bg-white border border-gray-300 rounded-lg overflow-hidden">
      <header className="bg-gray-100 border-b border-gray-300 px-4 py-2 flex items-center gap-3">
        <h3 className="font-bold text-sm text-gray-700">DESCONGELADO</h3>
        <span className="text-xs text-gray-500">
          {filas.filter(f => f.tipo === "termo").length} termo{filas.filter(f => f.tipo === "termo").length !== 1 ? "s" : ""}
          {filas.some(f => f.tipo === "renglon") && ` · ${filas.filter(f => f.tipo === "renglon").length} renglón(es) sin termo`}
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Termo</th>
              <th className="px-3 py-2 text-left font-semibold">Hora</th>
              <th className="px-3 py-2 text-left font-semibold">Lote</th>
              <th className="px-3 py-2 text-right font-semibold">Masters</th>
              <th className="px-3 py-2 text-right font-semibold">Declarado</th>
              <th className="px-3 py-2 text-right font-semibold">Pesado</th>
              <th className="px-3 py-2 text-right font-semibold">Dif.</th>
              <th className="px-3 py-2 text-left font-semibold">Enviado a</th>
              <th className="px-3 py-2 w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filas.length === 0 && sueltos.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400 text-xs">
                Todavía no se ha descongelado nada. Use <b>Pesar</b> en un lote del piso.</td></tr>
            )}
            {grupos.map(g => {
              const decl = suma(g.filas.filter(f => f.Declarado != null), "Declarado");
              const pes = suma(g.filas.filter(f => f.Declarado != null), "Pesado");
              const nT = g.filas.filter(f => f.tipo === "termo").length;
              return (
                <Fragment key={g.k}>
                  <tr className="bg-blue-50 border-t border-blue-200 text-xs text-blue-900">
                    <td colSpan={3} className="px-3 py-1.5">
                      <span className="font-mono font-bold">{g.d.Lote}</span>
                      <span className="ml-2"><span className="font-mono">{g.d.Clase}</span> {g.d.DescripcionClase} · {g.d.DescripcionTalla}</span>
                      {g.d.FolioRemision && <span className="ml-2 font-mono text-blue-700">{g.d.FolioRemision}</span>}
                      {nT > 0 && <span className="ml-2 text-blue-600">· {nT} termo{nT !== 1 ? "s" : ""}</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-bold">{suma(g.filas, "Masters") || "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-bold">{decl ? fmtNum(decl) : "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-bold">{fmtNum(suma(g.filas, "Pesado"))}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-bold" title={decl ? textoPct(pctDif(pes, decl)) : undefined}>{decl ? textoKg(pes - decl) : "—"}</td>
                    <td colSpan={2}></td>
                  </tr>
                  {g.filas.map(f => {
                    const ed = editando && editando.tipo === f.tipo && editando.id === f.id ? editando : null;
                    const mal = f.tipo === "termo" && f.Dif != null && fueraDeRango(f.Dif);
                    const o = origenDe(f.d);
                    return (
                      <tr key={`${f.tipo}${f.id}`} className={ed ? "bg-blue-50" : mal ? "bg-red-50/60" : "hover:bg-gray-50"}>
                        <td className="px-3 py-1.5 pl-6">
                          {ed && f.tipo === "termo" ? (
                            <input value={ed.Termo} onChange={e => setEditando({ ...ed, Termo: e.target.value })} maxLength={20}
                              className="w-16 border border-blue-400 rounded px-1.5 py-0.5 text-sm font-bold text-center" />
                          ) : f.Termo != null ? (
                            <span className="inline-flex items-center justify-center min-w-[2rem] px-1.5 py-0.5 rounded bg-gray-800 text-white text-xs font-bold tabular-nums">{f.Termo}</span>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-gray-500 tabular-nums">{f.Hora ? f.Hora.slice(11, 16) : ""}</td>
                        <td className="px-3 py-1.5 font-mono text-xs">
                          {f.Lotes}
                          {f.tipo === "renglon" && o.UnificadoEn && (
                            <span className="block font-sans text-[11px] font-semibold text-emerald-700">unificado en <span className="font-mono">{o.UnificadoEn}</span></span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{f.Masters ?? "—"}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{f.Declarado != null ? fmtNum(f.Declarado) : "—"}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-semibold">
                          {ed && f.tipo === "termo" ? (
                            <input value={ed.Kg} onChange={e => setEditando({ ...ed, Kg: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal"
                              className="w-24 border border-blue-400 rounded px-1.5 py-0.5 text-sm text-right" />
                          ) : fmtNum(f.Pesado)}
                        </td>
                        <td className={`px-3 py-1.5 text-right tabular-nums whitespace-nowrap ${mal ? "text-red-700 font-bold" : "text-gray-600"}`}
                          title={f.Dif != null ? textoPct(f.Dif) : undefined}>
                          {f.Dif != null && f.Declarado != null ? textoKg(f.Pesado - f.Declarado) : "—"}
                          {mal && <span className="ml-1 text-[10px] font-semibold uppercase bg-red-600 text-white rounded px-1 py-0.5 align-middle">fuera</span>}
                        </td>
                        <td className="px-3 py-1.5 text-xs">
                          {ed ? <SelectorDestino destinos={destinos} value={ed.Destino} onChange={v => setEditando({ ...ed, Destino: v })} ancho="w-40" chico />
                              : nombreDestinoDe(f.d)}
                        </td>
                        <td className="px-2 py-1 text-center whitespace-nowrap">
                          {ed ? (
                            <>
                              <BotonIcono tipo="guardar" title="Guardar" onClick={guardar} />
                              <BotonIcono tipo="cancelar" title="Cancelar" onClick={() => setEditando(null)} />
                            </>
                          ) : (
                            <>
                              {puedeEditar && (
                                <BotonIcono tipo="editar" title={f.tipo === "termo" ? "Corregir el número, los kilos o a dónde se envió" : "Cambiar a dónde se envió"}
                                  onClick={() => setEditando({ tipo: f.tipo, id: f.id, Termo: String(f.Termo ?? ""), Kg: String(f.Pesado),
                                                               Destino: valorDestinoDe(f.d), Declarado: f.Declarado })} />
                              )}
                              {puedeBorrar && (
                                <BotonIcono tipo="quitar" title={f.tipo === "termo" ? "Quitar el termo: sus masters vuelven al piso" : "Quitar el renglón: el lote vuelve al piso"}
                                  onClick={() => (f.tipo === "termo" ? onQuitarTermo(f) : onQuitar(f.d))} />
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
            {sueltos.map(e => (
              <tr key={`e${e.MovimientoId}`}>
                <td className="px-3 py-1.5 text-gray-300">—</td>
                <td></td>
                <td className="px-3 py-1.5 font-mono text-xs">
                  {e.Lote}<span className="block font-sans text-[11px] text-amber-600">sin despachar · {e.FolioRemision || "—"}</span>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{e.Masters ?? "—"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(e.PesoKg)}</td>
                <td colSpan={3}></td>
                <td className="px-2 py-1 text-center">
                  {puedeBorrar && (
                    <BotonIcono tipo="quitar" onClick={() => onBorrar(e.MovimientoId)} title="Quitar el renglón y devolverlo al piso" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-100 border-t-2 border-gray-300">
            <tr className="font-bold">
              <td colSpan={3} className="px-3 py-2 text-right text-xs text-gray-600 uppercase">Totales</td>
              <td className="px-3 py-2 text-right tabular-nums">{masters || "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{declarado ? fmtNum(declarado) : "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums text-base">{fmtNum(hoja.KgDescongelado)}</td>
              <td className="px-3 py-2 text-right tabular-nums" title={declarado ? textoPct(pctDif(pesadoConPar, declarado)) : undefined}>{declarado ? textoKg(pesadoConPar - declarado) : "—"}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/* ── Devoluciones a bodega ────────────────────────────────────────── */
// Producto que bajó del piso y regresó sin descongelar. SOLO SE LEE, y solo sale en las hojas que
// tienen alguna: desde el 28 oct 2026 ya no se devuelve desde Descongelado (ver InventarioPiso), así
// que esto queda para las devoluciones anotadas antes, que se pueden seguir quitando.
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
                      <BotonIcono tipo="quitar" onClick={() => onBorrar(l.MovimientoId)}
                        title="Quitar la devolución y regresar el producto al piso" />
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
  // Entrada − salida: positivo es merma; negativo, ganancia (pesado arriba de lo declarado, que desde
  // que se pesa por termo se acepta hasta +2 %). Cerrada con merma, es la del renglón MERMA.
  const neto = Number((hoja.KgEntrada - hoja.KgDescongelado - hoja.KgDevuelto).toFixed(2));
  const cerrada = hoja.Estatus === "Cerrada";
  const ganancia = neto < -0.004;
  const tiles = [
    { t: "Entrada declarada", v: hoja.KgEntrada, c: "text-gray-800" },
    { t: "Descongelado", v: hoja.KgDescongelado, c: "text-blue-700" },
    { t: "Devuelto a bodega", v: hoja.KgDevuelto, c: "text-gray-800" },
    { t: ganancia ? (cerrada ? "Ganancia" : "Ganancia al cerrar") : (cerrada ? "Merma" : "Merma al cerrar"),
      v: ganancia ? -neto : cerrada ? hoja.KgMerma : neto,
      c: ganancia ? "text-green-700" : neto > 0.004 ? "text-amber-600" : "text-gray-400" },
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
  const [porEntregar, setPorEntregar] = useState([]);   // escaneado por bodega, sin confirmar: aún en bodega
  const [empleados, setEmpleados] = useState([]);
  const [cargando, setCargando]   = useState(false);
  const [error, setError]         = useState("");
  const [auxiliares, setAuxiliares] = useState([]);
  const [resumen, setResumen] = useState(null);
  const [modal, setModal]   = useState(null);   // { seleccion } — descongelar por kilos una línea sin masters
  const [pesar, setPesar]   = useState(null);   // la línea del piso cuyo lote se pesa por termo
  const [ultimoDestino, setUltimoDestino] = useState("");   // el destino anterior se sugiere
  const [cierre, setCierre] = useState(false);   // modal de cerrar la hoja
  const [imprimir, setImprimir] = useState(false); // vista previa de la hoja para imprimir / PDF
  const [reporte, setReporte] = useState(false);   // reporte de la jornada completa
  const [imprimirPiso, setImprimirPiso] = useState(false); // inventario al piso para imprimir / PDF
  const [inicioSug, setInicioSug] = useState(null);   // { Hora, Motivo } del turno que sigue
  const [abriendoHoja, setAbriendoHoja] = useState(false);   // modal de abrir la hoja del turno

  // La hoja se abre a mano ANTES de descongelar (ver ModalAbrirHoja) y todo lo del turno se agrega
  // a ella. Sin hoja abierta no se descongela. Puede haber dos abiertas a la vez: en ciertos horarios
  // los dos turnos trabajan juntos (usuario, 29 oct 2026). Lo descongelado va, de entrada, a la que
  // se está viendo; si se ve una cerrada, a la abierta más reciente.
  const hojasAbiertas = hojas.filter(h => h.Estatus === "Abierta");
  const hojaAbierta = hojasAbiertas.find(h => h.HojaId === selId) || hojasAbiertas[hojasAbiertas.length - 1] || null;

  const fetchHojas = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch(`${API}/hojas?bodega=DESCONGELADO&fecha=${fecha}`, { headers: authHeader() });
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
      const [rs, rr, rp] = await Promise.all([
        fetch(`${API}/saldo?bodega=DESCONGELADO&hasta=${fecha}`, { headers: authHeader() }),
        fetch(`${API}/resumen?bodega=DESCONGELADO&fecha=${fecha}`, { headers: authHeader() }),
        fetch(`${API}/por-entregar?bodega=DESCONGELADO`, { headers: authHeader() }),
      ]);
      const data = await leerJSON(rs);
      setSaldo(Array.isArray(data) ? data : []);
      setResumen(rr.ok ? await leerJSON(rr) : null);
      const pe = rp.ok ? await leerJSON(rp) : [];
      setPorEntregar(Array.isArray(pe) ? pe : []);
      const ra = await fetch(`${API}/auxiliares?bodega=DESCONGELADO&fecha=${fecha}`, { headers: authHeader() });
      const aux = await leerJSON(ra);
      setAuxiliares(Array.isArray(aux) ? aux : []);
    } catch { setSaldo([]); setPorEntregar([]); setResumen(null); setAuxiliares([]); }
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

  const confirmarAbrirHoja = async (cab) => {
    const out = await post(`${API}/hojas`, {
      FechaProduccion: fecha, BodegaCodigo: "DESCONGELADO", Propiedad: "OROPSA",
      Encargado: cab.Encargado, HoraInicio: `${fecha} ${cab.HoraInicio}:00`,
    });
    if (!out) return;
    setAbriendoHoja(false);
    await recargar(out.HojaId);
  };

  // Descongelar: UN viaje al servidor con todo lo marcado. Si algo falla, el modal se queda abierto
  // con lo capturado para corregirlo en su sitio.
  const confirmarDescongelar = async (datos, hojaId) => {
    if (!hojaId) { await mostrarAlerta("No hay hoja abierta: ábrala primero con su encargado y hora de inicio."); return; }
    const out = await post(`${API}/hojas/${hojaId}/descongelar-marcado`, datos);
    if (!out) return;
    setUltimoDestino(datos.BodegaDestino);
    setModal(null);
    await recargar(hojaId);
  };

  // Lo que el panel de pesar registró o corrigió: recarga el piso y la hoja, y recuerda el destino.
  const alPesar = async (hojaId, destino) => {
    if (destino) setUltimoDestino(destino);
    await recargar(hojaId);
  };

  // Corregir un termo desde la tabla de la hoja. Fuera del rango se confirma, igual que al pesarlo.
  const corregirTermo = async (id, { NumeroTermo, KgPesado, BodegaDestino }, declarado) => {
    const kg = Number(KgPesado);
    if (!String(NumeroTermo ?? "").trim() || !(kg > 0)) { await mostrarAlerta("Escriba el número del termo y los kilos."); return false; }
    if (!BodegaDestino) { await mostrarAlerta("Escoja a dónde se envió."); return false; }
    let Confirmado = false;
    if (declarado != null && fueraDeRango(pctDif(kg, declarado))) {
      if (!(await pedirConfirmacion(
        `El termo ${NumeroTermo} quedaría en ${fmtNum(kg)} kg contra ${fmtNum(declarado)} kg declarados (${textoPct(pctDif(kg, declarado))}), ` +
        `fuera del rango de ${RANGO.abajo} % a +${RANGO.arriba} %. ¿La báscula marcó eso?`, { textoConfirmar: "Sí, guardar así" }))) return false;
      Confirmado = true;
    }
    if (!await post(`${API}/termo/${id}`, { NumeroTermo: String(NumeroTermo).trim(), KgPesado: kg, BodegaDestino, Confirmado }, "PUT")) return false;
    await recargar(sel.HojaId);
    return true;
  };

  const quitarTermo = async (f) => {
    if (!(await pedirConfirmacion(`¿Quitar el termo ${f.Termo} (${f.Lotes}, ${f.Masters} masters)? Sus masters vuelven al inventario al piso.`))) return;
    const res = await fetch(`${API}/termo/${f.id}`, { method: "DELETE", headers: authHeader() });
    const data = await leerJSON(res);
    if (!res.ok) { await mostrarAlerta(data.error || "No se pudo quitar"); return; }
    await recargar(sel.HojaId);
  };

  // Recibir lo que bodega dejó y el área va a usar: entra al piso y se puede descongelar. De cada
  // renglón, la cantidad que escribió (Acepta); el resto queda por regresar a bodega.
  const recibirPolines = async (rem, lineas) => {
    const m = lineas.reduce((s, l) => s + l.Acepta, 0), kg = lineas.reduce((s, l) => s + l.Acepta * (l.KgPorMaster || 0), 0);
    const regresan = lineas.reduce((s, l) => s + (l.Masters - l.Acepta), 0);
    const detalle = lineas.map(l => `${l.PalletCodigo} · ${l.Lote} ${l.DescripcionTalla} · ${l.Acepta} de ${l.Masters} m` +
      (l.Acepta < l.Masters ? ` (${l.Masters - l.Acepta} ${l.Masters - l.Acepta === 1 ? "regresa" : "regresan"})` : "")).join("\n");
    if (!(await pedirConfirmacion(
      `¿Recibe esto de ${rem.Folio} para usarlo?\n\n${detalle}\n\nAl piso: ${m} masters, ${fmtNum(kg)} kg.` +
      (regresan ? `\nPor regresar a bodega: ${regresan} masters. No entran a su piso; bodega los escanea cuando vuelvan.` : "") +
      `\n\nLo recibido se puede descongelar. Bodega verá que usted lo recibió.`, { textoConfirmar: "Recibir" }))) return false;
    const out = await post(`${API}/recibir`, {
      RemisionId: rem.RemisionId, Bodega: "DESCONGELADO",
      Lineas: lineas.map(l => ({ PalletId: l.PalletId, Lote: l.Lote, Clase: l.Clase, Talla: l.Talla, FechaLote: l.FechaLote, Masters: l.Acepta })),
    });
    if (!out) return false;
    await recargar(sel?.HojaId);
    return true;
  };

  const deshacerRecepcion = async (rem, p, l) => {
    if (!(await pedirConfirmacion(
      `¿Deshacer ${l.Lote} ${l.DescripcionTalla} del polín ${p.Codigo}, ${rem.Folio}? ` +
      `Todo el renglón vuelve a "aún en bodega": lo recibido sale de su piso y lo que iba por regresar deja de estarlo.`, { textoConfirmar: "Deshacer" }))) return;
    if (!(await post(`${API}/deshacer-recepcion`, {
      RemisionId: rem.RemisionId, PalletId: l.PalletId, Lote: l.Lote, Clase: l.Clase, Talla: l.Talla, FechaLote: l.FechaLote,
      Bodega: "DESCONGELADO",
    }))) return;
    await recargar(sel?.HojaId);
  };

  const cambiarDestino = async (id, BodegaDestino) => {
    if (!await post(`${API}/traslado/${id}`, { BodegaDestino }, "PUT")) return false;
    await recargar(sel.HojaId);
    return true;
  };

  const quitarDescongelado = async (d) => {
    const o = origenDe(d);
    if (!(await pedirConfirmacion(`¿Quitar ${o.Lote} ${o.Clase} · ${o.Talla}? Vuelve al inventario al piso.`))) return;
    const res = await fetch(`${API}/traslado/${d.MovimientoId}`, { method: "DELETE", headers: authHeader() });
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

  const cerrarHoja = async ({ HoraFin, HoraInicio, Auxiliares }) => {
    const out = await post(`${API}/hojas/${sel.HojaId}/cerrar`,
      { HoraFin: HoraFin || horaGT(), Auxiliares, ...(HoraInicio ? { HoraInicio } : {}) });
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
      {abriendoHoja && (
        <ModalAbrirHoja fecha={fecha} empleados={empleados} auxiliares={auxiliares} inicioSugerido={inicioSug}
          onConfirmar={confirmarAbrirHoja} onCerrar={() => setAbriendoHoja(false)} />
      )}
      {modal && hojaAbierta && (
        <ModalDescongelar seleccion={modal.seleccion}
          hojasAbiertas={hojasAbiertas} hojaInicial={hojaAbierta.HojaId} destinos={destinos} destinoSugerido={ultimoDestino}
          onConfirmar={confirmarDescongelar} onCerrar={() => setModal(null)} />
      )}
      {/* El key ata el panel al lote: abrir otro no hereda lo tecleado del anterior. */}
      {pesar && hojaAbierta && (
        <PesarPorTermo key={`${pesar.Lote}|${pesar.Clase}|${pesar.Talla}`} linea={pesar} saldo={saldo}
          hojasAbiertas={hojasAbiertas} hojaInicial={hojaAbierta.HojaId} destinos={destinos} destinoSugerido={ultimoDestino}
          puedeEditar={puedeEditar} puedeBorrar={puedeBorrar}
          onCambio={alPesar} onCerrar={() => setPesar(null)} />
      )}
      {reporte && <ReporteDescongeladoModal fecha={fecha} onCerrar={() => setReporte(false)} />}
      {imprimirPiso && <InventarioDescongeladoModal fecha={fecha} saldo={saldo} porEntregar={porEntregar} onCerrar={() => setImprimirPiso(false)} />}
      {imprimir && sel && (
        <HojaDescongeladoModal hoja={sel} filas={filasDeHoja(sel)} onCerrar={() => setImprimir(false)} />
      )}
      {cierre && sel && (
        <ModalCerrarHoja hoja={sel}
          onConfirmar={cerrarHoja} onCerrar={() => setCierre(false)} />
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
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {hojasAbiertas.map(h => (
            <span key={h.HojaId} className="text-xs text-gray-500">
              Hoja abierta <b className="font-mono">#{h.HojaId}</b>
              {h.NombreEncargado ? ` · ${h.NombreEncargado}` : ""}
              {h.HoraInicio ? ` · desde ${h.HoraInicio.slice(11)}` : ""}
            </span>
          ))}
          {/* Con una ya abierta se puede abrir otra: el otro turno que llega a trabajar junto. */}
          {puedeCrear && (
            <button onClick={() => setAbriendoHoja(true)}
              className={hojasAbiertas.length
                ? "border border-blue-300 text-blue-700 rounded px-3 py-1.5 text-xs font-semibold hover:bg-blue-50"
                : "bg-blue-600 text-white rounded px-4 py-1.5 text-sm font-semibold hover:bg-blue-700"}>
              {hojasAbiertas.length ? "Abrir otra hoja" : "Abrir hoja"}
            </button>
          )}
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-300 text-red-700 text-sm px-4 py-2 rounded">⚠ {error}</div>}

      <InventarioPiso saldo={saldo} resumen={resumen} puedeCrear={puedeCrear && !!hojaAbierta}
        porLlegarM={porEntregar.filter(r => !r.Recibido && !r.PorRegresar).reduce((s, r) => s + (r.Masters || 0), 0)}
        onPesar={(linea) => setPesar(linea)}
        onDescongelarKg={(seleccion) => setModal({ seleccion })}
        onAbrirHoja={puedeCrear && !hojaAbierta ? () => setAbriendoHoja(true) : null}
        onImprimir={() => setImprimirPiso(true)} />

      {/* Recibir no pide hoja abierta: es la entrada al piso, no un renglón del turno. */}
      <PorEntregar filas={porEntregar} puedeRecibir={puedeCrear} puedeDeshacer={puedeEditar}
        onRecibir={recibirPolines} onDeshacer={deshacerRecepcion} />

      {/* Con más de una hoja (dos turnos, u OROPSA y maquila) hay que escoger cuál se ve. Con una
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
          Sin hojas de descongelado el {fmtDia(fecha)}. Abra la hoja del turno con su encargado y hora de inicio para empezar a descongelar.
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
            onCorregirTermo={corregirTermo} onQuitarTermo={quitarTermo}
            onCambiarDestino={cambiarDestino} onQuitar={quitarDescongelado} onBorrar={borrarRenglon} />
          {sel.devoluciones?.length > 0 && (
            <SeccionDevoluciones hoja={sel}
              puedeBorrar={sel.Estatus === "Abierta" && puedeBorrar} onBorrar={borrarRenglon} />
          )}
        </div>
      )}
    </div>
  );
}
