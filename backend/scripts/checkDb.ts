import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const triggers = await p.$queryRawUnsafe("SHOW TRIGGERS WHERE `Table` = 'Empleados'");
  console.log("TRIGGERS:", JSON.stringify(triggers, null, 2));

  const cols = await p.$queryRawUnsafe(`
    SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT, DATA_TYPE, COLUMN_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'plantaProceso' AND TABLE_NAME = 'Empleados'
    ORDER BY ORDINAL_POSITION
  `);
  console.log("COLUMNS:", JSON.stringify(cols, null, 2));

  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
