// Prueba de Descongelado por termo (llenarTermo / corregirTermo / quitarTermo en routes/descongelado.ts)
// contra la base real, dentro de una transacción que SIEMPRE se revierte: no queda nada escrito.
//
// Monta su propio piso de Descongelado con lotes ZZ (dos de entero C20 de remisiones distintas y uno de
// cola D30) y una hoja de 2030.
//
//   npx tsx scripts/probarDescongeladoTermo.ts
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";
import { llenarTermo, corregirTermo, quitarTermo } from "../src/routes/descongelado.ts";

const OP = "prueba-termo";
const HOY = "2030-01-07";
let ok = 0, mal = 0;
const check = (c: boolean, m: string) => { c ? ok++ : mal++; console.log(c ? "  OK " : "  MAL", m); };
async function falla(f: () => Promise<any>, patron: RegExp, m: string) {
  try { await f(); check(false, `${m} (no falló)`); }
  catch (e: any) { check(patron.test(e.message), `${m}: ${e.message}`); }
}
class Revertir extends Error {}

(async () => {
  const rems: any[] = await prisma.$queryRawUnsafe(`SELECT RemisionId FROM Remisiones ORDER BY RemisionId DESC LIMIT 2`);
  const [R1, R2] = rems.map(r => Number(r.RemisionId));
  const A = { RemisionId: R1, Lote: "ZZ1EM03-E01-7", Clase: "C20", Talla: 229, FechaLote: "2030-01-01", KgPorMaster: 5.448 };
  const B = { RemisionId: R2, Lote: "ZZ2TM04-E02-7", Clase: "C20", Talla: 233, FechaLote: "2030-01-02", KgPorMaster: 5.448 };
  const C = { RemisionId: R1, Lote: "ZZ3EM00-E00",   Clase: "D30", Talla: 326, FechaLote: "2030-01-03", KgPorMaster: 9.07 };

  try {
    await prisma.$transaction(async (tx) => {
      for (const [l, m] of [[A, 10], [B, 4], [C, 3]] as const) {
        const kg = Number((m * l.KgPorMaster).toFixed(2));
        await tx.$executeRawUnsafe(`
          INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaDestino, RemisionId, Lote, Clase, Talla, FechaLote,
                                      Peso, UM, PesoKg, Masters, KgPorMaster, RegistradoPor)
          VALUES ('INGRESO', ?, 'DESCONGELADO', ?, ?, ?, ?, ?, ?, 'KG', ?, ?, ?, ?)`,
          HOY, l.RemisionId, l.Lote, l.Clase, l.Talla, l.FechaLote, kg, kg, m, l.KgPorMaster, OP);
      }
      await tx.$executeRawUnsafe(`INSERT INTO HojaProceso (BodegaCodigo, FechaProduccion, CreadoPor) VALUES ('DESCONGELADO', ?, ?)`, HOY, OP);
      const [h]: any[] = await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`);
      const hoja = Number(h.id);
      const piso = async (bodega: string, l: any) => {
        const [s]: any[] = await tx.$queryRawUnsafe(`
          SELECT ROUND(COALESCE(SUM(CASE WHEN BodegaDestino = ? THEN PesoKg ELSE -PesoKg END), 0), 2) AS Kg,
                 COALESCE(SUM(CASE WHEN BodegaDestino = ? THEN Masters ELSE -Masters END), 0) AS M
            FROM MovimientoPiso WHERE (BodegaDestino = ? OR BodegaOrigen = ?) AND Lote = ? AND Clase = ? AND RemisionId <=> ?`,
          bodega, bodega, bodega, bodega, l.Lote, l.Clase, l.RemisionId);
        return { kg: Number(s.Kg), m: Number(s.M) };
      };
      const lin = (l: any, Masters: number) => ({ ...l, Masters, UM: "KG" });

      console.log("1. Reglas del termo");
      await falla(() => llenarTermo(tx, hoja, { NumeroTermo: "12", PesoReal: 50, BodegaDestino: "DESCABEZADO", lineas: [lin(A, 2), lin(C, 1)] }, OP),
        /no se mezclan productos distintos: C20 y D30/, "un C20 con un D30 no van en el mismo termo");
      await falla(() => llenarTermo(tx, hoja, { NumeroTermo: "", PesoReal: 50, BodegaDestino: "DESCABEZADO", lineas: [lin(A, 2)] }, OP),
        /Falta el número de termo/, "el número de termo es obligatorio");
      await falla(() => llenarTermo(tx, hoja, { NumeroTermo: "12", PesoReal: "", BodegaDestino: "DESCABEZADO", lineas: [lin(A, 2)] }, OP),
        /Falta el peso de báscula/, "el peso de báscula es obligatorio");
      await falla(() => llenarTermo(tx, hoja, { NumeroTermo: "12", PesoReal: 50, BodegaDestino: "", lineas: [lin(A, 2)] }, OP),
        /a dónde va/, "el destino es obligatorio");
      await falla(() => llenarTermo(tx, hoja, { NumeroTermo: "12", PesoReal: 50, BodegaDestino: "DESCABEZADO", lineas: [lin(A, 11)] }, OP),
        /solo quedan 10 masters/, "no se bajan más masters de los que hay al piso");

      console.log("2. Un termo con dos lotes de dos remisiones");
      const t12 = await llenarTermo(tx, hoja, { NumeroTermo: "12", PesoReal: 52, BodegaDestino: "DESCABEZADO", lineas: [lin(A, 6), lin(B, 4)] }, OP);
      const tr: any[] = await tx.$queryRawUnsafe(
        `SELECT Lote, PesoKg, NumeroTermo, TermoOrigenId FROM MovimientoPiso WHERE HojaOrigenId = ? AND Tipo = 'TRASLADO' ORDER BY MovimientoId`, hoja);
      const pA = Number(tr.find(t => t.Lote === A.Lote).PesoKg), pB = Number(tr.find(t => t.Lote === B.Lote).PesoKg);
      check(t12.KgDeclarado === 54.48 && pA === 31.2 && pB === 20.8 && Number((pA + pB).toFixed(2)) === 52,
        `los 52 kg de la báscula se reparten por lo declarado (32.69 y 21.79): ${pA} + ${pB}`);
      check(tr.every(t => t.NumeroTermo === "12" && Number(t.TermoOrigenId) === t12.TermoId), "los dos lotes quedan atados al mismo termo 12");
      check((await piso("DESCONGELADO", A)).m === 4 && (await piso("DESCONGELADO", B)).m === 0, "al piso quedan 4 masters de A (el lote no cupo completo) y nada de B");
      check((await piso("DESCABEZADO", A)).kg === 31.2 && (await piso("DESCABEZADO", B)).kg === 20.8, "en Descabezado cada lote llega con su código y su parte del peso");

      console.log("3. Canasta");
      await falla(() => llenarTermo(tx, hoja, { Recipiente: "CANASTA", PesoReal: 20, BodegaDestino: "DESCABEZADO", lineas: [lin(A, 2), lin(B, 0)] }, OP),
        /un solo lote/, "una canasta no lleva dos lotes");
      const can = await llenarTermo(tx, hoja, { Recipiente: "CANASTA", PesoReal: 26.5, BodegaDestino: "PELADO", lineas: [lin(C, 3)] }, OP);
      check(can.Termo === "Canasta" && (await piso("PELADO", C)).kg === 26.5, "la canasta de D30 va a Pelado sin número, con su lote original");

      console.log("4. Corregir y quitar el termo completo");
      await corregirTermo(tx, t12.TermoId, { NumeroTermo: "21", PesoReal: 54.48, BodegaDestino: "PELADO" });
      check((await piso("PELADO", A)).kg === 32.69 && (await piso("PELADO", B)).kg === 21.79 && (await piso("DESCABEZADO", A)).kg === 0,
        "corregir reparte otra vez el peso y mueve los dos lotes a Pelado");
      await tx.$executeRawUnsafe(`
        INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaOrigen, RemisionId, Lote, Clase, Talla, FechaLote, Peso, UM, PesoKg, RegistradoPor)
        VALUES ('DESTAJO', ?, 'PELADO', ?, ?, ?, ?, ?, 10, 'KG', 10, ?)`, HOY, A.RemisionId, A.Lote, A.Clase, A.Talla, A.FechaLote, OP);
      await falla(() => corregirTermo(tx, t12.TermoId, { NumeroTermo: "21", PesoReal: 50, BodegaDestino: "PELADO" }),
        /ya tomó/, "si Pelado ya tomó de ese lote, el termo no se corrige");
      await falla(() => quitarTermo(tx, t12.TermoId), /ya tomó/, "ni se quita");
      await quitarTermo(tx, can.TermoId);
      check((await piso("DESCONGELADO", C)).m === 3 && (await piso("PELADO", C)).kg === 0, "quitar la canasta devuelve sus 3 masters al piso de Descongelado");

      throw new Revertir();
    }, { timeout: 180000, maxWait: 15000 });
  } catch (e) {
    if (!(e instanceof Revertir)) { console.error("ERROR", (e as any).message); mal++; }
  }

  const [q]: any[] = await prisma.$queryRawUnsafe(
    `SELECT (SELECT COUNT(*) FROM MovimientoPiso WHERE RegistradoPor = ? OR Lote LIKE 'ZZ%') AS m,
            (SELECT COUNT(*) FROM HojaProceso WHERE CreadoPor = ?) AS h`, OP, OP);
  check(Number(q.m) === 0 && Number(q.h) === 0, "todo revertido: 0 movimientos y 0 hojas de prueba en la base");
  console.log(`\n${ok} OK, ${mal} MAL`);
  await prisma.$disconnect();
  if (mal) process.exitCode = 1;
})();
