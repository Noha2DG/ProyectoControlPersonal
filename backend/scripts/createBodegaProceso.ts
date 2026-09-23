// SUPERSEDIDO (23 sep 2026) por fusionarBodegas.ts: BodegaProceso se disolvió dentro de
// BodegaVirtual, que era la que tenía los 634 polines colgando. Este script queda como registro de
// lo que se corrió; NO lo vuelva a correr — recrearía la tabla que la fusión eliminó.

// BodegaProceso — las "bodegas virtuales" del flujo de planta: dónde se para el producto.
//
// POR QUÉ UNA TABLA NUEVA Y NO `BodegaVirtual`: esa apunta a UNA área (`AreaCodigo`) y sirve para
// el prefijo del código de polín (`Letra`, `UltimoSecuencial`). Acá la relación es al revés —  una
// bodega agrupa MUCHAS áreas, Pelado/Descabezado junta siete—  así que el enlace tiene que vivir en
// Areas, y las dos columnas del polín no significan nada para Descongelado o un Blast. Mezclarlas
// además metería Descongelado en el selector de destino al crear un polín.
//
// POR QUÉ NO `Areas.Grupo` A SECAS: es texto libre sin catálogo ni FK (ver el comentario en
// routes/areas.ts). Lo único que hoy evita tres grupos distintos por un typo es normalizar a
// mayúsculas, y colgar el inventario de eso es pedir que un día aparezca stock en "DESCONGELDO".
//
// DECISIONES DEL USUARIO (22 sep 2026):
//   - Pelado y Descabezado son UNA sola bodega: mismo piso y la misma gente hace los dos trabajos.
//     Lo que la hoja de papel escribe como "Pelado" o "Descabezado" no es dónde va el producto sino
//     qué se le va a hacer; el área fina ya la sabe destajo por la transferencia y la transacción.
//   - Empinchado y Empanizado van separadas: son procesos distintos.
//
// LlevaPiso distingue las bodegas que acumulan inventario al piso de las que por ahora solo
// existen como lugar. Las cinco que quedaron sin decidir (Reempaque, Reetiquetado, Empaque IQF,
// Reproceso, Etiquetado) entran en 0: existir no cuesta nada y encenderlas después es un UPDATE.
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

// Orden = el número de la lista del usuario, que es el orden del flujo. Las que no estaban en esa
// lista van después del 15.
const BODEGAS: [string, string, number, number][] = [
  ["RECEPCION",           "Recepción",            1,  1],
  ["DESCONGELADO",        "Descongelado",         2,  1],
  ["PELADO_DESCABEZADO",  "Pelado/Descabezado",   3,  1],
  ["CLASIFICADO_COLA",    "Clasificado Cola",     4,  1],
  ["CLASIFICADO_ENTERO",  "Clasificado Entero",   5,  1],
  ["MASTERIZADO",         "Masterizado",          6,  1],
  ["TRATAMIENTO",         "Tratamiento",          7,  1],
  ["BLAST1",              "Blast 1",              8,  1],
  ["BLAST2",              "Blast 2",              9,  1],
  ["BLAST3",              "Blast 3",             10,  1],
  ["BODEGA_SOBRANTES",    "Bodega Sobrantes",    11,  1],
  ["TUNEL",               "Túnel",               12,  1],
  ["BODEGA_CONSERVACION", "Bodega Conservación", 13,  1],
  ["EMPINCHADO",          "Empinchado",          14,  1],
  ["EMPANIZADO",          "Empanizado",          15,  1],
  // Sin decidir todavía si llevan inventario al piso.
  ["EMPAQUE_IQF",         "Empaque IQF",         16,  0],
  ["REEMPAQUE",           "Reempaque",           17,  0],
  ["REETIQUETADO",        "Reetiquetado",        18,  0],
  ["REPROCESO",           "Reproceso",           19,  0],
  ["ETIQUETADO",          "Etiquetado",          20,  0],
];

// De qué Grupo de Areas sale cada bodega. Se mapea por Grupo y no listando los ~60 códigos a mano
// para que agregar un área nueva a un grupo existente la enganche sola.
const POR_GRUPO: Record<string, string> = {
  "DESCONGELADO":        "DESCONGELADO",
  "PELADO":              "PELADO_DESCABEZADO",
  "DESCABEZADO":         "PELADO_DESCABEZADO",
  "CLASIFICADO COLA":    "CLASIFICADO_COLA",
  "CLASIFICADO ENTERO":  "CLASIFICADO_ENTERO",
  "MASTERIZADO":         "MASTERIZADO",
  "TRATAMIENTO":         "TRATAMIENTO",
  "TUNEL":               "TUNEL",
  "BODEGA CONSERVACION": "BODEGA_CONSERVACION",
  "EMPINCHADO":          "EMPINCHADO",
  "EMPANIZADO":          "EMPANIZADO",
  "EMPAQUE IQF":         "EMPAQUE_IQF",
  "REEMPAQUE":           "REEMPAQUE",
  "REPROCESO":           "REPROCESO",
  "ETIQUETADO":          "ETIQUETADO",
};

