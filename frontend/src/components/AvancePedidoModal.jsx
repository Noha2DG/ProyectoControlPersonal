import { useEffect } from "react";
import { createPortal } from "react-dom";
import { fmtNum } from "../utils/numero.js";

// La pestaña Avance de un pedido, para imprimir o guardar como PDF ("Imprimir / PDF" usa el diálogo
// del navegador, igual que el inventario al piso de Descongelado).
//
// No pide nada al servidor: imprime las mismas filas que se ven en la pestaña, ya con sus
// descripciones. Así el papel no puede decir otra cosa que la pantalla.
//
// Solo en kilogramos (los master se ven en pantalla). Agrupado por producto —un título de sección,
// hay proformas con más de dos— y, dentro, un recuadro por presentación con sus tallas y su total,
// para que cada recuadro se identifique solo aunque quede en otra hoja.
//
// Cada barra lleva marcado el umbral del aviso (85 %): en una impresión en blanco y negro el verde
// de la pantalla se pierde, la marca no.

const pct = (bodega, pedido) => (pedido ? (bodega / pedido) * 100 : null);

// Totales de un grupo de filas. El pedido solo suma las líneas que tienen pedido (el granel no).
function sumar(filas) {
  return {
    pedidoKg: filas.reduce((s, f) => s + (f.ObjetivoKg || 0), 0),
    bodegaKg: filas.reduce((s, f) => s + f.EnBodegaKg, 0),
    conPedido: filas.some(f => f.ObjetivoKg !== null),
  };
}
const pctDe = t => (t.conPedido ? pct(t.bodegaKg, t.pedidoKg) : null);

// Producto → presentación, en el orden en que aparecen las filas (el de la pantalla).
function agrupar(filas) {
  const productos = [];
  for (const f of filas) {
    let p = productos.find(x => x.nombre === f.Producto);
    if (!p) { p = { nombre: f.Producto, presentaciones: [] }; productos.push(p); }
    let pr = p.presentaciones.find(x => x.nombre === f.PresentacionDesc);
    if (!pr) { pr = { nombre: f.PresentacionDesc, filas: [] }; p.presentaciones.push(pr); }
    pr.filas.push(f);
  }
  return productos;
}

