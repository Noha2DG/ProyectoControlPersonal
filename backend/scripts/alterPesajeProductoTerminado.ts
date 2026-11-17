// Pesaje de producto terminado (17 nov 2026, decisiones del usuario tras la prueba en BAL-01):
//   - La vista "por persona" es el peso de PRODUCTO TERMINADO: se conserva el lote del piso, pero el
//     producto cambia (BF T-ON → Empanizado coco, flat…) y gana peso con las harinas → ClaseSalida.
//   - Destino: EXPORTACION (con un pedido en Proceso de cliente de exportación) o LOCAL (venta local,
//     sin pedido) → Destino, CodigoPedido.
//   - Número de carrito obligatorio donde el área lo pida (Empanizado sí, Empaque no), igual que el
//     termo en Pelado → Areas.PideCarrito, SesionBascula.PideCarrito, Pesada.Carrito.
//   - Peso libre salvo que el tipo de empaque tenga rango → EmpaquePesaje.ConRango; en producto
//     terminado el empaque es opcional → Pesada.EmpaqueCodigo, MinG, MaxG, ObjetivoG aceptan NULL.
//
// Columnas nuevas al final con default o NULL; los MODIFY tocan tablas nuevas y casi vacías.
// Idempotente. Uso: npx tsx scripts/alterPesajeProductoTerminado.ts
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

const PASOS: [string, string][] = [
  ["Areas.PideCarrito", `ALTER TABLE Areas ADD COLUMN IF NOT EXISTS PideCarrito TINYINT(1) NOT NULL DEFAULT 0`],
  ["EmpaquePesaje.ConRango", `ALTER TABLE EmpaquePesaje ADD COLUMN IF NOT EXISTS ConRango TINYINT(1) NOT NULL DEFAULT 1`],
  ["SesionBascula.PideCarrito", `ALTER TABLE SesionBascula ADD COLUMN IF NOT EXISTS PideCarrito TINYINT(1) NOT NULL DEFAULT 0`],
  ["Pesada.ClaseSalida", `ALTER TABLE Pesada ADD COLUMN IF NOT EXISTS ClaseSalida VARCHAR(10) NULL`],
  ["Pesada.Destino", `ALTER TABLE Pesada ADD COLUMN IF NOT EXISTS Destino VARCHAR(12) NULL`],
  ["Pesada.CodigoPedido", `ALTER TABLE Pesada ADD COLUMN IF NOT EXISTS CodigoPedido VARCHAR(20) NULL`],
  ["Pesada.Carrito", `ALTER TABLE Pesada ADD COLUMN IF NOT EXISTS Carrito VARCHAR(20) NULL`],
  ["Pesada.EmpaqueCodigo NULL", `ALTER TABLE Pesada MODIFY EmpaqueCodigo VARCHAR(20) NULL`],
  ["Pesada.ObjetivoG NULL", `ALTER TABLE Pesada MODIFY ObjetivoG INT NULL`],
  ["Pesada.MinG NULL", `ALTER TABLE Pesada MODIFY MinG INT NULL`],
  ["Pesada.MaxG NULL", `ALTER TABLE Pesada MODIFY MaxG INT NULL`],
];

async function main() {
  for (const [nombre, sql] of PASOS) {
    await prisma.$executeRawUnsafe(sql);
    console.log("✓", nombre);
  }
  // Empanizado pide carrito (usuario). Solo si nadie lo tocó.
  const n = await prisma.$executeRawUnsafe(`UPDATE Areas SET PideCarrito = 1 WHERE Codigo = 'AJ' AND PideCarrito = 0`);
  console.log(`${n} área(s) marcadas con carrito (AJ · Pesadora Empanizado).`);
  await prisma.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
