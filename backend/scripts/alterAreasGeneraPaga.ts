// Areas.FormaPago → Areas.GeneraPaga (8 oct 2026, decisión del usuario).
//
// FormaPago era texto libre ("Paga por Tiempo" / "Paga por Obra" / "No Genera Paga") y lo único que
// el sistema usaba de él era "No Genera Paga": baño, cafetería, permisos… — el tiempo ahí es PAUSA y
// se resta en el Lb/hr (reportes.ts, mesas.ts) y Planificación no las cuenta. Cómo se paga cada área
// (obra, tiempo, pool) vive ahora en las tablas de tarifas, con vigencia (createTarifas.ts).
//
// Dos pasos, porque el servidor de planta corre el código anterior hasta que se publique:
//   1) npx tsx backend/scripts/alterAreasGeneraPaga.ts               → agrega GeneraPaga (no rompe nada)
//   2) npx tsx backend/scripts/alterAreasGeneraPaga.ts --borrar-forma-pago   → SOLO después de publicar
//      el código nuevo: borra FormaPago (el código viejo la lee y fallaría).

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const existe = async (col: string) => (await prisma.$queryRawUnsafe<any[]>(
  `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Areas' AND COLUMN_NAME = ?`, col)).length > 0;

async function agregar() {
  if (!(await existe("GeneraPaga"))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE Areas ADD COLUMN GeneraPaga TINYINT(1) NOT NULL DEFAULT 1 AFTER Grupo`);
    console.log("Columna GeneraPaga agregada.");
  }
  if (await existe("FormaPago")) {
    const n = await prisma.$executeRawUnsafe(`UPDATE Areas SET GeneraPaga = 0 WHERE FormaPago = 'No Genera Paga' AND GeneraPaga = 1`);
    console.log(`${n} áreas marcadas como "no genera paga" desde FormaPago.`);
  }
  const sin: any[] = await prisma.$queryRawUnsafe(`SELECT Codigo, Nombre FROM Areas WHERE GeneraPaga = 0 ORDER BY Nombre`);
  console.log(`No generan paga (${sin.length}): ${sin.map(a => `${a.Codigo} ${a.Nombre}`).join(", ")}`);
}

async function borrarFormaPago() {
  if (!(await existe("GeneraPaga"))) throw new Error("Primero corre el paso 1 (sin opciones)");
  if (!(await existe("FormaPago"))) { console.log("FormaPago ya no existe."); return; }
  // Si alguien marcó "No Genera Paga" después del paso 1, que no se pierda.
  await prisma.$executeRawUnsafe(`UPDATE Areas SET GeneraPaga = 0 WHERE FormaPago = 'No Genera Paga'`);
  await prisma.$executeRawUnsafe(`ALTER TABLE Areas DROP COLUMN FormaPago`);
  console.log("Columna FormaPago eliminada.");
}

(process.argv.includes("--borrar-forma-pago") ? borrarFormaPago() : agregar())
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
