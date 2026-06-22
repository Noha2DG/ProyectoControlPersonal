import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  // Agregar FechaSalida si no existe
  await p.$executeRawUnsafe(`
    ALTER TABLE Transferencias
    ADD COLUMN IF NOT EXISTS FechaSalida DATETIME NULL AFTER FechaHora
  `);
  console.log("Columna FechaSalida agregada (o ya existía).");
  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
