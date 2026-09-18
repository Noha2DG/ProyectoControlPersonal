// EtiquetaImpresa.PrimerIngresoBodega — cuándo entró la caja a bodega por primera vez.
//
// El barrido de etiquetas vencidas (lib/etiquetasVencidas.ts) anulaba toda etiqueta Activa sin
// master con más de 48 h de IMPRESA. No distinguía "nunca se escaneó" de "se escaneó y después la
// bajaron del polín": "Quitar masters" borra el master, y la etiqueta quedaba igual que una que
// nunca llegó a bodega. Para una caja con más de 2 días, bajarla del polín equivalía a anularla en
// el siguiente barrido (máx. 15 min). Así se anularon 24 cajas migradas, reales y en planta, que
// después no se pudieron volver a escanear (sep 2026).
//
// Con esta columna el barrido solo anula lo que NUNCA entró. Se llena al crear el primer master
// (routes/pallets.ts) y no se vuelve a tocar.
//
// Relleno:
//   - Toda etiqueta con master hoy → la fecha de ingreso de ese master.
//   - Toda etiqueta migrada sin master → su CreadoEn: la migración solo cargó cajas que estaban en
//     bodega, así que si hoy no tiene master es porque alguien la bajó del polín después.
// Las nuestras que se bajaron de un polín antes de este cambio no se pueden recuperar: el borrado no
// dejaba rastro. Quedan en NULL y el barrido las sigue tratando como hasta ahora.
//
// Se puede correr de nuevo sin riesgo: solo llena las que siguen en NULL. Correrlo otra vez DESPUÉS
// de desplegar cubre las cajas que se escanearon entre el ALTER y el despliegue.
//
//   npx tsx scripts/addPrimerIngresoBodega.ts            → muestra el plan, no escribe
//   npx tsx scripts/addPrimerIngresoBodega.ts --commit   → aplica
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const COMMIT = process.argv.includes("--commit");

async function existeColumna(tabla: string, columna: string) {
  const r: any[] = await p.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    tabla, columna
  );
  return r.length > 0;
}

async function main() {
  const existe = await existeColumna("EtiquetaImpresa", "PrimerIngresoBodega");
  const filtroNull = existe ? "AND ei.PrimerIngresoBodega IS NULL" : "";

  const [conMaster]: any[] = await p.$queryRawUnsafe(`
    SELECT COUNT(*) AS n FROM EtiquetaImpresa ei JOIN Masters m ON m.EtiquetaId = ei.EtiquetaId WHERE 1=1 ${filtroNull}
  `);
  const [migradasSinMaster]: any[] = await p.$queryRawUnsafe(`
    SELECT COUNT(*) AS n FROM EtiquetaImpresa ei LEFT JOIN Masters m ON m.EtiquetaId = ei.EtiquetaId
    WHERE ei.RegistradoPor = 'Migración' AND m.MasterId IS NULL ${filtroNull}
  `);

  console.log(`Columna: ${existe ? "ya existe" : "se agrega"}`);
  console.log(`Se llenan con la fecha de su master: ${Number(conMaster.n)}`);
  console.log(`Migradas sin master, se llenan con su CreadoEn: ${Number(migradasSinMaster.n)}`);

  if (!COMMIT) { console.log("\nEn seco — nada escrito. Corre con --commit para aplicar."); return; }

  if (!existe) {
    await p.$executeRawUnsafe(`ALTER TABLE EtiquetaImpresa ADD COLUMN PrimerIngresoBodega DATETIME NULL`);
    console.log("\nColumna EtiquetaImpresa.PrimerIngresoBodega agregada.");
  }

  const a = await p.$executeRawUnsafe(`
    UPDATE EtiquetaImpresa ei JOIN Masters m ON m.EtiquetaId = ei.EtiquetaId
       SET ei.PrimerIngresoBodega = m.FechaIngreso
     WHERE ei.PrimerIngresoBodega IS NULL
  `);
  const b = await p.$executeRawUnsafe(`
    UPDATE EtiquetaImpresa ei LEFT JOIN Masters m ON m.EtiquetaId = ei.EtiquetaId
       SET ei.PrimerIngresoBodega = ei.CreadoEn
     WHERE ei.RegistradoPor = 'Migración' AND m.MasterId IS NULL AND ei.PrimerIngresoBodega IS NULL
  `);
  console.log(`${a} llenadas desde su master, ${b} migradas sin master.`);
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); }).finally(() => p.$disconnect());
