// Corrección puntual (7 ago 2026): la transacción 479 del lote G532EM01-E03-7 se creó como E43
// (P&D T-OFF R) cuando el producto real es E41 (P&D T-OFF).
//
// TransaccionesProduccion guarda DOS columnas que dicen lo mismo: `ClasePT` (la Clase) y `Proceso`
// (el número de proceso, que Clase ya trae en su propia columna). La pantalla de Pesaje muestra
// "DescripcionProceso → ClasePT", donde la descripción sale de `Procesos` vía tp.Proceso — por eso
// cambiar solo ClasePT no se refleja en pantalla: hay que mover las dos, y este script las mueve
// juntas dentro de una misma transacción de BD.
//
// Los 33 pesajes ya registrados NO se tocan: PesajeDetalle apunta a TransaccionId, no a la Clase,
// así que los kilos siguen colgados de la misma transacción y solo cambia el Producto al que se le
// atribuyen. E41 y E43 son ambas Familia E, así que la validación Área↔Familia del pesaje (DS/DT)
// sigue dando el mismo resultado.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

const ID = 479;
const CLASE_ESPERADA = "E43";   // lo que hay hoy — si ya no está así, alguien más lo movió y no sigo
const CLASE_NUEVA = "E41";

async function main() {
  const antes: any[] = await p.$queryRawUnsafe(`
    SELECT tp.TransaccionId, tp.Lote, tp.ClaseOrigen, tp.Proceso, pr.Descripcion AS DescProceso,
           tp.ClasePT, cl.Descripcion AS DescClasePT, tp.Talla, tp.Estado,
           (SELECT COUNT(*) FROM PesajeDetalle pd WHERE pd.TransaccionId = tp.TransaccionId) AS Pesadas,
           (SELECT COALESCE(SUM(pd.Peso), 0) FROM PesajeDetalle pd WHERE pd.TransaccionId = tp.TransaccionId) AS Kilos
    FROM TransaccionesProduccion tp
    JOIN Procesos pr ON tp.Proceso = pr.Proceso
    JOIN Clase cl ON tp.ClasePT = cl.Clase
    WHERE tp.TransaccionId = ?`, ID);

  if (!antes.length) throw new Error(`No existe la transacción ${ID}`);
  console.log("ANTES:", JSON.stringify(antes[0], (_k, v) => typeof v === "bigint" ? String(v) : v));
  if (antes[0].ClasePT !== CLASE_ESPERADA) {
    throw new Error(`La transacción ${ID} ya no está en ${CLASE_ESPERADA} (está en ${antes[0].ClasePT}) — no la toco`);
  }

  // El Proceso nuevo se lee de la Clase, no se escribe a mano: es la Clase la que manda.
  const clase: any[] = await p.$queryRawUnsafe(`SELECT Clase, Proceso, Familia FROM Clase WHERE Clase = ?`, CLASE_NUEVA);
  if (!clase.length) throw new Error(`La clase ${CLASE_NUEVA} no existe`);
  if (clase[0].Familia !== "E") throw new Error(`${CLASE_NUEVA} no es Familia E — cambiaría el área que puede pesarla`);

  const filas = await p.$executeRawUnsafe(
    `UPDATE TransaccionesProduccion SET ClasePT = ?, Proceso = ? WHERE TransaccionId = ? AND ClasePT = ?`,
    CLASE_NUEVA, clase[0].Proceso, ID, CLASE_ESPERADA);
  if (filas !== 1) throw new Error(`El UPDATE afectó ${filas} filas, esperaba 1`);

  const despues: any[] = await p.$queryRawUnsafe(`
    SELECT tp.TransaccionId, tp.Proceso, pr.Descripcion AS DescProceso, tp.ClasePT, cl.Descripcion AS DescClasePT,
           (SELECT COUNT(*) FROM PesajeDetalle pd WHERE pd.TransaccionId = tp.TransaccionId) AS Pesadas,
           (SELECT COALESCE(SUM(pd.Peso), 0) FROM PesajeDetalle pd WHERE pd.TransaccionId = tp.TransaccionId) AS Kilos
    FROM TransaccionesProduccion tp
    JOIN Procesos pr ON tp.Proceso = pr.Proceso
    JOIN Clase cl ON tp.ClasePT = cl.Clase
    WHERE tp.TransaccionId = ?`, ID);
  console.log("DESPUES:", JSON.stringify(despues[0], (_k, v) => typeof v === "bigint" ? String(v) : v));

  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
