// Tarifas de pago por área (obra, tiempo y pool), base del futuro módulo de planillas. Diseño del
// 8 oct 2026. Este script crea el esquema FINAL; alterTarifasSinMeta.ts y alterTarifasModalidad.ts
// llevaron a ese mismo esquema las tablas que ya existían en producción.
//
// Seis tablas:
//   SalarioMinimo     — el mínimo diario que fija la ley, con su vigencia (cambia cada año). La
//                       planilla completará hasta este valor, y de él sale la meta de cada talla.
//   TarifaGrupo       — cómo se paga: Modalidad OBRA (libras de la persona × tarifa por talla),
//                       TIEMPO (horas × tarifa por hora; BaseMinimo = la hora sale del mínimo) o POOL
//                       (unidades del área × tarifa, repartido según horas), y la unidad de pago.
//   TarifaGrupoClase  — OBRA: qué clases cobra cada grupo, con vigencia: si una clase cambia de grupo,
//                       los días anteriores se siguen pagando con el grupo de entonces.
//   TarifaGrupoArea   — TIEMPO y POOL: qué áreas paga cada grupo, con vigencia. Un pool por área.
//   TarifaVersion     — una versión de la hoja de UN grupo, con vigencia y aprobación. Aprobada no se
//                       edita: un cambio de precio es una versión nueva (la anterior se cierra sola).
//   Tarifas           — los precios de cada versión: talla → tarifa (Q por unidad); en TIEMPO y POOL
//                       una sola línea sin talla. La meta del día y
//                       la Lb/hr NO se guardan: salen de la tarifa (meta = salario mínimo ÷ tarifa;
//                       Lb/hr = meta ÷ horas de la jornada).
//
// Cómo se paga una pesada (día calendario del pesaje): clase → grupo vigente → versión APROBADA
// vigente del grupo → tarifa de su talla. Si falta un eslabón la pesada queda "sin tarifa", nunca Q0.
// Se paga TODA libra pesada; la libra válida es solo para estadística de Lb/hr.
//
// Rangos [VigenteDesde, VigenteHasta] con Hasta NULL = vigente, como MesaAsignacion y Permisos:
// consultar siempre por traslape. "Un solo vigente" se garantiza con columnas generadas + UNIQUE
// (MariaDB 10.5 no tiene índices parciales); los traslapes entre rangos cerrados los valida
// backend/src/lib/tarifas.ts.
//
// Carga inicial: la hoja de tarifas de pelado como BORRADOR desde 2026-10-01 (el usuario revisa la
// fecha y aprueba en Catálogos → Tarifas). Solo tallas activas: 21/25 = 217 y 31/35 = 225 (los
// códigos 316 y 326 de la otra escala están anulados y no se usan desde agosto 2026).
// Empinchado queda fuera hasta que exista su captura.
//
// Reversible: npx tsx backend/scripts/createTarifas.ts --drop
// Uso normal:  npx tsx backend/scripts/createTarifas.ts

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DESDE = "2026-10-01";
const CREADOR = "Carga inicial hoja de tarifas";

// [talla, tarifa Q/lb] — igual para T-ON y T-OFF en la hoja actual.
const HOJA: [number, number][] = [
  [311, 0.59], // 16/20
  [217, 0.81], // 21/25
  [321, 0.95], // 26/30
  [225, 0.95], // 31/35
  [336, 1.26], // 36/40
  [341, 1.26], // 41/50
  [346, 1.72], // 51/60
  [351, 1.90], // 61/70
  [356, 2.70], // 71/90
  [361, 2.70], // 91/110
  [366, 3.30], // 110/130
];

const GRUPOS: [string, string, string[], number][] = [
  ["PD_TON", "P&D T-ON", ["E40", "E90"], 1],
  ["PD_TOFF", "P&D T-OFF", ["E41", "E14", "E42", "E43", "E15"], 2],
];

