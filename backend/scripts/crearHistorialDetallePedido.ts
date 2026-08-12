// Historial de cambios de las líneas de pedido (la proforma).
//
// Por qué: la proforma se modifica constantemente — se agregan productos y se corrigen cantidades.
// Sin rastro, un despacho de 60 contra una proforma que hoy dice 50 es indefendible: nadie puede
// saber si decía 50 ese día o si la cambiaron después. Con historial, cada remisión se juzga contra
// lo que la proforma decía en ese momento.
//
// Cada fila es una FOTO COMPLETA de la línea tras el cambio, no un delta: reconstruir el estado a
// una fecha es leer la última fila anterior a esa fecha, sin tener que replicar deltas hacia atrás.
// El "de 1800 a 2400" se calcula comparando filas consecutivas.
//
// SIN llave foránea a DetallePedido a propósito: si la línea se borra, el historial DEBE sobrevivir
// — es justamente el caso donde más se necesita (producto que se despachó contra una línea que ya
// no existe). Por eso guarda también CodigoPedido, para poder consultarlo sin la línea viva.
//
// Uso: npx tsx scripts/crearHistorialDetallePedido.ts
// OJO: backend/.env apunta a PRODUCCIÓN.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const existe: any[] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS n FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'DetallePedidoHistorial'`);

  if (Number(existe[0].n) > 0) {
    console.log("DetallePedidoHistorial ya existe — no se toca.");
  } else {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE DetallePedidoHistorial (
        HistorialId      INT AUTO_INCREMENT PRIMARY KEY,
        DetalleId        INT NOT NULL,
        CodigoPedido     VARCHAR(20) NOT NULL,
        Accion           VARCHAR(10) NOT NULL,
        Clase            VARCHAR(10) NULL,
        Proceso          INT NULL,
        Talla            INT NULL,
        Presentacion     VARCHAR(5) NULL,
        EmpaqueMaster    VARCHAR(10) NULL,
        EmpaqueAccesorio VARCHAR(10) NULL,
        CantidadCajas    INT NULL,
        KgPedido         DECIMAL(10,3) NULL,
        LibrasPedido     DECIMAL(10,3) NULL,
        RegistradoPor    VARCHAR(100) NULL,
        CreadoEn         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY ix_hist_detalle (DetalleId, HistorialId),
        KEY ix_hist_pedido (CodigoPedido, CreadoEn)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log("Tabla DetallePedidoHistorial creada.");
  }

  // Línea base: sin esto, una línea que nunca se vuelva a tocar no tendría con qué compararse y
  // parecería no haber existido nunca. Se marca como 'Migración' porque no sabemos quién la capturó.
  const yaTiene: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS n FROM DetallePedidoHistorial WHERE Accion = 'Alta' AND RegistradoPor = 'Migración'`);
  if (Number(yaTiene[0].n) > 0) {
    console.log("La línea base ya se había sembrado — no se repite.");
  } else {
    const insertadas = await prisma.$executeRawUnsafe(`
      INSERT INTO DetallePedidoHistorial
        (DetalleId, CodigoPedido, Accion, Clase, Proceso, Talla, Presentacion,
         EmpaqueMaster, EmpaqueAccesorio, CantidadCajas, KgPedido, LibrasPedido, RegistradoPor)
      SELECT DetalleId, CodigoPedido, 'Alta', Clase, Proceso, Talla, Presentacion,
             EmpaqueMaster, EmpaqueAccesorio, CantidadCajas, KgPedido, LibrasPedido, 'Migración'
      FROM DetallePedido`);
    console.log(`Línea base sembrada para ${insertadas} línea(s) existente(s).`);
  }

  const total: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM DetallePedidoHistorial`);
  console.log(`Filas en el historial: ${Number(total[0].n)}`);

  await prisma.$disconnect();
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
