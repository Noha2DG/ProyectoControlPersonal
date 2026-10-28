// Decisión 28 oct 2026: el área RECIBE, polín por polín, lo que bodega le dejó. Confirmar la
// remisión es la entrega física, pero de madrugada Cindy no está cuando Descongelado empieza (la hoja
// del 28 oct abrió a las 03:00): sin esto nadie podía activar el producto. Descongelado marca los
// polines que le llegaron y esos entran a su piso; lo demás sigue "aún en bodega" hasta que bodega
// decida (lo quita, o lo entrega al confirmar).
//
// RecibidoEn / RecibidoPor quedan en la LÍNEA (un master), no en la remisión: una remisión puede
// llegar a medias —  RS-0108 dejó el 61/70 en Descongelado y el 26/30 y el 31/35 en bodega—  y quitar
// un polín del borrador solo debe sacar del piso lo que de verdad se recibió.
//
// NULLables y al final de la tabla: el código anterior no las lee, así que se pueden agregar antes de
// desplegar sin afectarlo. Una línea está en el piso del área si su remisión está Confirmada O si se
// recibió (RecibidoEn no nulo); las confirmadas de antes no necesitan llenarse.
//
//   npx tsx scripts/alterRemisionDetalleRecibido.ts            → agrega las columnas (si faltan)
//   npx tsx scripts/alterRemisionDetalleRecibido.ts --drop     → las quita
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
  if (!(await existe("RecibidoEn"))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE RemisionDetalle ADD COLUMN RecibidoEn DATETIME NULL`);
    console.log("RemisionDetalle.RecibidoEn agregada.");
  } else console.log("RemisionDetalle.RecibidoEn ya existía.");
  if (!(await existe("RecibidoPor"))) {
    // El nombre del operador que recibió (el mismo que se guarda en AgregadoPor), no un código de
    // empleado: lo recibe quien está en la pantalla del área.
    await prisma.$executeRawUnsafe(`ALTER TABLE RemisionDetalle ADD COLUMN RecibidoPor VARCHAR(100) NULL`);
    console.log("RemisionDetalle.RecibidoPor agregada.");
  } else console.log("RemisionDetalle.RecibidoPor ya existía.");
}

async function eliminar() {
  if (await existe("RecibidoPor")) await prisma.$executeRawUnsafe(`ALTER TABLE RemisionDetalle DROP COLUMN RecibidoPor`);
  if (await existe("RecibidoEn")) await prisma.$executeRawUnsafe(`ALTER TABLE RemisionDetalle DROP COLUMN RecibidoEn`);
  console.log("Columnas RecibidoEn / RecibidoPor quitadas de RemisionDetalle.");
}

const main = process.argv.includes("--drop") ? eliminar : crear;
main()
  .then(() => prisma.$disconnect())
  .catch(async e => { console.error("ERROR:", e.message); await prisma.$disconnect(); process.exit(1); });
