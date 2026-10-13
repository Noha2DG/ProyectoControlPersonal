// Tarifas para cualquier área (8 oct 2026, decisión del usuario): no solo destajo por talla.
//
//   TarifaGrupo.Modalidad  — OBRA   : libras de cada persona × tarifa por talla (pelado, descabezado);
//                                     el grupo lo decide la CLASE (TarifaGrupoClase).
//                            TIEMPO : horas de la persona en el área × tarifa por hora.
//                            POOL   : libras del ÁREA × tarifa, repartido entre quienes trabajaron
//                                     ahí según sus horas (túnel empaque, descongelado…). Un pool
//                                     por área: Túnel empaque y Túnel pesadoras son pools distintos.
//                            TIEMPO y POOL los decide el ÁREA (TarifaGrupoArea, nueva).
//   TarifaGrupo.BaseMinimo — solo TIEMPO: la hora vale salario mínimo ÷ horas de jornada (Q106 ÷ 8);
//                            no se captura ni lleva versiones, sube sola con el mínimo de cada año.
//   TarifaGrupo.AreaCodigo — se quita: el área de OBRA la da la clase y la de TIEMPO/POOL la nueva tabla.
//   Tarifas.Talla          — opcional: TIEMPO y POOL llevan UNA línea sin talla (tarifa única).
//
// Uso: npx tsx backend/scripts/alterTarifasModalidad.ts   (idempotente)

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const hay = async (tabla: string, col: string) => (await prisma.$queryRawUnsafe<any[]>(
  `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, tabla, col)).length > 0;
const hayRestriccion = async (tabla: string, nombre: string) => (await prisma.$queryRawUnsafe<any[]>(
  `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`, tabla, nombre)).length > 0;

async function main() {
  // ── TarifaGrupo ──
  if (!(await hay("TarifaGrupo", "Modalidad"))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE TarifaGrupo
        ADD COLUMN Modalidad  VARCHAR(10) NOT NULL DEFAULT 'OBRA' AFTER Descripcion,
        ADD COLUMN BaseMinimo TINYINT(1)  NOT NULL DEFAULT 0 AFTER UnidadPago,
        ADD CONSTRAINT chk_tgrupo_modalidad CHECK (Modalidad IN ('OBRA', 'TIEMPO', 'POOL'))`);
    console.log("TarifaGrupo: Modalidad y BaseMinimo agregadas (los grupos existentes quedan OBRA).");
  }
  if (await hayRestriccion("TarifaGrupo", "chk_tgrupo_unidad")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE TarifaGrupo DROP CONSTRAINT chk_tgrupo_unidad`);
  }
  await prisma.$executeRawUnsafe(`
    ALTER TABLE TarifaGrupo ADD CONSTRAINT chk_tgrupo_unidad CHECK (UnidadPago IN ('LB', 'KG', 'CAJA', 'MASTER', 'PIEZA', 'HORA'))`);
  if (await hay("TarifaGrupo", "AreaCodigo")) {
    if (await hayRestriccion("TarifaGrupo", "fk_tgrupo_area")) {
      await prisma.$executeRawUnsafe(`ALTER TABLE TarifaGrupo DROP FOREIGN KEY fk_tgrupo_area`);
    }
    await prisma.$executeRawUnsafe(`ALTER TABLE TarifaGrupo DROP COLUMN AreaCodigo`);
    console.log("TarifaGrupo: AreaCodigo eliminada.");
  }

  // ── TarifaGrupoArea ──
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS TarifaGrupoArea (
      GrupoAreaId    INT AUTO_INCREMENT PRIMARY KEY,
      AreaCodigo     VARCHAR(10)  NOT NULL,
      Grupo          VARCHAR(20)  NOT NULL,
      VigenteDesde   DATE         NOT NULL,
      VigenteHasta   DATE         NULL,
      CreadoPor      VARCHAR(100) NOT NULL,
      CreadoEn       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      VigenteArea    VARCHAR(10)  AS (IF(VigenteHasta IS NULL, AreaCodigo, NULL)) PERSISTENT,
      UNIQUE KEY uq_tga_vigente (VigenteArea),
      KEY idx_tga_area_fecha (AreaCodigo, VigenteDesde),
      KEY idx_tga_grupo (Grupo),
      CONSTRAINT fk_tga_area FOREIGN KEY (AreaCodigo) REFERENCES Areas (Codigo),
      CONSTRAINT fk_tga_grupo FOREIGN KEY (Grupo) REFERENCES TarifaGrupo (Grupo),
      CONSTRAINT chk_tga_fechas CHECK (VigenteHasta IS NULL OR VigenteHasta >= VigenteDesde)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);

  // ── Tarifas: talla opcional ──
  // La llave (VersionId, Talla) no admite NULL: pasa a un id propio + UNIQUE sobre una columna
  // generada que trata "sin talla" como 0 (así una versión no puede tener dos líneas sin talla).
  if (!(await hay("Tarifas", "TarifaId"))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE Tarifas
        ADD COLUMN TallaClave INT AS (IFNULL(Talla, 0)) PERSISTENT,
        ADD UNIQUE KEY uq_tarifas_version_talla (VersionId, TallaClave)`);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE Tarifas
        DROP PRIMARY KEY,
        ADD COLUMN TarifaId INT NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST,
        MODIFY Talla INT NULL`);
    console.log("Tarifas: TarifaId como llave y Talla opcional.");
  }

  const grupos: any[] = await prisma.$queryRawUnsafe(`SELECT Grupo, Modalidad, UnidadPago, BaseMinimo FROM TarifaGrupo ORDER BY Orden`);
  console.log("Grupos:", grupos.map(g => `${g.Grupo} ${g.Modalidad} ${g.UnidadPago}`).join(" · "));
  const cols: any[] = await prisma.$queryRawUnsafe(
    `SELECT COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tarifas' ORDER BY ORDINAL_POSITION`);
  console.log("Tarifas:", cols.map(c => `${c.COLUMN_NAME}${c.IS_NULLABLE === "YES" ? "?" : ""}`).join(", "));
}

main().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => prisma.$disconnect());
