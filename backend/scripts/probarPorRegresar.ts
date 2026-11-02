// Prueba de "aceptar solo lo que se usa" (2 nov 2026, RS-0112): bodega entrega los polines completos,
// Descongelado acepta al piso solo la cantidad que va a usar y el resto queda PENDIENTE. Antes de
// cerrar la remisión, bodega lo quita de ella o lo escanea en un polín nuevo de devolución; con
// pendientes no se confirma. El área cuenta masters, no etiquetas: si bodega saca una caja que no
// estaba marcada, se intercambia con una marcada del mismo producto sin mover el piso.
// Necesita las columnas: npx tsx scripts/alterRemisionDetallePorRegresar.ts
// Contra la BASE REAL, dentro de una transacción que SIEMPRE se revierte (ver
// feedback_probar_con_transaccion_revertida). Los rechazos ocurren antes de escribir.
//
//   npx tsx scripts/probarPorRegresar.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { agregarPallet, confirmarRemision, devolverMaster, eliminarBorrador, quitarLineas } from "../src/routes/remisiones.ts";
import { porEntregar, recibirPolines, deshacerRecepcion } from "../src/routes/descongelado.ts";

const p = new PrismaClient();
const ROLLBACK = "__ROLLBACK_PRUEBA__";
const OP = "prueba";

let ok = 0, fallos = 0;
function check(nombre: string, condicion: boolean, detalle = "") {
  if (condicion) { ok++; console.log(`  OK   ${nombre}`); }
  else { fallos++; console.log(`  FALLA ${nombre} ${detalle}`); }
}

