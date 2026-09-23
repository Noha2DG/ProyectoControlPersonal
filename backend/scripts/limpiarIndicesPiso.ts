// Quita dos índices que quedaron duplicados en MovimientoPiso.
//
// Nacieron como (AreaDestino, FechaProduccion) y (AreaOrigen, FechaProduccion). Cuando la fusión de
// bodegas cambió esas columnas por BodegaDestino/BodegaOrigen, se crearon los índices nuevos
// —  idx_movpiso_bdestino e idx_movpiso_borigen—  pero los viejos no desaparecieron: perdieron su
// primera columna y se quedaron como (FechaProduccion) a secas, que es letra por letra lo mismo que
// idx_movpiso_fecha.
//
// Tres árboles idénticos sobre la misma columna no aceleran ninguna lectura —  el optimizador usa
// uno—  pero los tres se mantienen en cada INSERT, UPDATE y DELETE. En una tabla que crece con cada
// master que baja al piso, eso es peso muerto en la ruta más caliente del módulo.
//
// DROP INDEX de un índice que no es único ni respalda una llave foránea no toca los datos y es
// reversible con un CREATE INDEX. Se comprueba antes de borrar que el índice equivalente siga ahí.
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

const SOBRAN = ["idx_movpiso_destino", "idx_movpiso_origen"];

async function main() {
  const cols = async (nombre: string) => {
    const r: any[] = await prisma.$queryRawUnsafe(
      `SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
         FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'MovimientoPiso' AND INDEX_NAME = ?`, nombre);
    return r[0]?.cols ?? null;
  };

  // El que se queda. Si no estuviera, borrar los otros dos dejaría la tabla sin índice por fecha.
  const queda = await cols("idx_movpiso_fecha");
  if (queda !== "FechaProduccion") {
    console.error(`ABORTA: idx_movpiso_fecha es (${queda ?? "no existe"}), no (FechaProduccion). No se borra nada.`);
    process.exit(1);
  }
  console.log("idx_movpiso_fecha (FechaProduccion) está en su sitio.");

  for (const nombre of SOBRAN) {
    const c = await cols(nombre);
    if (c == null) { console.log(`${nombre}: ya no estaba.`); continue; }
    if (c !== "FechaProduccion") {
      console.error(`ABORTA: ${nombre} es (${c}) y ya no es un duplicado. No se borra.`);
      process.exit(1);
    }
    await prisma.$executeRawUnsafe(`ALTER TABLE MovimientoPiso DROP INDEX ${nombre}`);
    console.log(`${nombre} (${c}) borrado — duplicaba a idx_movpiso_fecha.`);
  }

  const todos: any[] = await prisma.$queryRawUnsafe(
    `SELECT INDEX_NAME AS i, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
       FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'MovimientoPiso'
      GROUP BY INDEX_NAME ORDER BY INDEX_NAME`);
  console.log(`\nOK - MovimientoPiso queda con ${todos.length} índices:`);
  for (const t of todos) console.log(`  ${t.i.padEnd(26)} (${t.cols})`);

  await prisma.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
