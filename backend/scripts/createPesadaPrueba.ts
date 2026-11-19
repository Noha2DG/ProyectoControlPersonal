// Prueba "Pesar PPV" (19 nov 2026): tabla aparte para no afectar Pesada mientras sea prueba
// (decisión del usuario). Solo control de peso, sin inventario al piso ni pago:
//   - Lote escrito a mano (no está amarrado al piso), Talla, tipo de empaque CON rango y pedido de
//     referencia (CodigoPedido: no suma al avance ni al cuadre del pedido).
//   - Una sola persona pesa todo: sin PersonaCodigo.
//   - Resultado: OK = caja dentro del rango; BAJO / SOBRE = intento fuera de rango que NO cuenta como
//     caja pero queda registrado para saber cuántas veces se pasaron del límite.
//
// Tabla nueva, vacía, idempotente (IF NOT EXISTS).
// Uso: npx tsx scripts/createPesadaPrueba.ts          — crea
//      npx tsx scripts/createPesadaPrueba.ts --drop   — borra (cuando termine la prueba)
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

async function main() {
  if (process.argv.includes("--drop")) {
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS PesadaPrueba`);
    console.log("Tabla PesadaPrueba borrada.");
    await prisma.$disconnect();
    return;
  }
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS PesadaPrueba (
      PesadaId            BIGINT        NOT NULL AUTO_INCREMENT PRIMARY KEY,
      Uuid                CHAR(36)      NOT NULL,
      SesionId            INT           NOT NULL,
      BalanzaCodigo       VARCHAR(20)   NOT NULL,
      OperadoraCodigo     VARCHAR(50)   NOT NULL,
      AreaCodigo          VARCHAR(10)   NOT NULL,
      Tipo                VARCHAR(10)   NOT NULL,
      Resultado           VARCHAR(5)    NOT NULL,
      EmpaqueCodigo       VARCHAR(20)   NOT NULL,
      Lote                VARCHAR(30)   NOT NULL,
      Talla               INT           NOT NULL,
      CodigoPedido        VARCHAR(20)   NULL,
      Carrito             VARCHAR(20)   NULL,
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
      UNIQUE KEY ux_pesadaprueba_uuid (Uuid),
      KEY ix_pesadaprueba_fecha_balanza (FechaProduccion, BalanzaCodigo),
      KEY ix_pesadaprueba_sesion (SesionId),
      CONSTRAINT fk_pesadaprueba_sesion FOREIGN KEY (SesionId) REFERENCES SesionBascula(SesionId),
      CONSTRAINT fk_pesadaprueba_empaque FOREIGN KEY (EmpaqueCodigo) REFERENCES EmpaquePesaje(Codigo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);
  // 19 nov 2026: número de carrito obligatorio en PPV (la tabla ya existía sin la columna).
  await prisma.$executeRawUnsafe(`ALTER TABLE PesadaPrueba ADD COLUMN IF NOT EXISTS Carrito VARCHAR(20) NULL AFTER CodigoPedido`);
  console.log("Tabla PesadaPrueba verificada (con Carrito).");
  await prisma.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
