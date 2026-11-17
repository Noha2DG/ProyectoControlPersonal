// Pesaje en báscula (adiós Sofia): tipos de empaque, sesiones de pesadora y pesadas.
//
// EmpaquePesaje — lo que se pesa y su rango. NO confundir con `Empaques` (el material: bolsas, cajas,
//   masters). Bruto = neto + tara del material + deshidratación (neto × %). Rango aceptado =
//   [bruto − margen−, bruto + margen+]. Bruto, deshidratación en g, mínimo y máximo se guardan ya
//   calculados por el backend para que pantalla y servidor usen exactamente los mismos números.
//
// SesionBascula — una pesadora trabajando en una báscula. La bodega y el modo NO son de la báscula
//   (se mueven por la planta): salen del área en que entró hoy (Areas.EsPesadora / ModoPesaje /
//   BodegaVirtualCodigo) o, si el área no lo dice, los eligió ella al entrar.
//
// Pesada — una caja o bandeja. Solo se guarda DENTRO del rango (decisión del usuario, 17 nov 2026):
//   bajo y sobrepeso se ven en pantalla como "SIN GUARDAR" y no llegan aquí. Uuid lo genera la
//   pantalla: si la red falla y reintenta, no se duplica. Guarda copia del rango con que se pesó:
//   cambiar el tipo de empaque después no altera lo ya pesado. Por ahora NO mueve inventario del piso
//   ni pago: eso depende de la bodega y está por analizar; aquí quedan lote, talla y persona.
//
// Tablas nuevas, vacías, idempotente (IF NOT EXISTS).
// Uso: npx tsx scripts/createPesajeBascula.ts          — crea
//      npx tsx scripts/createPesajeBascula.ts --drop   — borra (solo mientras no haya uso real)
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

async function main() {
  if (process.argv.includes("--drop")) {
    for (const t of ["Pesada", "SesionBascula", "EmpaquePesaje"]) await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${t}`);
    console.log("Tablas de pesaje borradas.");
    await prisma.$disconnect();
    return;
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS EmpaquePesaje (
      Codigo             VARCHAR(20)   NOT NULL PRIMARY KEY,
      Nombre             VARCHAR(100)  NOT NULL,
      Unidad             VARCHAR(3)    NOT NULL DEFAULT 'g',
      PesoNetoG          INT           NOT NULL,
      TaraG              INT           NOT NULL DEFAULT 0,
      DeshidratacionPct  DECIMAL(5,2)  NOT NULL DEFAULT 0,
      DeshidratacionG    INT           NOT NULL DEFAULT 0,
      PesoBrutoG         INT           NOT NULL,
      MargenPosG         INT           NOT NULL DEFAULT 0,
      MargenNegG         INT           NOT NULL DEFAULT 0,
      MinG               INT           NOT NULL,
      MaxG               INT           NOT NULL,
      Activo             TINYINT(1)    NOT NULL DEFAULT 1,
      CreadoEn           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ModificadoEn       DATETIME      NULL,
      ModificadoPor      VARCHAR(100)  NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);
  console.log("Tabla EmpaquePesaje verificada.");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS SesionBascula (
      SesionId            INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
      BalanzaCodigo       VARCHAR(20)   NOT NULL,
      OperadoraCodigo     VARCHAR(50)   NOT NULL,
      AreaCodigo          VARCHAR(10)   NOT NULL,
      BodegaVirtualCodigo VARCHAR(30)   NULL,
      Modo                VARCHAR(10)   NOT NULL,
      FechaProduccion     DATE          NOT NULL,
      Inicio              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UltimaActividad     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      Fin                 DATETIME      NULL,
      MotivoFin           VARCHAR(100)  NULL,
      Usuario             VARCHAR(100)  NULL,
      KEY ix_sesion_balanza (BalanzaCodigo, Fin),
      CONSTRAINT fk_sesion_balanza FOREIGN KEY (BalanzaCodigo) REFERENCES Balanza(Codigo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);
  console.log("Tabla SesionBascula verificada.");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Pesada (
      PesadaId            BIGINT        NOT NULL AUTO_INCREMENT PRIMARY KEY,
      Uuid                CHAR(36)      NOT NULL,
      SesionId            INT           NOT NULL,
      BalanzaCodigo       VARCHAR(20)   NOT NULL,
      OperadoraCodigo     VARCHAR(50)   NOT NULL,
      AreaCodigo          VARCHAR(10)   NOT NULL,
      BodegaVirtualCodigo VARCHAR(30)   NULL,
      Modo                VARCHAR(10)   NOT NULL,
      EmpaqueCodigo       VARCHAR(20)   NOT NULL,
      Lote                VARCHAR(30)   NOT NULL,
      Clase               VARCHAR(10)   NOT NULL,
      Talla               INT           NOT NULL,
      PersonaCodigo       VARCHAR(50)   NULL,
      PesoBrutoG          INT           NOT NULL,
      PesoNetoG           INT           NOT NULL,
      ObjetivoG           INT           NOT NULL,
      MinG                INT           NOT NULL,
      MaxG                INT           NOT NULL,
      FechaProduccion     DATE          NOT NULL,
      CreadoEn            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      Anulada             TINYINT(1)    NOT NULL DEFAULT 0,
      AnuladaPor          VARCHAR(100)  NULL,
      AnuladaEn           DATETIME      NULL,
      MotivoAnulacion     VARCHAR(200)  NULL,
      UNIQUE KEY ux_pesada_uuid (Uuid),
      KEY ix_pesada_fecha_balanza (FechaProduccion, BalanzaCodigo),
      KEY ix_pesada_sesion (SesionId),
      KEY ix_pesada_lote (Lote, Clase),
      CONSTRAINT fk_pesada_sesion FOREIGN KEY (SesionId) REFERENCES SesionBascula(SesionId),
      CONSTRAINT fk_pesada_empaque FOREIGN KEY (EmpaqueCodigo) REFERENCES EmpaquePesaje(Codigo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);
  console.log("Tabla Pesada verificada.");
  await prisma.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
