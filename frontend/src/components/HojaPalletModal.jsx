import { useState, useEffect, useRef, Fragment } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import { authHeader } from "../context/AuthContext.jsx";

function fmtFecha(iso) {
  return iso ? new Date(iso).toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" }) : "-";
}

// Un polín trae decenas de masters idénticos (mismo producto, mismo lote, mismo pedido): listarlos
// uno por uno daba hojas de 35+ líneas imposibles de cotejar parado frente al polín. Se agrupan por
// cliente y, dentro, por producto+lote+pedido, contando masters — el correlativo era lo que obligaba
// a una línea por master, y para cotejar sirve el conteo de lo que se escanea, no el número de cada
// etiqueta. Los despachados se agrupan aparte (el Estatus entra en la clave) para no sumar en una
// misma línea lo que sigue arriba del polín con lo que ya salió.
function agruparPorCliente(masters) {
  const clientes = new Map();
  for (const m of masters) {
    const cliente = `${m.NombreCliente}${m.NombreSubcliente ? `-${m.NombreSubcliente}` : ""}`;
    const producto = `${m.DescripcionProceso} ${m.DescripcionTalla} ${m.DescripcionPresentacion}`;
    const lote = m.Lote ?? "";
    const pedido = m.CodigoPedido ?? "";
    const salido = m.Estatus === "Salido";
    if (!clientes.has(cliente)) clientes.set(cliente, new Map());
    const lineas = clientes.get(cliente);
    const clave = `${producto}|${lote}|${pedido}|${salido}`;
    const linea = lineas.get(clave) ?? { clave, producto, lote, pedido, salido, masters: 0, kg: 0, lb: 0 };
    linea.masters += 1;
    linea.kg += m.PesoMasterKG;
    linea.lb += m.PesoMasterLb;
    lineas.set(clave, linea);
  }
  return [...clientes.entries()]
    .map(([cliente, lineas]) => {
      const filas = [...lineas.values()].sort((a, b) =>
        a.producto.localeCompare(b.producto) || a.lote.localeCompare(b.lote) || a.pedido.localeCompare(b.pedido));
      const enPolin = filas.filter(f => !f.salido);
      return {
        cliente,
        filas,
        masters: enPolin.reduce((acc, f) => acc + f.masters, 0),
        kg: enPolin.reduce((acc, f) => acc + f.kg, 0),
        lb: enPolin.reduce((acc, f) => acc + f.lb, 0),
      };
    })
    .sort((a, b) => a.cliente.localeCompare(b.cliente));
}

