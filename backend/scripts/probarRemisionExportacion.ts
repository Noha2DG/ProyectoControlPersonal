// Ensayo de una remisión de EXPORTACIÓN completa contra la base real, dentro de una transacción que
// SIEMPRE se revierte: no queda nada escrito (ni folio, ni salida de bodega, ni kardex).
//
// Usa el pedido que se le pase (por defecto 020-2026, Peak One) y todo lo que tiene en bodega: crea
// la remisión como lo hace la pantalla, prueba los candados (línea del contenedor, polín abierto,
// producto de otra proforma, doble escaneo), carga los polines, confirma y arma la misma respuesta
// que GET /api/remisiones/:id para poder imprimir el documento. Deja el resultado en un JSON.
//
//   npx tsx scripts/probarRemisionExportacion.ts [CodigoPedido] [salida.json]
import "dotenv/config";
import fs from "fs";
import prisma from "../src/lib/prisma.ts";
import { MASTER_SELECT, formatearMaster } from "../src/lib/masters.ts";
import { resolverDestino, agregarPallet, agregarMaster, confirmarRemision } from "../src/routes/remisiones.ts";

const PEDIDO = process.argv[2] || "020-2026";
const SALIDA = process.argv[3] || "resultado-remision-exportacion.json";
const OP = "ENSAYO (no real)";
const FOLIO = "EX-ENSAYO";
const POLINES_POR_LINEA = 2;

type Paso = { ok: boolean; paso: string; detalle: string };
const pasos: Paso[] = [];
const check = (ok: boolean, paso: string, detalle = "") => { pasos.push({ ok, paso, detalle }); console.log(ok ? "  OK " : "  MAL", paso, detalle ? `— ${detalle}` : ""); };
async function debeFallar(f: () => Promise<any>, patron: RegExp, paso: string) {
  try { await f(); check(false, paso, "el sistema lo dejó pasar"); }
  catch (e: any) { check(patron.test(e.message), paso, `mensaje: "${e.message}"`); }
}
class Revertir extends Error {}
const n = (v: any) => Number(v);

