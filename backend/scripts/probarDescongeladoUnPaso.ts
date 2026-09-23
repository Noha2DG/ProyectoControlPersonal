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

  // El destino es la bodega virtual y nada más: ninguna de las que solo existen como origen de
  // polín puede aparecer, porque ahí no se puede dejar producto a granel.
  const soloPolin: any[] = await prisma.$queryRawUnsafe(
    `SELECT Codigo FROM BodegaVirtual WHERE LlevaPiso = 0 AND Letra IS NOT NULL`);
  check(!destinos.some(d => soloPolin.some((p: any) => p.Codigo === d.Codigo)),
    `ninguna bodega de solo polín es destino (${soloPolin.map((p: any) => p.Codigo).join(", ") || "ninguna"})`);

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

  // La hoja se toma prestada si hay una abierta y, si no, se fabrica DENTRO de cada transacción,
  // que siempre revierte. Depender de que alguien haya dejado una abierta hacía que la prueba
  // fallara por el estado del día —  y falló—  en vez de por el código, que es lo único que debería
  // poder romperla.
  const hoja: any = { BodegaCodigo: "DESCONGELADO", Fecha: (await uno(prisma,
    `SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS d`)).d, HojaId: null };

  const abrirHoja = async (tx: any) => {
    const [h]: any[] = await tx.$queryRawUnsafe(
      `SELECT HojaId FROM HojaProceso WHERE Estatus = 'Abierta' AND BodegaCodigo = ?
        ORDER BY HojaId DESC LIMIT 1`, hoja.BodegaCodigo);
    if (h) { hoja.HojaId = Number(h.HojaId); return; }
    await tx.$executeRawUnsafe(
      `INSERT INTO HojaProceso (BodegaCodigo, FechaProduccion, Propiedad, Estatus, CreadoPor)
       VALUES (?, ?, 'OROPSA', 'Abierta', 'prueba')`, hoja.BodegaCodigo, hoja.Fecha);
    hoja.HojaId = Number((await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`) as any[])[0].id);
  };

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
      await abrirHoja(tx);
      // Las dos filas, tal como las escribe POST /hojas/:id/descongelar.
      await tx.$executeRawUnsafe(
        `INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaOrigen, HojaDestinoId, Lote, Clase, Talla,
                                     FechaLote, Peso, UM, PesoKg, Masters, KgPorMaster, RemisionId, RegistradoPor)
         VALUES ('CONSUMO', ?, ?, ?, ?, ?, ?, ?, ?, 'KG', ?, ?, ?, ?, 'prueba')`,
        hoja.Fecha, hoja.BodegaCodigo, hoja.HojaId, linea.Lote, linea.Clase, Number(linea.Talla),
        linea.FechaLote, declarado, declarado, masters, Number(linea.KgPorMaster), linea.RemisionId);
      const consumoId = Number((await uno(tx, `SELECT LAST_INSERT_ID() AS id`)).id);

      await tx.$executeRawUnsafe(
        `INSERT INTO MovimientoPiso (Tipo, FechaProduccion, HojaOrigenId, BodegaDestino,
                                     Lote, Clase, Talla, FechaLote, Peso, UM, PesoKg,
                                     NumeroTermo, RemisionId, ConsumoId, RegistradoPor)
         VALUES ('TRASLADO', ?, ?, ?, ?, ?, ?, ?, ?, 'KG', ?, '99', ?, ?, 'prueba')`,
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

  // ── UN DESPACHO GRANDE, EN LOTE.
  //
  // Es el caso que reventó en producción: diecinueve líneas con cinco consultas cada una son casi
  // cien viajes a la base dentro de una transacción que Prisma corta a los cinco segundos.
  //
  // Las líneas se FABRICAN acá dentro en vez de tomarlas del piso del día. Depender de lo que haya
  // en la planta hacía que la prueba midiera el inventario de hoy —  una mañana veintidós líneas,
  // otra una sola—  en vez del código; y el número de líneas es justo la variable que esta prueba
  // existe para estirar. Todo vive y muere dentro de la transacción que revierte.
  const N = 30;
  const [cl]: any[] = await prisma.$queryRawUnsafe(`SELECT Clase FROM Clase WHERE Activo = 1 LIMIT 1`);
  check(!!cl, `hay una clase válida para armar el despacho de prueba (${cl?.Clase})`);
  const KGXM = 18.1, MASTERS = 10;
  const sinteticas = Array.from({ length: N }, (_, i) => ({
    Lote: `ZZPRUEBA-${String(i + 1).padStart(3, "0")}`,
    Clase: cl.Clase, Talla: 900, Masters: MASTERS, KgPorMaster: KGXM,
    Kg: Number((MASTERS * KGXM).toFixed(2)),
  }));

  const arranque = Date.now();
  try {
    await prisma.$transaction(async (tx) => {
      await abrirHoja(tx);
      const maxAntes = Number((await uno(tx, `SELECT COALESCE(MAX(MovimientoId), 0) AS m FROM MovimientoPiso`)).m);

      // Primero el producto entra al piso, como lo mete una remisión confirmada.
      const argsI: any[] = [];
      const filasI = sinteticas.map(l => {
        argsI.push(hoja.Fecha, hoja.BodegaCodigo, l.Lote, l.Clase, l.Talla, l.Kg, l.Kg, l.Masters, l.KgPorMaster);
        return "('INGRESO',?,?,?,?,?,?,'KG',?,?,?,'prueba')";
      }).join(",");
      await tx.$executeRawUnsafe(
        `INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaDestino, Lote, Clase, Talla,
                                     Peso, UM, PesoKg, Masters, KgPorMaster, RegistradoPor)
         VALUES ${filasI}`, ...argsI);

      const traidoKg = Number((N * MASTERS * KGXM).toFixed(2));
      check(Math.abs((await saldoDe(tx, hoja.BodegaCodigo) - antesOrigen) - traidoKg) < 0.05,
        `entraron al piso ${N} líneas de prueba (${traidoKg} kg)`);

      // ── Y ahora el descongelado completo, con los dos INSERT del endpoint.
      const argsC: any[] = [];
      const filasC = sinteticas.map(l => {
        argsC.push(hoja.Fecha, hoja.BodegaCodigo, hoja.HojaId, l.Lote, l.Clase, l.Talla,
          l.Kg, l.Kg, l.Masters, l.KgPorMaster);
        return "('CONSUMO',?,?,?,?,?,?,?,'KG',?,?,?,'prueba')";
      }).join(",");
      await tx.$executeRawUnsafe(
        `INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaOrigen, HojaDestinoId, Lote, Clase, Talla,
                                     Peso, UM, PesoKg, Masters, KgPorMaster, RegistradoPor)
         VALUES ${filasC}`, ...argsC);

      // Se lee desde LAST_INSERT_ID(), que tras un INSERT de varias filas devuelve el id de la
      // PRIMERA — así el endpoint se ahorra preguntar el MAX antes de insertar, que era una ida y
      // vuelta entera. Que vengan los N ids es la prueba de que el piso es el correcto: si
      // LAST_INSERT_ID() devolviera el de la ÚLTIMA fila, acá vendría uno solo.
      const nuevos: any[] = await tx.$queryRawUnsafe(
        `SELECT MovimientoId FROM MovimientoPiso
          WHERE HojaDestinoId = ? AND Tipo = 'CONSUMO' AND MovimientoId >= LAST_INSERT_ID()
          ORDER BY MovimientoId`, hoja.HojaId);
      check(nuevos.length === N, `LAST_INSERT_ID() apunta a la primera fila: ${nuevos.length} ids de ${N} líneas`);

      const argsT: any[] = [];
      const filasT = sinteticas.map((l, i) => {
        const pesado = Number((l.Kg - 0.5).toFixed(2));   // pesó menos, que es lo normal
        argsT.push(hoja.Fecha, hoja.HojaId, destino.Codigo, l.Lote, l.Clase, l.Talla,
          pesado, pesado, Number(nuevos[i].MovimientoId));
        return "('TRASLADO',?,?,?,?,?,?,?,'KG',?,?,'prueba')";
      }).join(",");
      await tx.$executeRawUnsafe(
        `INSERT INTO MovimientoPiso (Tipo, FechaProduccion, HojaOrigenId, BodegaDestino, Lote, Clase, Talla,
                                     Peso, UM, PesoKg, ConsumoId, RegistradoPor)
         VALUES ${filasT}`, ...argsT);

      // LO QUE IMPORTA: cada traslado apunta al consumo del MISMO lote, clase y talla. Si el orden
      // de los ids no casara con el de las filas, los pares quedarían cruzados y borrar un renglón
      // se llevaría el consumo de otro producto — un error que el saldo total NO delataría, porque
      // los kilos cuadran igual. Los lotes sintéticos van numerados justamente para que un cruce
      // sea visible.
      const cruzados: any[] = await tx.$queryRawUnsafe(`
        SELECT COUNT(*) AS n FROM MovimientoPiso t
          JOIN MovimientoPiso c ON c.MovimientoId = t.ConsumoId
         WHERE t.HojaOrigenId = ? AND t.Tipo = 'TRASLADO' AND t.MovimientoId > ?
           AND (t.Lote <> c.Lote OR t.Clase <> c.Clase OR t.Talla <> c.Talla)`, hoja.HojaId, maxAntes);
      check(Number(cruzados[0].n) === 0, `ningún par quedó cruzado en ${N} líneas (${cruzados[0].n} cruces)`);

      const atados: any[] = await uno(tx,
        `SELECT COUNT(*) AS n FROM MovimientoPiso
          WHERE HojaOrigenId = ? AND Tipo = 'TRASLADO' AND ConsumoId IS NOT NULL AND MovimientoId > ?`,
        hoja.HojaId, maxAntes);
      check(Number(atados.n) === N, `los ${N} traslados quedaron atados a su consumo`);

      // El piso queda como estaba: entró el producto de prueba y salió completo hacia el destino.
      check(Math.abs(await saldoDe(tx, hoja.BodegaCodigo) - antesOrigen) < 0.05,
        "el piso vuelve a su saldo: lo que entró de prueba se descongeló completo");

      throw new Error("ROLLBACK");
    }, { timeout: 30000, maxWait: 15000 });
  } catch (e: any) {
    if (!e.message.includes("ROLLBACK")) throw e;
  }
  const tardo = Date.now() - arranque;
  // El límite viejo de Prisma era 5 s y es lo que rompía en pantalla. Que treinta líneas quepan con
  // holgura ahí es la prueba de que el arreglo fue quitar viajes, no solo agrandar el plazo: el
  // trabajo ya no depende de cuántas líneas trae el despacho.
  check(tardo < 5000, `${N} líneas en lote tardaron ${tardo} ms (antes reventaba a los 5000)`);

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
