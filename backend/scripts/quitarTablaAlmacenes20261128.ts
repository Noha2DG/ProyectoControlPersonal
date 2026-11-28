import "dotenv/config";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import prisma from "../src/lib/prisma.ts";

// Quita lo último de almacenes (28 nov 2026): Lotes.AlmacenCodigo (con su llave) y la tabla Almacenes.
// Antes se quitaron TransaccionesProduccion.AlmacenOrigen/Destino y Termos.AlmacenActual
// (quitarAlmacenesDestajo20261128.ts). La bodega única es BodegaVirtual.
//
//   npx tsx scripts/quitarTablaAlmacenes20261128.ts             → solo muestra qué haría
//   npx tsx scripts/quitarTablaAlmacenes20261128.ts --aplicar   → respalda y quita
//   npx tsx scripts/quitarTablaAlmacenes20261128.ts --revertir  → recrea la tabla, la columna y los valores
//
// El respaldo (CREATE TABLE, filas de Almacenes y valores de Lotes.AlmacenCodigo) va a ~/respaldos/.

const RESPALDO = join(homedir(), "respaldos", "tabla_almacenes_20261128.json");
const modo = process.argv.includes("--aplicar") ? "aplicar" : process.argv.includes("--revertir") ? "revertir" : "ver";
const q = async (s: string, ...a: any[]) => (await prisma.$queryRawUnsafe(s, ...a)) as any[];
const ejecutar = async (sql: string) => {
  if (modo === "ver") { console.log(`   (haría) ${sql.split("\n")[0]}`); return; }
  await prisma.$executeRawUnsafe(sql); console.log(`   ✓ ${sql.split("\n")[0]}`);
};
const existeTabla = async () => (await q(`SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Almacenes'`)).length > 0;
const columna = async () => (await q(`SELECT COLUMN_TYPE AS tipo, IS_NULLABLE AS nulo FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Lotes' AND COLUMN_NAME = 'AlmacenCodigo'`))[0] ?? null;
const hayFk = async () => (await q(`SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Lotes' AND CONSTRAINT_NAME = 'fk_lotes_almacen'`)).length > 0;
const conv = (v: any) => (typeof v === "bigint" ? Number(v) : v instanceof Date ? v.toISOString() : v);

async function aplicar() {
  const otras = await q(`SELECT CONCAT(TABLE_NAME, '.', COLUMN_NAME, ' (', CONSTRAINT_NAME, ')') x FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = 'Almacenes' AND NOT (TABLE_NAME = 'Lotes' AND COLUMN_NAME = 'AlmacenCodigo')`);
  if (otras.length) throw new Error(`Todavía apuntan a Almacenes: ${otras.map(o => o.x).join(", ")}. No se toca nada.`);

  const respaldo: any = { fecha: new Date().toISOString() };
  const col = await columna();
  if (col) {
    const valores = await q(`SELECT Lote, Clase, AlmacenCodigo FROM Lotes WHERE AlmacenCodigo IS NOT NULL`);
    respaldo.lotes = { ...col, valores: valores.map(v => [v.Lote, v.Clase, v.AlmacenCodigo]) };
    console.log(`Lotes.AlmacenCodigo (${col.tipo}): ${valores.length} valores no nulos`);
  } else console.log("Lotes.AlmacenCodigo: ya no existe");
  if (await existeTabla()) {
    respaldo.createTable = (await q(`SHOW CREATE TABLE Almacenes`))[0]["Create Table"];
    respaldo.filas = (await q(`SELECT * FROM Almacenes`)).map(f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, conv(v)])));
    console.log(`Almacenes: ${respaldo.filas.length} filas (${respaldo.filas.map((f: any) => f.Codigo).join(", ")})`);
  } else console.log("Almacenes: ya no existe");

  if (modo === "aplicar") {
    mkdirSync(join(homedir(), "respaldos"), { recursive: true });
    if (existsSync(RESPALDO)) throw new Error(`Ya existe ${RESPALDO}: no se sobrescribe un respaldo`);
    writeFileSync(RESPALDO, JSON.stringify(respaldo));
    console.log(`Respaldo: ${RESPALDO}`);
  } else console.log(`   (haría) respaldo en ${RESPALDO}`);

  if (await hayFk()) await ejecutar(`ALTER TABLE Lotes DROP FOREIGN KEY fk_lotes_almacen`);
  if (col) await ejecutar(`ALTER TABLE Lotes DROP COLUMN AlmacenCodigo`);
  if (await existeTabla()) await ejecutar(`DROP TABLE Almacenes`);
}

async function revertir() {
  if (!existsSync(RESPALDO)) throw new Error(`No existe el respaldo ${RESPALDO}`);
  const r = JSON.parse(readFileSync(RESPALDO, "utf8"));
  if (r.createTable && !(await existeTabla())) {
    await ejecutar(r.createTable);
    for (const f of r.filas) {
      const cols = Object.keys(f);
      if (modo === "revertir") await prisma.$executeRawUnsafe(`INSERT INTO Almacenes (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, ...cols.map(c => f[c]));
    }
    console.log(`   ${modo === "revertir" ? "✓" : "(haría)"} ${r.filas.length} filas repuestas en Almacenes`);
  }
  if (r.lotes && !(await columna())) {
    await ejecutar(`ALTER TABLE Lotes ADD COLUMN AlmacenCodigo ${r.lotes.tipo} ${r.lotes.nulo === "YES" ? "NULL" : "NOT NULL"}`);
    if (modo === "revertir") for (const [lote, clase, v] of r.lotes.valores) await prisma.$executeRawUnsafe(`UPDATE Lotes SET AlmacenCodigo = ? WHERE Lote = ? AND Clase = ?`, v, lote, clase);
    console.log(`   ${modo === "revertir" ? "✓" : "(haría)"} ${r.lotes.valores.length} valores repuestos en Lotes.AlmacenCodigo`);
  }
  if (!(await hayFk())) await ejecutar(`ALTER TABLE Lotes ADD CONSTRAINT fk_lotes_almacen FOREIGN KEY (AlmacenCodigo) REFERENCES Almacenes (Codigo)`);
}

console.log(`Modo: ${modo}${modo === "ver" ? " — no cambia nada; usa --aplicar o --revertir" : ""}\n`);
try { if (modo === "revertir") await revertir(); else await aplicar(); }
catch (e: any) { console.error("ERROR:", e.message); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
