// Prueba del kardex de inventario al piso contra datos reales de producción.
//
// Reproduce la hoja de Descongelado del 21-sep-2026 (03:30, remisión RS-0031) completa: el ingreso
// desde bodega el día ANTERIOR, el consumo parcial, los traslados a Pelado y Clasificado Cola con
// peso real de báscula, una devolución a bodega y el cierre con la merma escrita como fila.
//
// Corre DENTRO de una transacción que siempre revierte. No hay base de desarrollo —  backend/.env
// apunta a producción—  así que el fixture se monta sobre datos reales y se deshace solo; nunca se
// limpia con DELETE.
//
// Lo que verifica, en orden: que el producto que bodega saca un día queda al piso del área hasta
// que alguien lo trabaje; que consumir solo parte deja el resto como saldo; que la hoja cierra en
// cero; que el saldo del día siguiente arrastra solo, sin proceso nocturno; y que el rendimiento
// sale de dividir traslado entre consumo.
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

// Hoja de Descongelado del 21-sep (03:30, RS-0031), dentro de una transacción que SIEMPRE revierte.
// Sin base de desarrollo el fixture se monta contra producción y se deshace solo.
// Fijate que el saldo NO mira el Tipo: toda fila se lee igual.
const SALDO = `
  SELECT Area, ROUND(SUM(Delta),2) AS Saldo FROM (
    SELECT AreaDestino AS Area,  PesoKg AS Delta FROM MovimientoPiso
      WHERE AreaDestino IS NOT NULL AND FechaProduccion <= ?
    UNION ALL
    SELECT AreaOrigen  AS Area, -PesoKg AS Delta FROM MovimientoPiso
      WHERE AreaOrigen  IS NOT NULL AND FechaProduccion <= ?
  ) t GROUP BY Area HAVING ABS(Saldo) > 0.001 ORDER BY Area`;

