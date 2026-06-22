import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`UPDATE Empleados SET DPI = '0' WHERE DPI IS NULL OR DPI = ''`);
  await prisma.$executeRawUnsafe(`ALTER TABLE Empleados MODIFY COLUMN DPI BIGINT NOT NULL DEFAULT 0`);
  console.log("Columna DPI modificada a BIGINT NOT NULL DEFAULT 0.");
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error("ERROR:", e.message); process.exit(1); });
