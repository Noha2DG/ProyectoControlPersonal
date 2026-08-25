// Reserva de impresión: dos columnas que dejan que BarTender NO necesite solicitudes de consulta.
//
// EL PROBLEMA QUE RESUELVE: cada plantilla tenía que declarar cuatro solicitudes con nombres
// exactos (Orden/Desde/Hasta/Token) y recibirlas por línea de comandos. Un nombre mal escrito lo
// descarta BarTender EN SILENCIO, y configurarlo bien en cada diseño resultó tedioso y frágil.
//
// LA IDEA: la aplicación marca en la tabla qué tanda va a salir AHORA, justo antes de abrir
// BarTender. Entonces la plantilla no filtra nada — su consulta es una línea fija, igual en todos
// los diseños para siempre:
//
//     SELECT * FROM ColaEtiquetaBartender
//      WHERE SolicitadoEn IS NOT NULL AND ImpresoEn IS NULL
//      ORDER BY EtiquetaId
//
// SolicitadoEn se limpia al reservar la siguiente tanda, así que la "cola" siempre contiene
// exactamente lo que se pidió imprimir en el último clic.
//
// SUPUESTO: una tanda a la vez. Si mañana hay dos estaciones imprimiendo simultáneamente, hay que
// agregar una columna Estacion y que el manejador pase /?Estacion="$env:COMPUTERNAME" — una sola
// solicitud, con un valor que nadie teclea.
//
// Aditiva y NULL: el backend viejo la ignora, se puede correr antes de desplegar.
// Reversible: npx tsx backend/scripts/alterColaBartenderReserva.ts --drop

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TABLA = "ColaEtiquetaBartender";
const COLUMNAS: [string, string][] = [
  ["SolicitadoEn", "DATETIME NULL"],
  ["SolicitadoPor", "VARCHAR(100) NULL"],
];

async function existe(col: string): Promise<boolean> {
  const f: any[] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS n FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, TABLA, col);
  return Number(f[0].n) > 0;
}

async function agregar() {
  for (const [col, tipo] of COLUMNAS) {
    if (await existe(col)) { console.log(`${TABLA}.${col} ya existe.`); continue; }
    await prisma.$executeRawUnsafe(`ALTER TABLE ${TABLA} ADD COLUMN ${col} ${tipo}`);
    console.log(`${TABLA}.${col} agregada.`);
  }
  // Índice para la consulta que va a correr BarTender en cada impresión.
  const idx: any[] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS n FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = 'idx_cola_solicitado'`, TABLA);
  if (Number(idx[0].n) === 0) {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${TABLA} ADD KEY idx_cola_solicitado (SolicitadoEn, ImpresoEn)`);
    console.log("Índice idx_cola_solicitado agregado.");
  }
  const e: any[] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS total, SUM(SolicitadoEn IS NOT NULL AND ImpresoEn IS NULL) AS enCola FROM ${TABLA}`);
  console.log(`\nCola: ${Number(e[0].total)} fila(s), ${Number(e[0].enCola ?? 0)} reservada(s) para imprimir ahora.`);
}

async function eliminar() {
  for (const [col] of COLUMNAS) {
    if (!(await existe(col))) continue;
    await prisma.$executeRawUnsafe(`ALTER TABLE ${TABLA} DROP COLUMN ${col}`);
    console.log(`${TABLA}.${col} eliminada.`);
  }
}

const main = process.argv.includes("--drop") ? eliminar : agregar;
main().then(() => process.exit(0)).catch(e => { console.error("ERROR:", e.message); process.exit(1); });
