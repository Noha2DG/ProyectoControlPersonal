// Agrega columna Visible (mostrar/ocultar cada campo, no solo reposicionarlo) y los 5 campos nuevos
// opcionales (color, origen, congelacion, area, fechaProduccion) a DisenoEtiqueta. Las 6 filas que ya
// existan (con posiciones ya personalizadas por el usuario) NO se tocan — solo se les agrega Visible=1.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { POSICIONES_DEFECTO } from "../src/lib/zpl.ts";
const p = new PrismaClient();

async function main() {
  const cols: any[] = await p.$queryRawUnsafe("SHOW COLUMNS FROM DisenoEtiqueta LIKE 'Visible'");
  if (!cols.length) {
    await p.$executeRawUnsafe("ALTER TABLE DisenoEtiqueta ADD COLUMN Visible TINYINT(1) NOT NULL DEFAULT 1 AFTER Y");
    console.log("Columna Visible agregada (filas existentes quedan en Visible=1).");
  } else {
    console.log("La columna Visible ya existe — se omite ese paso.");
  }

  for (const [campo, { X, Y, Visible }] of Object.entries(POSICIONES_DEFECTO)) {
    await p.$executeRawUnsafe(
      `INSERT IGNORE INTO DisenoEtiqueta (Campo, X, Y, Visible) VALUES (?, ?, ?, ?)`,
      campo, X, Y, Visible ? 1 : 0,
    );
  }
  console.log(`${Object.keys(POSICIONES_DEFECTO).length} campos verificados (los que ya existían no se modificaron).`);

  await p.$disconnect();
}
main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
