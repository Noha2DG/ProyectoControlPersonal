// Renombra el tipo de mesa EXPERIENCIA → PELADORAS (mesas 1 a 8).
//
// La regla CHECK de la tabla solo admitía EXPERIENCIA, así que hay que soltarla, actualizar las
// filas y volver a crearla con el nombre nuevo. Idempotente: si ya se corrió, no cambia nada.
//
// Uso: npx tsx backend/scripts/alterMesasTipoPeladoras.ts

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const antes: any[] = await prisma.$queryRawUnsafe(`SELECT Codigo FROM Mesas WHERE Tipo = 'EXPERIENCIA' ORDER BY Orden`);
  console.log(`Mesas con EXPERIENCIA: ${antes.length} (${antes.map(r => r.Codigo).join(", ")})`);

  await prisma.$executeRawUnsafe(`ALTER TABLE Mesas DROP CONSTRAINT IF EXISTS chk_mesas_tipo`);
  const n = await prisma.$executeRawUnsafe(`UPDATE Mesas SET Tipo = 'PELADORAS' WHERE Tipo = 'EXPERIENCIA'`);
  await prisma.$executeRawUnsafe(
    `ALTER TABLE Mesas ADD CONSTRAINT chk_mesas_tipo CHECK (Tipo IN ('PELADORAS', 'APRENDIZAJE', 'BANDA'))`);
  console.log(`Filas actualizadas: ${n}`);

  const despues: any[] = await prisma.$queryRawUnsafe(`SELECT Tipo, COUNT(*) n FROM Mesas GROUP BY Tipo ORDER BY Tipo`);
  for (const r of despues) console.log(`   ${r.Tipo.padEnd(12)} ${Number(r.n)}`);
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
