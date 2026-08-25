// Agrega a ColaEtiquetaBartender el dato que BarTender reporta al terminar de imprimir.
//
// ImpresoEn ya existía desde createColaEtiquetaBartender.ts, pero nada lo escribía: el ciclo se
// cierra hasta que el .btw manda su aviso al backend (ver herramientas/bartender/README.md).
// Impresora es la mitad útil de ese aviso — saber QUE se imprimió sin saber DÓNDE no alcanza para
// investigar un reclamo, y BarTender ya tiene el dato y lo manda gratis en el mismo POST.
//
// Aditiva y con columna NULL: el backend viejo la ignora, así que se puede correr antes de
// desplegar sin romper lo que está en producción.
//
// Reversible: npx tsx backend/scripts/alterColaBartenderImpresora.ts --drop

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TABLA = "ColaEtiquetaBartender";
const COLUMNA = "Impresora";

async function existeColumna(): Promise<boolean> {
  const filas: any[] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS n FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, TABLA, COLUMNA);
  return Number(filas[0].n) > 0;
}

async function agregar() {
  if (await existeColumna()) {
    console.log(`${TABLA}.${COLUMNA} ya existe, no hay nada que hacer.`);
  } else {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${TABLA} ADD COLUMN ${COLUMNA} VARCHAR(200) NULL AFTER ImpresoEn`);
    console.log(`${TABLA}.${COLUMNA} agregada.`);
  }
  const estado: any[] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS total, SUM(ImpresoEn IS NULL) AS pendientes, SUM(ImpresoEn IS NOT NULL) AS impresas
    FROM ${TABLA}`);
  console.log(`Cola: ${Number(estado[0].total)} fila(s) — ${Number(estado[0].pendientes ?? 0)} pendiente(s), ${Number(estado[0].impresas ?? 0)} confirmada(s) en papel.`);
}

async function eliminar() {
  if (!(await existeColumna())) { console.log(`${TABLA}.${COLUMNA} no existe.`); return; }
  await prisma.$executeRawUnsafe(`ALTER TABLE ${TABLA} DROP COLUMN ${COLUMNA}`);
  console.log(`${TABLA}.${COLUMNA} eliminada.`);
}

const main = process.argv.includes("--drop") ? eliminar : agregar;

main()
  .then(() => process.exit(0))
  .catch(e => { console.error("ERROR:", e.message); process.exit(1); });
