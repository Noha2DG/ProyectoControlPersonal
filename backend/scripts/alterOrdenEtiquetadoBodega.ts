// Migración puntual: la Agrupación (OrdenEtiquetado) pasa a elegir la BODEGA virtual en vez del área,
// para que coincida con la trazabilidad (polines, kardex, piso), que habla en bodegas.
//
// AreaCodigo NO se quita: la etiqueta impresa sigue mostrando el nombre del área de siempre
// ("TUNEL ENTRADA", "REEMPAQUE"...) — decisión del usuario, oct 2026 — y la ruta lo deriva sola de la
// bodega elegida (Areas.BodegaVirtualCodigo). Bodega Conservación no tiene área: queda AreaCodigo NULL.
//
// NULLABLE porque el inventario migrado (Estatus 'Migrada') nunca tuvo área ni bodega. Las capturas
// que sí tienen área se rellenan aquí desde Areas.BodegaVirtualCodigo, para que al editarlas el
// selector ya traiga su bodega.
//
//   npx tsx scripts/alterOrdenEtiquetadoBodega.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const cols: any[] = await p.$queryRawUnsafe("SHOW COLUMNS FROM OrdenEtiquetado LIKE 'BodegaCodigo'");
  if (cols.length) {
    console.log("La columna BodegaCodigo ya existe — solo se rellena lo que falte.");
  } else {
    await p.$executeRawUnsafe(`
      ALTER TABLE OrdenEtiquetado
        ADD COLUMN BodegaCodigo VARCHAR(30) NULL AFTER AreaCodigo,
        ADD CONSTRAINT fk_orden_bodega FOREIGN KEY (BodegaCodigo) REFERENCES BodegaVirtual(Codigo)
    `);
    console.log("Columna BodegaCodigo agregada a OrdenEtiquetado.");
  }

  const n = await p.$executeRawUnsafe(`
    UPDATE OrdenEtiquetado oe
      JOIN Areas ar ON ar.Codigo = oe.AreaCodigo
       SET oe.BodegaCodigo = ar.BodegaVirtualCodigo
     WHERE oe.BodegaCodigo IS NULL AND ar.BodegaVirtualCodigo IS NOT NULL
  `);
  console.log(`Capturas rellenadas con la bodega de su área: ${n}`);

  const resumen: any[] = await p.$queryRawUnsafe(`
    SELECT AreaCodigo, BodegaCodigo, COUNT(*) AS n FROM OrdenEtiquetado GROUP BY AreaCodigo, BodegaCodigo ORDER BY n DESC
  `);
  for (const r of resumen) console.log(`  ${r.AreaCodigo ?? "—"} → ${r.BodegaCodigo ?? "—"}: ${Number(r.n)}`);

  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
