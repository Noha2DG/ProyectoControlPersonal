// Pesaje por unidades (23 nov 2026, usuario): en Empanizado lo que manda son las UNIDADES de la
// bandeja (coco 14, flat 32; puede cambiar con la talla), no el peso. Una bandeja con las unidades
// correctas puede salir bajo o sobre el rango y se registra igual: cuenta para el pago y para Túnel,
// y queda marcada. El PPV sigue como está: fuera de rango no se guarda.
//
//   UnidadesBandeja        referencia de unidades por producto que sale (Clase) y talla. Talla NULL =
//                          cualquier talla; una fila con talla manda sobre la general. Solo se muestra
//                          en la báscula: las unidades NO se anotan.
//   Pesada.Resultado       OK / BAJO / SOBRE (lo de antes queda OK: solo se guardaba dentro del rango).
//   Pesada.UnidadesRef     la referencia vigente al pesar (si mañana la cambian, lo pesado no cambia).
//   Areas.FueraDeRango     BLOQUEA (no se guarda, como hasta hoy) o GUARDA (se guarda y se marca).
//                          Queda en GUARDA el área pesadora de Empanizado (AJ); las demás en BLOQUEA.
//
// Se carga la referencia que dio el usuario para toda talla: coco (E95, E96, E98) 14 y flat (E90, E97) 32.
//
// Orden: PRIMERO este script, DESPUÉS desplegar el código (el código nuevo lee estas columnas).
// Uso: npx tsx scripts/alterPesajePorUnidades.ts          (idempotente)
//      npx tsx scripts/alterPesajePorUnidades.ts --drop   (quita todo; solo con el código viejo)
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

const REFERENCIA: [string, number][] = [["E95", 14], ["E96", 14], ["E98", 14], ["E90", 32], ["E97", 32]];
const AREAS_GUARDA = ["AJ"];

async function crear() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS UnidadesBandeja (
      UnidadesId     INT AUTO_INCREMENT PRIMARY KEY,
      Clase          VARCHAR(10)  NOT NULL,
      Talla          INT          NULL,
      Unidades       INT          NOT NULL,
      ModificadoPor  VARCHAR(100) NULL,
      ModificadoEn   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      TallaClave     INT AS (IFNULL(Talla, 0)) PERSISTENT,
      UNIQUE KEY uq_unibandeja (Clase, TallaClave),
      CONSTRAINT fk_unibandeja_clase FOREIGN KEY (Clase) REFERENCES Clase (Clase),
      CONSTRAINT chk_unibandeja_unidades CHECK (Unidades BETWEEN 1 AND 1000)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE Pesada ADD COLUMN IF NOT EXISTS Resultado VARCHAR(5) NOT NULL DEFAULT 'OK'`);
  await prisma.$executeRawUnsafe(`ALTER TABLE Pesada ADD COLUMN IF NOT EXISTS UnidadesRef INT NULL`);
  await prisma.$executeRawUnsafe(`ALTER TABLE Areas ADD COLUMN IF NOT EXISTS FueraDeRango VARCHAR(10) NOT NULL DEFAULT 'BLOQUEA'`);

  for (const a of AREAS_GUARDA) {
    await prisma.$executeRawUnsafe(`UPDATE Areas SET FueraDeRango = 'GUARDA' WHERE Codigo = ?`, a);
  }
  for (const [clase, unidades] of REFERENCIA) {
    const [c]: any[] = await prisma.$queryRawUnsafe(`SELECT Clase FROM Clase WHERE Clase = ?`, clase);
    if (!c) { console.log(`  (no existe la clase ${clase}: no se carga)`); continue; }
    await prisma.$executeRawUnsafe(
      `INSERT IGNORE INTO UnidadesBandeja (Clase, Talla, Unidades, ModificadoPor) VALUES (?, NULL, ?, 'carga inicial')`, clase, unidades);
  }

  const ref: any[] = await prisma.$queryRawUnsafe(`SELECT u.Clase, c.Descripcion, u.Talla, u.Unidades FROM UnidadesBandeja u JOIN Clase c ON c.Clase = u.Clase ORDER BY u.Clase`);
  const areas: any[] = await prisma.$queryRawUnsafe(`SELECT Codigo, Nombre, FueraDeRango FROM Areas WHERE EsPesadora = 1 ORDER BY Codigo`);
  console.log("✓ UnidadesBandeja:", ref.map(r => `${r.Clase} ${r.Unidades}${r.Talla ? ` (talla ${r.Talla})` : ""}`).join(", "));
  console.log("✓ Pesada.Resultado y Pesada.UnidadesRef");
  console.log("✓ Areas.FueraDeRango:", areas.map(a => `${a.Codigo} ${a.FueraDeRango}`).join(", "));
}

async function borrar() {
  await prisma.$executeRawUnsafe(`ALTER TABLE Areas DROP COLUMN IF EXISTS FueraDeRango`);
  await prisma.$executeRawUnsafe(`ALTER TABLE Pesada DROP COLUMN IF EXISTS UnidadesRef, DROP COLUMN IF EXISTS Resultado`);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS UnidadesBandeja`);
  console.log("Pesaje por unidades quitado de la base.");
}

(process.argv.includes("--drop") ? borrar() : crear())
  .catch(e => { console.error("ERROR:", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
