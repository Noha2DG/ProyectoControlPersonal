// Prueba de "Liberar materia prima" (lib/liberacionMP.ts + remisiones.ts) contra la base real, dentro
// de una transacción que SIEMPRE se revierte: no queda nada escrito.
//
// Monta un contenedor de prueba (piscina QPRUEBA de IM001, pendiente) y le cuelga, solo dentro de la
// transacción, la orden de etiquetado de un polín real que está en bodega. Después intenta sacarlo
// por remisión normal, por muestra, rechazado y liberado.
//
// Requiere el esquema de scripts/createLiberacionMateriaPrima.ts (tabla, columna y serie MA).
//
//   npx tsx scripts/probarLiberacionMP.ts
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";
import * as L from "../src/lib/liberacionMP.ts";
import { agregarMaster, agregarPallet, confirmarRemision } from "../src/routes/remisiones.ts";

const OP = "prueba-liberacion";
let ok = 0, mal = 0;
const check = (c: boolean, m: string) => { c ? ok++ : mal++; console.log(c ? "  OK " : "  MAL", m); };
async function falla(f: () => Promise<any>, patron: RegExp, m: string) {
  try { await f(); check(false, `${m} (no falló)`); }
  catch (e: any) { check(patron.test(e.message), `${m}: ${e.message}`); }
}
class Revertir extends Error {}

