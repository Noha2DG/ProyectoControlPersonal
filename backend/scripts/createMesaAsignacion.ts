// Historial de qué persona estuvo en qué mesa de pelado, y desde/hasta cuándo.
//
// Una fila = una persona en una mesa durante un rango de días. FechaFin NULL = sigue ahí. Mover a
// alguien cierra su fila (FechaFin = día anterior) y abre otra; así un reporte de una semana pasada
// agrupa a cada quien en la mesa donde estaba ESA semana, no en la de hoy.
//
// Reglas que hace cumplir la propia base (no solo el backend):
//   - Una sola mesa vigente por persona  → UNIQUE sobre VigenteCodigo (columna generada que solo
//     tiene valor mientras FechaFin es NULL; los NULL no chocan entre sí en un índice UNIQUE).
//   - Una sola líder vigente por mesa    → mismo truco con LiderVigenteMesa.
//   - FechaFin nunca antes de FechaInicio.
// MariaDB 10.5 no tiene índices parciales (WHERE FechaFin IS NULL); las columnas generadas
// PERSISTENT son la forma de lograr lo mismo.
//
// Ser aprendiz no es un dato de la fila: lo define el Tipo de la mesa (APRENDIZAJE 1–4).
// Motivo es por qué se abrió la fila (carga inicial, reasignación…); MotivoCierre, por qué se cerró
// (pasa a otra mesa, baja, se quitó) — van aparte para que cerrar no borre el motivo original.
//
// Reversible: npx tsx backend/scripts/createMesaAsignacion.ts --drop
// Uso normal:  npx tsx backend/scripts/createMesaAsignacion.ts

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function crear() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS MesaAsignacion (
      AsignacionId      INT AUTO_INCREMENT PRIMARY KEY,
      Codigo            VARCHAR(50)  NOT NULL,
      MesaCodigo        VARCHAR(10)  NOT NULL,
      EsLider           TINYINT(1)   NOT NULL DEFAULT 0,
      FechaInicio       DATE         NOT NULL,
      FechaFin          DATE         NULL,
      Motivo            VARCHAR(200) NULL,
      MotivoCierre      VARCHAR(200) NULL,
      RegistradoPor     VARCHAR(100) NOT NULL,
      CreadoEn          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      VigenteCodigo     VARCHAR(50)  AS (IF(FechaFin IS NULL, Codigo, NULL)) PERSISTENT,
      LiderVigenteMesa  VARCHAR(10)  AS (IF(FechaFin IS NULL AND EsLider = 1, MesaCodigo, NULL)) PERSISTENT,
      UNIQUE KEY uq_asig_vigente (VigenteCodigo),
      UNIQUE KEY uq_asig_lider (LiderVigenteMesa),
      KEY idx_asig_codigo_fecha (Codigo, FechaInicio),
      KEY idx_asig_mesa_fecha (MesaCodigo, FechaInicio),
      CONSTRAINT fk_asig_empleado FOREIGN KEY (Codigo) REFERENCES Empleados (Codigo),
      CONSTRAINT fk_asig_mesa FOREIGN KEY (MesaCodigo) REFERENCES Mesas (Codigo),
      CONSTRAINT chk_asig_fechas CHECK (FechaFin IS NULL OR FechaFin >= FechaInicio)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);

  const cols: any[] = await prisma.$queryRawUnsafe(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'MesaAsignacion' ORDER BY ORDINAL_POSITION`);
  const fks: any[] = await prisma.$queryRawUnsafe(
    `SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'MesaAsignacion' AND REFERENCED_TABLE_NAME IS NOT NULL`);
  console.log("Tabla MesaAsignacion lista.");
  console.log(`   Columnas: ${cols.map(c => c.COLUMN_NAME).join(", ")}`);
  console.log(`   Relaciones: ${fks.map(f => `${f.CONSTRAINT_NAME} → ${f.REFERENCED_TABLE_NAME}`).join(", ")}`);
}

async function borrar() {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS MesaAsignacion`);
  console.log("Tabla MesaAsignacion eliminada.");
}

(process.argv.includes("--drop") ? borrar() : crear())
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
