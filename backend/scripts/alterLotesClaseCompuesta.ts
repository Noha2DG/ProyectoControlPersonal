import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Permite varias etapas de proceso (ej. C20 entero y D30 descabezado) del mismo Piscina+Ciclo+Fecha:
// el texto de Lote puede repetirse entre Clases, así que la llave real pasa de ser solo `Lote` a la
// combinación `(Lote, Clase)`. TransaccionesProduccion necesitaba saber de cuál Clase-origen viene cada
// transacción (antes lo asumía porque Lote ya era único) — se agrega `ClaseOrigen` y se hace FK compuesta
// contra Lotes(Lote, Clase). Ver memoria project_destajo_lote_clase_en_codigo.
async function main() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE TransaccionesProduccion ADD COLUMN ClaseOrigen VARCHAR(10) NULL AFTER Lote
  `);
  console.log("Columna ClaseOrigen agregada (nullable).");

  const backfill: any = await prisma.$executeRawUnsafe(`
    UPDATE TransaccionesProduccion tp
    JOIN Lotes l ON tp.Lote = l.Lote
    SET tp.ClaseOrigen = l.Clase
    WHERE tp.ClaseOrigen IS NULL
  `);
  console.log("Filas de ClaseOrigen rellenadas:", backfill);

  const faltantes: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS n FROM TransaccionesProduccion WHERE ClaseOrigen IS NULL`
  );
  if (Number(faltantes[0].n) > 0) {
    throw new Error(`Quedaron ${faltantes[0].n} filas sin ClaseOrigen tras el backfill — abortando antes de hacerla NOT NULL.`);
  }

  await prisma.$executeRawUnsafe(`
    ALTER TABLE TransaccionesProduccion MODIFY ClaseOrigen VARCHAR(10) NOT NULL
  `);
  console.log("ClaseOrigen ahora NOT NULL.");

  await prisma.$executeRawUnsafe(`
    ALTER TABLE TransaccionesProduccion DROP FOREIGN KEY fk_transprod_lote
  `);
  console.log("FK vieja fk_transprod_lote (solo Lote) eliminada.");

  await prisma.$executeRawUnsafe(`
    ALTER TABLE TransaccionesProduccion ADD INDEX idx_transprod_lote_clase (Lote, ClaseOrigen)
  `);
  console.log("Índice (Lote, ClaseOrigen) agregado.");

  await prisma.$executeRawUnsafe(`
    ALTER TABLE Lotes DROP PRIMARY KEY, ADD PRIMARY KEY (Lote, Clase)
  `);
  console.log("Llave primaria de Lotes cambiada a (Lote, Clase).");

  await prisma.$executeRawUnsafe(`
    ALTER TABLE TransaccionesProduccion
      ADD CONSTRAINT fk_transprod_lote FOREIGN KEY (Lote, ClaseOrigen) REFERENCES Lotes (Lote, Clase)
  `);
  console.log("FK compuesta fk_transprod_lote (Lote, ClaseOrigen) -> Lotes(Lote, Clase) creada.");
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error("ERROR:", e.message); process.exit(1); });
