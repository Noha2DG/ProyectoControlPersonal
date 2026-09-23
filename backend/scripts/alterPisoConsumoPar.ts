// Ata el renglón de descongelado con el consumo que lo originó.
//
// Hasta hoy bajar producto y despacharlo eran dos capturas independientes: primero el CONSUMO
// (sección 1 del papel) y después, escogiéndolo otra vez de una lista, el TRASLADO (sección 2).
// Nada en la base decía que esas dos filas hablaban del mismo camarón — se adivinaba comparando
// Lote+Clase+Talla+Remisión, que es exactamente la clase de amarre que se rompe el día que una
// misma línea se parte hacia dos áreas.
//
// Con ConsumoId el par queda explícito y se pueden hacer dos cosas que antes no:
//   · borrar un descongelado y que se lleve su consumo, sin dejar producto colgado en la hoja que
//     al cerrar se convertiría en merma fantasma;
//   · mostrar en UNA sola fila lo declarado y lo pesado, que es lo que la hoja de papel pone en
//     dos secciones solo porque el papel no puede calcular la diferencia.
//
// Nullable y al final de la tabla → ALGORITHM=INSTANT, no reconstruye nada. Los renglones viejos
// (los capturados con el flujo de dos pasos) se quedan en NULL y siguen funcionando igual: el
// borrado sin par borra una sola fila, como siempre.
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

async function main() {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE MovimientoPiso ADD COLUMN IF NOT EXISTS ConsumoId INT NULL`);
  console.log("Columna ConsumoId verificada.");

  // La FK se agrega aparte y tolerando que ya exista: ADD CONSTRAINT no acepta IF NOT EXISTS en
  // MariaDB 10.5, así que se pregunta antes en vez de tragarse el error a ciegas.
  const [fk]: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'MovimientoPiso'
        AND CONSTRAINT_NAME = 'fk_movpiso_consumo'`);
  if (Number(fk.n) === 0) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE MovimientoPiso ADD CONSTRAINT fk_movpiso_consumo
         FOREIGN KEY (ConsumoId) REFERENCES MovimientoPiso(MovimientoId)`);
    console.log("Llave fk_movpiso_consumo creada.");
  } else {
    console.log("Llave fk_movpiso_consumo ya estaba.");
  }

  await prisma.$executeRawUnsafe(
    `ALTER TABLE MovimientoPiso ADD INDEX IF NOT EXISTS idx_movpiso_consumo (ConsumoId)`);
  console.log("Índice idx_movpiso_consumo verificado.");

  const [r]: any[] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS filas,
           SUM(CASE WHEN ConsumoId IS NOT NULL THEN 1 ELSE 0 END) AS conPar
      FROM MovimientoPiso`);
  console.log(`OK - MovimientoPiso: ${r.filas} filas, ${Number(r.conPar)} con par.`);

  await prisma.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
