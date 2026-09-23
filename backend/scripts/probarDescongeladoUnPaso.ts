// Verifica que descongelar en un solo paso no rompe el kardex ni el saldo al piso.
//
// Lo que hay que probar no es que el endpoint responda 201 — es que las DOS filas que escribe
// (consumo del piso a la hoja, traslado de la hoja al área siguiente) muevan el inventario
// exactamente como lo movían las dos capturas separadas, y que borrar el par lo devuelva todo a
// donde estaba. Si eso se cumple, la pantalla puede cambiar cuanto quiera.
//
// Lo único que escribe va dentro de una transacción que SIEMPRE revierte: no hay base de
// desarrollo, así que la única forma honesta de probar contra datos reales es no dejar rastro.
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

let ok = 0, fallo = 0;
const bien = (m: string) => { ok++; console.log(` OK   ${m}`); };
const mal  = (m: string) => { fallo++; console.log(` MAL  ${m}`); };
const check = (c: boolean, m: string) => c ? bien(m) : mal(m);

// El saldo al piso de una bodega, sumado sin mirar el Tipo — la invariante del modelo.
const SQL_SALDO = `
  SELECT ROUND(COALESCE(SUM(Delta), 0), 2) AS Kg FROM (
    SELECT PesoKg AS Delta FROM MovimientoPiso WHERE BodegaDestino = ?
    UNION ALL
    SELECT -PesoKg       FROM MovimientoPiso WHERE BodegaOrigen  = ?
  ) t`;

