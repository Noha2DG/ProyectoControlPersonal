// Prueba de Descongelado sin termos (descongelarMarcado / cambiarDestino / quitarDescongelado en
// routes/descongelado.ts) contra la base real, dentro de una transacción que SIEMPRE se revierte: no
// queda nada escrito.
//
// Monta su propio piso de Descongelado con lotes ZZ (dos de entero C20 de remisiones distintas y uno de
// cola D30) y una hoja de 2030. Para unificar, lotes Z101 con piscinas reales del catálogo (dos de la
// misma finca y uno de otra), porque las reglas necesitan leer la finca del código.
//
//   npx tsx scripts/probarDescongeladoMarcado.ts
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";
import { descongelarMarcado, cambiarDestino, quitarDescongelado } from "../src/routes/descongelado.ts";

const OP = "prueba-marcado";
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

  // Dos piscinas de cultivo de una finca y una de otra (sin sifón, genéricos ni proveedores externos).
  const pis: any[] = await prisma.$queryRawUnsafe(`
    SELECT Nombre, CodigoFinca FROM Piscina
     WHERE Activo = 1 AND Nombre NOT LIKE '%SIFON%' AND Nombre NOT LIKE '%00-E00%' AND CodigoFinca NOT IN ('IM001', 'MA001', 'P0001')
     ORDER BY CodigoFinca, Nombre`);
  const porFinca = new Map<string, string[]>();
  for (const p of pis) porFinca.set(p.CodigoFinca, [...(porFinca.get(p.CodigoFinca) ?? []), p.Nombre]);
  const [f1, f2] = [...porFinca.entries()].filter(([, ns]) => ns.length >= 2);
  const D = { RemisionId: R1, Lote: `Z101${f1[1][0]}-7`, Clase: "C20", Talla: 229, FechaLote: "2030-01-04", KgPorMaster: 5.448 };
  const E = { RemisionId: R2, Lote: `Z101${f1[1][1]}-8`, Clase: "C20", Talla: 233, FechaLote: "2030-01-05", KgPorMaster: 5.448 };
  const F = { RemisionId: R2, Lote: `Z101${f2[1][0]}-9`, Clase: "C20", Talla: 229, FechaLote: "2030-01-06", KgPorMaster: 5.448 };
  // Entero IQF: otra clase, pero el mismo producto que el C20 (se unifican entre sí).
  const G = { RemisionId: R2, Lote: `Z101${f1[1][1]}-9`, Clase: "C26", Talla: 229, FechaLote: "2030-01-06", KgPorMaster: 5.448 };

  try {
    await prisma.$transaction(async (tx) => {
      for (const [l, m] of [[A, 10], [B, 4], [C, 3], [D, 4], [E, 2], [F, 1], [G, 2]] as const) {
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
      // Los renglones descongelados de la hoja, con el lote y la clase de su consumo (el origen).
      const traslados = async () => (await tx.$queryRawUnsafe(`
        SELECT t.MovimientoId, t.Lote, t.Clase, t.RemisionId, t.Talla, DATE_FORMAT(t.FechaLote, '%Y-%m-%d') AS FechaLote,
               t.PesoKg, t.NumeroTermo, t.BodegaDestino, t.ConsumoId, c.Lote AS LoteOrigen, c.Clase AS ClaseOrigen,
               c.RemisionId AS RemOrigen
          FROM MovimientoPiso t JOIN MovimientoPiso c ON c.MovimientoId = t.ConsumoId
         WHERE t.HojaOrigenId = ? AND t.Tipo = 'TRASLADO' ORDER BY t.MovimientoId`, hoja) as any[]);
      const de = async (l: any) => (await traslados()).find(t => t.LoteOrigen === l.Lote && t.ClaseOrigen === l.Clase);
      const lin = (l: any, Masters: number) => ({ ...l, Masters, UM: "KG" });
      const quitarTodo = async () => { for (const t of await traslados()) await quitarDescongelado(tx, Number(t.MovimientoId)); };

      console.log("1. Reglas");
      await falla(() => descongelarMarcado(tx, hoja, { BodegaDestino: "", lineas: [lin(A, 2)] }, OP),
        /a dónde va/, "el destino es obligatorio");
      await falla(() => descongelarMarcado(tx, hoja, { BodegaDestino: "DESCONGELADO", lineas: [lin(A, 2)] }, OP),
        /misma bodega/, "no se manda a la misma bodega de la hoja");
      await falla(() => descongelarMarcado(tx, hoja, { BodegaDestino: "DESCABEZADO", lineas: [lin(A, 11)] }, OP),
        /solo quedan 10 masters/, "no se bajan más masters de los que hay al piso");
      await falla(() => descongelarMarcado(tx, hoja, { BodegaDestino: "DESCABEZADO", lineas: [] }, OP),
        /No marcó nada/, "sin nada marcado no hay qué descongelar");
      await descongelarMarcado(tx, hoja, { BodegaDestino: "PELADO", PesoReal: 50, NumeroTermo: "12", lineas: [lin(A, 2), lin(C, 1)] } as any, OP);
      const mix = await traslados();
      check(mix.length === 2 && Number(mix[0].PesoKg) === 10.9 && Number(mix[1].PesoKg) === 9.07 && mix.every(t => t.NumeroTermo == null),
        "sin unificar, un C20 y un D30 van juntos; el peso y el termo que mande la pantalla se ignoran: sale lo declarado");
      await quitarTodo();
      await falla(() => descongelarMarcado(tx, hoja, { BodegaDestino: "PELADO", BaseLote: A.Lote, lineas: [lin(A, 2), lin(C, 1)] }, OP),
        /No se unifican productos distintos: C20 y D30/, "un C20 y un D30 no se unifican");

      console.log("2. Dos lotes de dos remisiones, sin báscula");
      const r2l = await descongelarMarcado(tx, hoja, { BodegaDestino: "DESCABEZADO", lineas: [lin(A, 6), lin(B, 4)] }, OP);
      const tA = await de(A), tB = await de(B);
      check(r2l.Kg === 54.48 && Number(tA.PesoKg) === 32.69 && Number(tB.PesoKg) === 21.79,
        `cada lote sale con lo declarado (6 × 5.448 y 4 × 5.448): ${tA.PesoKg} + ${tB.PesoKg} = ${r2l.Kg}`);
      check((await piso("DESCONGELADO", A)).m === 4 && (await piso("DESCONGELADO", B)).m === 0, "al piso quedan 4 masters de A y nada de B");
      check((await piso("DESCABEZADO", A)).kg === 32.69 && (await piso("DESCABEZADO", B)).kg === 21.79, "en Descabezado cada lote llega con su código");

      console.log("3. Corregir y quitar por renglón");
      await cambiarDestino(tx, Number(tA.MovimientoId), { BodegaDestino: "PELADO" });
      check((await piso("PELADO", A)).kg === 32.69 && (await piso("DESCABEZADO", A)).kg === 0 && (await piso("DESCABEZADO", B)).kg === 21.79,
        "cambiar el destino de A lo mueve a Pelado; B sigue en Descabezado");
      await falla(() => cambiarDestino(tx, Number(tA.MovimientoId), { BodegaDestino: "DESCONGELADO" }), /misma bodega/, "no se cambia a la misma bodega de la hoja");
      await falla(() => quitarDescongelado(tx, Number(tA.ConsumoId)), /Renglón no encontrado/, "solo se quita un renglón descongelado, no su consumo");
      await tx.$executeRawUnsafe(`
        INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaOrigen, RemisionId, Lote, Clase, Talla, FechaLote, Peso, UM, PesoKg, RegistradoPor)
        VALUES ('DESTAJO', ?, 'PELADO', ?, ?, ?, ?, ?, 10, 'KG', 10, ?)`, HOY, A.RemisionId, A.Lote, A.Clase, A.Talla, A.FechaLote, OP);
      await falla(() => cambiarDestino(tx, Number(tA.MovimientoId), { BodegaDestino: "DESCABEZADO" }),
        /ya tomó/, "si Pelado ya tomó de ese lote, el renglón no cambia de destino");
      await falla(() => quitarDescongelado(tx, Number(tA.MovimientoId)), /ya tomó/, "ni se quita");
      const igual = await cambiarDestino(tx, Number(tA.MovimientoId), { BodegaDestino: "PELADO" });
      check(igual.ok === true, "dejarlo en el mismo destino no es un cambio, aunque Pelado ya haya tomado");
      await quitarDescongelado(tx, Number(tB.MovimientoId));
      const [cB]: any[] = await tx.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM MovimientoPiso WHERE MovimientoId = ?`, Number(tB.ConsumoId));
      check((await piso("DESCONGELADO", B)).m === 4 && (await piso("DESCABEZADO", B)).kg === 0 && Number(cB.n) === 0,
        "quitar B devuelve sus 4 masters al piso de Descongelado y se lleva su consumo");

      console.log("4. Unificar en un lote escogido");
      await falla(() => descongelarMarcado(tx, hoja, { BodegaDestino: "PELADO", BaseLote: D.Lote, lineas: [lin(D, 2), lin(F, 1)] }, OP),
        /misma finca/, `${D.Lote} y ${F.Lote} son de fincas distintas: no se unifican`);
      await falla(() => descongelarMarcado(tx, hoja, { BodegaDestino: "PELADO", BaseLote: A.Lote, lineas: [lin(A, 1), lin(D, 2)] }, OP),
        /No se reconoce la piscina/, "un código que no se lee no se unifica");
      await falla(() => descongelarMarcado(tx, hoja, { BodegaDestino: "PELADO", BaseLote: F.Lote, lineas: [lin(D, 2), lin(E, 2)] }, OP),
        /no está entre los que marcó/, "el lote escogido tiene que ser uno de los marcados");
      // Se escoge E, el de MENOS kilos: el código lo decide el encargado, no el peso.
      const u = await descongelarMarcado(tx, hoja, { BodegaDestino: "PELADO", BaseLote: E.Lote, lineas: [lin(D, 4), lin(E, 2)] }, OP);
      const tD = await de(D), tE = await de(E);
      check(u.Unificado === E.Lote && [tD, tE].every(x => x.Lote === E.Lote && Number(x.RemisionId) === E.RemisionId &&
            Number(x.Talla) === E.Talla && x.FechaLote === E.FechaLote),
        `los dos renglones llegan como ${E.Lote}, con la remisión, la talla y la fecha de ese lote`);
      check(Number(tD.RemOrigen) === D.RemisionId, `su consumo sigue diciendo que una parte salió de ${D.Lote} (remisión ${D.RemisionId})`);
      check((await piso("PELADO", E)).kg === 32.69 && (await piso("PELADO", D)).kg === 0,
        `en Pelado es UNA línea de ${E.Lote} con los 32.69 kg; ${D.Lote} no aparece`);
      check((await piso("DESCONGELADO", D)).m === 0 && (await piso("DESCONGELADO", E)).m === 0, "en Descongelado salen los dos lotes de origen");

      // Pelado toma 5 kg de la línea unificada (quedan 27.69): el renglón de D (21.79) todavía cabe,
      // y después el de E (10.9) ya no.
      await tx.$executeRawUnsafe(`
        INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaOrigen, RemisionId, Lote, Clase, Talla, FechaLote, Peso, UM, PesoKg, RegistradoPor)
        VALUES ('DESTAJO', ?, 'PELADO', ?, ?, ?, ?, ?, 5, 'KG', 5, ?)`, HOY, E.RemisionId, E.Lote, E.Clase, E.Talla, E.FechaLote, OP);
      await quitarDescongelado(tx, Number(tD.MovimientoId));
      check((await piso("DESCONGELADO", D)).m === 4 && (await piso("PELADO", E)).kg === 5.9,
        "quitar el renglón de D devuelve sus 4 masters aunque Pelado ya tomó parte de la línea: lo que queda alcanza");
      await falla(() => quitarDescongelado(tx, Number(tE.MovimientoId)), /ya tomó/, "el de E ya no: se mide contra la línea completa");
      await tx.$executeRawUnsafe(`DELETE FROM MovimientoPiso WHERE Tipo = 'DESTAJO' AND Lote = ? AND RegistradoPor = ?`, E.Lote, OP);
      await quitarDescongelado(tx, Number(tE.MovimientoId));
      check((await piso("DESCONGELADO", E)).m === 2 && (await piso("PELADO", E)).kg === 0, "sin lo que tomó Pelado, E vuelve completo");
      const solo = await descongelarMarcado(tx, hoja, { BodegaDestino: "PELADO", BaseLote: D.Lote, lineas: [lin(D, 4)] }, OP);
      check(solo.Unificado === null && (await piso("PELADO", D)).kg === 21.79, "con un solo lote no hay nada que unificar");
      await quitarDescongelado(tx, Number((await de(D)).MovimientoId));

      console.log("5. Las clases de entero se unifican entre sí (C20 con C26)");
      await descongelarMarcado(tx, hoja, { BodegaDestino: "PELADO", lineas: [lin(E, 2), lin(G, 2)] }, OP);
      check((await piso("PELADO", E)).kg === 10.9 && (await piso("PELADO", G)).kg === 10.9,
        "sin unificar, cada lote llega con su clase: el C20 como C20 y el C26 como C26");
      for (const l of [E, G]) await quitarDescongelado(tx, Number((await de(l)).MovimientoId));
      await descongelarMarcado(tx, hoja, { BodegaDestino: "PELADO", BaseLote: E.Lote, lineas: [lin(E, 2), lin(G, 2)] }, OP);
      const tG = await de(G);
      check((await piso("PELADO", E)).kg === 21.8 && (await piso("PELADO", G)).kg === 0 && tG.Clase === "C20" && tG.ClaseOrigen === "C26",
        `unificado en ${E.Lote}, es UNA línea C20 y el consumo sigue diciendo que esa parte era C26`);

      console.log("6. Hoja cerrada");
      await tx.$executeRawUnsafe(`UPDATE HojaProceso SET Estatus = 'Cerrada' WHERE HojaId = ?`, hoja);
      await falla(() => cambiarDestino(tx, Number(tG.MovimientoId), { BodegaDestino: "DESCABEZADO" }), /cerrada/, "con la hoja cerrada no se cambia el destino");
      await falla(() => quitarDescongelado(tx, Number(tG.MovimientoId)), /cerrada/, "ni se quita el renglón");

      throw new Revertir();
    }, { timeout: 180000, maxWait: 15000 });
  } catch (e) {
    if (!(e instanceof Revertir)) { console.error("ERROR", (e as any).message); mal++; }
  }

  const [q]: any[] = await prisma.$queryRawUnsafe(
    `SELECT (SELECT COUNT(*) FROM MovimientoPiso WHERE RegistradoPor = ? OR Lote LIKE 'ZZ%' OR Lote LIKE 'Z101%') AS m,
            (SELECT COUNT(*) FROM HojaProceso WHERE CreadoPor = ?) AS h`, OP, OP);
  check(Number(q.m) === 0 && Number(q.h) === 0, "todo revertido: 0 movimientos y 0 hojas de prueba en la base");
  console.log(`\n${ok} OK, ${mal} MAL`);
  await prisma.$disconnect();
  if (mal) process.exitCode = 1;
})();
