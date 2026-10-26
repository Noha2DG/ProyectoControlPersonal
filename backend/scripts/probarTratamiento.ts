// Prueba de Tratamiento (lib/tratamiento.ts) contra la base real, dentro de una transacción que
// SIEMPRE se revierte: no queda nada escrito.
//
// Monta su propio piso en Tratamiento (PROCESADO como el que deja el cierre de Pelado) con lotes que
// empiezan con ZZ y fecha de 2030 para no chocar con nada real. Los pesos son los de la hoja de papel
// del 17-oct (Top Foods): el lote 61/70 en tres termos, uno que pierde peso y uno que gana 48 %.
//
// Requiere el esquema de scripts/createTratamiento.ts.
//
//   npx tsx scripts/probarTratamiento.ts
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";
import * as T from "../src/lib/tratamiento.ts";

const OP = "prueba-tratamiento";
const HOY = "2030-01-07";
const CLIENTE = 91; // TOP FOODS
let ok = 0, mal = 0;
const check = (c: boolean, m: string) => { c ? ok++ : mal++; console.log(c ? "  OK " : "  MAL", m); };
async function falla(f: () => Promise<any>, patron: RegExp, m: string) {
  try { await f(); check(false, `${m} (no falló)`); }
  catch (e: any) { check(patron.test(e.message), `${m}: ${e.message}`); }
}
class Revertir extends Error {}

const A = { RemisionId: null, Lote: "ZZ242EM04-E02-7", Clase: "E41", Talla: 351, FechaLote: "2030-01-06" }; // 61/70
const B = { RemisionId: null, Lote: "ZZ542-Q005",      Clase: "E41", Talla: 346, FechaLote: "2030-01-06" }; // 51/60