async function crear() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS SalarioMinimo (
      SalarioMinimoId   INT AUTO_INCREMENT PRIMARY KEY,
      Categoria         VARCHAR(30)   NOT NULL DEFAULT 'PLANTA',
      VigenteDesde      DATE          NOT NULL,
      VigenteHasta      DATE          NULL,
      ValorDia          DECIMAL(10,2) NOT NULL,
      HorasJornada      DECIMAL(4,2)  NOT NULL DEFAULT 8,
      Acuerdo           VARCHAR(150)  NULL,
      CreadoPor         VARCHAR(100)  NOT NULL,
      CreadoEn          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      VigenteCategoria  VARCHAR(30)   AS (IF(VigenteHasta IS NULL, Categoria, NULL)) PERSISTENT,
      UNIQUE KEY uq_salmin_vigente (VigenteCategoria),
      UNIQUE KEY uq_salmin_desde (Categoria, VigenteDesde),
      CONSTRAINT chk_salmin_fechas CHECK (VigenteHasta IS NULL OR VigenteHasta >= VigenteDesde),
      CONSTRAINT chk_salmin_valor CHECK (ValorDia > 0 AND HorasJornada > 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS TarifaGrupo (
      Grupo        VARCHAR(20)  NOT NULL,
      Descripcion  VARCHAR(100) NOT NULL,
      Modalidad    VARCHAR(10)  NOT NULL DEFAULT 'OBRA',
      UnidadPago   VARCHAR(10)  NOT NULL DEFAULT 'LB',
      BaseMinimo   TINYINT(1)   NOT NULL DEFAULT 0,
      Orden        INT          NOT NULL DEFAULT 0,
      Activo       TINYINT(1)   NOT NULL DEFAULT 1,
      CreadoEn     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (Grupo),
      UNIQUE KEY uq_tgrupo_desc (Descripcion),
      CONSTRAINT chk_tgrupo_modalidad CHECK (Modalidad IN ('OBRA', 'TIEMPO', 'POOL')),
      CONSTRAINT chk_tgrupo_unidad CHECK (UnidadPago IN ('LB', 'KG', 'CAJA', 'MASTER', 'PIEZA', 'HORA'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);

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

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS TarifaGrupoClase (
      GrupoClaseId   INT AUTO_INCREMENT PRIMARY KEY,
      Clase          VARCHAR(10)  NOT NULL,
      Grupo          VARCHAR(20)  NOT NULL,
      VigenteDesde   DATE         NOT NULL,
      VigenteHasta   DATE         NULL,
      CreadoPor      VARCHAR(100) NOT NULL,
      CreadoEn       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      VigenteClase   VARCHAR(10)  AS (IF(VigenteHasta IS NULL, Clase, NULL)) PERSISTENT,
      UNIQUE KEY uq_tgc_vigente (VigenteClase),
      KEY idx_tgc_clase_fecha (Clase, VigenteDesde),
      KEY idx_tgc_grupo (Grupo),
      CONSTRAINT fk_tgc_clase FOREIGN KEY (Clase) REFERENCES Clase (Clase),
      CONSTRAINT fk_tgc_grupo FOREIGN KEY (Grupo) REFERENCES TarifaGrupo (Grupo),
      CONSTRAINT chk_tgc_fechas CHECK (VigenteHasta IS NULL OR VigenteHasta >= VigenteDesde)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS TarifaVersion (
      VersionId      INT AUTO_INCREMENT PRIMARY KEY,
      Grupo          VARCHAR(20)  NOT NULL,
      VigenteDesde   DATE         NOT NULL,
      VigenteHasta   DATE         NULL,
      Estado         VARCHAR(10)  NOT NULL DEFAULT 'BORRADOR',
      Motivo         VARCHAR(255) NULL,
      CreadoPor      VARCHAR(100) NOT NULL,
      CreadoEn       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      AprobadoPor    VARCHAR(100) NULL,
      AprobadoEn     DATETIME     NULL,
      AnuladoPor     VARCHAR(100) NULL,
      AnuladoEn      DATETIME     NULL,
      AbiertaGrupo   VARCHAR(20)  AS (IF(Estado = 'APROBADO' AND VigenteHasta IS NULL, Grupo, NULL)) PERSISTENT,
      UNIQUE KEY uq_tver_abierta (AbiertaGrupo),
      KEY idx_tver_grupo_fecha (Grupo, Estado, VigenteDesde),
      CONSTRAINT fk_tver_grupo FOREIGN KEY (Grupo) REFERENCES TarifaGrupo (Grupo),
      CONSTRAINT chk_tver_estado CHECK (Estado IN ('BORRADOR', 'APROBADO', 'ANULADO')),
      CONSTRAINT chk_tver_fechas CHECK (VigenteHasta IS NULL OR VigenteHasta >= VigenteDesde)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Tarifas (
      TarifaId   INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
      VersionId  INT           NOT NULL,
      Talla      INT           NULL,
      Tarifa     DECIMAL(10,4) NOT NULL,
      TallaClave INT           AS (IFNULL(Talla, 0)) PERSISTENT,
      UNIQUE KEY uq_tarifas_version_talla (VersionId, TallaClave),
      KEY idx_tarifas_talla (Talla),
      CONSTRAINT fk_tarifas_version FOREIGN KEY (VersionId) REFERENCES TarifaVersion (VersionId) ON DELETE CASCADE,
      CONSTRAINT fk_tarifas_talla FOREIGN KEY (Talla) REFERENCES Tallas (Codigo),
      CONSTRAINT chk_tarifas_valor CHECK (Tarifa > 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);

  // ── Carga inicial (idempotente) ──
  const sal: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM SalarioMinimo`);
  if (Number(sal[0].n) === 0) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO SalarioMinimo (Categoria, VigenteDesde, ValorDia, HorasJornada, Acuerdo, CreadoPor)
       VALUES ('PLANTA', '2026-01-01', 106.00, 8, NULL, ?)`, CREADOR);
  }

  for (const [grupo, desc, clases, orden] of GRUPOS) {
    await prisma.$executeRawUnsafe(
      `INSERT IGNORE INTO TarifaGrupo (Grupo, Descripcion, Modalidad, UnidadPago, Orden) VALUES (?, ?, 'OBRA', 'LB', ?)`,
      grupo, desc, orden);
    for (const clase of clases) {
      const ya: any[] = await prisma.$queryRawUnsafe(`SELECT 1 FROM TarifaGrupoClase WHERE Clase = ? LIMIT 1`, clase);
      if (!ya.length) await prisma.$executeRawUnsafe(
        `INSERT INTO TarifaGrupoClase (Clase, Grupo, VigenteDesde, CreadoPor) VALUES (?, ?, ?, ?)`, clase, grupo, DESDE, CREADOR);
    }
    const ver: any[] = await prisma.$queryRawUnsafe(`SELECT 1 FROM TarifaVersion WHERE Grupo = ? LIMIT 1`, grupo);
    if (!ver.length) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO TarifaVersion (Grupo, VigenteDesde, Estado, Motivo, CreadoPor) VALUES (?, ?, 'BORRADOR', ?, ?)`,
        grupo, DESDE, "Hoja de tarifas inicial", CREADOR);
      const id: any[] = await prisma.$queryRawUnsafe(`SELECT MAX(VersionId) AS id FROM TarifaVersion WHERE Grupo = ?`, grupo);
      for (const [talla, tarifa] of HOJA) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO Tarifas (VersionId, Talla, Tarifa) VALUES (?, ?, ?)`, Number(id[0].id), talla, tarifa);
      }
    }
  }

  const resumen: any[] = await prisma.$queryRawUnsafe(`
    SELECT g.Grupo, g.Descripcion, v.VersionId, v.Estado, DATE_FORMAT(v.VigenteDesde, '%Y-%m-%d') AS Desde,
           (SELECT COUNT(*) FROM Tarifas t WHERE t.VersionId = v.VersionId) AS Tallas,
           (SELECT GROUP_CONCAT(c.Clase ORDER BY c.Clase) FROM TarifaGrupoClase c WHERE c.Grupo = g.Grupo AND c.VigenteHasta IS NULL) AS Clases
    FROM TarifaGrupo g LEFT JOIN TarifaVersion v ON v.Grupo = g.Grupo ORDER BY g.Orden, v.VersionId`);
  console.log("Tablas de tarifas listas:");
  for (const r of resumen) console.log(`   ${r.Grupo.padEnd(8)} v${r.VersionId} ${r.Estado} desde ${r.Desde} · ${Number(r.Tallas)} tallas · clases ${r.Clases}`);
}

async function borrar() {
  for (const t of ["Tarifas", "TarifaVersion", "TarifaGrupoArea", "TarifaGrupoClase", "TarifaGrupo", "SalarioMinimo"]) {
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${t}`);
  }
  console.log("Tablas de tarifas eliminadas.");
}

(process.argv.includes("--drop") ? borrar() : crear())
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