const COLOR_EXACTO = { WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" };

function Barra({ valor, umbral, alta }) {
  return (
    <div className={`relative ${alta ? "h-3" : "h-2"} border border-gray-800 bg-white`} style={COLOR_EXACTO}>
      <div className={`h-full ${valor >= umbral ? "bg-green-600" : "bg-gray-500"}`} style={{ width: `${Math.min(100, valor)}%` }} />
      <div className="absolute inset-y-0 border-l border-dashed border-gray-900" style={{ left: `${umbral}%` }} />
    </div>
  );
}

function CeldaAvance({ valor, umbral }) {
  if (valor === null) return <td className="py-1.5 text-right">—</td>;
  return (
    <td className="py-1.5">
      <div className="flex items-center gap-2">
        <div className="flex-1"><Barra valor={valor} umbral={umbral} /></div>
        <span className={`tabular-nums w-12 text-right ${valor >= umbral ? "font-bold" : ""}`}>{fmtNum(valor, 1)} %</span>
      </div>
    </td>
  );
}

// Mismos anchos en todas las tablas del reporte (una por recuadro), para que las cifras queden en
// columna de un recuadro al siguiente.
function Columnas() {
  return (
    <colgroup>
      <col style={{ width: "22%" }} />
      <col style={{ width: "14%" }} /><col style={{ width: "14%" }} /><col style={{ width: "14%" }} />
      <col style={{ width: "36%" }} />
    </colgroup>
  );
}

function Totales({ etiqueta, t, umbral, total }) {
  return (
    <tr className={total ? "font-bold text-sm" : "border-t-2 border-gray-800 font-bold"}>
      <td className="py-1.5 pr-2 whitespace-nowrap">{etiqueta}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{t.conPedido ? fmtNum(t.pedidoKg) : "—"}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{fmtNum(t.bodegaKg)}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{t.conPedido ? fmtNum(t.bodegaKg - t.pedidoKg) : "—"}</td>
      <CeldaAvance valor={pctDe(t)} umbral={umbral} />
    </tr>
  );
}

// Un recuadro por presentación: franja con producto y presentación, sus tallas y su total.
function RecuadroPresentacion({ producto, pr, umbral }) {
  const t = sumar(pr.filas);
  const p = pctDe(t);
  return (
    <section className="border-2 border-gray-800 rounded-lg overflow-hidden mb-3" style={{ breakInside: "avoid-page" }}>
      <div className="bg-gray-800 text-white px-3 py-1.5 flex items-baseline justify-between" style={COLOR_EXACTO}>
        <h3 className="text-sm"><span className="font-bold">{pr.nombre}</span><span className="text-gray-300"> · {producto}</span></h3>
        <p className="text-xs tabular-nums">{p === null ? "sin pedido" : `${fmtNum(p, 1)} %`}</p>
      </div>
      <div className="px-3 pb-2">
        <table className="w-full text-xs print-table table-fixed">
          <Columnas />
          <thead>
            <tr className="text-gray-500 text-left border-b border-gray-800 whitespace-nowrap">
              <th className="py-1 pr-2 font-medium">Talla</th>
              <th className="py-1 pr-2 font-medium text-right">Pedido kg</th>
              <th className="py-1 pr-2 font-medium text-right">Bodega kg</th>
              <th className="py-1 pr-2 font-medium text-right">Dif. kg</th>
              <th className="py-1 font-medium text-right">Avance</th>
            </tr>
          </thead>
          <tbody>
            {pr.filas.map(f => (
              <tr key={f.DetalleId} className="border-t border-gray-200">
                <td className="py-1.5 pr-2">{f.TallaDesc}{f.EsGranel && <span className="text-gray-500"> (granel)</span>}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{f.ObjetivoKg === null ? "—" : fmtNum(f.ObjetivoKg)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums font-semibold">{fmtNum(f.EnBodegaKg)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{f.DiferenciaKg === null ? "—" : fmtNum(f.DiferenciaKg)}</td>
                <CeldaAvance valor={pct(f.EnBodegaKg, f.ObjetivoKg)} umbral={umbral} />
              </tr>
            ))}
            {pr.filas.length > 1 && <Totales etiqueta={`Total ${pr.nombre}`} t={t} umbral={umbral} />}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ContenidoAvance({ pedido, filas, umbral }) {
  const total = sumar(filas);
  const pctPedido = pctDe(total);
  const listas = filas.filter(f => { const p = pct(f.EnBodegaKg, f.ObjetivoKg); return p !== null && p >= umbral; }).length;
  const conPedido = filas.filter(f => f.ObjetivoKg !== null).length;
  const productos = agrupar(filas);

  return (
    <div className="text-gray-900">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Avance del pedido</h1>
          <p className="text-sm text-gray-500">Kilogramos escaneados que siguen en bodega contra lo que pide la proforma</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold font-mono">{pedido.CodigoPedido}</p>
          <p className="text-sm text-gray-500">{pedido.Descripcion}</p>
        </div>
      </div>

      {pctPedido !== null && (
        <div className="border-2 border-gray-800 rounded-lg px-4 py-3 mb-5" style={{ breakInside: "avoid-page" }}>
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Resumen del pedido</p>
          <div className="flex items-baseline gap-6 mb-2">
            <p className="text-3xl font-bold tabular-nums">{fmtNum(pctPedido, 1)} %</p>
            <div className="grid grid-cols-3 gap-x-8 text-sm flex-1">
              <div><span className="text-gray-500">Kg en bodega:</span> <b className="tabular-nums">{fmtNum(total.bodegaKg)}</b> <span className="text-gray-500">de {fmtNum(total.pedidoKg)}</span></div>
              <div><span className="text-gray-500">Faltan:</span> <b className="tabular-nums">{fmtNum(Math.max(0, total.pedidoKg - total.bodegaKg))}</b> <span className="text-gray-500">kg</span></div>
              <div><span className="text-gray-500">Líneas en {umbral} % o más:</span> <b className="tabular-nums">{listas}</b> <span className="text-gray-500">de {conPedido}</span></div>
            </div>
          </div>
          <Barra valor={pctPedido} umbral={umbral} alta />
          <p className="text-[10px] text-gray-500 mt-1 text-right" style={{ paddingRight: `${100 - umbral}%` }}>{umbral} %</p>
        </div>
      )}

      {productos.map(p => {
        const pp = pctDe(sumar(p.presentaciones.flatMap(pr => pr.filas)));
        return (
          <div key={p.nombre} className="mb-4">
            <div className="flex items-baseline justify-between border-b-2 border-gray-800 pb-0.5 mb-2">
              <h2 className="text-base font-bold uppercase tracking-wide">{p.nombre}</h2>
              <p className="text-sm font-semibold tabular-nums">{pp === null ? "" : `${fmtNum(pp, 1)} %`}</p>
            </div>
            {p.presentaciones.map(pr => (
              <RecuadroPresentacion key={pr.nombre} producto={p.nombre} pr={pr} umbral={umbral} />
            ))}
          </div>
        );
      })}

      <section className="border-2 border-gray-800 rounded-lg px-3 bg-gray-100 mt-5" style={{ breakInside: "avoid-page", ...COLOR_EXACTO }}>
        <table className="w-full text-xs table-fixed">
          <Columnas />
          <tbody>
            <Totales etiqueta="Total del pedido" t={total} umbral={umbral} total />
          </tbody>
        </table>
      </section>

      <p className="text-[10px] text-gray-500 mt-4 leading-relaxed">
        Lo que ya salió de bodega (despachos y traslados) no cuenta. La línea punteada de cada barra marca el {umbral} %.
        El granel no tiene pedido propio: sus kg suman al total del pedido.
      </p>
      <p className="text-[10px] text-gray-400 mt-2">
        Impreso {new Date().toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" })}
      </p>
    </div>
  );
}

export default function AvancePedidoModal({ pedido, filas, umbral, onCerrar }) {
  // El nombre del PDF lo pone el navegador a partir del título de la página.
  useEffect(() => {
    const antes = document.title;
    const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
    document.title = `Avance pedido ${pedido.CodigoPedido} - ${hoy}`;
    return () => { document.title = antes; };
  }, [pedido.CodigoPedido]);

  return (
    <>
      {/* Vista previa — SOLO pantalla. index.css oculta #root al imprimir; lo que se imprime va en el
          portal de abajo, igual que InventarioDescongeladoModal. */}
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 print:hidden"
        onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-6xl max-h-full min-w-0 flex flex-col">
          <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
            <h2 className="text-base font-semibold text-gray-800">Avance del pedido {pedido.CodigoPedido} — vista previa</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => window.print()}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition">
                Imprimir / PDF
              </button>
              <button onClick={onCerrar} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-2 text-xl leading-none transition">&times;</button>
            </div>
          </div>
          <div className="px-8 py-6 overflow-auto">
            <ContenidoAvance pedido={pedido} filas={filas} umbral={umbral} />
          </div>
        </div>
      </div>

      {createPortal(
        <div className="hidden print:block">
          {/* Horizontal: con la barra de avance, en vertical las columnas quedarían apretadas. */}
          <style>{"@media print { @page { size: letter landscape; margin: 1.2cm; } }"}</style>
          <ContenidoAvance pedido={pedido} filas={filas} umbral={umbral} />
        </div>,
        document.getElementById("print-root")
      )}
    </>
  );
}