async function main() {
  try {
    await p.$transaction(async (tx: any) => {
      const q = (sql: string, ...a: any[]) => tx.$queryRawUnsafe(sql, ...a) as Promise<any[]>;
      const x = (sql: string, ...a: any[]) => tx.$executeRawUnsafe(sql, ...a);
      const id = async () => Number((await q(`SELECT LAST_INSERT_ID() AS id`))[0].id);
      async function esperarError(nombre: string, fn: () => Promise<any>, texto: string) {
        try { await fn(); check(nombre, false, "(no lanzó error)"); }
        catch (err: any) {
          if (err.message === ROLLBACK) throw err;
          check(nombre, String(err.message).includes(texto), `→ "${err.message}"`);
        }
      }

      // ── Fixture: un pedido, una orden, polines del MISMO lote y talla ──────────────────────────
      const cli = await q(`SELECT Codigo FROM Clientes LIMIT 1`);
      const det = await q(`
        SELECT cl.Clase, cl.Proceso, t.Codigo AS Talla, pr.Codigo AS Presentacion, pr.CajasXMaster
        FROM Clase cl JOIN Tallas t JOIN Presentacion pr WHERE pr.PesoKG > 0 LIMIT 1`);
      const bv = await q(`SELECT Codigo FROM BodegaVirtual WHERE Activo = 1 LIMIT 1`);
      const area = await q(`SELECT Codigo FROM Areas LIMIT 1`);
      const org = await q(`SELECT Codigo FROM Origen LIMIT 1`);
      const pis = await q(`SELECT PiscinaId FROM Piscina LIMIT 1`);
      const emp = await q(`SELECT Codigo FROM Empaques LIMIT 1`);
      const cong = await q(`SELECT Codigo FROM UnidadesCongelacion LIMIT 1`);
      const serieArea = await q(`SELECT Tipo FROM SerieRemision WHERE Destino = 'Area' AND Activo = 1 LIMIT 1`);

      const PEDIDO = "ZZPRUEBA_REG";
      await x(`INSERT INTO Pedidos (CodigoPedido, CodigoCliente, Descripcion, FechaInicio, Estatus)
               VALUES (?, ?, 'PRUEBA AUTOMATICA (revertida)', CURDATE(), 'Proceso')`, PEDIDO, cli[0].Codigo);
      await x(`INSERT INTO DetallePedido (CodigoPedido, Clase, Proceso, Talla, Presentacion, EmpaqueMaster, CantidadCajas, KgPedido, LibrasPedido)
               VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`,
        PEDIDO, det[0].Clase, det[0].Proceso, det[0].Talla, det[0].Presentacion, emp[0].Codigo, Number(det[0].CajasXMaster) * 100);
      const detalleId = await id();
      await x(`INSERT INTO OrdenEtiquetado (Lote, PiscinaId, Ciclo, DetalleId, AreaCodigo, FechaProduccion, Color, Origen, Congelacion, CantidadMaster, Estatus, RegistradoPor)
               VALUES ('ZZPRUEBA', ?, '1', ?, ?, CURDATE(), 'sc', ?, ?, 50, 'Pendiente', 'prueba')`,
        pis[0].PiscinaId, detalleId, area[0].Codigo, org[0].Codigo, cong[0].Codigo);
      const ordenId = await id();
      const nuevoPallet = async (estatus = "Cerrado") => {
        const codigo = "ZZ" + Math.random().toString(36).slice(2, 8).toUpperCase();
        await x(`INSERT INTO Pallets (Codigo, Estatus, Origen, CantidadMaster, BodegaVirtualCodigo, CreadoPor)
                 VALUES (?, ?, ?, 50, ?, 'prueba')`, codigo, estatus, org[0].Codigo, bv[0].Codigo);
        return { palletId: await id(), codigo };
      };
      const nuevoMaster = async (palletId: number) => {
        await x(`INSERT INTO EtiquetaImpresa (OrdenId, Estatus, RegistradoPor, Correlativo) VALUES (?, 'Activa', 'prueba', UUID_SHORT())`, ordenId);
        const etiquetaId = await id();
        await x(`UPDATE EtiquetaImpresa SET Correlativo = ? WHERE EtiquetaId = ?`, "E" + etiquetaId, etiquetaId);
        await x(`INSERT INTO Masters (PalletId, EtiquetaId, Estatus, IngresadoPor) VALUES (?, ?, 'EnBodega', 'prueba')`, palletId, etiquetaId);
        return { masterId: await id(), correlativo: "E" + etiquetaId };
      };
      const nuevaRemision = async () => {
        await x(`INSERT INTO Remisiones (Folio, Tipo, Estatus, Fecha, BodegaDestino, CreadoPor)
                 VALUES (?, ?, 'Borrador', CURDATE(), 'DESCONGELADO', 'prueba')`, "ZZ-REG-" + Math.random().toString(36).slice(2, 6), serieArea[0].Tipo);
        return await id();
      };
      // Masters de la remisión al piso (saldo: lo que entró menos lo que salió).
      const pisoM = async (r: number) => Number((await q(`
        SELECT COALESCE(SUM(CASE WHEN BodegaDestino = 'DESCONGELADO' THEN Masters ELSE -Masters END), 0) AS m
        FROM MovimientoPiso WHERE RemisionId = ? AND (BodegaDestino = 'DESCONGELADO' OR BodegaOrigen = 'DESCONGELADO')`, r))[0].m);
      const estado = async (r: number, palletId: number) => (await q(`
        SELECT SUM(rd.RecibidoEn IS NOT NULL) AS rec, SUM(rd.PorRegresarEn IS NOT NULL) AS reg, COUNT(*) AS vig
        FROM RemisionDetalle rd JOIN Masters m ON m.MasterId = rd.MasterId
        WHERE rd.RemisionId = ? AND rd.Vigente = 1 AND m.PalletId = ?`, r, palletId)).map(e => ({
          rec: Number(e.rec ?? 0), reg: Number(e.reg ?? 0), vig: Number(e.vig) }))[0];
      const filasDe = async (r: number) => (await porEntregar(tx, "DESCONGELADO")).filter((f: any) => f.RemisionId === r);
      const renglon = (f: any, Masters?: number) => ({ PalletId: f.PalletId, Lote: f.Lote, Clase: f.Clase, Talla: f.Talla, FechaLote: f.FechaLote, Masters });
      const devolver = (correlativo: string, D: any) =>
        devolverMaster(tx, { correlativo, palletDestinoId: D.palletId, motivo: "no se usó", operador: OP, esAdmin: false });

      const P1 = await nuevoPallet(); const m1 = [];
      for (let i = 0; i < 4; i++) m1.push(await nuevoMaster(P1.palletId));
      const P2 = await nuevoPallet(); const m2 = [];
      for (let i = 0; i < 3; i++) m2.push(await nuevoMaster(P2.palletId));
      const D = await nuevoPallet("Abierto");   // el polín de devolución donde bodega escanea lo que regresa
      const R = await nuevaRemision();
      await agregarPallet(tx, R, { Codigo: P1.codigo }, OP);
      await agregarPallet(tx, R, { Codigo: P2.codigo }, OP);

      // ── El área acepta solo lo que va a usar ────────────────────────────────────────────────────
      let f = await filasDe(R);
      const f1 = f.find((r: any) => r.PalletId === P1.palletId), f2 = f.find((r: any) => r.PalletId === P2.palletId);
      check("1. el área ve los dos polines completos, aún en bodega", f.length === 2 && f1?.Masters === 4 && f2?.Masters === 3, JSON.stringify(f));

      await esperarError("2. no acepta más de lo que trae el renglón",
        () => recibirPolines(tx, { RemisionId: R, Lineas: [renglon(f1, 5)] }, OP), "escriba de 0 a 4");
      await esperarError("3. ni una cantidad negativa",
        () => recibirPolines(tx, { RemisionId: R, Lineas: [renglon(f1, -1)] }, OP), "escriba de 0 a 4");
      check("4. ... y no tocó nada", (await pisoM(R)) === 0 && (await estado(R, P1.palletId)).rec === 0);

      const r1: any = await recibirPolines(tx, { RemisionId: R, Lineas: [renglon(f1, 1)] }, OP);
      let e1 = await estado(R, P1.palletId);
      check("5. acepta 1 de 4: entra 1 al piso y 3 quedan pendientes",
        r1.Masters === 1 && r1.PorRegresar === 3 && (await pisoM(R)) === 1 && e1.rec === 1 && e1.reg === 3, JSON.stringify({ r1, e1 }));
      f = await filasDe(R);
      check("6. por entregar muestra lo pendiente (no lo esconde como lo recibido)",
        f.some((r: any) => r.PalletId === P1.palletId && r.PorRegresar && r.Masters === 3), JSON.stringify(f));

      const r2: any = await recibirPolines(tx, { RemisionId: R, Lineas: [renglon(f2, 0)] }, OP);
      check("7. acepta 0 de P2: nada al piso, los 3 pendientes", r2.Masters === 0 && r2.PorRegresar === 3 && (await pisoM(R)) === 1);

      // ── Con pendientes no se confirma ───────────────────────────────────────────────────────────
      await esperarError("8. confirmar con pendientes se niega y dice cuántos y de qué polín",
        () => confirmarRemision(tx, R, OP), `no usó 6 master(s): 3 de ${[P1.codigo, P2.codigo].sort()[0]}`);
      const est = await q(`SELECT Estatus FROM Remisiones WHERE RemisionId = ?`, R);
      check("9. ... y la remisión sigue en borrador, con el piso igual", est[0].Estatus === "Borrador" && (await pisoM(R)) === 1);

      // ── Bodega los saca y los escanea en un polín nuevo ─────────────────────────────────────────
      const marcados1: any[] = await q(`SELECT MasterId, PorRegresarEn IS NOT NULL AS reg FROM RemisionDetalle WHERE RemisionId = ? AND Vigente = 1 AND MasterId IN (${m1.map(m => m.masterId).join(",")})`, R);
      const unoMarcado = m1.find(m => marcados1.some(r => Number(r.MasterId) === m.masterId && Number(r.reg) === 1))!;
      const elRecibido = m1.find(m => marcados1.some(r => Number(r.MasterId) === m.masterId && Number(r.reg) === 0))!;
      const d1: any = await devolver(unoMarcado.correlativo, D);
      const mv = await q(`SELECT Estatus, PalletId FROM Masters WHERE MasterId = ?`, unoMarcado.masterId);
      check("10. escanear uno pendiente en el polín nuevo: vuelve a bodega ahí, sin tocar el piso",
        d1.PorRegresar === true && d1.PisoKg === 0 && mv[0].Estatus === "EnBodega" && Number(mv[0].PalletId) === D.palletId && (await pisoM(R)) === 1,
        JSON.stringify({ d1, mv }));
      const kx = await q(`SELECT Motivo FROM MovimientosBodega WHERE MasterId = ? AND Tipo = 'DEVOLUCION' AND RemisionId = ?`, unoMarcado.masterId, R);
      check("11. el kardex dice que regresó sin usar", kx.length === 1 && /Regresó sin usar/.test(kx[0].Motivo), JSON.stringify(kx));

      // La caja que de verdad regresó es la que el sistema contaba como aceptada: se intercambia.
      const d2: any = await devolver(elRecibido.correlativo, D);
      e1 = await estado(R, P1.palletId);
      check("12. escanear la caja 'aceptada' mientras hay pendientes: se intercambia y el piso no cambia",
        d2.PorRegresar === true && d2.PisoKg === 0 && (await pisoM(R)) === 1 && e1.vig === 2 && e1.rec === 1 && e1.reg === 1,
        JSON.stringify({ d2, e1 }));

      // ── O bodega les da de baja en la remisión ──────────────────────────────────────────────────
      const lineaPend: any[] = await q(`SELECT rd.DetalleId, rd.MasterId FROM RemisionDetalle rd JOIN Masters m ON m.MasterId = rd.MasterId WHERE rd.RemisionId = ? AND rd.Vigente = 1 AND rd.PorRegresarEn IS NOT NULL AND m.PalletId = ?`, R, P1.palletId);
      await quitarLineas(tx, R, { detalleId: Number(lineaPend[0].DetalleId) }, OP);
      e1 = await estado(R, P1.palletId);
      const mq = await q(`SELECT Estatus, PalletId FROM Masters WHERE MasterId = ?`, Number(lineaPend[0].MasterId));
      check("13. Quitar una línea pendiente: vuelve a su polín y el piso no cambia",
        mq[0].Estatus === "EnBodega" && Number(mq[0].PalletId) === P1.palletId && (await pisoM(R)) === 1 && e1.vig === 1 && e1.rec === 1 && e1.reg === 0,
        JSON.stringify({ mq, e1 }));

      // El plan cambió: el área sí usa parte de lo pendiente.
      f = await filasDe(R);
      const f2r = f.find((r: any) => r.PalletId === P2.palletId && r.PorRegresar);
      const r3: any = await recibirPolines(tx, { RemisionId: R, Lineas: [renglon(f2r, 2)] }, OP);
      let e2 = await estado(R, P2.palletId);
      check("14. de lo pendiente, el área acepta 2 de 3: entran al piso (3) y queda 1 pendiente",
        r3.Masters === 2 && (await pisoM(R)) === 3 && e2.rec === 2 && e2.reg === 1, JSON.stringify({ r3, e2 }));

      // Bodega quita una caja que el sistema contaba como recibida: toma el lugar de la pendiente.
      const lineaRec: any[] = await q(`SELECT rd.DetalleId FROM RemisionDetalle rd JOIN Masters m ON m.MasterId = rd.MasterId WHERE rd.RemisionId = ? AND rd.Vigente = 1 AND rd.RecibidoEn IS NOT NULL AND m.PalletId = ?`, R, P2.palletId);
      await quitarLineas(tx, R, { detalleId: Number(lineaRec[0].DetalleId) }, OP);
      e2 = await estado(R, P2.palletId);
      check("15. Quitar una caja 'recibida' mientras hay pendiente: se intercambia y el piso no cambia (3)",
        (await pisoM(R)) === 3 && e2.vig === 2 && e2.rec === 2 && e2.reg === 0, JSON.stringify(e2));

      // ── Sin pendientes ya se confirma, con solo lo que el área usó ──────────────────────────────
      await confirmarRemision(tx, R, OP);
      const vig = await q(`SELECT COUNT(*) AS n FROM RemisionDetalle WHERE RemisionId = ? AND Vigente = 1`, R);
      check("16. sin pendientes confirma: la remisión queda con los 3 que el área usó y el piso igual",
        Number(vig[0].n) === 3 && (await pisoM(R)) === 3);
      check("17. confirmada, ya no sale en por entregar", (await filasDe(R)).length === 0);
      const restoP2: any[] = await q(`SELECT rd.MasterId FROM RemisionDetalle rd JOIN Masters m ON m.MasterId = rd.MasterId WHERE rd.RemisionId = ? AND rd.Vigente = 1 AND m.PalletId = ?`, R, P2.palletId);
      const d3: any = await devolver(m2.find(m => m.masterId === Number(restoP2[0].MasterId))!.correlativo, D);
      check("18. después de confirmar, devolver es una devolución normal: sale del piso",
        d3.PorRegresar === false && d3.PisoKg > 0 && (await pisoM(R)) === 2, JSON.stringify(d3));

      // ── En otro borrador: deshacer, Quitar polín y eliminar ─────────────────────────────────────
      const P3 = await nuevoPallet(); const m3 = [await nuevoMaster(P3.palletId), await nuevoMaster(P3.palletId)];
      const R2 = await nuevaRemision();
      await agregarPallet(tx, R2, { Codigo: P3.codigo }, OP);
      await esperarError("19. en un borrador, lo que el área no dejó pendiente no se devuelve así",
        () => devolver(m3[0].correlativo, D), "no lo dejó por regresar");
      const f3 = (await filasDe(R2))[0];
      await recibirPolines(tx, { RemisionId: R2, Lineas: [renglon(f3, 1)] }, OP);
      const f3r = (await filasDe(R2)).find((r: any) => r.PorRegresar);
      await deshacerRecepcion(tx, { RemisionId: R2, ...renglon(f3r) });
      const e3 = await estado(R2, P3.palletId);
      check("20. deshacer el renglón: vuelve todo a 'aún en bodega' y sale del piso",
        e3.rec === 0 && e3.reg === 0 && (await pisoM(R2)) === 0, JSON.stringify(e3));
      await recibirPolines(tx, { RemisionId: R2, Lineas: [renglon(f3, 1)] }, OP);
      const reg3: any[] = await q(`SELECT MasterId FROM RemisionDetalle WHERE RemisionId = ? AND Vigente = 1 AND PorRegresarEn IS NOT NULL`, R2);
      const m3reg = m3.find(m => m.masterId === Number(reg3[0].MasterId))!;
      const d4: any = await devolver(m3reg.correlativo, D);
      check("21. el pendiente se escanea en el polín nuevo; el recibido sigue al piso", d4.PorRegresar === true && (await pisoM(R2)) === 1, JSON.stringify(d4));
      await quitarLineas(tx, R2, { palletId: P3.palletId }, OP);
      const otro = m3.find(m => m.masterId !== m3reg.masterId)!;
      const mo = await q(`SELECT Estatus, PalletId FROM Masters WHERE MasterId = ?`, otro.masterId);
      check("22. Quitar polín con lo recibido (sin pendientes): sale del piso y vuelve a su polín",
        (await pisoM(R2)) === 0 && mo[0].Estatus === "EnBodega" && Number(mo[0].PalletId) === P3.palletId, JSON.stringify(mo));
      const el: any = await eliminarBorrador(tx, R2, OP);
      const rem2 = await q(`SELECT Estatus FROM Remisiones WHERE RemisionId = ?`, R2);
      check("23. eliminar ese borrador lo deja ANULADO: ya había regresado una caja al polín nuevo",
        el.anulada === true && el.regresados === 1 && rem2[0]?.Estatus === "Anulada", JSON.stringify({ el, rem2 }));

      throw new Error(ROLLBACK);
    }, { timeout: 180_000 });
  } catch (err: any) {
    if (err.message !== ROLLBACK) { console.error("ERROR INESPERADO:", err); fallos++; }
  }

  const sobras: any[] = await p.$queryRawUnsafe(`SELECT CodigoPedido FROM Pedidos WHERE CodigoPedido = 'ZZPRUEBA_REG'`);
  check("24. la transacción revirtió TODO el fixture", sobras.length === 0);

  console.log(`\n${ok} OK, ${fallos} fallas`);
  await p.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main();