(async () => {
  console.log("0. Horas");
  check(T.horaCercana("2030-01-07 06:48:00", "05:00") === "2030-01-07 05:00:00", "un termo de las 05:00 en una hoja de las 06:48 es del mismo día");
  check(T.horaCercana("2030-01-07 22:00:00", "01:30") === "2030-01-08 01:30:00", "01:30 en una hoja de las 22:00 es del día siguiente");
  check(T.finDesdeHora("2030-01-07 23:00:00", "01:00") === "2030-01-08 01:00:00", "una salida antes del inicio cruzó la medianoche");
  check(T.pickup(167.21, 188.65) === 12.8 && T.pickup(168.71, 153.44) === -9.1, "pick-up ÷ sin tratar: termo 147 = 12.8 %, termo 318 = −9.1 %");
  check(T.alertaPickup(-9.1) === "PERDIDA" && T.alertaPickup(48.4) === "EXCEDE" && T.alertaPickup(20) === null, "alertas: negativo y arriba de 20 %");

  try {
    await prisma.$transaction(async (tx) => {
      for (const [l, kg] of [[A, 103], [B, 20]] as const) {
        await tx.$executeRawUnsafe(`
          INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaDestino, Lote, Clase, Talla, FechaLote, Peso, UM, PesoKg, RegistradoPor)
          VALUES ('PROCESADO', ?, 'TRATAMIENTO', ?, ?, ?, ?, ?, 'KG', ?, ?)`, HOY, l.Lote, l.Clase, l.Talla, l.FechaLote, kg, kg, OP);
      }
      const piso = async (bodega: string, l: any) =>
        (await T.saldoPiso(tx, bodega, [l.Lote])).find(x => T.claveDe(x) === T.claveDe(l))?.Kg ?? 0;
      const saldoHoja = async (id: number) => {
        const [s]: any[] = await tx.$queryRawUnsafe(`
          SELECT ROUND(COALESCE(SUM(CASE WHEN HojaDestinoId = ? THEN PesoKg END), 0) - COALESCE(SUM(CASE WHEN HojaOrigenId = ? THEN PesoKg END), 0), 2) AS s
            FROM MovimientoPiso WHERE HojaDestinoId = ? OR HojaOrigenId = ?`, id, id, id, id);
        return Number(s.s);
      };

      console.log("1. La hoja");
      check((await piso("TRATAMIENTO", A)) === 103, "el piso de Tratamiento tiene 103 kg del lote 61/70");
      check((await T.destinos(tx)).some(d => d.Codigo === "TUNEL") && !(await T.destinos(tx)).some(d => ["PELADO", "MASTERIZADO", "TRATAMIENTO"].includes(d.Codigo)),
        "los destinos van hacia adelante: Túnel sí; Pelado, Masterizado y Tratamiento no");
      await falla(() => T.crearHoja(tx, { fecha: HOY, cliente: 999999, operador: OP }), /no existe/, "un cliente que no existe");
      const { HojaId: h } = await T.crearHoja(tx, { fecha: HOY, cliente: CLIENTE, horaInicio: "06:48", operador: OP });
      await falla(() => T.crearHoja(tx, { fecha: HOY, cliente: CLIENTE, operador: OP }), /Ya hay una hoja abierta/, "una sola hoja abierta por cliente y día");

      console.log("2. Entrada de termos");
      const e = (l: any, NumeroTermo: string, HoraInicio: string, KgSinTratar: number, extra: any = {}) =>
        T.registrarEntrada(tx, h, { ...l, NumeroTermo, HoraInicio, KgSinTratar, ConteoInicial: 62, Quimico: "CARNAL", ...extra }, OP);
      const t35 = (await e(A, "35", "05:00", 56.59)).TermoId;
      const [hi]: any[] = await tx.$queryRawUnsafe(`SELECT DATE_FORMAT(HoraInicio, '%H:%i') AS h FROM HojaProceso WHERE HojaId = ?`, h);
      check(hi.h === "05:00", "el termo de las 05:00 corre el inicio de la hoja (abierta a las 06:48)");
      const t19 = (await e(A, "19", "08:10", 4.22)).TermoId;
      const t16 = (await e(A, "16", "08:10", 41.59)).TermoId;
      check((await piso("TRATAMIENTO", A)) === 0.6, `los tres termos bajan 102.40 kg del piso: quedan 0.60 (${await piso("TRATAMIENTO", A)})`);
      await falla(() => e(A, "99", "08:30", 1.0), /diferencia de báscula/, "un termo que pesa más de lo que hay al piso pregunta");
      const t99 = await e(A, "99", "08:30", 1.0, { AceptarDiferencia: true });
      check(t99.KgDiferencia === 0.4 && (await piso("TRATAMIENTO", A)) === 0, "aceptado: 0.40 kg entran como diferencia y el piso queda en cero, no en negativo");
      await T.eliminarTermo(tx, t99.TermoId);
      check((await piso("TRATAMIENTO", A)) === 0.6, "quitar ese termo devuelve sus kilos y borra su diferencia: el piso vuelve a 0.60");
      await falla(() => e(B, "70", "08:40", 50), /revise el peso/, "50 kg contra 20 al piso ya no es báscula: es un número mal tecleado");
      await falla(() => e(B, "70", "08:40", 8.92, { Quimico: "SAL" }), /no es un químico/, "la sal no es un tipo de químico");
      const t70 = (await e(B, "70", "08:40", 8.92, { ConteoInicial: 52 })).TermoId;

      console.log("3. Salida de termos");
      const s = (id: number, HoraSalida: string, KgTratadas: number, BodegaDestino = "TUNEL") =>
        T.registrarSalida(tx, id, { HoraSalida, KgTratadas, BodegaDestino, ConteoFinal: 58 }, OP);
      await falla(() => s(t35, "07:00", 54.44, "PELADO"), /a dónde va/, "lo tratado no regresa a Pelado");
      const s35 = await s(t35, "07:00", 54.44);
      check(s35.Pickup === -3.8 && s35.Alerta === "PERDIDA", `termo 35: 56.59 → 54.44 = ${s35.Pickup} %, alerta de pérdida`);
      check((await piso("TUNEL", A)) === 54.44, "lo tratado del 35 ya está al piso del Túnel");
      await s(t19, "10:10", 4.80);
      await s(t16, "10:10", 45.36);
      const s70 = await s(t70, "10:40", 13.24, "EMPANIZADO");
      check(s70.Pickup === 48.4 && s70.Alerta === "EXCEDE", `termo 70: 8.92 → 13.24 = ${s70.Pickup} %, pasa del máximo`);
      check((await saldoHoja(h)) === 0, "la hoja cuadra en cero: consumo + ganancia = traslado + merma");

      const termos = await T.termosDeHoja(tx, h);
      const x35 = termos.find(t => t.TermoId === t35)!;
      check(x35.Minutos === 120 && x35.KgGanados === -2.15, "el 35 trae su tiempo (2 h) y su pérdida (−2.15 kg)");
      const tot = T.totales(termos);
      check(tot.KgRecibidos === 111.32 && tot.KgTratados === 117.84 && tot.KgGanados === 6.52 && tot.Pickup === 5.9,
        `totales: ${tot.KgRecibidos} recibidos, ${tot.KgTratados} tratados, ${tot.KgGanados} ganados, ${tot.Pickup} %`);
      await s(t19, "10:15", 4.85);
      check((await T.termosDeHoja(tx, h)).find(t => t.TermoId === t19)!.KgTratadas === 4.85 && (await piso("TUNEL", A)) === 104.65,
        "corregir una salida la reemplaza: no suma dos veces al Túnel");

      console.log("4. Insumos");
      await T.guardarInsumos(tx, h, [{ Codigo: "CARNAL", Cantidad: 90 }, { Codigo: "SAL", Cantidad: 80 }, { Codigo: "HIELO", Cantidad: "" }], OP);
      const ins = (await T.detalleHoja(tx, h)).Insumos;
      check(ins.find(i => i.Codigo === "CARNAL")?.Cantidad === 90 && ins.find(i => i.Codigo === "HIELO")?.Cantidad == null, "se guarda el consumo de Carnal y sal; el hielo vacío no");
      await falla(() => T.guardarInsumos(tx, h, [{ Codigo: "AGUA", Cantidad: 10 }], OP), /no es un insumo/, "el agua no está en el catálogo");
      check((await T.detalleHoja(tx, h)).Insumos.find(i => i.Codigo === "CARNAL")?.Cantidad === 90, "una lista rechazada no borra lo que ya estaba");

      console.log("5. Cerrar y reabrir");
      await falla(() => T.eliminarHoja(tx, h), /ya tiene termos/, "una hoja con termos no se elimina");
      const t31 = (await e(B, "31", "11:00", 5.0)).TermoId;
      await falla(() => T.cerrarHoja(tx, h, { operador: OP }), /Falta la salida/, "no se cierra con un termo en termo");
      await T.eliminarTermo(tx, t31);
      const lineas = await T.lineasDeHoja(tx, h);
      const lA = lineas.find(l => l.Lote === A.Lote)!, lB = lineas.find(l => l.Lote === B.Lote)!;
      check(lA.KgAlPiso === 0.6 && lB.KgAlPiso === 11.08, "al cerrar se ofrecen los lotes con kilos al piso: 0.60 y 11.08");
      await T.cerrarHoja(tx, h, { terminar: [lA.Clave], personas: 2, operador: OP });
      check((await piso("TRATAMIENTO", A)) === 0 && (await piso("TRATAMIENTO", B)) === 11.08,
        "el lote terminado deja 0.60 de diferencia y sale del piso; el otro sigue al piso");
      check((await saldoHoja(h)) === 0, "con la diferencia, la hoja sigue cuadrando en cero");

      console.log("5b. Reporte de la jornada");
      const rep = await T.reporteDia(tx, HOY);
      const C = rep.Cuadre;
      const cierra = Math.abs(C.InicioKg + C.RecibidoKg - C.TomadoTermosKg - C.DiferenciasKg - C.OtrasSalidasKg - C.AlPisoKg) < 0.01;
      check(cierra && C.RecibidoKg === 123 && C.TomadoTermosKg === 111.32 && C.DiferenciasKg === 0.6 && C.OtrasSalidasKg === 0,
        `cuadre del piso: ${C.InicioKg} + ${C.RecibidoKg} − ${C.TomadoTermosKg} − ${C.DiferenciasKg} = ${C.AlPisoKg}`);
      check(rep.AlPiso.find(l => l.Lote === B.Lote)?.Kg === 11.08 && !rep.AlPiso.some(l => l.Lote === A.Lote),
        "queda al piso solo lo del lote B (11.08); el A se dio por terminado");
      check(rep.Hojas.length === 1 && rep.Totales.KgTratados === 117.89 && rep.Totales.Pickup === 5.9,
        `la hoja del día: ${rep.Totales.KgTratados} kg tratados, ${rep.Totales.Pickup} % de pick-up`);
      check(rep.Totales.Alertas === 2 && rep.PorDestino.find(d => d.Destino === "Túnel")?.Kg === 104.65,
        "2 termos con alerta en el total; al Túnel salieron 104.65 kg");
      const lA2 = rep.PorLote.find(g => g.Lote === A.Lote)!;
      check(lA2.Termos === 3 && lA2.KgSinTratar === 102.4 && lA2.KgTratadas === 104.65 && lA2.Pickup === 2.2,
        `por lote: el 61/70 en 3 termos, 102.40 → 104.65 = ${lA2.Pickup} %`);
      check(rep.Insumos.find(i => i.Codigo === "CARNAL")?.Por100Kg === 76.34, "insumos: 90 kg de Carnal = 76.34 kg por 100 kg tratados");
      await falla(() => e(B, "31", "11:00", 5.0), /cerrada/, "una hoja cerrada no recibe termos");
      await T.reabrirHoja(tx, h);
      check((await piso("TRATAMIENTO", A)) === 0.6, "reabrir borra la diferencia y los 0.60 vuelven al piso");

      console.log("6. Lo que ya tomó el siguiente proceso no se deshace");
      await tx.$executeRawUnsafe(`
        INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaOrigen, Lote, Clase, Talla, FechaLote, Peso, UM, PesoKg, RegistradoPor)
        VALUES ('CONSUMO', ?, 'EMPANIZADO', ?, ?, ?, ?, 13.24, 'KG', 13.24, ?)`, HOY, B.Lote, B.Clase, B.Talla, B.FechaLote, OP);
      await falla(() => T.deshacerSalida(tx, t70), /ya lo tomó/, "Empanizado ya tomó lo del termo 70: su salida no se quita");
      await falla(() => T.eliminarTermo(tx, t70), /ya lo tomó/, "ni se elimina el termo");
      await T.deshacerSalida(tx, t19);
      check((await piso("TUNEL", A)) === 99.8 && (await T.termosDeHoja(tx, h)).find(t => t.TermoId === t19)!.KgTratadas == null,
        "el 19 sí se puede: sale del Túnel y vuelve a quedar en termo");

      console.log("7. Tratar lo marcado del piso y sacar varios termos juntos");
      const C2 = { RemisionId: null, Lote: "ZZ442JG001", Clase: "E41", Talla: 336, FechaLote: "2030-01-06" };   // 36/40
      await tx.$executeRawUnsafe(`
        INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaDestino, Lote, Clase, Talla, FechaLote, Peso, UM, PesoKg, RegistradoPor)
        VALUES ('PROCESADO', ?, 'TRATAMIENTO', ?, ?, ?, ?, 340, 'KG', 340, ?)`, HOY, C2.Lote, C2.Clase, C2.Talla, C2.FechaLote, OP);
      const termo = (l: any, NumeroTermo: string, KgSinTratar: number) => ({ ...l, NumeroTermo, HoraInicio: "05:00", ConteoInicial: 39, Quimico: "CARNAL", KgSinTratar });
      const t1 = await T.tratarDelPiso(tx, { fecha: HOY, cliente: 60, encargado: null, horaInicio: "05:00",
        termos: [termo(C2, "147", 167.21), termo(C2, "164", 164.01)], operador: OP });
      check(t1.HojaNueva && t1.Termos.length === 2 && (await piso("TRATAMIENTO", C2)) === 8.78,
        `"Tratar" abre la hoja de J&G (#${t1.HojaId}) con los termos 147 y 164; quedan 8.78 kg al piso`);
      const antes = await T.termosDeHoja(tx, t1.HojaId);
      await falla(() => T.tratarDelPiso(tx, { fecha: HOY, cliente: 60, termos: [termo(C2, "200", 3), termo(C2, "201", 50)], operador: OP }),
        /Renglón 2:.*revise el peso/, "si un renglón falla, el error dice cuál");
      check((await piso("TRATAMIENTO", C2)) === 8.78 && (await T.termosDeHoja(tx, t1.HojaId)).length === antes.length,
        "y no queda escrito ninguno: ni el renglón 1, que estaba bien");
      await falla(() => T.tratarDelPiso(tx, { fecha: HOY, cliente: 10, termos: [termo(C2, "300", 50)], operador: OP }),
        /Renglón 1:/, "un lote fallido para un cliente sin hoja");
      check((await T.listarHojas(tx, HOY)).every(h => h.ClienteCodigo !== 10), "tampoco deja una hoja vacía de ese cliente");
      const t2 = await T.tratarDelPiso(tx, { fecha: HOY, cliente: 60, termos: [termo(C2, "200", 8.78)], operador: OP });
      check(!t2.HojaNueva && t2.HojaId === t1.HojaId, "el mismo cliente el mismo día: se suma a su hoja abierta, no abre otra");
      await T.registrarSalidas(tx, { horaSalida: "07:00", destino: "TUNEL", operador: OP, salidas: [
        { TermoId: t1.Termos[0].TermoId, KgTratadas: 188.65, ConteoFinal: 32 }, { TermoId: t1.Termos[1].TermoId, KgTratadas: 181.97, ConteoFinal: 34 }] });
      const jg = await T.termosDeHoja(tx, t1.HojaId);
      check(jg.filter(t => t.KgTratadas != null).length === 2 && jg.every(t => t.KgTratadas == null || (t.Minutos === 120 && t.NombreDestino === "Túnel"))
        && jg.find(t => t.NumeroTermo === "147")!.Pickup === 12.8,
        "los dos salen juntos a las 07:00 al Túnel, cada uno con sus kilos (147: +12.8 %)");
      await falla(() => T.registrarSalidas(tx, { horaSalida: "07:10", destino: "TUNEL", operador: OP, salidas: [
        { TermoId: t2.Termos[0].TermoId, KgTratadas: 9.5 }, { TermoId: 999999999, KgTratadas: 1 }] }), /Renglón 2:/, "una salida en lote también dice qué renglón falló");
      check((await T.termosDeHoja(tx, t1.HojaId)).find(t => t.NumeroTermo === "200")!.KgTratadas == null,
        "y el termo 200, que iba bien en ese lote, sigue sin salida");

      throw new Revertir();
    }, { timeout: 180000, maxWait: 15000 });
  } catch (e) {
    if (!(e instanceof Revertir)) { console.error("ERROR", (e as any).message); mal++; }
  }

  const [q]: any[] = await prisma.$queryRawUnsafe(
    `SELECT (SELECT COUNT(*) FROM MovimientoPiso WHERE RegistradoPor = ?) AS m,
            (SELECT COUNT(*) FROM HojaProceso WHERE CreadoPor = ?) AS h`, OP, OP);
  check(Number(q.m) === 0 && Number(q.h) === 0, "todo revertido: 0 movimientos y 0 hojas de prueba en la base");
  console.log(`\n${ok} OK, ${mal} MAL`);
  await prisma.$disconnect();
  if (mal) process.exitCode = 1;
})();
