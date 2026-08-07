// Clientes.Tipo — separa la cartera en Local vs Exportación (decisión del usuario, ago 2026).
// Vive en el CLIENTE y no en el pedido: un cliente de Taiwán no deja de serlo pedido a pedido.
// Su uso hoy es filtrar el selector de cliente al crear una remisión, para no poder despachar una
// "Venta local" a un cliente de exportación (ni al revés).
//
// El backfill usa País como MEJOR APROXIMACIÓN, no como verdad: GT → Local, resto → Exportación.
// Se sabe que se queda corto — INDUPECASA está registrada como GT pero sus subclientes son marcas
// de EE.UU. (Long John Silver, Gold Coast, Captain Morgan, Tampa Bay). Por eso el script imprime al
// final la clasificación completa: hay que revisarla a ojo y corregir desde Catálogos → Clientes.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function existeColumna(tabla: string, columna: string): Promise<boolean> {
  const rows: any[] = await p.$queryRawUnsafe(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    tabla, columna
  );
  return rows.length > 0;
}

async function main() {
  if (await existeColumna("Clientes", "Tipo")) {
    console.log("Clientes.Tipo ya existe — no se toca (una re-corrida NO debe pisar las correcciones manuales del usuario).");
  } else {
    await p.$executeRawUnsafe(`
      ALTER TABLE Clientes ADD COLUMN Tipo VARCHAR(20) NOT NULL DEFAULT 'Local' AFTER Pais
    `);
    const n = await p.$executeRawUnsafe(`UPDATE Clientes SET Tipo = 'Exportacion' WHERE Pais <> 'GT'`);
    console.log(`Columna Clientes.Tipo agregada. ${n} cliente(s) marcados como Exportación por su país; el resto quedó Local.`);
  }

  const clasificacion: any[] = await p.$queryRawUnsafe(`
    SELECT Tipo, Pais, COUNT(*) AS n, GROUP_CONCAT(RazonSocial ORDER BY Codigo SEPARATOR ' · ') AS Clientes
    FROM Clientes WHERE Estatus = 'Activo' GROUP BY Tipo, Pais ORDER BY Tipo, Pais
  `);
  console.log("\nClasificación actual (REVISAR y corregir en Catálogos → Clientes):");
  for (const c of clasificacion) {
    console.log(`  [${c.Tipo}] ${c.Pais} (${Number(c.n)}): ${c.Clientes}`);
  }

  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
