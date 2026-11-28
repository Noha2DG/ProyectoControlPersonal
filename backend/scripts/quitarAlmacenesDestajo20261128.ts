import "dotenv/config";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import prisma from "../src/lib/prisma.ts";

// Quita las columnas de almacén de Destajo, sin uso desde el 24 nov 2026 (ya no se pide almacén):
// TransaccionesProduccion.AlmacenOrigen / AlmacenDestino y Termos.AlmacenActual, con sus llaves hacia
// Almacenes. El código dejó de leerlas antes de correr esto.
//
//   npx tsx scripts/quitarAlmacenesDestajo20261128.ts             → solo muestra qué haría
//   npx tsx scripts/quitarAlmacenesDestajo20261128.ts --aplicar   → respalda y quita
//   npx tsx scripts/quitarAlmacenesDestajo20261128.ts --revertir  → las vuelve a crear con sus valores
//
// El respaldo (definición de cada columna + todos los valores no nulos) va a ~/respaldos/.

const COLUMNAS = [
  { tabla: "TransaccionesProduccion", columna: "AlmacenOrigen", fk: "fk_transprod_almorigen", llave: "TransaccionId" },
  { tabla: "TransaccionesProduccion", columna: "AlmacenDestino", fk: "fk_transprod_almdestino", llave: "TransaccionId" },
  { tabla: "Termos", columna: "AlmacenActual", fk: "fk_termos_almacen", llave: "TermoId" },
];
const RESPALDO = join(homedir(), "respaldos", "almacenes_destajo_20261128.json");
const modo = process.argv.includes("--aplicar") ? "aplicar" : process.argv.includes("--revertir") ? "revertir" : "ver";
const q = async (s: string, ...a: any[]) => (await prisma.$queryRawUnsafe(s, ...a)) as any[];
const ejecutar = async (sql: string) => {
  if (modo === "ver") { console.log(`   (haría) ${sql}`); return; }
  await prisma.$executeRawUnsafe(sql); console.log(`   ✓ ${sql}`);
};
const definicion = async (t: string, c: string) => (await q(`SELECT COLUMN_TYPE AS tipo, IS_NULLABLE AS nulo FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, t, c))[0] ?? null;
const hayFk = async (t: string, n: string) => (await q(`SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? LIMIT 1`, t, n)).length > 0;

async function aplicar() {
  const respaldo: any = { fecha: new Date().toISOString(), columnas: {} };
  for (const c of COLUMNAS) {
    const def = await definicion(c.tabla, c.columna);
    if (!def) { console.log(`${c.tabla}.${c.columna}: ya no existe`); continue; }
    const valores = await q(`SELECT ${c.llave} AS id, ${c.columna} AS v FROM ${c.tabla} WHERE ${c.columna} IS NOT NULL`);
    respaldo.columnas[`${c.tabla}.${c.columna}`] = { ...def, valores: valores.map(r => [Number(r.id), r.v]) };
    console.log(`${c.tabla}.${c.columna} (${def.tipo}): ${valores.length} valores no nulos`);
  }
  if (modo === "aplicar") {
    mkdirSync(join(homedir(), "respaldos"), { recursive: true });
    if (existsSync(RESPALDO)) throw new Error(`Ya existe ${RESPALDO}: no se sobrescribe un respaldo`);
    writeFileSync(RESPALDO, JSON.stringify(respaldo));
    console.log(`Respaldo: ${RESPALDO}`);
  } else console.log(`   (haría) respaldo en ${RESPALDO}`);
  for (const c of COLUMNAS) {
    if (!(await definicion(c.tabla, c.columna))) continue;
    if (await hayFk(c.tabla, c.fk)) await ejecutar(`ALTER TABLE ${c.tabla} DROP FOREIGN KEY ${c.fk}`);
    await ejecutar(`ALTER TABLE ${c.tabla} DROP COLUMN ${c.columna}`);
  }
}

async function revertir() {
  if (!existsSync(RESPALDO)) throw new Error(`No existe el respaldo ${RESPALDO}`);
  const respaldo = JSON.parse(readFileSync(RESPALDO, "utf8"));
  for (const c of COLUMNAS) {
    const r = respaldo.columnas[`${c.tabla}.${c.columna}`];
    if (!r) { console.log(`${c.tabla}.${c.columna}: no está en el respaldo`); continue; }
    if (!(await definicion(c.tabla, c.columna))) await ejecutar(`ALTER TABLE ${c.tabla} ADD COLUMN ${c.columna} ${r.tipo} ${r.nulo === "YES" ? "NULL" : "NOT NULL"}`);
    if (modo === "revertir") for (const [id, v] of r.valores) await prisma.$executeRawUnsafe(`UPDATE ${c.tabla} SET ${c.columna} = ? WHERE ${c.llave} = ?`, v, id);
    console.log(`   ${modo === "revertir" ? "✓" : "(haría)"} ${r.valores.length} valores repuestos en ${c.tabla}.${c.columna}`);
    if (!(await hayFk(c.tabla, c.fk))) await ejecutar(`ALTER TABLE ${c.tabla} ADD CONSTRAINT ${c.fk} FOREIGN KEY (${c.columna}) REFERENCES Almacenes (Codigo)`);
  }
}

console.log(`Modo: ${modo}${modo === "ver" ? " — no cambia nada; usa --aplicar o --revertir" : ""}\n`);
try { if (modo === "revertir") await revertir(); else await aplicar(); }
catch (e: any) { console.error("ERROR:", e.message); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