// Excepciones por código, que el grupo no resuelve:
//   FG (RECEPCION ENTERO) está dentro del grupo CLASIFICADO ENTERO, pero Recepción es la bodega 1 —
//     es donde descarga el camión, antes de clasificar.
//   RE (REETIQUETADO) está dentro del grupo REEMPAQUE, pero son dos bodegas distintas.
const POR_CODIGO: Record<string, string> = { FG: "RECEPCION", RE: "REETIQUETADO" };

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS BodegaProceso (
      Codigo    VARCHAR(20)  NOT NULL PRIMARY KEY,
      Nombre    VARCHAR(100) NOT NULL,
      Orden     INT          NOT NULL DEFAULT 0,
      LlevaPiso TINYINT(1)   NOT NULL DEFAULT 1,
      Activo    TINYINT(1)   NOT NULL DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla BodegaProceso creada.");

  for (const [codigo, nombre, orden, piso] of BODEGAS) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO BodegaProceso (Codigo, Nombre, Orden, LlevaPiso) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE Nombre = VALUES(Nombre), Orden = VALUES(Orden)`,
      codigo, nombre, orden, piso);
  }
  console.log(`${BODEGAS.length} bodegas sembradas.`);

  // Nullable y al final: ALGORITHM=INSTANT, no reconstruye Areas ni bloquea con la planta trabajando.
  await prisma.$executeRawUnsafe(
    `ALTER TABLE Areas ADD COLUMN IF NOT EXISTS BodegaProcesoCodigo VARCHAR(20) NULL`);
  const [fk]: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Areas' AND CONSTRAINT_NAME = 'fk_areas_bodegaproceso'`);
  if (Number(fk.n) === 0) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE Areas ADD CONSTRAINT fk_areas_bodegaproceso
         FOREIGN KEY (BodegaProcesoCodigo) REFERENCES BodegaProceso(Codigo)`);
  }
  console.log("Columna Areas.BodegaProcesoCodigo verificada.");

  // Solo se asigna lo que está en NULL: si alguien corrigió una a mano, no se le pisa.
  let asignadas = 0;
  for (const [grupo, bodega] of Object.entries(POR_GRUPO)) {
    asignadas += Number(await prisma.$executeRawUnsafe(
      `UPDATE Areas SET BodegaProcesoCodigo = ? WHERE Grupo = ? AND BodegaProcesoCodigo IS NULL`,
      bodega, grupo));
  }
  for (const [codigo, bodega] of Object.entries(POR_CODIGO)) {
    asignadas += Number(await prisma.$executeRawUnsafe(
      `UPDATE Areas SET BodegaProcesoCodigo = ? WHERE Codigo = ?`, bodega, codigo));
  }
  console.log(`${asignadas} áreas enlazadas a su bodega.`);

  const resumen: any[] = await prisma.$queryRawUnsafe(`
    SELECT b.Orden, b.Codigo, b.Nombre, b.LlevaPiso,
           COUNT(a.Codigo) AS Areas,
           GROUP_CONCAT(a.Codigo ORDER BY a.Codigo SEPARATOR ' ') AS Codigos
    FROM BodegaProceso b
    LEFT JOIN Areas a ON a.BodegaProcesoCodigo = b.Codigo AND a.Activa = 1
    GROUP BY b.Orden, b.Codigo, b.Nombre, b.LlevaPiso ORDER BY b.Orden`);
  console.log("\n  #  Bodega                 Piso  Áreas");
  console.log("  " + "─".repeat(74));
  for (const r of resumen) {
    console.log(`  ${String(r.Orden).padStart(2)} ${String(r.Nombre).padEnd(22)} ${r.LlevaPiso ? " sí " : " no "}  ${r.Areas}  ${r.Codigos ?? ""}`);
  }

  const sueltas: any[] = await prisma.$queryRawUnsafe(
    `SELECT Codigo, Nombre, Grupo FROM Areas WHERE Activa = 1 AND BodegaProcesoCodigo IS NULL ORDER BY Grupo, Codigo`);
  console.log(`\n  Áreas sin bodega (${sueltas.length}) — son las que no tocan producto:`);
  for (const s of sueltas) console.log(`    ${String(s.Codigo).padEnd(4)} ${String(s.Grupo ?? "").padEnd(18)} ${s.Nombre}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
