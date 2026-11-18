import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { authHeader } from "../context/AuthContext.jsx";
import logo from "../assets/pacific-gold-logo.png";

// Certificado de calidad de una remisión confirmada (18 nov 2026, pedido del usuario): SUMINISTROS lo
// pide en cada despacho. Es la plantilla que ya usaban en Word; lo único que cambia de una remisión a
// otra es la tabla, que sale de los masters que salieron en ella.
//   · Número = folio de la remisión (decisión del usuario): reimprimir da siempre el mismo y no hace
//     falta llevar otro correlativo.
//   · Un renglón por producto + lote: masters del mismo producto y lote en pedidos distintos se suman
//     (en VL-0120, 29 + 11 masters de 61/70 del G546Q009 = 800 lb en un solo renglón).
//   · Fecha de producción = la del lote en su orden de etiquetado; vencimiento = 2 años después.
// Mismo patrón de impresión que HojaRemisionModal: vista previa en el modal y copia en #print-root.

// Quién recibe y quién firma: fijos, como en la plantilla de Word. Si cambia la gerencia, es aquí.
export const CLIENTE_CERTIFICADO = 52; // SUMINISTROS (Clientes.Codigo)
const DESTINATARIO = "SUMINISTROS Y ALIMENTOS";
const FIRMA = ["ING. Mercedes Castillo", "Gerente de Planta", "ORO DE PACÍFICO, S. A"];
const ANOS_VIDA_UTIL = 2;

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
// Fechas como texto "YYYY-MM-DD", sin pasar por Date: la Z del backend miente (ver utils/fecha.js).
const fechaLarga = iso => { const [a, m, d] = iso.slice(0, 10).split("-"); return `${Number(d)} de ${MESES[Number(m) - 1]} de ${a}`; };
const dma = iso => { const [a, m, d] = iso.slice(0, 10).split("-"); return `${d}/${m}/${a}`; };
const masAnos = (iso, n) => `${Number(iso.slice(0, 4)) + n}${iso.slice(4, 10)}`;
const libras = v => v.toLocaleString("en-US", { maximumFractionDigits: 2 });

// Nombre del proceso como lo escribe el certificado: "P&D" se escribe completo y la cola con
// cáscara es "Shell On". El asterisco de los procesos internos no va al papel.
function nombreProducto(proceso) {
  const p = String(proceso ?? "").replace(/\s*\*\s*$/, "").trim();
  if (/^COLA$/i.test(p)) return "Shell On";
  return p.replace(/P&D/g, "Pelado y Desvenado");
}

function filasCertificado(lineas) {
  const grupos = {};
  for (const l of lineas) {
    const k = `${l.DescripcionProceso}|${l.Talla}|${l.Presentacion}|${l.Lote}|${l.FechaProduccion ?? ""}`;
    grupos[k] ??= {
      k, Producto: nombreProducto(l.DescripcionProceso), Talla: l.DescripcionTalla,
      Caja: l.PesoLbCaja, Lote: l.Lote, Produccion: l.FechaProduccion, Libras: 0,
    };
    grupos[k].Libras += l.PesoMasterLb;
  }
  return Object.values(grupos).sort((a, b) =>
    String(a.Produccion).localeCompare(String(b.Produccion)) || a.Producto.localeCompare(b.Producto) || String(a.Talla).localeCompare(String(b.Talla)));
}

