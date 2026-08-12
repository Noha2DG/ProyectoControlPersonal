// Vacía la cadena de producto terminado — Agrupación → Etiquetas → Masters → Polines → Bodega
// física → Remisiones — para volver a empezar una prueba desde cero.
//
// NO toca: Destajo (Lotes, PesajeDetalle, Transacciones), Empleados, ni ningún catálogo
// (Clientes, Subcliente, Racks, Posiciones, DiseñoEtiqueta, Áreas, Usuarios). Las posiciones de
// bodega se liberan solas: la ocupación vive en Pallets.PosicionId, no en Posiciones.
//
// Los pedidos se conservan por omisión. Solo se borran los que casen con --pedidos=<patrón LIKE>,
// pensado para los sembrados de prueba (PRB%). Un pedido real puede quedarse sin producto sin
// problema: vuelve a estar como recién creado.
//
// Uso:
//   npx tsx scripts/limpiarPruebasBodega.ts                      → solo muestra qué borraría
//   npx tsx scripts/limpiarPruebasBodega.ts --confirmar
//   npx tsx scripts/limpiarPruebasBodega.ts --confirmar --pedidos=PRB%
//   npx tsx scripts/limpiarPruebasBodega.ts --confirmar --reiniciar-contadores
//
// OJO: backend/.env apunta a PRODUCCIÓN. No hay base de desarrollo.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const CONFIRMAR = args.includes("--confirmar");
const REINICIAR = args.includes("--reiniciar-contadores");
const PATRON_PEDIDOS = (args.find(a => a.startsWith("--pedidos=")) || "").split("=")[1] || null;

const n = async (sql: string, ...vals: any[]) => {
  const r: any = await prisma.$queryRawUnsafe(sql, ...vals);
  return Number(r[0].n);
};

