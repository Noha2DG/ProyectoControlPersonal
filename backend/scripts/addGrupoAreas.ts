// Areas.Grupo — agrupa las 81 áreas en 19 grupos operativos (decisión del usuario, sep 2026).
//
// El grupo contesta "¿a qué pertenece esta área?": DG, DM, DN, DP y DQ son cinco áreas distintas
// —soporte, línea, encargado, chequeadores y QC— que en un reporte se leen como una sola cosa,
// CLASIFICADO COLA. Sin esto, cualquier vista por área son 72 filas que nadie termina de mirar.
//
// Columna de texto y no catálogo aparte con FK: decisión del usuario. El precio es que "TUNEL",
// "TÚNEL" y "Tunel" serían tres grupos distintos en un GROUP BY, así que el grupo se normaliza a
// MAYÚSCULAS sin espacios extra al guardarlo (ver routes/areas.ts) y la pantalla de Áreas ofrece
// los grupos existentes en un datalist en vez de dejar el campo en blanco.
//
// OJO: el grupo vive en el ÁREA, no en el movimiento. Si mañana DY pasa de PELADO a TRABAJOS
// VARIOS, los reportes de meses pasados se recalculan con el grupo nuevo — para asistencia y
// producción es lo que se quiere, pero hay que saberlo antes de reacomodar un área.
//
//   npx tsx scripts/addGrupoAreas.ts            → muestra el plan, no escribe
//   npx tsx scripts/addGrupoAreas.ts --commit   → aplica
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const COMMIT = process.argv.includes("--commit");

// Las 72 activas salen del Excel del usuario (cruzado por Código — los nombres del Excel y de la BD
// no siempre coinciden: SP es "SOPORTE PINCHADO" en BD y "SOPORTE EMPINCHADO" en el Excel).
//
// Las 9 inactivas NO venían en el Excel y se agruparon aparte, a propósito: Transferencias tiene
// historia apuntando a ellas, y dejarlas en NULL metería todo ese pasado en un cubo "(sin grupo)".
// BW/BY/ED van con ADMINISTRACION, FM con CLASIFICADO ENTERO (donde ya está FG RECEPCION ENTERO),
// MV con MASTERIZADO, TE con GENERAL (donde ya está TC CAFETERIA), DV con BODEGA CONSERVACION y DW
// en su propio grupo PESCADO — todas confirmadas con el usuario.
//
// DT (PELADO Y PINCHADO) queda SIN GRUPO a propósito: en destajo ya se trata como área aparte de
// Pelado y de Empinchado (otra gente, otro ritmo), y ninguno de los dos grupos le calza. Está
// inactiva. Si algún día se decide, es un UPDATE de una línea.
const GRUPOS: Record<string, string[]> = {
  "ADMINISTRACION":      ["AL", "BW", "BY", "ED"],
  "BODEGA CONSERVACION": ["CB", "EL", "FF", "DV"],
  "CLASIFICADO COLA":    ["DG", "DM", "DN", "DP", "DQ"],
  "CLASIFICADO ENTERO":  ["DL", "FG", "PS", "SC", "FM"],
  "DESCABEZADO":         ["DU", "SD"],
  "DESCONGELADO":        ["DE", "DF"],
  "EMPANIZADO":          ["EP", "EQ", "SE"],
  "EMPINCHADO":          ["PA", "PB", "PC", "PD", "SP", "AH"],
  "ETIQUETADO":          ["FH", "FL"],
  "GENERAL":             ["AS", "AU", "BL", "BS", "CA", "TB", "TC", "TM", "TP", "TR", "TT", "CF", "TE"],
  "MANTENIMIENTO":       ["CL", "CS", "PH"],
  "MASTERIZADO":         ["AM", "AN", "AP", "EB", "ES", "MV"],
  "PELADO":              ["DB", "DC", "DJ", "DS", "DY"],
  "PESCADO":             ["DW"],
  "REEMPAQUE":           ["EV", "EX", "EY", "RE"],
  "REPROCESO":           ["RC", "RD"],
  "TRABAJOS VARIOS":     ["AW", "AY", "BF", "HA", "HB"],
  "TRATAMIENTO":         ["FS"],
  "TUNEL":               ["EF", "EG", "EH", "EJ", "EK", "EM", "EN"],
};

