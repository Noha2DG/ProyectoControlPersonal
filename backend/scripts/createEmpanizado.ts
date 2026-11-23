// Empanizado (20 nov 2026): toma del piso como Pelado, pesaje por bandeja de cada persona en la
// báscula y su propio personal en mesas y bandas con posición fija. Todo APARTE de Pelado/Destajo:
// ni PesajeDetalle, ni Mesas/MesaAsignacion, ni Lotes/TransaccionesProduccion. Así ningún reporte ni
// pago de Pelado cambia.
//
//   MesasEmpanizado      catálogo de mesas y bandas (Tipo MESA/BANDA, cuántas posiciones tiene).
//   PosicionEmpanizado   quién está en qué posición, con historial por fechas (FechaFin NULL =
//                        vigente). La base hace cumplir: una sola posición vigente por persona y
//                        una sola persona vigente por posición (columnas generadas + UNIQUE, el mismo
//                        truco de MesaAsignacion: MariaDB 10.5 no tiene índices parciales).
//   LoteEmpanizado       el lote que el encargado tomó del piso EMPANIZADO (Lote, Clase, Talla de lo
//                        que mandó Tratamiento). Abierto mientras se pesa; al cerrarlo lo pesado pasa
//                        al piso de Túnel. Un solo lote ABIERTO por Lote+Clase+Talla: tomar otra vez
//                        lo mismo suma al abierto.
//   Pesada               + LoteEmpanizadoId, MesaCodigo, Posicion: la bandeja pesada en la báscula
//                        (Modo EMPANIZADO), con la posición que la persona tenía ese día.
//   MovimientoPiso       + LoteEmpanizadoId: la toma (Tipo TOMA_EMPANIZADO), lo bajado (BAJADO), el
//                        descarte (DESCARTE) y lo trasladado a Túnel al cerrar (PROCESADO).
//
// Solo crea tablas nuevas vacías y agrega columnas que aceptan NULL: lo existente no cambia.
// Idempotente. Uso: npx tsx scripts/createEmpanizado.ts
//                   npx tsx scripts/createEmpanizado.ts --drop   (quita todo lo de arriba; solo si
//                   todavía no hay datos que conservar)
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

