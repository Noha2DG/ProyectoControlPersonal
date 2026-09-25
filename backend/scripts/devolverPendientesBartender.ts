// Devuelve a "pendiente de imprimir" un tramo de etiquetas que quedó marcado como impreso sin que
// saliera en papel.
//
// CASO QUE LO ORIGINÓ (sep 2026): pedido 2025012, lote G136EM04-E03-8, 40 etiquetas. Con la red
// cayéndose BarTender solo sacó 20, pero el aviso "¿salieron las etiquetas?" confirma el rango
// COMPLETO que se abrió (confirmar-impresion con Desde/Hasta de la tanda), así que la captura quedó
// 40/40 "Impreso" y el botón BarTender ya no deja volver a sacar las otras 20: la reserva filtra
// por ImpresoEn IS NULL y responde "ya están todas confirmadas".
//
// No hay forma de deshacerlo desde la pantalla, por eso este script. Solo toca la COLA de BarTender
// (ImpresoEn / Impresora / SolicitadoEn): el correlativo, EtiquetaImpresa y bodega no cambian — las
// etiquetas siguen existiendo, solo vuelven a contar como "falta papel".
//
// Uso (desde backend/):
//   Ver qué hay:   npx tsx scripts/devolverPendientesBartender.ts --pedido 2025012 [--lote G136EM04-E03-8]
//   Ver el tramo:  npx tsx scripts/devolverPendientesBartender.ts --orden 123 --desde E5021 --hasta E5040
//   Aplicarlo:     ... lo mismo + --aplicar
//
// Sin --aplicar no escribe nada. Se niega a devolver etiquetas que ya se escanearon en bodega: si
// hay un master con ese correlativo, la etiqueta SÍ salió en papel y el dato correcto es "impresa".

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { parseCorrelativoSecuencial } from "../src/lib/correlativo.ts";

const prisma = new PrismaClient();

function arg(nombre: string): string | null {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : null;
}

async function main() {
  const pedido = arg("pedido");
  const lote = arg("lote");
  const orden = arg("orden") ? Number(arg("orden")) : null;
  const desde = parseCorrelativoSecuencial(arg("desde"));
  const hasta = parseCorrelativoSecuencial(arg("hasta"));
  const aplicar = process.argv.includes("--aplicar");

  // --- Paso 1: ubicar la captura. Por pedido (y lote) se listan las órdenes con su conteo. ---
  if (!orden) {
    if (!pedido) throw new Error("Indica --pedido <código> para buscar la captura, o --orden <OrdenId>.");
    const ordenes: any[] = await prisma.$queryRawUnsafe(`
      SELECT oe.OrdenId, oe.Lote, oe.CantidadMaster, oe.Estatus,
             COUNT(cb.EtiquetaId) AS EnCola, SUM(cb.ImpresoEn IS NOT NULL) AS Impresas,
             MIN(cb.EtiquetaId) AS DesdeId, MAX(cb.EtiquetaId) AS HastaId
      FROM OrdenEtiquetado oe
      JOIN DetallePedido dp ON oe.DetalleId = dp.DetalleId
      LEFT JOIN ColaEtiquetaBartender cb ON cb.OrdenId = oe.OrdenId
      WHERE dp.CodigoPedido = ? ${lote ? "AND oe.Lote = ?" : ""}
      GROUP BY oe.OrdenId ORDER BY oe.OrdenId`, ...(lote ? [pedido, lote] : [pedido]));
    if (!ordenes.length) { console.log("No hay capturas para ese pedido/lote."); return; }
    console.table(ordenes.map(o => ({
      OrdenId: Number(o.OrdenId), Lote: o.Lote, Cantidad: Number(o.CantidadMaster), Estatus: o.Estatus,
      EnCola: Number(o.EnCola), Impresas: Number(o.Impresas ?? 0),
      Rango: o.DesdeId ? `E${o.DesdeId} a E${o.HastaId}` : "-",
    })));
    console.log("\nVuelve a correrlo con --orden <OrdenId> para ver etiqueta por etiqueta.");
    return;
  }

  // --- Paso 2: detalle de la captura. Las que salieron juntas comparten ImpresoEn/Impresora. ---
  const filas: any[] = await prisma.$queryRawUnsafe(`
    SELECT cb.EtiquetaId, cb.Correlativo, cb.SolicitadoEn, cb.SolicitadoPor, cb.ImpresoEn, cb.Impresora,
           ei.Estatus, m.MasterId
    FROM ColaEtiquetaBartender cb
    JOIN EtiquetaImpresa ei ON ei.EtiquetaId = cb.EtiquetaId
    LEFT JOIN Masters m ON m.EtiquetaId = cb.EtiquetaId
    WHERE cb.OrdenId = ?
    ORDER BY cb.EtiquetaId`, orden);
  if (!filas.length) { console.log(`La captura ${orden} no tiene etiquetas en la cola de BarTender.`); return; }
  console.table(filas.map(f => ({
    Correlativo: f.Correlativo, Estatus: f.Estatus,
    ImpresoEn: f.ImpresoEn ? new Date(f.ImpresoEn).toISOString().replace("T", " ").slice(0, 19) : "-",
    Impresora: f.Impresora ?? "-", Solicitada: f.SolicitadoPor ?? "-",
    EnBodega: f.MasterId ? "SÍ" : "",
  })));

  if (desde === null || hasta === null) {
    console.log("\nIndica --desde y --hasta (ej. E5021) con el tramo que NO salió en papel.");
    return;
  }
  if (desde > hasta) throw new Error("--desde no puede ser mayor que --hasta.");

  const tramo = filas.filter(f => Number(f.EtiquetaId) >= desde && Number(f.EtiquetaId) <= hasta);
  const escaneadas = tramo.filter(f => f.MasterId);
  const aDevolver = tramo.filter(f => f.ImpresoEn && !f.MasterId);

  if (escaneadas.length) {
    console.log(`\nNO se puede: ${escaneadas.map(f => f.Correlativo).join(", ")} ya está(n) escaneada(s) en bodega, ` +
      `así que esa etiqueta sí salió. Ajusta el rango.`);
    return;
  }
  console.log(`\nTramo E${desde} a E${hasta}: ${tramo.length} etiqueta(s) de esta captura, ` +
    `${aDevolver.length} marcada(s) como impresa(s) que volverían a pendiente.`);
  if (!aDevolver.length) return;

  if (!aplicar) { console.log("Simulación — agrega --aplicar para hacerlo."); return; }

  // Mismo filtro que las rutas: OrdenId además del rango, porque los EtiquetaId de otra orden
  // pueden quedar intercalados. SolicitadoEn también se limpia para que la tanda no quede a medias
  // en la cola de "imprimir ahora"; el botón BarTender la vuelve a reservar.
  const n = await prisma.$executeRawUnsafe(`
    UPDATE ColaEtiquetaBartender
       SET ImpresoEn = NULL, Impresora = NULL, SolicitadoEn = NULL, SolicitadoPor = NULL
     WHERE OrdenId = ? AND EtiquetaId BETWEEN ? AND ? AND ImpresoEn IS NOT NULL
       AND EtiquetaId NOT IN (SELECT EtiquetaId FROM Masters WHERE EtiquetaId IS NOT NULL)`,
    orden, desde, hasta);
  console.log(`Listo: ${Number(n)} etiqueta(s) devuelta(s) a pendiente. En Impresión de Etiquetas la ` +
    `captura aparece otra vez con el botón para imprimir lo que falta.`);
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error("ERROR:", e.message); process.exit(1); });