// Contenido real de la hoja — vive DUPLICADO a propósito en dos lugares (vista previa en pantalla
// dentro del modal, y una copia portada a #print-root solo para imprimir, ver más abajo). Extraído
// a su propio componente para no repetir el JSX dos veces.
function ContenidoHoja({ pallet, totalKg, totalLb }) {
  // Lo que está ENCIMA del polín, que es contra lo que se coteja parado frente a él. Los despachados
  // siguen listados abajo como historia, pero sumarlos daría un total que el polín ya no tiene.
  const enPolin = pallet.Masters.filter(m => m.Estatus !== "Salido").length;
  const grupos = agruparPorCliente(pallet.Masters);
  return (
    <>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-4xl font-bold text-gray-900">Pallet {pallet.Codigo}</h1>
          <p className="text-base text-gray-500 mt-2">{pallet.NombreBodegaVirtual}{pallet.DescripcionOrigen ? ` · Origen: ${pallet.DescripcionOrigen}` : ""}</p>
          {/* Un polín abierto se puede imprimir para cotejar en piso lo que lleva cargado, pero esa
              hoja NO es el documento del polín: mañana puede tener más cajas. Se dice en la hoja
              misma, que es donde va a estar el que la lea, y no en la pantalla desde donde se mandó. */}
          {pallet.Estatus === "Cerrado" ? (
            <p className="text-base text-gray-500">Cerrado: {fmtFecha(pallet.CerradoEn)}{pallet.CerradoPor ? ` por ${pallet.CerradoPor}` : ""}</p>
          ) : (
            <p className="text-base font-bold text-gray-900 border-2 border-gray-800 rounded px-2 py-1 mt-1 inline-block">
              PRELIMINAR — el polín sigue {String(pallet.Estatus).toLowerCase()}, su contenido puede cambiar
            </p>
          )}
        </div>
        <div className="flex flex-col items-center shrink-0">
          <QRCodeSVG value={pallet.Codigo} size={140} />
          <span className="text-base font-mono font-bold mt-1">{pallet.Codigo}</span>
        </div>
      </div>

      <div className="flex gap-10 mb-5 text-base border-y-2 border-gray-800 py-4">
        <span><span className="text-gray-400">Total Masters:</span> <span className="font-bold text-2xl">{enPolin}</span></span>
        <span><span className="text-gray-400">Total Kg:</span> <span className="font-bold text-2xl">{totalKg.toFixed(2)}</span></span>
        <span><span className="text-gray-400">Total Lb:</span> <span className="font-bold text-2xl">{totalLb.toFixed(2)}</span></span>
        {pallet.Masters.length > enPolin && (
          <span><span className="text-gray-400">Ya despachados:</span> <span className="font-bold text-2xl">{pallet.Masters.length - enPolin}</span></span>
        )}
      </div>

      <table className="w-full text-base">
        <thead>
          <tr className="text-left text-gray-600 uppercase border-b-2 border-gray-800 text-sm">
            <th className="py-2 pr-3">Producto</th>
            <th className="py-2 pr-3">Lote</th>
            <th className="py-2 pr-3">Pedido</th>
            <th className="py-2 pr-3 text-right">Masters</th>
            <th className="py-2 pr-3 text-right">Kg</th>
            <th className="py-2 text-right">Lb</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {grupos.map(g => (
            <Fragment key={g.cliente}>
              <tr className="bg-gray-100 border-t-2 border-gray-400">
                <td className="py-1.5 pr-3 font-bold" colSpan={3}>{g.cliente}</td>
                <td className="py-1.5 pr-3 text-right font-bold">{g.masters}</td>
                <td className="py-1.5 pr-3 text-right font-bold">{g.kg.toFixed(2)}</td>
                <td className="py-1.5 text-right font-bold">{g.lb.toFixed(2)}</td>
              </tr>
              {g.filas.map(f => (
                <tr key={f.clave} className={f.salido ? "text-gray-400 line-through" : ""}>
                  <td className="py-1.5 pr-3">{f.producto}</td>
                  <td className="py-1.5 pr-3 font-mono whitespace-nowrap">{f.lote}</td>
                  <td className="py-1.5 pr-3 font-mono">{f.pedido}</td>
                  <td className="py-1.5 pr-3 text-right">{f.masters}</td>
                  <td className="py-1.5 pr-3 text-right">{f.kg.toFixed(2)}</td>
                  <td className="py-1.5 text-right">{f.lb.toFixed(2)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
          {pallet.Masters.length === 0 && (
            <tr><td colSpan={6} className="py-6 text-center text-gray-400">Sin masters escaneados</td></tr>
          )}
        </tbody>
      </table>

      <p className="text-sm text-gray-400 mt-6">Impreso {fmtFecha(new Date().toISOString())}</p>
    </>
  );
}

// Hoja de contenido del pallet — el paso "bodega física real" que había quedado pendiente en el
// diseño original (bodega virtual → posición física + hoja impresa). Solo tiene sentido para un
// pallet Cerrado (su contenido recién es definitivo ahí). El QR codifica el Código del pallet
// (mismo dato ya usado en toda la pantalla, ej. "T0009") para escanearlo más adelante al asignar
// posición — esa asignación todavía no existe, esto solo deja el QR listo para ese momento.
// Reusa GET /api/pallets/:id tal cual (ya trae cabecera + Masters con todo el detalle) — no hizo
// falta ningún endpoint nuevo.
export default function HojaPalletModal({ palletId, onCerrar }) {
  const [pallet, setPallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const yaImprimioRef = useRef(false);

  useEffect(() => {
    fetch(`/api/pallets/${palletId}`, { headers: authHeader() })
      .then(res => res.json())
      .then(data => { setPallet(data); setLoading(false); });
  }, [palletId]);

  // Dispara el diálogo de impresión solo, apenas termina de cargar.
  useEffect(() => {
    if (!loading && pallet && !yaImprimioRef.current) {
      yaImprimioRef.current = true;
      window.print();
    }
  }, [loading, pallet]);

  // Solo el peso de lo que sigue arriba del polín — ver la nota en ContenidoHoja.
  const enPolin = pallet?.Masters.filter(m => m.Estatus !== "Salido") ?? [];
  const totalKg = enPolin.reduce((acc, m) => acc + m.PesoMasterKG, 0);
  const totalLb = enPolin.reduce((acc, m) => acc + m.PesoMasterLb, 0);

  return (
    <>
      {/* Modal interactivo — SOLO en pantalla, vista previa nada más. index.css ya oculta TODO
          #root al imprimir (incluido este modal, sin importar cuántos otros modales fixed haya
          por encima) — por eso la hoja real no puede vivir aquí adentro, ver más abajo. */}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:hidden"
        onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-full flex flex-col">
          <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
            <h2 className="text-base font-semibold text-gray-800">Hoja de contenido del pallet</h2>
            <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-2 text-xl leading-none transition">&times;</button>
          </div>

          <div className="px-8 py-6 overflow-y-auto">
            {loading ? (
              <p className="text-gray-400 text-sm">Cargando…</p>
            ) : !pallet ? (
              <p className="text-sm text-red-600">No se pudo cargar el pallet.</p>
            ) : (
              <ContenidoHoja pallet={pallet} totalKg={totalKg} totalLb={totalLb} />
            )}
          </div>
        </div>
      </div>

      {/* Lo que realmente se imprime — portado a #print-root (fuera de #root por completo, mismo
          patrón ya usado en PlanificacionPage/ReporteProduccionPage/TransferenciasAdminPage), para
          no depender de ningún ancestro fixed/oculto que ande por el medio. */}
      {pallet && createPortal(
        <div className="hidden print:block">
          <style>{"@media print { @page { size: letter; margin: 1.5cm; } }"}</style>
          <ContenidoHoja pallet={pallet} totalKg={totalKg} totalLb={totalLb} />
        </div>,
        document.getElementById("print-root")
      )}
    </>
  );
}
