// Decisión 2 nov 2026 (RS-0112): bodega entrega los polines completos y Descongelado se lleva todo,
// pero según el plan del día no siempre lo usa todo. El área acepta solo la cantidad que necesita
// (21 de 40); el resto queda "por regresar" a bodega y bodega lo escanea de vuelta, con Devolver
// master, a un polín nuevo de devolución. La remisión se puede confirmar aunque falte escanearlo.
//
// PorRegresarEn / PorRegresarPor van en la LÍNEA (un master), igual que RecibidoEn: el área cuenta
// masters, no etiquetas, así que marca N cajas cualesquiera del renglón; cuando bodega escanea la que
// de verdad regresó, si no era una de las marcadas se intercambia con una del mismo renglón (mismo
// polín, lote, clase, talla y fecha), sin que el piso cambie.
//
// Una línea por regresar NO entra al piso del área aunque la remisión esté confirmada.
//
// NULLables y al final de la tabla: el código anterior no las lee, así que se pueden agregar antes de
// desplegar sin afectarlo. El código nuevo SÍ las lee: hay que correr esto ANTES de desplegarlo.
//
//   npx tsx scripts/alterRemisionDetallePorRegresar.ts            → agrega las columnas (si faltan)
//   npx tsx scripts/alterRemisionDetallePorRegresar.ts --drop     → las quita
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function existe(columna: string) {
  const r: any[] = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'RemisionDetalle' AND COLUMN_NAME = ?`,
    columna);
  return r.length > 0;
}

async function crear() {
  if (!(await existe("PorRegresarEn"))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE RemisionDetalle ADD COLUMN PorRegresarEn DATETIME NULL`);
    console.log("RemisionDetalle.PorRegresarEn agregada.");
  } else console.log("RemisionDetalle.PorRegresarEn ya existía.");
  if (!(await existe("PorRegresarPor"))) {
    // El nombre del operador del área que lo dejó por regresar, como RecibidoPor.
    await prisma.$executeRawUnsafe(`ALTER TABLE RemisionDetalle ADD COLUMN PorRegresarPor VARCHAR(100) NULL`);
    console.log("RemisionDetalle.PorRegresarPor agregada.");
  } else console.log("RemisionDetalle.PorRegresarPor ya existía.");
}

async function eliminar() {
  if (await existe("PorRegresarPor")) await prisma.$executeRawUnsafe(`ALTER TABLE RemisionDetalle DROP COLUMN PorRegresarPor`);
  if (await existe("PorRegresarEn")) await prisma.$executeRawUnsafe(`ALTER TABLE RemisionDetalle DROP COLUMN PorRegresarEn`);
  console.log("Columnas PorRegresarEn / PorRegresarPor quitadas de RemisionDetalle.");
}

const main = process.argv.includes("--drop") ? eliminar : crear;
main()
  .then(() => prisma.$disconnect())
  .catch(async e => { console.error("ERROR:", e.message); await prisma.$disconnect(); process.exit(1); });
