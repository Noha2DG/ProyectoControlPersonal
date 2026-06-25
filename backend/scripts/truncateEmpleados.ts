import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

// Vaciado total de Empleados y tablas relacionadas para recarga masiva vía CSV.
// Ejecutar backupEmpleados.ts antes de correr este script.
const TABLAS = ["EntregaEquipo", "Permisos", "Transferencias", "Movimientos", "Bajas", "Altas", "Empleados"];

async function main() {
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
  for (const tabla of TABLAS) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tabla}`);
    console.log(`${tabla} vaciada.`);
  }
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
  await prisma.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