let fallas = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? " OK " : "FALLA"}  ${m}`); if (!c) fallas++; };
const r2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const [rem]: any[] = await prisma.$queryRawUnsafe(`SELECT RemisionId FROM Remisiones WHERE Folio='RS-0031'`);
  const [emp]: any[] = await prisma.$queryRawUnsafe(`SELECT Codigo FROM Empleados WHERE Estado='Activo' LIMIT 1`);

  try {
    await prisma.$transaction(async (tx) => {
      const ins = (cols: string, vals: string, args: any[]) =>
        tx.$executeRawUnsafe(`INSERT INTO MovimientoPiso (${cols},RegistradoPor) VALUES (${vals},'prueba')`, ...args);

      // ── 20-sep: bodega saca el producto. Entra al piso de Descongelado.
      for (const [lote, talla, masters, kgM] of [["G139K021",321,33,20.0],["G139K022",316,35,18.16]] as any[]) {
        const kg = r2(masters * kgM);
        await ins("Tipo,FechaProduccion,AreaDestino,Lote,Clase,Talla,Peso,UM,PesoKg,Masters,KgPorMaster,RemisionId",
          "'INGRESO','2026-09-20','DE',?,'D30',?,?,'KG',?,?,?,?", [lote, talla, kg, kg, masters, kgM, rem.RemisionId]);
      }
      let s: any[] = await tx.$queryRawUnsafe(SALDO, "2026-09-20", "2026-09-20");
      ok(Number(s[0]?.Saldo) === 1295.60, `20-sep: al piso de Descongelado quedan ${s[0]?.Saldo} kg`);

      // ── 21-sep: abre la hoja.
      await tx.$executeRawUnsafe(
        `INSERT INTO HojaProceso (AreaCodigo,FechaProduccion,HoraInicio,Propiedad,Encargado,Personas,Estatus,CreadoPor)
         VALUES ('DE','2026-09-21','2026-09-21 03:30:00','OROPSA',?,3,'Abierta','prueba')`, emp.Codigo);
      const [h]: any[] = await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`);
      const hoja = Number(h.id);

      // Sección 1 — el área entrega a la hoja. Del K022 solo se descongela parte.
      for (const [lote, talla, kg] of [["G139K021",321,660.00],["G139K022",316,400.00]] as any[])
        await ins("Tipo,FechaProduccion,AreaOrigen,HojaDestinoId,Lote,Clase,Talla,Peso,UM,PesoKg",
          "'CONSUMO','2026-09-21','DE',?,?,'D30',?,?,'KG',?", [hoja, lote, talla, kg, kg]);

      // Sección 2 — la hoja entrega al área siguiente, con su peso real de báscula.
      for (const [dest, lote, talla, kg] of [["DS","G139K021",321,651.40],["DM","G139K022",316,380.00]] as any[])
        await ins("Tipo,FechaProduccion,HojaOrigenId,AreaDestino,Lote,Clase,Talla,Peso,UM,PesoKg",
          "'TRASLADO','2026-09-21',?,?,?,'D30',?,?,'KG',?", [hoja, dest, lote, talla, kg, kg]);

      // Sección 3 — devolución a bodega.
      await ins("Tipo,FechaProduccion,HojaOrigenId,Lote,Clase,Talla,Peso,UM,PesoKg,Motivo",
        "'DEVOLUCION','2026-09-21',?,'G139K022','D30',316,?,'KG',?,'cambio de producción'", [hoja, 15.00, 15.00]);

      // ── Cierre: el cuadre de la hoja y la merma escrita como fila.
      const [c]: any[] = await tx.$queryRawUnsafe(`
        SELECT ROUND(SUM(CASE WHEN HojaDestinoId=? THEN PesoKg ELSE 0 END),2) AS entro,
               ROUND(SUM(CASE WHEN HojaOrigenId=?  THEN PesoKg ELSE 0 END),2) AS salio
        FROM MovimientoPiso WHERE HojaDestinoId=? OR HojaOrigenId=?`, hoja, hoja, hoja, hoja);
      const merma = r2(Number(c.entro) - Number(c.salio));
      ok(merma === 13.60, `merma del cuadre = ${merma} kg (entró ${c.entro}, salió ${c.salio})`);
      await ins("Tipo,FechaProduccion,HojaOrigenId,Lote,Clase,Talla,Peso,UM,PesoKg,Motivo",
        "'MERMA','2026-09-21',?,'G139K021','D30',900,?,'KG',?,'cuadre del día'", [hoja, merma, merma]);
      await tx.$executeRawUnsafe(
        `UPDATE HojaProceso SET Estatus='Cerrada',HoraFin='2026-09-21 07:20:00',CerradaPor='prueba',CerradaEn=NOW() WHERE HojaId=?`, hoja);

      // La hoja cerrada tiene que quedar en cero: todo lo que entró salió por algún lado.
      const [b]: any[] = await tx.$queryRawUnsafe(`
        SELECT ROUND(SUM(CASE WHEN HojaDestinoId=? THEN PesoKg ELSE -PesoKg END),2) AS bal
        FROM MovimientoPiso WHERE HojaDestinoId=? OR HojaOrigenId=?`, hoja, hoja, hoja);
      ok(Number(b.bal) === 0, `la hoja cierra en cero (balance ${b.bal})`);

      // ── Saldos
      s = await tx.$queryRawUnsafe(SALDO, "2026-09-21", "2026-09-21");
      const a = Object.fromEntries(s.map((x: any) => [x.Area, Number(x.Saldo)]));
      console.log("\n Saldo al cierre del 21-sep:", a, "\n");
      ok(a.DE === 235.60, `Descongelado conserva ${a.DE} kg al piso (lo que no se descongeló)`);
      ok(a.DS === 651.40, `Pelado recibe ${a.DS} kg`);
      ok(a.DM === 380.00, `Clasificado Cola recibe ${a.DM} kg`);

      const s22: any[] = await tx.$queryRawUnsafe(SALDO, "2026-09-22", "2026-09-22");
      const a22 = Object.fromEntries(s22.map((x: any) => [x.Area, Number(x.Saldo)]));
      ok(a22.DE === 235.60, `el 22-sep sigue ahí sin que nadie lo arrastre: ${a22.DE} kg`);

      const [rq]: any[] = await tx.$queryRawUnsafe(`
        SELECT ROUND(100 * SUM(CASE WHEN Tipo='TRASLADO' THEN PesoKg ELSE 0 END)
                         / SUM(CASE WHEN Tipo='CONSUMO'  THEN PesoKg ELSE 0 END),2) AS r
        FROM MovimientoPiso WHERE HojaOrigenId=? OR HojaDestinoId=?`, hoja, hoja);
      ok(Number(rq.r) === 97.30, `rendimiento de descongelado = ${rq.r} %`);

      throw new Error("ROLLBACK");
    });
  } catch (e: any) { if (e.message !== "ROLLBACK") throw e; }

  const [q]: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) n FROM MovimientoPiso`);
  const [q2]: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) n FROM HojaProceso`);
  ok(Number(q.n) === 0 && Number(q2.n) === 0, `revertido: MovimientoPiso=${q.n}, HojaProceso=${q2.n} filas`);
  console.log(fallas === 0 ? "\nTODO OK" : `\n${fallas} FALLAS`);
  await prisma.$disconnect();
  process.exit(fallas ? 1 : 0);
}
main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
