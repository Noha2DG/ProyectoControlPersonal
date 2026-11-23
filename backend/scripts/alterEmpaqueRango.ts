// Rango de los tipos de empaque desde el mínimo con deshidratación (23 nov 2026, usuario): se pesa
// crudo y al congelar pierde peso, así que el % de deshidratación es lo MÍNIMO que se pone encima del
// neto, y RangoG es cuánto se deja subir desde ahí (2000 g + 1.25 % = 2025, + 10 g → 2035).
//
// Agrega EmpaquePesaje.RangoG (gramos, 0 por omisión). NO recalcula los empaques existentes: siguen
// pesando con el MinG/MaxG que tienen hasta que alguien los abra en Básculas → Tipos de empaque y les
// ponga su rango (el formulario lo exige para guardar con rango). Las pesadas ya hechas no cambian.
//
// Orden: PRIMERO este script, DESPUÉS desplegar el código (el código nuevo lee RangoG).
// Uso: npx tsx scripts/alterEmpaqueRango.ts          — agrega la columna (idempotente)
//      npx tsx scripts/alterEmpaqueRango.ts --drop   — la quita (solo con el código viejo)
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

async function main() {
  if (process.argv.includes("--drop")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE EmpaquePesaje DROP COLUMN IF EXISTS RangoG`);
    console.log("Columna RangoG quitada.");
    return;
  }
  await prisma.$executeRawUnsafe(`ALTER TABLE EmpaquePesaje ADD COLUMN IF NOT EXISTS RangoG INT NOT NULL DEFAULT 0 AFTER DeshidratacionG`);
  const filas: any[] = await prisma.$queryRawUnsafe(`SELECT Codigo, PesoNetoG, DeshidratacionPct, RangoG, MinG, MaxG, Activo FROM EmpaquePesaje ORDER BY Codigo`);
  console.log("✓ EmpaquePesaje.RangoG lista. Empaques (sin recalcular):");
  for (const f of filas) console.log(`  ${f.Codigo}: ${f.MinG}–${f.MaxG} g (neto ${f.PesoNetoG}, ${Number(f.DeshidratacionPct)} %, rango ${f.RangoG} g)${Number(f.Activo) ? "" : " · inactivo"}`);
}

main().catch(e => { console.error("ERROR:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
