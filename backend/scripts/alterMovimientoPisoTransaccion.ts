// MovimientoPiso.TransaccionId: el traslado que nace al CERRAR una transacción de destajo.
//
// Al cerrar una transacción, lo que el lote produjo pasa al piso del siguiente proceso: lo pelado a
// Tratamiento (u otro proceso, según el cliente) y la cola de Descabezado a Pelado o a Clasificado
// Cola. Esta columna dice de qué transacción salió cada uno de esos movimientos, para no trasladar dos
// veces si se cierra otra vez y para poder deshacerlo si la transacción se reabre.
//
// Aditiva y nullable: el código anterior no la ve. Autorizada por el usuario el 21 oct 2026.
//
//   npx tsx scripts/alterMovimientoPisoTransaccion.ts             → ensayo, no escribe
//   npx tsx scripts/alterMovimientoPisoTransaccion.ts --aplicar   → la crea (se puede volver a correr)
//   npx tsx scripts/alterMovimientoPisoTransaccion.ts --deshacer  → la quita (si ningún movimiento la usa)
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

const aplicar = process.argv.includes("--aplicar");
const deshacer = process.argv.includes("--deshacer");

async function existe(sql: string, ...args: any[]) {
  const [r]: any[] = await prisma.$queryRawUnsafe(sql, ...args);
  return Number(r.n) > 0;
}
const hayColumna = () => existe(`SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'MovimientoPiso' AND COLUMN_NAME = 'TransaccionId'`);
const hayFK = () => existe(`SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'MovimientoPiso' AND CONSTRAINT_NAME = 'fk_movpiso_transaccion'`);
const hayIndice = () => existe(`SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'MovimientoPiso' AND INDEX_NAME = 'idx_movpiso_transaccion'`);

async function main() {
  console.log(`Columna: ${await hayColumna() ? "ya existe" : "no existe"} · FK: ${await hayFK() ? "sí" : "no"} · índice: ${await hayIndice() ? "sí" : "no"}`);

  if (deshacer) {
    if (await hayColumna()) {
      const [r]: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM MovimientoPiso WHERE TransaccionId IS NOT NULL`);
      if (Number(r.n) > 0) throw new Error(`${r.n} movimientos ya usan TransaccionId: no se quita para no perder de qué transacción salieron`);
    }
    if (await hayFK()) await prisma.$executeRawUnsafe(`ALTER TABLE MovimientoPiso DROP FOREIGN KEY fk_movpiso_transaccion`);
    if (await hayIndice()) await prisma.$executeRawUnsafe(`ALTER TABLE MovimientoPiso DROP INDEX idx_movpiso_transaccion`);
    if (await hayColumna()) await prisma.$executeRawUnsafe(`ALTER TABLE MovimientoPiso DROP COLUMN TransaccionId`);
    console.log("Deshecho.");
    return;
  }
  if (!aplicar) { console.log("Ensayo: no se escribió nada. Corre con --aplicar para hacerlo."); return; }

  if (!(await hayColumna())) {
    await prisma.$executeRawUnsafe(`ALTER TABLE MovimientoPiso ADD COLUMN TransaccionId INT NULL`);
    console.log("Columna MovimientoPiso.TransaccionId agregada.");
  }
  if (!(await hayIndice())) {
    await prisma.$executeRawUnsafe(`ALTER TABLE MovimientoPiso ADD INDEX idx_movpiso_transaccion (TransaccionId)`);
    console.log("Índice idx_movpiso_transaccion creado.");
  }
  if (!(await hayFK())) {
    await prisma.$executeRawUnsafe(`ALTER TABLE MovimientoPiso ADD CONSTRAINT fk_movpiso_transaccion
      FOREIGN KEY (TransaccionId) REFERENCES TransaccionesProduccion(TransaccionId)`);
    console.log("FK fk_movpiso_transaccion creada.");
  }
  console.log("Listo.");
}

main()
  .catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
