// Prueba de "rebajar al escanear" (28 oct 2026): lo que entra a una remisión sale de bodega y entra
// al piso del área EN ESE MOMENTO, sin esperar a confirmar. Corre contra la BASE REAL pero SIN dejar
// nada: todo va dentro de una transacción que al final SIEMPRE se revierte (se lanza a propósito).
// Mismo patrón que probarDevolverMaster.ts — ver feedback_probar_con_transaccion_revertida.
//
// Los rechazos se prueban en la misma transacción, así que las funciones tienen que rechazar ANTES de
// escribir (MariaDB no deja abrir un SAVEPOINT por el protocolo que usa Prisma). La prueba 15
// verifica justo eso: tras el rechazo, todo sigue como estaba.
//
//   npx tsx scripts/probarRebajaAlEscanear.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  agregarPallet, agregarMaster, quitarLineas, confirmarRemision, eliminarBorrador,
} from "../src/routes/remisiones.ts";
import { sincronizarIngresoDeRemision } from "../src/lib/inventarioPiso.ts";
import { SALIO_EN_TRASLADO } from "../src/lib/masters.ts";

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
        try {
          await fn();
          check(nombre, false, "(no lanzó error)");
        } catch (err: any) {
          if (err.message === ROLLBACK) throw err;
          check(nombre, String(err.message).includes(texto), `→ "${err.message}"`);
        }
      }

      // ── Fixture: Pedido → Detalle → Orden → Etiquetas → Polines → Masters ─────────────────────
      const cli = await q(`SELECT Codigo FROM Clientes LIMIT 1`);
      const det = await q(`
        SELECT cl.Clase, cl.Proceso, t.Codigo AS Talla, pr.Codigo AS Presentacion, pr.CajasXMaster,
               ROUND(pr.PesoKG * pr.CajasXMaster, 3) AS KgPorMaster
        FROM Clase cl JOIN Tallas t JOIN Presentacion pr WHERE pr.PesoKG > 0 LIMIT 1`);
      const kgpm = Number(det[0].KgPorMaster);
      const bv = await q(`SELECT Codigo FROM BodegaVirtual WHERE Activo = 1 LIMIT 1`);
      const area = await q(`SELECT Codigo FROM Areas LIMIT 1`);
      const org = await q(`SELECT Codigo FROM Origen LIMIT 1`);
      const pis = await q(`SELECT PiscinaId FROM Piscina LIMIT 1`);
      const emp = await q(`SELECT Codigo FROM Empaques LIMIT 1`);
      const cong = await q(`SELECT Codigo FROM UnidadesCongelacion LIMIT 1`);
      const serieArea = await q(`SELECT Tipo FROM SerieRemision WHERE Destino = 'Area' AND Activo = 1 LIMIT 1`);
      const serieCliente = await q(`SELECT Tipo FROM SerieRemision WHERE Destino = 'Cliente' AND Activo = 1 LIMIT 1`);
      const libres = await q(`
        SELECT PosicionId FROM Posiciones
        WHERE PosicionId NOT IN (SELECT PosicionId FROM Pallets WHERE PosicionId IS NOT NULL) LIMIT 3`);
      const [posX, posY, posZ] = libres.map(r => Number(r.PosicionId));
      const otraBodega = await q(`SELECT Codigo FROM BodegaVirtual WHERE LlevaPiso = 1 AND Codigo <> 'DESCONGELADO' LIMIT 1`);

      const PEDIDO = "ZZPRUEBA_REB";
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

      const nuevoPallet = async (posicionId: number | null) => {
        const codigo = "ZZ" + Math.random().toString(36).slice(2, 8).toUpperCase();
        await x(`INSERT INTO Pallets (Codigo, Estatus, Origen, CantidadMaster, BodegaVirtualCodigo, PosicionId, CreadoPor)
                 VALUES (?, 'Cerrado', ?, 10, ?, ?, 'prueba')`, codigo, org[0].Codigo, bv[0].Codigo, posicionId);
        return { palletId: await id(), codigo };
      };
      const nuevoMaster = async (palletId: number) => {
        await x(`INSERT INTO EtiquetaImpresa (OrdenId, Estatus, RegistradoPor, Correlativo) VALUES (?, 'Activa', 'prueba', UUID_SHORT())`, ordenId);
        const etiquetaId = await id();
        await x(`UPDATE EtiquetaImpresa SET Correlativo = ? WHERE EtiquetaId = ?`, "E" + etiquetaId, etiquetaId);
        await x(`INSERT INTO Masters (PalletId, EtiquetaId, Estatus, IngresadoPor) VALUES (?, ?, 'EnBodega', 'prueba')`, palletId, etiquetaId);
        return { masterId: await id(), correlativo: "E" + etiquetaId };
      };
      const nuevaRemision = async (tipo: string, bodega: string | null) => {
        await x(`INSERT INTO Remisiones (Folio, Tipo, Estatus, Fecha, BodegaDestino, CreadoPor)
                 VALUES (?, ?, 'Borrador', CURDATE(), ?, 'prueba')`,
          "ZZ-REB-" + Math.random().toString(36).slice(2, 6), tipo, bodega);
        return await id();
      };
      const estatus = async (masterId: number) => (await q(`SELECT Estatus FROM Masters WHERE MasterId = ?`, masterId))[0].Estatus;
      const polin = async (palletId: number) => (await q(`SELECT Estatus, PosicionId FROM Pallets WHERE PalletId = ?`, palletId))[0];
      const salidas = async (remisionId: number) =>
        Number((await q(`SELECT COUNT(*) AS n FROM MovimientosBodega WHERE RemisionId = ? AND Tipo = 'SALIDA'`, remisionId))[0].n);
      const ingreso = async (remisionId: number) =>
        await q(`SELECT BodegaDestino, Masters, PesoKg FROM MovimientoPiso WHERE RemisionId = ? AND Tipo = 'INGRESO'`, remisionId);
      const kg = (n: number) => Number((n * kgpm).toFixed(2));
      const cerca = (a: number, b: number) => Math.abs(a - b) < 0.011;

      // P1: polín completo de 3 en la posición X. P2: polín de 2 en la posición Y (picking caja por caja).
      const P1 = await nuevoPallet(posX);
      const p1m = [await nuevoMaster(P1.palletId), await nuevoMaster(P1.palletId), await nuevoMaster(P1.palletId)];
      const P2 = await nuevoPallet(posY);
      const p2m = [await nuevoMaster(P2.palletId), await nuevoMaster(P2.palletId)];

      // ── 1. Polín completo a un borrador de traslado a Descongelado ──────────────────────────────
      const R1 = await nuevaRemision(serieArea[0].Tipo, "DESCONGELADO");
      await agregarPallet(tx, R1, { Codigo: P1.codigo }, OP);
      check("1. los masters del polín quedan Salido al escanear (sin confirmar)",
        (await Promise.all(p1m.map(m => estatus(m.masterId)))).every(e => e === "Salido"));
      check("2. el kardex tiene la SALIDA de cada master", (await salidas(R1)) === 3);
      const p1 = await polin(P1.palletId);
      check("3. el polín vacío queda Despachado y suelta su posición", p1.Estatus === "Despachado" && p1.PosicionId == null, JSON.stringify(p1));
      let ing = await ingreso(R1);
      check("4. entra al piso de Descongelado en el acto (1 fila, 3 masters)",
        ing.length === 1 && ing[0].BodegaDestino === "DESCONGELADO" && Number(ing[0].Masters) === 3 && cerca(Number(ing[0].PesoKg), kg(3)),
        JSON.stringify(ing));
      const cuenta = await q(`SELECT COUNT(*) AS n FROM Masters m WHERE m.MasterId = ? AND ${SALIO_EN_TRASLADO}`, p1m[0].masterId);
      check("5. cuenta como trasladado para el cupo del pedido aunque siga en borrador", Number(cuenta[0].n) === 1);

      // ── 2. Picking de una caja: suma a la MISMA fila del piso, el polín conserva su posición ───
      await agregarMaster(tx, R1, { Correlativo: p2m[0].correlativo }, OP);
      check("6. el master suelto queda Salido", (await estatus(p2m[0].masterId)) === "Salido");
      const p2 = await polin(P2.palletId);
      check("7. su polín, a medias, sigue Cerrado en su posición", p2.Estatus === "Cerrado" && Number(p2.PosicionId) === posY, JSON.stringify(p2));
      ing = await ingreso(R1);
      check("8. el piso sigue en UNA fila, ahora con 4 masters", ing.length === 1 && Number(ing[0].Masters) === 4 && cerca(Number(ing[0].PesoKg), kg(4)), JSON.stringify(ing));
      await esperarError("9. el mismo master no entra dos veces",
        () => agregarMaster(tx, R1, { Correlativo: p2m[0].correlativo }, OP), "ya está en la remisión");

      // ── 3. Quitar una línea la regresa a bodega y al piso ───────────────────────────────────────
      const lineaP2: any[] = await q(`SELECT DetalleId FROM RemisionDetalle WHERE RemisionId = ? AND MasterId = ?`, R1, p2m[0].masterId);
      await quitarLineas(tx, R1, { detalleId: Number(lineaP2[0].DetalleId) }, OP);
      check("10. el master quitado vuelve a EnBodega", (await estatus(p2m[0].masterId)) === "EnBodega");
      check("11. su SALIDA se borra del kardex", (await salidas(R1)) === 3);
      ing = await ingreso(R1);
      check("12. el piso baja a 3 masters", ing.length === 1 && Number(ing[0].Masters) === 3, JSON.stringify(ing));

      // ── 4. Lo que el área ya descongeló no se puede quitar ni eliminar ──────────────────────────
      await x(`INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaOrigen, Lote, Clase, Talla, FechaLote, Peso, UM, PesoKg, Masters, KgPorMaster, RemisionId, RegistradoPor)
               VALUES ('CONSUMO', CURDATE(), 'DESCONGELADO', 'ZZPRUEBA', ?, ?, CURDATE(), ?, 'KG', ?, 2, ?, ?, 'prueba')`,
        det[0].Clase, det[0].Talla, kg(2), kg(2), kgpm, R1);
      const consumoId = await id();
      await esperarError("13. no deja quitar un polín que el área ya descongeló",
        () => quitarLineas(tx, R1, { palletId: P1.palletId }, OP), "El área ya trabajó");
      await esperarError("14. no deja eliminar el borrador con producto ya descongelado",
        () => eliminarBorrador(tx, R1, OP), "El área ya trabajó");
      check("15. tras el rechazo todo sigue como estaba (masters Salido, 3 al piso)",
        (await estatus(p1m[0].masterId)) === "Salido" && Number((await ingreso(R1))[0]?.Masters) === 3);
      await x(`DELETE FROM MovimientoPiso WHERE MovimientoId = ?`, consumoId);

      // ── 5. Cambiar la bodega destino del borrador mueve el piso ─────────────────────────────────
      if (otraBodega.length) {
        await x(`UPDATE Remisiones SET BodegaDestino = ? WHERE RemisionId = ?`, otraBodega[0].Codigo, R1);
        await sincronizarIngresoDeRemision(tx, R1, { BodegaDestino: otraBodega[0].Codigo }, "2026-10-28", OP);
        ing = await ingreso(R1);
        check("16. el ingreso pasa al piso de la bodega nueva", ing.length === 1 && ing[0].BodegaDestino === otraBodega[0].Codigo, JSON.stringify(ing));
        await x(`UPDATE Remisiones SET BodegaDestino = 'DESCONGELADO' WHERE RemisionId = ?`, R1);
        await sincronizarIngresoDeRemision(tx, R1, { BodegaDestino: "DESCONGELADO" }, "2026-10-28", OP);
      } else {
        check("16. (sin otra bodega con piso para probar el cambio de destino)", true);
      }

      // ── 6. Quitar un polín entero cuya posición ya ocupó otro: queda sin posición ──────────────
      await nuevoPallet(posX);   // otro polín se puso en X mientras P1 estaba en el borrador
      await quitarLineas(tx, R1, { palletId: P1.palletId }, OP);
      const p1b = await polin(P1.palletId);
      check("17. el polín regresa Cerrado SIN posición (la suya ya está ocupada)", p1b.Estatus === "Cerrado" && p1b.PosicionId == null, JSON.stringify(p1b));
      const des = await q(`SELECT COUNT(*) AS n FROM MovimientosBodega WHERE PalletId = ? AND Tipo = 'DESUBICACION' AND PosicionOrigenId = ?`, P1.palletId, posX);
      check("18. queda su DESUBICACION en el kardex", Number(des[0].n) === 1);
      check("19. sus masters vuelven a EnBodega y salen del piso",
        (await estatus(p1m[0].masterId)) === "EnBodega" && (await ingreso(R1)).length === 0 && (await salidas(R1)) === 0);

      // ── 7. Quitar un polín cuya posición sigue libre: la recupera ───────────────────────────────
      const P3 = await nuevoPallet(posZ);
      const p3m = [await nuevoMaster(P3.palletId), await nuevoMaster(P3.palletId)];
      await agregarPallet(tx, R1, { Codigo: P3.codigo }, OP);
      check("20. P3 despachado al escanearlo", (await polin(P3.palletId)).Estatus === "Despachado");
      await quitarLineas(tx, R1, { palletId: P3.palletId }, OP);
      const p3 = await polin(P3.palletId);
      check("21. al quitarlo vuelve Cerrado a SU posición", p3.Estatus === "Cerrado" && Number(p3.PosicionId) === posZ, JSON.stringify(p3));

      // ── 8. Eliminar el borrador regresa todo ────────────────────────────────────────────────────
      await agregarPallet(tx, R1, { Codigo: P3.codigo }, OP);
      await eliminarBorrador(tx, R1, OP);
      check("22. eliminar el borrador: la remisión ya no existe",
        (await q(`SELECT 1 FROM Remisiones WHERE RemisionId = ?`, R1)).length === 0);
      check("23. ... sus masters vuelven a EnBodega y su polín a su posición",
        (await Promise.all(p3m.map(m => estatus(m.masterId)))).every(e => e === "EnBodega")
        && Number((await polin(P3.palletId)).PosicionId) === posZ);
      check("24. ... y no queda nada en el piso ni en el kardex con esa remisión",
        (await q(`SELECT 1 FROM MovimientoPiso WHERE RemisionId = ?`, R1)).length === 0
        && (await q(`SELECT 1 FROM MovimientosBodega WHERE RemisionId = ?`, R1)).length === 0);

      // ── 9. Confirmar: cierra el documento; las líneas de antes del cambio salen ahí ────────────
      const R2 = await nuevaRemision(serieArea[0].Tipo, "DESCONGELADO");
      await agregarPallet(tx, R2, { Codigo: P3.codigo }, OP);
      // Una línea "vieja": entró al borrador antes del cambio, sin sacar el master de bodega.
      await x(`INSERT INTO RemisionDetalle (RemisionId, MasterId, AgregadoPor) VALUES (?, ?, 'prueba')`, R2, p2m[1].masterId);
      const conf: any = await confirmarRemision(tx, R2, OP);
      check("25. confirma con los 3 masters", conf.ok === true && conf.Masters === 3, JSON.stringify(conf));
      check("26. la línea vieja sale de bodega al confirmar", (await estatus(p2m[1].masterId)) === "Salido" && (await salidas(R2)) === 3);
      ing = await ingreso(R2);
      check("27. el piso queda con los 3 (una sola fila)", ing.length === 1 && Number(ing[0].Masters) === 3 && cerca(Number(ing[0].PesoKg), kg(3)), JSON.stringify(ing));
      check("28. la remisión queda Confirmada",
        (await q(`SELECT Estatus FROM Remisiones WHERE RemisionId = ?`, R2))[0].Estatus === "Confirmada");
      await esperarError("29. confirmada ya no acepta líneas",
        () => agregarMaster(tx, R2, { Correlativo: p2m[0].correlativo }, OP), "ya no se le pueden cambiar las líneas");

      // ── 10. Remisión a cliente: rebaja bodega, no toca ningún piso ──────────────────────────────
      const R3 = await nuevaRemision(serieCliente[0].Tipo, null);
      await agregarMaster(tx, R3, { Correlativo: p2m[0].correlativo }, OP);
      check("30. a cliente: el master queda Salido al escanear", (await estatus(p2m[0].masterId)) === "Salido");
      check("31. a cliente: no entra nada a ningún piso", (await q(`SELECT 1 FROM MovimientoPiso WHERE RemisionId = ?`, R3)).length === 0);
      const p2c = await polin(P2.palletId);
      check("32. el polín P2 ya vacío queda Despachado sin posición", p2c.Estatus === "Despachado" && p2c.PosicionId == null, JSON.stringify(p2c));

      throw new Error(ROLLBACK);
    }, { timeout: 180_000 });
  } catch (err: any) {
    if (err.message !== ROLLBACK) { console.error("ERROR INESPERADO:", err); fallos++; }
  }

  const sobras: any[] = await p.$queryRawUnsafe(`SELECT CodigoPedido FROM Pedidos WHERE CodigoPedido = 'ZZPRUEBA_REB'`);
  check("33. la transacción revirtió TODO el fixture", sobras.length === 0);

  console.log(`\n${ok} OK, ${fallos} fallas`);
  await p.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main();
