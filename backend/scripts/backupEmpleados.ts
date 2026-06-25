import "dotenv/config";
import prisma from "../src/lib/prisma.ts";
import fs from "fs";

// Respaldo de Empleados y tablas relacionadas antes de un vaciado masivo.
// Las columnas de fecha se castean a CHAR porque MySQL puede tener valores
// '0000-00-00' que el driver no puede convertir a Date de JS.
const TABLAS = ["Empleados", "Altas", "Bajas", "Movimientos", "Permisos", "Transferencias", "EntregaEquipo"];

function serializar(rows: any[]) {
  return rows.map(r => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(r)) out[k] = typeof v === "bigint" ? Number(v) : v;
    return out;
  });
}

async function selectAll(tabla: string): Promise<any[]> {
  const cols: any[] = await prisma.$queryRawUnsafe(`
    SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
    ORDER BY ORDINAL_POSITION
  `, tabla);
  const select = cols.map(c => {
    const isDate = ["date", "datetime", "timestamp"].includes(c.DATA_TYPE);
    return isDate ? `CAST(${c.COLUMN_NAME} AS CHAR) AS ${c.COLUMN_NAME}` : c.COLUMN_NAME;
  }).join(", ");
  return prisma.$queryRawUnsafe(`SELECT ${select} FROM ${tabla}`);
}

async function main() {
  const backup: Record<string, any[]> = {};
  for (const tabla of TABLAS) {
    const rows = await selectAll(tabla);
    backup[tabla] = serializar(rows);
    console.log(`${tabla}: ${rows.length} filas`);
  }
  const archivo = `backup_empleados_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(archivo, JSON.stringify(backup, null, 2));
  console.log(`Respaldo guardado en ${archivo}`);
  await prisma.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
