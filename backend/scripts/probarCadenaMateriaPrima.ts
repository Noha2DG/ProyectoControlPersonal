// Prueba de la cadena completa de Materia Prima tomada del piso, sobre main + b380ebd, contra la base
// real y dentro de una transacción que SIEMPRE se revierte: no queda nada escrito.
//
//   Bodega → piso de Descongelado → (hoja, descongelar marcado) → piso de Pelado / Descabezado
//   → Tomar del piso (lote de Destajo) → transacción + pesaje → bajar al piso / descarte
//   → rendimiento → al día siguiente se retoma lo bajado → deshacer
//
// Además prueba los choques entre módulos: Descongelado quitando o cambiando de destino un renglón
// que Pelado ya tomó, y editar el código de un lote tomado del piso.
//
//   npx tsx scripts/probarCadenaMateriaPrima.ts
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";
import { descongelarMarcado, cambiarDestino, quitarDescongelado } from "../src/routes/descongelado.ts";
import {
  saldoParaDestajo, tomarDelPiso, bajarAlPiso, registrarDescarte, deshacerMovimiento, cuadreLote,
  movimientosDeLote, rendimientoLote,
} from "../src/lib/destajoPiso.ts";

const OP = "prueba-cadena-mp";
const HOY = "2030-01-07", MANANA = "2030-01-08";
let ok = 0, mal = 0;
const check = (c: boolean, m: string, extra?: any) => {
  c ? ok++ : mal++;
  console.log(c ? "  OK " : "  MAL", m, !c && extra !== undefined ? JSON.stringify(extra) : "");
};
async function falla(f: () => Promise<any>, patron: RegExp, m: string) {
  try { await f(); check(false, `${m} (no falló)`); }
  catch (e: any) { check(patron.test(e.message), `${m}: ${e.message}`); }
}
class Revertir extends Error {}

