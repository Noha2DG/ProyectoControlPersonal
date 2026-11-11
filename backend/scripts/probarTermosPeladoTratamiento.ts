// Prueba: Tratamiento toma termos de Pelado sin esperar el cierre de la transacción
// (lib/tratamiento.ts, tomarTermoDePelado). Corre contra la base real dentro de UNA transacción que
// siempre se revierte. No toca transacciones reales de Pelado: arma la suya sobre un lote viejo, con
// dos termos y sus pesadas, para no bloquear a nadie que esté pesando.
//
//   npx tsx scripts/probarTermosPeladoTratamiento.ts
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";
import * as T from "../src/lib/tratamiento.ts";
import { infoCierre, cerrarTransaccion, reabrirTransaccion } from "../src/lib/destajoPiso.ts";
import { termoEnTratamiento } from "../src/routes/pesajeDetalle.ts";

let ok = 0, mal = 0;
const ver = (c: boolean, m: string) => { console.log(`  ${c ? "OK " : "MAL"} ${m}`); c ? ok++ : mal++; };
const OP = "prueba-termos-pelado-tratamiento";
const HOY = "2026-11-10";
const REVERTIR = "REVERTIR";

async function falla(f: () => Promise<any>, patron: RegExp, m: string) {
  try { await f(); ver(false, `${m} (no falló)`); }
  catch (e: any) { ver(patron.test(String(e?.message)), `${m}: ${e?.message}`); return e; }
}

