// Migración puntual: agrega el Área de trabajo (tabla Areas ya existente — ej. TUNEL, MASTERIZADO
// VARIOS, ETIQUETADO, REEMPAQUE) a OrdenEtiquetado. Se agrega NULLABLE porque ya existen capturas
// reales sin este dato (entradas de prueba del usuario) — quedan en NULL y se completan si se editan;
// la app exige el campo como obligatorio para TODA captura nueva (POST) y al editar (PUT).
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const cols: any[] = await p.$queryRawUnsafe("SHOW COLUMNS FROM OrdenEtiquetado LIKE 'AreaCodigo'");
  if (cols.length) {
    console.log("La columna AreaCodigo ya existe — migración omitida.");
    await p.$disconnect();
    return;
  }

  await p.$executeRawUnsafe(`
    ALTER TABLE OrdenEtiquetado
      ADD COLUMN AreaCodigo VARCHAR(10) NULL AFTER DetalleId,
      ADD CONSTRAINT fk_orden_area FOREIGN KEY (AreaCodigo) REFERENCES Areas(Codigo)
  `);
  console.log("Columna AreaCodigo agregada a OrdenEtiquetado (NULL en filas existentes).");

  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
