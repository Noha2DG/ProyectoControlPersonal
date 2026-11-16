// Borra los termos que se quedaron sin pesadas: los creó una captura equivocada (un carnet escaneado
// en el campo del termo, "400RAM0042", "357.") y, ya corregida la pesada, quedaron vacíos y salían
// con 0.00 kg en la Hoja de Lote. Desde el 16 nov 2026 routes/pesajeDetalle.ts valida el número y
// borra el termo vacío al corregir; esto limpia los que ya estaban.
//
// Solo toca termos SIN pesadas, de transacciones CERRADAS (en una abierta alguien podría estar por
// usarlo), y que nada en el piso nombra (MovimientoPiso.NumeroTermo). Borra por TermoId, la lista
// que imprime el ensayo, dentro de una transacción; y vuelve a comprobar cada condición al borrar.
//
//   npx tsx scripts/borrarTermosVacios.ts            → ensayo: lista lo que borraría
//   npx tsx scripts/borrarTermosVacios.ts --aplicar  → borra
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

const CONDICION = `
  NOT EXISTS (SELECT 1 FROM PesajeDetalle pd WHERE pd.TermoId = t.TermoId)
  AND NOT EXISTS (SELECT 1 FROM MovimientoPiso m WHERE m.TransaccionId = t.TransaccionId AND m.NumeroTermo = t.NumeroTermo)
  AND EXISTS (SELECT 1 FROM TransaccionesProduccion tp WHERE tp.TransaccionId = t.TransaccionId AND tp.Estado <> 'Abierta')`;

async function main() {
  const aplicar = process.argv.includes("--aplicar");
  const vacios: any[] = await prisma.$queryRawUnsafe(`
    SELECT t.TermoId, t.TransaccionId, t.NumeroTermo, tp.Lote, tp.ClaseOrigen
      FROM Termos t JOIN TransaccionesProduccion tp ON tp.TransaccionId = t.TransaccionId
     WHERE ${CONDICION}
     ORDER BY t.TermoId`);
  const raros = vacios.filter(v => !/^\d+$/.test(v.NumeroTermo)).length;
  console.log(`${vacios.length} termos vacíos de transacciones cerradas (${raros} con número que no es de termo).`);
  console.table(vacios.slice(0, 50).map(v => ({ TermoId: Number(v.TermoId), Transaccion: Number(v.TransaccionId), Termo: v.NumeroTermo, Lote: v.Lote })));
  if (!aplicar) { console.log("Ensayo: no se borró nada. Con --aplicar se borran."); return; }

  const ids = vacios.map(v => Number(v.TermoId));
  if (!ids.length) return;
  const borrados = await prisma.$transaction(async (tx) => {
    const n = await tx.$executeRawUnsafe(
      `DELETE t FROM Termos t WHERE t.TermoId IN (${ids.map(() => "?").join(",")}) AND ${CONDICION}`, ...ids);
    if (n !== ids.length) throw new Error(`Se iban a borrar ${ids.length} y coinciden ${n}: algo cambió, no se borra nada.`);
    return n;
  });
  console.log(`Borrados ${borrados} termos vacíos.`);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