(async () => {
  const rems: any[] = await prisma.$queryRawUnsafe(`SELECT RemisionId FROM Remisiones WHERE Estatus = 'Confirmada' ORDER BY RemisionId DESC LIMIT 1`);
  const R = Number(rems[0].RemisionId);
  // Dos piscinas de cultivo de la misma finca (con ciclo), para el lote suelto y el unificado.
  const pis: any[] = await prisma.$queryRawUnsafe(`
    SELECT Nombre, CodigoFinca FROM Piscina
     WHERE Activo = 1 AND Nombre NOT LIKE '%SIFON%' AND Nombre NOT LIKE '%00-E00%' AND CodigoFinca IN ('E0001')
     ORDER BY Nombre LIMIT 2`);
  const [p1, p2] = pis.map(p => String(p.Nombre));
  const A = { RemisionId: R, Lote: `G701${p1}-7`, Clase: "C20", Talla: 229, FechaLote: "2030-01-01", KgPorMaster: 5.448 };
  const B = { RemisionId: R, Lote: `G702${p2}-8`, Clase: "C20", Talla: 233, FechaLote: "2030-01-02", KgPorMaster: 5.448 };
  // Para el mes de Descabezado.
  const C = { RemisionId: R, Lote: `G703${p1}-9`, Clase: "C20", Talla: 229, FechaLote: "2030-01-03", KgPorMaster: 5.448 };
  // Lo que pide Transacción/Pesaje: un proceso, termo y empleado que ya existan.
  const [tp]: any[] = await prisma.$queryRawUnsafe(`SELECT Proceso, ClasePT, Talla FROM TransaccionesProduccion ORDER BY TransaccionId DESC LIMIT 1`);
  const [pd]: any[] = await prisma.$queryRawUnsafe(`SELECT TermoId, Codigo FROM PesajeDetalle ORDER BY PesajeId DESC LIMIT 1`);

  try {
    await prisma.$transaction(async (tx) => {
      const q = (s: string, ...a: any[]) => tx.$queryRawUnsafe(s, ...a) as Promise<any[]>;
      for (const [l, m] of [[A, 40], [B, 6], [C, 20]] as const) {
        const kg = Number((m * l.KgPorMaster).toFixed(2));
        await tx.$executeRawUnsafe(`
          INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaDestino, RemisionId, Lote, Clase, Talla, FechaLote,
                                      Peso, UM, PesoKg, Masters, KgPorMaster, RegistradoPor)
          VALUES ('INGRESO', ?, 'DESCONGELADO', ?, ?, ?, ?, ?, ?, 'KG', ?, ?, ?, ?)`,
          HOY, l.RemisionId, l.Lote, l.Clase, l.Talla, l.FechaLote, kg, kg, m, l.KgPorMaster, OP);
      }
      await tx.$executeRawUnsafe(`INSERT INTO HojaProceso (BodegaCodigo, FechaProduccion, CreadoPor) VALUES ('DESCONGELADO', ?, ?)`, HOY, OP);
      const [h]: any[] = await q(`SELECT LAST_INSERT_ID() AS id`);
      const hoja = Number(h.id);
      const lin = (l: any, Masters: number) => ({ ...l, Masters, UM: "KG" });
      const traslado = async (lote: string) =>
        (await q(`SELECT MovimientoId, BodegaDestino, PesoKg FROM MovimientoPiso WHERE HojaOrigenId = ? AND Tipo = 'TRASLADO' AND Lote = ?`, hoja, lote))[0];
      const pisoDe = async (bodega: string, fecha = HOY) => saldoParaDestajo(tx, bodega, fecha);
      const lineaDe = async (bodega: string, lote: string, fecha = HOY) => (await pisoDe(bodega, fecha)).find(l => l.Lote === lote);

      console.log("1. Descongelado manda a Pelado y a Descabezado");
      await descongelarMarcado(tx, hoja, { BodegaDestino: "PELADO", lineas: [lin(A, 40)] }, OP);
      await descongelarMarcado(tx, hoja, { BodegaDestino: "PELADO", BaseLote: B.Lote, lineas: [lin(B, 6)] }, OP);
      await descongelarMarcado(tx, hoja, { BodegaDestino: "DESCABEZADO", lineas: [lin(C, 20)] }, OP);
      const la = await lineaDe("PELADO", A.Lote);
      check(!!la && la.Kg === 217.92 && la.Legible && la.RemisionId === R, `el piso de Pelado ve ${A.Lote} con 217.92 kg y su remisión`, la);
      check(!!(await lineaDe("DESCABEZADO", C.Lote)) && !(await lineaDe("PELADO", C.Lote)), "lo de Descabezado solo aparece en Descabezado");

      console.log("2. Pelado toma del piso");
      const base = (l: any, Kg: number) => ({ RemisionId: l.RemisionId, Lote: l.Lote, Clase: l.Clase, Talla: l.Talla, FechaLote: l.FechaLote, Kg });
      const t1: any = await tomarDelPiso(tx, { bodega: "PELADO", unificar: false, fecha: HOY, operador: OP, lineas: [base(A, 150)] });
      const LA = t1.lotes[0].Lote;
      check(t1.lotes.length === 1 && t1.lotes[0].Kg === 150, `nace ${LA} con 150 kg`, t1);
      check((await lineaDe("PELADO", A.Lote))?.Kg === 67.92, "al piso de Pelado quedan 67.92 kg");
      await falla(() => tomarDelPiso(tx, { bodega: "DESCABEZADO", unificar: false, fecha: HOY, operador: OP, lineas: [base(A, 1)] }),
        /solo quedan 0.00 kg/, "Descabezado no puede tomar lo que está en el piso de Pelado");

      console.log("3. Descongelado ya no puede mover lo que Pelado tomó");
      const trA = await traslado(A.Lote);
      await falla(() => quitarDescongelado(tx, Number(trA.MovimientoId)), /ya tomó/, "quitar el renglón descongelado se niega");
      await falla(() => cambiarDestino(tx, Number(trA.MovimientoId), { BodegaDestino: "DESCABEZADO" }), /ya tomó/, "cambiarle el destino se niega");
      const trC = await traslado(C.Lote);
      await cambiarDestino(tx, Number(trC.MovimientoId), { BodegaDestino: "PELADO" });
      check(!!(await lineaDe("PELADO", C.Lote)) && !(await lineaDe("DESCABEZADO", C.Lote)), "lo que nadie tomó sí cambia de destino (Descabezado → Pelado)");

      console.log("4. Transacción y pesaje sobre el lote tomado");
      await tx.$executeRawUnsafe(`
        INSERT INTO TransaccionesProduccion (Lote, ClaseOrigen, Proceso, ClasePT, Talla, Estado, FechaHora, FechaProduccion, RegistradoPor)
        VALUES (?, 'C20', ?, ?, ?, 'Abierta', NOW(), ?, ?)`, LA, Number(tp.Proceso), String(tp.ClasePT), Number(tp.Talla), HOY, OP);
      const [ti]: any[] = await q(`SELECT LAST_INSERT_ID() AS id`);
      await tx.$executeRawUnsafe(`INSERT INTO PesajeDetalle (TransaccionId, TermoId, Codigo, Peso, UM, FechaHora, RegistradoPor) VALUES (?, ?, ?, 100, 'KG', NOW(), ?)`,
        Number(ti.id), Number(pd.TermoId), String(pd.Codigo), OP);
      let c = await cuadreLote(tx, LA, "C20");
      check(c.Ingreso === 150 && c.Procesado === 100 && c.Pendiente === 50, "cuadre: 150 de ingreso, 100 pesado, 50 pendiente", c);

      console.log("5. Bajar al piso y descarte");
      const b1: any = await bajarAlPiso(tx, { lote: LA, clase: "C20", peso: 30, fecha: HOY, operador: OP });
      check(b1.Bodega === "PELADO", "lo bajado vuelve al piso del que salió (Pelado)", b1);
      await registrarDescarte(tx, { lote: LA, clase: "C20", peso: 5, motivo: "Merma", fecha: HOY, operador: OP });
      await falla(() => bajarAlPiso(tx, { lote: LA, clase: "C20", peso: 16, fecha: HOY, operador: OP }), /solo le quedan 15.00/,
        "no se baja más de lo que queda sin pesar");
      c = await cuadreLote(tx, LA, "C20");
      check(c.Bajado === 30 && c.Descarte === 5 && c.Pendiente === 15, "cuadre: 30 bajado, 5 descarte, 15 pendiente", c);
      const rend = rendimientoLote(c.Ingreso, c.Bajado, c.Procesado);
      check(Math.abs(rend - 100 / 120 * 100) < 0.001, `rendimiento = 100 ÷ (150 − 30) = ${rend.toFixed(2)} %`);
      const bajado = (await pisoDe("PELADO")).find(l => l.Lote === LA);
      check(!!bajado && bajado.Kg === 30 && bajado.EsBajado, "lo bajado aparece al piso de Pelado como bajado de la mesa", bajado);

      console.log("6. Al día siguiente se retoma lo bajado");
      const lb = (await pisoDe("PELADO", MANANA)).find(l => l.Lote === LA)!;
      const t2: any = await tomarDelPiso(tx, { bodega: "PELADO", unificar: false, fecha: MANANA, operador: OP,
        lineas: [{ RemisionId: lb.RemisionId, Lote: lb.Lote, Clase: lb.Clase, Talla: lb.Talla, FechaLote: lb.FechaLote, Kg: 30 }] });
      const LB = t2.lotes[0].Lote;
      check(LB !== LA && t2.lotes[0].Kg === 30, `nace ${LB} con los 30 kg bajados`, t2);
      const [cic]: any[] = await q(`SELECT ci.Anio, ci.Ciclo FROM Lotes l JOIN Ciclo ci ON ci.CicloId = l.CicloId WHERE l.Lote = ? AND l.Clase = 'C20'`, LB);
      check(Number(cic?.Ciclo) === 7, `conserva el ciclo 7 del origen (${cic?.Anio}/${cic?.Ciclo})`);
      check(Number(cic?.Anio) === 2026, `el año del ciclo es el del lote de ORIGEN (G = 2026), no el del lote de Destajo: ${cic?.Anio}`);
      check(!(await pisoDe("PELADO", MANANA)).some(l => l.Lote === LA), "lo bajado ya no está al piso");
      await falla(async () => {
        const mv = (await movimientosDeLote(tx, LA, "C20")).find(m => m.Tipo === "BAJADO")!;
        return deshacerMovimiento(tx, mv.MovimientoId);
      }, /ya se volvió a tomar/, "el bajado ya retomado no se deshace");

      console.log("7. Editar el código de un lote tomado del piso (PUT /lotes, sin transacciones)");
      // Un lote del piso SIN transacciones: el PUT de lotes deja corregir ciclo o fecha de producción,
      // y eso regenera el código (mueve la llave). Se reproduce el UPDATE que hace ese PUT.
      const t3: any = await tomarDelPiso(tx, { bodega: "PELADO", unificar: false, fecha: HOY, operador: OP, lineas: [base(C, 50)] });
      const LC = t3.lotes[0].Lote, LC2 = LC.replace(/-9$/, "-6");
      await tx.$executeRawUnsafe(`UPDATE Lotes SET Lote = ? WHERE Lote = ? AND Clase = 'C20'`, LC2, LC);
      const movs = await movimientosDeLote(tx, LC2, "C20");
      check(movs.length === 1, `tras corregir el ciclo, ${LC2} sigue enlazado a su toma del piso (${movs.length} movimientos)`);
      const toma: any[] = await q(`SELECT MovimientoId FROM MovimientoPiso WHERE LoteProceso = ? AND Tipo = 'DESTAJO'`, LC2);
      try {
        await deshacerMovimiento(tx, Number(toma[0].MovimientoId));
        check(true, "la toma todavía se puede devolver al piso");
      } catch (e: any) {
        check(false, `la toma ya no se puede devolver al piso: "${e.message}" — los 50 kg quedan fuera del piso y fuera del lote`);
      }

      throw new Revertir();
    }, { timeout: 180000, maxWait: 15000 });
  } catch (e) {
    if (!(e instanceof Revertir)) { console.error("ERROR", (e as any).message); mal++; }
  }

  const [r]: any[] = await prisma.$queryRawUnsafe(
    `SELECT (SELECT COUNT(*) FROM MovimientoPiso WHERE RegistradoPor = ?) AS m,
            (SELECT COUNT(*) FROM Lotes WHERE RegistradoPor = ? OR Fecha >= '2030-01-01') AS l,
            (SELECT COUNT(*) FROM TransaccionesProduccion WHERE RegistradoPor = ?) AS t`, OP, OP, OP);
  check(Number(r.m) === 0 && Number(r.l) === 0 && Number(r.t) === 0, "todo revertido: nada de la prueba quedó en la base");
  console.log(`\n${ok} OK, ${mal} MAL`);
  await prisma.$disconnect();
  if (mal) process.exitCode = 1;
})();
