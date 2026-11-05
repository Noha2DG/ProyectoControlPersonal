import { useState, useMemo } from "react";
import { API, enviar, leerPegado, fLb, fUsd, fFecha, sumarDias, contenedores, textoDifPago, plural } from "../utils/importaciones.js";
import { input, btnPri, btnSec, caja, Campo, Aviso } from "./ImportacionUI.jsx";

// Registrar o corregir una solicitud en UNA pantalla, con las columnas de BASE DAtos: proveedor,
// proforma, fechas y, por talla, clase, descripción, libras y costo por libra. La fecha de pago se
// sugiere (llegada − días del parámetro) hasta que alguien la cambia: es la negociada en cada proforma.
const lineaVacia = (u = {}) => ({ Clase: u.Clase || "B", Descripcion: u.Descripcion || "", Talla: u.Talla || "", Libras: "", CostoLb: "" });

export default function ImportacionForm({ opciones, solicitud, descripciones, onGuardado, onCancelar }) {
  const { hoy, parametros, tallas, proveedores } = opciones;
  const editando = Boolean(solicitud);
  const [f, setF] = useState(() => {
    if (solicitud) return {
      ProveedorId: solicitud.ProveedorId, Proforma: solicitud.Proforma, FechaPedido: solicitud.FechaPedido || "",
      FechaSalida: solicitud.FechaSalida || "", FechaLlegada: solicitud.FechaLlegada, FechaPago: solicitud.FechaPago,
      Notas: solicitud.Notas || "", pagoAuto: false,
      lineas: solicitud.lineas.map(l => ({ Clase: l.Clase, Descripcion: l.Descripcion || "", Talla: l.Talla, Libras: l.Libras, CostoLb: l.CostoLb })),
    };
    const llegada = sumarDias(hoy, 30);
    return {
      ProveedorId: "", Proforma: "", FechaPedido: hoy, FechaSalida: "", FechaLlegada: llegada,
      FechaPago: sumarDias(llegada, -parametros.diasPago), Notas: "", pagoAuto: true,
      lineas: [lineaVacia({ Talla: tallas.find(t => t.Descripcion === "26/30")?.Codigo ?? tallas[0]?.Codigo })],
    };
  });
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [pegado, setPegado] = useState("");
  const [verPegado, setVerPegado] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const poner = (k, v) => setF(p => {
    const n = { ...p, [k]: v };
    if (k === "FechaLlegada" && p.pagoAuto && v) n.FechaPago = sumarDias(v, -parametros.diasPago);
    if (k === "FechaPago") n.pagoAuto = false;
    return n;
  });
  const ponerLinea = (i, k, v) => setF(p => ({ ...p, lineas: p.lineas.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  const quitarLinea = (i) => setF(p => ({ ...p, lineas: p.lineas.length > 1 ? p.lineas.filter((_, j) => j !== i) : [lineaVacia()] }));
  const agregarLinea = () => setF(p => ({ ...p, lineas: [...p.lineas, lineaVacia(p.lineas[p.lineas.length - 1])] }));

  const conLibras = f.lineas.filter(l => Number(l.Libras) > 0);
  const lb = conLibras.reduce((a, l) => a + Number(l.Libras), 0);
  const usd = conLibras.reduce((a, l) => a + Number(l.Libras) * (Number(l.CostoLb) || 0), 0);
  const n = contenedores(lb || 1, parametros.lbContenedor);
  const llenado = lb ? Math.round((lb / (n * parametros.lbContenedor)) * 100) : 0;

  // Proveedores activos, más el de la solicitud aunque ya esté inactivo (se sigue pudiendo corregir).
  const provs = useMemo(() => proveedores.filter(p => p.Activo || p.ProveedorId === solicitud?.ProveedorId), [proveedores, solicitud]);

  const fechasRaras = f.FechaSalida && f.FechaLlegada && f.FechaSalida > f.FechaLlegada
    ? `La salida (${fFecha(f.FechaSalida)}) es posterior a la llegada (${fFecha(f.FechaLlegada)}).`
    : f.FechaPedido && f.FechaSalida && f.FechaPedido > f.FechaSalida
      ? `La fecha de pedido (${fFecha(f.FechaPedido)}) es posterior a la salida (${fFecha(f.FechaSalida)}).` : null;

  const cargarPegado = () => {
    const r = leerPegado(pegado, tallas, proveedores);
    if (!r.lineas.length) {
      setError(r.sinTalla.length ? `Ninguna talla coincide con las del módulo: ${r.sinTalla.join(", ")}.` : "No encontré filas con libras. Copia las celdas del Excel tal cual, con sus tabulaciones.");
      return;
    }
    setF(p => {
      const n = { ...p, lineas: r.lineas };
      for (const [k, v] of Object.entries(r.enc)) if (v) n[k] = v;
      if (r.enc.FechaPago) n.pagoAuto = false;
      return n;
    });
    setError(null);
    setAviso(`${r.lineas.length} fila${plural(r.lineas.length)} cargada${plural(r.lineas.length)} desde el Excel.`
      + (r.enc.ProveedorId === "" ? " No reconocí el proveedor: elígelo." : "")
      + (r.sinTalla.length ? ` Sin talla del módulo (no se cargaron): ${r.sinTalla.join(", ")}.` : "")
      + " La fecha de pedido del Excel no se usa: pon la real.");
    setPegado(""); setVerPegado(false);
  };

  const guardar = async () => {
    setError(null);
    const cuerpo = {
      ProveedorId: Number(f.ProveedorId), Proforma: f.Proforma, FechaPedido: f.FechaPedido, FechaSalida: f.FechaSalida || null,
      FechaLlegada: f.FechaLlegada, FechaPago: f.FechaPago, Notas: f.Notas,
      lineas: conLibras.map(l => ({ ...l, Talla: Number(l.Talla) })),
    };
    setGuardando(true);
    try {
      const r = editando
        ? await enviar(`${API}/solicitudes/${solicitud.SolicitudId}`, "PUT", cuerpo)
        : await enviar(`${API}/solicitudes`, "POST", cuerpo);
      onGuardado(r.SolicitudId, !editando, r.Folio);
    } catch (e) {
      setError(e.message);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally { setGuardando(false); }
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-bold text-gray-800">{editando ? `Corregir ${solicitud.Folio}` : "Nueva solicitud de materia prima"}</h3>
        <button onClick={() => setVerPegado(v => !v)} className={`${btnSec} ml-auto`}>Pegar desde Excel</button>
      </div>
      {error && <Aviso>{error}</Aviso>}
      {aviso && <Aviso tipo="ok">{aviso}</Aviso>}

      {verPegado && (
        <div className={`${caja} p-4 space-y-2`}>
          <p className="text-sm text-gray-700">Copia las filas de la hoja <b>BASE DAtos</b> (de Proveedor a Total) o solo las columnas Clase, Descripción, Talla, Libras y Costo, y pégalas aquí.</p>
          <textarea value={pegado} onChange={e => setPegado(e.target.value)} rows={5} className={`${input} w-full font-mono text-xs`}
            placeholder={"Clase B\tVANNAMEI HLSO B 8X5 LBS KRAFT\t26-30\t8000\t2.95"} />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setVerPegado(false)} className={btnSec}>Cancelar</button>
            <button onClick={cargarPegado} disabled={!pegado.trim()} className={btnPri}>Cargar filas</button>
          </div>
        </div>
      )}

      <div className={`${caja} p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4`}>
        <Campo etiqueta="Proveedor">
          <select value={f.ProveedorId} onChange={e => poner("ProveedorId", e.target.value)} className={input}>
            <option value="">— Elige —</option>
            {provs.map(p => <option key={p.ProveedorId} value={p.ProveedorId}>{p.Nombre}{p.Activo ? "" : " (inactivo)"}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Número de proforma">
          <input value={f.Proforma} onChange={e => poner("Proforma", e.target.value)} maxLength={40} className={input} placeholder="2026-000123" />
        </Campo>
        <Campo etiqueta="Fecha de pedido"
          pista={solicitud?.Origen === "EXCEL" ? "Cargada del Excel: no tenía fecha de pedido. Puedes dejarla vacía." : "Cuándo se hizo el pedido al proveedor."}>
          <input type="date" value={f.FechaPedido} onChange={e => poner("FechaPedido", e.target.value)} className={input} />
        </Campo>
        <Campo etiqueta="Fecha de salida (ETD)" pista="Opcional si aún no se conoce.">
          <input type="date" value={f.FechaSalida} onChange={e => poner("FechaSalida", e.target.value)} className={input} />
        </Campo>
        <Campo etiqueta="Fecha de llegada (ETA)">
          <input type="date" value={f.FechaLlegada} onChange={e => poner("FechaLlegada", e.target.value)} className={input} />
        </Campo>
        <Campo etiqueta="Fecha de pago"
          pista={f.pagoAuto ? `Sugerida: llegada − ${parametros.diasPago} días. Cámbiala si el proveedor negoció otra.` : textoDifPago(f.FechaPago, f.FechaLlegada)}>
          <input type="date" value={f.FechaPago} onChange={e => poner("FechaPago", e.target.value)} className={input} />
        </Campo>
        {fechasRaras && <div className="sm:col-span-2 lg:col-span-3"><Aviso tipo="aviso">{fechasRaras} Revisa las fechas.</Aviso></div>}
      </div>

      <div className={`${caja} overflow-x-auto`}>
        <table className="w-full text-sm min-w-[760px]">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2 text-left w-20">Clase</th>
              <th className="px-3 py-2 text-left">Descripción</th>
              <th className="px-3 py-2 text-left w-28">Talla</th>
              <th className="px-3 py-2 text-right w-32">Libras</th>
              <th className="px-3 py-2 text-right w-28">Costo $/lb</th>
              <th className="px-3 py-2 text-right w-32">Total</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {f.lineas.map((l, i) => (
              <tr key={i}>
                <td className="px-2 py-1.5">
                  <select value={l.Clase} onChange={e => ponerLinea(i, "Clase", e.target.value)} className={`${input} w-full px-2`} aria-label={`Clase, línea ${i + 1}`}>
                    {["A", "B", "C"].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <input value={l.Descripcion} onChange={e => ponerLinea(i, "Descripcion", e.target.value)} list="imp-descripciones" maxLength={100}
                    className={`${input} w-full`} aria-label={`Descripción, línea ${i + 1}`} placeholder="VANNAMEI HLSO B 8X5 LBS KRAFT" />
                </td>
                <td className="px-2 py-1.5">
                  <select value={l.Talla} onChange={e => ponerLinea(i, "Talla", e.target.value)} className={`${input} w-full px-2`} aria-label={`Talla, línea ${i + 1}`}>
                    <option value="">—</option>
                    {tallas.map(t => <option key={t.Codigo} value={t.Codigo}>{t.Descripcion}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <input type="number" min="0" step="1" value={l.Libras} onChange={e => ponerLinea(i, "Libras", e.target.value)}
                    className={`${input} w-full text-right tabular-nums`} aria-label={`Libras, línea ${i + 1}`} />
                </td>
                <td className="px-2 py-1.5">
                  <input type="number" min="0" step="0.01" value={l.CostoLb} onChange={e => ponerLinea(i, "CostoLb", e.target.value)}
                    className={`${input} w-full text-right tabular-nums`} aria-label={`Costo por libra, línea ${i + 1}`} />
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{fUsd((Number(l.Libras) || 0) * (Number(l.CostoLb) || 0))}</td>
                <td className="px-1 py-1.5 text-center">
                  <button onClick={() => quitarLinea(i)} title="Quitar línea" aria-label={`Quitar línea ${i + 1}`} className="text-gray-400 hover:text-red-600 text-lg leading-none px-1">×</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 font-semibold text-gray-800">
            <tr>
              <td colSpan={3} className="px-3 py-2">
                <button onClick={agregarLinea} className="text-blue-700 hover:text-blue-900 text-sm font-semibold">+ Agregar talla</button>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{fLb(lb)}</td>
              <td />
              <td className="px-3 py-2 text-right tabular-nums">{fUsd(usd)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
        <datalist id="imp-descripciones">{descripciones.map(d => <option key={d} value={d} />)}</datalist>
      </div>

      {lb > 0 && (
        <p className="text-sm text-gray-600">
          {fLb(lb)} lb ≈ <b>{n} contenedor{plural(n, "es")}</b> de {fLb(parametros.lbContenedor)} lb ({llenado} % de la capacidad).
        </p>
      )}

      <Campo etiqueta="Notas" className="max-w-3xl">
        <textarea value={f.Notas} onChange={e => poner("Notas", e.target.value)} rows={2} maxLength={500} className={input} />
      </Campo>

      <div className="flex gap-2 justify-end max-w-5xl">
        <button onClick={onCancelar} className={btnSec}>Cancelar</button>
        <button onClick={guardar} disabled={guardando} className={btnPri}>{guardando ? "Guardando…" : editando ? "Guardar cambios" : "Registrar solicitud"}</button>
      </div>
    </div>
  );
}
