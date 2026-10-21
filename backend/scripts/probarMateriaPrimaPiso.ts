// Prueba de Materia Prima tomada del piso (lib/destajoPiso.ts) contra la base real, dentro de una
// transacción que SIEMPRE se revierte: no queda nada escrito.
//
// Monta su propio piso en Pelado (TRASLADO como los que deja Descongelado) y usa una fecha de 2030
// para que los códigos de lote no choquen con los lotes reales del día.
//
//   npx tsx scripts/probarMateriaPrimaPiso.ts
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";
import {
  saldoParaDestajo, tomarDelPiso, bajarAlPiso, registrarDescarte, deshacerMovimiento, cuadreLote,
  movimientosDeLote, rendimientoLote, devolverLoteAlPiso, registrarCola, rendimientosEntero,
  esEntero, claseColaSugerida,
} from "../src/lib/destajoPiso.ts";
import { componerCodigoLote } from "../src/lib/codigoLote.ts";

const OP = "prueba-mp-piso";
const HOY = "2030-01-07", MANANA = "2030-01-08";
let ok = 0, mal = 0;
const check = (c: boolean, m: string) => { c ? ok++ : mal++; console.log(c ? "  OK " : "  MAL", m); };
async function falla(f: () => Promise<any>, patron: RegExp, m: string) {
  try { await f(); check(false, `${m} (no falló)`); }
  catch (e: any) { check(patron.test(e.message), `${m}: ${e.message}`); }
}
class Revertir extends Error {}

// Lotes de origen reales: maquila (sin ciclo), Esteromar con ciclo, Esteromar genérica, Tecojate, y uno ilegible.
const PISO = [
  { Lote: "G240K025",       Clase: "D30", Talla: 217, Kg: 976.1, FechaLote: "2026-09-29" },
  { Lote: "G719EM03-E05-7", Clase: "C20", Talla: 237, Kg: 43.58, FechaLote: "2026-06-17" },
  { Lote: "G719EM03-E05-7", Clase: "C20", Talla: 233, Kg: 5.45,  FechaLote: "2026-06-17" },
  { Lote: "G220EM00-E00",   Clase: "C20", Talla: 237, Kg: 18.14, FechaLote: "2026-05-11" },
  { Lote: "G324TM05-E04-7", Clase: "C20", Talla: 237, Kg: 5.4,   FechaLote: "2026-06-10" },
  { Lote: "G120EM03-E04-5", Clase: "C20", Talla: 229, Kg: 20,    FechaLote: "2026-08-07" },
  { Lote: "G321SIFON-E",    Clase: "C26", Talla: 237, Kg: 9.07,  FechaLote: "2026-03-17" },
  { Lote: "ZZ9NOEXISTE",    Clase: "C20", Talla: 237, Kg: 3,     FechaLote: null },
];

