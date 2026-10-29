// Prueba de dos hojas de Descongelado abiertas a la vez (29 oct 2026): en ciertos horarios los dos
// turnos trabajan juntos. El marcaje dice quién estuvo en el ÁREA, no en qué hoja, así que al cerrar
// cada encargado marca quiénes trabajaron en la suya (HojaAuxiliar). Necesita la tabla:
//   npx tsx scripts/crearHojaAuxiliar.ts
// Contra la BASE REAL, dentro de una transacción que SIEMPRE se revierte, en una jornada de 2031 que
// no existe (ver feedback_probar_con_transaccion_revertida).
//
//   npx tsx scripts/probarDosHojasAbiertas.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { auxiliaresDeHoja, inicioSugerido, elegirAuxiliares } from "../src/routes/descongelado.ts";

const p = new PrismaClient();
const ROLLBACK = "__ROLLBACK_PRUEBA__";

let ok = 0, fallos = 0;
function check(nombre: string, condicion: boolean, detalle = "") {
  if (condicion) { ok++; console.log(`  OK   ${nombre}`); }
  else { fallos++; console.log(`  FALLA ${nombre} ${detalle}`); }
}

async function main() {
  const emp: any[] = await p.$queryRawUnsafe(`SELECT Codigo FROM Empleados WHERE Estado = 'Activo' ORDER BY Codigo LIMIT 6`);
  const [E1, E2, P1, P2, P3, P4] = emp.map(e => String(e.Codigo));
  const D = "2031-02-10";
  try {
    await p.$transaction(async (tx: any) => {
      const q = (sql: string, ...a: any[]) => tx.$queryRawUnsafe(sql, ...a) as Promise<any[]>;
      const x = (sql: string, ...a: any[]) => tx.$executeRawUnsafe(sql, ...a);
      const hoja = async (ini: string, enc: string) => {
        await x(`INSERT INTO HojaProceso (BodegaCodigo, FechaProduccion, HoraInicio, Propiedad, Encargado, Estatus, CreadoPor)
                 VALUES ('DESCONGELADO', ?, ?, 'OROPSA', ?, 'Abierta', 'prueba')`, D, ini, enc);
        return Number((await q(`SELECT LAST_INSERT_ID() AS id`))[0].id);
      };
      const marca = (cod: string, de: string, a: string) => x(
        `INSERT INTO Transferencias (Codigo, CodigoArea, FechaHora, FechaSalida, RegistradoPor)
         VALUES (?, 'DF', ?, ?, 'prueba')`, cod, de, a);
      // Lo mismo que hace POST /hojas/:id/cerrar con la lista que manda el encargado.
      const cerrar = async (id: number, fin: string, codigos: string[]) => {
        const gente: any = await auxiliaresDeHoja(tx, id, fin);
        const e: any = elegirAuxiliares(gente.lista, codigos);
        if (e.error) throw new Error(e.error);
        await x(`DELETE FROM HojaAuxiliar WHERE HojaId = ?`, id);
        for (const a of e.escogidos) await x(`INSERT INTO HojaAuxiliar (HojaId, Codigo, Minutos) VALUES (?, ?, ?)`, id, a.Codigo, a.Minutos);
        await x(`UPDATE HojaProceso SET Estatus = 'Cerrada', HoraFin = ?, Personas = ? WHERE HojaId = ?`, `${D} ${fin}:00`, e.escogidos.length, id);
      };
      const cods = (a: any) => a.lista.map((r: any) => r.Codigo).sort().join(",");
      const de = (a: any, cod: string) => a.lista.find((r: any) => r.Codigo === cod);

      // Turno A 06:00–14:00 (E1) y turno B desde 12:00 (E2): de 12 a 14 trabajan juntos.
      //   P1 06:00–14:00 (turno A)   P2 11:00–15:00 (cruza)   P3 12:00–18:00 (turno B)
      const A = await hoja(`${D} 06:00:00`, E1);
      const B = await hoja(`${D} 12:00:00`, E2);
      await marca(P1, `${D} 06:00:00`, `${D} 14:00:00`);
      await marca(P2, `${D} 11:00:00`, `${D} 15:00:00`);
      await marca(P3, `${D} 12:00:00`, `${D} 18:00:00`);
      await marca(P4, `${D} 19:00:00`, `${D} 20:00:00`);

      const abiertas = await q(`SELECT COUNT(*) AS n FROM HojaProceso WHERE FechaProduccion = ? AND Estatus = 'Abierta'`, D);
      check("1. dos hojas abiertas en la misma jornada", Number(abiertas[0].n) === 2);
      check("2. la segunda no sugiere el primer marcaje del día: los turnos están juntos",
        (await inicioSugerido(tx, "DESCONGELADO", D, B)) == null);
      check("3. y abrir una tercera tampoco sugiere hora", (await inicioSugerido(tx, "DESCONGELADO", D, null)) == null);

      let a: any = await auxiliaresDeHoja(tx, A, "14:00");
      check("4. la hoja A ve a todos los que marcaron en su horario, todos marcados", cods(a) === [P1, P2, P3].sort().join(",") &&
        a.lista.every((r: any) => r.Elegido && r.EnOtraHoja == null) && a.Personas === 3, JSON.stringify(a.lista));

      check("5. no se puede cerrar sin marcar a nadie", "error" in elegirAuxiliares(a.lista, []));
      check("6. no se puede marcar a quien no está en la lista", "error" in elegirAuxiliares(a.lista, [P1, P4]));

      // El encargado de A deja fuera a P3, que es del turno B.
      await cerrar(A, "14:00", [P1, P2]);
      a = await auxiliaresDeHoja(tx, A);
      check("7. cerrada, la hoja A cuenta solo a los que marcó su encargado", a.Personas === 2 && cods(a) === [P1, P2].sort().join(","), JSON.stringify(a));
      check("8. ... con los minutos que tenían al cerrar (P1 8 h, P2 3 h)", de(a, P1)?.Minutos === 480 && de(a, P2)?.Minutos === 180, JSON.stringify(a.lista));
      const [h]: any[] = await q(`SELECT Personas FROM HojaProceso WHERE HojaId = ?`, A);
      check("9. HojaProceso.Personas guarda ese mismo número", Number(h.Personas) === 2);

      let b: any = await auxiliaresDeHoja(tx, B, "18:00");
      check("10. la hoja B avisa que P1 y P2 ya van en la hoja A y los deja sin marcar",
        de(b, P1)?.EnOtraHoja === A && de(b, P1)?.Elegido === false && de(b, P2)?.EnOtraHoja === A && de(b, P2)?.Elegido === false, JSON.stringify(b.lista));
      check("11. P3 llega marcado y B cuenta 1 persona", de(b, P3)?.Elegido === true && b.Personas === 1, JSON.stringify(b));

      // B se queda también con P2, que de verdad trabajó en las dos.
      await cerrar(B, "18:00", [P2, P3]);
      b = await auxiliaresDeHoja(tx, B);
      check("12. B cerrada con P2 y P3: cuenta 2", b.Personas === 2 && cods(b) === [P2, P3].sort().join(","), JSON.stringify(b));
      check("13. A no cambió al cerrar B", (await auxiliaresDeHoja(tx, A)).Personas === 2);

      // Reabrir B y volver a cerrarla reemplaza su lista, no la suma.
      await x(`UPDATE HojaProceso SET Estatus = 'Abierta', HoraFin = NULL WHERE HojaId = ?`, B);
      b = await auxiliaresDeHoja(tx, B, "18:00");
      check("14. reabierta, B vuelve a traer marcados a los que había escogido", de(b, P2)?.Elegido === true && de(b, P3)?.Elegido === true && de(b, P1)?.Elegido === false, JSON.stringify(b.lista));
      await cerrar(B, "18:00", [P3]);
      const filas = await q(`SELECT Codigo FROM HojaAuxiliar WHERE HojaId = ?`, B);
      check("15. al cerrar otra vez, la lista de B se reemplaza", filas.length === 1 && filas[0].Codigo === P3, JSON.stringify(filas));

      // Una hoja cerrada antes de esto, sin lista: sigue contando a todos los del marcaje.
      const vieja = await hoja(`${D} 19:00:00`, E1);
      await x(`UPDATE HojaProceso SET Estatus = 'Cerrada', HoraFin = ? WHERE HojaId = ?`, `${D} 20:00:00`, vieja);
      const v: any = await auxiliaresDeHoja(tx, vieja);
      check("16. una hoja cerrada sin lista cuenta a todos los del marcaje", v.Personas === 1 && de(v, P4)?.Elegido === true, JSON.stringify(v));

      throw new Error(ROLLBACK);
    }, { timeout: 60_000 });
  } catch (err: any) {
    if (err.message !== ROLLBACK) { console.error("ERROR INESPERADO:", err.message); fallos++; }
  }

  const resto: any[] = await p.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM HojaProceso WHERE FechaProduccion = ?`, D);
  check("17. la transacción revirtió TODO el fixture", Number(resto[0].n) === 0);

  console.log(`\n${ok} OK, ${fallos} fallas`);
  await p.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main();
