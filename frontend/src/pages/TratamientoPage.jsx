// Tratamiento de Camarón (químico) — la hoja "TRATAMIENTO DE CAMARON" en pantalla.
//
// Cada renglón del papel es un TERMO y se captura en dos momentos, como se llena la hoja:
//   - Entrada: se escoge del inventario al piso (lote, clase, talla y fecha del lote vienen de ahí,
//     no se teclean), con número de termo, hora de inicio, conteo inicial, químico y kg sin tratar.
//     Esos kilos salen del piso en ese momento.
//   - Salida: hora, conteo final, kg tratadas y a dónde va. Lo tratado entra al piso del destino ahí
//     mismo, sin esperar a que se cierre la hoja.
// Lo que el papel calcula a mano lo calcula el sistema: TIEMPO (salida − inicio), el % PICK-UP y los
// totales del turno. El CORTE ya lo dice la clase (E41 = "PELADO P&D T-OFF") y por eso no se pide.
//
// Pick-up = (tratadas − sin tratar) ÷ sin tratar. Negativo o arriba del máximo es una ALERTA (poco
// tiempo, otra dosis…): se marca en rojo o ámbar, nunca se escribe como 0 ni bloquea nada.
//
// El cliente de la hoja es el PREVISTO: Empaque lo puede cambiar al escanear el master según tallas y
// prioridades, así que es una referencia y no separa el inventario. Ver backend/src/lib/tratamiento.ts.
import { useState, useEffect, useCallback, useMemo } from "react";
import { fmtNum } from "../utils/numero.js";
import { authHeader, usePuede } from "../context/AuthContext.jsx";
import { useAviso } from "../hooks/useAviso.js";
import AvisoModal from "../components/AvisoModal.jsx";
import EmpleadoAutocomplete from "../components/EmpleadoAutocomplete.jsx";
import HojaTratamientoModal from "../components/HojaTratamientoModal.jsx";
import ReporteTratamientoModal from "../components/ReporteTratamientoModal.jsx";

const API = "/api/tratamiento";

const hoyGT = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
const horaGT = () =>
  new Date().toLocaleTimeString("es-GT", { hour12: false, hour: "2-digit", minute: "2-digit", timeZone: "America/Guatemala" });

// Las fechas puras se parten a mano: new Date("2026-10-17") es medianoche UTC y en Guatemala se
// muestra un día antes (ver utils/fecha.js).
const fmtDia = (iso) => {
  if (!iso) return "—";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};
const hora = (dt) => (dt ? String(dt).slice(11, 16) : "");
const fmtTiempo = (min) => {
  if (min == null) return "—";
  const h = Math.floor(min / 60), m = min % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
};

async function leerJSON(res) { try { return await res.json(); } catch { return {}; } }

const pickupDe = (sin, trat) => {
  const s = Number(sin), t = Number(trat);
  if (!(s > 0) || !(t > 0)) return null;
  return Number((((t - s) / s) * 100).toFixed(1));
};
const alertaDe = (p, max) => (p == null ? null : p < 0 ? "PERDIDA" : p > max ? "EXCEDE" : null);

function Pickup({ valor, alerta, grande = false }) {
  if (valor == null) return <span className="text-gray-400">—</span>;
  const cls = alerta === "PERDIDA" ? "text-red-600" : alerta === "EXCEDE" ? "text-amber-600" : "text-green-700";
  const titulo = alerta === "PERDIDA" ? "Salió pesando menos de lo que entró: revisar tiempo y dosis"
               : alerta === "EXCEDE" ? "Pasa del máximo de pick-up" : undefined;
  return (
    <span title={titulo} className={`font-semibold ${cls} ${grande ? "text-xl" : ""}`}>
      {valor > 0 ? "+" : ""}{fmtNum(valor, 1)} %{alerta ? " ⚠" : ""}
    </span>
  );
}

