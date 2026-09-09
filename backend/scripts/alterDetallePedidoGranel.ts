// Migración: línea de granel (ver project_proforma_granel_sin_techo).
//
// Cuando se acaba el material de empaque la producción NO se detiene: se empaca a granel (1/20 lb,
// 1/40 lb…). Ese producto es del pedido y consume el compromiso con el cliente, pero no corresponde
// a ninguna línea de la proforma y por lo tanto no tiene techo propio.
//
// DetallePedido.EsGranel marca esas líneas. Se comportan como las de un pedido general: Objetivo
// null, sin candado en Agrupación, fuera de los agregados planificados. Su techo real no es de la
// línea sino del par (Proceso, Talla) medido en kg — ver el cuadre en detallePedido.ts.
//
// Va también en DetallePedidoHistorial porque ese historial guarda la foto COMPLETA de la línea
// después de cada cambio: sin la columna, al leer el historial no se podría saber si la línea era
// de granel el día del despacho, que es justo cuando se necesita.
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
  // ---- 1. DetallePedido.EsGranel --------------------------------------------------------------
  if (await existeColumna("DetallePedido", "EsGranel")) {
    console.log("1/2 DetallePedido.EsGranel ya existe — omitido.");
  } else {
    await p.$executeRawUnsafe(`
      ALTER TABLE DetallePedido
        ADD COLUMN EsGranel TINYINT(1) NOT NULL DEFAULT 0 AFTER LibrasPedido
    `);
    console.log("1/2 Columna DetallePedido.EsGranel agregada (0 = línea de proforma, en todas las filas existentes).");
  }

  // ---- 2. DetallePedidoHistorial.EsGranel ------------------------------------------------------
  if (await existeColumna("DetallePedidoHistorial", "EsGranel")) {
    console.log("2/2 DetallePedidoHistorial.EsGranel ya existe — omitido.");
  } else {
    await p.$executeRawUnsafe(`
      ALTER TABLE DetallePedidoHistorial
        ADD COLUMN EsGranel TINYINT(1) NOT NULL DEFAULT 0 AFTER LibrasPedido
    `);
    console.log("2/2 Columna DetallePedidoHistorial.EsGranel agregada.");
  }

  // ---- Verificación ---------------------------------------------------------------------------
  const resumen: any[] = await p.$queryRawUnsafe(`
    SELECT ped.EsGeneral, dp.EsGranel, COUNT(*) AS n
    FROM DetallePedido dp JOIN Pedidos ped ON ped.CodigoPedido = dp.CodigoPedido
    GROUP BY ped.EsGeneral, dp.EsGranel ORDER BY ped.EsGeneral, dp.EsGranel
  `);
  console.log("\nLíneas por tipo (EsGeneral / EsGranel):");
  for (const r of resumen) console.log(`  general=${r.EsGeneral}  granel=${r.EsGranel}  →  ${r.n}`);

  await p.$disconnect();
}

main().catch(async e => { console.error(e); await p.$disconnect(); process.exit(1); });
