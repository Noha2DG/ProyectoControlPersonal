// Decisión 14 jul 2026: el sistema arranca con UNA SOLA medida de etiqueta, la "3x1" (78x27mm, la
// única verificada contra impresiones físicas reales). Este script borra de DisenoEtiqueta las
// posiciones de los otros 3 tamaños (4x2/4x4/4x6, sembradas por alterTamanoEtiqueta.ts con medidas
// nominales nunca confirmadas) y deja '3x1' como DEFAULT de las columnas Tamano.
// Las EtiquetaImpresa históricas con Tamano '4x2' NO se tocan (son el registro de cómo se imprimió
// cada una); al reimprimirlas, tamanoValido() ya no las reconoce y caen al 3x1 actual.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const borradas = await p.$executeRawUnsafe(`DELETE FROM DisenoEtiqueta WHERE Tamano <> '3x1'`);
  console.log(`DisenoEtiqueta: ${borradas} posiciones de tamaños eliminados borradas (quedan solo las de 3x1).`);

  await p.$executeRawUnsafe(`ALTER TABLE DisenoEtiqueta ALTER COLUMN Tamano SET DEFAULT '3x1'`);
  await p.$executeRawUnsafe(`ALTER TABLE EtiquetaImpresa ALTER COLUMN Tamano SET DEFAULT '3x1'`);
  console.log("DEFAULT de Tamano actualizado a '3x1' en DisenoEtiqueta y EtiquetaImpresa.");

  const restantes: any[] = await p.$queryRaw`SELECT Tamano, COUNT(*) AS n FROM DisenoEtiqueta GROUP BY Tamano`;
  console.log("Diseños restantes:", restantes.map(r => `${r.Tamano}=${Number(r.n)}`).join(", "));
  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
