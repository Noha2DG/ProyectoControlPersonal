// Prueba: descongelar un lote que llegó con dos fechas de producción en la misma remisión
// (G433TM04-E04-6 en RS-0077: 77 masters del 13-ago y 48 del 1-sep). Contra la base real, dentro de
// una transacción que SIEMPRE se revierte.
//
// Antes del arreglo el consumo se anotaba con MAX(FechaLote): bajar del 13-ago dejaba esa línea
// intacta y la del 1-sep en negativo.
//
//   npx tsx scripts/probarFechaLoteDescongelado.ts
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";
import { consumirDelPiso, normalizarLineas } from "../src/routes/descongelado.ts";

const OP = "prueba-fechalote";
let ok = 0, mal = 0;
const check = (c: boolean, m: string) => { c ? ok++ : mal++; console.log(c ? "  OK " : "  MAL", m); };
class Revertir extends Error {}

(async () => {
  const [base]: any[] = await prisma.$queryRawUnsafe(`
    SELECT m.RemisionId, m.Lote, m.Clase, m.Talla, m.KgPorMaster
      FROM MovimientoPiso m JOIN Remisiones r ON r.RemisionId = m.RemisionId
     WHERE r.Folio = 'RS-0077' AND m.Lote = 'G433TM04-E04-6' AND m.Tipo = 'INGRESO' LIMIT 1`);
  if (!base) { console.log("RS-0077 / G433TM04-E04-6 ya no está al piso: nada que probar."); await prisma.$disconnect(); return; }
  const linea = (extra: any) => ({ Lote: base.Lote, Clase: base.Clase, Talla: Number(base.Talla),
    RemisionId: Number(base.RemisionId), KgPorMaster: Number(base.KgPorMaster), UM: "KG", ...extra });

  try {
    await prisma.$transaction(async (tx) => {
      const saldo = async () => Object.fromEntries((await tx.$queryRawUnsafe(`
        SELECT DATE_FORMAT(FechaLote, '%Y-%m-%d') AS F, SUM(Delta) AS M FROM (
          SELECT FechaLote,  Masters AS Delta FROM MovimientoPiso WHERE BodegaDestino = 'DESCONGELADO' AND RemisionId = ? AND Lote = ?
          UNION ALL
          SELECT FechaLote, -Masters FROM MovimientoPiso WHERE BodegaOrigen = 'DESCONGELADO' AND RemisionId = ? AND Lote = ?) t
         GROUP BY FechaLote`, base.RemisionId, base.Lote, base.RemisionId, base.Lote) as any[]).map(r => [r.F, Number(r.M)]));
      const inicio = await saldo();
      console.log("   al piso:", JSON.stringify(inicio));
      const ago = inicio["2026-08-13"], sep = inicio["2026-09-01"];

      await tx.$executeRawUnsafe(`INSERT INTO HojaProceso (BodegaCodigo, FechaProduccion) VALUES ('DESCONGELADO', '2030-01-07')`);
      const [h]: any[] = await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`);
      const hoja = { BodegaCodigo: "DESCONGELADO" }, hojaId = Number(h.id);

      console.log("1. Con la fecha que escogió la pantalla");
      let l = normalizarLineas([linea({ FechaLote: "2026-08-13", Masters: 48 }), linea({ FechaLote: "2026-09-01", Masters: 48 })], false, null);
      await consumirDelPiso(tx, hoja, hojaId, l, OP, "2030-01-07");
      let s = await saldo();
      check(s["2026-08-13"] === ago - 48 && s["2026-09-01"] === sep - 48,
        `cada fecha baja lo suyo: 13-ago ${ago}→${s["2026-08-13"]}, 1-sep ${sep}→${s["2026-09-01"]}`);
      check(Object.values(s).every(v => v >= 0), "ninguna fecha queda en negativo");

      console.log("2. No se baja de una fecha más de lo que tiene");
      try {
        await consumirDelPiso(tx, hoja, hojaId, normalizarLineas([linea({ FechaLote: "2026-09-01", Masters: 1 })], false, null), OP, "2030-01-07");
        check(false, "debió rechazar (al 1-sep ya no le queda nada)");
      } catch (e: any) { check(/solo quedan 0 masters/.test(e.message), `rechaza: ${e.message}`); }

      console.log("3. Una pantalla vieja sin fecha: se reparte por PEPS");
      l = normalizarLineas([linea({ Masters: 10 })], false, null);
      await consumirDelPiso(tx, hoja, hojaId, l, OP, "2030-01-07");
      s = await saldo();
      check(l.length === 1 && l[0].fechaLote === "2026-08-13" && s["2026-08-13"] === ago - 58,
        `sale del más viejo (13-ago): queda ${s["2026-08-13"]}`);
      throw new Revertir();
    }, { timeout: 120000, maxWait: 15000 });
  } catch (e) {
    if (!(e instanceof Revertir)) { console.error("ERROR", (e as any).message); mal++; }
  }
  console.log("4. Sin fecha y más de lo que tiene la fecha vieja: se parte en dos renglones");
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`INSERT INTO HojaProceso (BodegaCodigo, FechaProduccion) VALUES ('DESCONGELADO', '2030-01-07')`);
      const [h]: any[] = await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`);
      const l = normalizarLineas([linea({ Masters: 80, PesoReal: 400, BodegaDestino: "PELADO" })], true, null);
      await consumirDelPiso(tx, { BodegaCodigo: "DESCONGELADO" }, Number(h.id), l, OP, "2030-01-07");
      check(l.length === 2 && l[0].fechaLote === "2026-08-13" && l[0].masters === 77 && l[1].fechaLote === "2026-09-01" && l[1].masters === 3,
        `77 del 13-ago + 3 del 1-sep: ${l.map(x => `${x.masters}@${x.fechaLote}`).join(" + ")}`);
      check(Math.abs((l[0].pesado ?? 0) + (l[1].pesado ?? 0) - 400) < 0.02,
        `el peso de báscula se reparte en proporción: ${l[0].pesado} + ${l[1].pesado}`);
      throw new Revertir();
    }, { timeout: 120000, maxWait: 15000 });
  } catch (e) {
    if (!(e instanceof Revertir)) { console.error("ERROR", (e as any).message); mal++; }
  }

  const [q]: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM MovimientoPiso WHERE RegistradoPor = ?`, OP);
  check(Number(q.n) === 0, "todo revertido: 0 movimientos de prueba");
  console.log(`\n${ok} OK, ${mal} MAL`);
  await prisma.$disconnect();
  if (mal) process.exitCode = 1;
})();
