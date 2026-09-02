// LoteCorto en la cola de BarTender: el lote recortado a su segmento de fecha ("G135"), para el
// cliente que en su etiqueta no quiere el lote completo ("G135TM02-E03-9").
//
// No es un recorte arbitrario de 4 letras. El código de lote se compone así (ver
// backend/src/lib/codigoLote.ts y su espejo en frontend/src/utils/codigoLote.js):
//
//     <letraAño><díaSemanaISO><semanaISO(2)>  <piscina parte1>  [-<parte2>]  [-<ciclo>]
//         G          1            35              TM02             E03           9
//
// Los cuatro primeros caracteres son SIEMPRE el segmento de fecha —letra de año (A=2020…G=2026),
// día ISO de la semana y semana ISO a dos dígitos— y no dependen de la piscina ni del ciclo, que es
// justo lo que ese cliente no quiere ver. Los otros segmentos sí varían en largo (TM02, K020,
// EM06-E03-1), por eso se recorta por la izquierda y no por separadores.
//
// Verificado antes de escribir esto: los 263 lotes de la tabla Lotes y las 1,312 filas de la cola
// cumplen `^[A-Z][1-7][0-9][0-9]`, así que el recorte es exacto en todo el histórico.
//
// La columna se guarda COPIADA y no se calcula al vuelo, igual que el resto de la cola: si mañana
// cambia la fórmula del lote, la fila conserva lo que de verdad se imprimió. Y la plantilla .btw la
// consume como un campo más, sin scripts.
//
// Aditiva y NULL: el backend viejo la ignora. Rellena las filas que ya existían.
// Reversible: npx tsx backend/scripts/alterColaBartenderLoteCorto.ts --drop

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TABLA = "ColaEtiquetaBartender";
const COLUMNA = "LoteCorto";

async function existe(): Promise<boolean> {
  const f: any[] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS n FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, TABLA, COLUMNA);
  return Number(f[0].n) > 0;
}

async function agregar() {
  if (await existe()) {
    console.log(`  ${COLUMNA} ya existe.`);
  } else {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${TABLA} ADD COLUMN ${COLUMNA} VARCHAR(10) NULL AFTER Lote`);
    console.log(`  ${COLUMNA} agregada.`);
  }

  // Antes de rellenar, comprobar que el histórico de verdad cumple el formato. Si algún lote no lo
  // cumple, se avisa y esas filas quedan en NULL en vez de guardarles un recorte inventado.
  const raros: any[] = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT Lote FROM ${TABLA} WHERE Lote IS NOT NULL AND Lote NOT REGEXP '^[A-Z][1-7][0-9][0-9]' LIMIT 10`);
  if (raros.length) {
    console.log(`\nAVISO: ${raros.length} lote(s) no siguen el formato esperado y quedan sin LoteCorto:`);
    for (const r of raros) console.log(`  ${r.Lote}`);
  }

  const n = await prisma.$executeRawUnsafe(`
    UPDATE ${TABLA} SET ${COLUMNA} = LEFT(Lote, 4)
     WHERE ${COLUMNA} IS NULL AND Lote REGEXP '^[A-Z][1-7][0-9][0-9]'`);
  console.log(`\nFilas rellenadas: ${Number(n)}`);

  const m: any[] = await prisma.$queryRawUnsafe(`
    SELECT Lote, ${COLUMNA}, COUNT(*) AS Filas FROM ${TABLA} GROUP BY Lote, ${COLUMNA} ORDER BY Filas DESC LIMIT 5`);
  if (m.length) console.table(m.map(r => ({ ...r, Filas: Number(r.Filas) })));
}

async function eliminar() {
  if (!(await existe())) { console.log(`  ${COLUMNA} no existe.`); return; }
  await prisma.$executeRawUnsafe(`ALTER TABLE ${TABLA} DROP COLUMN ${COLUMNA}`);
  console.log(`  ${COLUMNA} eliminada.`);
}

const main = process.argv.includes("--drop") ? eliminar : agregar;
main().then(() => process.exit(0)).catch(e => { console.error("ERROR:", e.message); process.exit(1); });
