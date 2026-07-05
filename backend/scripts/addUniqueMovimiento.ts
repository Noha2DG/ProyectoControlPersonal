import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

// Necesario para que el corte automático de medianoche (lib/corteMedianoche.ts)
// pueda usar INSERT IGNORE sin arriesgar marcajes automáticos duplicados si
// corre dos veces (kiosco + barrido) casi al mismo tiempo para el mismo empleado.
async function main() {
  const existe: any[] = await prisma.$queryRaw`
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Movimientos' AND INDEX_NAME = 'uniq_codigo_fecha_tipo'
  `;
  if (existe.length) {
    console.log("El índice único ya existe.");
  } else {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE Movimientos ADD UNIQUE KEY uniq_codigo_fecha_tipo (Codigo, FechaHora, Tipo)
    `);
    console.log("Índice único uniq_codigo_fecha_tipo agregado a Movimientos.");
  }
  await prisma.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
