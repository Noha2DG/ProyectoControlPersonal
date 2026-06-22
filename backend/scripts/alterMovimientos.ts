import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE Movimientos
      ADD COLUMN NombreEmpleado VARCHAR(100) NOT NULL DEFAULT '' AFTER Codigo,
      ADD COLUMN Operador       VARCHAR(100) NOT NULL DEFAULT 'Sistema' AFTER DiaSemana
  `);
  console.log("Tabla Movimientos actualizada con NombreEmpleado y Operador.");
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error("ERROR:", e.message); process.exit(1); });