try {
  await prisma.$transaction(async tx => {
    // ── Fixture: transacción de Pelado propia, dos termos con pesadas ──
    const [lote]: any[] = await tx.$queryRawUnsafe(`
      SELECT l.Lote, l.Clase FROM Lotes l JOIN Clase c ON c.Clase = l.Clase
       WHERE l.Activo = 1 AND l.Fecha < DATE_SUB(CURDATE(), INTERVAL 20 DAY) AND l.UM = 'KG'
         AND NOT EXISTS (SELECT 1 FROM TransaccionesProduccion tp WHERE tp.Lote = l.Lote AND tp.ClaseOrigen = l.Clase AND tp.Estado = 'Abierta')
       ORDER BY l.Fecha DESC LIMIT 1`);
    const [emp]: any[] = await tx.$queryRawUnsafe(`SELECT Codigo FROM Empleados WHERE Estado = 'Activo' ORDER BY Codigo LIMIT 1`);
    const [cli]: any[] = await tx.$queryRawUnsafe(`
      SELECT c.Codigo FROM Pedidos p JOIN Clientes c ON c.Codigo = p.CodigoCliente WHERE p.Estatus = 'Proceso' LIMIT 1`);
    await tx.$executeRawUnsafe(`
      INSERT INTO TransaccionesProduccion (Lote, ClaseOrigen, Proceso, ClasePT, Talla, FechaProduccion, RegistradoPor)
      VALUES (?, ?, 41, 'E41', 321, ?, ?)`, lote.Lote, lote.Clase, HOY, OP);
    const [tr]: any[] = await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`);
    const TID = Number(tr.id);
    const termo = async (n: string, pesos: number[]) => {
      await tx.$executeRawUnsafe(`INSERT INTO Termos (TransaccionId, NumeroTermo, AlmacenActual, Capacidad) VALUES (?, ?, NULL, 150)`, TID, n);
      const [t]: any[] = await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`);
      for (const p of pesos) {
        await tx.$executeRawUnsafe(`INSERT INTO PesajeDetalle (TransaccionId, TermoId, Codigo, Peso, RegistradoPor) VALUES (?, ?, ?, ?, ?)`,
          TID, Number(t.id), emp.Codigo, p, OP);
      }
    };
    await termo("P901", [60.5, 70.25, 45]);    // 175.75 kg, lleno
    await termo("P902", [30.1, 20]);           //  50.10 kg, todavía se llena
    console.log(`Transacción de prueba #${TID} sobre ${lote.Lote} ${lote.Clase}`);

    // ── 1. Tratamiento ve los termos de Pelado ──
    console.log("1. Termos en Pelado");
    let enPelado = (await T.termosEnPelado(tx)).filter((x: any) => x.TransaccionId === TID);
    ver(enPelado.length === 2, `se ven los 2 termos de la transacción (${enPelado.map((x: any) => `${x.NumeroTermo}=${x.Kg}`).join(", ")})`);
    const p901 = enPelado.find((x: any) => x.NumeroTermo === "P901");
    ver(p901?.Kg === 175.75 && p901?.Pesadas === 3, "P901: 175.75 kg en 3 pesadas");

    // ── 2. Tomar P901 ──
    console.log("2. Tomar el termo");
    await falla(() => T.tratarDelPiso(tx, { fecha: HOY, cliente: cli.Codigo, operador: OP, termos: [],
      termosPelado: [{ TransaccionId: TID, NumeroTermo: "P901", HoraInicio: "08:00", Kg: 170 }] }),
      /cambió mientras lo escogía/, "si los kg vistos no son los de ahora (entró otra pesada), se rechaza");
    const r = await T.tratarDelPiso(tx, { fecha: HOY, cliente: cli.Codigo, operador: OP, termos: [],
      termosPelado: [{ TransaccionId: TID, NumeroTermo: "P901", HoraInicio: "08:00", Kg: 175.75 }] });
    const hoja = r.HojaId;
    const termosHoja = await T.termosDeHoja(tx, hoja);
    const th = termosHoja.find((x: any) => x.NumeroTermo === "P901");
    ver(!!th && th.KgSinTratar === 175.75 && th.TransaccionPelado === TID, `queda en la hoja #${hoja} como termo P901 con 175.75 kg y la transacción #${TID}`);
    enPelado = (await T.termosEnPelado(tx)).filter((x: any) => x.TransaccionId === TID);
    ver(enPelado.length === 1 && enPelado[0].NumeroTermo === "P902", "P901 ya no sale en Termos en Pelado; P902 sí");
    const saldoTrat = (await T.saldoPiso(tx)).filter((x: any) => x.Lote === lote.Lote && x.Clase === "E41" && x.Talla === 321);
    ver(saldoTrat.length === 0, "el piso de Tratamiento no se queda con nada: entró y se consumió en el mismo paso");
    await falla(() => T.tratarDelPiso(tx, { fecha: HOY, cliente: cli.Codigo, operador: OP, termos: [],
      termosPelado: [{ TransaccionId: TID, NumeroTermo: "P901", HoraInicio: "08:00" }] }),
      /ya tomó el termo P901/, "no se puede tomar dos veces");

    // ── 3. Pelado ya no pesa en P901 ──
    console.log("3. Bloqueo en Pelado");
    const b1 = await termoEnTratamiento(tx, TID, "P901");
    ver(!!b1 && /Tratamiento tomó el termo P901/.test(b1.error) && b1.error.includes(`hoja #${hoja}`), `pesar en P901 se rechaza: ${b1?.error}`);
    ver((await termoEnTratamiento(tx, TID, "P902")) === null, "en P902 se sigue pesando");
    await falla(() => T.editarEntrada(tx, th!.TermoId, { KgSinTratar: 100 }), /pesadas de Pelado/, "en la hoja no se cambian los kg de un termo de Pelado");
    await falla(() => T.editarEntrada(tx, th!.TermoId, { NumeroTermo: "X1" }), /termo de Pelado/, "ni su número");

    // ── 4. Cerrar y reabrir la transacción de Pelado ──
    console.log("4. Cierre de Pelado");
    const info = await infoCierre(tx, TID);
    ver(info.Procesado === 225.85 && info.TomadoTratamiento === 175.75 && info.PorTrasladar === 50.1,
      `procesado 225.85, Tratamiento ya tomó 175.75, al cerrar se trasladan ${info.PorTrasladar}`);
    await cerrarTransaccion(tx, TID, { destino: "TRATAMIENTO" }, HOY, OP);
    const filas: any[] = await tx.$queryRawUnsafe(
      `SELECT NumeroTermo, Peso FROM MovimientoPiso WHERE TransaccionId = ? AND Tipo = 'PROCESADO' ORDER BY MovimientoId`, TID);
    ver(filas.length === 2 && Number(filas[1].Peso) === 50.1 && filas[1].NumeroTermo == null,
      `el cierre traslada solo los 50.10 kg restantes (${filas.map(f => `${f.NumeroTermo ?? "cierre"}=${Number(f.Peso)}`).join(", ")})`);
    await falla(() => T.eliminarTermo(tx, th!.TermoId), /ya se cerró: reábrala/, "con Pelado cerrado, quitar el termo pide reabrir la transacción");

    // Lo del piso entra tal como llega: la línea completa, sin número de termo ni kg tecleados.
    const linea = (await T.saldoPiso(tx)).find((x: any) => x.Lote === lote.Lote && x.Clase === "E41" && x.Talla === 321);
    const rl = await T.tratarDelPiso(tx, { fecha: HOY, cliente: cli.Codigo, operador: OP, termosPelado: [], termos: [{
      RemisionId: linea.RemisionId, Lote: linea.Lote, Clase: linea.Clase, Talla: linea.Talla, FechaLote: linea.FechaLote,
      HoraInicio: "09:00", TodaLaLinea: true, KgSinTratar: 1 } as any] });
    const tl = (await T.termosDeHoja(tx, rl.HojaId)).find((x: any) => x.TermoId === rl.Termos[0].TermoId);
    ver(linea.Termos === "P902", `la línea del piso trae de guía los termos que no se llevó Tratamiento (${linea.Termos})`);
    ver(!!tl && tl.NumeroTermo === "P902" && tl.KgSinTratar === 50.1,
      `la línea entra completa (${tl?.KgSinTratar} kg) con la guía de termos (${tl?.NumeroTermo}); los kg tecleados se ignoran`);
    await T.eliminarTermo(tx, tl!.TermoId);   // vuelve al piso para seguir con la prueba

    // Lo del piso se trata POR TERMO: la línea trae sus termos y cada uno entra completo.
    const det = linea.TermosDetalle;
    ver(det.length === 1 && det[0].TransaccionId === TID && det[0].NumeroTermo === "P902" && det[0].Kg === 50.1,
      `la línea del piso se divide en sus termos (${det.map((t: any) => `${t.NumeroTermo}=${t.Kg}`).join(", ")})`);
    const rt = await T.tratarDelPiso(tx, { fecha: HOY, cliente: cli.Codigo, operador: OP, termosPelado: [], termos: [{
      RemisionId: linea.RemisionId, Lote: linea.Lote, Clase: linea.Clase, Talla: linea.Talla, FechaLote: linea.FechaLote,
      HoraInicio: "09:30", TermoPiso: true, NumeroTermo: "P902", TransaccionTermo: TID } as any] });
    const tt = (await T.termosDeHoja(tx, rt.HojaId)).find((x: any) => x.TermoId === rt.Termos[0].TermoId);
    ver(!!tt && tt.NumeroTermo === "P902" && tt.KgSinTratar === 50.1 && tt.TransaccionPelado === TID && !tt.TomadoDePelado,
      `el termo P902 del piso entra completo (${tt?.KgSinTratar} kg) con su número, marcado como del piso`);
    const sigue = (await T.saldoPiso(tx)).find((x: any) => x.Lote === lote.Lote && x.Clase === "E41" && x.Talla === 321);
    ver(!sigue, "y la línea ya no tiene nada al piso");
    await falla(() => T.tratarDelPiso(tx, { fecha: HOY, cliente: cli.Codigo, operador: OP, termosPelado: [], termos: [{
      RemisionId: linea.RemisionId, Lote: linea.Lote, Clase: linea.Clase, Talla: linea.Talla, FechaLote: linea.FechaLote,
      HoraInicio: "09:30", TermoPiso: true, NumeroTermo: "P902", TransaccionTermo: TID } as any] }),
      /ya no tiene kilos al piso|ya no está al piso/, "no se puede meter dos veces el mismo termo");
    const q2 = await T.eliminarTermo(tx, tt!.TermoId);
    ver(q2.VolvioAPelado === false, "quitarlo de la hoja lo regresa al piso (no a Pelado), aunque Pelado ya cerró");
    await reabrirTransaccion(tx, TID);
    const tras: any[] = await tx.$queryRawUnsafe(
      `SELECT NumeroTermo FROM MovimientoPiso WHERE TransaccionId = ? AND Tipo = 'PROCESADO'`, TID);
    ver(tras.length === 1 && tras[0].NumeroTermo === "P901", "reabrir deshace solo lo del cierre; el termo tomado sigue en Tratamiento");

    // ── 5. Quitar el termo de la hoja: vuelve a Pelado ──
    console.log("5. Devolver a Pelado");
    const q = await T.eliminarTermo(tx, th!.TermoId);
    ver(q.VolvioAPelado === true, "quitar el termo de la hoja lo devuelve a Pelado");
    ver((await termoEnTratamiento(tx, TID, "P901")) === null, "P901 vuelve a aceptar pesadas");
    enPelado = (await T.termosEnPelado(tx)).filter((x: any) => x.TransaccionId === TID);
    ver(enPelado.length === 2, "y vuelve a salir en Termos en Pelado");
    const info2 = await infoCierre(tx, TID);
    ver(info2.TomadoTratamiento === 0 && info2.PorTrasladar === 225.85, "al cerrar, Pelado vuelve a trasladar todo");

    // ── 6. Si falla un termo, no queda nada escrito ──
    console.log("6. Todo o nada");
    await falla(() => T.tratarDelPiso(tx, { fecha: HOY, cliente: cli.Codigo, operador: OP, termos: [],
      termosPelado: [{ TransaccionId: TID, NumeroTermo: "P901", HoraInicio: "08:00" }, { TransaccionId: TID, NumeroTermo: "NOEXISTE", HoraInicio: "08:00" }] }),
      /NOEXISTE de Pelado: El termo NOEXISTE no tiene pesadas/, "un termo sin pesadas hace fallar el lote");
    ver((await termoEnTratamiento(tx, TID, "P901")) === null, "y P901, que iba bien en ese lote, no quedó tomado");

    throw new Error(REVERTIR);
  }, { timeout: 240000, maxWait: 30000 });
} catch (e: any) { if (e.message !== REVERTIR) throw e; }

const n: any[] = await prisma.$queryRawUnsafe(
  `SELECT (SELECT COUNT(*) FROM MovimientoPiso WHERE RegistradoPor = ?) + (SELECT COUNT(*) FROM TransaccionesProduccion WHERE RegistradoPor = ?) AS n`, OP, OP);
ver(Number(n[0].n) === 0, "todo revertido: 0 movimientos y 0 transacciones de prueba en la base");
console.log(`\n${ok} OK, ${mal} MAL`);
await prisma.$disconnect();
