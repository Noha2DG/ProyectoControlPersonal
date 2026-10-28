// Prueba de que lo que bodega devuelve de una remisión CONFIRMADA sale también del piso del área
// (28 oct 2026, RS-0106: Descongelado veía 80 masters de 31/35 que se habían quedado en bodega):
//   - Devolver master descuenta exactamente esa caja de su lote y talla;
//   - Devolver polín regresa el MISMO polín con un escaneo y lo saca del piso;
//   - los dos se niegan, sin tocar nada, si el área ya trabajó ese producto;
//   - pisoDeRemision dice cuánto entró, cuánto se trabajó y cuánto queda.
// Contra la BASE REAL, dentro de una transacción que SIEMPRE se revierte (ver
// feedback_probar_con_transaccion_revertida). Los rechazos tienen que ocurrir antes de escribir: la
// prueba lo verifica leyendo el estado después de cada uno.
//
//   npx tsx scripts/probarDevolucionDescuentaPiso.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  agregarPallet, agregarMaster, confirmarRemision, devolverMaster, devolverPolin,
} from "../src/routes/remisiones.ts";
import { pisoDeRemision } from "../src/lib/inventarioPiso.ts";

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

      // ── Fixture ────────────────────────────────────────────────────────────────────────────────
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
      const serieCliente = await q(`SELECT Tipo FROM SerieRemision WHERE Destino = 'Cliente' AND Activo = 1 LIMIT 1`);
      const libres = await q(`
        SELECT PosicionId FROM Posiciones
        WHERE PosicionId NOT IN (SELECT PosicionId FROM Pallets WHERE PosicionId IS NOT NULL) LIMIT 2`);
      const [posX, posY] = libres.map(r => Number(r.PosicionId));

      const PEDIDO = "ZZPRUEBA_DPI";
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

      const nuevoPallet = async (estatus: string, posicionId: number | null) => {
        const codigo = "ZZ" + Math.random().toString(36).slice(2, 8).toUpperCase();
        await x(`INSERT INTO Pallets (Codigo, Estatus, Origen, CantidadMaster, BodegaVirtualCodigo, PosicionId, CreadoPor)
                 VALUES (?, ?, ?, 10, ?, ?, 'prueba')`, codigo, estatus, org[0].Codigo, bv[0].Codigo, posicionId);
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
          "ZZ-DPI-" + Math.random().toString(36).slice(2, 6), tipo, bodega);
        return await id();
      };
      const master = async (masterId: number) =>
        (await q(`SELECT Estatus, PalletId FROM Masters WHERE MasterId = ?`, masterId))[0];
      const vigente = async (remisionId: number, masterId: number) =>
        (await q(`SELECT Vigente FROM RemisionDetalle WHERE RemisionId = ? AND MasterId = ?`, remisionId, masterId))[0]?.Vigente;
      const polin = async (palletId: number) => (await q(`SELECT Estatus, PosicionId FROM Pallets WHERE PalletId = ?`, palletId))[0];
      const ingreso = async (remisionId: number) =>
        await q(`SELECT Masters, PesoKg FROM MovimientoPiso WHERE RemisionId = ? AND Tipo = 'INGRESO'`, remisionId);
      const consumir = async (remisionId: number, masters: number) => {
        await x(`INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaOrigen, Lote, Clase, Talla, FechaLote, Peso, UM, PesoKg, Masters, KgPorMaster, RemisionId, RegistradoPor)
                 VALUES ('CONSUMO', CURDATE(), 'DESCONGELADO', 'ZZPRUEBA', ?, ?, CURDATE(), ?, 'KG', ?, ?, ?, ?, 'prueba')`,
          det[0].Clase, det[0].Talla, kg(masters), kg(masters), masters, Number(exacto.toFixed(3)), remisionId);
        return await id();
      };

      // Remisión confirmada a Descongelado: P1 (3 cajas, en el rack) y P2 (2 cajas, sin posición).
      const P1 = await nuevoPallet("Cerrado", posX);
      const p1m = [await nuevoMaster(P1.palletId), await nuevoMaster(P1.palletId), await nuevoMaster(P1.palletId)];
      const P2 = await nuevoPallet("Cerrado", null);
      const p2m = [await nuevoMaster(P2.palletId), await nuevoMaster(P2.palletId)];
      const R = await nuevaRemision(serieArea[0].Tipo, "DESCONGELADO");
      await agregarPallet(tx, R, { Codigo: P1.codigo }, OP);
      await agregarPallet(tx, R, { Codigo: P2.codigo }, OP);
      await confirmarRemision(tx, R, OP);
      let ing = await ingreso(R);
      check("1. la remisión confirmada dejó 5 masters al piso", ing.length === 1 && Number(ing[0].Masters) === 5, JSON.stringify(ing));

      // Polín de devolución, como el que se crea en Pallets para Devolver master.
      const D = await nuevoPallet("Abierto", null);

      // ── Devolver master ─────────────────────────────────────────────────────────────────────────
      const r1: any = await devolverMaster(tx, { correlativo: p1m[0].correlativo, palletDestinoId: D.palletId, motivo: "no salió", operador: OP, esAdmin: false });
      ing = await ingreso(R);
      check("2. Devolver master saca esa caja del piso (quedan 4, kg exactos)",
        ing.length === 1 && Number(ing[0].Masters) === 4 && cerca(Number(ing[0].PesoKg), kg(4)), JSON.stringify(ing));
      check("3. ... y avisa cuántos kg salieron del piso", cerca(Number(r1.PisoKg), kg(5) - kg(4)), JSON.stringify(r1));
      const m0 = await master(p1m[0].masterId);
      check("4. ... la caja queda EnBodega en el polín de devolución",
        m0.Estatus === "EnBodega" && Number(m0.PalletId) === D.palletId, JSON.stringify(m0));

      // Si el área ya descongeló lo que queda, la caja no puede "regresar": sí estaba con ellos.
      const consumo = await consumir(R, 4);
      await esperarError("5. Devolver master se niega si el área ya lo trabajó",
        () => devolverMaster(tx, { correlativo: p1m[1].correlativo, palletDestinoId: D.palletId, motivo: "x", operador: OP, esAdmin: false }),
        "ya trabajó ese producto");
      const m1 = await master(p1m[1].masterId);
      check("6. ... y no tocó nada: la caja sigue Salido, su línea vigente y el piso en 4",
        m1.Estatus === "Salido" && Number(await vigente(R, p1m[1].masterId)) === 1 && Number((await ingreso(R))[0].Masters) === 4);
      await esperarError("7. Devolver polín también se niega si el área ya lo trabajó",
        () => devolverPolin(tx, { remisionId: R, codigo: P2.codigo, motivo: "x", operador: OP, esAdmin: false }),
        "ya trabajó ese producto");
      check("8. ... sin tocar el polín ni sus cajas",
        (await polin(P2.palletId)).Estatus === "Despachado" && (await master(p2m[0].masterId)).Estatus === "Salido");
      await x(`DELETE FROM MovimientoPiso WHERE MovimientoId = ?`, consumo);

      // ── Devolver polín ──────────────────────────────────────────────────────────────────────────
      await esperarError("9. Devolver polín exige motivo",
        () => devolverPolin(tx, { remisionId: R, codigo: P2.codigo, motivo: " ", operador: OP, esAdmin: false }), "motivo");
      const r2: any = await devolverPolin(tx, { remisionId: R, codigo: P2.codigo, motivo: "no se lo llevaron", operador: OP, esAdmin: false });
      check("10. Devolver polín regresa sus 2 cajas", r2.ok === true && r2.Masters === 2, JSON.stringify(r2));
      const mp2 = await Promise.all(p2m.map(m => master(m.masterId)));
      check("11. ... al MISMO polín, EnBodega", mp2.every(m => m.Estatus === "EnBodega" && Number(m.PalletId) === P2.palletId), JSON.stringify(mp2));
      const pp2 = await polin(P2.palletId);
      check("12. ... el polín vuelve a Cerrado sin posición (para ubicarlo)", pp2.Estatus === "Cerrado" && pp2.PosicionId == null, JSON.stringify(pp2));
      check("13. ... sus líneas quedan Vigente = NULL", (await vigente(R, p2m[0].masterId)) === null && (await vigente(R, p2m[1].masterId)) === null);
      ing = await ingreso(R);
      check("14. ... y sale del piso: quedan 2 masters (los de P1)", ing.length === 1 && Number(ing[0].Masters) === 2 && cerca(Number(ing[0].PesoKg), kg(2)), JSON.stringify(ing));
      const kx = await q(`SELECT COUNT(*) AS n FROM MovimientosBodega WHERE RemisionId = ? AND Tipo = 'DEVOLUCION' AND PalletId = ? AND PalletOrigenId = ?`, R, P2.palletId, P2.palletId);
      check("15. ... con una DEVOLUCION por caja en el kardex", Number(kx[0].n) === 2);
      await esperarError("16. el mismo polín no se devuelve dos veces",
        () => devolverPolin(tx, { remisionId: R, codigo: P2.codigo, motivo: "x", operador: OP, esAdmin: false }), "no tiene cajas en la remisión");

      // ── Lo que queda al piso, para el panel de bodega ───────────────────────────────────────────
      const c2 = await consumir(R, 1);
      const piso: any = await pisoDeRemision(tx, R, { BodegaDestino: "DESCONGELADO" });
      const l = piso?.Lineas?.[0];
      check("17. pisoDeRemision: entró 2, se trabajó 1, queda 1 master",
        piso?.Bodega === "DESCONGELADO" && piso.Lineas.length === 1 && l.EntroMasters === 2
        && cerca(l.SalioKg, kg(1)) && cerca(l.QuedaKg, kg(2) - kg(1)) && l.QuedaMasters === 1, JSON.stringify(piso));
      await x(`DELETE FROM MovimientoPiso WHERE MovimientoId = ?`, c2);

      // ── Rechazos de Devolver polín ──────────────────────────────────────────────────────────────
      const RB = await nuevaRemision(serieArea[0].Tipo, "DESCONGELADO");
      const P5 = await nuevoPallet("Cerrado", null);
      await nuevoMaster(P5.palletId);
      await agregarPallet(tx, RB, { Codigo: P5.codigo }, OP);
      await esperarError("18. en un borrador se usa Quitar polín",
        () => devolverPolin(tx, { remisionId: RB, codigo: P5.codigo, motivo: "x", operador: OP, esAdmin: false }), "sigue en borrador");

      // Picking: salió 1 caja de P3 y el resto sigue en el rack. Lo que regresa son cajas sueltas.
      const P3 = await nuevoPallet("Cerrado", posY);
      const p3m = [await nuevoMaster(P3.palletId), await nuevoMaster(P3.palletId)];
      const R2 = await nuevaRemision(serieArea[0].Tipo, "DESCONGELADO");
      await agregarMaster(tx, R2, { Correlativo: p3m[0].correlativo }, OP);
      await confirmarRemision(tx, R2, OP);
      await esperarError("19. un polín que sigue ubicado no se devuelve entero",
        () => devolverPolin(tx, { remisionId: R2, codigo: P3.codigo, motivo: "x", operador: OP, esAdmin: false }), "sigue ubicado");

      // ── A cliente: no hay piso que descontar ────────────────────────────────────────────────────
      const P4 = await nuevoPallet("Cerrado", null);
      const p4m = [await nuevoMaster(P4.palletId), await nuevoMaster(P4.palletId)];
      const R3 = await nuevaRemision(serieCliente[0].Tipo, null);
      await agregarPallet(tx, R3, { Codigo: P4.codigo }, OP);
      await confirmarRemision(tx, R3, OP);
      const r3: any = await devolverPolin(tx, { remisionId: R3, codigo: P4.codigo, motivo: "no cupo en el camión", operador: OP, esAdmin: false });
      check("20. a cliente: Devolver polín funciona sin piso de por medio",
        r3.ok === true && r3.Masters === 2 && Number(r3.PisoKg) === 0 && (await master(p4m[0].masterId)).Estatus === "EnBodega", JSON.stringify(r3));

      // ── Piso vaciado (reset): la devolución sigue funcionando, sin nada que descontar ───────────
      await x(`DELETE FROM MovimientoPiso WHERE RemisionId = ? AND Tipo = 'INGRESO'`, R);
      const r4: any = await devolverMaster(tx, { correlativo: p1m[2].correlativo, palletDestinoId: D.palletId, motivo: "x", operador: OP, esAdmin: false });
      check("21. si el piso ya no tiene el ingreso, devuelve igual y no descuenta nada",
        r4.ok === true && Number(r4.PisoKg) === 0 && (await master(p1m[2].masterId)).Estatus === "EnBodega", JSON.stringify(r4));

      throw new Error(ROLLBACK);
    }, { timeout: 180_000 });
  } catch (err: any) {
    if (err.message !== ROLLBACK) { console.error("ERROR INESPERADO:", err); fallos++; }
  }

  const sobras: any[] = await p.$queryRawUnsafe(`SELECT CodigoPedido FROM Pedidos WHERE CodigoPedido = 'ZZPRUEBA_DPI'`);
  check("22. la transacción revirtió TODO el fixture", sobras.length === 0);

  console.log(`\n${ok} OK, ${fallos} fallas`);
  await p.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main();