export function Certificado({ remision }) {
  const filas = filasCertificado(remision.Lineas);
  const td = { border: "1px solid #111", padding: "4px 8px", textAlign: "center", verticalAlign: "middle" };
  return (
    <div style={{ fontFamily: "Arial, Helvetica, sans-serif", color: "#111", fontSize: "14px", lineHeight: 1.35 }}>
      <img src={logo} alt="Pacific Gold" style={{ height: "78px" }} />

      <div style={{ textAlign: "right", marginTop: "6px" }}>
        <div>Guatemala, {fechaLarga(remision.Fecha)}</div>
        <div style={{ fontWeight: 700 }}>CERTIFICADO DE CALIDAD {remision.Folio}</div>
      </div>

      <p style={{ marginTop: "22px", fontWeight: 400 }}>Estimados señores {DESTINATARIO}:</p>
      <p style={{ textIndent: "48px", textAlign: "justify", marginTop: "14px" }}>
        Por este medio, certificamos que el producto en el listado abajo descrito, fue procesado y/o almacenado, bajo
        estándares de inocuidad, por lo que se garantiza, que es apto para el consumo humano y no representan riesgo a
        la salud del consumidor.
      </p>
      <p style={{ textIndent: "48px", marginTop: "10px" }}>
        Se garantiza que fueron verificados antes y durante su producción y/o almacenaje
      </p>

      <table style={{ borderCollapse: "collapse", width: "100%", marginTop: "10px", fontSize: "13px" }}>
        <thead>
          <tr>
            <th style={{ ...td, fontWeight: 400, width: "34%" }}>Producto</th>
            <th style={{ ...td, fontWeight: 400 }}>No. Lote</th>
            <th style={{ ...td, fontWeight: 400 }}>Fecha de Producción</th>
            <th style={{ ...td, fontWeight: 400 }}>Fecha de Vencimiento</th>
            <th style={{ ...td, fontWeight: 400 }}>Libras</th>
          </tr>
        </thead>
        <tbody>
          {filas.map(f => (
            <tr key={f.k}>
              <td style={td}>
                {f.Producto}<br />
                {f.Talla}{f.Caja ? ` (${libras(f.Caja)} ${f.Caja === 1 ? "Libra" : "Libras"})` : ""}
              </td>
              <td style={td}>{f.Lote}</td>
              <td style={td}>{f.Produccion ? dma(f.Produccion) : "—"}</td>
              <td style={td}>{f.Produccion ? dma(masAnos(f.Produccion, ANOS_VIDA_UTIL)) : "—"}</td>
              <td style={td}>{libras(f.Libras)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ marginTop: "40px", fontWeight: 700 }}>
        Por lo que se emite el siguiente CERTIFICADO DE CALIDAD, SIENDO LA RESPONSABLE DE LA VERIFICACIÓN LA ABAJO FIRMANTE.
      </p>
      <p style={{ textAlign: "center", marginTop: "14px", fontSize: "12px" }}>Atentamente,</p>
      <div style={{ textAlign: "center", marginTop: "64px" }}>
        {FIRMA.map(l => <div key={l}>{l}</div>)}
      </div>
    </div>
  );
}

export default function CertificadoCalidadModal({ remisionId, onCerrar }) {
  const [remision, setRemision] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/remisiones/${remisionId}`, { headers: authHeader() })
      .then(res => res.json())
      .then(data => { setRemision(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [remisionId]);

  const sinFecha = remision?.Lineas?.some(l => !l.FechaProduccion);

  return (
    <>
      <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 p-4 print:hidden"
        onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-full flex flex-col">
          <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
            <h2 className="text-base font-semibold text-gray-800">Certificado de calidad</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => window.print()} disabled={loading || !remision?.Folio}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50">
                Imprimir
              </button>
              <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-2 text-xl leading-none transition">&times;</button>
            </div>
          </div>
          {sinFecha && (
            <p className="px-8 pt-3 text-sm text-amber-700">Hay producto sin fecha de producción: esos renglones salen con "—".</p>
          )}
          <div className="px-10 py-8 overflow-y-auto">
            {loading ? <p className="text-gray-400 text-sm">Cargando…</p>
              : !remision?.Folio ? <p className="text-sm text-red-600">No se pudo cargar la remisión.</p>
              : <Certificado remision={remision} />}
          </div>
        </div>
      </div>

      {remision?.Folio && createPortal(
        <div className="hidden print:block">
          <style>{"@media print { @page { size: letter; margin: 2cm 2.2cm; } }"}</style>
          <Certificado remision={remision} />
        </div>,
        document.getElementById("print-root")
      )}
    </>
  );
}
