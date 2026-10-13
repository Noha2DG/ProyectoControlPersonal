// Prueba del reparto por FechaLote en consumirDelPiso. Todo dentro de una transacción que SIEMPRE revierte.
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";
import { consumirDelPiso } from "../src/routes/descongelado.ts";

let ok = 0, fallo = 0;
const check = (c: boolean, m: string) => { c ? ok++ : fallo++; console.log(`${c ? " OK " : " MAL"}  ${m}`); };
const LOTE = "ZZPRUEBA-FECHALOTE";
class Revertir extends Error {}

async function main() {
  await prisma.$transaction(async (tx: any) => {
    const [rem]: any[] = await tx.$queryRawUnsafe(`SELECT RemisionId FROM Remisiones WHERE Estatus='Confirmada' ORDER BY RemisionId DESC LIMIT 1`);
    const remId = Number(rem.RemisionId);
    await tx.$executeRawUnsafe(`INSERT INTO HojaProceso (BodegaCodigo, FechaProduccion, Propiedad, CreadoPor) VALUES ('DESCONGELADO', '2026-09-29', 'OROPSA', 'prueba')`);
    const [h]: any[] = await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`);
    const hojaId = Number(h.id);
    const hoja = { BodegaCodigo: "DESCONGELADO" };

    // Un lote con dos fechas de producción: 2 masters del 11/08 y 1 del 12/08, 18.1 kg por master.
    const ingreso = (fl: string, m: number) => tx.$executeRawUnsafe(
      `INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaDestino, Lote, Clase, Talla, FechaLote, Peso, UM, PesoKg, Masters, KgPorMaster, RemisionId, RegistradoPor)
       VALUES ('INGRESO','2026-09-29','DESCONGELADO',?,'C20',253,?,?,'KG',?,?,18.1,?,'prueba')`, LOTE, fl, m * 18.1, m * 18.1, m, remId);
    await ingreso("2026-08-11", 2);
    await ingreso("2026-08-12", 1);

    const saldo = async () => {
      const r: any[] = await tx.$queryRawUnsafe(`
        SELECT DATE_FORMAT(FechaLote,'%Y-%m-%d') FL, ROUND(SUM(D),2) Kg, SUM(M) M FROM (
          SELECT FechaLote, PesoKg D, Masters M FROM MovimientoPiso WHERE Lote=? AND BodegaDestino='DESCONGELADO'
          UNION ALL SELECT FechaLote, -PesoKg, -Masters FROM MovimientoPiso WHERE Lote=? AND BodegaOrigen='DESCONGELADO'
        ) u GROUP BY FechaLote ORDER BY FechaLote`, LOTE, LOTE);
      return Object.fromEntries(r.map(x => [x.FL, { kg: Number(x.Kg), m: Number(x.M) }]));
    };
    const linea = (m: number, extra: any = {}) => ({
      Lote: LOTE, Clase: "C20", um: "KG", talla: 253, remId, masters: m, kgxm: 18.1,
      declarado: +(m * 18.1).toFixed(2), kgDecl: +(m * 18.1).toFixed(2), fechaLote: null, ...extra });

    // 1) Una línea de 1 master sin fecha: sale del 11/08 (el más viejo).
    let ls: any[] = [linea(1)];
    let ids = await consumirDelPiso(tx, hoja, hojaId, ls, "prueba", "2026-09-29");
    let s = await saldo();
    check(ls.length === 1 && ls[0].fechaLote === "2026-08-11", "1 master sin fecha sale del lote más viejo (11/08)");
    check(s["2026-08-11"].m === 1 && s["2026-08-12"].m === 1, "quedan 1 del 11/08 y 1 del 12/08");

    // 2) Línea de 2 masters con peso de báscula 35: abarca las dos fechas y se parte en dos.
    ls = [linea(2, { pesado: 35, kgReal: 35 })];
    ids = await consumirDelPiso(tx, hoja, hojaId, ls, "prueba", "2026-09-29");
    s = await saldo();
    check(ls.length === 2 && ids.length === 2, `la línea se partió en 2 renglones con su consumo cada uno (${ls.length}/${ids.length})`);
    check(ls[0].fechaLote === "2026-08-11" && ls[1].fechaLote === "2026-08-12", "cada partida con su fecha, PEPS");
    check(ls[0].masters === 1 && ls[1].masters === 1, "1 master por partida");
    check(Math.abs(ls[0].kgReal + ls[1].kgReal - 35) < 0.001 && Math.abs(ls[0].kgDecl + ls[1].kgDecl - 36.2) < 0.001,
      `báscula y declarado suman lo capturado (${ls[0].kgReal}+${ls[1].kgReal}, ${ls[0].kgDecl}+${ls[1].kgDecl})`);
    check(Object.values(s).every((x: any) => Math.abs(x.kg) < 0.001 && x.m === 0), "saldo en cero en las dos fechas, sin negativos");
    const cons: any[] = await tx.$queryRawUnsafe(`SELECT MovimientoId, DATE_FORMAT(FechaLote,'%Y-%m-%d') FL, Masters FROM MovimientoPiso WHERE MovimientoId IN (${ids.join(",")}) ORDER BY MovimientoId`);
    check(cons[0].FL === "2026-08-11" && cons[1].FL === "2026-08-12", "los CONSUMO escritos llevan su fecha y casan con consumos[i]");

    // 3) Ya no queda nada: pedir 1 más falla.
    let err = "";
    try { await consumirDelPiso(tx, hoja, hojaId, [linea(1)], "prueba", "2026-09-29"); } catch (e: any) { err = e.message; }
    check(err.includes("solo quedan 0 masters"), `sin saldo rechaza: "${err}"`);

    // 4) Con fecha pedida: vuelven a entrar 1+1; pedir el 12/08 saca el 12/08 aunque haya uno más viejo.
    await ingreso("2026-08-11", 1);
    await ingreso("2026-08-12", 1);
    ls = [linea(1, { fechaPedida: "2026-08-12" })];
    await consumirDelPiso(tx, hoja, hojaId, ls, "prueba", "2026-09-29");
    s = await saldo();
    check(ls[0].fechaLote === "2026-08-12" && s["2026-08-11"].m === 1 && s["2026-08-12"].m === 0, "con FechaLote pedida descuenta solo de esa fecha");

    // 5) Dos filas en la misma petición (como "Descongelar todo"): la segunda mide contra lo que dejó la primera.
    err = "";
    try { await consumirDelPiso(tx, hoja, hojaId, [linea(1), linea(1)], "prueba", "2026-09-29"); } catch (e: any) { err = e.message; }
    check(err.includes("solo quedan 0 masters"), "dos renglones no pueden sacar más de lo que hay");

    throw new Revertir();
  }, { timeout: 60000, maxWait: 15000 });
}

main().catch(e => { if (!(e instanceof Revertir)) { fallo++; console.error("ERROR:", e.message); } })
  .finally(async () => {
    const [n]: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) n FROM MovimientoPiso WHERE Lote=?`, LOTE);
    check(Number(n.n) === 0, "revertido: no quedó rastro en la base");
    console.log(`\n${ok} OK, ${fallo} MAL`);
    await prisma.$disconnect(); process.exit(fallo ? 1 : 0);
  });
