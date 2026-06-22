import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

// Evita prendas duplicadas dentro de la misma entrega (necesario para INSERT IGNORE
// al agregar equipo adicional a medio turno).
async function main() {
  const existe: any[] = await prisma.$queryRaw`
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'EntregaEquipoDetalle' AND INDEX_NAME = 'uniq_entrega_tipo'
  `;
  if (existe.length) {
    console.log("El índice único ya existe.");
  } else {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE EntregaEquipoDetalle ADD UNIQUE KEY uniq_entrega_tipo (EntregaId, CodigoTipoEquipo)
    `);
    console.log("Índice único uniq_entrega_tipo agregado a EntregaEquipoDetalle.");
  }
  await prisma.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
