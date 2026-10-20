// La remisión de traslado interno documenta a qué BODEGA se carga el producto, no a qué área.
//
// Hasta oct 2026 se elegía un área (Areas, la tabla de marcaje) y el ingreso al piso la traducía a su
// bodega al confirmar. Eso mezclaba dos cosas: dónde trabaja la gente y dónde queda el producto. En
// "Pelado" había cinco opciones —  Encargado, QC, Chequeadores, Pelado y devenado, Soporte—  que
// hacían exactamente lo mismo, y el documento impreso decía "QC PELADO/DESCABEZADO" como destino.
//
// Ahora: Remisiones.BodegaDestino (FK a BodegaVirtual) es el destino; AreaDestino queda como
// historial y ya no se llena. Quién recibe sigue siendo RecibidoPor (un empleado).
//
// Solo pueden recibir las bodegas con LlevaPiso = 1: si una remisión carga producto a una bodega,
// ese producto tiene que aparecer en su piso, o se pierde el rastro entre bodega y proceso. Por eso
// las cuatro bodegas de proceso que no llevaban piso (Empaque IQF, Reempaque, Reetiquetado,
// Reproceso) pasan a llevarlo: ya recibían remisiones (37 hasta hoy) que no entraban a ningún piso.
// Etiquetado se deja como está: nunca ha recibido una remisión.
//
// Las remisiones viejas se llenan desde su área. Cada área tiene una sola bodega, así que no hay
// ambigüedad; las de áreas sin bodega quedan en NULL y se listan.
//
//   npx tsx scripts/alterRemisionBodegaDestino.ts             → ensayo, no escribe
//   npx tsx scripts/alterRemisionBodegaDestino.ts --aplicar   → lo hace (se puede volver a correr)
//   npx tsx scripts/alterRemisionBodegaDestino.ts --deshacer  → quita la columna y devuelve LlevaPiso
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

const A_LLEVAR_PISO = ["EMPAQUE_IQF", "REEMPAQUE", "REETIQUETADO", "REPROCESO"];
const aplicar = process.argv.includes("--aplicar");
const deshacer = process.argv.includes("--deshacer");

const j = (x: any) => JSON.stringify(x, (_k, v) => typeof v === "bigint" ? Number(v) : v);

async function hayColumna() {
  const [r]: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Remisiones' AND COLUMN_NAME = 'BodegaDestino'`);
  return Number(r.n) > 0;
}

async function hayFK() {
  const [r]: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Remisiones' AND CONSTRAINT_NAME = 'fk_remision_bodegadestino'`);
  return Number(r.n) > 0;
}

// Cómo quedaría cada remisión con área: bodega a la que se carga y si esa bodega lleva piso.
const SQL_MAPEO = `
  SELECT a.BodegaVirtualCodigo AS Bodega, COUNT(*) AS Remisiones
    FROM Remisiones r JOIN Areas a ON a.Codigo = r.AreaDestino
   WHERE r.AreaDestino IS NOT NULL
   GROUP BY a.BodegaVirtualCodigo ORDER BY Remisiones DESC`;

async function main() {
  if (deshacer) {
    if (await hayFK()) await prisma.$executeRawUnsafe(`ALTER TABLE Remisiones DROP FOREIGN KEY fk_remision_bodegadestino`);
    if (await hayColumna()) await prisma.$executeRawUnsafe(`ALTER TABLE Remisiones DROP COLUMN BodegaDestino`);
    for (const b of A_LLEVAR_PISO) {
      await prisma.$executeRawUnsafe(`UPDATE BodegaVirtual SET LlevaPiso = 0 WHERE Codigo = ?`, b);
    }
    console.log("Deshecho: sin BodegaDestino y las cuatro bodegas sin piso otra vez.");
    console.log("Ojo: si ya entraron movimientos al piso de esas bodegas, siguen en MovimientoPiso.");
    return;
  }

  console.log("Remisiones con área, por la bodega que les tocaría:");
  for (const r of await prisma.$queryRawUnsafe<any[]>(SQL_MAPEO)) console.log("  ", j(r));
  console.log("Bodegas que pasan a llevar piso:", j(await prisma.$queryRawUnsafe(
    `SELECT Codigo, LlevaPiso FROM BodegaVirtual WHERE Codigo IN (${A_LLEVAR_PISO.map(() => "?").join(",")})`,
    ...A_LLEVAR_PISO)));

  if (!aplicar) { console.log("\nEnsayo: no se escribió nada. Corre con --aplicar para hacerlo."); return; }

  // Columna nullable: el código viejo que corre en el servidor ni la ve, así que esto puede ir
  // antes que el despliegue.
  if (!(await hayColumna())) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE Remisiones ADD COLUMN BodegaDestino VARCHAR(30) NULL AFTER AreaDestino`);
    console.log("Columna Remisiones.BodegaDestino agregada.");
  }
  if (!(await hayFK())) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE Remisiones ADD CONSTRAINT fk_remision_bodegadestino
         FOREIGN KEY (BodegaDestino) REFERENCES BodegaVirtual(Codigo)`);
    console.log("FK fk_remision_bodegadestino creada.");
  }

  // Solo las que aún no tienen bodega: correrlo otra vez después del despliegue completa las que el
  // código viejo haya creado entre medio, sin tocar las demás.
  const n = await prisma.$executeRawUnsafe(`
    UPDATE Remisiones r JOIN Areas a ON a.Codigo = r.AreaDestino
       SET r.BodegaDestino = a.BodegaVirtualCodigo
     WHERE r.AreaDestino IS NOT NULL AND r.BodegaDestino IS NULL AND a.BodegaVirtualCodigo IS NOT NULL`);
  console.log(`Remisiones llenadas desde su área: ${n}`);

  for (const b of A_LLEVAR_PISO) {
    await prisma.$executeRawUnsafe(`UPDATE BodegaVirtual SET LlevaPiso = 1 WHERE Codigo = ?`, b);
  }
  console.log(`LlevaPiso = 1 en ${A_LLEVAR_PISO.join(", ")}`);

  const sueltas: any[] = await prisma.$queryRawUnsafe(
    `SELECT Folio, AreaDestino FROM Remisiones WHERE AreaDestino IS NOT NULL AND BodegaDestino IS NULL`);
  if (sueltas.length) console.log("Sin bodega (su área no tiene bodega):", j(sueltas));
}

main()
  .catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
