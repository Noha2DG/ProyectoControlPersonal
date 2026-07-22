import { useState, useEffect, useCallback, useMemo } from "react";
import { authHeader } from "../context/AuthContext.jsx";
import { useColWidths, Th, Colgroup } from "../components/ResizableTh.jsx";

const API = "/api/bodega-fisica/existencias";

const COL_DEFAULTS = {
  pedido: 90, cliente: 170, lote: 110, polin: 100, ubicacion: 140, posicion: 100, area: 110,
  clase: 150, talla: 90, presentacion: 180, fecha: 100, master: 80, cajas: 80, kilos: 100, libras: 100,
};
const COLS = Object.keys(COL_DEFAULTS);

// Ubicación separa lo que ya está sellado en bodega física de lo que todavía está en su área de
// origen (Abierto = se sigue llenando; Cerrado = ya se cerró pero sigue pendiente de ubicar). Es la
// columna que distingue "dónde está FÍSICAMENTE hoy" — Área (oe.AreaCodigo) es de dónde VINO y no
// cambia nunca (ver la duda anterior sobre el área del túnel).
const UBICACIONES = ["Bodega", "Cerrado (pendiente)", "Abierto"];
function ubicacionDe(f) {
  if (f.PosicionId != null) return "Bodega";
  return f.Estatus === "Cerrado" ? "Cerrado (pendiente)" : "Abierto";
}
const UBICACION_BADGE = {
  "Bodega":              "bg-green-100 text-green-700",
  "Cerrado (pendiente)": "bg-amber-100 text-amber-700",
  "Abierto":             "bg-blue-100 text-blue-700",
};

