// Prueba de "Recibir" en Descongelado (28 oct 2026): de madrugada bodega no está, así que el área
// recibe POLÍN POR POLÍN lo que bodega le dejó en una remisión que sigue en borrador. Lo recibido
// entra a su piso; lo demás sigue "aún en bodega" hasta que bodega lo quite o lo entregue al
// confirmar (la remisión la sigue confirmando bodega, decisión del usuario).
// Contra la BASE REAL, dentro de una transacción que SIEMPRE se revierte (ver
// feedback_probar_con_transaccion_revertida). Los rechazos tienen que ocurrir antes de escribir: la
// prueba lo verifica leyendo el estado después de cada uno.
//
//   npx tsx scripts/probarRecibirDescongelado.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { agregarPallet, quitarLineas, confirmarRemision } from "../src/routes/remisiones.ts";
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

      // ── Fixture: un pedido, una orden, tres polines del MISMO lote y talla ──────────────────────
      const cli = await q(`SELECT Codigo FROM Clientes LIMIT 1`);
      const det = await q(`
        SELECT cl.Clase, cl.Proceso, t.Codigo AS Talla, pr.Codigo AS Presentacion, pr.CajasXMaster,
               pr.PesoKG * pr.CajasXMaster AS KgExacto
        FROM Clase cl JOIN Tallas t JOIN Presentacion pr WHERE pr.PesoKG > 0 LIMIT 1`);
      const exacto = Number(det[0].KgExacto);
      const kg = (n: number) => Number((n * exacto).toFixed(2));
      const cerca = (a: number, b: number) => Math.abs(a - b) < 0.011;
      const bv = await q(`SELECT Codigo FROM BodegaVirtual WHERE Activo = 1 LIMIT 1`);
      const area = await q(`SELECT Codigo FROM Areas LIMIT 1`);
      const org = await q(`SELECT Codigo FROM Origen LIMIT 1`);
      const pis = await q(`SELECT PiscinaId FROM Piscina LIMIT 1`);
      const emp = await q(`SELECT Codigo FROM Empaques LIMIT 1`);
      const cong = await q(`SELECT Codigo FROM UnidadesCongelacion LIMIT 1`);
      const serieArea = await q(`SELECT Tipo FROM SerieRemision WHERE Destino = 'Area' AND Activo = 1 LIMIT 1`);

      const PEDIDO = "ZZPRUEBA_REC";
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
      const nuevoPallet = async () => {
        const codigo = "ZZ" + Math.random().toString(36).slice(2, 8).toUpperCase();
        await x(`INSERT INTO Pallets (Codigo, Estatus, Origen, CantidadMaster, BodegaVirtualCodigo, CreadoPor)
                 VALUES (?, 'Cerrado', ?, 10, ?, 'prueba')`, codigo, org[0].Codigo, bv[0].Codigo);
        return { palletId: await id(), codigo };
      };
      const nuevoMaster = async (palletId: number, orden = ordenId) => {
        await x(`INSERT INTO EtiquetaImpresa (OrdenId, Estatus, RegistradoPor, Correlativo) VALUES (?, 'Activa', 'prueba', UUID_SHORT())`, orden);
        const etiquetaId = await id();
        await x(`UPDATE EtiquetaImpresa SET Correlativo = ? WHERE EtiquetaId = ?`, "E" + etiquetaId, etiquetaId);
        await x(`INSERT INTO Masters (PalletId, EtiquetaId, Estatus, IngresadoPor) VALUES (?, ?, 'EnBodega', 'prueba')`, palletId, etiquetaId);
        return await id();
      };
      const estatus = async (masterId: number) => (await q(`SELECT Estatus FROM Masters WHERE MasterId = ?`, masterId))[0].Estatus;
      const ingreso = async (remisionId: number) =>
        await q(`SELECT Masters, PesoKg FROM MovimientoPiso WHERE RemisionId = ? AND Tipo = 'INGRESO'`, remisionId);
      const pisoM = async (remisionId: number) => (await ingreso(remisionId)).reduce((s, r) => s + Number(r.Masters), 0);

      const P1 = await nuevoPallet(); const m1 = [await nuevoMaster(P1.palletId), await nuevoMaster(P1.palletId)];
      const P2 = await nuevoPallet(); const m2 = [await nuevoMaster(P2.palletId), await nuevoMaster(P2.palletId)];
      const P3 = await nuevoPallet(); await nuevoMaster(P3.palletId);
      await x(`INSERT INTO Remisiones (Folio, Tipo, Estatus, Fecha, BodegaDestino, CreadoPor)
               VALUES (?, ?, 'Borrador', CURDATE(), 'DESCONGELADO', 'prueba')`, "ZZ-REC-" + Math.random().toString(36).slice(2, 6), serieArea[0].Tipo);
      const R = await id();
      for (const P of [P1, P2, P3]) await agregarPallet(tx, R, { Codigo: P.codigo }, OP);
      const deR = async () => (await porEntregar(tx, "DESCONGELADO")).filter((r: any) => r.RemisionId === R);
      const de = async (P: any) => (await deR()).find((r: any) => r.PalletId === P.palletId);

      // ── Recibir polín por polín ─────────────────────────────────────────────────────────────────
      let pe = await deR();
      check("1. el área ve los 3 polines por entregar y ninguno recibido", pe.length === 3 && pe.every((r: any) => !r.Recibido), JSON.stringify(pe));
      check("2. no hay nada en su piso todavía", (await ingreso(R)).length === 0);

      const r1: any = await recibirPolines(tx, { RemisionId: R, PalletIds: [P1.palletId] }, OP);
      check("3. recibe P1: 2 masters", r1.ok === true && r1.Masters === 2, JSON.stringify(r1));
      let ing = await ingreso(R);
      check("4. P1 entra a su piso (2 masters, kg exactos)", ing.length === 1 && Number(ing[0].Masters) === 2 && cerca(Number(ing[0].PesoKg), kg(2)), JSON.stringify(ing));
      const d1 = await de(P1);
      check("5. P1 queda recibido, con quién y cuándo", d1?.Recibido === true && d1?.RecibidoPor === OP && !!d1?.RecibidoEn, JSON.stringify(d1));
      check("6. P2, del MISMO lote y talla, sigue aún en bodega", (await de(P2))?.Recibido === false);
      await esperarError("7. no se recibe dos veces", () => recibirPolines(tx, { RemisionId: R, PalletIds: [P1.palletId] }, OP), "ya se recibió");
      await esperarError("8. no se recibe una remisión que va a otra área",
        () => recibirPolines(tx, { RemisionId: R, PalletIds: [P2.palletId], Bodega: "REEMPAQUE" }, OP), "no viene para esta área");
      await esperarError("9. hay que marcar algún polín", () => recibirPolines(tx, { RemisionId: R, PalletIds: [] }, OP), "Marque lo que le llegó");

      await recibirPolines(tx, { RemisionId: R, PalletIds: [P2.palletId] }, OP);
      ing = await ingreso(R);
      check("10. recibir P2 suma a la MISMA fila del piso (4 masters)", ing.length === 1 && Number(ing[0].Masters) === 4 && cerca(Number(ing[0].PesoKg), kg(4)), JSON.stringify(ing));

      // ── Deshacer una recepción hecha por error ──────────────────────────────────────────────────
      await deshacerRecepcion(tx, { RemisionId: R, PalletId: P2.palletId });
      check("11. deshacer P2: vuelve a aún en bodega y sale del piso (quedan 2)",
        (await de(P2))?.Recibido === false && (await pisoM(R)) === 2);
      await x(`INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaOrigen, Lote, Clase, Talla, FechaLote, Peso, UM, PesoKg, Masters, KgPorMaster, RemisionId, RegistradoPor)
               VALUES ('CONSUMO', CURDATE(), 'DESCONGELADO', 'ZZPRUEBA', ?, ?, CURDATE(), ?, 'KG', ?, 2, ?, ?, 'prueba')`,
        det[0].Clase, det[0].Talla, kg(2), kg(2), Number(exacto.toFixed(3)), R);
      const consumo = await id();
      await esperarError("12. no se deshace lo que el área ya descongeló",
        () => deshacerRecepcion(tx, { RemisionId: R, PalletId: P1.palletId }), "ya trabajó ese producto");
      check("13. ... y no tocó nada: P1 sigue recibido y en el piso", (await de(P1))?.Recibido === true && (await pisoM(R)) === 2);

      // ── Bodega quita lo que no llegó: no toca el piso ───────────────────────────────────────────
      await quitarLineas(tx, R, { palletId: P2.palletId }, OP);
      check("14. quitar P2 (no recibido) lo regresa a bodega y el piso no cambia",
        (await estatus(m2[0])) === "EnBodega" && (await pisoM(R)) === 2 && !(await de(P2)));
      await esperarError("15. lo recibido y ya descongelado no se puede quitar",
        () => quitarLineas(tx, R, { palletId: P1.palletId }, OP), "ya trabajó ese producto");
      check("16. ... y P1 sigue fuera de bodega y en el piso", (await estatus(m1[0])) === "Salido" && (await pisoM(R)) === 2);
      await x(`DELETE FROM MovimientoPiso WHERE MovimientoId = ?`, consumo);
      await quitarLineas(tx, R, { palletId: P1.palletId }, OP);
      check("17. sin trabajar, quitar P1 (recibido) lo saca del piso y lo regresa a bodega",
        (await estatus(m1[0])) === "EnBodega" && (await ingreso(R)).length === 0);

      // ── Confirmar entrega lo que falta y no duplica lo recibido ─────────────────────────────────
      await agregarPallet(tx, R, { Codigo: P1.codigo }, OP);
      await recibirPolines(tx, { RemisionId: R, PalletIds: [P1.palletId] }, OP);
      const conf: any = await confirmarRemision(tx, R, OP);
      ing = await ingreso(R);
      check("18. confirmar entrega P3 (que no se había recibido) sin duplicar P1: 3 masters en una fila",
        conf.ok === true && ing.length === 1 && Number(ing[0].Masters) === 3 && cerca(Number(ing[0].PesoKg), kg(3)), JSON.stringify(ing));
      check("19. confirmada, ya no sale en por entregar", (await deR()).length === 0);
      await esperarError("20. no se recibe de una remisión confirmada",
        () => recibirPolines(tx, { RemisionId: R, PalletIds: [P3.palletId] }, OP), "ya confirmó");

      // ── Un polín con dos tallas se recibe renglón por renglón (B0357, 29 oct 2026) ──────────────
      const otraTalla = (await q(`SELECT Codigo FROM Tallas WHERE Codigo <> ? LIMIT 1`, det[0].Talla))[0].Codigo;
      await x(`INSERT INTO DetallePedido (CodigoPedido, Clase, Proceso, Talla, Presentacion, EmpaqueMaster, CantidadCajas, KgPedido, LibrasPedido)
               VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`,
        PEDIDO, det[0].Clase, det[0].Proceso, otraTalla, det[0].Presentacion, emp[0].Codigo, Number(det[0].CajasXMaster) * 100);
      const detalleB = await id();
      await x(`INSERT INTO OrdenEtiquetado (Lote, PiscinaId, Ciclo, DetalleId, AreaCodigo, FechaProduccion, Color, Origen, Congelacion, CantidadMaster, Estatus, RegistradoPor)
               VALUES ('ZZPRUEBA', ?, '1', ?, ?, CURDATE(), 'sc', ?, ?, 50, 'Pendiente', 'prueba')`,
        pis[0].PiscinaId, detalleB, area[0].Codigo, org[0].Codigo, cong[0].Codigo);
      const ordenB = await id();
      const P4 = await nuevoPallet();
      const m4a = [await nuevoMaster(P4.palletId), await nuevoMaster(P4.palletId)];
      const m4b = await nuevoMaster(P4.palletId, ordenB);
      await x(`INSERT INTO Remisiones (Folio, Tipo, Estatus, Fecha, BodegaDestino, CreadoPor)
               VALUES (?, ?, 'Borrador', CURDATE(), 'DESCONGELADO', 'prueba')`, "ZZ-REC-" + Math.random().toString(36).slice(2, 6), serieArea[0].Tipo);
      const R2 = await id();
      await agregarPallet(tx, R2, { Codigo: P4.codigo }, OP);
      const deR2 = async () => (await porEntregar(tx, "DESCONGELADO")).filter((r: any) => r.RemisionId === R2);
      const renglon = (r: any) => ({ PalletId: r.PalletId, Lote: r.Lote, Clase: r.Clase, Talla: r.Talla, FechaLote: r.FechaLote });
      pe = await deR2();
      const filaB = pe.find((r: any) => r.Talla === Number(otraTalla));
      check("22. el polín mixto sale en dos renglones (2 + 1 masters)",
        pe.length === 2 && !!filaB && filaB.Masters === 1 && pe.some((r: any) => r.Masters === 2), JSON.stringify(pe));
      const r22: any = await recibirPolines(tx, { RemisionId: R2, Lineas: [renglon(filaB)] }, OP);
      check("23. recibir solo el renglón de la otra talla: 1 master", r22.Masters === 1 && (await pisoM(R2)) === 1, JSON.stringify(r22));
      pe = await deR2();
      check("24. ... el otro renglón del MISMO polín sigue aún en bodega",
        pe.filter((r: any) => r.Recibido).length === 1 && pe.find((r: any) => !r.Recibido)?.Masters === 2, JSON.stringify(pe));
      const rd4 = await q(`SELECT MasterId, RecibidoEn IS NOT NULL AS rec FROM RemisionDetalle WHERE RemisionId = ? ORDER BY MasterId`, R2);
      check("25. solo el master de la otra talla quedó recibido",
        rd4.filter(r => Number(r.rec)).map(r => Number(r.MasterId)).join() === String(m4b) &&
        m4a.every(m => rd4.some(r => Number(r.MasterId) === m && !Number(r.rec))), JSON.stringify(rd4));
      const filaA = pe.find((r: any) => !r.Recibido);
      await recibirPolines(tx, { RemisionId: R2, Lineas: [renglon(filaA)] }, OP);
      check("26. luego recibe el otro renglón: 3 masters al piso", (await pisoM(R2)) === 3);
      await deshacerRecepcion(tx, { RemisionId: R2, ...renglon(filaB) });
      pe = await deR2();
      check("27. deshacer solo el renglón de la otra talla: queda 2 en el piso y ese vuelve a aún en bodega",
        (await pisoM(R2)) === 2 && pe.find((r: any) => r.Talla === Number(otraTalla))?.Recibido === false &&
        pe.find((r: any) => r.Talla !== Number(otraTalla))?.Recibido === true, JSON.stringify(pe));
      await esperarError("28. un renglón que no está en la remisión no se recibe",
        () => recibirPolines(tx, { RemisionId: R2, Lineas: [{ ...renglon(filaB), Lote: "NOEXISTE" }] }, OP), "ya se recibió o no es");

      throw new Error(ROLLBACK);
    }, { timeout: 180_000 });
  } catch (err: any) {
    if (err.message !== ROLLBACK) { console.error("ERROR INESPERADO:", err); fallos++; }
  }

  const sobras: any[] = await p.$queryRawUnsafe(`SELECT CodigoPedido FROM Pedidos WHERE CodigoPedido = 'ZZPRUEBA_REC'`);
  check("29. la transacción revirtió TODO el fixture", sobras.length === 0);

  console.log(`\n${ok} OK, ${fallos} fallas`);
  await p.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main();
