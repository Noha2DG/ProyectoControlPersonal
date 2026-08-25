// Códigos en la cola de BarTender, para que la plantilla pueda imprimir tanto el código como la
// descripción de cada concepto.
//
// La tabla ya guardaba solo descripciones (Cliente, Subcliente, Proceso, Talla, Presentacion, Lote).
// Sirven para leer la etiqueta, pero no para que un cliente o una aduana crucen el dato contra su
// propio catálogo — para eso hace falta el código. Ahora cada concepto viaja con los dos.
//
// Se agrega también DescripcionClase: la etiqueta mostraba "P&D T-OFF" (la descripción del proceso),
// que no es lo mismo que "CULTIVO PELADO P&D T-OFF" (la de la clase). Con las dos, el diseño elige.
//
// Igual que el resto de la cola, son valores COPIADOS, no referencias: si mañana se edita el pedido,
// la fila conserva lo que de verdad se imprimió.
//
// Aditivas y NULL: el backend viejo las ignora. Rellena las filas que ya existían.
// Reversible: npx tsx backend/scripts/alterColaBartenderCodigos.ts --drop

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TABLA = "ColaEtiquetaBartender";
const COLUMNAS: [string, string, string][] = [
  ["CodigoCliente",      "INT NULL",          "Cliente"],
  ["CodigoSubcliente",   "VARCHAR(10) NULL",  "CodigoCliente"],
  ["Clase",              "VARCHAR(10) NULL",  "CodigoSubcliente"],
  ["DescripcionClase",   "VARCHAR(150) NULL", "Clase"],
  ["CodigoProceso",      "INT NULL",          "DescripcionClase"],
  ["CodigoTalla",        "INT NULL",          "Proceso"],
  ["CodigoPresentacion", "VARCHAR(5) NULL",   "Talla"],
];

async function existe(col: string): Promise<boolean> {
  const f: any[] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS n FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, TABLA, col);
  return Number(f[0].n) > 0;
}

async function agregar() {
  for (const [col, tipo, despues] of COLUMNAS) {
    if (await existe(col)) { console.log(`  ${col} ya existe.`); continue; }
    await prisma.$executeRawUnsafe(`ALTER TABLE ${TABLA} ADD COLUMN ${col} ${tipo} AFTER ${despues}`);
    console.log(`  ${col} agregada.`);
  }

  // Relleno de las filas anteriores. Se resuelve por la misma cadena de JOINs que usa la impresión,
  // así que una fila vieja queda idéntica a como habría quedado de haberse creado hoy.
  const n = await prisma.$executeRawUnsafe(`
    UPDATE ${TABLA} c
      JOIN OrdenEtiquetado oe ON c.OrdenId = oe.OrdenId
      JOIN DetallePedido dp   ON oe.DetalleId = dp.DetalleId
      JOIN Clase cl           ON dp.Clase = cl.Clase
      JOIN Pedidos ped        ON dp.CodigoPedido = ped.CodigoPedido
       SET c.CodigoCliente      = ped.CodigoCliente,
           c.CodigoSubcliente   = ped.CodigoSubcliente,
           c.Clase              = dp.Clase,
           c.DescripcionClase   = cl.Descripcion,
           c.CodigoProceso      = cl.Proceso,
           c.CodigoTalla        = dp.Talla,
           c.CodigoPresentacion = dp.Presentacion
     WHERE c.CodigoCliente IS NULL`);
  console.log(`\nFilas rellenadas: ${Number(n)}`);

  const m: any[] = await prisma.$queryRawUnsafe(`
    SELECT Correlativo, CodigoCliente, CodigoSubcliente, Clase, CodigoProceso, Proceso,
           CodigoTalla, Talla, CodigoPresentacion, Presentacion, Lote
      FROM ${TABLA} ORDER BY EtiquetaId DESC LIMIT 3`);
  if (m.length) console.table(m);
}

async function eliminar() {
  for (const [col] of [...COLUMNAS].reverse()) {
    if (!(await existe(col))) continue;
    await prisma.$executeRawUnsafe(`ALTER TABLE ${TABLA} DROP COLUMN ${col}`);
    console.log(`  ${col} eliminada.`);
  }
}

const main = process.argv.includes("--drop") ? eliminar : agregar;
main().then(() => process.exit(0)).catch(e => { console.error("ERROR:", e.message); process.exit(1); });
