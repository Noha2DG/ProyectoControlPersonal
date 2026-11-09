// Descongelado pesa por termo (usuario, 9 nov 2026): cada termo que sale de la báscula es UNA pesada,
// y una pesada puede llevar masters de varias líneas del piso (el final de un lote con el principio
// de otro). Cada línea sigue siendo su par CONSUMO + TRASLADO de siempre; lo que faltaba era saber
// qué pares salieron en el mismo termo, para quitarlo o corregirle el peso completo.
//
// PesadaId = el MovimientoId del primer CONSUMO del termo, puesto en todos sus CONSUMO y TRASLADO.
// Sin llave foránea a propósito: el primer consumo se apunta a sí mismo y al borrar el termo se van
// todas sus filas juntas. NULL en todo lo anterior al 9 nov 2026.
//
// Aditivo: una columna NULL y su índice. Se puede correr con la planta trabajando; el código
// desplegado hoy no la lee.
//
//   npx tsx scripts/alterMovimientoPisoPesada.ts          → agrega (idempotente)
//   npx tsx scripts/alterMovimientoPisoPesada.ts --drop   → la quita (solo si ningún termo la usa)
//
// OJO: backend/.env apunta a PRODUCCIÓN.
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

async function hayColumna() {
  const [r]: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'MovimientoPiso' AND COLUMN_NAME = 'PesadaId'`);
  return Number(r.n) > 0;
}

async function crear() {
  if (!(await hayColumna())) await prisma.$executeRawUnsafe(`ALTER TABLE MovimientoPiso ADD COLUMN PesadaId INT NULL`);
  await prisma.$executeRawUnsafe(`ALTER TABLE MovimientoPiso ADD INDEX IF NOT EXISTS idx_movpiso_pesada (PesadaId)`);
  console.log("MovimientoPiso.PesadaId verificada (con índice).");
}

async function deshacer() {
  if (await hayColumna()) {
    const [r]: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM MovimientoPiso WHERE PesadaId IS NOT NULL`);
    if (Number(r.n) > 0) throw new Error(`Hay ${r.n} movimientos pesados por termo: no se quita la columna.`);
  }
  await prisma.$executeRawUnsafe(`ALTER TABLE MovimientoPiso DROP INDEX IF EXISTS idx_movpiso_pesada`);
  await prisma.$executeRawUnsafe(`ALTER TABLE MovimientoPiso DROP COLUMN IF EXISTS PesadaId`);
  console.log("MovimientoPiso.PesadaId quitada.");
}

(process.argv.includes("--drop") ? deshacer() : crear())
  .catch(e => { console.error("ERROR:", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
