// Corrección puntual (6 oct 2026): la clase de CULTIVO PELADO BFT-ON * se dio de alta con código "R"
// cuando debía ser "R52". La pantalla de Clase no deja cambiar el código (es la llave), así que este
// script crea R52 copiando la fila de R y borra R.
//
// Solo procede si NADIE usa todavía "R": busca en information_schema todas las columnas cuyo nombre
// empieza con "Clase" (ClasePT, ClaseOrigen, Clase de Lotes/DetallePedido/MovimientoPiso…, sean FK o
// texto suelto) y cuenta filas con 'R'. Si alguna tiene uso, no toca nada y lo reporta: mover esas
// referencias (Lotes tiene llave compuesta Lote+Clase) se decide aparte.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

const MAL = "R";
const BIEN = "R52";

async function main() {
  const fila: any[] = await p.$queryRawUnsafe(`SELECT * FROM Clase WHERE Clase = ?`, MAL);
  if (!fila.length) throw new Error(`No existe la clase "${MAL}" — ¿ya se corrigió?`);
  const yaExiste: any[] = await p.$queryRawUnsafe(`SELECT Clase FROM Clase WHERE Clase = ?`, BIEN);
  if (yaExiste.length) throw new Error(`Ya existe la clase ${BIEN} — no la toco`);
  console.log("ANTES:", JSON.stringify(fila[0]));

  const cols: any[] = await p.$queryRawUnsafe(`
    SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME LIKE 'Clase%' AND TABLE_NAME <> 'Clase'
      AND DATA_TYPE IN ('varchar','char')`);
  // Único uso que se mueve solo: TransaccionesProduccion.ClasePT. Es el mismo Producto con el código
  // mal escrito, y su columna Proceso (52) ya es la de R52, así que basta cambiar ClasePT.
  const MOVIBLE = "TransaccionesProduccion.ClasePT";
  let usosMovibles = 0, usosOtros = 0;
  for (const c of cols) {
    const r: any[] = await p.$queryRawUnsafe(
      `SELECT COUNT(*) AS n FROM \`${c.TABLE_NAME}\` WHERE \`${c.COLUMN_NAME}\` = ?`, MAL);
    const n = Number(r[0].n);
    if (!n) continue;
    console.log(`  USO: ${c.TABLE_NAME}.${c.COLUMN_NAME} = ${n} filas`);
    if (`${c.TABLE_NAME}.${c.COLUMN_NAME}` === MOVIBLE) usosMovibles += n; else usosOtros += n;
  }
  console.log(`Revisadas ${cols.length} columnas.`);
  if (usosOtros) throw new Error(`"${MAL}" se usa fuera de ${MOVIBLE} — no se corrige automáticamente`);

  const trans: any[] = await p.$queryRawUnsafe(`
    SELECT tp.TransaccionId, tp.Lote, tp.ClaseOrigen, tp.ClasePT, tp.Proceso, tp.Estado,
           (SELECT COUNT(*) FROM PesajeDetalle pd WHERE pd.TransaccionId = tp.TransaccionId) AS Pesadas
    FROM TransaccionesProduccion tp WHERE tp.ClasePT = ?`, MAL);
  console.log("TRANSACCIONES:", JSON.stringify(trans, (_k, v) => typeof v === "bigint" ? String(v) : v));

  await p.$transaction(async (tx) => {
    const ins = await tx.$executeRawUnsafe(`
      INSERT INTO Clase (Clase, Familia, Proceso, Descripcion, TipoClase, Activo)
      SELECT ?, Familia, Proceso, Descripcion, TipoClase, Activo FROM Clase WHERE Clase = ?`, BIEN, MAL);
    if (ins !== 1) throw new Error(`INSERT afectó ${ins} filas, esperaba 1`);
    const upd = await tx.$executeRawUnsafe(
      `UPDATE TransaccionesProduccion SET ClasePT = ? WHERE ClasePT = ?`, BIEN, MAL);
    if (upd !== usosMovibles) throw new Error(`UPDATE afectó ${upd} filas, esperaba ${usosMovibles}`);
    const del = await tx.$executeRawUnsafe(`DELETE FROM Clase WHERE Clase = ?`, MAL);
    if (del !== 1) throw new Error(`DELETE afectó ${del} filas, esperaba 1`);
  });

  const despues: any[] = await p.$queryRawUnsafe(`SELECT * FROM Clase WHERE Clase IN (?, ?)`, MAL, BIEN);
  console.log("DESPUES:", JSON.stringify(despues));
  await p.$disconnect();
}

main().catch(async e => { console.error("ERROR:", e.message); await p.$disconnect(); process.exit(1); });
