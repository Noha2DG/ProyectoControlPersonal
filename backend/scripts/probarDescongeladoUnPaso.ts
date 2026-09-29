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
import { devolverDelPiso, auxiliaresDeHoja, finDesdeHora, inicioSugerido, reporteJornada } from "../src/routes/descongelado.ts";

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
    // El mismo margen que los endpoints: la prueba corre contra la base de la planta desde otra
    // máquina, y con 5 s —  el valor por omisión de Prisma—  un día de red lenta la tumba sin que el
    // código tenga nada que ver.
    }, { timeout: 30000, maxWait: 15000 });
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
  // SE INFORMA, NO SE EXIGE. Este tiempo mide la latencia de la máquina que corre la prueba hasta
  // la base —  110 a 220 ms por consulta desde una PC de oficina—  más las consultas de verificación
  // que el endpoint no hace. Exigirlo daba una prueba que fallaba los días de red lenta (7.6 s una
  // vez, 2.5 s la siguiente) sin que el código cambiara. En producción el backend corre junto a la
  // base y estas mismas consultas tardan milisegundos.
  console.log(`      ${N} líneas en lote: ${tardo} ms desde esta máquina (informativo)`);

  // ── DEVOLVER A BODEGA: el círculo completo.
  //
  // Devolver toca los DOS inventarios, y ahí está todo el riesgo: el piso cuenta kilos por lote y
  // bodega cuenta cajas con QR. Si solo se mueve uno de los dos, el producto se duplica o se
  // evapora — la versión vieja escribía solo el renglón del piso, y encima sin su consumo, así que
  // los masters se quedaban 'Salido' sin polín que posicionar y la hoja no volvía a cerrar nunca.
  //
  // Esta fase llama a devolverDelPiso() de verdad, no a una réplica de sus consultas: una prueba
  // que copia el SQL prueba la copia.
  const rem = await uno(prisma, `
    SELECT rd.RemisionId, r.Folio, COUNT(*) AS Cajas
      FROM RemisionDetalle rd
      JOIN Remisiones r ON r.RemisionId = rd.RemisionId AND r.Estatus = 'Confirmada'
      JOIN Masters m ON m.MasterId = rd.MasterId AND m.Estatus = 'Salido'
      JOIN Areas a ON a.Codigo = r.AreaDestino
     WHERE rd.Vigente = 1 AND a.BodegaVirtualCodigo = 'DESCONGELADO'
       AND DATEDIFF(CURDATE(), DATE(r.ConfirmadaEn)) <= 4
     GROUP BY rd.RemisionId, r.Folio
     HAVING COUNT(*) >= 2
     ORDER BY rd.RemisionId DESC LIMIT 1`);

  if (!rem) {
    console.log("\n(sin remisión confirmada dentro del plazo con cajas devolvibles: se salta la fase de devolución)");
  } else {
    bien(`hay una remisión de la que devolver: ${rem.Folio} con ${Number(rem.Cajas)} cajas al piso`);

    // Dos cajas de un mismo lote que SIGA teniendo saldo al piso: devolver algo ya descongelado
    // tiene que fallar, y eso se prueba aparte.
    const cajas = await prisma.$queryRawUnsafe(`
      SELECT m.MasterId, m.PalletId, ei.Correlativo, oe.Lote, dp.Clase, dp.Talla
        FROM RemisionDetalle rd
        JOIN Masters m ON m.MasterId = rd.MasterId
        JOIN EtiquetaImpresa ei ON ei.EtiquetaId = m.EtiquetaId
        JOIN OrdenEtiquetado oe ON oe.OrdenId = ei.OrdenId
        JOIN DetallePedido dp ON dp.DetalleId = oe.DetalleId
       WHERE rd.RemisionId = ? AND rd.Vigente = 1 AND m.Estatus = 'Salido'
       ORDER BY oe.Lote, ei.Correlativo LIMIT 2`, Number(rem.RemisionId)) as any[];
    const ids = cajas.map((c: any) => Number(c.MasterId));

    const pisoAntes = await saldoDe(prisma, "DESCONGELADO");
    const polinesAntes = Number((await uno(prisma, `SELECT COUNT(*) AS n FROM Pallets`)).n);

    try {
      await prisma.$transaction(async (tx) => {
        await abrirHoja(tx);
        const cuadre = async () => {
          const c = await uno(tx, `
            SELECT ROUND(COALESCE(SUM(CASE WHEN HojaDestinoId = ? THEN PesoKg ELSE 0 END), 0), 2) AS Entro,
                   ROUND(COALESCE(SUM(CASE WHEN HojaOrigenId  = ? THEN PesoKg ELSE 0 END), 0), 2) AS Salio
              FROM MovimientoPiso WHERE HojaDestinoId = ? OR HojaOrigenId = ?`,
            hoja.HojaId, hoja.HojaId, hoja.HojaId, hoja.HojaId);
          return Number((Number(c.Entro) - Number(c.Salio)).toFixed(2));
        };
        const mermaAntes = await cuadre();

        const out: any = await devolverDelPiso(tx, {
          hojaId: hoja.HojaId, masters: ids, motivo: "prueba automatizada", operador: "prueba", esAdmin: false,
        });
        check(out.Masters === ids.length, `devolvió las ${ids.length} cajas y abrió el polín ${out.Polin}`);

        // ── Bodega: las cajas están de vuelta, con su correlativo, en un polín sin posición.
        const vueltos = await uno(tx, `
          SELECT COUNT(*) AS n, SUM(CASE WHEN PalletId = ? THEN 1 ELSE 0 END) AS EnElPolin
            FROM Masters WHERE MasterId IN (${ids.map(() => "?").join(",")}) AND Estatus = 'EnBodega'`,
          out.PalletId, ...ids);
        check(Number(vueltos.n) === ids.length && Number(vueltos.EnElPolin) === ids.length,
          `las ${ids.length} cajas volvieron a EnBodega dentro de ${out.Polin}`);

        const pol = await uno(tx,
          `SELECT Origen, Estatus, PosicionId, CantidadMaster FROM Pallets WHERE PalletId = ?`, out.PalletId);
        check(pol.Origen === "DEVOLUCION" && pol.PosicionId == null,
          `el polín nace Origen=${pol.Origen}, ${pol.Estatus} y SIN posición — que es la señal para bodega`);
        check(Number(pol.CantidadMaster) === ids.length,
          `su cuadre cierra al 100 %: declara ${pol.CantidadMaster} de ${ids.length}`);

        const fuera = await uno(tx,
          `SELECT COUNT(*) AS n FROM RemisionDetalle
            WHERE MasterId IN (${ids.map(() => "?").join(",")}) AND Vigente = 1`, ...ids);
        check(Number(fuera.n) === 0, "las cajas salieron de la remisión (Vigente = NULL)");

        const kardex = await uno(tx,
          `SELECT COUNT(*) AS n FROM MovimientosBodega
            WHERE Tipo = 'DEVOLUCION' AND PalletId = ?`, out.PalletId);
        check(Number(kardex.n) === ids.length, `el kardex de bodega registra las ${ids.length} devoluciones`);

        // ── Piso: los kilos salieron, y la hoja no quedó descuadrada.
        const pisoAhora = await saldoDe(tx, "DESCONGELADO");
        check(Math.abs((pisoAntes - pisoAhora) - Number(out.KgDevuelto)) < 0.05,
          `el piso bajó los ${out.KgDevuelto} kg devueltos (bajó ${(pisoAntes - pisoAhora).toFixed(2)})`);
        const mermaDespues = await cuadre();
        check(Math.abs(mermaDespues - mermaAntes) < 0.005,
          `devolver no movió la merma de la hoja (${mermaAntes} → ${mermaDespues})`);

        // ── Y no se puede devolver dos veces la misma caja.
        let rebotó = false;
        try {
          await devolverDelPiso(tx, { hojaId: hoja.HojaId, masters: ids, motivo: "doble", operador: "prueba", esAdmin: false });
        } catch (e: any) { rebotó = /ya no está Salido/.test(e.message); }
        check(rebotó, "devolver la misma caja dos veces se rechaza");

        throw new Error("ROLLBACK");
      }, { timeout: 30000, maxWait: 15000 });
    } catch (e: any) {
      if (!e.message.includes("ROLLBACK")) throw e;
    }

    check(Math.abs(await saldoDe(prisma, "DESCONGELADO") - pisoAntes) < 0.005,
      "al revertir, el piso queda como estaba");
    check(Number((await uno(prisma, `SELECT COUNT(*) AS n FROM Pallets`)).n) === polinesAntes,
      `al revertir, no quedó ningún polín de prueba: ${polinesAntes} polines`);
    const siguenFuera = await uno(prisma,
      `SELECT COUNT(*) AS n FROM Masters WHERE MasterId IN (${ids.map(() => "?").join(",")}) AND Estatus = 'Salido'`, ...ids);
    check(Number(siguenFuera.n) === ids.length, "al revertir, las cajas siguen Salidas como estaban");
  }

  // ── DOS TURNOS, DOS ENCARGADOS.
  //
  // Contar la gente por jornada metía al primer turno en la hoja del segundo. Cada hoja cuenta en SU
  // ventana, y las horas son el traslape de cada marcaje con ella. Se arma un día entero de marcajes
  // en una fecha lejana —  para que ningún marcaje real caiga adentro—  dentro de la transacción
  // que revierte:
  //
  //   turno A  06:00–14:00  encargado E1        turno B  14:00–22:00  encargado E2
  //   P1 06:00–14:00  → A 480                   P3 14:30–21:30  → B 420
  //   P2 13:00–15:00  → A  60, B 60             E1 05:50–14:10  → encargado en A; B 10
  //   E2 13:55–22:00  → A   5; encargado en B   P4 22:00–03:00  → solo en el turno de noche
  check(finDesdeHora("2026-09-22 22:50:00", "03:10") === "2026-09-23 03:10:00",
    "un turno que empieza 22:50 y cierra 03:10 termina AL DÍA SIGUIENTE");
  check(finDesdeHora("2026-09-22 06:00:00", "14:00") === "2026-09-22 14:00:00",
    "un turno de día cierra el mismo día");
  check(finDesdeHora("2026-12-31 23:00:00", "01:00") === "2027-01-01 01:00:00",
    "el cruce de medianoche también cruza el año");

  const emp: any[] = await prisma.$queryRawUnsafe(
    `SELECT Codigo FROM Empleados WHERE Estado = 'Activo' ORDER BY Codigo LIMIT 6`);
  if (emp.length < 6) {
    console.log("\n(menos de 6 empleados activos: se salta la fase de turnos)");
  } else {
    const [E1, E2, P1, P2, P3, P4] = emp.map((e: any) => String(e.Codigo));
    const D = "2031-01-15", N = "2031-01-16";
    try {
      await prisma.$transaction(async (tx) => {
        const hoja = async (ini: string, enc: string) => {
          await tx.$executeRawUnsafe(
            `INSERT INTO HojaProceso (BodegaCodigo, FechaProduccion, HoraInicio, Propiedad, Encargado, Estatus, CreadoPor)
             VALUES ('DESCONGELADO', ?, ?, 'OROPSA', ?, 'Abierta', 'prueba')`, D, ini, enc);
          return Number((await uno(tx, `SELECT LAST_INSERT_ID() AS id`)).id);
        };
        const marca = (cod: string, de: string, a: string) => tx.$executeRawUnsafe(
          `INSERT INTO Transferencias (Codigo, CodigoArea, FechaHora, FechaSalida, RegistradoPor)
           VALUES (?, 'DF', ?, ?, 'prueba')`, cod, de, a);

        const A = await hoja(`${D} 06:00:00`, E1);
        const B = await hoja(`${D} 14:00:00`, E2);
        const C = await hoja(`${D} 22:00:00`, E1);
        await marca(P1, `${D} 06:00:00`, `${D} 14:00:00`);
        await marca(P2, `${D} 13:00:00`, `${D} 15:00:00`);
        await marca(P3, `${D} 14:30:00`, `${D} 21:30:00`);
        await marca(E1, `${D} 05:50:00`, `${D} 14:10:00`);
        await marca(E2, `${D} 13:55:00`, `${D} 22:00:00`);
        await marca(P4, `${D} 22:00:00`, `${N} 03:00:00`);

        const a: any = await auxiliaresDeHoja(tx, A, "14:00");
        const b: any = await auxiliaresDeHoja(tx, B, "22:00");
        const c: any = await auxiliaresDeHoja(tx, C, "03:00");
        const quien = (x: any) => x.lista.map((r: any) => `${r.Codigo}:${r.Minutos}`).join(" ");

        check(a.Personas === 3 && a.Minutos === 545,
          `turno A: 3 auxiliares, 9.08 h (${a.Personas} personas, ${a.Minutos} min — ${quien(a)})`);
        check(!a.lista.some((r: any) => r.Codigo === E1), "el encargado de A no cuenta como auxiliar de A");
        check(b.Personas === 3 && b.Minutos === 490,
          `turno B: 3 auxiliares, 8.17 h (${b.Personas} personas, ${b.Minutos} min — ${quien(b)})`);
        check(!b.lista.some((r: any) => r.Codigo === P1),
          "quien solo trabajó el turno A NO aparece en la hoja del turno B");
        const p2 = (x: any) => x.lista.find((r: any) => r.Codigo === P2)?.Minutos;
        check(p2(a) === 60 && p2(b) === 60, "quien cruzó el cambio de turno reparte sus horas: 1 h en cada hoja");
        check(c.Personas === 1 && c.Minutos === 300 && c.Hasta === `${N} 03:00`,
          `el turno de noche termina al día siguiente y cuenta 5 h (${c.Hasta}, ${c.Minutos} min)`);

        // ── La hoja #49: el turno empezó con el primer marcaje, pero la hoja se abrió cuando se
        // capturó el primer descongelado, horas después. Con la ventana arrancando ahí, el cierre
        // contaba cero. Se simula el turno A abierto en el sistema a las 13:00.
        const tarde = await hoja(`${D} 13:00:00`, E1);
        const t: any = await auxiliaresDeHoja(tx, tarde, "14:00");
        check(t.Minutos < a.Minutos,
          `abierta tarde (13:00), la hoja solo ve ${t.Minutos} min de los ${a.Minutos} del turno`);
        check(t.InicioSugerido?.Hora === "05:50" && /primer marcaje/.test(t.InicioSugerido?.Motivo),
          `y lo avisa: sugiere empezar a las ${t.InicioSugerido?.Hora} (${t.InicioSugerido?.Motivo})`);
        const corregida: any = await auxiliaresDeHoja(tx, tarde, "14:00", "05:50");
        check(corregida.Personas === 3 && corregida.Minutos === 545,
          `con el inicio corregido cuenta el turno entero: ${corregida.Personas} auxiliares, ${corregida.Minutos} min`);
        check(corregida.InicioSugerido == null, "ya corregida, deja de sugerir");

        // Cerrado el turno A, el turno siguiente empieza donde terminó: no en el primer marcaje del día.
        await tx.$executeRawUnsafe(
          `UPDATE HojaProceso SET Estatus = 'Cerrada', HoraFin = ? WHERE HojaId = ?`, `${D} 14:00:00`, A);
        const sigB: any = await inicioSugerido(tx, "DESCONGELADO", D, B);
        check(sigB?.Inicio === `${D} 14:00:00` && /turno anterior/.test(sigB?.Motivo),
          `el turno B arranca en el cierre del A: ${sigB?.Inicio?.slice(11, 16)} (${sigB?.Motivo})`);

        throw new Error("ROLLBACK");
      }, { timeout: 30000, maxWait: 15000 });
    } catch (e: any) {
      if (!e.message.includes("ROLLBACK")) throw e;
    }
    const resto = await uno(prisma, `SELECT COUNT(*) AS n FROM Transferencias WHERE FechaHora >= '2031-01-01'`);
    check(Number(resto.n) === 0, "los marcajes de prueba no quedaron en la base");
  }

  // ── EL REPORTE DE LA JORNADA CUADRA, en los últimos días con movimiento real.
  //   al piso al iniciar + recibido − bajado = queda al piso, y lo bajado = descongelado + devuelto.
  // Y la continuidad: lo que queda al piso un día es con lo que arranca el siguiente.
  const dias: any[] = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT DATE_FORMAT(FechaProduccion, '%Y-%m-%d') AS f FROM MovimientoPiso
     WHERE BodegaDestino = 'DESCONGELADO' OR BodegaOrigen = 'DESCONGELADO'
     ORDER BY f DESC LIMIT 3`);

  for (const { f } of [...dias].reverse()) {
    const T = (await reporteJornada("DESCONGELADO", f)).Totales;
    check(Math.abs(T.InicioKg + T.RecibidoKg - T.BajadoKg - T.AlPisoKg) < 0.05,
      `reporte ${f}: ${T.InicioKg} + ${T.RecibidoKg} − ${T.BajadoKg} = ${T.AlPisoKg} al piso`);
    check(Math.abs(T.BajadoKg - (T.DescongeladoDeclaradoKg + T.DevueltoKg)) < 0.05,
      `reporte ${f}: lo bajado (${T.BajadoKg}) es descongelado ${T.DescongeladoDeclaradoKg} + devuelto ${T.DevueltoKg}`);

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