(async () => {
  try {
    await prisma.$transaction(async (tx) => {
      // Un polín Cerrado con al menos 4 masters libres de la misma orden, que no estén en ninguna remisión.
      const [p]: any[] = await tx.$queryRawUnsafe(`
        SELECT pal.PalletId, pal.Codigo, ei.OrdenId, COUNT(*) AS n
          FROM Masters m JOIN Pallets pal ON pal.PalletId = m.PalletId
          JOIN EtiquetaImpresa ei ON ei.EtiquetaId = m.EtiquetaId
         WHERE pal.Estatus = 'Cerrado' AND m.Estatus = 'EnBodega'
           AND NOT EXISTS (SELECT 1 FROM RemisionDetalle rd WHERE rd.MasterId = m.MasterId AND rd.Vigente = 1)
         GROUP BY pal.PalletId, pal.Codigo, ei.OrdenId HAVING COUNT(*) >= 4
         ORDER BY pal.PalletId DESC LIMIT 1`);
      const masters: any[] = await tx.$queryRawUnsafe(`
        SELECT m.MasterId, ei.Correlativo FROM Masters m JOIN EtiquetaImpresa ei ON ei.EtiquetaId = m.EtiquetaId
         WHERE m.PalletId = ? AND ei.OrdenId = ? AND m.Estatus = 'EnBodega' ORDER BY m.MasterId LIMIT 4`, p.PalletId, p.OrdenId);
      const [m1, m2, m3, m4] = masters.map(x => ({ id: Number(x.MasterId), corr: String(x.Correlativo) }));
      console.log(`Polín de prueba ${p.Codigo}, orden ${p.OrdenId}, masters ${masters.map(x => x.Correlativo).join(", ")}`);

      // Contenedor de prueba pendiente, y la orden de esos masters pasa a ser de él.
      await tx.$executeRawUnsafe(`INSERT INTO Piscina (CodigoFinca, Nombre) VALUES (?, 'QPRUEBA')`, L.FINCA_IMPORTACION);
      const [{ id: piscinaId }]: any[] = await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`);
      await tx.$executeRawUnsafe(`INSERT INTO LiberacionMateriaPrima (PiscinaId, Estado, CreadoPor) VALUES (?, 'PENDIENTE', ?)`, piscinaId, OP);
      await tx.$executeRawUnsafe(`UPDATE OrdenEtiquetado SET PiscinaId = ? WHERE OrdenId = ?`, piscinaId, p.OrdenId);

      const nueva = async (tipo: string, folio: string) => {
        await tx.$executeRawUnsafe(`INSERT INTO Remisiones (Folio, Tipo, Fecha, CreadoPor) VALUES (?, ?, '2030-01-07', ?)`, folio, tipo, OP);
        const [{ id }]: any[] = await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`);
        return Number(id);
      };
      const estatus = async (id: number) => String(((await tx.$queryRawUnsafe(`SELECT Estatus FROM Masters WHERE MasterId = ?`, id)) as any[])[0].Estatus);

      console.log("1. Pendiente de liberar");
      check((await L.contenedorSinLiberarDeOrden(tx, Number(p.OrdenId)))?.Estado === "PENDIENTE", "la orden se reconoce como de un contenedor pendiente");
      check(/QPRUEBA pendiente de liberar \(1 master\)/.test(String(await L.bloqueoDeSalida(tx, [m1.id], null))), "bloqueoDeSalida da el contenedor y cuántos masters");
      check(await L.bloqueoDeSalida(tx, [m1.id], L.DESTINO_MUESTRA) === null, "una muestra sí puede llevárselo");
      check(L.mensajeSoloPolinMP({ Contenedor: "QPRUEBA", Estado: "PENDIENTE" }, "T0001").includes("polín de materia prima (MP)"), "mensaje de polín no MP");

      const rs = await nueva("Reproceso", "ZZ-PRUEBA-1");
      await falla(() => agregarMaster(tx, rs, { Correlativo: m1.corr }, OP), /pendiente de liberar/, "escanear un master en un Reproceso se rechaza");
      await falla(() => agregarPallet(tx, rs, { Codigo: p.Codigo }, OP), /pendiente de liberar/, "escanear el polín entero se rechaza");
      check(await estatus(m1.id) === "EnBodega", "el master sigue en bodega");

      const ma = await nueva("MuestraAnalisis", "ZZ-PRUEBA-2");
      await agregarMaster(tx, ma, { Correlativo: m1.corr }, OP);
      check(await estatus(m1.id) === "Salido", "la muestra para análisis sí lo saca de bodega");
      const conf = await confirmarRemision(tx, ma, OP);
      check(conf.Masters === 1 && conf.PisoLineas === 0, `la muestra se confirma y no carga ningún piso (${conf.PisoLineas} líneas)`);

      console.log("2. Rechazado");
      await tx.$executeRawUnsafe(`UPDATE LiberacionMateriaPrima SET Estado = 'RECHAZADO' WHERE PiscinaId = ?`, piscinaId);
      await falla(() => agregarMaster(tx, rs, { Correlativo: m2.corr }, OP), /QPRUEBA rechazado/, "rechazado tampoco sale");

      console.log("3. Borrador armado antes de quedar pendiente");
      await tx.$executeRawUnsafe(`UPDATE LiberacionMateriaPrima SET Estado = 'LIBERADO' WHERE PiscinaId = ?`, piscinaId);
      await agregarMaster(tx, rs, { Correlativo: m2.corr }, OP);
      await tx.$executeRawUnsafe(`UPDATE LiberacionMateriaPrima SET Estado = 'PENDIENTE' WHERE PiscinaId = ?`, piscinaId);
      await falla(() => confirmarRemision(tx, rs, OP), /pendiente de liberar/, "confirmar se rechaza si el contenedor volvió a pendiente");

      console.log("4. Liberado");
      await tx.$executeRawUnsafe(`UPDATE LiberacionMateriaPrima SET Estado = 'LIBERADO' WHERE PiscinaId = ?`, piscinaId);
      check(await L.contenedorSinLiberarDeOrden(tx, Number(p.OrdenId)) === null, "liberado ya no se reconoce como pendiente");
      check(await L.bloqueoDeSalida(tx, [m3.id, m4.id], null) === null, "liberado no bloquea nada");
      await agregarMaster(tx, rs, { Correlativo: m3.corr }, OP);
      check(await estatus(m3.id) === "Salido", "liberado sale en un Reproceso normal");

      console.log("5. Contenedores de antes");
      const viejos: any[] = await tx.$queryRawUnsafe(`
        SELECT m.MasterId FROM Masters m JOIN EtiquetaImpresa ei ON ei.EtiquetaId = m.EtiquetaId
        JOIN OrdenEtiquetado oe ON oe.OrdenId = ei.OrdenId JOIN Piscina pi ON pi.PiscinaId = oe.PiscinaId
        WHERE pi.Nombre = 'Q012' AND m.Estatus = 'EnBodega' LIMIT 5`);
      check(await L.bloqueoDeSalida(tx, viejos.map(v => Number(v.MasterId)), null) === null, `Q012 no queda bloqueado (${viejos.length} masters revisados)`);

      throw new Revertir();
    }, { timeout: 120_000 });
  } catch (e: any) {
    if (!(e instanceof Revertir)) { console.error("ERROR:", e.message); mal++; }
  }
  console.log(`\n${ok} OK, ${mal} MAL (todo revertido)`);
  await prisma.$disconnect();
  process.exitCode = mal ? 1 : 0;
})();
