// Decisión 11 nov 2026: el peso de la presentación (kg y lb por caja) lleva 5 decimales, para que la
// libra salga con la constante de toda la aplicación (LB_POR_KG = 2.20462, utils/destajo.js) y no
// redondeada a 3 al guardar. Lo ya capturado NO se recalcula: las presentaciones de antes conservan su
// valor (ej. 1 kg = 2.2 lb), y con él el peso de lo que ya está en bodega.
//
// Ampliar DECIMAL(8,3) → DECIMAL(10,5) no pierde nada: mismos 5 enteros, 2 decimales más.
//
//   npx tsx scripts/alterPresentacionPeso5Decimales.ts            → amplía las columnas
//   npx tsx scripts/alterPresentacionPeso5Decimales.ts --revertir → regresa a DECIMAL(8,3) (redondea a 3)
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function tipos() {
  const r: any[] = await prisma.$queryRawUnsafe(
    `SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Presentacion' AND COLUMN_NAME IN ('PesoKG', 'PesoLb')`);
  return Object.fromEntries(r.map(x => [x.COLUMN_NAME, x.COLUMN_TYPE]));
}

async function main() {
  const revertir = process.argv.includes("--revertir");
  const tipo = revertir ? "DECIMAL(8,3)" : "DECIMAL(10,5)";
  console.log("Antes:", await tipos());
  const suma = async () => (await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS n, SUM(PesoKG) AS kg, SUM(PesoLb) AS lb FROM Presentacion`) as any[])[0];
  const antes = await suma();
  await prisma.$executeRawUnsafe(`ALTER TABLE Presentacion MODIFY PesoKG ${tipo} NOT NULL, MODIFY PesoLb ${tipo} NOT NULL`);
  const despues = await suma();
  console.log("Después:", await tipos());
  console.log("Filas / suma kg / suma lb antes:  ", String(antes.n), String(antes.kg), String(antes.lb));
  console.log("Filas / suma kg / suma lb después:", String(despues.n), String(despues.kg), String(despues.lb));
}
main().finally(() => prisma.$disconnect());
