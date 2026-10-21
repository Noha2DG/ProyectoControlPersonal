// El almacén de origen/destino de una transacción de destajo deja de pedirse (21 oct 2026).
//
// Era el catálogo Almacenes (BCONS "Bodega de Conservación" / PISO): nadie lo lee —  ningún reporte,
// cálculo, vista ni procedimiento—, solo se guardaba, y el formulario ponía BCONS por omisión. Con el
// inventario al piso, de dónde viene y a dónde va el producto ya lo dice MovimientoPiso.
//
// Se quita del formulario de "Nueva Transacción", y para eso estas columnas pasan a aceptar vacío:
//   TransaccionesProduccion.AlmacenOrigen, TransaccionesProduccion.AlmacenDestino
//   Termos.AlmacenActual (el termo copiaba el almacén de origen de su transacción)
// Las FK a Almacenes se quedan: el historial conserva su valor y el código anterior sigue mandándolo.
//
//   npx tsx scripts/alterAlmacenesOpcionales.ts             → ensayo, no escribe
//   npx tsx scripts/alterAlmacenesOpcionales.ts --aplicar   → las vuelve opcionales
//   npx tsx scripts/alterAlmacenesOpcionales.ts --deshacer  → obligatorias otra vez (si no hay vacíos)
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

const COLUMNAS: [string, string][] = [
  ["TransaccionesProduccion", "AlmacenOrigen"],
  ["TransaccionesProduccion", "AlmacenDestino"],
  ["Termos", "AlmacenActual"],
];
const aplicar = process.argv.includes("--aplicar");
const deshacer = process.argv.includes("--deshacer");

async function definicion(tabla: string, columna: string) {
  const [c]: any[] = await prisma.$queryRawUnsafe(`
    SELECT COLUMN_TYPE AS tipo, IS_NULLABLE AS nulo, COLLATION_NAME AS coll FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, tabla, columna);
  if (!c) throw new Error(`No existe ${tabla}.${columna}`);
  return { tipo: String(c.tipo), nulo: String(c.nulo) === "YES", coll: c.coll ? String(c.coll) : null };
}

async function main() {
  for (const [t, c] of COLUMNAS) {
    const d = await definicion(t, c);
    console.log(`${t}.${c}: ${d.tipo} ${d.nulo ? "NULL" : "NOT NULL"}`);
  }
  if (!aplicar && !deshacer) { console.log("Ensayo: no se escribió nada. Corre con --aplicar para hacerlo."); return; }

  for (const [t, c] of COLUMNAS) {
    const d = await definicion(t, c);
    const coll = d.coll ? ` COLLATE ${d.coll}` : "";
    if (aplicar && !d.nulo) {
      await prisma.$executeRawUnsafe(`ALTER TABLE ${t} MODIFY ${c} ${d.tipo}${coll} NULL`);
      console.log(`${t}.${c} → NULL`);
    }
    if (deshacer && d.nulo) {
      const [v]: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM ${t} WHERE ${c} IS NULL`);
      if (Number(v.n) > 0) throw new Error(`${t}.${c} ya tiene ${v.n} filas vacías: no se puede volver a obligatoria`);
      await prisma.$executeRawUnsafe(`ALTER TABLE ${t} MODIFY ${c} ${d.tipo}${coll} NOT NULL`);
      console.log(`${t}.${c} → NOT NULL`);
    }
  }
  console.log("Listo.");
}

main()
  .catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
