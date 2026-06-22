import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

async function main() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS PlanificacionAreas (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      Fecha      DATE NOT NULL,
      CodigoArea VARCHAR(10) NOT NULL,
      Cantidad   INT NOT NULL DEFAULT 0,
      CreadoEn   DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_plan (Fecha, CodigoArea)
    )
  `;
  console.log("Tabla PlanificacionAreas creada correctamente.");
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
