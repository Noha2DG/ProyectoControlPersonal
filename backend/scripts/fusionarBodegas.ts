// Funde BodegaProceso dentro de BodegaVirtual: una sola tabla de bodegas.
//
// Las dos respondían la misma pregunta con distinto catálogo. El selector de "Nuevo pallet" ya
// listaba bodegas —  decía "Área donde se está trabajando" pero mostraba Túnel, Reempaque,
// Reetiquetado—  así que el polín ya nacía eligiendo una bodega, igual que la hoja de proceso.
//
// POR QUÉ SOBREVIVE LA VIEJA Y NO LA NUEVA (decisión del usuario, 23 sep 2026):
// porque es la que tiene datos reales colgando. Los números no dejan lugar a dudas:
//
//     sobrevive BodegaProceso  →  hay que mover 634 polines, con su escaneo QR, sus posiciones
//                                 físicas y sus remisiones. Módulo en producción desde agosto.
//     sobrevive BodegaVirtual  →  hay que mover 99 filas: 42 movimientos al piso, 1 hoja y 56
//                                 áreas. Todo construido esta semana, todo datos de prueba.
//
// Se mueve lo que no duele. Y de yapa, Pallets.BodegaVirtualCodigo —  que en la otra dirección iba
// a quedar con un nombre mintiendo para siempre—  simplemente queda correcto.
//
// QUÉ APRENDE BodegaVirtual: Orden (el flujo de planta) y LlevaPiso (si acumula inventario al
// piso). Y suelta AreaCodigo, que era la forma equivocada: apuntaba a UNA área, cuando una bodega
// agrupa muchas —  Pelado/Descabezado junta siete—  y ese enlace ya vive en Areas.
//
// Letra pasa a ser NULLABLE: Descongelado o un Blast son bodegas de verdad que no arman polines.
//
// MASTERIZADO_ENTERO y MASTERIZADO_VARIOS se colapsan en MASTERIZADO con letra M. Ninguna generó
// jamás un polín (0 y 0), así que no hay nada que migrar; si la planta necesita distinguir entero
// de varios, eso ya lo dice la etiqueta de cada master, no el prefijo del polín.
//
// SE CORRE EN DOS PASOS, para no romper la planta trabajando:
//   1. sin banderas  → todo aditivo + las FK. El código viejo sigue funcionando: nada se quita.
//   2. --soltar      → BodegaProceso pasa a BodegaProceso_respaldo (RENAME, no DROP: deshacerlo es
//                      otro RENAME en vez de restaurar un respaldo con la planta parada).
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

// Las bodegas del flujo de proceso que BodegaVirtual no tenía. Se copian de BodegaProceso salvo
// las que ya existen con el mismo código (TUNEL, REEMPAQUE, REETIQUETADO), que solo aprenden
// Orden y LlevaPiso.
//
// Las tres de BodegaVirtual que BodegaProceso no tiene (BODEGA, DEVOLUCION, MIGRACION) se quedan
// como están: no son pisos de proceso sino orígenes de polín. MIGRACION sobre todo — carga 459
// polines del inventario inicial con los códigos del sistema anterior.
const RENOMBRA: Record<string, string> = {
  MASTERIZADO_ENTERO: "MASTERIZADO",
  MASTERIZADO_VARIOS: "MASTERIZADO",
};

// Las columnas que apuntan a la bodega y hay que repuntar a BodegaVirtual.
// [tabla, columna, nombre de la FK vieja, nombre de la FK nueva]
const APUNTAN: [string, string, string, string][] = [
  ["Areas",          "BodegaVirtualCodigo", "fk_areas_bodegaproceso",   "fk_areas_bodegavirtual"],
  ["MovimientoPiso", "BodegaOrigen",        "fk_movpiso_bodegaorigen",  "fk_movpiso_bodegaorigen"],
  ["MovimientoPiso", "BodegaDestino",       "fk_movpiso_bodegadestino", "fk_movpiso_bodegadestino"],
  ["HojaProceso",    "BodegaCodigo",        "fk_hojaproceso_bodega",    "fk_hojaproceso_bodega"],
];

async function existe(sql: string, ...args: any[]): Promise<boolean> {
  const [r]: any[] = await prisma.$queryRawUnsafe(sql, ...args);
  return Number(r.n) > 0;
}

const hayTabla = (t: string) =>
  existe(`SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, t);
const hayColumna = (t: string, c: string) =>
  existe(`SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, t, c);

async function soltarFK(tabla: string, nombre: string) {
  if (await existe(`SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
                     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
                   tabla, nombre)) {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${tabla} DROP FOREIGN KEY ${nombre}`);
  }
}

