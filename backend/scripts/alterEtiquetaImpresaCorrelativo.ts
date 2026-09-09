// Migración: el correlativo del QR pasa de ser DERIVADO a ser un dato GUARDADO.
//
// Hasta ahora el correlativo era "E" + EtiquetaId: se armaba en etiquetaImpresa.ts al imprimir y se
// deshacía con parseCorrelativo() (triplicado en pallets/remisiones/etiquetaImpresa) al escanear.
// Eso funciona mientras TODAS las etiquetas las emita este sistema.
//
// La migración del inventario del sistema anterior (ver migrarInventarioInicial.ts) trae ~20,900
// masters cuyo código YA ESTÁ IMPRESO Y ESCANEABLE en la caja física, con dos formatos numéricos
// propios ("290526007511" de 12 dígitos y "20261006000674" de 14). Re-etiquetar 20,900 cajas dentro
// del frío no es viable, y el requisito es que esos códigos sirvan EXACTAMENTE igual que los
// nuestros: escanear a un polín, mover de polín, consultar, remisionar.
//
// Con Correlativo como columna UNIQUE los dos mundos dejan de distinguirse: toda resolución pasa a
// ser por texto y no queda ninguna rama de "si es migrado". Lo único que sigue siendo numérico es la
// anulación POR RANGO, que solo tiene sentido sobre correlativos "E" secuenciales.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function existeColumna(tabla: string, columna: string) {
  const r: any[] = await p.$queryRawUnsafe(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, tabla, columna);
  return Number(r[0].n) > 0;
}

async function main() {
  if (await existeColumna("EtiquetaImpresa", "Correlativo")) {
    console.log("EtiquetaImpresa.Correlativo ya existe — migración omitida.");
    await p.$disconnect();
    return;
  }

  // Nullable primero: el backfill necesita las filas creadas para poder calcular "E"+EtiquetaId.
  await p.$executeRawUnsafe(`ALTER TABLE EtiquetaImpresa ADD COLUMN Correlativo VARCHAR(20) NULL AFTER OrdenId`);
  console.log("1/3 Columna Correlativo agregada (nullable).");

  const r = await p.$executeRawUnsafe(
    `UPDATE EtiquetaImpresa SET Correlativo = CONCAT('E', EtiquetaId) WHERE Correlativo IS NULL`);
  console.log(`2/3 Backfill: ${r} etiqueta(s) existentes quedaron como "E"+EtiquetaId.`);

  // NOT NULL + UNIQUE recién ahora: son el candado que hace que un correlativo migrado y uno nuestro
  // no puedan chocar nunca, y que un mismo código no entre dos veces.
  await p.$executeRawUnsafe(`ALTER TABLE EtiquetaImpresa MODIFY COLUMN Correlativo VARCHAR(20) NOT NULL`);
  await p.$executeRawUnsafe(`ALTER TABLE EtiquetaImpresa ADD UNIQUE KEY uq_etiqueta_correlativo (Correlativo)`);
  console.log("3/3 Correlativo pasó a NOT NULL + UNIQUE.");

  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