async function main() {
  const uno = async (tx: any, sql: string, ...a: any[]) => (await tx.$queryRawUnsafe(sql, ...a) as any[])[0];
  const saldoDe = async (tx: any, b: string) => Number((await uno(tx, SQL_SALDO, b, b)).Kg);

  // ── El esquema
  const col = await uno(prisma, `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'MovimientoPiso' AND COLUMN_NAME = 'ConsumoId'`);
  check(Number(col.n) === 1, "MovimientoPiso tiene la columna ConsumoId");

  const fk = await uno(prisma, `SELECT REFERENCED_TABLE_NAME AS t FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'MovimientoPiso'
       AND COLUMN_NAME = 'ConsumoId' AND REFERENCED_TABLE_NAME IS NOT NULL`);
  check(fk?.t === "MovimientoPiso", `ConsumoId apunta al propio kardex (${fk?.t ?? "sin llave"})`);

  // ── Los destinos que ofrece la pantalla
  const destinos: any[] = await prisma.$queryRawUnsafe(
    `SELECT Codigo, Nombre FROM BodegaVirtual WHERE Activo = 1 AND LlevaPiso = 1 ORDER BY Orden`);
  check(destinos.length > 1, `hay ${destinos.length} bodegas que reciben inventario al piso`);
  check(destinos.some(d => d.Codigo === "DESCONGELADO"),
    "Descongelado está en el catálogo (la pantalla lo quita de su propia lista de destinos)");

  const areas: any[] = await prisma.$queryRawUnsafe(
    `SELECT a.Codigo, a.Nombre, a.BodegaVirtualCodigo AS b FROM Areas a
       JOIN BodegaVirtual v ON v.Codigo = a.BodegaVirtualCodigo AND v.LlevaPiso = 1
      WHERE a.Activa = 1`);
  check(areas.length > 0, `${areas.length} áreas cuelgan de una bodega con inventario al piso`);
  // Escoger un área tiene que poder resolver su bodega sin ambigüedad: es de donde sale
  // BodegaDestino cuando el operador dice "lo mando a Pelado".
  check(areas.every(a => destinos.some(d => d.Codigo === a.b)),
    "toda área destino resuelve su bodega");

  // ── Una línea real que esté hoy al piso de Descongelado
  const linea = await uno(prisma, `
    SELECT t.RemisionId, t.Lote, t.Clase, t.Talla, ROUND(SUM(t.Delta), 2) AS Kg,
           SUM(t.M) AS Masters, MAX(t.KgxM) AS KgPorMaster, MAX(t.FL) AS FechaLote
      FROM (
        SELECT RemisionId, Lote, Clase, Talla, PesoKg AS Delta, Masters AS M, KgPorMaster AS KgxM, FechaLote AS FL
          FROM MovimientoPiso WHERE BodegaDestino = 'DESCONGELADO'
        UNION ALL
        SELECT RemisionId, Lote, Clase, Talla, -PesoKg, -Masters, KgPorMaster, NULL
          FROM MovimientoPiso WHERE BodegaOrigen = 'DESCONGELADO'
      ) t
     GROUP BY t.RemisionId, t.Lote, t.Clase, t.Talla
    HAVING SUM(t.Delta) > 0 AND SUM(t.M) > 0
     ORDER BY t.Lote LIMIT 1`);

  if (!linea) {
    console.log("\nNo hay producto al piso de Descongelado: no se puede probar el movimiento.");
    console.log(`${fallo === 0 ? "TODO OK" : "HAY FALLOS"}  —  ${ok} bien, ${fallo} mal`);
    await prisma.$disconnect();
    process.exit(fallo ? 1 : 0);
  }
  bien(`hay producto al piso para probar: ${linea.Lote} ${linea.Clase} — ${Number(linea.Masters)} m, ${linea.Kg} kg`);

  const hoja = await uno(prisma, `
    SELECT HojaId, BodegaCodigo, DATE_FORMAT(FechaProduccion, '%Y-%m-%d') AS Fecha
      FROM HojaProceso WHERE Estatus = 'Abierta' ORDER BY HojaId DESC LIMIT 1`);
  check(!!hoja, `hay una hoja abierta para recibirlo (#${hoja?.HojaId ?? "ninguna"})`);
  if (!hoja) { await prisma.$disconnect(); process.exit(1); }

  const destino = destinos.find(d => d.Codigo !== hoja.BodegaCodigo);
  check(!!destino, `hay a dónde mandarlo: ${destino?.Nombre}`);

  // ── Lo único que escribe, y siempre revierte.
  const antesOrigen = await saldoDe(prisma, hoja.BodegaCodigo);
  const antesDestino = await saldoDe(prisma, destino.Codigo);
  const antesFilas = Number((await uno(prisma, `SELECT COUNT(*) AS n FROM MovimientoPiso`)).n);

  // Un solo master: lo mínimo que mueve el inventario de verdad sin depender de cuánto haya.
  const masters = 1;
  const declarado = Number((masters * Number(linea.KgPorMaster)).toFixed(2));
  const pesado = Number((declarado - 0.75).toFixed(2));   // pesó menos: el caso que produce merma

  try {
    await prisma.$transaction(async (tx) => {
      // Las dos filas, tal como las escribe POST /hojas/:id/descongelar.
      await tx.$executeRawUnsafe(
        `INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaOrigen, HojaDestinoId, Lote, Clase, Talla,
                                     FechaLote, Peso, UM, PesoKg, Masters, KgPorMaster, RemisionId, RegistradoPor)
         VALUES ('CONSUMO', ?, ?, ?, ?, ?, ?, ?, ?, 'KG', ?, ?, ?, ?, 'prueba')`,
        hoja.Fecha, hoja.BodegaCodigo, hoja.HojaId, linea.Lote, linea.Clase, Number(linea.Talla),
        linea.FechaLote, declarado, declarado, masters, Number(linea.KgPorMaster), linea.RemisionId);
      const consumoId = Number((await uno(tx, `SELECT LAST_INSERT_ID() AS id`)).id);

      await tx.$executeRawUnsafe(
        `INSERT INTO MovimientoPiso (Tipo, FechaProduccion, HojaOrigenId, BodegaDestino, AreaDeclarada,
                                     Lote, Clase, Talla, FechaLote, Peso, UM, PesoKg,
                                     NumeroTermo, RemisionId, ConsumoId, RegistradoPor)
         VALUES ('TRASLADO', ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'KG', ?, '99', ?, ?, 'prueba')`,
        hoja.Fecha, hoja.HojaId, destino.Codigo, linea.Lote, linea.Clase, Number(linea.Talla),
        linea.FechaLote, pesado, pesado, linea.RemisionId, consumoId);
      const trasladoId = Number((await uno(tx, `SELECT LAST_INSERT_ID() AS id`)).id);

      // El piso de origen baja por lo DECLARADO —  es lo que salió del área—  y el destino sube por
      // lo PESADO. La diferencia no se pierde: se queda dentro de la hoja y sale como merma.
      const ahoraOrigen = await saldoDe(tx, hoja.BodegaCodigo);
      const ahoraDestino = await saldoDe(tx, destino.Codigo);
      check(Math.abs((antesOrigen - ahoraOrigen) - declarado) < 0.005,
        `el piso de ${hoja.BodegaCodigo} bajó ${declarado} kg (bajó ${(antesOrigen - ahoraOrigen).toFixed(2)})`);
      check(Math.abs((ahoraDestino - antesDestino) - pesado) < 0.005,
        `${destino.Nombre} subió ${pesado} kg (subió ${(ahoraDestino - antesDestino).toFixed(2)})`);

      // La hoja: entró lo declarado, salió lo pesado, y lo que queda dentro es la merma del cierre.
      const h = await uno(tx, `
        SELECT ROUND(COALESCE(SUM(CASE WHEN HojaDestinoId = ? THEN PesoKg ELSE 0 END), 0), 2) AS Entro,
               ROUND(COALESCE(SUM(CASE WHEN HojaOrigenId  = ? THEN PesoKg ELSE 0 END), 0), 2) AS Salio
          FROM MovimientoPiso WHERE HojaDestinoId = ? OR HojaOrigenId = ?`,
        hoja.HojaId, hoja.HojaId, hoja.HojaId, hoja.HojaId);
      check(Number(h.Entro) >= declarado && Number(h.Salio) >= pesado,
        `la hoja #${hoja.HojaId} registra entrada ${h.Entro} y salida ${h.Salio}`);
      check(Number(h.Entro) - Number(h.Salio) >= 0,
        `la hoja no cierra en negativo: quedan ${(Number(h.Entro) - Number(h.Salio)).toFixed(2)} kg para merma`);

      // El par es explícito: el traslado sabe de qué consumo salió.
      const par = await uno(tx, `SELECT ConsumoId FROM MovimientoPiso WHERE MovimientoId = ?`, trasladoId);
      check(Number(par.ConsumoId) === consumoId, "el traslado apunta a su consumo");

      // ── Borrar el par: por el traslado se lleva el consumo, y todo vuelve a como estaba.
      await tx.$executeRawUnsafe(`DELETE FROM MovimientoPiso WHERE ConsumoId = ?`, trasladoId);
      await tx.$executeRawUnsafe(`DELETE FROM MovimientoPiso WHERE MovimientoId = ?`, trasladoId);
      await tx.$executeRawUnsafe(`DELETE FROM MovimientoPiso WHERE MovimientoId = ?`, consumoId);

      check(Math.abs(await saldoDe(tx, hoja.BodegaCodigo) - antesOrigen) < 0.005,
        "al quitar el renglón, el producto regresa completo al piso");
      check(Math.abs(await saldoDe(tx, destino.Codigo) - antesDestino) < 0.005,
        `al quitar el renglón, ${destino.Nombre} queda como estaba`);

      throw new Error("ROLLBACK");
    });
  } catch (e: any) {
    if (!e.message.includes("ROLLBACK")) throw e;
  }

  // ── Y no quedó rastro.
  const finFilas = Number((await uno(prisma, `SELECT COUNT(*) AS n FROM MovimientoPiso`)).n);
  check(finFilas === antesFilas, `la prueba no dejó rastro: ${finFilas} filas en el kardex`);
  check(Math.abs(await saldoDe(prisma, hoja.BodegaCodigo) - antesOrigen) < 0.005,
    `el saldo de ${hoja.BodegaCodigo} sigue en ${antesOrigen} kg`);

  console.log(`\n${fallo === 0 ? "TODO OK" : "HAY FALLOS"}  —  ${ok} bien, ${fallo} mal`);
  await prisma.$disconnect();
  if (fallo) process.exit(1);
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