async function main() {
  console.log(CONFIRMAR ? "MODO REAL — se va a borrar\n" : "SIMULACRO — no se borra nada (agregá --confirmar)\n");

  // ── Inventario previo, para que quede en el log qué se llevó por delante
  const antes = {
    remisionDetalle: await n(`SELECT COUNT(*) n FROM RemisionDetalle`),
    remisiones:      await n(`SELECT COUNT(*) n FROM Remisiones`),
    movimientos:     await n(`SELECT COUNT(*) n FROM MovimientosBodega`),
    masters:         await n(`SELECT COUNT(*) n FROM Masters`),
    pallets:         await n(`SELECT COUNT(*) n FROM Pallets`),
    impresionLog:    await n(`SELECT COUNT(*) n FROM ImpresionLog`),
    etiquetas:       await n(`SELECT COUNT(*) n FROM EtiquetaImpresa`),
    ordenes:         await n(`SELECT COUNT(*) n FROM OrdenEtiquetado`),
    detallePedido:   PATRON_PEDIDOS ? await n(`SELECT COUNT(*) n FROM DetallePedido WHERE CodigoPedido LIKE ?`, PATRON_PEDIDOS) : 0,
    pedidos:         PATRON_PEDIDOS ? await n(`SELECT COUNT(*) n FROM Pedidos WHERE CodigoPedido LIKE ?`, PATRON_PEDIDOS) : 0,
  };

  for (const [k, v] of Object.entries(antes)) console.log(`  ${k.padEnd(16)} ${v}`);

  if (PATRON_PEDIDOS) {
    const lista: any[] = await prisma.$queryRawUnsafe(
      `SELECT CodigoPedido FROM Pedidos WHERE CodigoPedido LIKE ?`, PATRON_PEDIDOS);
    console.log(`\n  Pedidos que casan con "${PATRON_PEDIDOS}": ${lista.map(p => p.CodigoPedido).join(", ") || "ninguno"}`);
  } else {
    console.log(`\n  Sin --pedidos=<patrón>: no se borra ningún pedido ni su detalle.`);
  }

  const conservados: any[] = await prisma.$queryRawUnsafe(
    PATRON_PEDIDOS
      ? `SELECT CodigoPedido FROM Pedidos WHERE CodigoPedido NOT LIKE ?`
      : `SELECT CodigoPedido FROM Pedidos`,
    ...(PATRON_PEDIDOS ? [PATRON_PEDIDOS] : []));
  console.log(`  Pedidos que se conservan: ${conservados.map(p => p.CodigoPedido).join(", ") || "ninguno"}`);

  if (!CONFIRMAR) { await prisma.$disconnect(); return; }

  // ── Borrado en orden de llaves foráneas (de la hoja hacia la raíz)
  await prisma.$transaction(async tx => {
    const ex = (sql: string, ...v: any[]) => tx.$executeRawUnsafe(sql, ...v);

    await ex(`DELETE FROM RemisionDetalle`);
    await ex(`DELETE FROM MovimientosBodega`);   // apunta a Masters, Pallets, Remisiones y Posiciones
    await ex(`DELETE FROM Remisiones`);
    await ex(`DELETE FROM Masters`);             // apunta a EtiquetaImpresa y Pallets
    await ex(`DELETE FROM Pallets`);             // al irse, libera Pallets.PosicionId
    await ex(`DELETE FROM ImpresionLog`);        // apunta a EtiquetaImpresa
    await ex(`DELETE FROM EtiquetaImpresa`);     // apunta a OrdenEtiquetado
    await ex(`DELETE FROM OrdenEtiquetado`);     // apunta a DetallePedido

    if (PATRON_PEDIDOS) {
      await ex(`DELETE FROM DetallePedido WHERE CodigoPedido LIKE ?`, PATRON_PEDIDOS);
      await ex(`DELETE FROM Pedidos WHERE CodigoPedido LIKE ?`, PATRON_PEDIDOS);
    }

    if (REINICIAR) {
      // El folio de remisión es un documento con valor hacia afuera: un salto en la numeración se
      // lee como documentos faltantes. Se reinicia solo cuando la tabla quedó vacía.
      await ex(`UPDATE SerieRemision SET UltimoSecuencial = 0`);
      await ex(`UPDATE BodegaVirtual SET UltimoSecuencial = 0`);
      // El correlativo de la etiqueta ("E" + EtiquetaId) sale del auto_increment y va impreso en el
      // master, así que la prueba nueva arranca en E1.
      await ex(`ALTER TABLE EtiquetaImpresa AUTO_INCREMENT = 1`);
    }
  }, { timeout: 60_000 });

  // ── Verificación: que no quede nada colgando ni contadores desalineados
  console.log("\nDespués:");
  const despues = {
    remisionDetalle: await n(`SELECT COUNT(*) n FROM RemisionDetalle`),
    remisiones:      await n(`SELECT COUNT(*) n FROM Remisiones`),
    movimientos:     await n(`SELECT COUNT(*) n FROM MovimientosBodega`),
    masters:         await n(`SELECT COUNT(*) n FROM Masters`),
    pallets:         await n(`SELECT COUNT(*) n FROM Pallets`),
    impresionLog:    await n(`SELECT COUNT(*) n FROM ImpresionLog`),
    etiquetas:       await n(`SELECT COUNT(*) n FROM EtiquetaImpresa`),
    ordenes:         await n(`SELECT COUNT(*) n FROM OrdenEtiquetado`),
    pedidos:         await n(`SELECT COUNT(*) n FROM Pedidos`),
    detallePedido:   await n(`SELECT COUNT(*) n FROM DetallePedido`),
    posicionesOcup:  await n(`SELECT COUNT(*) n FROM Pallets WHERE PosicionId IS NOT NULL`),
  };
  for (const [k, v] of Object.entries(despues)) console.log(`  ${k.padEnd(16)} ${v}`);

  // Lo que NO se debía tocar sigue en pie
  console.log("\nIntacto (control):");
  for (const t of ["Lotes", "PesajeDetalle", "Clientes", "Subcliente", "Racks", "Posiciones", "DisenoEtiqueta", "Empleados"]) {
    console.log(`  ${t.padEnd(16)} ${await n(`SELECT COUNT(*) n FROM ${t}`)}`);
  }

  await prisma.$disconnect();
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
