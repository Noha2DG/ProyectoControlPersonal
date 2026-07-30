// Migración: un permiso pasa de ser un solo día a ser un rango de fechas.
//
// Vacaciones, descanso por horas extras y permiso con goce de sueldo casi nunca duran un día: hasta
// ahora había que capturar una fila por cada día, con lo que unas vacaciones de dos semanas eran
// catorce registros que había que editar y borrar de uno en uno, y en el listado tapaban al resto.
//
// Se agrega FechaFin y Fecha pasa a ser el INICIO del rango. FechaFin queda NOT NULL, rellenada con
// la propia Fecha en lo ya capturado: un permiso de un día es el rango [Fecha, Fecha], no un caso
// aparte con NULL. Así ninguna consulta necesita COALESCE ni una rama para "los que no tienen fin",
// que es justo donde se cuelan los permisos que no aparecen en un reporte.
//
// El CHECK deja la regla en la base y no solo en el backend: los permisos también se tocan desde
// scripts y desde otra sesión, y un rango invertido (fin antes que inicio) haría que el permiso
// simplemente no apareciera en ninguna consulta por traslape, sin ningún error visible.
//
// Re-ejecutable: cada paso verifica si ya está aplicado.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function existeColumna(tabla: string, columna: string): Promise<boolean> {
  const rows: any[] = await p.$queryRawUnsafe(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    tabla, columna
  );
  return rows.length > 0;
}

async function existeCheck(tabla: string, nombre: string): Promise<boolean> {
  const rows: any[] = await p.$queryRawUnsafe(
    `SELECT 1 FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
    tabla, nombre
  );
  return rows.length > 0;
}

async function main() {
  // ---- 1. Permisos.FechaFin ---------------------------------------------------------------------
  if (await existeColumna("Permisos", "FechaFin")) {
    console.log("1/2 Permisos.FechaFin ya existe — omitido.");
  } else {
    // Se agrega NULLABLE para poder rellenarla y se cierra a NOT NULL al final: agregarla NOT NULL de
    // una vez pondría '0000-00-00' en las filas viejas, un rango inválido que ningún traslape encuentra.
    await p.$executeRawUnsafe(`ALTER TABLE Permisos ADD COLUMN FechaFin DATE NULL AFTER Fecha`);

    const backfill = await p.$executeRawUnsafe(`UPDATE Permisos SET FechaFin = Fecha WHERE FechaFin IS NULL`);
    console.log(`    ${backfill} permiso(s) existentes quedaron como rango de un solo día.`);

    await p.$executeRawUnsafe(`ALTER TABLE Permisos MODIFY COLUMN FechaFin DATE NOT NULL`);
    console.log("1/2 Columna Permisos.FechaFin agregada, rellenada y cerrada a NOT NULL.");
  }

  // ---- 2. CHECK (FechaFin >= Fecha) -------------------------------------------------------------
  if (await existeCheck("Permisos", "chk_permiso_rango")) {
    console.log("2/2 El CHECK chk_permiso_rango ya existe — omitido.");
  } else {
    const invertidos: any[] = await p.$queryRawUnsafe(`
      SELECT id, CodigoEmpleado, DATE_FORMAT(Fecha, '%Y-%m-%d') AS Fecha,
             DATE_FORMAT(FechaFin, '%Y-%m-%d') AS FechaFin
      FROM Permisos WHERE FechaFin < Fecha
    `);
    if (invertidos.length) {
      console.error(`ERROR: ${invertidos.length} permiso(s) tienen la fecha de fin antes que la de inicio.`);
      console.error("El CHECK NO se creó. Corrija estas filas a mano y reejecute:");
      console.error(JSON.stringify(invertidos, null, 2));
      await p.$disconnect();
      process.exit(1);
    }

    await p.$executeRawUnsafe(`
      ALTER TABLE Permisos ADD CONSTRAINT chk_permiso_rango CHECK (FechaFin >= Fecha)
    `);
    console.log("2/2 CHECK chk_permiso_rango creado (la fecha de fin no puede ser anterior a la de inicio).");
  }

  console.log("Migración de rango de permisos completada.");
  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