async function soltar() {
  if (!(await hayTabla("BodegaProceso"))) { console.log("BodegaProceso ya no está. Nada que hacer."); return; }
  // No se suelta a ciegas: si algo todavía apunta ahí, renombrarla lo dejaría colgando.
  const fks: any[] = await prisma.$queryRawUnsafe(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = 'BodegaProceso'`);
  if (fks.length) {
    console.error("ABORTA: todavía apuntan a BodegaProceso:", fks.map((f: any) => `${f.t}.${f.c}`).join(", "));
    console.error("Corra el paso 1 primero.");
    process.exit(1);
  }
  await prisma.$executeRawUnsafe(`RENAME TABLE BodegaProceso TO BodegaProceso_respaldo`);
  console.log("BodegaProceso → BodegaProceso_respaldo. Una sola tabla de bodegas.");
  console.log("Si en un mes nadie la extrañó: DROP TABLE BodegaProceso_respaldo");
}

async function main() {
  if (process.argv.includes("--soltar")) { await soltar(); await prisma.$disconnect(); return; }

  // ── 1. BodegaVirtual aprende lo que sabía la otra.
  await prisma.$executeRawUnsafe(
    `ALTER TABLE BodegaVirtual ADD COLUMN IF NOT EXISTS Orden INT NOT NULL DEFAULT 0`);
  await prisma.$executeRawUnsafe(
    `ALTER TABLE BodegaVirtual ADD COLUMN IF NOT EXISTS LlevaPiso TINYINT(1) NOT NULL DEFAULT 0`);
  // Letra deja de ser obligatoria: Descongelado y los Blast son bodegas que no arman polines.
  await prisma.$executeRawUnsafe(
    `ALTER TABLE BodegaVirtual MODIFY COLUMN Letra VARCHAR(4) NULL`);
  console.log("BodegaVirtual: Orden, LlevaPiso y Letra nullable.");

  // ── 2. Se copian las bodegas de proceso. ON DUPLICATE deja que TUNEL/REEMPAQUE/REETIQUETADO,
  //    que ya existían con el mismo código, solo aprendan Orden y LlevaPiso sin perder su letra.
  if (await hayTabla("BodegaProceso")) {
    const bps: any[] = await prisma.$queryRawUnsafe(
      `SELECT Codigo, Nombre, Orden, LlevaPiso, Activo FROM BodegaProceso ORDER BY Orden`);
    for (const b of bps) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO BodegaVirtual (Codigo, Nombre, Letra, Orden, LlevaPiso, Activo)
         VALUES (?, ?, NULL, ?, ?, ?)
         ON DUPLICATE KEY UPDATE Orden = VALUES(Orden), LlevaPiso = VALUES(LlevaPiso)`,
        b.Codigo, b.Nombre, Number(b.Orden), Number(b.LlevaPiso), Number(b.Activo));
    }
    console.log(`${bps.length} bodegas de proceso copiadas o actualizadas.`);
  }

  // Las tres que solo existían en BodegaVirtual van al final del flujo: son orígenes de polín,
  // no pisos de proceso.
  for (const [codigo, orden] of [["BODEGA", 21], ["DEVOLUCION", 22], ["MIGRACION", 23]] as [string, number][]) {
    await prisma.$executeRawUnsafe(
      `UPDATE BodegaVirtual SET Orden = ? WHERE Codigo = ? AND Orden = 0`, orden, codigo);
  }

  // ── 3. Masterizado: dos correlativos colapsan en uno con letra M.
  const movidos = Number(await prisma.$executeRawUnsafe(
    `UPDATE Pallets SET BodegaVirtualCodigo = 'MASTERIZADO'
      WHERE BodegaVirtualCodigo IN ('MASTERIZADO_ENTERO', 'MASTERIZADO_VARIOS')`));
  if (movidos) console.log(`  ${movidos} polines de Masterizado reapuntados.`);
  // El secuencial no puede retroceder: correr esto dos veces no debe regalar un código repetido.
  await prisma.$executeRawUnsafe(`
    UPDATE BodegaVirtual SET Letra = 'M', UltimoSecuencial = GREATEST(UltimoSecuencial,
      COALESCE((SELECT MAX(s) FROM (SELECT UltimoSecuencial AS s FROM BodegaVirtual
                 WHERE Codigo IN ('MASTERIZADO_ENTERO','MASTERIZADO_VARIOS')) x), 0))
     WHERE Codigo = 'MASTERIZADO'`);
  await prisma.$executeRawUnsafe(
    `DELETE FROM BodegaVirtual WHERE Codigo IN ('MASTERIZADO_ENTERO', 'MASTERIZADO_VARIOS')`);
  console.log("  Masterizado unificado con letra M.");

  // Dos bodegas con la misma letra generarían el mismo código de polín. NULL se repite libremente
  // en un UNIQUE de MariaDB, que es justo lo que necesitan las que no arman polines.
  if (!(await existe(`SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.STATISTICS
                       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'BodegaVirtual'
                         AND INDEX_NAME = 'uq_bodegavirtual_letra'`))) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE BodegaVirtual ADD UNIQUE INDEX uq_bodegavirtual_letra (Letra)`);
  }

  // ── 4. AreaCodigo se va: apuntaba a UNA área y una bodega agrupa muchas. El enlace verdadero
  //    vive en Areas, al revés.
  if (await hayColumna("BodegaVirtual", "AreaCodigo")) {
    await soltarFK("BodegaVirtual", "fk_bodegavirtual_area");
    await prisma.$executeRawUnsafe(`ALTER TABLE BodegaVirtual DROP COLUMN AreaCodigo`);
    console.log("  BodegaVirtual.AreaCodigo eliminada (cardinalidad equivocada).");
  }

  // ── 5. Areas.BodegaProcesoCodigo se llama como la tabla a la que apunta.
  if (await hayColumna("Areas", "BodegaProcesoCodigo") && !(await hayColumna("Areas", "BodegaVirtualCodigo"))) {
    await soltarFK("Areas", "fk_areas_bodegaproceso");
    await prisma.$executeRawUnsafe(
      `ALTER TABLE Areas CHANGE COLUMN BodegaProcesoCodigo BodegaVirtualCodigo VARCHAR(30) NULL`);
    console.log("  Areas.BodegaProcesoCodigo → BodegaVirtualCodigo.");
  }

  // ── 6. Las columnas que apuntan a la bodega: VARCHAR(30) para calzar con BodegaVirtual.Codigo,
  //    y la FK repuntada. Son 99 filas de datos de prueba, no 634 polines de producción.
  for (const [tabla, col, fkVieja, fkNueva] of APUNTAN) {
    if (!(await hayColumna(tabla, col))) continue;
    await soltarFK(tabla, fkVieja);
    await soltarFK(tabla, fkNueva);
    await prisma.$executeRawUnsafe(`ALTER TABLE ${tabla} MODIFY COLUMN ${col} VARCHAR(30) NULL`);
    // Nadie puede quedar apuntando a una bodega que no existe.
    const [h]: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS n FROM ${tabla} t WHERE t.${col} IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM BodegaVirtual b WHERE b.Codigo = t.${col})`);
    if (Number(h.n) > 0) {
      console.error(`ABORTA: ${h.n} filas de ${tabla}.${col} no resuelven su bodega.`);
      process.exit(1);
    }
    await prisma.$executeRawUnsafe(
      `ALTER TABLE ${tabla} ADD CONSTRAINT ${fkNueva} FOREIGN KEY (${col}) REFERENCES BodegaVirtual(Codigo)`);
    console.log(`  ${tabla}.${col} → BodegaVirtual.`);
  }

  const r: any[] = await prisma.$queryRawUnsafe(`
    SELECT b.Orden, b.Codigo, b.Nombre, b.Letra, b.UltimoSecuencial AS Seq, b.LlevaPiso, b.Activo,
           (SELECT COUNT(*) FROM Pallets p WHERE p.BodegaVirtualCodigo = b.Codigo) AS Polines,
           (SELECT COUNT(*) FROM Areas a WHERE a.BodegaVirtualCodigo = b.Codigo AND a.Activa = 1) AS Areas
      FROM BodegaVirtual b ORDER BY b.Orden, b.Codigo`);
  console.log("\n  #  Bodega                 Letra  Seq  Piso Act  Polines  Áreas");
  console.log("  " + "─".repeat(66));
  for (const x of r) {
    console.log(`  ${String(x.Orden).padStart(2)} ${String(x.Nombre).padEnd(22)} ${String(x.Letra ?? "—").padEnd(5)} ${String(x.Seq).padStart(4)}  ${x.LlevaPiso ? "sí " : "no "} ${x.Activo ? "sí " : "no "} ${String(x.Polines).padStart(7)}  ${String(x.Areas).padStart(5)}`);
  }
  console.log("\nPaso 1 listo. Despliegue el código y verifique; después corra con --soltar.");
  await prisma.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
