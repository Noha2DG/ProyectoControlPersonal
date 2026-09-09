// Migración: candado de emergencia para las líneas de granel (ver project_proforma_granel_sin_techo).
//
// El granel es para cuando se acaba el material de empaque y no se puede detener producción — pero
// eso es una excepción, no una alternativa cómoda. Por eso una línea de granel nace DESACTIVADA:
// nadie puede sacar (imprimir) etiquetas contra ella hasta que un administrador la active, y solo
// un administrador puede volver a apagarla. Se puede seguir declarando avance (Agrupación) mientras
// está desactivada — lo único bloqueado es la impresión física, que es el momento en que el granel
// deja de ser un registro y se vuelve producto empacado de verdad.
//
// DetallePedido.Activo es compartida por todas las líneas (no solo granel) para no bifurcar el
// esquema, pero solo tiene efecto cuando EsGranel = 1 — las líneas normales quedan en 1 para siempre
// y nadie las toca.
//
// Re-ejecutable: cada paso verifica si ya está aplicado.
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
  if (await existeColumna("DetallePedido", "Activo")) {
    console.log("1/3 DetallePedido.Activo ya existe — omitido.");
  } else {
    await p.$executeRawUnsafe(`
      ALTER TABLE DetallePedido
        ADD COLUMN Activo TINYINT(1) NOT NULL DEFAULT 1 AFTER EsGranel
    `);
    console.log("1/3 Columna DetallePedido.Activo agregada (1 en todas las filas existentes — ninguna es de granel todavía).");
  }

  if (await existeColumna("DetallePedido", "ActivoCambiadoPor")) {
    console.log("2/3 DetallePedido.ActivoCambiadoPor ya existe — omitido.");
  } else {
    await p.$executeRawUnsafe(`
      ALTER TABLE DetallePedido
        ADD COLUMN ActivoCambiadoPor VARCHAR(100) NULL AFTER Activo
    `);
    console.log("2/3 Columna DetallePedido.ActivoCambiadoPor agregada.");
  }

  if (await existeColumna("DetallePedido", "ActivoCambiadoEn")) {
    console.log("3/3 DetallePedido.ActivoCambiadoEn ya existe — omitido.");
  } else {
    await p.$executeRawUnsafe(`
      ALTER TABLE DetallePedido
        ADD COLUMN ActivoCambiadoEn DATETIME NULL AFTER ActivoCambiadoPor
    `);
    console.log("3/3 Columna DetallePedido.ActivoCambiadoEn agregada.");
  }

  const resumen: any[] = await p.$queryRawUnsafe(`
    SELECT EsGranel, Activo, COUNT(*) AS n FROM DetallePedido GROUP BY EsGranel, Activo ORDER BY EsGranel, Activo
  `);
  console.log("\nLíneas por (EsGranel, Activo):");
  for (const r of resumen) console.log(`  granel=${r.EsGranel}  activo=${r.Activo}  →  ${r.n}`);

  await p.$disconnect();
}

main().catch(async e => { console.error(e); await p.$disconnect(); process.exit(1); });
