// BANDA pasa a ser una mesa más con personal fijo (se asigna y se transfiere). Quien pesa sin mesa
// asignada ahora cae en "BANDA TEMPORAL", un grupo que arma el reporte y no existe en el catálogo.
// Por eso se quita la regla que impedía asignar a BANDA. Idempotente.
//
// Uso: npx tsx backend/scripts/alterMesasBandaAsignable.ts

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`ALTER TABLE MesaAsignacion DROP CONSTRAINT IF EXISTS chk_asig_no_banda`);
  const r: any[] = await prisma.$queryRawUnsafe(
    `SELECT CONSTRAINT_NAME FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'MesaAsignacion'`);
  console.log("Reglas que quedan en MesaAsignacion:", r.map(x => x.CONSTRAINT_NAME).join(", "));
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