function Marco({ titulo, ancho = "max-w-lg", onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-white rounded-xl shadow-xl w-full ${ancho} max-h-full flex flex-col`} onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
          <h3 className="text-lg font-bold text-gray-800">{titulo}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <div className="px-5 py-4 overflow-y-auto space-y-4">{children}</div>
      </div>
    </div>
  );
}

const campo = "w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";
const Etiqueta = ({ children }) => <label className="block text-xs text-gray-500 mb-1">{children}</label>;

function Botones({ onCancelar, onAceptar, texto, ocupado, deshabilitado }) {
  return (
    <div className="flex justify-end gap-3 pt-1">
      <button onClick={onCancelar} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancelar</button>
      <button onClick={onAceptar} disabled={ocupado || deshabilitado}
        className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg disabled:opacity-50">
        {ocupado ? "Guardando…" : texto}
      </button>
    </div>
  );
}

/* ── Tratar lo marcado del piso ───────────────────────────────────── */
// La hoja NO se abre a mano: se marca lo del piso, "Tratar" y se escoge el cliente. Si ese cliente
// ya tiene hoja abierta en la jornada, los termos se suman a esa; si no, se abre una —  una hoja por
// cliente, como dice el papel— , así nunca queda una hoja vacía.
//
// Un termo por línea marcada. Hora y químico se ponen una vez para todos ("〃" en el papel) y se
// corrigen por renglón. Los kg sin tratar son FIJOS: los que la línea tiene al piso, que es el peso
// con que Pelado la entregó (decisión del usuario, 22 oct 2026: se revisa en las pruebas reales).
// Por eso no se parte un lote en varios termos: con el peso fijo, cada línea entra completa.
let llaveRenglon = 0;
const renglonDe = (linea, hora, quimico) => ({
  key: ++llaveRenglon, linea, NumeroTermo: "", HoraInicio: hora, ConteoInicial: "", Quimico: quimico, KgSinTratar: linea.Kg, Aceptar: false,
});
const claveLinea = (l) => `${l.RemisionId ?? ""}|${l.Lote}|${l.Clase}|${l.Talla}|${l.FechaLote ?? ""}`;

function ModalTratar({ lineas, fecha, hojas, clientes, empleados, quimicos, quimicoSugerido, pedirConfirmacion, onConfirmar, onCerrar }) {
  const [filtro, setFiltro] = useState("");
  const [cliente, setCliente] = useState("");
  const [encargado, setEncargado] = useState("");
  const [inicioHoja, setInicioHoja] = useState(horaGT());
  const [horaComun, setHoraComun] = useState(horaGT());
  const [quimicoComun, setQuimicoComun] = useState(quimicoSugerido ?? "");
  const [renglones, setRenglones] = useState(() => lineas.map(l => renglonDe(l, horaGT(), quimicoSugerido ?? "")));
  const [errorEn, setErrorEn] = useState(null);   // { Indice, error }
  const [ocupado, setOcupado] = useState(false);

  const lista = useMemo(() => {
    const f = filtro.trim().toUpperCase();
    return f ? clientes.filter(c => c.RazonSocial.toUpperCase().includes(f) || String(c.Codigo) === f) : clientes;
  }, [clientes, filtro]);
  const hojaDelCliente = cliente ? hojas.find(h => h.Estatus === "Abierta" && h.ClienteCodigo === Number(cliente)) : null;

  const set = (key, campo, valor) => setRenglones(rs => rs.map(r => (r.key === key ? { ...r, [campo]: valor, Aceptar: false } : r)));
  const quitar = (key) => setRenglones(rs => rs.filter(r => r.key !== key));
  const completo = cliente && renglones.length > 0 && renglones.every(r => r.NumeroTermo.trim() && r.HoraInicio && Number(r.KgSinTratar) > 0);
  const totalKg = renglones.reduce((s, r) => s + (Number(r.KgSinTratar) || 0), 0);

  const guardar = async (lista = renglones) => {
    setOcupado(true); setErrorEn(null);
    const r = await onConfirmar({
      ClienteCodigo: Number(cliente), Encargado: encargado || null, HoraInicio: inicioHoja, FechaProduccion: fecha,
      Termos: lista.map(x => ({
        RemisionId: x.linea.RemisionId, Lote: x.linea.Lote, Clase: x.linea.Clase, Talla: x.linea.Talla, FechaLote: x.linea.FechaLote,
        NumeroTermo: x.NumeroTermo.trim(), HoraInicio: x.HoraInicio, Quimico: x.Quimico || null,
        ConteoInicial: x.ConteoInicial === "" ? null : Number(x.ConteoInicial), KgSinTratar: Number(x.KgSinTratar),
        AceptarDiferencia: x.Aceptar,
      })),
    });
    setOcupado(false);
    if (!r) return;   // guardado: el padre cierra
    // Un termo que pesa un poco más de lo que hay al piso: se pregunta, y si es báscula se reintenta
    // con ese renglón aceptado. Nada quedó escrito en el intento anterior.
    if (r.Codigo === "DIFERENCIA" && r.Indice != null &&
        await pedirConfirmacion(`${r.error} Si acepta, los ${fmtNum(r.Exceso)} kg de más quedan registrados como diferencia de báscula.`)) {
      const nueva = lista.map((x, i) => (i === r.Indice ? { ...x, Aceptar: true } : x));
      setRenglones(nueva);
      return guardar(nueva);
    }
    setErrorEn({ Indice: r.Indice ?? null, error: r.error });
  };

  return (
    <Marco titulo={`Tratar ${lineas.length} línea${lineas.length !== 1 ? "s" : ""} del piso`} ancho="max-w-5xl" onClose={onCerrar}>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <Etiqueta>Cliente previsto</Etiqueta>
          <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar cliente…" className={`${campo} mb-2`} />
          <select value={cliente} onChange={e => setCliente(e.target.value)} size={5}
            className={`${campo} ${cliente ? "" : "border-amber-400"}`}>
            {lista.map(c => <option key={c.Codigo} value={c.Codigo}>{c.RazonSocial}</option>)}
          </select>
          <p className="text-xs text-gray-400 mt-1">Es una referencia: Empaque puede cambiar el destino al escanear el master.</p>
        </div>
        <div className="space-y-3">
          {!cliente ? (
            <p className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">Escoja el cliente.</p>
          ) : hojaDelCliente ? (
            <p className="text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              Los termos se suman a la hoja abierta <b>#{hojaDelCliente.HojaId}</b> de este cliente.
            </p>
          ) : (
            <>
              <p className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2">Se abre una hoja nueva para este cliente.</p>
              <div className="flex flex-wrap gap-4 items-end">
                <div className="min-w-0">
                  <Etiqueta>Encargado</Etiqueta>
                  <EmpleadoAutocomplete empleados={empleados} value={encargado} onSelect={setEncargado} />
                </div>
                <div>
                  <Etiqueta>Inicio de la hoja</Etiqueta>
                  <input type="time" value={inicioHoja} onChange={e => setInicioHoja(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
                </div>
              </div>
            </>
          )}
          <div className="flex flex-wrap gap-4 items-end border-t pt-3">
            <div>
              <Etiqueta>Inicio trat. (todos)</Etiqueta>
              <input type="time" value={horaComun}
                onChange={e => { setHoraComun(e.target.value); setRenglones(rs => rs.map(r => ({ ...r, HoraInicio: e.target.value }))); }}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <Etiqueta>Químico (todos)</Etiqueta>
              <select value={quimicoComun}
                onChange={e => { setQuimicoComun(e.target.value); setRenglones(rs => rs.map(r => ({ ...r, Quimico: e.target.value }))); }}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm">
                <option value="">—</option>
                {quimicos.map(q => <option key={q.Codigo} value={q.Codigo}>{q.Nombre}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="text-left px-2 py-2">Lote</th><th className="text-left px-2 py-2"># Termo</th>
              <th className="text-left px-2 py-2">Inicio</th><th className="text-left px-2 py-2">Conteo ini.</th>
              <th className="text-left px-2 py-2">Químico</th><th className="text-left px-2 py-2">Kg sin tratar</th><th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {renglones.map((r, i) => {
              return (
                <tr key={r.key} className={errorEn?.Indice === i ? "bg-red-50" : ""}>
                  <td className="px-2 py-1.5 align-top">
                    <p className="font-mono font-semibold whitespace-nowrap">{r.linea.Lote}</p>
                    <p className="text-xs text-gray-500">{r.linea.Clase} · {r.linea.DescripcionTalla}</p>
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    <input value={r.NumeroTermo} onChange={e => set(r.key, "NumeroTermo", e.target.value)}
                      className={`w-20 border rounded px-2 py-1 text-sm ${r.NumeroTermo.trim() ? "border-gray-300" : "border-amber-400 bg-amber-50"}`} />
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    <input type="time" value={r.HoraInicio} onChange={e => set(r.key, "HoraInicio", e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-sm" />
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    <input type="number" inputMode="numeric" value={r.ConteoInicial} onChange={e => set(r.key, "ConteoInicial", e.target.value)}
                      className="w-20 border border-gray-300 rounded px-2 py-1 text-sm" />
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    <select value={r.Quimico} onChange={e => set(r.key, "Quimico", e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-sm">
                      <option value="">—</option>
                      {quimicos.map(q => <option key={q.Codigo} value={q.Codigo}>{q.Nombre}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5 align-top whitespace-nowrap">
                    <p className="font-semibold pt-1">{fmtNum(r.KgSinTratar)} kg</p>
                    <p className="text-xs text-gray-400">del piso</p>
                  </td>
                  <td className="px-2 py-1.5 align-top whitespace-nowrap text-right">
                    {renglones.length > 1 && <button onClick={() => quitar(r.key)} className="text-xs text-red-600 border border-red-200 rounded px-2 py-1 hover:bg-red-50">Quitar</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {errorEn && <p className="text-sm text-red-600">{errorEn.error} No se guardó nada: corrija y vuelva a intentar.</p>}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-600">{renglones.length} termo{renglones.length !== 1 ? "s" : ""} · <b>{fmtNum(totalKg)} kg</b> sin tratar</p>
        <Botones texto="Meter a tratamiento" ocupado={ocupado} deshabilitado={!completo} onCancelar={onCerrar} onAceptar={() => guardar()} />
      </div>
    </Marco>
  );
}

/* ── Salida de varios termos juntos ───────────────────────────────── */
// Los termos que entraron juntos salen juntos (en el papel, de dos o tres a la misma hora): la hora
// y el destino se ponen una vez; los kg tratadas y el conteo final son de cada termo, porque cada uno
// se pesa.
function ModalSalidas({ termos, destinos, destinoSugerido, pickupMaximo, onConfirmar, onCerrar }) {
  const [horaSalida, setHoraSalida] = useState(horaGT());
  const [destino, setDestino] = useState(destinoSugerido || "");
  const [filas, setFilas] = useState(() => termos.map(t => ({ t, ConteoFinal: "", KgTratadas: "" })));
  const [errorEn, setErrorEn] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const set = (id, campo, v) => setFilas(fs => fs.map(f => (f.t.TermoId === id ? { ...f, [campo]: v } : f)));
  const completo = horaSalida && destino && filas.every(f => Number(f.KgTratadas) > 0);

  return (
    <Marco titulo={`Salida de ${termos.length} termo${termos.length !== 1 ? "s" : ""}`} ancho="max-w-3xl" onClose={onCerrar}>
      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <Etiqueta>Salida trat.</Etiqueta>
          <input type="time" value={horaSalida} onChange={e => setHoraSalida(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
        </div>
        <div className="min-w-[12rem]">
          <Etiqueta>Va a</Etiqueta>
          <select value={destino} onChange={e => setDestino(e.target.value)} className={`${campo} ${destino ? "" : "border-amber-400 bg-amber-50"}`}>
            <option value="">¿A dónde va?…</option>
            {destinos.map(d => <option key={d.Codigo} value={d.Codigo}>{d.Nombre}</option>)}
          </select>
        </div>
      </div>
      <div className="border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="text-left px-2 py-2"># Termo</th><th className="text-left px-2 py-2">Lote</th><th className="text-left px-2 py-2">Entró</th>
              <th className="text-right px-2 py-2">Kg sin tratar</th><th className="text-left px-2 py-2">Conteo fin.</th>
              <th className="text-left px-2 py-2">Kg tratadas</th><th className="text-right px-2 py-2">% Pick-up</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filas.map((f, i) => {
              const p = pickupDe(f.t.KgSinTratar, f.KgTratadas);
              return (
                <tr key={f.t.TermoId} className={errorEn?.Indice === i ? "bg-red-50" : ""}>
                  <td className="px-2 py-1.5 font-mono font-semibold">{f.t.NumeroTermo}</td>
                  <td className="px-2 py-1.5"><span className="font-mono">{f.t.Lote}</span> <span className="text-xs text-gray-500">{f.t.DescripcionTalla}</span></td>
                  <td className="px-2 py-1.5">{hora(f.t.HoraInicio)}{f.t.ConteoInicial ? <span className="text-xs text-gray-500"> · conteo {f.t.ConteoInicial}</span> : null}</td>
                  <td className="px-2 py-1.5 text-right">{fmtNum(f.t.KgSinTratar)}</td>
                  <td className="px-2 py-1.5">
                    <input type="number" inputMode="numeric" value={f.ConteoFinal} onChange={e => set(f.t.TermoId, "ConteoFinal", e.target.value)}
                      className="w-20 border border-gray-300 rounded px-2 py-1 text-sm" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" inputMode="decimal" step="0.01" value={f.KgTratadas} placeholder="pesar" onChange={e => set(f.t.TermoId, "KgTratadas", e.target.value)}
                      className={`w-24 border rounded px-2 py-1 text-sm ${Number(f.KgTratadas) > 0 ? "border-gray-300" : "border-amber-400 bg-amber-50"}`} />
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap"><Pickup valor={p} alerta={alertaDe(p, pickupMaximo)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {errorEn && <p className="text-sm text-red-600">{errorEn.error} No se guardó nada: corrija y vuelva a intentar.</p>}
      <Botones texto="Registrar salida" ocupado={ocupado} deshabilitado={!completo} onCancelar={onCerrar}
        onAceptar={async () => {
          setOcupado(true); setErrorEn(null);
          const r = await onConfirmar({
            HoraSalida: horaSalida, BodegaDestino: destino,
            Salidas: filas.map(f => ({ TermoId: f.t.TermoId, KgTratadas: Number(f.KgTratadas), ConteoFinal: f.ConteoFinal === "" ? null : Number(f.ConteoFinal) })),
          });
          setOcupado(false);
          if (r) setErrorEn({ Indice: r.Indice ?? null, error: r.error });
        }} />
    </Marco>
  );
}

/* ── Entrada del termo ────────────────────────────────────────────── */
function ModalEntrada({ linea, termo, quimicos, quimicoSugerido, onConfirmar, onCerrar }) {
  const editando = !!termo;
  const [f, setF] = useState(() => editando ? {
    NumeroTermo: termo.NumeroTermo ?? "", HoraInicio: hora(termo.HoraInicio), ConteoInicial: termo.ConteoInicial ?? "",
    Quimico: termo.QuimicoCodigo ?? "", KgSinTratar: String(termo.KgSinTratar),
  } : { NumeroTermo: "", HoraInicio: horaGT(), ConteoInicial: "", Quimico: quimicoSugerido ?? "", KgSinTratar: "" });
  const [ocupado, setOcupado] = useState(false);
  const set = (k) => (e) => setF(x => ({ ...x, [k]: e.target.value }));
  const base = editando ? termo : linea;
  // Los kg sin tratar son los del piso y no se corrigen aquí (decisión del usuario, 22 oct 2026).
  const kgFijo = true;

  return (
    <Marco titulo={editando ? `Corregir termo ${termo.NumeroTermo}` : "Termo nuevo"} onClose={onCerrar}>
      <div className="text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
        <p><span className="font-mono font-bold">{base.Lote}</span> · {base.DescripcionTalla}</p>
        <p className="text-gray-500 text-xs">{base.Clase} {base.DescripcionClase}{base.FechaLote ? ` · prod. ${fmtDia(base.FechaLote)}` : ""}</p>
        {!editando && <p className="text-xs mt-1">Al piso: <b>{fmtNum(linea.Kg)} kg</b></p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Etiqueta># Termo</Etiqueta><input value={f.NumeroTermo} onChange={set("NumeroTermo")} className={campo} autoFocus /></div>
        <div><Etiqueta>Inicio trat.</Etiqueta><input type="time" value={f.HoraInicio} onChange={set("HoraInicio")} className={campo} /></div>
        <div><Etiqueta>Conteo inicial</Etiqueta><input type="number" inputMode="numeric" value={f.ConteoInicial} onChange={set("ConteoInicial")} className={campo} /></div>
        <div>
          <Etiqueta>Tipo de químico</Etiqueta>
          <select value={f.Quimico} onChange={set("Quimico")} className={campo}>
            <option value="">—</option>
            {quimicos.map(q => <option key={q.Codigo} value={q.Codigo}>{q.Nombre}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <Etiqueta>Kg sin tratar</Etiqueta>
          <input type="number" inputMode="decimal" step="0.01" value={f.KgSinTratar} onChange={set("KgSinTratar")} disabled={kgFijo}
            className={`${campo} ${kgFijo ? "bg-gray-100" : ""}`} />
          {kgFijo && <p className="text-xs text-gray-400 mt-1">Vienen del inventario al piso: no se cambian aquí.</p>}
        </div>
      </div>
      <Botones texto={editando ? "Guardar" : "Registrar entrada"} ocupado={ocupado}
        deshabilitado={!f.NumeroTermo.trim() || !f.HoraInicio || !(Number(f.KgSinTratar) > 0)} onCancelar={onCerrar}
        onAceptar={async () => {
          setOcupado(true);
          const datos = { ...f, ConteoInicial: f.ConteoInicial === "" ? null : Number(f.ConteoInicial), KgSinTratar: Number(f.KgSinTratar) };
          if (kgFijo) delete datos.KgSinTratar;
          await onConfirmar(datos);
          setOcupado(false);
        }} />
    </Marco>
  );
}

/* ── Salida del termo ─────────────────────────────────────────────── */
function ModalSalida({ termo, destinos, destinoSugerido, pickupMaximo, onConfirmar, onCerrar }) {
  const [f, setF] = useState({
    HoraSalida: hora(termo.HoraSalida) || horaGT(), ConteoFinal: termo.ConteoFinal ?? "",
    KgTratadas: termo.KgTratadas != null ? String(termo.KgTratadas) : "",
    BodegaDestino: termo.BodegaDestino || destinoSugerido || "",
  });
  const [ocupado, setOcupado] = useState(false);
  const set = (k) => (e) => setF(x => ({ ...x, [k]: e.target.value }));
  const p = pickupDe(termo.KgSinTratar, f.KgTratadas);
  const alerta = alertaDe(p, pickupMaximo);

  return (
    <Marco titulo={`Salida del termo ${termo.NumeroTermo}`} onClose={onCerrar}>
      <div className="text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
        <p><span className="font-mono font-bold">{termo.Lote}</span> · {termo.DescripcionTalla}</p>
        <p className="text-xs text-gray-500">Entró a las {hora(termo.HoraInicio)} con <b>{fmtNum(termo.KgSinTratar)} kg</b> sin tratar
          {termo.ConteoInicial ? ` · conteo ${termo.ConteoInicial}` : ""}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Etiqueta>Salida trat.</Etiqueta><input type="time" value={f.HoraSalida} onChange={set("HoraSalida")} className={campo} /></div>
        <div><Etiqueta>Conteo final</Etiqueta><input type="number" inputMode="numeric" value={f.ConteoFinal} onChange={set("ConteoFinal")} className={campo} /></div>
        <div><Etiqueta>Kg tratadas</Etiqueta><input type="number" inputMode="decimal" step="0.01" value={f.KgTratadas} onChange={set("KgTratadas")} className={campo} autoFocus /></div>
        <div>
          <Etiqueta>Va a</Etiqueta>
          <select value={f.BodegaDestino} onChange={set("BodegaDestino")} className={`${campo} ${f.BodegaDestino ? "" : "border-amber-400 bg-amber-50"}`}>
            <option value="">¿A dónde va?…</option>
            {destinos.map(d => <option key={d.Codigo} value={d.Codigo}>{d.Nombre}</option>)}
          </select>
        </div>
      </div>
      <div className="flex items-center justify-between border-t pt-3">
        <span className="text-sm text-gray-600">% Pick-up</span>
        <Pickup valor={p} alerta={alerta} grande />
      </div>
      {alerta === "PERDIDA" && <p className="text-xs text-red-600">Sale pesando menos de lo que entró. Se registra tal cual, como alerta: revise tiempo y dosis.</p>}
      {alerta === "EXCEDE" && <p className="text-xs text-amber-700">Pasa del máximo de {pickupMaximo} %. Se registra, pero conviene revisar el peso o la dosis.</p>}
      <Botones texto="Registrar salida" ocupado={ocupado}
        deshabilitado={!f.HoraSalida || !(Number(f.KgTratadas) > 0) || !f.BodegaDestino} onCancelar={onCerrar}
        onAceptar={async () => {
          setOcupado(true);
          await onConfirmar({ ...f, ConteoFinal: f.ConteoFinal === "" ? null : Number(f.ConteoFinal), KgTratadas: Number(f.KgTratadas) });
          setOcupado(false);
        }} />
    </Marco>
  );
}

/* ── Cerrar la hoja ───────────────────────────────────────────────── */
// La diferencia de báscula la decide el encargado: lo que queda al piso de un lote que ya se
// terminó se da por terminado y queda registrado como diferencia. Viene marcado si es poco (hasta
// 2 kg o el 3 % de lo tomado); lo demás se deja al piso salvo que el encargado lo marque.
function ModalCerrar({ hoja, onConfirmar, onCerrar }) {
  const ultima = hoja.Termos.map(t => hora(t.HoraSalida)).filter(Boolean).sort().pop() || horaGT();
  const [fin, setFin] = useState(ultima);
  const pendientes = hoja.Lineas.filter(l => l.KgAlPiso > 0.001);
  const [marcadas, setMarcadas] = useState(() =>
    new Set(pendientes.filter(l => l.KgAlPiso <= Math.max(2, l.KgTomado * 0.03)).map(l => l.Clave)));
  const [ocupado, setOcupado] = useState(false);
  const enTermo = hoja.Termos.filter(t => t.KgTratadas == null);
  const t = hoja.Totales;

  return (
    <Marco titulo={`Cerrar hoja #${hoja.HojaId}`} ancho="max-w-xl" onClose={onCerrar}>
      {enTermo.length > 0 ? (
        <p className="text-sm text-red-600">Falta la salida de {enTermo.length} termo{enTermo.length > 1 ? "s" : ""}: {enTermo.map(x => x.NumeroTermo).join(", ")}.</p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2 text-center text-sm">
            <div><p className="text-xs text-gray-500">Recibidos</p><p className="font-semibold">{fmtNum(t.KgRecibidos)}</p></div>
            <div><p className="text-xs text-gray-500">Tratados</p><p className="font-semibold">{fmtNum(t.KgTratados)}</p></div>
            <div><p className="text-xs text-gray-500">Ganados</p><p className="font-semibold">{fmtNum(t.KgGanados)}</p></div>
            <div><p className="text-xs text-gray-500">Pick-up</p><Pickup valor={t.Pickup} alerta={t.Alerta} /></div>
          </div>
          <div>
            <Etiqueta>Hora fin</Etiqueta>
            <input type="time" value={fin} onChange={e => setFin(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
            <p className="text-xs text-gray-400 mt-1">Las personas se cuentan del marcaje del área dentro del horario de la hoja.</p>
          </div>
          {pendientes.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1">Lotes que todavía tienen kilos al piso</p>
              <p className="text-xs text-gray-500 mb-2">Marque los que ya se terminaron: lo que queda es diferencia de báscula y sale del piso. Los que no marque siguen al piso para otra hoja.</p>
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                {pendientes.map(l => {
                  const pct = l.KgTomado > 0 ? (l.KgAlPiso / l.KgTomado) * 100 : 0;
                  return (
                    <label key={l.Clave} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={marcadas.has(l.Clave)}
                        onChange={e => setMarcadas(s => { const n = new Set(s); e.target.checked ? n.add(l.Clave) : n.delete(l.Clave); return n; })} />
                      <span className="flex-1 min-w-0 truncate"><span className="font-mono">{l.Lote}</span> · {l.Clase} · {l.DescripcionTalla}</span>
                      <span className={`whitespace-nowrap ${pct > 3 ? "text-amber-700 font-semibold" : "text-gray-600"}`}>
                        {fmtNum(l.KgAlPiso)} kg <span className="text-xs">({fmtNum(pct, 1)} % de lo tomado)</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
      <Botones texto="Cerrar hoja" ocupado={ocupado} deshabilitado={enTermo.length > 0} onCancelar={onCerrar}
        onAceptar={async () => { setOcupado(true); await onConfirmar({ HoraFin: fin, Terminar: [...marcadas] }); setOcupado(false); }} />
    </Marco>
  );
}

/* ── Inventario al piso de Tratamiento ────────────────────────────── */
// Se marca lo que se va a tratar (una línea, varias o todas) y "Tratar" abre la captura con el
// cliente. Ya no hace falta abrir la hoja antes.
function InventarioPiso({ saldo, puedeTratar, marcadas, setMarcadas, onTratar }) {
  const total = saldo.reduce((s, l) => s + l.Kg, 0);
  const sel = saldo.filter(l => marcadas.has(claveLinea(l)));
  const kgSel = sel.reduce((s, l) => s + l.Kg, 0);
  const todas = saldo.length > 0 && sel.length === saldo.length;
  const alternar = (l) => setMarcadas(m => { const n = new Set(m); const k = claveLinea(l); n.has(k) ? n.delete(k) : n.add(k); return n; });
  return (
    <div className="bg-white border border-gray-300 rounded-lg">
      <div className="px-4 py-2.5 border-b flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-gray-800">Inventario al piso de Tratamiento</h2>
        <span className="text-xs text-gray-500">{saldo.length} línea{saldo.length !== 1 ? "s" : ""} · {fmtNum(total)} kg</span>
        {puedeTratar && saldo.length > 0 && (
          <button onClick={() => onTratar(sel)} disabled={!sel.length}
            className="ml-auto bg-blue-600 text-white rounded px-3 py-1.5 text-xs font-semibold hover:bg-blue-700 disabled:opacity-40">
            {sel.length ? `Tratar (${sel.length} línea${sel.length !== 1 ? "s" : ""} · ${fmtNum(kgSel)} kg)` : "Marque lo que va a tratar"}
          </button>
        )}
      </div>
      {saldo.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-gray-400">No hay producto al piso. Llega al cerrar las transacciones de Pelado con destino Tratamiento.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                {puedeTratar && (
                  <th className="px-3 py-2 w-8">
                    <input type="checkbox" checked={todas} title="Marcar todo"
                      onChange={e => setMarcadas(e.target.checked ? new Set(saldo.map(claveLinea)) : new Set())} />
                  </th>
                )}
                <th className="text-left px-3 py-2">Lote</th><th className="text-left px-3 py-2">Clase</th>
                <th className="text-left px-3 py-2">Talla</th><th className="text-left px-3 py-2">Prod.</th>
                <th className="text-right px-3 py-2">Días al piso</th><th className="text-right px-3 py-2">Kg</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {saldo.map(l => {
                const k = claveLinea(l);
                return (
                  <tr key={k} onClick={puedeTratar ? () => alternar(l) : undefined}
                    className={`${puedeTratar ? "cursor-pointer hover:bg-gray-50" : ""} ${marcadas.has(k) ? "bg-blue-50" : ""}`}>
                    {puedeTratar && (
                      <td className="px-3 py-1.5"><input type="checkbox" checked={marcadas.has(k)} onChange={() => alternar(l)} onClick={e => e.stopPropagation()} /></td>
                    )}
                    <td className="px-3 py-1.5 font-mono whitespace-nowrap">{l.Lote}</td>
                    <td className="px-3 py-1.5"><span className="font-semibold">{l.Clase}</span> <span className="text-xs text-gray-500">{l.DescripcionClase}</span></td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{l.DescripcionTalla}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-gray-500">{fmtDia(l.FechaLote)}</td>
                    <td className={`px-3 py-1.5 text-right ${l.DiasAlPiso > 2 ? "text-amber-700 font-semibold" : ""}`}>{l.DiasAlPiso ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right font-semibold whitespace-nowrap">{fmtNum(l.Kg)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Los termos de la hoja ────────────────────────────────────────── */
// Los termos sin salida se marcan para sacarlos juntos ("Registrar salida"); "Corregir salida" sigue
// siendo de uno en uno.
function TablaTermos({ hoja, abierta, puedeCrear, puedeEditar, puedeBorrar, onSalidas, onCorregirSalida, onEditar, onQuitarSalida, onBorrar }) {
  const [marcados, setMarcados] = useState(new Set());
  const pendientes = hoja.Termos.filter(t => t.KgTratadas == null);
  const marcables = abierta && puedeCrear && pendientes.length > 0;
  const sel = pendientes.filter(t => marcados.has(t.TermoId));
  useEffect(() => { setMarcados(new Set()); }, [hoja]);
  const alternar = (id) => setMarcados(m => { const n = new Set(m); n.has(id) ? n.delete(id) : n.add(id); return n; });
  if (!hoja.Termos.length) {
    return <div className="bg-white border border-gray-300 rounded-lg px-4 py-6 text-center text-sm text-gray-400">
      Sin termos todavía. Marque lo del inventario al piso y use "Tratar".
    </div>;
  }
  return (
    <div className="bg-white border border-gray-300 rounded-lg overflow-x-auto">
      {marcables && (
        <div className="px-3 py-2 border-b flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">{pendientes.length} termo{pendientes.length !== 1 ? "s" : ""} sin salida</span>
          <button onClick={() => onSalidas(sel)} disabled={!sel.length}
            className="ml-auto bg-blue-600 text-white rounded px-3 py-1.5 text-xs font-semibold hover:bg-blue-700 disabled:opacity-40">
            {sel.length ? `Registrar salida (${sel.length})` : "Marque los termos que salen"}
          </button>
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
          <tr>
            {marcables && (
              <th className="px-2 py-2 w-8">
                <input type="checkbox" title="Marcar todos los que no han salido" checked={sel.length === pendientes.length}
                  onChange={e => setMarcados(e.target.checked ? new Set(pendientes.map(t => t.TermoId)) : new Set())} />
              </th>
            )}
            <th className="text-left px-2 py-2"># Termo</th><th className="text-left px-2 py-2">Lote</th><th className="text-left px-2 py-2">Talla</th>
            <th className="text-left px-2 py-2">Inicio</th><th className="text-left px-2 py-2">Salida</th>
            <th className="text-right px-2 py-2">Conteo ini.</th><th className="text-right px-2 py-2">Conteo fin.</th>
            <th className="text-left px-2 py-2">Tiempo</th><th className="text-left px-2 py-2">Químico</th><th className="text-left px-2 py-2">Corte</th>
            <th className="text-right px-2 py-2">Kg sin tratar</th><th className="text-right px-2 py-2">Kg tratadas</th>
            <th className="text-right px-2 py-2">% Pick-up</th><th className="text-left px-2 py-2">Va a</th><th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {hoja.Termos.map(t => (
            <tr key={t.TermoId} className={t.Alerta === "PERDIDA" ? "bg-red-50" : t.Alerta === "EXCEDE" ? "bg-amber-50" : t.KgTratadas == null ? "bg-blue-50/40" : ""}>
              {marcables && (
                <td className="px-2 py-1.5">
                  {t.KgTratadas == null && <input type="checkbox" checked={marcados.has(t.TermoId)} onChange={() => alternar(t.TermoId)} />}
                </td>
              )}
              <td className="px-2 py-1.5 font-mono font-semibold">{t.NumeroTermo}</td>
              <td className="px-2 py-1.5 font-mono whitespace-nowrap">{t.Lote}</td>
              <td className="px-2 py-1.5 whitespace-nowrap">{t.DescripcionTalla}</td>
              <td className="px-2 py-1.5">{hora(t.HoraInicio)}</td>
              <td className="px-2 py-1.5">{hora(t.HoraSalida) || <span className="text-blue-600 text-xs">en termo</span>}</td>
              <td className="px-2 py-1.5 text-right">{t.ConteoInicial ?? "—"}</td>
              <td className="px-2 py-1.5 text-right">{t.ConteoFinal ?? "—"}</td>
              <td className="px-2 py-1.5 whitespace-nowrap">{fmtTiempo(t.Minutos)}</td>
              <td className="px-2 py-1.5">{t.NombreQuimico || "—"}</td>
              <td className="px-2 py-1.5 text-xs text-gray-600 max-w-[10rem] truncate" title={t.DescripcionClase}>{t.Clase} {t.DescripcionClase}</td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap">
                {fmtNum(t.KgSinTratar)}
                {t.KgDiferencia ? <span className="block text-[10px] text-gray-400" title="Diferencia de báscula aceptada al registrar">+{fmtNum(t.KgDiferencia)} dif.</span> : null}
              </td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap">{t.KgTratadas != null ? fmtNum(t.KgTratadas) : "—"}</td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap"><Pickup valor={t.Pickup} alerta={t.Alerta} /></td>
              <td className="px-2 py-1.5 whitespace-nowrap">{t.NombreDestino || "—"}</td>
              <td className="px-2 py-1.5 whitespace-nowrap text-right space-x-1">
                {abierta && puedeCrear && (
                  <button onClick={() => (t.KgTratadas == null ? onSalidas([t]) : onCorregirSalida(t))}
                    className={`text-xs font-semibold rounded px-2 py-1 border ${t.KgTratadas == null ? "bg-blue-600 text-white border-blue-600 hover:bg-blue-700" : "text-blue-700 border-blue-300 hover:bg-blue-50"}`}>
                    {t.KgTratadas == null ? "Salida" : "Corregir salida"}
                  </button>
                )}
                {abierta && puedeEditar && <button onClick={() => onEditar(t)} className="text-xs text-gray-600 border border-gray-300 rounded px-2 py-1 hover:bg-gray-50">Editar</button>}
                {abierta && puedeEditar && t.KgTratadas != null && (
                  <button onClick={() => onQuitarSalida(t)} className="text-xs text-amber-700 border border-amber-300 rounded px-2 py-1 hover:bg-amber-50">Quitar salida</button>
                )}
                {abierta && puedeBorrar && <button onClick={() => onBorrar(t)} className="text-xs text-red-600 border border-red-200 rounded px-2 py-1 hover:bg-red-50">Quitar</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Totales({ t, pickupMaximo }) {
  return (
    <div className="bg-white border border-gray-300 rounded-lg px-4 py-3">
      <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Totales del turno</p>
      <div className={`grid grid-cols-2 gap-3 ${t.KgEnTermo > 0.001 ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
        <div><p className="text-xs text-gray-500">Kg recibidos</p><p className="text-xl font-semibold">{fmtNum(t.KgRecibidos)}</p></div>
        {/* Ganados y pick-up son de lo que ya salió: lo que sigue en el termo va aparte o "recibidos"
            contra "tratados" se lee como pérdida. */}
        {t.KgEnTermo > 0.001 && <div><p className="text-xs text-gray-500">En termo</p><p className="text-xl font-semibold text-blue-700">{fmtNum(t.KgEnTermo)}</p></div>}
        <div><p className="text-xs text-gray-500">Kg tratados</p><p className="text-xl font-semibold">{fmtNum(t.KgTratados)}</p></div>
        <div><p className="text-xs text-gray-500">Kg ganados</p><p className={`text-xl font-semibold ${t.KgGanados < 0 ? "text-red-600" : ""}`}>{fmtNum(t.KgGanados)}</p></div>
        <div><p className="text-xs text-gray-500">% Pick-up</p><Pickup valor={t.Pickup} alerta={t.Alerta} grande /></div>
      </div>
      <p className="text-xs text-gray-400 mt-2">
        Pick-up = (tratadas − sin tratar) ÷ sin tratar, de los termos que ya salieron. Alerta si es negativo o pasa de {pickupMaximo} %.
        {t.EnTermo > 0 ? ` ${t.EnTermo} termo${t.EnTermo > 1 ? "s" : ""} todavía en termo.` : ""}
        {t.Alertas > 0 ? ` ${t.Alertas} termo${t.Alertas > 1 ? "s" : ""} con alerta.` : ""}
      </p>
    </div>
  );
}

/* ── Insumos (solo el consumo) ────────────────────────────────────── */
function Insumos({ hoja, editable, onGuardar }) {
  const inicial = useMemo(() => Object.fromEntries(hoja.Insumos.map(i => [i.Codigo, i.Cantidad ?? ""])), [hoja]);
  const [valores, setValores] = useState(inicial);
  useEffect(() => setValores(inicial), [inicial]);
  const cambiado = hoja.Insumos.some(i => String(valores[i.Codigo] ?? "") !== String(inicial[i.Codigo] ?? ""));
  return (
    <div className="bg-white border border-gray-300 rounded-lg px-4 py-3">
      <div className="flex items-center mb-2">
        <p className="text-xs font-semibold text-gray-500 uppercase">Insumos — consumo de la hoja</p>
        {editable && cambiado && (
          <button onClick={() => onGuardar(hoja.Insumos.map(i => ({ Codigo: i.Codigo, Cantidad: valores[i.Codigo] })))}
            className="ml-auto text-xs font-semibold bg-blue-600 text-white rounded px-3 py-1 hover:bg-blue-700">Guardar insumos</button>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {hoja.Insumos.map(i => (
          <div key={i.Codigo}>
            <Etiqueta>{i.Nombre} ({i.UM.toLowerCase()})</Etiqueta>
            {editable ? (
              <input type="number" inputMode="decimal" step="0.01" min="0" value={valores[i.Codigo] ?? ""}
                onChange={e => setValores(v => ({ ...v, [i.Codigo]: e.target.value }))} className={campo} />
            ) : <p className="text-sm font-semibold">{i.Cantidad != null ? fmtNum(i.Cantidad) : "—"}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TratamientoPage() {
  const puedeCrear  = usePuede("tratamiento", "crear");
  const puedeEditar = usePuede("tratamiento", "editar");
  const puedeCerrar = usePuede("tratamiento", "cerrar");
  const puedeBorrar = usePuede("tratamiento", "eliminar");
  const { aviso, mostrarAlerta, pedirConfirmacion, cerrar } = useAviso();

  const [fecha, setFecha] = useState(hoyGT());
  const [hojas, setHojas] = useState([]);
  const [selId, setSelId] = useState(null);
  const [sel, setSel] = useState(null);
  const [saldo, setSaldo] = useState([]);
  const [cat, setCat] = useState({ Destinos: [], Insumos: [], Clientes: [], PickupMaximo: 20 });
  const [empleados, setEmpleados] = useState([]);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null);   // { tipo: "nueva" | "entrada" | "editar" | "salida" | "cerrar", ... }
  const [imprimir, setImprimir] = useState(false);   // la hoja seleccionada, para imprimir / PDF
  const [reporte, setReporte] = useState(false);     // el reporte de la jornada completa
  const [marcadas, setMarcadas] = useState(new Set());   // líneas del piso marcadas para tratar

  const quimicos = cat.Insumos.filter(i => i.EsQuimico);

  const fetchHojas = useCallback(async () => {
    try {
      const res = await fetch(`${API}/hojas?fecha=${fecha}`, { headers: authHeader() });
      const data = await leerJSON(res);
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setHojas(Array.isArray(data) ? data : []);
      setError("");
    } catch (e) { setHojas([]); setError(e.message || "No se pudo conectar con el servidor"); }
  }, [fecha]);

  const fetchSaldo = useCallback(async () => {
    const res = await fetch(`${API}/saldo`, { headers: authHeader() });
    const data = await leerJSON(res);
    setSaldo(Array.isArray(data) ? data : []);
  }, []);

  const abrirDetalle = useCallback(async (id) => {
    setSelId(id);
    const res = await fetch(`${API}/hojas/${id}`, { headers: authHeader() });
    const data = await leerJSON(res);
    if (!res.ok) { setSel(null); setError(data.error || "No se pudo abrir la hoja"); return; }
    setSel(data);
  }, []);

  useEffect(() => { fetchHojas(); fetchSaldo(); }, [fetchHojas, fetchSaldo]);
  useEffect(() => {
    fetch(`${API}/catalogos`, { headers: authHeader() }).then(leerJSON).then(d => d?.Destinos && setCat(d));
    fetch("/api/empleados", { headers: authHeader() }).then(leerJSON).then(d => Array.isArray(d) && setEmpleados(d.filter(e => e.Estado === "Activo")));
  }, []);
  // Con una sola hoja se abre sola; si la seleccionada ya no es de la jornada, se suelta.
  useEffect(() => {
    if (hojas.length === 1 && selId !== hojas[0].HojaId) abrirDetalle(hojas[0].HojaId);
    if (selId != null && !hojas.some(h => h.HojaId === selId)) { setSel(null); setSelId(null); }
  }, [hojas, selId, abrirDetalle]);

  const enviar = async (url, body, metodo = "POST") => {
    const res = await fetch(url, { method: metodo, headers: { "Content-Type": "application/json", ...authHeader() },
                                   body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await leerJSON(res);
    return { ok: res.ok, status: res.status, data };
  };
  const recargar = async (id = sel?.HojaId) => {
    await Promise.all([fetchHojas(), fetchSaldo()]);
    if (id) await abrirDetalle(id);
  };
  const conAviso = async (r) => {
    if (!r.ok) { await mostrarAlerta(r.data.error || `Error ${r.status}`); return false; }
    return true;
  };

  const abierta = sel?.Estatus === "Abierta";
  // El químico y el destino de un termo nuevo se sugieren del termo anterior de la hoja: casi
  // siempre son los mismos en todo el turno ("〃" en el papel).
  const ultimo = sel?.Termos?.length ? sel.Termos[sel.Termos.length - 1] : null;
  const quimicoSugerido = ultimo?.QuimicoCodigo ?? quimicos[0]?.Codigo ?? "";
  const destinoSugerido = [...(sel?.Termos ?? [])].reverse().find(t => t.BodegaDestino)?.BodegaDestino
    ?? cat.Destinos.find(d => d.Codigo === "TUNEL")?.Codigo ?? "";

  // Devuelve null si se guardó; si no, el error (con el renglón que falló) para que el modal lo marque.
  const tratar = async (datos) => {
    const r = await enviar(`${API}/tratar`, datos);
    if (!r.ok) return { error: r.data.error || `Error ${r.status}`, ...r.data };
    setModal(null);
    setMarcadas(new Set());
    await recargar(r.data.HojaId);
    return null;
  };

  const registrarSalidas = async (datos) => {
    const r = await enviar(`${API}/salidas`, datos);
    if (!r.ok) return { error: r.data.error || `Error ${r.status}`, ...r.data };
    setModal(null);
    await recargar();
    return null;
  };

  const editarEntrada = async (termo, datos) => {
    if (!(await conAviso(await enviar(`${API}/termos/${termo.TermoId}`, datos, "PUT")))) return;
    setModal(null);
    await recargar();
  };

  const registrarSalida = async (termo, datos) => {
    const r = await enviar(`${API}/termos/${termo.TermoId}/salida`, datos, "PUT");
    if (!(await conAviso(r))) return;
    setModal(null);
    await recargar();
  };

  const quitarSalida = async (termo) => {
    if (!(await pedirConfirmacion(`¿Quitar la salida del termo ${termo.NumeroTermo}? Lo tratado sale del piso de ${termo.NombreDestino} y el termo vuelve a quedar en termo.`))) return;
    if (await conAviso(await enviar(`${API}/termos/${termo.TermoId}/salida`, undefined, "DELETE"))) await recargar();
  };

  const borrarTermo = async (termo) => {
    if (!(await pedirConfirmacion(`¿Quitar el termo ${termo.NumeroTermo}? Sus ${fmtNum(termo.KgSinTratar)} kg vuelven al inventario al piso de Tratamiento.`))) return;
    if (await conAviso(await enviar(`${API}/termos/${termo.TermoId}`, undefined, "DELETE"))) await recargar();
  };

  const guardarInsumos = async (lista) => {
    if (await conAviso(await enviar(`${API}/hojas/${sel.HojaId}/insumos`, { Insumos: lista }, "PUT"))) await recargar();
  };

  const cambiarCliente = async (codigo) => {
    if (await conAviso(await enviar(`${API}/hojas/${sel.HojaId}`, { ClienteCodigo: Number(codigo) }, "PUT"))) await recargar();
  };

  const cerrarHoja = async (datos) => {
    if (!(await conAviso(await enviar(`${API}/hojas/${sel.HojaId}/cerrar`, datos)))) return;
    setModal(null);
    await recargar();
    // Cerrar es el momento de sacar el papel: la vista previa se abre sola, ya con los totales finales.
    setImprimir(true);
  };

  const reabrirHoja = async () => {
    if (!(await pedirConfirmacion("Se va a reabrir la hoja. Las diferencias de báscula que dejó el cierre se borran y esos kilos vuelven al piso."))) return;
    if (await conAviso(await enviar(`${API}/hojas/${sel.HojaId}/reabrir`, {}))) await recargar();
  };

  const eliminarHoja = async () => {
    if (!(await pedirConfirmacion(`¿Eliminar la hoja #${sel.HojaId}? Está vacía.`))) return;
    if (!(await conAviso(await enviar(`${API}/hojas/${sel.HojaId}`, undefined, "DELETE")))) return;
    setSel(null); setSelId(null);
    await recargar(null);
  };

  return (
    <div className="space-y-4">
      {aviso && <AvisoModal {...aviso} onCerrar={() => cerrar(true)} onCancelar={() => cerrar(false)} />}
      {modal?.tipo === "tratar" && (
        <ModalTratar lineas={modal.lineas} fecha={fecha} hojas={hojas} clientes={cat.Clientes} empleados={empleados}
          quimicos={quimicos} quimicoSugerido={quimicoSugerido} pedirConfirmacion={pedirConfirmacion}
          onConfirmar={tratar} onCerrar={() => setModal(null)} />
      )}
      {modal?.tipo === "salidas" && (
        <ModalSalidas termos={modal.termos} destinos={cat.Destinos} destinoSugerido={destinoSugerido} pickupMaximo={cat.PickupMaximo}
          onConfirmar={registrarSalidas} onCerrar={() => setModal(null)} />
      )}
      {modal?.tipo === "editar" && (
        <ModalEntrada termo={modal.termo} quimicos={quimicos} onConfirmar={d => editarEntrada(modal.termo, d)} onCerrar={() => setModal(null)} />
      )}
      {modal?.tipo === "salida" && (
        <ModalSalida termo={modal.termo} destinos={cat.Destinos} destinoSugerido={destinoSugerido} pickupMaximo={cat.PickupMaximo}
          onConfirmar={d => registrarSalida(modal.termo, d)} onCerrar={() => setModal(null)} />
      )}
      {modal?.tipo === "cerrar" && sel && <ModalCerrar hoja={sel} onConfirmar={cerrarHoja} onCerrar={() => setModal(null)} />}
      {imprimir && sel && <HojaTratamientoModal hoja={sel} pickupMaximo={cat.PickupMaximo} onCerrar={() => setImprimir(false)} />}
      {reporte && <ReporteTratamientoModal fecha={fecha} onCerrar={() => setReporte(false)} />}

      <div className="bg-white border border-gray-300 rounded-lg px-4 py-3 flex flex-wrap items-center gap-3">
        <h1 className="font-bold text-gray-800">Tratamiento de Camarón</h1>
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-gray-600">Jornada</label>
          <input type="date" value={fecha} onChange={e => { setFecha(e.target.value); setSel(null); setSelId(null); }}
            className="border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>
        <button onClick={() => recargar()} className="border border-gray-300 rounded px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50">Actualizar</button>
        {/* El reporte es del DÍA (todas las hojas), no de una: por eso vive en la barra de la jornada. */}
        <button onClick={() => setReporte(true)} className="border border-blue-300 text-blue-700 rounded px-3 py-1.5 text-xs font-semibold hover:bg-blue-50">
          Reporte del día
        </button>

      </div>

      {error && <div className="bg-red-50 border border-red-300 text-red-700 text-sm px-4 py-2 rounded">⚠ {error}</div>}

      <InventarioPiso saldo={saldo} puedeTratar={puedeCrear} marcadas={marcadas} setMarcadas={setMarcadas}
        onTratar={lineas => setModal({ tipo: "tratar", lineas })} />

      {hojas.length > 0 ? (
        <div className="bg-white border border-gray-300 rounded-lg px-4 py-2 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-gray-500 uppercase mr-1">Hojas de la jornada</span>
          {hojas.map(h => (
            <button key={h.HojaId} onClick={() => abrirDetalle(h.HojaId)}
              className={`rounded px-3 py-1 text-xs font-semibold border ${selId === h.HojaId ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
              #{h.HojaId} · {h.NombreCliente || "sin cliente"} · {h.Termos} termo{h.Termos !== 1 ? "s" : ""}
              <span className={`ml-1.5 font-normal ${h.Estatus === "Abierta" ? "text-green-500" : "opacity-60"}`}>{h.Estatus}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="bg-white border border-gray-300 rounded-lg px-4 py-8 text-center text-gray-400 text-sm">
          Sin hojas de tratamiento el {fmtDia(fecha)}. Marque lo del inventario al piso y use "Tratar": la hoja del cliente se abre sola.
        </div>
      )}

      {sel && (
        <div className="space-y-3">
          <div className="bg-gray-800 text-white rounded-lg px-4 py-3 flex flex-wrap items-center gap-4">
            <div className="min-w-0">
              <h2 className="font-bold">Hoja #{sel.HojaId} · {sel.NombreCliente || "sin cliente"}</h2>
              <p className="text-gray-300 text-xs mt-0.5">
                {[fmtDia(sel.FechaProduccion), sel.NombreEncargado || sel.Encargado,
                  sel.HoraInicio ? `inicio ${hora(sel.HoraInicio)}` : null, sel.HoraFin ? `fin ${hora(sel.HoraFin)}` : null,
                  sel.Personas != null ? `${sel.Personas} persona${sel.Personas !== 1 ? "s" : ""}` : null,
                  sel.Estatus].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button onClick={() => setImprimir(true)}
                title={abierta ? "Se imprime como borrador: la hoja sigue abierta" : "Imprimir o guardar como PDF"}
                className="border border-gray-500 rounded px-4 py-1.5 text-sm font-semibold hover:bg-gray-700">
                Imprimir
              </button>
              {abierta && puedeEditar && (
                <select value={sel.ClienteCodigo ?? ""} onChange={e => cambiarCliente(e.target.value)} title="Cliente previsto"
                  className="bg-gray-700 border border-gray-500 rounded px-2 py-1 text-xs max-w-[14rem]">
                  {cat.Clientes.map(c => <option key={c.Codigo} value={c.Codigo}>{c.RazonSocial}</option>)}
                </select>
              )}
              {abierta && puedeBorrar && sel.Termos.length === 0 && (
                <button onClick={eliminarHoja} className="border border-gray-500 rounded px-3 py-1.5 text-sm hover:bg-gray-700">Eliminar</button>
              )}
              {abierta && puedeCerrar && (
                <button onClick={() => setModal({ tipo: "cerrar" })} className="bg-green-600 rounded px-4 py-1.5 text-sm font-semibold hover:bg-green-700">Cerrar hoja</button>
              )}
              {!abierta && puedeCerrar && (
                <button onClick={reabrirHoja} className="bg-amber-600 rounded px-4 py-1.5 text-sm font-semibold hover:bg-amber-700">Reabrir</button>
              )}
            </div>
          </div>

          <Totales t={sel.Totales} pickupMaximo={cat.PickupMaximo} />
          <TablaTermos hoja={sel} abierta={abierta} puedeCrear={puedeCrear} puedeEditar={puedeEditar} puedeBorrar={puedeBorrar}
            onSalidas={ts => setModal({ tipo: "salidas", termos: ts })} onCorregirSalida={t => setModal({ tipo: "salida", termo: t })}
            onEditar={t => setModal({ tipo: "editar", termo: t })}
            onQuitarSalida={quitarSalida} onBorrar={borrarTermo} />
          <Insumos hoja={sel} editable={abierta && puedeEditar} onGuardar={guardarInsumos} />

          {!abierta && sel.Lineas.some(l => l.KgDiferencia > 0) && (
            <div className="bg-white border border-gray-300 rounded-lg px-4 py-3 text-sm">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Diferencias de báscula al cerrar</p>
              {sel.Lineas.filter(l => l.KgDiferencia > 0).map(l => (
                <p key={l.Clave}><span className="font-mono">{l.Lote}</span> · {l.Clase} · {l.DescripcionTalla ?? l.Talla}: <b>{fmtNum(l.KgDiferencia)} kg</b></p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
