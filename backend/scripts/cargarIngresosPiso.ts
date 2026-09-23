// Carga al inventario al piso lo que bodega despachó a un área en una jornada ya pasada.
//
//   npx tsx scripts/cargarIngresosPiso.ts 2026-09-22 [DE]
//   npx tsx scripts/cargarIngresosPiso.ts 2026-09-22 [DE] --deshacer
//
// Desde que la confirmación de remisión engancha el ingreso sola (lib/inventarioPiso.ts), esto solo
// hace falta para días anteriores al despliegue. Llama a la MISMA función que la pantalla, no a una
// copia de la consulta: dos versiones de esa lógica terminarían dando dos inventarios distintos
// para el mismo despacho.
//
// SOLO CUENTA LO CONFIRMADO. Mientras la remisión está en Borrador el producto no existe para el
// área: bodega todavía no lo entregó.
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";
import { registrarIngresoDesdeRemision, revertirIngresoDeRemision } from "../src/lib/inventarioPiso.ts";

const fecha = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
const area  = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "DE";
const deshacer = process.argv.includes("--deshacer");

async function main() {
  if (!fecha) {
    console.error("Falta la fecha: npx tsx scripts/cargarIngresosPiso.ts 2026-09-22 [DE] [--deshacer]");
    process.exit(1);
  }

  const remisiones: any[] = await prisma.$queryRawUnsafe(`
    SELECT RemisionId, Folio FROM Remisiones
     WHERE AreaDestino = ? AND Estatus = 'Confirmada'
       AND ConfirmadaEn >= ? AND ConfirmadaEn < DATE_ADD(?, INTERVAL 1 DAY)
     ORDER BY ConfirmadaEn`, area, fecha, fecha);

  if (!remisiones.length) {
    console.log(`Sin remisiones confirmadas a ${area} el ${fecha}.`);
    await prisma.$disconnect();
    return;
  }

  if (deshacer) {
    let total = 0;
    for (const r of remisiones) {
      // Cada remisión en su propia transacción: si una no se puede revertir porque el área ya
      // trabajó su producto, las demás igual se deshacen y el mensaje dice cuál quedó.
      try {
        const n = await prisma.$transaction(async (tx) => revertirIngresoDeRemision(tx, r.RemisionId));
        total += n;
        console.log(`  ${r.Folio}: ${n} ingresos borrados`);
      } catch (e: any) {
        console.error(`  ${r.Folio}: NO se deshizo — ${e.message}`);
      }
    }
    console.log(`\nDeshecho: ${total} ingresos de ${area} del ${fecha}.`);
    await prisma.$disconnect();
    return;
  }

  const [ya]: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS n FROM MovimientoPiso
      WHERE Tipo = 'INGRESO' AND AreaDestino = ? AND RemisionId IN (${remisiones.map(() => "?").join(",")})`,
    area, ...remisiones.map(r => r.RemisionId));
  if (Number(ya.n) > 0) {
    console.error(`ABORTA: estas remisiones ya tienen ${ya.n} ingresos cargados. Use --deshacer primero.`);
    process.exit(1);
  }

  let lineas = 0, kg = 0;
  for (const r of remisiones) {
    const out = await prisma.$transaction(async (tx) =>
      registrarIngresoDesdeRemision(tx, r.RemisionId, area, fecha, "Carga desde remisión"));
    lineas += out.lineas; kg += out.kg;
    console.log(`  ${r.Folio}: ${out.lineas} líneas, ${out.kg.toFixed(2)} kg`);
  }
  console.log(`\nCargados ${lineas} ingresos a ${area} del ${fecha} — ${kg.toFixed(2)} kg.`);
  console.log(`Para deshacer: npx tsx scripts/cargarIngresosPiso.ts ${fecha} ${area} --deshacer`);
  await prisma.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
