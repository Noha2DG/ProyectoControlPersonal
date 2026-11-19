// Tipos de empaque sin tara ni márgenes (19 nov 2026, usuario): la tara del material se hace en la
// báscula y el rango pasa a ser [neto, neto + deshidratación]. Se borran TaraG, MargenPosG y MargenNegG
// de EmpaquePesaje. Las pesadas ya guardadas NO cambian: cada una conserva su MinG/MaxG.
//
// Orden: PRIMERO desplegar el código que ya no usa esas columnas, DESPUÉS correr este script
// (con el código viejo en marcha, borrar las columnas rompería la pantalla de Tipos de empaque).
//
// 1. Respalda la tabla completa en Documents/respaldos (JSON).
// 2. Recalcula DeshidratacionG, PesoBrutoG, MinG y MaxG con la fórmula nueva. Los empaques CON rango
//    y 0 % de deshidratación NO se recalculan (quedarían en un rango de 0 g): se avisan para que les
//    pongan su % desde Básculas → Tipos de empaque; al guardarlos ya se calculan bien.
// 3. Borra las tres columnas.
//
// Uso: npx tsx scripts/alterEmpaqueSinTaraMargen.ts
import "dotenv/config";
import fs from "fs";
import os from "os";
import path from "path";
import prisma from "../src/lib/prisma.ts";
import { calcularEmpaque } from "../src/lib/empaquePesaje.ts";

async function main() {
  const cols: any[] = await prisma.$queryRawUnsafe(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'EmpaquePesaje' AND COLUMN_NAME IN ('TaraG','MargenPosG','MargenNegG')`);
  const filas: any[] = await prisma.$queryRawUnsafe(`SELECT * FROM EmpaquePesaje ORDER BY Codigo`);
  const dir = path.join(os.homedir(), "Documents", "respaldos");
  fs.mkdirSync(dir, { recursive: true });
  const archivo = path.join(dir, `EmpaquePesaje_antes_sin_tara_${Date.now()}.json`);
  fs.writeFileSync(archivo, JSON.stringify(filas, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2));
  console.log(`Respaldo: ${archivo} (${filas.length} filas)`);

  for (const f of filas) {
    const pct = Number(f.DeshidratacionPct);
    const c = calcularEmpaque({ PesoNetoG: Number(f.PesoNetoG), DeshidratacionPct: pct });
    if (Number(f.ConRango) === 1 && c.DeshidratacionG <= 0) {
      console.log(`⚠ ${f.Codigo}: con rango y 0 % de deshidratación; se deja ${f.MinG}–${f.MaxG} g. Póngale su % en Tipos de empaque.`);
      continue;
    }
    await prisma.$executeRaw`
      UPDATE EmpaquePesaje SET DeshidratacionG = ${c.DeshidratacionG}, PesoBrutoG = ${c.PesoBrutoG}, MinG = ${c.MinG}, MaxG = ${c.MaxG}
       WHERE Codigo = ${f.Codigo}`;
    console.log(`✓ ${f.Codigo}: ${f.MinG}–${f.MaxG} g → ${c.MinG}–${c.MaxG} g`);
  }

  for (const { COLUMN_NAME } of cols) {
    await prisma.$executeRawUnsafe(`ALTER TABLE EmpaquePesaje DROP COLUMN ${COLUMN_NAME}`);
    console.log(`✓ columna ${COLUMN_NAME} borrada`);
  }
  if (!cols.length) console.log("Las columnas ya no existían.");
  await prisma.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
