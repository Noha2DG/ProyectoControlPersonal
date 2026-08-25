// Retira de la base todo lo que sostenía la etiqueta 3x1 impresa por Zebra/Browser Print, ahora que
// la impresión física la hace BarTender leyendo ColaEtiquetaBartender.
//
// Qué se va y por qué:
//   - DisenoEtiqueta          : guardaba X/Y/Visible de los 11 campos del ZPL. El layout ahora vive
//                               dentro del .btw, no en la base.
//   - VistaEtiquetaBartender  : la reemplazó ColaEtiquetaBartender (una vista sobre diez tablas
//                               unidas no es actualizable, y sin UPDATE no hay confirmación).
//   - EtiquetaImpresa.Tamano  : el tamaño lo define el .btw. Además la columna es NOT NULL y el
//                               INSERT ya no la manda, así que dejarla rompería la creación de
//                               correlativos.
//
// NO se toca EtiquetaImpresa ni el correlativo: son la llave de bodega física, pallets y remisiones.
//
// Este script NO es reversible (borra objetos). Antes de correrlo conviene tener commiteado el
// código, que es de donde salen las definiciones si hubiera que rehacer algo.

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // --- Diagnóstico antes de tocar nada ---
  const col: any[] = await prisma.$queryRawUnsafe(`SHOW COLUMNS FROM EtiquetaImpresa LIKE 'Tamano'`);
  if (col.length) {
    console.log(`EtiquetaImpresa.Tamano -> tipo ${col[0].Type}, Null=${col[0].Null}, Default=${col[0].Default ?? "(ninguno)"}`);
    const usos: any[] = await prisma.$queryRawUnsafe(
      `SELECT Tamano, COUNT(*) AS n FROM EtiquetaImpresa GROUP BY Tamano`);
    console.table(usos.map((u: any) => ({ Tamano: u.Tamano, Etiquetas: Number(u.n) })));
  } else {
    console.log("EtiquetaImpresa.Tamano ya no existe.");
  }

  // --- Borrado ---
  await prisma.$executeRawUnsafe(`DROP VIEW IF EXISTS VistaEtiquetaBartender`);
  console.log("\nVista VistaEtiquetaBartender eliminada.");

  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS DisenoEtiqueta`);
  console.log("Tabla DisenoEtiqueta eliminada.");

  if (col.length) {
    await prisma.$executeRawUnsafe(`ALTER TABLE EtiquetaImpresa DROP COLUMN Tamano`);
    console.log("Columna EtiquetaImpresa.Tamano eliminada.");
  }

  // --- Verificación: que la creación de correlativos siga funcionando sin Tamano ---
  const restantes: any[] = await prisma.$queryRawUnsafe(`SHOW COLUMNS FROM EtiquetaImpresa`);
  console.log("\nColumnas que quedan en EtiquetaImpresa:");
  console.table(restantes.map((c: any) => ({ Campo: c.Field, Tipo: c.Type, Nulo: c.Null })));

  const cola: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS total, SUM(ImpresoEn IS NULL) AS pendientes FROM ColaEtiquetaBartender`);
  console.log(`Cola de BarTender: ${cola[0].total} fila(s), ${cola[0].pendientes} pendiente(s) de imprimir.`);
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error("ERROR:", e.message); process.exit(1); });
