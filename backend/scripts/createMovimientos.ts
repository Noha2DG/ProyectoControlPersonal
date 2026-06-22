import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Movimientos (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      Codigo      VARCHAR(50) NOT NULL,
      Tipo        ENUM('Entrada','Salida') NOT NULL,
      FechaHora   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      DiaSemana   VARCHAR(15) NOT NULL,
      INDEX idx_codigo (Codigo),
      INDEX idx_fecha (FechaHora)
    )
  `);
  console.log("Tabla Movimientos creada.");
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error("ERROR:", e.message); process.exit(1); });