(async () => {
  const t0 = Date.now();
  let resultado: any = null;
  try {
    await prisma.$transaction(async (tx) => {
      // ── Lo que hay en bodega del pedido, antes de tocar nada ──
      const pedido: any[] = await tx.$queryRawUnsafe(`
        SELECT p.CodigoPedido, p.Descripcion, p.Estatus, c.RazonSocial AS Cliente, s.RazonSocial AS Subcliente
          FROM Pedidos p JOIN Clientes c ON c.Codigo = p.CodigoCliente
          LEFT JOIN Subcliente s ON s.CodigoCliente = p.CodigoCliente AND s.CodigoSubcliente = p.CodigoSubcliente
         WHERE p.CodigoPedido = ?`, PEDIDO);
      if (!pedido.length) throw new Error(`No existe el pedido ${PEDIDO}`);
      const polines: any[] = await tx.$queryRawUnsafe(`
        SELECT pal.PalletId, pal.Codigo, pal.Estatus, pal.PosicionId, COUNT(*) AS Masters
          FROM Masters m JOIN EtiquetaImpresa ei ON ei.EtiquetaId = m.EtiquetaId
          JOIN OrdenEtiquetado oe ON oe.OrdenId = ei.OrdenId JOIN DetallePedido dp ON dp.DetalleId = oe.DetalleId
          JOIN Pallets pal ON pal.PalletId = m.PalletId
         WHERE dp.CodigoPedido = ? AND m.Estatus = 'EnBodega'
         GROUP BY pal.PalletId, pal.Codigo, pal.Estatus, pal.PosicionId ORDER BY pal.Codigo`, PEDIDO);
      const totalBodega = polines.reduce((s, p) => s + n(p.Masters), 0);
      const cerrados = polines.filter(p => p.Estatus === "Cerrado"), abiertos = polines.filter(p => p.Estatus === "Abierto");
      console.log(`Pedido ${PEDIDO}: ${totalBodega} masters en bodega, ${cerrados.length} polines cerrados y ${abiertos.length} abiertos`);

      // ── 1. Cabecera, como POST /api/remisiones ──
      console.log("1. Crear la remisión");
      const [serie]: any[] = await tx.$queryRawUnsafe(
        `SELECT Tipo, Prefijo, Nombre, Destino, TipoCliente, PidePedido, PideEmbarque, PideLinea, Activo, UltimoSecuencial FROM SerieRemision WHERE Tipo = 'Exportacion'`);
      check(n(serie.Activo) === 1 && n(serie.PidePedido) === 1 && n(serie.PideEmbarque) === 1 && n(serie.PideLinea) === 1,
        "La serie Exportación está activa y pide pedido, contenedor/sello y línea", `próximo folio real: ${serie.Prefijo}-${String(n(serie.UltimoSecuencial) + 1).padStart(4, "0")}`);
      await debeFallar(() => resolverDestino(tx, serie, {}), /pedido es requerido/, "Sin pedido no deja crear la remisión");
      const destino = await resolverDestino(tx, serie, { CodigoPedido: PEDIDO });
      const [cli]: any[] = await tx.$queryRawUnsafe(`SELECT RazonSocial, Tipo FROM Clientes WHERE Codigo = ?`, destino.CodigoCliente);
      check(cli.Tipo === serie.TipoCliente, "El cliente se hereda del pedido y es de exportación", `${cli.RazonSocial}${pedido[0].Subcliente ? ` — ${pedido[0].Subcliente}` : ""}`);
      await tx.$executeRawUnsafe(`
        INSERT INTO Remisiones (Folio, Tipo, Fecha, CodigoCliente, CodigoSubcliente, CodigoPedido, EsMixta, Contenedor, Sello, Observaciones, CreadoPor)
        VALUES (?, 'Exportacion', CURDATE(), ?, ?, ?, 0, 'ENSAYO-CONT-0001', 'ENSAYO-SELLO-0001', 'Ensayo del sistema: este documento NO es un despacho real.', ?)`,
        FOLIO, destino.CodigoCliente, destino.CodigoSubcliente, destino.CodigoPedido, OP);
      const [{ id }]: any[] = await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`);
      const rid = n(id);

      // ── 2. Candados del escaneo ──
      console.log("2. Candados al escanear");
      await debeFallar(() => agregarPallet(tx, rid, { Codigo: cerrados[0].Codigo }, OP), /número de línea/, "Sin número de línea del contenedor no deja escanear");
      if (abiertos.length) await debeFallar(() => agregarPallet(tx, rid, { Codigo: abiertos[0].Codigo, Linea: 1 }, OP), /sigue abierto/, `Un polín abierto (${abiertos[0].Codigo}) no se puede despachar entero`);
      const ajeno: any[] = await tx.$queryRawUnsafe(`
        SELECT pal.Codigo, dp.CodigoPedido FROM Pallets pal JOIN Masters m ON m.PalletId = pal.PalletId
          JOIN EtiquetaImpresa ei ON ei.EtiquetaId = m.EtiquetaId JOIN OrdenEtiquetado oe ON oe.OrdenId = ei.OrdenId
          JOIN DetallePedido dp ON dp.DetalleId = oe.DetalleId JOIN Pedidos pe ON pe.CodigoPedido = dp.CodigoPedido
         WHERE pal.Estatus = 'Cerrado' AND m.Estatus = 'EnBodega' AND dp.CodigoPedido <> ? AND pe.EsGeneral = 0
           AND NOT EXISTS (SELECT 1 FROM RemisionDetalle rd WHERE rd.MasterId = m.MasterId AND rd.Vigente = 1)
         ORDER BY pal.PalletId DESC LIMIT 1`, PEDIDO);
      if (ajeno.length) await debeFallar(() => agregarPallet(tx, rid, { Codigo: ajeno[0].Codigo, Linea: 1 }, OP), /va contra la proforma/, `Un polín de otra proforma (${ajeno[0].Codigo}, pedido ${ajeno[0].CodigoPedido}) se rechaza`);
      await debeFallar(() => agregarPallet(tx, rid, { Codigo: "ZZ9999", Linea: 1 }, OP), /QR no reconocido/, "Un código de polín que no existe se rechaza");

      // ── 3. Cargar los polines cerrados, con su línea ──
      console.log("3. Cargar polines");
      let cargados = 0, linea = 0;
      const porLinea: Record<number, string[]> = {};
      const tCarga = Date.now();
      for (let i = 0; i < cerrados.length; i++) {
        linea = Math.floor(i / POLINES_POR_LINEA) + 1;
        const r = await agregarPallet(tx, rid, { Codigo: cerrados[i].Codigo, Linea: linea }, OP);
        cargados += r.Agregados; (porLinea[linea] ??= []).push(cerrados[i].Codigo);
        if (r.Agregados !== n(cerrados[i].Masters)) check(false, `Polín ${cerrados[i].Codigo}`, `entraron ${r.Agregados} de ${cerrados[i].Masters}`);
      }
      const segPorPolin = (Date.now() - tCarga) / 1000 / Math.max(1, cerrados.length);
      check(cargados === cerrados.reduce((s, p) => s + n(p.Masters), 0), `Los ${cerrados.length} polines cerrados entran completos`, `${cargados} masters, ${segPorPolin.toFixed(1)} s por polín desde esta PC`);
      await debeFallar(() => agregarPallet(tx, rid, { Codigo: cerrados[0].Codigo, Linea: 1 }, OP), /despachado|ya no tiene masters/, "Escanear dos veces el mismo polín se rechaza");

      // ── 4. Polines abiertos: caja por caja, y enteros una vez cerrados ──
      let sueltos = 0;
      if (abiertos.length) {
        console.log("4. Polines abiertos");
        const dos: any[] = await tx.$queryRawUnsafe(`
          SELECT ei.Correlativo FROM Masters m JOIN EtiquetaImpresa ei ON ei.EtiquetaId = m.EtiquetaId
           WHERE m.PalletId = ? AND m.Estatus = 'EnBodega' ORDER BY m.MasterId LIMIT 2`, n(abiertos[0].PalletId));
        linea += 1;
        for (const c of dos) { await agregarMaster(tx, rid, { Correlativo: c.Correlativo, Linea: linea }, OP); sueltos++; }
        check(sueltos === dos.length, `De un polín abierto sí se puede sacar caja por caja (${abiertos[0].Codigo})`, `${sueltos} masters por correlativo`);
        await debeFallar(() => agregarMaster(tx, rid, { Correlativo: dos[0].Correlativo, Linea: linea }, OP), /ya está en la remisión/, "Escanear dos veces la misma caja se rechaza");
        // Simula que bodega cierra esos polines (solo dentro de la transacción) para cargarlos enteros.
        await tx.$executeRawUnsafe(`UPDATE Pallets SET Estatus = 'Cerrado' WHERE PalletId IN (${abiertos.map(() => "?").join(",")}) AND Estatus = 'Abierto'`, ...abiertos.map(a => n(a.PalletId)));
        for (const a of abiertos) {
          const r = await agregarPallet(tx, rid, { Codigo: a.Codigo, Linea: linea }, OP);
          cargados += r.Agregados; (porLinea[linea] ??= []).push(a.Codigo);
        }
        check(cargados + sueltos === totalBodega, `Cerrados los ${abiertos.length} polines abiertos, entra el resto`, `${cargados + sueltos} de ${totalBodega} masters`);
      }

      // ── 5. Bodega después del escaneo (antes de confirmar) ──
      console.log("5. Bodega");
      const [b]: any[] = await tx.$queryRawUnsafe(`
        SELECT SUM(m.Estatus = 'Salido') AS Salidos, SUM(m.Estatus = 'EnBodega') AS EnBodega
          FROM Masters m JOIN EtiquetaImpresa ei ON ei.EtiquetaId = m.EtiquetaId
          JOIN OrdenEtiquetado oe ON oe.OrdenId = ei.OrdenId JOIN DetallePedido dp ON dp.DetalleId = oe.DetalleId
         WHERE dp.CodigoPedido = ? AND m.MasterId IN (SELECT MasterId FROM RemisionDetalle WHERE RemisionId = ?)`, PEDIDO, rid);
      check(n(b.Salidos) === totalBodega && n(b.EnBodega) === 0, "Todo lo escaneado quedó rebajado de bodega en el acto", `${b.Salidos} masters Salido`);
      const [k]: any[] = await tx.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM MovimientosBodega WHERE RemisionId = ? AND Tipo = 'SALIDA'`, rid);
      check(n(k.n) === totalBodega, "El kardex tiene una SALIDA por cada master", `${k.n} movimientos`);
      const [pp]: any[] = await tx.$queryRawUnsafe(
        `SELECT SUM(Estatus = 'Despachado') AS Desp, SUM(PosicionId IS NOT NULL) AS ConPos FROM Pallets WHERE PalletId IN (${polines.map(() => "?").join(",")})`, ...polines.map(p => n(p.PalletId)));
      check(n(pp.Desp) === polines.length && n(pp.ConPos) === 0, "Los polines quedaron Despachados y soltaron su posición en el rack", `${pp.Desp} de ${polines.length}; con posición antes: ${polines.filter(p => p.PosicionId != null).length}`);

      // ── 6. Confirmar ──
      console.log("6. Confirmar");
      const conf = await confirmarRemision(tx, rid, OP);
      check(conf.Masters === totalBodega && conf.PisoLineas === 0, "Confirma: es la entrega, no carga ningún piso", `${conf.Masters} masters, ${conf.PolinesDespachados} polines despachados`);
      await debeFallar(() => agregarPallet(tx, rid, { Codigo: cerrados[0].Codigo, Linea: 1 }, OP), /confirmada/, "Confirmada ya no acepta más producto");

      // ── 7. Lo que devuelve GET /api/remisiones/:id (lo que imprime la hoja) ──
      const [rem]: any[] = await tx.$queryRawUnsafe(`
        SELECT r.*, se.Nombre AS NombreTipo, se.Destino, se.PideEmbarque, se.PidePedido, se.PideLinea,
               cli.RazonSocial AS NombreCliente, sub.RazonSocial AS NombreSubcliente, ped.Descripcion AS DescripcionPedido
          FROM Remisiones r JOIN SerieRemision se ON r.Tipo = se.Tipo
          LEFT JOIN Clientes cli ON r.CodigoCliente = cli.Codigo
          LEFT JOIN Subcliente sub ON r.CodigoCliente = sub.CodigoCliente AND r.CodigoSubcliente = sub.CodigoSubcliente
          LEFT JOIN Pedidos ped ON r.CodigoPedido = ped.CodigoPedido
         WHERE r.RemisionId = ?`, rid);
      const det: any[] = await tx.$queryRawUnsafe(`
        SELECT rd.DetalleId AS RemisionDetalleId, rd.LineaContenedor, sub2.*
          FROM RemisionDetalle rd JOIN (${MASTER_SELECT}) sub2 ON rd.MasterId = sub2.MasterId
         WHERE rd.RemisionId = ? AND rd.Vigente = 1 ORDER BY rd.LineaContenedor ASC, rd.DetalleId ASC`, rid);
      const lineas = det.map(d => {
        const m = formatearMaster(d);
        return { ...m, RemisionDetalleId: n(d.RemisionDetalleId), LineaContenedor: d.LineaContenedor == null ? null : n(d.LineaContenedor),
                 CalzaConDestino: n(rem.CodigoCliente) === m.CodigoCliente };
      });
      const hoja = {
        ...rem, RemisionId: rid, PideEmbarque: true, PidePedido: true, PideLinea: true, EsMixta: false,
        CodigoCliente: n(rem.CodigoCliente), Fecha: new Date(rem.Fecha).toISOString().slice(0, 10),
        Lineas: lineas, CantidadMasters: lineas.length,
        PesoKg: lineas.reduce((a, l) => a + l.PesoMasterKG, 0), PesoLb: lineas.reduce((a, l) => a + l.PesoMasterLb, 0),
      };
      check(lineas.length === totalBodega && lineas.every(l => l.LineaContenedor != null), "El documento trae todas las cajas, cada una con su línea", `${lineas.length} masters, ${hoja.PesoKg.toFixed(2)} kg`);
      check(lineas.every(l => l.CalzaConDestino), "Toda etiqueta es del mismo cliente de la remisión", "");

      // ── 8. Contra la proforma ──
      const cuadre: any[] = await tx.$queryRawUnsafe(`
        SELECT dp.DetalleId, dp.Clase, cl.Descripcion AS Producto, ta.Descripcion AS Talla, pr.Descripcion AS Presentacion,
               pr.CajasXMaster, pr.PesoKG, dp.CantidadCajas, dp.KgPedido, dp.Anulada,
               (SELECT COUNT(*) FROM RemisionDetalle rd JOIN Masters m ON m.MasterId = rd.MasterId
                  JOIN EtiquetaImpresa ei ON ei.EtiquetaId = m.EtiquetaId JOIN OrdenEtiquetado oe ON oe.OrdenId = ei.OrdenId
                 WHERE rd.RemisionId = ? AND rd.Vigente = 1 AND oe.DetalleId = dp.DetalleId) AS MastersRemision
          FROM DetallePedido dp LEFT JOIN Clase cl ON cl.Clase = dp.Clase LEFT JOIN Tallas ta ON ta.Codigo = dp.Talla
          LEFT JOIN Presentacion pr ON pr.Codigo = dp.Presentacion
         WHERE dp.CodigoPedido = ? ORDER BY dp.DetalleId`, rid, PEDIDO);
      const filasCuadre = cuadre.map(c => {
        const pedidos = n(c.Anulada) ? 0 : n(c.CantidadCajas) / n(c.CajasXMaster);
        return { Producto: c.Producto, Talla: c.Talla, Presentacion: c.Presentacion, Anulada: n(c.Anulada) === 1,
                 CajasPedido: n(c.CantidadCajas), MastersPedido: pedidos, MastersRemision: n(c.MastersRemision),
                 Diferencia: n(c.MastersRemision) - pedidos, KgPedido: n(c.KgPedido), KgRemision: n(c.MastersRemision) * n(c.CajasXMaster) * n(c.PesoKG) };
      });
      const descuadres = filasCuadre.filter(f => !f.Anulada && f.Diferencia !== 0);
      check(descuadres.length === 0, "Lo cargado cuadra con la proforma línea por línea",
        descuadres.length ? descuadres.map(f => `${f.Talla} ${f.Presentacion}: ${f.Diferencia > 0 ? "+" : ""}${f.Diferencia}`).join("; ") : "sin diferencias");

      resultado = {
        pedido: pedido[0], folioReal: `${serie.Prefijo}-${String(n(serie.UltimoSecuencial) + 1).padStart(4, "0")}`,
        totalBodega, polines: polines.map(p => ({ Codigo: p.Codigo, Estatus: p.Estatus, Masters: n(p.Masters), ConPosicion: p.PosicionId != null })),
        porLinea, segPorPolin, hoja, cuadre: filasCuadre,
      };
      throw new Revertir();
    }, { timeout: 600_000, maxWait: 20_000 });
  } catch (e: any) {
    if (!(e instanceof Revertir)) { console.error("ERROR:", e.message); pasos.push({ ok: false, paso: "El ensayo se interrumpió", detalle: e.message }); }
  }

  // Nada quedó escrito.
  const [r]: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM Remisiones WHERE Folio = ?`, FOLIO);
  const [s]: any[] = await prisma.$queryRawUnsafe(`SELECT UltimoSecuencial FROM SerieRemision WHERE Tipo = 'Exportacion'`);
  const [m]: any[] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS n FROM Masters m JOIN EtiquetaImpresa ei ON ei.EtiquetaId = m.EtiquetaId
      JOIN OrdenEtiquetado oe ON oe.OrdenId = ei.OrdenId JOIN DetallePedido dp ON dp.DetalleId = oe.DetalleId
     WHERE dp.CodigoPedido = ? AND m.Estatus = 'EnBodega'`, PEDIDO);
  check(n(r.n) === 0 && (!resultado || n(m.n) === resultado.totalBodega), "Todo se revirtió: la bodega y la serie quedaron como estaban",
    `${m.n} masters en bodega, serie en ${s.UltimoSecuencial}, sin remisión de ensayo`);

  const mal = pasos.filter(p => !p.ok).length;
  console.log(`\n${pasos.length - mal} OK, ${mal} MAL en ${((Date.now() - t0) / 1000).toFixed(0)} s (todo revertido)`);
  fs.writeFileSync(SALIDA, JSON.stringify({ generado: new Date().toLocaleString("sv-SE", { timeZone: "America/Guatemala" }), pasos, ...resultado },
    (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2));
  console.log("Resultado en", SALIDA);
  await prisma.$disconnect();
  process.exitCode = mal ? 1 : 0;
})();
