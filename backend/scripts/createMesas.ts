// Catálogo de mesas de pelado (destajo).
//
// Tres tipos de mesa:
//   PELADORAS    — MESA 1 a MESA 8, peladoras con más tiempo en la planta.
//   APRENDIZAJE  — APRENDIZAJE 1 a 4, personal en formación. Numeración propia (no siguen a la 8)
//                  y nombre distinto porque Nombre es UNIQUE: no puede haber dos "MESA 1".
//   BANDA        — una sola: ahí se juntan quienes se quedan sin producción en su área y se mandan
//                  a pelar para completar el día (también llegan de apoyo personas de aprendizaje).
// En cualquier mesa se trabaja todo tipo de pelado y descabezado, así que la mesa NO restringe
// familia ni clase — eso lo sigue validando el área del marcaje.
//
// Reversible: npx tsx backend/scripts/createMesas.ts --drop
// Uso normal:  npx tsx backend/scripts/createMesas.ts

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MESAS: [string, string, string, number][] = [
  ...Array.from({ length: 8 }, (_, i) => [`MESA${String(i + 1).padStart(2, "0")}`, `MESA ${i + 1}`, "PELADORAS", i + 1] as [string, string, string, number]),
  ...Array.from({ length: 4 }, (_, i) => [`APR${String(i + 1).padStart(2, "0")}`, `APRENDIZAJE ${i + 1}`, "APRENDIZAJE", i + 9] as [string, string, string, number]),
  ["BANDA", "BANDA", "BANDA", 99],
];

async function crear() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Mesas (
      Codigo    VARCHAR(10) NOT NULL,
      Nombre    VARCHAR(50) NOT NULL,
      Tipo      VARCHAR(20) NOT NULL,
      Orden     INT NOT NULL DEFAULT 0,
      Activa    TINYINT(1) NOT NULL DEFAULT 1,
      CreadoEn  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (Codigo),
      UNIQUE KEY uq_mesas_nombre (Nombre),
      CONSTRAINT chk_mesas_tipo CHECK (Tipo IN ('PELADORAS', 'APRENDIZAJE', 'BANDA'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);

  for (const [codigo, nombre, tipo, orden] of MESAS) {
    await prisma.$executeRawUnsafe(
      `INSERT IGNORE INTO Mesas (Codigo, Nombre, Tipo, Orden) VALUES (?, ?, ?, ?)`, codigo, nombre, tipo, orden);
  }

  const rows: any[] = await prisma.$queryRawUnsafe(`SELECT Codigo, Nombre, Tipo, Orden FROM Mesas ORDER BY Orden`);
  console.log(`Tabla Mesas lista (${rows.length} mesas):`);
  for (const r of rows) console.log(`   ${r.Codigo.padEnd(7)} ${r.Nombre.padEnd(8)} ${r.Tipo}`);
}

async function borrar() {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS Mesas`);
  console.log("Tabla Mesas eliminada.");
}

(process.argv.includes("--drop") ? borrar() : crear())
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
