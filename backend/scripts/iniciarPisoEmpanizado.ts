// Arranque del piso EMPANIZADO (usuario, 20 nov 2026): "deja solo lo que hayan enviado hoy los de
// Tratamiento". Lo que entró al piso ANTES de hoy ya se trabajó fuera del sistema; si se queda, el
// futuro "Tomar del piso" de Empanizado lo vería como disponible.
//
// No se borran los TRASLADO: son el registro de Tratamiento (sus hojas y reportes los leen). Cada
// línea del piso se cierra con un AJUSTE que sale por su saldo SIN contar lo que entró hoy, con la
// misma llave (remisión, lote, clase, talla, fecha del lote), igual que iniciarPisoDestajo.ts.
//
//   npx tsx scripts/iniciarPisoEmpanizado.ts             → ensayo, no escribe
//   npx tsx scripts/iniciarPisoEmpanizado.ts --aplicar   → escribe los AJUSTE
//   npx tsx scripts/iniciarPisoEmpanizado.ts --deshacer  → borra solo los AJUSTE que escribió este script
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

const aplicar = process.argv.includes("--aplicar");
const deshacer = process.argv.includes("--deshacer");
const BODEGA = "EMPANIZADO";
const MOTIVO = "Arranque del piso de Empanizado: solo queda lo enviado por Tratamiento el 20 nov 2026";
const OPERADOR = "Sistema (arranque Empanizado)";
const CORTE = "2026-11-20"; // lo que entró desde este día se queda

async function main() {
  if (deshacer) {
    const ids: any[] = await prisma.$queryRawUnsafe(
      `SELECT MovimientoId FROM MovimientoPiso WHERE Tipo = 'AJUSTE' AND Motivo = ? AND RegistradoPor = ?`, MOTIVO, OPERADOR);
    console.log(`AJUSTE del arranque: ${ids.length}`);
    if (!ids.length) return;
    const n = await prisma.$executeRawUnsafe(
      `DELETE FROM MovimientoPiso WHERE MovimientoId IN (${ids.map(() => "?").join(",")})`, ...ids.map(r => Number(r.MovimientoId)));
    console.log(`Borrados ${n}`);
    return;
  }

  const lineas: any[] = await prisma.$queryRawUnsafe(`
    SELECT t.RemisionId, t.Lote, t.Clase, t.Talla, DATE_FORMAT(t.FechaLote, '%Y-%m-%d') AS FechaLote,
           ROUND(SUM(t.Delta), 2) AS Kg, SUM(t.Masters) AS Masters, MAX(t.KgPorMaster) AS KgPorMaster
      FROM (
        SELECT RemisionId, Lote, Clase, Talla, FechaLote, PesoKg AS Delta, Masters, KgPorMaster
          FROM MovimientoPiso WHERE BodegaDestino = ? AND FechaHora < ?
        UNION ALL
        SELECT RemisionId, Lote, Clase, Talla, FechaLote, -PesoKg, -Masters, KgPorMaster
          FROM MovimientoPiso WHERE BodegaOrigen = ?
      ) t
     GROUP BY t.RemisionId, t.Lote, t.Clase, t.Talla, t.FechaLote
    HAVING Kg > 0.001
     ORDER BY t.FechaLote, t.Lote, t.Clase, t.Talla`, BODEGA, CORTE, BODEGA);

  console.table(lineas.map(l => ({ Remision: l.RemisionId, Lote: l.Lote, Clase: l.Clase, Talla: Number(l.Talla),
    FechaLote: l.FechaLote, Kg: Number(l.Kg), Masters: l.Masters == null ? null : Number(l.Masters) })));
  const total = lineas.reduce((s, l) => s + Number(l.Kg), 0);
  console.log(`${lineas.length} líneas, ${total.toFixed(2)} kg a cero`);
  if (!aplicar) { console.log("\nEnsayo: no se escribió nada. Use --aplicar para escribir."); return; }
  if (!lineas.length) { console.log("Nada que ajustar."); return; }

  const n = await prisma.$transaction(async tx => {
    const args: any[] = [];
    const filas = lineas.map(l => {
      const masters = l.Masters == null || Number(l.Masters) <= 0 ? null : Number(l.Masters);
      args.push(BODEGA, l.RemisionId == null ? null : Number(l.RemisionId), l.Lote, l.Clase, Number(l.Talla),
                l.FechaLote, Number(l.Kg), Number(l.Kg), masters, l.KgPorMaster == null ? null : Number(l.KgPorMaster),
                MOTIVO, OPERADOR);
      return "('AJUSTE', CURDATE(), ?, ?, ?, ?, ?, ?, ?, 'KG', ?, ?, ?, ?, ?)";
    }).join(",");
    return tx.$executeRawUnsafe(`
      INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaOrigen, RemisionId, Lote, Clase, Talla, FechaLote,
                                  Peso, UM, PesoKg, Masters, KgPorMaster, Motivo, RegistradoPor)
      VALUES ${filas}`, ...args);
  });
  console.log(`\nEscritos ${n} AJUSTE. Para deshacer: --deshacer`);
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
