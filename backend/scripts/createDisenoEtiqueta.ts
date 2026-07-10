// Posiciones (X,Y en puntos ZPL) de cada campo de la etiqueta de master — editables arrastrando en
// la vista previa de Impresión de Etiquetas, en vez de fijas en el código. Ver zpl.ts (CAMPOS_DISENO,
// POSICIONES_DEFECTO) y project_ordenetiquetado_design.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { POSICIONES_DEFECTO } from "../src/lib/zpl.ts";
const p = new PrismaClient();

async function main() {
  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS DisenoEtiqueta (
      Campo          VARCHAR(30)  NOT NULL PRIMARY KEY,
      X              INT          NOT NULL,
      Y              INT          NOT NULL,
      ActualizadoPor VARCHAR(100) NULL,
      ActualizadoEn  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla DisenoEtiqueta creada.");

  for (const [campo, { X, Y }] of Object.entries(POSICIONES_DEFECTO)) {
    await p.$executeRawUnsafe(`INSERT IGNORE INTO DisenoEtiqueta (Campo, X, Y) VALUES (?, ?, ?)`, campo, X, Y);
  }
  console.log(`${Object.keys(POSICIONES_DEFECTO).length} posiciones por defecto insertadas (INSERT IGNORE).`);

  await p.$disconnect();
}
main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
