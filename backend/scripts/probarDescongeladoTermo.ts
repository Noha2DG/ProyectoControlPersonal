// Prueba de Descongelado pesado por termo (registrarTermo / corregirTermo / quitarTermo en
// routes/descongelado.ts) contra la base real, dentro de una transacción que SIEMPRE se revierte: no
// queda nada escrito. Necesita la columna MovimientoPiso.PesadaId (scripts/alterMovimientoPisoPesada.ts).
//
// Monta su propio piso de Descongelado con lotes Z101 de piscinas reales del catálogo (dos de la
// misma finca y uno de otra, porque las reglas de unificar leen la finca del código), uno de ellos
// en dos remisiones, más un lote de cola ZZ, y una hoja de 2030.
//
//   npx tsx scripts/probarDescongeladoTermo.ts
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";
import { registrarTermo, corregirTermo, quitarTermo, problemasDeMezcla, salidaExcedida, repartir } from "../src/routes/descongelado.ts";

const OP = "prueba-termo";
const HOY = "2030-01-08";
let ok = 0, mal = 0;
const check = (c: boolean, m: string) => { c ? ok++ : mal++; console.log(c ? "  OK " : "  MAL", m); };
async function falla(f: () => Promise<any>, patron: RegExp, m: string) {
  try { await f(); check(false, `${m} (no falló)`); }
  catch (e: any) { check(patron.test(e.message), `${m}: ${e.message}`); }
}
class Revertir extends Error {}
const kgm = 5.448;

