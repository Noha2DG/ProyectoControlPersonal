// Verifica que lo que Descongelado despacha a Pelado/Descabezado alimente Destajo solo, sin romper
// nada: lote del día por piscina+ciclo+clase, peso de báscula, trazabilidad al lote de origen, y que
// quitar un renglón no deje un lote con menos ingreso que lo ya pesado.
//
// Lo único que escribe va dentro de una transacción que SIEMPRE revierte: no hay base de desarrollo.
// La fecha de prueba (31-dic-2026, semana ISO 53) da códigos "G453…" que no chocan con lotes reales.
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";
import { alimentarDestajo, asignarPendiente, quitarDeDestajo } from "../src/lib/destajoDesdePiso.ts";
import { descomponerCodigoLote } from "../src/lib/codigoLote.ts";

let ok = 0, fallo = 0;
const check = (c: boolean, m: string) => { c ? ok++ : fallo++; console.log(`${c ? " OK " : " MAL"}  ${m}`); };
class Revertir extends Error {}
const FECHA = "2026-12-31";
const OP = "prueba-destajo-piso";

async function main() {
  // ── Lectura del código, sin base
  const cat = [{ Nombre: "Q005" }, { Nombre: "EM06-E02" }, { Nombre: "TM-SIFON" }, { Nombre: "EM-SIFON" }, { Nombre: "K024" }];
  const d = (l: string) => { const r = descomponerCodigoLote(l, cat); return r ? `${r.piscina.Nombre}|${r.ciclo ?? ""}` : null; };
  check(d("G629Q005") === "Q005|", "G629Q005 → Q005 sin ciclo");
  check(d("G135EM06-E02-4") === "EM06-E02|4", "G135EM06-E02-4 → EM06-E02 ciclo 4");
  check(d("G110SIFON-TF32") === "TM-SIFON|" && d("G321SIFON-E") === "EM-SIFON|", "sifones viejos por equivalencia");
  check(d("G437k024") === "K024|", "k024 en minúscula → K024");
  check(d("ZZZ-RARO") === null && d("G629Q999") === null, "código ilegible o piscina desconocida → null");

  await prisma.$transaction(async (tx: any) => {
    const traslado = async (lote: string, kg: number, bodega = "PELADO_DESCABEZADO", talla = 253) => {
      await tx.$executeRawUnsafe(`
        INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaDestino, Lote, Clase, Talla, Peso, UM, PesoKg, RegistradoPor)
        VALUES ('TRASLADO', ?, ?, ?, 'D30', ?, ?, 'KG', ?, ?)`, FECHA, bodega, lote, talla, kg, kg, OP);
      const [r]: any[] = await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`);
      return Number(r.id);
    };
    const lote = async (l: string) => (await tx.$queryRawUnsafe(
      `SELECT Lote, Clase, PesoIngreso, Origen, CicloId, UM FROM Lotes WHERE Lote = ? AND Clase = 'D30'`, l) as any[])[0];
    const mov = async (id: number) => (await tx.$queryRawUnsafe(
      `SELECT LoteProceso, ClaseProceso, DestajoPendiente FROM MovimientoPiso WHERE MovimientoId = ?`, id) as any[])[0];

    // 1) Un TRASLADO de importación crea el lote del día con el peso de báscula.
    const t1 = await traslado("G629Q005", 100);
    let r = await alimentarDestajo(tx, [t1], FECHA, OP);
    let l = await lote("G453Q005");
    check(r.lotes.length === 1 && r.lotes[0].Lote === "G453Q005", `G629Q005 procesado el 31-dic → G453Q005 (${r.lotes[0]?.Lote})`);
    check(l && Number(l.PesoIngreso) === 100 && l.Origen === "PISO", `lote PISO con 100 kg de báscula (${l?.PesoIngreso}, ${l?.Origen})`);
    check((await mov(t1)).LoteProceso === "G453Q005", "el TRASLADO guarda el lote de Destajo que alimentó");

    // 2) Otro lote de origen de la misma piscina y clase suma al mismo lote del día.
    const t2 = await traslado("G339Q005", 50);
    await alimentarDestajo(tx, [t2], FECHA, OP);
    check(Number((await lote("G453Q005")).PesoIngreso) === 150, "G339Q005 suma al mismo G453Q005 → 150 kg");

    // 3) Piscina de cultivo: el ciclo del origen se conserva.
    const t3 = await traslado("G135EM06-E02-4", 30);
    await alimentarDestajo(tx, [t3], FECHA, OP);
    l = await lote("G453EM06-E02-4");
    const [ci]: any[] = l?.CicloId ? await tx.$queryRawUnsafe(`SELECT Anio, Ciclo FROM Ciclo WHERE CicloId = ?`, l.CicloId) : [];
    check(!!l && Number(ci?.Ciclo) === 4 && Number(ci?.Anio) === 2026, `G135EM06-E02-4 → G453EM06-E02-4, ciclo 2026/4 (${ci?.Anio}/${ci?.Ciclo})`);

    // 4) Sifón con el formato viejo.
    const t4 = await traslado("G110SIFON-TF32", 20);
    await alimentarDestajo(tx, [t4], FECHA, OP);
    check(Number((await lote("G453TM-SIFON"))?.PesoIngreso) === 20, "G110SIFON-TF32 → G453TM-SIFON por equivalencia");

    // 5) Código ilegible: no falla, queda por asignar; luego se asigna a mano.
    const t5 = await traslado("ZZZ-RARO", 10);
    r = await alimentarDestajo(tx, [t5], FECHA, OP);
    check(r.porAsignar.includes(t5) && Number((await mov(t5)).DestajoPendiente) === 1, "código ilegible → DestajoPendiente, sin error");
    const a = await asignarPendiente(tx, t5, 137, null, OP);
    check(!("error" in a) && a.Lote === "G453Q005" && Number((await lote("G453Q005")).PesoIngreso) === 160,
      "asignado a Q005 suma al G453Q005 → 160 kg");
    check((await mov(t5)).DestajoPendiente == null, "ya no está pendiente");

    // 6) Lo que va a otra bodega no toca Destajo.
    const t6 = await traslado("G629Q005", 99, "CLASIFICADO_COLA");
    r = await alimentarDestajo(tx, [t6], FECHA, OP);
    check(r.lotes.length === 0 && (await mov(t6)).LoteProceso == null, "TRASLADO a Clasificado Cola no alimenta Destajo");

    // 7) Quitar un renglón resta; con lo pesado por encima, se rechaza.
    let q = await quitarDeDestajo(tx, t2);
    check(!q.error && Number((await lote("G453Q005")).PesoIngreso) === 110, "quitar G339Q005 → 110 kg");
    const [base]: any[] = await tx.$queryRawUnsafe(`
      SELECT tp.Proceso, tp.ClasePT, tp.Talla, tp.AlmacenOrigen, tp.AlmacenDestino, pd.TermoId, pd.Codigo
        FROM PesajeDetalle pd JOIN TransaccionesProduccion tp ON tp.TransaccionId = pd.TransaccionId LIMIT 1`);
    await tx.$executeRawUnsafe(`
      INSERT INTO TransaccionesProduccion (Lote, ClaseOrigen, Proceso, ClasePT, Talla, AlmacenOrigen, AlmacenDestino, RegistradoPor)
      VALUES ('G453Q005', 'D30', ?, ?, ?, ?, ?, ?)`, base.Proceso, base.ClasePT, base.Talla, base.AlmacenOrigen, base.AlmacenDestino, OP);
    const [tr]: any[] = await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`);
    await tx.$executeRawUnsafe(`INSERT INTO PesajeDetalle (TransaccionId, TermoId, Codigo, Peso, RegistradoPor) VALUES (?, ?, ?, 105, ?)`,
      Number(tr.id), base.TermoId, base.Codigo, OP);
    q = await quitarDeDestajo(tx, t1);
    check(!!q.error && Number((await lote("G453Q005")).PesoIngreso) === 110, `con 105 pesado no deja quitar 100 kg: "${q.error?.slice(0, 60)}…"`);

    // 8) Un lote MANUAL del mismo código pasa a MIXTO y vuelve a MANUAL al quitarle lo del piso.
    await tx.$executeRawUnsafe(`
      INSERT INTO Lotes (Lote, PiscinaId, Clase, Fecha, FechaProduccion, PesoIngreso, UM, RegistradoPor)
      VALUES ('G453Q006', 149, 'D30', ?, ?, 500, 'KG', ?)`, FECHA, FECHA, OP);
    const t7 = await traslado("G629Q006", 40);
    await alimentarDestajo(tx, [t7], FECHA, OP);
    l = await lote("G453Q006");
    check(Number(l.PesoIngreso) === 540 && l.Origen === "MIXTO", `manual 500 + piso 40 → 540 MIXTO (${l.PesoIngreso} ${l.Origen})`);
    await quitarDeDestajo(tx, t7);
    l = await lote("G453Q006");
    check(Number(l.PesoIngreso) === 500 && l.Origen === "MANUAL", "sin nada del piso vuelve a 500 MANUAL");

    // 9) Un lote PISO que se queda sin nada y sin transacciones desaparece.
    await quitarDeDestajo(tx, t3);
    check(!(await lote("G453EM06-E02-4")), "G453EM06-E02-4 sin renglones ni transacciones se borra");

    // 10) Un lote manual en libras recibe libras.
    await tx.$executeRawUnsafe(`
      INSERT INTO Lotes (Lote, PiscinaId, Clase, Fecha, FechaProduccion, PesoIngreso, UM, RegistradoPor)
      VALUES ('G453EM-SIFON', 1, 'D30', ?, ?, 100, 'LB', ?)`, FECHA, FECHA, OP);
    const t8 = await traslado("G321SIFON-E", 10);
    await alimentarDestajo(tx, [t8], FECHA, OP);
    check(Math.abs(Number((await lote("G453EM-SIFON")).PesoIngreso) - 122.05) < 0.01, "lote en LB: 10 kg suman 22.05 lb → 122.05");

    throw new Revertir();
  }, { timeout: 60000, maxWait: 15000 });
}

main().catch(e => { if (!(e instanceof Revertir)) { fallo++; console.error("ERROR:", e.message); } })
  .finally(async () => {
    const [n]: any[] = await prisma.$queryRawUnsafe(
      `SELECT (SELECT COUNT(*) FROM MovimientoPiso WHERE RegistradoPor = ?) + (SELECT COUNT(*) FROM Lotes WHERE Lote LIKE 'G453%') AS n`, OP);
    check(Number(n.n) === 0, "revertido: no quedó rastro en la base");
    console.log(`\n${ok} OK, ${fallo} MAL`);
    await prisma.$disconnect(); process.exit(fallo ? 1 : 0);
  });
