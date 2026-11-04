// Arranque de "Tomar del piso" en Destajo (usuario, 4 nov 2026): lo que Descongelado mandó al piso de
// Pelado y Descabezado ANTES de que Destajo empezara a escoger de ahí ya se capturó a mano como lotes
// de Materia Prima. Si se queda en el piso, Pelado lo vería como disponible y se tomaría dos veces.
//
// No se borran los TRASLADO: son el registro de Descongelado (sus hojas, su cierre y su reporte los
// leen) y Descongelado sigue en prueba intacto. En su lugar, cada línea del piso de Pelado y
// Descabezado se cierra con un AJUSTE que sale del piso por exactamente su saldo, con la misma llave
// (remisión, lote, clase, talla, fecha del lote) para que el saldo quede en cero renglón por renglón.
//
// Solo toca líneas cuyos renglones vienen de hojas Cerradas: una hoja abierta todavía se puede
// corregir en Descongelado y su producto es de hoy, del arranque.
//
//   npx tsx scripts/iniciarPisoDestajo.ts             → ensayo, no escribe
//   npx tsx scripts/iniciarPisoDestajo.ts --aplicar   → escribe los AJUSTE
//   npx tsx scripts/iniciarPisoDestajo.ts --deshacer  → borra solo los AJUSTE que escribió este script
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

const aplicar = process.argv.includes("--aplicar");
const deshacer = process.argv.includes("--deshacer");
const BODEGAS = ["PELADO", "DESCABEZADO"];
const MOTIVO = "Arranque de Tomar del piso: ya capturado a mano en Materia Prima";
const OPERADOR = "Sistema (arranque Destajo)";

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

  const enLista = BODEGAS.map(() => "?").join(",");
  const lineas: any[] = await prisma.$queryRawUnsafe(`
    SELECT t.Bodega, t.RemisionId, t.Lote, t.Clase, t.Talla, DATE_FORMAT(t.FechaLote, '%Y-%m-%d') AS FechaLote,
           ROUND(SUM(t.Delta), 2) AS Kg, SUM(t.Masters) AS Masters, MAX(t.KgPorMaster) AS KgPorMaster,
           SUM(t.Abierta) AS DeHojaAbierta
      FROM (
        SELECT m.BodegaDestino AS Bodega, m.RemisionId, m.Lote, m.Clase, m.Talla, m.FechaLote,
               m.PesoKg AS Delta, m.Masters, m.KgPorMaster, COALESCE(h.Estatus = 'Abierta', 0) AS Abierta
          FROM MovimientoPiso m LEFT JOIN HojaProceso h ON h.HojaId = m.HojaOrigenId
         WHERE m.BodegaDestino IN (${enLista})
        UNION ALL
        SELECT BodegaOrigen, RemisionId, Lote, Clase, Talla, FechaLote, -PesoKg, -Masters, KgPorMaster, 0
          FROM MovimientoPiso WHERE BodegaOrigen IN (${enLista})
      ) t
     GROUP BY t.Bodega, t.RemisionId, t.Lote, t.Clase, t.Talla, t.FechaLote
    HAVING Kg > 0.001
     ORDER BY t.Bodega, t.FechaLote, t.Lote, t.Clase, t.Talla`, ...BODEGAS, ...BODEGAS);

  const cerrar = lineas.filter(l => Number(l.DeHojaAbierta) === 0);
  const abiertas = lineas.filter(l => Number(l.DeHojaAbierta) > 0);
  console.table(lineas.map(l => ({
    Bodega: l.Bodega, Remision: l.RemisionId, Lote: l.Lote, Clase: l.Clase, Talla: Number(l.Talla),
    FechaLote: l.FechaLote, Kg: Number(l.Kg), Masters: l.Masters == null ? null : Number(l.Masters),
    Accion: Number(l.DeHojaAbierta) ? "se deja (hoja abierta)" : "AJUSTE a cero",
  })));
  for (const b of BODEGAS) {
    const kg = cerrar.filter(l => l.Bodega === b).reduce((s, l) => s + Number(l.Kg), 0);
    console.log(`${b}: ${cerrar.filter(l => l.Bodega === b).length} líneas, ${kg.toFixed(2)} kg a cero`);
  }
  if (abiertas.length) console.log(`${abiertas.length} líneas con renglones de una hoja abierta: no se tocan`);
  if (!aplicar) { console.log("\nEnsayo: no se escribió nada. Use --aplicar para escribir."); return; }
  if (!cerrar.length) { console.log("Nada que ajustar."); return; }

  const n = await prisma.$transaction(async tx => {
    const args: any[] = [];
    const filas = cerrar.map(l => {
      const masters = l.Masters == null || Number(l.Masters) <= 0 ? null : Number(l.Masters);
      args.push(l.Bodega, l.RemisionId == null ? null : Number(l.RemisionId), l.Lote, l.Clase, Number(l.Talla),
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
