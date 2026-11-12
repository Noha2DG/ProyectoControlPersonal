// Bitácora de correcciones de marcajes (12 nov 2026): quién creó a mano, corrigió o borró un registro
// de Movimientos (entrada/salida general) o de Transferencias (áreas), con lo que había antes y lo que
// quedó. Antes, al corregir la hora, el registro conservaba el nombre del kiosco y no se sabía quién lo
// cambió. Los marcajes del kiosco y del corte de medianoche no pasan por aquí: ya llevan su operador.
//
// Hay que correrlo ANTES de desplegar: sin la tabla, corregir o borrar un marcaje falla.
//
//   npx tsx scripts/createBitacoraMarcaje.ts          crea la tabla (no hace nada si ya existe)
//   npx tsx scripts/createBitacoraMarcaje.ts --drop   la quita
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

(async () => {
  if (process.argv.includes("--drop")) {
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS BitacoraMarcaje`);
    console.log("BitacoraMarcaje quitada");
  } else {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS BitacoraMarcaje (
        Id         INT AUTO_INCREMENT PRIMARY KEY,
        Tabla      VARCHAR(20)  NOT NULL,
        RegistroId INT          NOT NULL,
        Codigo     VARCHAR(50)  NOT NULL,
        Accion     VARCHAR(10)  NOT NULL,
        Antes      TEXT         NULL,
        Despues    TEXT         NULL,
        Usuario    VARCHAR(100) NOT NULL,
        Fecha      DATETIME     NOT NULL,
        KEY idx_bitacora_tabla_codigo (Tabla, Codigo, Fecha),
        KEY idx_bitacora_tabla_fecha (Tabla, Fecha)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
    console.log("BitacoraMarcaje lista");
  }
  await prisma.$disconnect();
})().catch(async e => { console.error("ERROR:", e.message); await prisma.$disconnect(); process.exit(1); });
