// 19 nov 2026: la RS-0133 se anuló (07:32) DESPUÉS de que Descongelado pesara contra ella (06:38 y
// 06:43). Anular borró su INGRESO al piso pero dejó sus consumos, y con ellos los traslados a Pelado y
// lo que Pelado tomó: la RS-0133 salía en −6 masters / −108 kg y la RS-0134 mostraba 6 masters "por
// descongelar" que ya se habían pesado. El lote G545Q011 D31 cuadra en 0 en el piso; solo estaba mal
// a qué remisión se le cargó. Físicamente ese producto llegó en la RS-0134, así que los 20
// movimientos pasan a ella. Solo por los IDs de abajo, y cada uno debe seguir en la RS-0133.
//   npx tsx scripts/reasignarMovimientosRS0133_20261119.ts [--aplicar]
import prisma from "../src/lib/prisma.ts";

const DE = 543, A = 547; // RS-0133 → RS-0134
const IDS = [7338, 7340, 7341, 7343, 7345, 7347, 7349, 7351, 7353, 7355, 7356, 7358, 7359, 7361,
  7366, 7367, 7368, 7369, 7377, 7378];
const aplicar = process.argv.includes("--aplicar");

const saldo = async (tx: any, rem: number) => {
  const r: any[] = await tx.$queryRawUnsafe(`
    SELECT Bodega, Talla, ROUND(SUM(Kg), 2) AS Kg FROM (
      SELECT BodegaDestino AS Bodega, Talla, PesoKg AS Kg FROM MovimientoPiso WHERE RemisionId = ? AND BodegaDestino IS NOT NULL
      UNION ALL
      SELECT BodegaOrigen, Talla, -PesoKg FROM MovimientoPiso WHERE RemisionId = ? AND BodegaOrigen IS NOT NULL) u
    GROUP BY Bodega, Talla HAVING ABS(SUM(Kg)) > 0.001 ORDER BY Bodega, Talla`, rem, rem);
  return r.map(x => `${x.Bodega} talla ${x.Talla}: ${Number(x.Kg)} kg`).join(" · ") || "en cero";
};

await prisma.$transaction(async tx => {
  const [r1]: any[] = await tx.$queryRawUnsafe(`SELECT Folio, Estatus FROM Remisiones WHERE RemisionId = ?`, DE);
  const [r2]: any[] = await tx.$queryRawUnsafe(`SELECT Folio, Estatus FROM Remisiones WHERE RemisionId = ?`, A);
  if (r1.Folio !== "RS-0133" || r1.Estatus !== "Anulada" || r2.Folio !== "RS-0134") throw new Error("Las remisiones no son las esperadas");
  const filas: any[] = await tx.$queryRawUnsafe(
    `SELECT MovimientoId, RemisionId, Lote, Clase FROM MovimientoPiso WHERE MovimientoId IN (${IDS.map(() => "?").join(",")}) FOR UPDATE`, ...IDS);
  const malos = filas.filter(f => Number(f.RemisionId) !== DE || f.Lote !== "G545Q011" || f.Clase !== "D31");
  if (filas.length !== IDS.length || malos.length) throw new Error(`Movimientos cambiaron: ${filas.length}/${IDS.length}, distintos: ${malos.map(m => m.MovimientoId)}`);

  console.log("ANTES  RS-0133:", await saldo(tx, DE));
  console.log("ANTES  RS-0134:", await saldo(tx, A));
  const n = await tx.$executeRawUnsafe(
    `UPDATE MovimientoPiso SET RemisionId = ? WHERE RemisionId = ? AND MovimientoId IN (${IDS.map(() => "?").join(",")})`, A, DE, ...IDS);
  console.log(`Movimientos pasados a RS-0134: ${n}`);
  console.log("DESPUÉS RS-0133:", await saldo(tx, DE));
  console.log("DESPUÉS RS-0134:", await saldo(tx, A));
  if (Number(n) !== IDS.length) throw new Error("No se movieron todos");
  if (!aplicar) throw new Error("SIMULACRO — se revierte, no se guardó nada");
}).catch(e => console.log(e.message));
await prisma.$disconnect();
