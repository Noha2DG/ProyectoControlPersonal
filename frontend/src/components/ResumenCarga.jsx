import { useState, useEffect } from "react";
import { authHeader } from "../context/AuthContext.jsx";

// Cómo va la carga de un contenedor (remisiones con línea de contenedor, o sea Exportación), para
// quien está en el andén: cuánto lleva de cada producto contra la proforma y qué hay en cada línea
// (fila) del contenedor. Se recalcula con cada escaneo porque sale de las líneas de la remisión.
//
// "Cargado" es lo de ESTA remisión; el objetivo es el de la proforma (GET /detalle-pedido/avance).
// Si el pedido ya tuvo otro despacho, ese cuenta aparte en "ya despachado antes".

const num = (v, d = 0) => Number(v).toLocaleString("es-GT", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Polines, masters y kg por línea del contenedor. */
export function cargaPorLinea(lineas = []) {
  const mapa = new Map();
  for (const l of lineas) {
    const k = l.LineaContenedor ?? 0;
    const g = mapa.get(k) ?? { Linea: k, Masters: 0, Kg: 0, polines: new Set() };
    g.Masters += 1; g.Kg += l.PesoMasterKG; g.polines.add(l.PalletCodigo);
    mapa.set(k, g);
  }
  return [...mapa.values()].map(g => ({ Linea: g.Linea, Masters: g.Masters, Kg: g.Kg, Polines: [...g.polines] }))
    .sort((a, b) => a.Linea - b.Linea);
}

/** Texto corto de lo que lleva una línea, para la ventana de escaneo. */
export function textoDeLinea(lineas, n) {
  const g = cargaPorLinea(lineas).find(x => x.Linea === n);
  return g ? `lleva ${g.Polines.length} polín${g.Polines.length !== 1 ? "es" : ""} · ${num(g.Masters)} masters · ${num(g.Kg, 2)} kg` : "todavía vacía";
}

export default function ResumenCarga({ remision }) {
  const [avance, setAvance] = useState([]);
  const lineas = remision?.Lineas ?? [];
  const pedido = remision?.CodigoPedido;

  // Se vuelve a pedir con cada cambio de la remisión: el avance trae lo que queda en bodega.
  useEffect(() => {
    if (!pedido) { setAvance([]); return; }
    let vivo = true;
    fetch(`/api/detalle-pedido/avance?pedido=${encodeURIComponent(pedido)}`, { headers: authHeader() })
      .then(r => (r.ok ? r.json() : [])).catch(() => [])
      .then(d => { if (vivo && Array.isArray(d)) setAvance(d); });
    return () => { vivo = false; };
  }, [pedido, lineas.length]);

  // Lo de esta remisión por línea de la proforma, con la descripción que ya traen sus masters.
  const aqui = new Map();
  for (const l of lineas) {
    const g = aqui.get(l.DetalleId) ?? { Masters: 0, Kg: 0, Producto: `${l.DescripcionProceso} ${l.DescripcionTalla}`, Presentacion: l.DescripcionPresentacion, Pedido: l.CodigoPedido };
    g.Masters += 1; g.Kg += l.PesoMasterKG;
    aqui.set(l.DetalleId, g);
  }
  // Primero las líneas de la proforma (aunque no lleven nada todavía); después lo que entró de otra
  // proforma en una remisión mixta.
  const filas = avance.filter(a => !a.Anulada && a.Objetivo !== null).map(a => {
    const g = aqui.get(a.DetalleId);
    const antes = Math.max(0, a.Despachado - (g?.Masters ?? 0));   // despachado en otras remisiones
    return { id: a.DetalleId, Producto: g?.Producto ?? `${a.DescripcionProceso ?? a.Clase} ${a.DescripcionTalla ?? a.Talla}`, Presentacion: g?.Presentacion ?? a.DescripcionPresentacion ?? a.Presentacion,
             Cargado: g?.Masters ?? 0, Kg: g?.Kg ?? 0, Objetivo: a.Objetivo, Antes: antes, EnBodega: a.EnBodega };
  });
  const enProforma = new Set(filas.map(f => f.id));
  const ajenas = [...aqui.entries()].filter(([id]) => !enProforma.has(id))
    .map(([id, g]) => ({ id, Producto: `${g.Producto} (${g.Pedido})`, Presentacion: g.Presentacion, Cargado: g.Masters, Kg: g.Kg, Objetivo: null, Antes: 0, EnBodega: null }));
  const todas = [...filas, ...ajenas];
  const totObjetivo = filas.reduce((s, f) => s + f.Objetivo, 0);
  const totCargado = lineas.length;
  const porLinea = cargaPorLinea(lineas);
  const ultima = porLinea.length ? porLinea[porLinea.length - 1].Linea : null;

  if (!todas.length && !porLinea.length) return null;

  return (
    <div className="mb-4 grid gap-3 lg:grid-cols-2">
      {/* Contra la proforma */}
      <div className="border border-gray-200 rounded-lg p-3">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Avance contra la proforma</p>
          {totObjetivo > 0 && (
            <p className="text-sm font-bold text-gray-800">{num(totCargado)} de {num(totObjetivo)} masters
              <span className="ml-1 font-normal text-gray-500">({Math.round((totCargado / totObjetivo) * 100)} %)</span></p>
          )}
        </div>
        <div className="space-y-2">
          {todas.map(f => {
            const meta = f.Objetivo == null ? null : Math.max(0, f.Objetivo - f.Antes);   // lo que le toca a esta carga
            const falta = meta == null ? null : meta - f.Cargado;
            const pct = meta ? Math.min(100, (f.Cargado / meta) * 100) : (f.Cargado ? 100 : 0);
            const estado = falta == null ? { texto: "fuera de la proforma", clase: "text-gray-500", barra: "bg-gray-400" }
              : falta > 0 ? { texto: `faltan ${num(falta)}`, clase: "text-amber-700", barra: "bg-blue-500" }
              : falta === 0 ? { texto: "completo", clase: "text-green-700", barra: "bg-green-500" }
              : { texto: `+${num(-falta)} de más`, clase: "text-red-600", barra: "bg-red-500" };
            return (
              <div key={f.id}>
                <div className="flex items-baseline gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate" title={`${f.Producto} ${f.Presentacion}`}>
                    <span className="font-semibold text-gray-800">{f.Producto}</span> <span className="text-xs text-gray-500">{f.Presentacion}</span>
                  </span>
                  <span className="shrink-0 tabular-nums font-semibold text-gray-800">{num(f.Cargado)}{meta != null ? ` / ${num(meta)}` : ""}</span>
                  <span className={`shrink-0 w-24 text-right text-xs font-semibold ${estado.clase}`}>{estado.texto}</span>
                </div>
                <div className="mt-0.5 h-1.5 rounded bg-gray-100 overflow-hidden"><div className={`h-full ${estado.barra}`} style={{ width: `${pct}%` }} /></div>
                {(f.Antes > 0 || (falta > 0 && f.EnBodega != null && f.EnBodega < falta)) && (
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {f.Antes > 0 ? `ya despachado antes: ${num(f.Antes)}. ` : ""}
                    {falta > 0 && f.EnBodega != null && f.EnBodega < falta ? `En bodega solo quedan ${num(f.EnBodega)}.` : ""}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Por línea del contenedor */}
      <div className="border border-gray-200 rounded-lg p-3">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Por línea del contenedor</p>
          <p className="text-sm font-bold text-gray-800">{porLinea.length} línea{porLinea.length !== 1 ? "s" : ""} · {new Set(lineas.map(l => l.PalletCodigo)).size} polines</p>
        </div>
        {porLinea.length === 0 ? <p className="text-sm text-gray-400">Todavía no se ha cargado nada.</p> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {porLinea.map(g => (
              <div key={g.Linea} title={g.Polines.join(", ")}
                className={`rounded-md border px-2 py-1.5 ${g.Linea === ultima ? "border-blue-500 bg-blue-50" : "border-gray-200"}`}>
                <p className="text-xs text-gray-500">Línea <span className="font-mono font-bold text-gray-900 text-sm">{g.Linea || "—"}</span></p>
                <p className="text-sm font-semibold text-gray-800 tabular-nums">{num(g.Masters)} masters</p>
                <p className="text-[11px] text-gray-500 tabular-nums">{g.Polines.length} polín{g.Polines.length !== 1 ? "es" : ""} · {num(g.Kg, 0)} kg</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
