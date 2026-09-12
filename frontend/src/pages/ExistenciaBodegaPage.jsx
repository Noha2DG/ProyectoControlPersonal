import { useState, useEffect, useCallback, useMemo } from "react";
import { fmtEntero, fmtNum } from "../utils/numero.js";
import { authHeader } from "../context/AuthContext.jsx";
import { useColWidths, useOrden, ordenarFilas, Th, Colgroup } from "../components/ResizableTh.jsx";
import { exportarExistenciaBodega } from "../utils/exportExcel.js";

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

// Lista propia en vez de <input list>+<datalist>: el datalist nativo del navegador no siempre
// dispara el evento que React escucha al hacer clic en una sugerencia (varía según navegador), así
// que la selección se veía en la caja pero el filtro no se aplicaba hasta que algo más —como el
// botón Actualizar— forzaba un re-render. Con una lista propia (mismo patrón que
// EmpleadoAutocomplete.jsx) la selección es un onMouseDown normal de React: siempre actualiza el
// estado al instante.
function FiltroBusqueda({ valor, onChange, opciones, placeholder, anchoClase = "w-36" }) {
  const [abierto, setAbierto] = useState(false);
  const [resaltado, setResaltado] = useState(-1);
  const q = valor.trim().toLowerCase();
  const sugerencias = q ? opciones.filter(o => o.toLowerCase().includes(q)).slice(0, 12) : opciones.slice(0, 12);

  const seleccionar = (v) => { onChange(v); setAbierto(false); setResaltado(-1); };

  // Tab NO se cancela (preventDefault): el foco tiene que seguir avanzando al siguiente campo,
  // igual que un Tab normal — solo se aprovecha la tecla para completar con lo resaltado (o la
  // primera sugerencia si el usuario no navegó con flechas) antes de que el campo pierda el foco.
  const handleKeyDown = (e) => {
    if (!abierto || !sugerencias.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setResaltado(i => Math.min(i + 1, sugerencias.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setResaltado(i => Math.max(i - 1, 0)); }
    else if (e.key === "Tab" || e.key === "Enter") {
      const elegido = sugerencias[resaltado >= 0 ? resaltado : 0];
      if (e.key === "Enter") e.preventDefault();
      seleccionar(elegido);
    } else if (e.key === "Escape") { setAbierto(false); setResaltado(-1); }
  };

  return (
    <div className={`relative ${anchoClase}`}>
      <input value={valor} onChange={e => { onChange(e.target.value); setResaltado(-1); }}
        onKeyDown={handleKeyDown}
        onFocus={() => setAbierto(true)} onBlur={() => setTimeout(() => setAbierto(false), 150)}
        placeholder={placeholder} title={valor} autoComplete="off"
        className="w-full border border-gray-300 rounded-lg pl-2.5 pr-6 py-1.5 text-sm truncate focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
      {valor && (
        <button type="button" onMouseDown={e => { e.preventDefault(); onChange(""); }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm leading-none">
          &times;
        </button>
      )}
      {abierto && sugerencias.length > 0 && (
        <ul className="absolute z-20 w-max min-w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {sugerencias.map((o, i) => (
            <li key={o} onMouseDown={() => seleccionar(o)} onMouseEnter={() => setResaltado(i)}
              className={`px-3 py-1.5 text-sm cursor-pointer whitespace-nowrap ${i === resaltado ? "bg-blue-50" : "hover:bg-blue-50"}`}>
              {o}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const FILTRO_INICIAL = { Cliente: "", Clase: "", Talla: "", Presentacion: "", Ubicacion: "", Buscar: "" };

// Coincidencia parcial, sin distinguir mayúsculas — lo que espera un filtro donde SE ESCRIBE (a
// diferencia de un <select>, donde solo cabe la igualdad exacta contra una opción de la lista).
function contiene(valor, filtro) {
  const f = filtro.trim().toLowerCase();
  return !f || (valor ?? "").toLowerCase().includes(f);
}

export default function ExistenciaBodegaPage() {
  const [filas, setFilas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtros, setFiltros] = useState(FILTRO_INICIAL);
  const [widths, startResize] = useColWidths("existenciaBodega", COL_DEFAULTS);
  const [orden, alternarOrden] = useOrden();

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
    Presentacion: opcionesDe(filas, "Presentacion"),
  }), [filas]);

  const filtradas = useMemo(() => {
    const buscar = filtros.Buscar.trim().toLowerCase();
    return filas.filter(f =>
      contiene(f.Cliente, filtros.Cliente) &&
      contiene(f.Clase, filtros.Clase) &&
      contiene(f.Talla, filtros.Talla) &&
      contiene(f.Presentacion, filtros.Presentacion) &&
      contiene(ubicacionDe(f), filtros.Ubicacion) &&
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

  // Master/Cajas/Kilos/Libras se comparan como números, no por el texto con decimales.
  const ordenadas = ordenarFilas(filtradas, orden, {
    pedido: f => f.Pedido, cliente: f => f.Cliente, lote: f => f.Lote, polin: f => f.Polin,
    ubicacion: f => ubicacionDe(f), posicion: f => f.PosicionCodigo, area: f => f.NombreArea,
    clase: f => f.Clase, talla: f => f.Talla, presentacion: f => f.Presentacion,
    fecha: f => f.Fecha, master: f => f.Master, cajas: f => f.Cajas,
    kilos: f => f.KilosBrutos, libras: f => f.Libras,
  });

  const hayFiltros = Object.values(filtros).some(Boolean);
  const limpiarFiltros = () => setFiltros(FILTRO_INICIAL);

  const inputFiltro = (campo, label, valores, anchoClase = "w-36") => (
    <FiltroBusqueda valor={filtros[campo]} onChange={v => setFiltros(p => ({ ...p, [campo]: v }))}
      opciones={valores} placeholder={label} anchoClase={anchoClase} />
  );

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center mb-4">
        {inputFiltro("Ubicacion", "Bodega y áreas", UBICACIONES, "w-36")}
        {inputFiltro("Cliente", "Todos los clientes", opciones.Cliente, "w-40")}
        {inputFiltro("Clase", "Todas las clases", opciones.Clase, "w-36")}
        {inputFiltro("Talla", "Todas las tallas", opciones.Talla, "w-28")}
        {inputFiltro("Presentacion", "Todas las presentaciones", opciones.Presentacion, "w-40")}
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
        <button onClick={() => exportarExistenciaBodega(ordenadas, ubicacionDe)}
          disabled={!filtradas.length}
          className="flex items-center gap-1.5 bg-green-600 text-white text-sm font-semibold px-3 py-1.5 rounded-lg hover:bg-green-700 transition disabled:opacity-50 disabled:hover:bg-green-600">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M10 3a.75.75 0 01.75.75v6.19l2.22-2.22a.75.75 0 111.06 1.06l-3.5 3.5a.75.75 0 01-1.06 0l-3.5-3.5a.75.75 0 111.06-1.06l2.22 2.22V3.75A.75.75 0 0110 3z" clipRule="evenodd" />
            <path d="M3.5 12.75a.75.75 0 01.75.75v2.5c0 .414.336.75.75.75h10a.75.75 0 00.75-.75v-2.5a.75.75 0 011.5 0v2.5A2.25 2.25 0 0115 18.5H5a2.25 2.25 0 01-2.25-2.25v-2.5a.75.75 0 01.75-.75z" />
          </svg>
          Exportar a Excel
        </button>
        <div className="text-sm text-gray-500 ml-auto text-right leading-tight">
          <p>{filtradas.length} pol{filtradas.length !== 1 ? "ines" : "ín"}</p>
          <p className="font-semibold text-gray-700">{fmtNum(totales.Libras)} Lb</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          {/* Alto fijo con su propio scroll — 1500+ polines sin esto hacían crecer la página entera
              y perdían de vista los filtros y el total de arriba. El encabezado va `sticky` para
              seguir viéndose mientras se navega la tabla. */}
          <div className="overflow-auto max-h-[640px]">
            <table className="w-full text-sm table-fixed">
              <Colgroup columns={COLS} widths={widths} />
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider">
                  <Th width={widths.pedido} onResizeStart={startResize("pedido")} sortKey="pedido" orden={orden} onOrdenar={alternarOrden} className="px-4 py-3 text-left">Pedido</Th>
                  <Th width={widths.cliente} onResizeStart={startResize("cliente")} sortKey="cliente" orden={orden} onOrdenar={alternarOrden} className="px-4 py-3 text-left">Cliente</Th>
                  <Th width={widths.lote} onResizeStart={startResize("lote")} sortKey="lote" orden={orden} onOrdenar={alternarOrden} className="px-4 py-3 text-left">Lote</Th>
                  <Th width={widths.polin} onResizeStart={startResize("polin")} sortKey="polin" orden={orden} onOrdenar={alternarOrden} className="px-4 py-3 text-left">Polín</Th>
                  <Th width={widths.ubicacion} onResizeStart={startResize("ubicacion")} sortKey="ubicacion" orden={orden} onOrdenar={alternarOrden} className="px-4 py-3 text-left">Ubicación</Th>
                  <Th width={widths.posicion} onResizeStart={startResize("posicion")} sortKey="posicion" orden={orden} onOrdenar={alternarOrden} className="px-4 py-3 text-left">Posición</Th>
                  <Th width={widths.area} onResizeStart={startResize("area")} sortKey="area" orden={orden} onOrdenar={alternarOrden} className="px-4 py-3 text-left">Área (origen)</Th>
                  <Th width={widths.clase} onResizeStart={startResize("clase")} sortKey="clase" orden={orden} onOrdenar={alternarOrden} className="px-4 py-3 text-left">Clase</Th>
                  <Th width={widths.talla} onResizeStart={startResize("talla")} sortKey="talla" orden={orden} onOrdenar={alternarOrden} className="px-4 py-3 text-left">Talla</Th>
                  <Th width={widths.presentacion} onResizeStart={startResize("presentacion")} sortKey="presentacion" orden={orden} onOrdenar={alternarOrden} className="px-4 py-3 text-left">Presentación</Th>
                  <Th width={widths.fecha} onResizeStart={startResize("fecha")} sortKey="fecha" orden={orden} onOrdenar={alternarOrden} className="px-4 py-3 text-left">Fecha</Th>
                  <Th width={widths.master} onResizeStart={startResize("master")} sortKey="master" orden={orden} onOrdenar={alternarOrden} className="px-4 py-3 text-right">Master</Th>
                  <Th width={widths.cajas} onResizeStart={startResize("cajas")} sortKey="cajas" orden={orden} onOrdenar={alternarOrden} className="px-4 py-3 text-right">Cajas</Th>
                  <Th width={widths.kilos} onResizeStart={startResize("kilos")} sortKey="kilos" orden={orden} onOrdenar={alternarOrden} className="px-4 py-3 text-right">Kilos</Th>
                  <Th width={widths.libras} onResizeStart={startResize("libras")} sortKey="libras" orden={orden} onOrdenar={alternarOrden} className="px-4 py-3 text-right">Libras</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtradas.length === 0 ? (
                  <tr><td colSpan={COLS.length} className="px-4 py-10 text-center text-gray-400">
                    {filas.length === 0 ? "No hay pallets escaneados todavía" : "Ningún polín coincide con los filtros"}
                  </td></tr>
                ) : ordenadas.map((f, i) => {
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
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">{fmtEntero(f.Master)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmtEntero(f.Cajas)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmtNum(f.KilosBrutos)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmtNum(f.Libras)}</td>
                    </tr>
                  );
                })}
              </tbody>
              {filtradas.length > 0 && (
                <tfoot className="sticky bottom-0 z-10">
                  <tr className="bg-gray-50 border-t-2 border-gray-200 font-bold text-gray-700">
                    <td colSpan={11} className="px-4 py-2.5 text-right text-xs uppercase tracking-wide text-gray-500">Total</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtEntero(totales.Master)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtEntero(totales.Cajas)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtNum(totales.KilosBrutos)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtNum(totales.Libras)}</td>
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
