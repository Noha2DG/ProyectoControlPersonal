// Áreas → básculas (17 nov 2026, decisión del usuario): las básculas se mueven por toda la planta, así
// que la bodega y el modo de pesaje NO son de la báscula sino del trabajo. Al pasar su carnet en una
// báscula, la pesadora trae el área donde entró hoy (kiosco de áreas) y de ahí salen:
//   - la bodega (Areas.BodegaVirtualCodigo, ya existía) → de qué piso se toman los lotes;
//   - EsPesadora → quién puede iniciar sesión en una báscula;
//   - ModoPesaje → PERSONA (carnet por caja) o PRODUCTO; NULL = la pesadora lo elige al entrar.
//
// Columnas nuevas al final con default: ALGORITHM=INSTANT, no bloquea Areas con la planta trabajando.
// Marca como pesadoras solo las tres áreas que hoy se llaman así (PS, AJ, AF), y solo si nadie las
// tocó antes; el modo queda en NULL hasta que el usuario lo defina en Catálogos → Áreas.
// Uso: npx tsx scripts/alterAreasPesaje.ts
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

const PESADORAS = ["PS", "AJ", "AF"];

async function main() {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE Areas ADD COLUMN IF NOT EXISTS EsPesadora TINYINT(1) NOT NULL DEFAULT 0`);
  await prisma.$executeRawUnsafe(
    `ALTER TABLE Areas ADD COLUMN IF NOT EXISTS ModoPesaje VARCHAR(10) NULL`);
  console.log("Columnas Areas.EsPesadora y Areas.ModoPesaje verificadas.");

  const n = await prisma.$executeRawUnsafe(
    `UPDATE Areas SET EsPesadora = 1 WHERE Codigo IN (${PESADORAS.map(() => "?").join(",")}) AND EsPesadora = 0`,
    ...PESADORAS);
  console.log(`${n} áreas marcadas como pesadoras.`);

  const filas: any[] = await prisma.$queryRawUnsafe(
    `SELECT a.Codigo, a.Nombre, a.BodegaVirtualCodigo, a.ModoPesaje FROM Areas a WHERE a.EsPesadora = 1 ORDER BY a.Codigo`);
  for (const f of filas) console.log(`  ${f.Codigo}  ${f.Nombre}  bodega=${f.BodegaVirtualCodigo ?? "—"}  modo=${f.ModoPesaje ?? "lo elige la pesadora"}`);
  await prisma.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
