import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  // Movimientos.FechaHora → DATETIME
  await p.$executeRawUnsafe(`
    ALTER TABLE Movimientos
    MODIFY COLUMN FechaHora DATETIME NOT NULL
  `);
  console.log("Movimientos.FechaHora → DATETIME");

  // Transferencias.FechaHora y FechaSalida → DATETIME
  await p.$executeRawUnsafe(`
    ALTER TABLE Transferencias
    MODIFY COLUMN FechaHora  DATETIME NOT NULL,
    MODIFY COLUMN FechaSalida DATETIME NULL
  `);
  console.log("Transferencias.FechaHora + FechaSalida → DATETIME");

  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
