// Migración: anular una línea de la proforma en vez de borrarla (5 nov 2026).
//
// El cliente cambia cantidades o tallas a media temporada (020-2026 dejó de llevar 16/20). Borrar
// la línea no sirve: casi todas tienen capturas de Agrupación colgando por FK, y las que ya tienen
// producto escaneado lo dejarían sin línea a la cual pertenecer. Anulada = 1 la saca de la proforma
// (total, avance, nuevas capturas e impresión) y conserva la fila, el producto que ya existe y el
// rastro de quién, cuándo y por qué. Se puede reactivar.
//
// Re-ejecutable: cada paso verifica si ya está aplicado. `--drop` quita las cuatro columnas.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

const COLUMNAS: [string, string][] = [
  ["Anulada",         "TINYINT(1) NOT NULL DEFAULT 0 AFTER ActivoCambiadoEn"],
  ["AnuladaPor",      "VARCHAR(100) NULL AFTER Anulada"],
  ["AnuladaEn",       "DATETIME NULL AFTER AnuladaPor"],
  ["MotivoAnulacion", "VARCHAR(300) NULL AFTER AnuladaEn"],
];

async function existeColumna(tabla: string, columna: string): Promise<boolean> {
  const rows: any[] = await p.$queryRawUnsafe(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    tabla, columna
  );
  return rows.length > 0;
}

async function main() {
  if (process.argv.includes("--drop")) {
    for (const [col] of [...COLUMNAS].reverse()) {
      if (await existeColumna("DetallePedido", col)) {
        await p.$executeRawUnsafe(`ALTER TABLE DetallePedido DROP COLUMN ${col}`);
        console.log(`DetallePedido.${col} eliminada.`);
      }
    }
    await p.$disconnect();
    return;
  }

  for (const [i, [col, def]] of COLUMNAS.entries()) {
    if (await existeColumna("DetallePedido", col)) {
      console.log(`${i + 1}/${COLUMNAS.length} DetallePedido.${col} ya existe — omitido.`);
    } else {
      await p.$executeRawUnsafe(`ALTER TABLE DetallePedido ADD COLUMN ${col} ${def}`);
      console.log(`${i + 1}/${COLUMNAS.length} Columna DetallePedido.${col} agregada.`);
    }
  }

  const resumen: any[] = await p.$queryRawUnsafe(`SELECT Anulada, COUNT(*) AS n FROM DetallePedido GROUP BY Anulada`);
  console.log("\nLíneas por Anulada:");
  for (const r of resumen) console.log(`  anulada=${r.Anulada}  →  ${r.n}`);

  await p.$disconnect();
}

main().catch(async e => { console.error(e); await p.$disconnect(); process.exit(1); });
