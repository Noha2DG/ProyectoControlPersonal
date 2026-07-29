// Migración: pedido general / de almacenaje (ver project_pedido_general_design). Tres cambios:
//
// - Pedidos.EsGeneral — la casilla que define, al crear, que el pedido es de almacenaje: producto que
//   todavía no está comprometido a la venta, sin cantidades planificadas. Con ella en 1 el Objetivo de
//   sus líneas deja de ser un techo (no hay contra qué comparar).
//
// - DetallePedido.Proceso — denormalizado desde Clase.Proceso. Hace falta porque la regla de unicidad
//   es sobre PROCESO y la tabla solo guarda Clase, que es Familia+Proceso: 186 clases reparten 84
//   procesos, y 60 de esos procesos los comparten varias clases (ej. proceso 10 GRANEL =
//   C10/D10/E10/F10/H10/P10). Un UNIQUE sobre Clase dejaría pasar C10 y D10 con la misma talla y
//   presentación, y como la etiqueta imprime el Proceso —no la Clase— serían dos cajas con etiquetas
//   físicamente idénticas. Guardar Proceso *en vez de* Clase no sirve: se perdería la Familia, que usa
//   la validación Área↔Familia del pesaje.
//
// - UNIQUE (CodigoPedido, Proceso, Talla, Presentacion) para TODOS los pedidos, no solo los generales
//   (MySQL no soporta UNIQUE parcial, y dos líneas idénticas en un pedido de cliente son un error de
//   captura de todos modos). El empaque queda FUERA de la llave a propósito: tampoco se imprime en la
//   etiqueta, así que dos líneas que solo difieran en empaque serían indistinguibles en bodega.
//
// Re-ejecutable: cada paso verifica si ya está aplicado. Si encuentra filas que violarían el UNIQUE no
// lo crea y sale con error listándolas — nunca borra ni fusiona datos por su cuenta.
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

async function existeIndice(tabla: string, indice: string): Promise<boolean> {
  const rows: any[] = await p.$queryRawUnsafe(
    `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    tabla, indice
  );
  return rows.length > 0;
}

async function main() {
  // ---- 1. Pedidos.EsGeneral -------------------------------------------------------------------
  if (await existeColumna("Pedidos", "EsGeneral")) {
    console.log("1/3 Pedidos.EsGeneral ya existe — omitido.");
  } else {
    await p.$executeRawUnsafe(`
      ALTER TABLE Pedidos
        ADD COLUMN EsGeneral TINYINT(1) NOT NULL DEFAULT 0 AFTER Estatus
    `);
    console.log("1/3 Columna Pedidos.EsGeneral agregada (0 = pedido de cliente, en todas las filas existentes).");
  }

  // ---- 2. DetallePedido.Proceso (denormalizado desde Clase) -----------------------------------
  if (await existeColumna("DetallePedido", "Proceso")) {
    console.log("2/3 DetallePedido.Proceso ya existe — omitido.");
  } else {
    // Se agrega NULLABLE para poder rellenarla, y se cierra a NOT NULL al final. La FK a Procesos
    // deja el dato denormalizado atado al catálogo: si un proceso no existe, el INSERT revienta.
    await p.$executeRawUnsafe(`ALTER TABLE DetallePedido ADD COLUMN Proceso INT NULL AFTER Clase`);

    const backfill = await p.$executeRawUnsafe(`
      UPDATE DetallePedido dp JOIN Clase cl ON dp.Clase = cl.Clase SET dp.Proceso = cl.Proceso
    `);
    console.log(`    ${backfill} línea(s) rellenadas con el Proceso de su Clase.`);

    const huerfanas: any[] = await p.$queryRawUnsafe(`
      SELECT DetalleId, CodigoPedido, Clase FROM DetallePedido WHERE Proceso IS NULL
    `);
    if (huerfanas.length) {
      console.error("ERROR: hay líneas cuya Clase no existe en el catálogo, no se puede cerrar la columna:");
      console.error(JSON.stringify(huerfanas, null, 2));
      console.error("Corrija esas Clases y vuelva a ejecutar (la columna quedó agregada como NULL).");
      await p.$disconnect();
      process.exit(1);
    }

    await p.$executeRawUnsafe(`ALTER TABLE DetallePedido MODIFY COLUMN Proceso INT NOT NULL`);
    await p.$executeRawUnsafe(`
      ALTER TABLE DetallePedido
        ADD CONSTRAINT fk_detalle_proceso FOREIGN KEY (Proceso) REFERENCES Procesos(Proceso)
    `);
    console.log("2/3 Columna DetallePedido.Proceso agregada, rellenada, cerrada a NOT NULL y con FK a Procesos.");
  }

  // ---- 3. UNIQUE (CodigoPedido, Proceso, Talla, Presentacion) ---------------------------------
  if (await existeIndice("DetallePedido", "uq_detalle_producto")) {
    console.log("3/3 El índice uq_detalle_producto ya existe — omitido.");
  } else {
    const duplicados: any[] = await p.$queryRawUnsafe(`
      SELECT CodigoPedido, Proceso, Talla, Presentacion,
             COUNT(*) AS Filas,
             GROUP_CONCAT(CONCAT(DetalleId, ':', Clase) ORDER BY DetalleId) AS Lineas
      FROM DetallePedido
      GROUP BY CodigoPedido, Proceso, Talla, Presentacion
      HAVING COUNT(*) > 1
    `);
    if (duplicados.length) {
      console.error(`ERROR: ${duplicados.length} combinación(es) de Pedido+Proceso+Talla+Presentación están repetidas.`);
      console.error("El índice único NO se creó. Resuelva estas líneas a mano (fusionar o borrar) y reejecute:");
      console.error(JSON.stringify(duplicados, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2));
      await p.$disconnect();
      process.exit(1);
    }

    await p.$executeRawUnsafe(`
      ALTER TABLE DetallePedido
        ADD UNIQUE KEY uq_detalle_producto (CodigoPedido, Proceso, Talla, Presentacion)
    `);
    console.log("3/3 Índice UNIQUE uq_detalle_producto creado (Pedido + Proceso + Talla + Presentación).");
  }

  console.log("Migración de pedido general completada.");
  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
