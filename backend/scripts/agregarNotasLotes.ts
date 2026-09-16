// Agrega Lotes.Notas — la observación que se escribe e imprime en la Hoja de Lote
// (Reporte de Producción → Hoja de Lote).
//
// La columna ya existe en la base de producción: se aplicó a mano en septiembre de 2026 sin dejar
// script, así que no había en el repositorio ningún rastro de que existiera. Este archivo repara eso:
// si algún día se levanta un ambiente nuevo o se restaura un respaldo anterior a ese cambio, la
// columna se vuelve a crear aquí en vez de que el código empiece a fallar sin explicación.
//
// TEXT y no VARCHAR: el largo real lo impone MAX_NOTAS en src/routes/lotes.ts. Con VARCHAR, pasarse
// del largo sería un error de MariaDB (sql_mode trae STRICT_TRANS_TABLES) en vez de un 400 claro.
//
// Es idempotente — correrlo de nuevo sobre una base que ya la tiene no hace nada.
import prisma from "../src/lib/prisma.ts";

await prisma.$executeRawUnsafe(
  "ALTER TABLE Lotes ADD COLUMN IF NOT EXISTS Notas TEXT NULL AFTER RegistradoPor"
);

const [col]: any[] = await prisma.$queryRawUnsafe(
  `SELECT COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Lotes' AND COLUMN_NAME = 'Notas'`
);
console.log(col ? `OK - Lotes.Notas ${col.COLUMN_TYPE} (nullable: ${col.IS_NULLABLE})` : "ERROR - la columna no quedó creada");

await prisma.$disconnect();
