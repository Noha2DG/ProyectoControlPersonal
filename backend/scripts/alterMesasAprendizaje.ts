// Renombra las mesas de aprendizaje: MESA09–MESA12 ("MESA 9"…"MESA 12") → APR01–APR04
// ("APRENDIZAJE 1"…"APRENDIZAJE 4"), con numeración propia del 1 al 4.
//
// Cambia también el Codigo (la llave) porque todavía ninguna tabla apunta a Mesas: una vez que
// existan asignaciones de personas, el código ya no se toca. El Orden (9–12) se conserva para que
// sigan listándose después de las mesas de peladoras. Idempotente: si ya se corrió, no cambia nada.
//
// Uso: npx tsx backend/scripts/alterMesasAprendizaje.ts

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CAMBIOS: [string, string, string][] = [
  ["MESA09", "APR01", "APRENDIZAJE 1"],
  ["MESA10", "APR02", "APRENDIZAJE 2"],
  ["MESA11", "APR03", "APRENDIZAJE 3"],
  ["MESA12", "APR04", "APRENDIZAJE 4"],
];

async function main() {
  const fks: any[] = await prisma.$queryRawUnsafe(
    `SELECT TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = 'Mesas'`);
  if (fks.length) throw new Error(`Hay tablas que apuntan a Mesas (${fks.map(f => f.TABLE_NAME).join(", ")}): no se cambian códigos.`);

  await prisma.$transaction(async tx => {
    for (const [viejo, nuevo, nombre] of CAMBIOS) {
      const n = await tx.$executeRawUnsafe(
        `UPDATE Mesas SET Codigo = ?, Nombre = ?, Tipo = 'APRENDIZAJE' WHERE Codigo = ?`, nuevo, nombre, viejo);
      console.log(`   ${viejo} → ${nuevo} "${nombre}": ${n ? "actualizada" : "ya estaba"}`);
    }
  });

  const rows: any[] = await prisma.$queryRawUnsafe(`SELECT Codigo, Nombre, Tipo, Orden, Activa FROM Mesas ORDER BY Orden, Codigo`);
  console.log("Catálogo:");
  for (const r of rows) console.log(`   ${String(r.Orden).padStart(2)}  ${r.Codigo.padEnd(7)} ${r.Nombre.padEnd(14)} ${r.Tipo}${Number(r.Activa) ? "" : " (inactiva)"}`);
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