(async () => {
  const rems: any[] = await prisma.$queryRawUnsafe(`SELECT RemisionId FROM Remisiones WHERE Estatus = 'Confirmada' ORDER BY RemisionId DESC LIMIT 2`);
  const [R1, R2] = rems.map(r => Number(r.RemisionId));
  const pis: any[] = await prisma.$queryRawUnsafe(`
    SELECT Nombre, CodigoFinca FROM Piscina
     WHERE Activo = 1 AND Nombre NOT LIKE '%SIFON%' AND Nombre NOT LIKE '%00-E00%' AND CodigoFinca NOT IN ('IM001', 'MA001', 'P0001')
     ORDER BY CodigoFinca, Nombre`);
  const porFinca = new Map<string, string[]>();
  for (const p of pis) porFinca.set(p.CodigoFinca, [...(porFinca.get(p.CodigoFinca) ?? []), p.Nombre]);
  const [f1, f2] = [...porFinca.entries()].filter(([, ns]) => ns.length >= 2);
  // D en dos remisiones (D y D2), E de la misma finca, F de otra, C otro producto (cola).
  const D  = { RemisionId: R1, Lote: `Z101${f1[1][0]}-7`, Clase: "C20", Talla: 229, FechaLote: "2030-01-04", KgPorMaster: kgm };
  const D2 = { ...D, RemisionId: R2 };
  const E  = { RemisionId: R2, Lote: `Z101${f1[1][1]}-8`, Clase: "C20", Talla: 229, FechaLote: "2030-01-05", KgPorMaster: kgm };
  const F  = { RemisionId: R2, Lote: `Z101${f2[1][0]}-9`, Clase: "C20", Talla: 229, FechaLote: "2030-01-06", KgPorMaster: kgm };
  const C  = { RemisionId: R1, Lote: "ZZ3EM00-E00", Clase: "D30", Talla: 326, FechaLote: "2030-01-03", KgPorMaster: 9.07 };
  const llave = (l: any) => ({ RemisionId: l.RemisionId, Lote: l.Lote, Clase: l.Clase, Talla: l.Talla, FechaLote: l.FechaLote });

  try {
    await prisma.$transaction(async (tx) => {
      for (const [l, m] of [[D, 25], [D2, 10], [E, 12], [F, 5], [C, 6]] as const) {
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
      const filasDe = async (pesadaId: number) => (await tx.$queryRawUnsafe(`
        SELECT MovimientoId, Tipo, Lote, RemisionId, PesoKg, Masters, NumeroTermo, BodegaDestino, ConsumoId
          FROM MovimientoPiso WHERE PesadaId = ? ORDER BY MovimientoId`, pesadaId) as any[]);
      const lin = (l: any, Masters: number) => ({ ...l, Masters });
      const termo = (NumeroTermo: string, KgPesado: number, lineas: any[], extra: any = {}) =>
        registrarTermo(tx, hoja, { BodegaDestino: "PELADO", NumeroTermo, KgPesado, lineas, ...extra }, OP);

      console.log("0. Reparto");
      const rp = repartir(100, [1, 1, 1]);
      check(rp[0] === 33.33 && rp[2] === 33.34 && rp.reduce((s, x) => s + x, 0) === 100, `100 kg en tres partes iguales: ${rp.join(" + ")}`);

      console.log("1. Reglas de captura");
      await falla(() => termo("", 53, [lin(D, 10)]), /número del termo/, "el número del termo es obligatorio");
      await falla(() => termo("14", 0, [lin(D, 10)]), /báscula/, "los kilos de la báscula son obligatorios");
      await falla(() => termo("14", 53, [lin(D, 2.5)]), /entero/, "los masters son enteros");
      await falla(() => registrarTermo(tx, hoja, { BodegaDestino: "", NumeroTermo: "14", KgPesado: 53, lineas: [lin(D, 10)] }, OP),
        /a dónde va/, "el destino es obligatorio");
      await falla(() => termo("14", 140, [lin(D, 26)]), /solo quedan 25 masters/, "no baja más masters de los que hay al piso");
      // 10 masters = 54.48 kg declarados: −5 % es 51.76 y +2 % es 55.57.
      await falla(() => termo("14", 51.5, [lin(D, 10)]), /fuera del rango/, "−5.5 % pide confirmación");
      await falla(() => termo("14", 55.7, [lin(D, 10)]), /fuera del rango/, "+2.2 % pide confirmación");
      check((await piso("DESCONGELADO", D)).m === 25, "lo rechazado no movió nada del piso");

      console.log("2. Un termo de un lote");
      const t14 = await termo("14", 53, [lin(D, 10)]);
      check(t14.KgDeclarado === 54.48 && t14.FueraDeRango === false, `declarado 54.48, pesado 53.00 (${t14.Dif} %), dentro del rango`);
      check((await piso("PELADO", D)).kg === 53 && (await piso("DESCONGELADO", D)).m === 15, "Pelado recibe lo pesado al instante y al piso quedan 15 masters");
      const f14 = await filasDe(t14.PesadaId);
      const c14 = f14.find(f => f.Tipo === "CONSUMO"), tr14 = f14.find(f => f.Tipo === "TRASLADO");
      check(f14.length === 2 && Number(c14.MovimientoId) === t14.PesadaId && Number(tr14.ConsumoId) === t14.PesadaId,
        "un par CONSUMO + TRASLADO con PesadaId = el consumo");
      check(c14.NumeroTermo === "14" && tr14.NumeroTermo == null, "el número del termo va en el consumo y NO llega a Pelado");
      const t7 = await termo("7", 51.5, [lin(D, 10)], { Confirmado: true });
      check(t7.FueraDeRango === true && (await piso("PELADO", D)).kg === 104.5, "fuera del rango y confirmado, se registra y queda marcado");

      console.log("3. Termos mezclados (= unificados)");
      // Lo que queda de D en R1 (5) con D de R2 (5): mismo lote, dos remisiones.
      const t3 = await termo("3", 54, [lin(D, 5), lin(D2, 5)], { Base: llave(D) });
      const f3 = await filasDe(t3.PesadaId);
      check(f3.filter(f => f.Tipo === "CONSUMO").length === 2 && f3.filter(f => f.Tipo === "TRASLADO").every(f => Number(f.RemisionId) === R1),
        "dos consumos (uno por remisión) y los dos traslados con la llave de la base");
      check((await piso("PELADO", D)).kg === 158.5 && (await piso("PELADO", D2)).kg === 0, "en Pelado es UNA línea: 53 + 51.5 + 54");
      check(f3.filter(f => f.Tipo === "TRASLADO").map(f => Number(f.PesoKg)).join("+") === "27+27", "los 54 kg se reparten 27 + 27 según lo declarado");
      // Lo que queda de D2 (5) con E (5): lotes distintos de la misma finca.
      const t9 = await termo("9", 53.5, [lin(D2, 5), lin(E, 5)], { Base: llave(D) });
      check((await piso("PELADO", D)).kg === 212 && (await piso("PELADO", E)).kg === 0, "E se une a la línea de D aunque D no va en este termo");
      // Un termo solo de E, unido a D que se pesó en termos anteriores.
      const t11 = await termo("11", 37.8, [lin(E, 7)], { Base: llave(D) });
      check((await piso("PELADO", D)).kg === 249.8 && (await piso("DESCONGELADO", E)).m === 0, "el siguiente termo de E también llega como D");
      await falla(() => termo("12", 27, [lin(F, 5)], { Base: llave(D) }), /finca|unific/i, "un lote de otra finca no se une");
      await falla(() => termo("12", 54, [lin(C, 6)], { Base: llave(D) }), /productos distintos/, "ni otro producto (cola con entero)");
      await falla(() => termo("12", 27, [lin(F, 5)], { Base: llave(C) }), /no tiene termos/, "la base tiene que ser de un termo de esta hoja");
      const pm = await problemasDeMezcla(tx, [D.Lote], [E.Lote, F.Lote]);
      check(pm[E.Lote] === null && typeof pm[F.Lote] === "string", `el panel ve que E se puede juntar con D y F no (${pm[F.Lote]})`);

      console.log("4. Corregir un termo");
      await corregirTermo(tx, t14.PesadaId, { KgPesado: 54.2, NumeroTermo: "15" });
      const g14 = await filasDe(t14.PesadaId);
      check((await piso("PELADO", D)).kg === 251 && g14.find(f => f.Tipo === "CONSUMO").NumeroTermo === "15",
        "el peso sube a 54.20 en Pelado y el número cambia a 15");
      await falla(() => corregirTermo(tx, t14.PesadaId, { KgPesado: 40 }), /fuera del rango/, "corregir fuera del rango también pide confirmación");
      await corregirTermo(tx, t9.PesadaId, { KgPesado: 54 });
      const g9 = (await filasDe(t9.PesadaId)).filter(f => f.Tipo === "TRASLADO").map(f => Number(f.PesoKg));
      check(g9.join("+") === "27+27" && (await piso("PELADO", D)).kg === 251.5, "el termo mezclado se vuelve a repartir");
      await corregirTermo(tx, t11.PesadaId, { BodegaDestino: "DESCABEZADO" });
      check((await piso("DESCABEZADO", D)).kg === 37.8 && (await piso("PELADO", D)).kg === 213.7, "cambiar el destino mueve el termo completo");

      console.log("5. Quitar un termo");
      await quitarTermo(tx, t9.PesadaId);
      check((await filasDe(t9.PesadaId)).length === 0, "se van sus cuatro filas");
      check((await piso("DESCONGELADO", D2)).m === 5 && (await piso("DESCONGELADO", E)).m === 5 && (await piso("PELADO", D)).kg === 159.7,
        "D2 y E vuelven al piso de Descongelado y Pelado baja 54");
      // Pelado toma todo lo de la línea: ya no se puede quitar ni bajar el peso, pero sí subirlo.
      await tx.$executeRawUnsafe(`
        INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaOrigen, RemisionId, Lote, Clase, Talla, FechaLote, Peso, UM, PesoKg, RegistradoPor)
        VALUES ('CONSUMO', ?, 'PELADO', ?, ?, ?, ?, ?, 159.7, 'KG', 159.7, ?)`, HOY, D.RemisionId, D.Lote, D.Clase, D.Talla, D.FechaLote, OP);
      await falla(() => quitarTermo(tx, t3.PesadaId), /ya tomó/, "si Pelado ya lo tomó, no se quita");
      await falla(() => corregirTermo(tx, t3.PesadaId, { KgPesado: 53 }), /ya tomó/, "ni se le baja el peso");
      await corregirTermo(tx, t3.PesadaId, { KgPesado: 55 });
      check((await piso("PELADO", D)).kg === 1, "subirlo sí: Pelado recibe el kilo de más");

      console.log("6. Cierre de la hoja");
      check(!salidaExcedida(1000, 1020) && salidaExcedida(1000, 1020.02) && !salidaExcedida(1000, 950),
        "cierra con ganancia hasta +2 % (1,020 de 1,000) y no con más");

      console.log("7. Hoja cerrada");
      await tx.$executeRawUnsafe(`UPDATE HojaProceso SET Estatus = 'Cerrada' WHERE HojaId = ?`, hoja);
      await falla(() => termo("20", 27, [lin(E, 5)]), /cerrada/, "no se registran termos");
      await falla(() => corregirTermo(tx, t3.PesadaId, { KgPesado: 54 }), /cerrada/, "ni se corrigen");
      await falla(() => quitarTermo(tx, t3.PesadaId), /cerrada/, "ni se quitan");

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