(async () => {
  try {
    await prisma.$transaction(async (tx) => {
      // ── Piso de prueba en Pelado ───────────────────────────────────────────────────────────
      for (const p of PISO) {
        await tx.$executeRawUnsafe(`
          INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaDestino, Lote, Clase, Talla, FechaLote, Peso, UM, PesoKg, RegistradoPor)
          VALUES ('TRASLADO', ?, 'PELADO', ?, ?, ?, ?, ?, 'KG', ?, ?)`, HOY, p.Lote, p.Clase, p.Talla, p.FechaLote, p.Kg, p.Kg, OP);
      }
      const linea = async (lote: string, talla: number, fecha = HOY) =>
        (await saldoParaDestajo(tx, "PELADO", fecha)).find(l => l.Lote === lote && l.Talla === talla && !l.RemisionId);

      console.log("1. Lo que hay al piso de Pelado");
      const k = await linea("G240K025", 217);
      check(!!k && k.Kg === 976.1 && k.Legible, `G240K025 al piso con 976.1 kg (${k?.Kg})`);
      check(k?.LoteDestajo === componerCodigoLote("K025", HOY, ""), `toma el código del día: ${k?.LoteDestajo}`);
      const em = await linea("G719EM03-E05-7", 237);
      check(em?.LoteDestajo === componerCodigoLote("EM03-E05", HOY, "7"), `conserva el ciclo: ${em?.LoteDestajo}`);
      check((await linea("ZZ9NOEXISTE", 237))?.Legible === false, "un código que no se reconoce queda marcado ilegible");
      await falla(() => saldoParaDestajo(tx, "DESCONGELADO", HOY), /no alimenta Destajo/, "Descongelado no alimenta Destajo");

      console.log("2. Tomar del piso");
      const base = { RemisionId: null, Clase: "D30", Talla: 217, FechaLote: "2026-09-29" };
      const r1 = await tomarDelPiso(tx, { bodega: "PELADO", unificar: false, fecha: HOY, operador: OP,
        lineas: [{ ...base, Lote: "G240K025", Kg: 500 }] });
      const loteK = r1.lotes[0].Lote;
      let c = await cuadreLote(tx, loteK, "D30");
      check(c.Ingreso === 500 && c.Origen === "PISO", `nace ${loteK} D30 con 500 kg, origen PISO`);
      check((await linea("G240K025", 217))?.Kg === 476.1, "el piso baja a 476.1 kg");
      await tomarDelPiso(tx, { bodega: "PELADO", unificar: false, fecha: HOY, operador: OP,
        lineas: [{ ...base, Lote: "G240K025", Kg: 476.1 }] });
      c = await cuadreLote(tx, loteK, "D30");
      check(c.Ingreso === 976.1, `la segunda toma del mismo día se suma al lote: ${c.Ingreso}`);
      check(!(await linea("G240K025", 217)), "la línea desaparece del piso al tomarla toda");
      await falla(() => tomarDelPiso(tx, { bodega: "PELADO", unificar: false, fecha: HOY, operador: OP,
        lineas: [{ ...base, Lote: "G240K025", Kg: 1 }] }), /solo quedan 0\.00 kg/, "no se toma más de lo que hay");

      const emLineas = [
        { RemisionId: null, Lote: "G719EM03-E05-7", Clase: "C20", Talla: 237, FechaLote: "2026-06-17", Kg: 20 },
        { RemisionId: null, Lote: "G719EM03-E05-7", Clase: "C20", Talla: 233, FechaLote: "2026-06-17", Kg: 5.45 },
      ];
      const r2 = await tomarDelPiso(tx, { bodega: "PELADO", unificar: false, fecha: HOY, operador: OP, lineas: emLineas });
      check(r2.lotes.length === 1 && r2.lotes[0].Kg === 25.45, `dos tallas del mismo lote de origen van a un solo lote: ${r2.lotes[0].Lote} ${r2.lotes[0].Kg} kg`);
      const [ci]: any[] = await tx.$queryRawUnsafe(
        `SELECT c.Anio, c.Ciclo FROM Lotes l JOIN Ciclo c ON c.CicloId = l.CicloId WHERE l.Lote = ? AND l.Clase = 'C20'`, r2.lotes[0].Lote);
      check(Number(ci?.Ciclo) === 7 && Number(ci?.Anio) === 2026, `el ciclo es el del origen (2026/7), no el del día: ${ci?.Anio}/${ci?.Ciclo}`);

      console.log("3. Unificar");
      await falla(() => tomarDelPiso(tx, { bodega: "PELADO", unificar: true, fecha: HOY, operador: OP, lineas: [
        { RemisionId: null, Lote: "G220EM00-E00", Clase: "C20", Talla: 237, FechaLote: "2026-05-11", Kg: 18.14 },
        { RemisionId: null, Lote: "G324TM05-E04-7", Clase: "C20", Talla: 237, FechaLote: "2026-06-10", Kg: 5.4 },
      ] }), /misma finca/, "no se unifican dos fincas");
      const em719 = { RemisionId: null, Lote: "G719EM03-E05-7", Clase: "C20", Talla: 237, FechaLote: "2026-06-17" };
      const em120 = { RemisionId: null, Lote: "G120EM03-E04-5", Clase: "C20", Talla: 229, FechaLote: "2026-08-07" };
      const em220 = { RemisionId: null, Lote: "G220EM00-E00", Clase: "C20", Talla: 237, FechaLote: "2026-05-11" };
      const sifon = { RemisionId: null, Lote: "G321SIFON-E", Clase: "C26", Talla: 237, FechaLote: "2026-03-17" };
      await falla(() => tomarDelPiso(tx, { bodega: "PELADO", unificar: true, fecha: HOY, operador: OP,
        lineas: [{ ...em719, Kg: 10 }, { ...em120, Kg: 5 }] }), /Escoja con cuál lote/, "unificar sin escoger el lote se rechaza (no es automático)");
      const r3 = await tomarDelPiso(tx, { bodega: "PELADO", unificar: true, baseLote: "G719EM03-E05-7", fecha: HOY, operador: OP,
        lineas: [{ ...em719, Kg: 10 }, { ...em120, Kg: 5 }] });
      const lote719 = componerCodigoLote("EM03-E05", HOY, "7");
      check(r3.lotes.length === 1 && r3.lotes[0].Lote === lote719 && r3.lotes[0].Kg === 15,
        `escogido el de más kilos (G719EM03-E05-7 → ${r3.lotes[0].Lote}), entran los 15 kg`);
      check((await cuadreLote(tx, lote719, "C20")).Ingreso === 40.45, "y se suma al lote de ese código que ya existía hoy (25.45 + 15)");
      const r3b = await tomarDelPiso(tx, { bodega: "PELADO", unificar: true, baseLote: "G120EM03-E04-5", fecha: HOY, operador: OP,
        lineas: [{ ...em719, Kg: 13.58 }, { ...em120, Kg: 5 }] });
      const uni = r3b.lotes[0];
      check(r3b.lotes.length === 1 && uni.Lote === componerCodigoLote("EM03-E04", HOY, "5") && uni.Kg === 18.58,
        `con el lote escogido (el de menos kilos) va a ese: ${uni.Lote} ${uni.Kg} kg`);
      const origenes = (await movimientosDeLote(tx, uni.Lote, "C20")).filter(m => m.Tipo === "DESTAJO").map(m => m.LoteOrigen);
      check(origenes.includes("G719EM03-E05-7") && origenes.includes("G120EM03-E04-5"), `el unificado guarda de qué lotes vino: ${origenes.join(", ")}`);
      check((await linea("G220EM00-E00", 237))?.NoUnificable === true && (await linea("G321SIFON-E", 237))?.NoUnificable === true,
        "la pantalla sabe que el genérico y el sifón no se unifican");
      await falla(() => tomarDelPiso(tx, { bodega: "PELADO", unificar: true, baseLote: "G120EM03-E04-5", fecha: HOY, operador: OP,
        lineas: [{ ...em220, Kg: 1 }, { ...em120, Kg: 1 }] }), /van solos/, "un lote genérico (EM00-E00) no se unifica");
      await falla(() => tomarDelPiso(tx, { bodega: "PELADO", unificar: true, baseLote: "G120EM03-E04-5", fecha: HOY, operador: OP,
        lineas: [{ ...sifon, Kg: 1 }, { ...em120, Kg: 1 }] }), /van solos/, "un sifón no se unifica");
      await falla(() => tomarDelPiso(tx, { bodega: "PELADO", unificar: true, baseLote: "G999XX", fecha: HOY, operador: OP,
        lineas: [{ RemisionId: null, Lote: "G324TM05-E04-7", Clase: "C20", Talla: 237, FechaLote: "2026-06-10", Kg: 1 }] }),
        /no está entre los que escogió/, "el lote escogido tiene que estar entre los marcados");
      await tx.$executeRawUnsafe(`
        INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaDestino, Lote, Clase, Talla, FechaLote, Peso, UM, PesoKg, RegistradoPor)
        VALUES ('TRASLADO', ?, 'PELADO', 'G241K024', 'D30', 217, '2026-09-30', 10, 'KG', 10, ?)`, HOY, OP);
      await falla(() => tomarDelPiso(tx, { bodega: "PELADO", unificar: true, fecha: HOY, operador: OP, lineas: [
        { RemisionId: null, Lote: "G241K024", Clase: "D30", Talla: 217, FechaLote: "2026-09-30", Kg: 10 },
      ] }), /contenedor/, "maquila no se unifica (cada lote es un contenedor)");

      console.log("4. Choque con un lote capturado a mano");
      const tc = componerCodigoLote("TM05-E04", HOY, "7");
      const [pis]: any[] = await tx.$queryRawUnsafe(`SELECT PiscinaId FROM Piscina WHERE Nombre = 'TM05-E04'`);
      await tx.$executeRawUnsafe(`INSERT INTO Lotes (Lote, PiscinaId, Clase, Fecha, FechaProduccion, PesoIngreso, UM, RegistradoPor)
        VALUES (?, ?, 'C20', ?, ?, 5.4, 'KG', ?)`, tc, pis.PiscinaId, HOY, HOY, OP);
      await falla(() => tomarDelPiso(tx, { bodega: "PELADO", unificar: false, fecha: HOY, operador: OP, lineas: [
        { RemisionId: null, Lote: "G324TM05-E04-7", Clase: "C20", Talla: 237, FechaLote: "2026-06-10", Kg: 5.4 },
      ] }), /capturado a mano/, "no se suma el piso a un lote tecleado a mano (contaría doble)");

      console.log("5. Código ilegible: el encargado escoge la piscina");
      const [p2]: any[] = await tx.$queryRawUnsafe(`SELECT PiscinaId FROM Piscina WHERE Nombre = 'EM03-E05'`);
      await falla(() => tomarDelPiso(tx, { bodega: "PELADO", unificar: false, fecha: HOY, operador: OP, lineas: [
        { RemisionId: null, Lote: "ZZ9NOEXISTE", Clase: "C20", Talla: 237, FechaLote: null, Kg: 3 },
      ] }), /escójala a mano/, "sin piscina escogida se rechaza");
      const r5 = await tomarDelPiso(tx, { bodega: "PELADO", unificar: false, fecha: HOY, operador: OP, lineas: [
        { RemisionId: null, Lote: "ZZ9NOEXISTE", Clase: "C20", Talla: 237, FechaLote: null, Kg: 3, PiscinaId: Number(p2.PiscinaId), Ciclo: 7 },
      ] });
      check(r5.lotes[0].Lote === componerCodigoLote("EM03-E05", HOY, "7"), `con la piscina escogida va a ${r5.lotes[0].Lote}`);

      console.log("6. Bajar al piso y descarte");
      await bajarAlPiso(tx, { lote: loteK, clase: "D30", peso: 100, talla: 217, fecha: HOY, operador: OP });
      await falla(() => registrarDescarte(tx, { lote: loteK, clase: "D30", peso: 1, motivo: "Rojo", fecha: HOY, operador: OP }),
        /no es descarte/, "el rojo no se registra como descarte");
      await registrarDescarte(tx, { lote: loteK, clase: "D30", peso: 28.4, motivo: "Descarte", nota: "prueba", fecha: HOY, operador: OP });
      c = await cuadreLote(tx, loteK, "D30");
      check(c.Bajado === 100 && c.Descarte === 28.4 && c.Pendiente === 847.7,
        `cuadre: ingreso 976.1, bajado 100, descarte 28.4, pendiente ${c.Pendiente}`);
      const bajado = await linea(loteK, 217);
      check(!!bajado && bajado.Kg === 100 && bajado.EsBajado, "lo bajado aparece al piso de Pelado, marcado como bajado de la mesa");
      check(Math.abs(rendimientoLote(976.1, 100, 700) - 79.90) < 0.01,
        `rendimiento = procesado ÷ (ingreso − bajado): 700 ÷ 876.1 = ${rendimientoLote(976.1, 100, 700).toFixed(2)}%`);
      await falla(() => bajarAlPiso(tx, { lote: loteK, clase: "D30", peso: 900, fecha: HOY, operador: OP }),
        /solo le quedan 847\.70/, "no se baja más de lo que queda sin pesar");
      const [desc]: any[] = await tx.$queryRawUnsafe(
        `SELECT BodegaOrigen, BodegaDestino, Motivo FROM MovimientoPiso WHERE LoteProceso = ? AND Tipo = 'DESCARTE'`, loteK);
      check(desc.BodegaOrigen == null && desc.BodegaDestino == null && desc.Motivo === "Descarte: prueba", "el descarte no toca ningún piso");

      console.log("7. Al día siguiente se retoma lo bajado");
      const retoma = await tomarDelPiso(tx, { bodega: "PELADO", unificar: false, fecha: MANANA, operador: OP, lineas: [
        { RemisionId: null, Lote: loteK, Clase: "D30", Talla: 217, FechaLote: bajado!.FechaLote, Kg: 100 },
      ] });
      check(retoma.lotes[0].Lote === componerCodigoLote("K025", MANANA, "") && retoma.lotes[0].Lote !== loteK,
        `nace el lote del día siguiente: ${retoma.lotes[0].Lote}`);
      check(!(await linea(loteK, 217, MANANA)), "lo bajado ya no está al piso");

      console.log("8. Deshacer");
      const movK = await movimientosDeLote(tx, loteK, "D30");
      const bajadoId = movK.find(m => m.Tipo === "BAJADO")!.MovimientoId;
      await falla(() => deshacerMovimiento(tx, bajadoId), /ya se volvió a tomar/, "lo bajado que ya se retomó no se deshace");
      const tomaRetoma = (await movimientosDeLote(tx, retoma.lotes[0].Lote, "D30"))[0].MovimientoId;
      const d1 = await deshacerMovimiento(tx, tomaRetoma);
      check(d1.LoteBorrado === true, "devolver la única toma borra el lote del día siguiente (nunca existió)");
      check((await linea(loteK, 217, MANANA))?.Kg === 100, "y lo bajado vuelve a estar al piso");
      await deshacerMovimiento(tx, bajadoId);
      await deshacerMovimiento(tx, movK.find(m => m.Tipo === "DESCARTE")!.MovimientoId);
      c = await cuadreLote(tx, loteK, "D30");
      check(c.Bajado === 0 && c.Descarte === 0 && c.Pendiente === 976.1, "deshacer bajado y descarte deja el lote como estaba");
      await bajarAlPiso(tx, { lote: loteK, clase: "D30", peso: 900, fecha: HOY, operador: OP });
      const primeraToma = movK.find(m => m.Tipo === "DESTAJO")!.MovimientoId;   // la de 500 kg
      await falla(() => deshacerMovimiento(tx, primeraToma), /quedaría con 476\.10/,
        "no se devuelve una toma si el lote ya bajó o pesó más de lo que le quedaría");

      console.log("9. Devolver al piso el lote completo");
      await tx.$executeRawUnsafe(`
        INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaDestino, Lote, Clase, Talla, FechaLote, Peso, UM, PesoKg, RegistradoPor)
        VALUES ('TRASLADO', ?, 'PELADO', 'G521EM05-E01-8', 'C20', 237, '2026-07-01', 50, 'KG', 50, ?)`, HOY, OP);
      const lin = { RemisionId: null, Lote: "G521EM05-E01-8", Clase: "C20", Talla: 237, FechaLote: "2026-07-01" };
      const rd = await tomarDelPiso(tx, { bodega: "PELADO", unificar: false, fecha: HOY, operador: OP, lineas: [{ ...lin, Kg: 50 }] });
      const ld = rd.lotes[0].Lote;
      await bajarAlPiso(tx, { lote: ld, clase: "C20", peso: 10, motivo: "Rojo", nota: "oscuro", talla: 233, fecha: HOY, operador: OP });
      const rojo = await linea(ld, 233);
      check(!!rojo && rojo.Kg === 10 && rojo.EsBajado && rojo.EsRojo, "el rojo se baja al piso marcado para revisarlo otra vez");
      check((await cuadreLote(tx, ld, "C20")).Bajado === 10, "y cuenta como bajado (fuera del rendimiento), no como descarte");
      await registrarDescarte(tx, { lote: ld, clase: "C20", peso: 2, motivo: "Descarte", fecha: HOY, operador: OP });
      const [tp]: any[] = await tx.$queryRawUnsafe(`SELECT Proceso, ClasePT FROM TransaccionesProduccion ORDER BY TransaccionId DESC LIMIT 1`);
      await tx.$executeRawUnsafe(`INSERT INTO TransaccionesProduccion (Lote, ClaseOrigen, Proceso, ClasePT, Talla, AlmacenOrigen, AlmacenDestino, RegistradoPor)
        VALUES (?, 'C20', ?, ?, 237, 'PISO', 'PISO', ?)`, ld, tp.Proceso, tp.ClasePT, OP);
      const [ti]: any[] = await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`);
      await tx.$executeRawUnsafe(`INSERT INTO Termos (TransaccionId, NumeroTermo, AlmacenActual, Capacidad) VALUES (?, 'T-PRUEBA', 'PISO', 150)`, ti.id);
      const dv = await devolverLoteAlPiso(tx, ld, "C20");
      const [quedan]: any[] = await tx.$queryRawUnsafe(`
        SELECT (SELECT COUNT(*) FROM Lotes WHERE Lote = ? AND Clase = 'C20') AS lotes,
               (SELECT COUNT(*) FROM MovimientoPiso WHERE LoteProceso = ?) AS movs,
               (SELECT COUNT(*) FROM TransaccionesProduccion WHERE TransaccionId = ?) AS trans,
               (SELECT COUNT(*) FROM Termos WHERE TransaccionId = ?) AS termos`, ld, ld, ti.id, ti.id);
      check(Number(quedan.lotes) === 0 && Number(quedan.movs) === 0, `el lote ${ld} desaparece con su toma, su bajado y su descarte`);
      check(Number(quedan.trans) === 0 && Number(quedan.termos) === 0 && dv.Transacciones === 1, "su transacción vacía y su termo se borran");
      const vuelta = (await saldoParaDestajo(tx, "PELADO", HOY)).filter(l => l.Lote === "G521EM05-E01-8" || l.Lote === ld);
      check(vuelta.length === 1 && vuelta[0].Lote === "G521EM05-E01-8" && vuelta[0].Kg === 50,
        `el piso queda como antes de tomarlo: ${vuelta.map(v => `${v.Lote} ${v.Kg} kg`).join(", ")}`);
      await falla(() => devolverLoteAlPiso(tx, componerCodigoLote("TM05-E04", HOY, "7"), "C20"), /capturó a mano/,
        "un lote capturado a mano no se devuelve al piso");
      // loteK tiene 900 kg bajados (paso 8): los toma el lote del día siguiente.
      await tomarDelPiso(tx, { bodega: "PELADO", unificar: false, fecha: MANANA, operador: OP, lineas: [
        { RemisionId: null, Lote: loteK, Clase: "D30", Talla: 900, FechaLote: HOY, Kg: 900 }] });
      await falla(() => devolverLoteAlPiso(tx, loteK, "D30"), /ya se volvió a tomar/,
        "no se devuelve un lote cuyo bajado ya tomó otro lote");

      console.log("10. Cola de un lote entero (Descabezado → piso de Pelado)");
      check(esEntero("C26") && esEntero("C20") && !esEntero("D30") && !esEntero("C10"),
        "C26 (entero IQF) también se descabeza; D30 y C10 no");
      check(claseColaSugerida("C26", "G343EM-SIFON") === "D35" && claseColaSugerida("C26", "G343TM04-E04-6") === "D30"
        && claseColaSugerida("C24") === "D35" && claseColaSugerida("C25") === "D33",
        "la cola sugerida: sifón (por clase o por piscina) → D35, entero-R → D33, el resto D30");
      await tx.$executeRawUnsafe(`
        INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaDestino, Lote, Clase, Talla, FechaLote, Peso, UM, PesoKg, RegistradoPor)
        VALUES ('TRASLADO', ?, 'DESCABEZADO', 'G433TM04-E04-6', 'C20', 237, '2026-08-13', 100, 'KG', 100, ?)`, HOY, OP);
      const re = await tomarDelPiso(tx, { bodega: "DESCABEZADO", unificar: false, fecha: HOY, operador: OP,
        lineas: [{ RemisionId: null, Lote: "G433TM04-E04-6", Clase: "C20", Talla: 237, FechaLote: "2026-08-13", Kg: 100 }] });
      const le = re.lotes[0].Lote;
      const cola = (extra: any) => registrarCola(tx, { lote: le, clase: "C20", peso: 1, termo: "T-1", claseCola: "D30",
        talla: 233, fecha: HOY, operador: OP, ...extra });
      await falla(() => registrarCola(tx, { lote: loteK, clase: "D30", peso: 1, termo: "1", claseCola: "D30", fecha: HOY, operador: OP }),
        /no es un lote entero/, "un lote que no es entero no produce cola");
      await falla(() => cola({ claseCola: "E41" }), /La cola tiene que ser D30, D33, D34, D35/, "la cola solo puede ser D30, D33, D34 o D35");
      await falla(() => cola({ termo: "  " }), /Falta el número de termo/, "el número de termo es obligatorio");
      await cola({ peso: 40, termo: "T-5" });
      await cola({ peso: 22.5, termo: "T-6" });
      const ce = await cuadreLote(tx, le, "C20");
      check(ce.Cola === 62.5 && ce.Pendiente === 100,
        `la cola suma 62.5 en el lote y no toca el pendiente ni lo disponible para pesar (${ce.Pendiente})`);
      const enPelado = await linea(le, 233);
      check(!!enPelado && enPelado.Kg === 62.5 && enPelado.EsCola && enPelado.Clase === "D30",
        "los dos termos están al piso de Pelado como cola D30 (62.5 kg)");
      await falla(() => cola({ peso: 40, termo: "T-7" }), /más que lo trabajado/, "la cola no puede pasar de lo trabajado");
      const ren = rendimientosEntero(100, 0, 35, 62.5, 0);
      check(Math.abs(ren.RendimientoCola - 62.5) < 0.01 && Math.abs(ren.RendimientoTotal - 97.5) < 0.01 && ren.Diferencia === 2.5,
        `rendimientos: cola ${ren.RendimientoCola.toFixed(1)}%, cabeza + cola ${ren.RendimientoTotal.toFixed(1)}%, diferencia ${ren.Diferencia}`);
      const rp = await tomarDelPiso(tx, { bodega: "PELADO", unificar: false, fecha: HOY, operador: OP,
        lineas: [{ RemisionId: null, Lote: le, Clase: "D30", Talla: 233, FechaLote: HOY, Kg: 62.5 }] });
      check(rp.lotes[0].Lote === le && rp.lotes[0].Clase === "D30" && rp.lotes[0].Kg === 62.5,
        `Pelado la toma: nace ${rp.lotes[0].Lote} D30 con 62.5 kg, el mismo código del entero`);
      const termo5 = (await movimientosDeLote(tx, le, "C20")).find(m => m.Tipo === "COLA" && m.NumeroTermo === "T-5")!;
      await falla(() => deshacerMovimiento(tx, termo5.MovimientoId), /ya la tomó Pelado/, "una cola que Pelado ya tomó no se deshace");
      await falla(() => devolverLoteAlPiso(tx, le, "C20"), /ya tiene|ya la tomó Pelado/, "ni se devuelve el entero cuya cola ya tomó Pelado");
      await devolverLoteAlPiso(tx, le, "D30");
      await deshacerMovimiento(tx, termo5.MovimientoId);
      check((await cuadreLote(tx, le, "C20")).Cola === 22.5 && (await linea(le, 233))?.Kg === 22.5,
        "devuelto el D30 de Pelado, el termo T-5 se deshace y al piso queda el otro (22.5 kg)");

      throw new Revertir();
    }, { timeout: 180000, maxWait: 15000 });
  } catch (e) {
    if (!(e instanceof Revertir)) { console.error("ERROR", (e as any).message); mal++; }
  }

  const [q]: any[] = await prisma.$queryRawUnsafe(
    `SELECT (SELECT COUNT(*) FROM MovimientoPiso WHERE RegistradoPor = ?) AS m,
            (SELECT COUNT(*) FROM Lotes WHERE RegistradoPor = ? OR Fecha >= '2030-01-01') AS l`, OP, OP);
  check(Number(q.m) === 0 && Number(q.l) === 0, "todo revertido: 0 movimientos y 0 lotes de prueba en la base");
  console.log(`\n${ok} OK, ${mal} MAL`);
  await prisma.$disconnect();
  if (mal) process.exitCode = 1;
})();