// Cada select de filtro se construye a partir de los valores distintos que ya trajo el fetch — no
// hay endpoint aparte de catálogos: son los mismos datos, solo mirados por otra columna.
function opcionesDe(filas, campo) {
  return [...new Set(filas.map(f => f[campo]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
}

function fmtFecha(iso) {
  return iso ? iso.split("-").reverse().join("/") : "-";
}

const FILTRO_INICIAL = { Cliente: "", Clase: "", Talla: "", Ubicacion: "", Buscar: "" };

export default function ExistenciaBodegaPage() {
  const [filas, setFilas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtros, setFiltros] = useState(FILTRO_INICIAL);
  const [widths, startResize] = useColWidths("existenciaBodega", COL_DEFAULTS);

  const fetchDatos = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(API, { headers: authHeader() });
      const data = await res.json();
      if (Array.isArray(data)) setFilas(data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchDatos(); }, [fetchDatos]);

  const opciones = useMemo(() => ({
    Cliente: opcionesDe(filas, "Cliente"),
    Clase: opcionesDe(filas, "Clase"),
    Talla: opcionesDe(filas, "Talla"),
  }), [filas]);

  const filtradas = useMemo(() => {
    const buscar = filtros.Buscar.trim().toLowerCase();
    return filas.filter(f =>
      (!filtros.Cliente || f.Cliente === filtros.Cliente) &&
      (!filtros.Clase || f.Clase === filtros.Clase) &&
      (!filtros.Talla || f.Talla === filtros.Talla) &&
      (!filtros.Ubicacion || ubicacionDe(f) === filtros.Ubicacion) &&
      (!buscar ||
        f.Lote?.toLowerCase().includes(buscar) ||
        f.Polin?.toLowerCase().includes(buscar) ||
        f.Pedido?.toLowerCase().includes(buscar) ||
        f.PosicionCodigo?.toLowerCase().includes(buscar))
    );
  }, [filas, filtros]);

  const totales = useMemo(() => filtradas.reduce((acc, f) => ({
    Master: acc.Master + f.Master, Cajas: acc.Cajas + f.Cajas,
    KilosBrutos: acc.KilosBrutos + f.KilosBrutos, Libras: acc.Libras + f.Libras,
  }), { Master: 0, Cajas: 0, KilosBrutos: 0, Libras: 0 }), [filtradas]);

  const hayFiltros = Object.values(filtros).some(Boolean);
  const limpiarFiltros = () => setFiltros(FILTRO_INICIAL);

  const selectFiltro = (campo, label, valores) => (
    <select value={filtros[campo]} onChange={e => setFiltros(p => ({ ...p, [campo]: e.target.value }))}
      className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white">
      <option value="">{label}</option>
      {valores.map(v => <option key={v} value={v}>{v}</option>)}
    </select>
  );

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center mb-4">
        {selectFiltro("Ubicacion", "Bodega y áreas", UBICACIONES)}
        {selectFiltro("Cliente", "Todos los clientes", opciones.Cliente)}
        {selectFiltro("Clase", "Todas las clases", opciones.Clase)}
        {selectFiltro("Talla", "Todas las tallas", opciones.Talla)}
        <input type="text" placeholder="Buscar Pedido, Polín, Lote o Posición..." value={filtros.Buscar}
          onChange={e => setFiltros(p => ({ ...p, Buscar: e.target.value }))}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-400" />
        {hayFiltros && (
          <button onClick={limpiarFiltros} className="text-gray-500 hover:text-gray-700 text-xs font-medium px-2 py-1.5">
            Limpiar filtros
          </button>
        )}
        <button onClick={fetchDatos} className="text-blue-600 hover:text-blue-800 text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-blue-50 border border-blue-200 transition">
          Actualizar
        </button>
        <span className="text-sm text-gray-500 ml-auto">
          {filtradas.length} pol{filtradas.length !== 1 ? "ines" : "ín"}
        </span>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm table-fixed">
              <Colgroup columns={COLS} widths={widths} />
              <thead>
                <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                  <Th width={widths.pedido} onResizeStart={startResize("pedido")} className="px-4 py-3 text-left">Pedido</Th>
                  <Th width={widths.cliente} onResizeStart={startResize("cliente")} className="px-4 py-3 text-left">Cliente</Th>
                  <Th width={widths.lote} onResizeStart={startResize("lote")} className="px-4 py-3 text-left">Lote</Th>
                  <Th width={widths.polin} onResizeStart={startResize("polin")} className="px-4 py-3 text-left">Polín</Th>
                  <Th width={widths.ubicacion} onResizeStart={startResize("ubicacion")} className="px-4 py-3 text-left">Ubicación</Th>
                  <Th width={widths.posicion} onResizeStart={startResize("posicion")} className="px-4 py-3 text-left">Posición</Th>
                  <Th width={widths.area} onResizeStart={startResize("area")} className="px-4 py-3 text-left">Área (origen)</Th>
                  <Th width={widths.clase} onResizeStart={startResize("clase")} className="px-4 py-3 text-left">Clase</Th>
                  <Th width={widths.talla} onResizeStart={startResize("talla")} className="px-4 py-3 text-left">Talla</Th>
                  <Th width={widths.presentacion} onResizeStart={startResize("presentacion")} className="px-4 py-3 text-left">Presentación</Th>
                  <Th width={widths.fecha} onResizeStart={startResize("fecha")} className="px-4 py-3 text-left">Fecha</Th>
                  <Th width={widths.master} onResizeStart={startResize("master")} className="px-4 py-3 text-right">Master</Th>
                  <Th width={widths.cajas} onResizeStart={startResize("cajas")} className="px-4 py-3 text-right">Cajas</Th>
                  <Th width={widths.kilos} onResizeStart={startResize("kilos")} className="px-4 py-3 text-right">Kilos Brutos</Th>
                  <Th width={widths.libras} onResizeStart={startResize("libras")} className="px-4 py-3 text-right">Libras</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtradas.length === 0 ? (
                  <tr><td colSpan={COLS.length} className="px-4 py-10 text-center text-gray-400">
                    {filas.length === 0 ? "No hay pallets escaneados todavía" : "Ningún polín coincide con los filtros"}
                  </td></tr>
                ) : filtradas.map((f, i) => {
                  const ubicacion = ubicacionDe(f);
                  return (
                    <tr key={i} className="hover:bg-gray-50 transition">
                      <td className="px-4 py-2.5 font-mono text-gray-700">{f.Pedido}</td>
                      <td className="px-4 py-2.5 text-gray-900 truncate" title={f.Subcliente ? `${f.Cliente} · ${f.Subcliente}` : f.Cliente}>
                        {f.Cliente}{f.Subcliente ? <span className="text-gray-400"> · {f.Subcliente}</span> : ""}
                      </td>
                      <td className="px-4 py-2.5 font-mono font-semibold text-gray-700">{f.Lote}</td>
                      <td className="px-4 py-2.5 font-mono font-bold text-blue-700">{f.Polin}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${UBICACION_BADGE[ubicacion]}`}>{ubicacion}</span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-gray-600">{f.PosicionCodigo || "-"}</td>
                      <td className="px-4 py-2.5 text-gray-600 truncate" title={f.NombreArea}>{f.NombreArea || "-"}</td>
                      <td className="px-4 py-2.5 text-gray-600 truncate" title={f.Clase}>{f.Clase}</td>
                      <td className="px-4 py-2.5 text-gray-600">{f.Talla}</td>
                      <td className="px-4 py-2.5 text-gray-600 truncate" title={f.Presentacion}>{f.Presentacion}</td>
                      <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{fmtFecha(f.Fecha)}</td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">{f.Master}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{f.Cajas}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{f.KilosBrutos.toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{f.Libras.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
              {filtradas.length > 0 && (
                <tfoot>
                  <tr className="bg-gray-50 border-t-2 border-gray-200 font-bold text-gray-700">
                    <td colSpan={11} className="px-4 py-2.5 text-right text-xs uppercase tracking-wide text-gray-500">Total</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{totales.Master}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{totales.Cajas}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{totales.KilosBrutos.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{totales.Libras.toFixed(2)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