async function existeColumna(tabla: string, columna: string): Promise<boolean> {
  const rows: any[] = await p.$queryRawUnsafe(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    tabla, columna
  );
  return rows.length > 0;
}

async function main() {
  const areas: any[] = await p.$queryRawUnsafe(`SELECT Codigo, Nombre, Activa FROM Areas ORDER BY Codigo`);
  const enBD = new Map<string, any>(areas.map(a => [a.Codigo, a]));

  // El mapa se valida ANTES de tocar nada: un código mal escrito acá no falla —simplemente no
  // actualiza esa fila— y el error se descubriría semanas después, con un reporte incompleto.
  const asignado = new Map<string, string>();
  const problemas: string[] = [];
  for (const [grupo, codigos] of Object.entries(GRUPOS)) {
    for (const c of codigos) {
      if (!enBD.has(c)) problemas.push(`${c} → ${grupo}: no existe en Areas`);
      else if (asignado.has(c)) problemas.push(`${c}: asignado a ${asignado.get(c)} y también a ${grupo}`);
      else asignado.set(c, grupo);
    }
  }
  const sinGrupo = areas.filter(a => !asignado.has(a.Codigo));
  if (problemas.length) {
    console.error("El mapa de grupos tiene errores — no se aplica nada:");
    for (const x of problemas) console.error("  " + x);
    process.exit(1);
  }

  console.log(`Áreas en BD: ${areas.length} · con grupo asignado: ${asignado.size} · sin grupo: ${sinGrupo.length}`);
  for (const a of sinGrupo) console.log(`  sin grupo: ${a.Codigo} ${a.Nombre} (${Number(a.Activa) === 1 ? "ACTIVA" : "inactiva"})`);
  for (const [grupo, codigos] of Object.entries(GRUPOS)) console.log(`  ${grupo} (${codigos.length}): ${codigos.join(", ")}`);

  if (!COMMIT) {
    console.log("\nSimulación — no se escribió nada. Corre con --commit para aplicar.");
    return;
  }

  if (await existeColumna("Areas", "Grupo")) {
    // Una re-corrida NO debe pisar lo que el usuario ya haya reacomodado desde la pantalla de Áreas:
    // solo se llenan las que quedaron vacías.
    console.log("\nAreas.Grupo ya existe — solo se llenan las que están vacías (no se pisa nada ya asignado).");
  } else {
    await p.$executeRawUnsafe(`ALTER TABLE Areas ADD COLUMN Grupo VARCHAR(40) NULL AFTER Nombre`);
    console.log("\nColumna Areas.Grupo agregada.");
  }

  let n = 0;
  for (const [codigo, grupo] of asignado) {
    n += await p.$executeRawUnsafe(
      `UPDATE Areas SET Grupo = ? WHERE Codigo = ? AND (Grupo IS NULL OR Grupo = '')`, grupo, codigo
    );
  }
  console.log(`${n} área(s) agrupadas.`);

  const resumen: any[] = await p.$queryRawUnsafe(`
    SELECT COALESCE(Grupo, '(sin grupo)') AS Grupo, COUNT(*) AS n,
           SUM(CASE WHEN Activa = 1 THEN 1 ELSE 0 END) AS activas
    FROM Areas GROUP BY Grupo ORDER BY Grupo
  `);
  console.log("\nEstado final:");
  for (const r of resumen) console.log(`  ${r.Grupo}: ${Number(r.n)} (${Number(r.activas)} activas)`);
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); }).finally(() => p.$disconnect());
