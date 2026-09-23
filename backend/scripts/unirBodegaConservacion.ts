// BODEGA y BODEGA_CONSERVACION son el mismo lugar (el usuario, 23 sep 2026).
//
// Quedaron duplicadas por venir de las dos tablas viejas: BodegaVirtual la conocía como "Bodega"
// —  el origen del polín B0001—  y BodegaProceso como "Bodega Conservación", su puesto en el flujo
// de planta. Las áreas no dejan lugar a dudas de que es una sola: CB (Encargado Bodega
// Conservación), EL (Carga y Descarga) y FF (Despacho) son la gente de bodega de producto terminado.
//
// SOBREVIVE 'BODEGA', que es la que carga los 69 polines. Mover 69 filas de Pallets para quedarse
// con el código más bonito sería pagar riesgo por estética; mover 3 áreas no cuesta nada. Es el
// mismo criterio con que se fundieron las dos tablas (ver fusionarBodegas.ts).
//
// Se queda con lo mejor de cada una: la letra B y su secuencial (los polines conservan su código),
// el nombre "Bodega Conservación" (como le dice la planta) y el Orden 13 (su lugar en el flujo,
// después del Túnel).
//
// LlevaPiso = 0, y esto sí es una decisión, no un arrastre: bodega conservación YA lleva su
// inventario, por polín y posición física (Pallets + MovimientosBodega). Encenderle el inventario
// al piso contaría el mismo producto dos veces, en kilos por un lado y en masters por el otro.
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

const VIEJA = "BODEGA_CONSERVACION";
const NUEVA = "BODEGA";

async function main() {
  const [existe]: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS n FROM BodegaVirtual WHERE Codigo = ?`, VIEJA);
  if (Number(existe.n) === 0) { console.log("Ya estaban unidas. Nada que hacer."); await prisma.$disconnect(); return; }

  await prisma.$transaction(async (tx) => {
    // 'BODEGA' hereda el nombre y el puesto en el flujo. La letra y el secuencial NO se tocan:
    // ahí cuelgan 69 códigos de polín ya impresos.
    await tx.$executeRawUnsafe(
      `UPDATE BodegaVirtual SET Nombre = 'Bodega Conservación', Orden = 13, LlevaPiso = 0
        WHERE Codigo = ?`, NUEVA);

    // Todo lo que apuntaba a la vieja pasa a la que sobrevive. Los movimientos y hojas hoy están en
    // cero, pero la migración no puede depender de que sigan en cero mañana.
    const areas = Number(await tx.$executeRawUnsafe(
      `UPDATE Areas SET BodegaVirtualCodigo = ? WHERE BodegaVirtualCodigo = ?`, NUEVA, VIEJA));
    const mo = Number(await tx.$executeRawUnsafe(
      `UPDATE MovimientoPiso SET BodegaOrigen = ? WHERE BodegaOrigen = ?`, NUEVA, VIEJA));
    const md = Number(await tx.$executeRawUnsafe(
      `UPDATE MovimientoPiso SET BodegaDestino = ? WHERE BodegaDestino = ?`, NUEVA, VIEJA));
    const ho = Number(await tx.$executeRawUnsafe(
      `UPDATE HojaProceso SET BodegaCodigo = ? WHERE BodegaCodigo = ?`, NUEVA, VIEJA));
    const pa = Number(await tx.$executeRawUnsafe(
      `UPDATE Pallets SET BodegaVirtualCodigo = ? WHERE BodegaVirtualCodigo = ?`, NUEVA, VIEJA));
    console.log(`Reapuntados: ${areas} áreas, ${mo + md} movimientos, ${ho} hojas, ${pa} polines.`);

    await tx.$executeRawUnsafe(`DELETE FROM BodegaVirtual WHERE Codigo = ?`, VIEJA);
  });

  const r: any[] = await prisma.$queryRawUnsafe(`
    SELECT b.Orden, b.Codigo, b.Nombre, b.Letra, b.UltimoSecuencial AS Seq, b.LlevaPiso,
           (SELECT COUNT(*) FROM Pallets p WHERE p.BodegaVirtualCodigo = b.Codigo) AS Polines,
           (SELECT COUNT(*) FROM Areas a WHERE a.BodegaVirtualCodigo = b.Codigo AND a.Activa = 1) AS Areas
      FROM BodegaVirtual b WHERE b.Codigo = ?`, NUEVA);
  const x = r[0];
  console.log(`\n  #${x.Orden} ${x.Nombre} (${x.Codigo}) letra ${x.Letra} seq ${x.Seq} ` +
              `piso ${x.LlevaPiso ? "sí" : "no"} — ${x.Polines} polines, ${x.Areas} áreas`);

  const [tot]: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM BodegaVirtual`);
  console.log(`  El catálogo queda en ${tot.n} bodegas.`);
  await prisma.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
