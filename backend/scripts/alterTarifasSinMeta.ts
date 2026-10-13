// Quita Tarifas.MetaDia (8 oct 2026, decisión del usuario): la meta del día y la Lb/hr no se
// capturan, se calculan de la tarifa — meta = salario mínimo del día ÷ tarifa; Lb/hr = meta ÷ horas
// de la jornada. Guardarlas aparte permitía que no cuadraran con la tarifa.
//
// Uso: npx tsx backend/scripts/alterTarifasSinMeta.ts   (idempotente)

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const col: any[] = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tarifas' AND COLUMN_NAME = 'MetaDia'`);
  if (!col.length) { console.log("Tarifas ya no tiene MetaDia."); return; }
  // El CHECK menciona MetaDia: se quita antes que la columna y se vuelve a poner solo con la tarifa.
  await prisma.$executeRawUnsafe(`ALTER TABLE Tarifas DROP CONSTRAINT chk_tarifas_valor`);
  await prisma.$executeRawUnsafe(`ALTER TABLE Tarifas DROP COLUMN MetaDia`);
  await prisma.$executeRawUnsafe(`ALTER TABLE Tarifas ADD CONSTRAINT chk_tarifas_valor CHECK (Tarifa > 0)`);
  const cols: any[] = await prisma.$queryRawUnsafe(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tarifas' ORDER BY ORDINAL_POSITION`);
  console.log("Tarifas:", cols.map(c => c.COLUMN_NAME).join(", "));
}

main().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => prisma.$disconnect());