async function crear() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS MesasEmpanizado (
      Codigo      VARCHAR(10)  NOT NULL,
      Nombre      VARCHAR(50)  NOT NULL,
      Tipo        VARCHAR(10)  NOT NULL,
      Posiciones  INT          NOT NULL,
      Orden       INT          NOT NULL DEFAULT 0,
      Activa      TINYINT(1)   NOT NULL DEFAULT 1,
      CreadoEn    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (Codigo),
      UNIQUE KEY uq_mesaemp_nombre (Nombre),
      CONSTRAINT chk_mesaemp_tipo CHECK (Tipo IN ('MESA', 'BANDA')),
      CONSTRAINT chk_mesaemp_pos CHECK (Posiciones BETWEEN 1 AND 200)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS PosicionEmpanizado (
      AsignacionId   INT AUTO_INCREMENT PRIMARY KEY,
      Codigo         VARCHAR(50)  NOT NULL,
      MesaCodigo     VARCHAR(10)  NOT NULL,
      Posicion       INT          NOT NULL,
      FechaInicio    DATE         NOT NULL,
      FechaFin       DATE         NULL,
      Motivo         VARCHAR(200) NULL,
      MotivoCierre   VARCHAR(200) NULL,
      RegistradoPor  VARCHAR(100) NOT NULL,
      CreadoEn       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      VigenteCodigo  VARCHAR(50)  AS (IF(FechaFin IS NULL, Codigo, NULL)) PERSISTENT,
      VigentePuesto  VARCHAR(20)  AS (IF(FechaFin IS NULL, CONCAT(MesaCodigo, '#', Posicion), NULL)) PERSISTENT,
      UNIQUE KEY uq_posemp_vigente (VigenteCodigo),
      UNIQUE KEY uq_posemp_puesto (VigentePuesto),
      KEY idx_posemp_codigo_fecha (Codigo, FechaInicio),
      KEY idx_posemp_mesa_fecha (MesaCodigo, FechaInicio),
      CONSTRAINT fk_posemp_empleado FOREIGN KEY (Codigo) REFERENCES Empleados (Codigo),
      CONSTRAINT fk_posemp_mesa FOREIGN KEY (MesaCodigo) REFERENCES MesasEmpanizado (Codigo),
      CONSTRAINT chk_posemp_fechas CHECK (FechaFin IS NULL OR FechaFin >= FechaInicio),
      CONSTRAINT chk_posemp_pos CHECK (Posicion > 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS LoteEmpanizado (
      LoteEmpanizadoId  INT AUTO_INCREMENT PRIMARY KEY,
      Lote              VARCHAR(30)  NOT NULL,
      Clase             VARCHAR(10)  NOT NULL,
      Talla             INT          NOT NULL,
      FechaLote         DATE         NULL,
      Fecha             DATE         NOT NULL,
      Estado            VARCHAR(10)  NOT NULL DEFAULT 'Abierto',
      CreadoPor         VARCHAR(100) NOT NULL,
      CreadoEn          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CerradoPor        VARCHAR(100) NULL,
      CerradoEn         DATETIME     NULL,
      AbiertoClave      VARCHAR(60)  AS (IF(Estado = 'Abierto', CONCAT(Lote, '|', Clase, '|', Talla), NULL)) PERSISTENT,
      UNIQUE KEY uq_loteemp_abierto (AbiertoClave),
      KEY idx_loteemp_estado (Estado, Fecha),
      KEY idx_loteemp_lote (Lote),
      CONSTRAINT chk_loteemp_estado CHECK (Estado IN ('Abierto', 'Cerrado'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);

  await prisma.$executeRawUnsafe(`ALTER TABLE Pesada ADD COLUMN IF NOT EXISTS LoteEmpanizadoId INT NULL`);
  await prisma.$executeRawUnsafe(`ALTER TABLE Pesada ADD COLUMN IF NOT EXISTS MesaCodigo VARCHAR(10) NULL`);
  await prisma.$executeRawUnsafe(`ALTER TABLE Pesada ADD COLUMN IF NOT EXISTS Posicion INT NULL`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_pesada_loteemp ON Pesada (LoteEmpanizadoId)`);
  await prisma.$executeRawUnsafe(`ALTER TABLE MovimientoPiso ADD COLUMN IF NOT EXISTS LoteEmpanizadoId INT NULL`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_movpiso_loteemp ON MovimientoPiso (LoteEmpanizadoId)`);

  for (const t of ["MesasEmpanizado", "PosicionEmpanizado", "LoteEmpanizado"]) {
    const [{ n }]: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM ${t}`);
    console.log(`✓ ${t} (${Number(n)} filas)`);
  }
  console.log("✓ Pesada: LoteEmpanizadoId, MesaCodigo, Posicion");
  console.log("✓ MovimientoPiso: LoteEmpanizadoId");
}

async function borrar() {
  const [{ n }]: any[] = await prisma.$queryRawUnsafe(
    `SELECT (SELECT COUNT(*) FROM Pesada WHERE LoteEmpanizadoId IS NOT NULL)
          + (SELECT COUNT(*) FROM MovimientoPiso WHERE LoteEmpanizadoId IS NOT NULL) AS n`);
  if (Number(n) > 0) throw new Error(`Hay ${Number(n)} pesadas o movimientos de Empanizado: no se borra nada`);
  await prisma.$executeRawUnsafe(`ALTER TABLE MovimientoPiso DROP INDEX IF EXISTS idx_movpiso_loteemp`);
  await prisma.$executeRawUnsafe(`ALTER TABLE MovimientoPiso DROP COLUMN IF EXISTS LoteEmpanizadoId`);
  await prisma.$executeRawUnsafe(`ALTER TABLE Pesada DROP INDEX IF EXISTS idx_pesada_loteemp`);
  await prisma.$executeRawUnsafe(`ALTER TABLE Pesada DROP COLUMN IF EXISTS LoteEmpanizadoId, DROP COLUMN IF EXISTS MesaCodigo, DROP COLUMN IF EXISTS Posicion`);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS PosicionEmpanizado`);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS MesasEmpanizado`);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS LoteEmpanizado`);
  console.log("Empanizado quitado de la base.");
}

(process.argv.includes("--drop") ? borrar() : crear())
  .catch(err => { console.error("ERROR:", err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
