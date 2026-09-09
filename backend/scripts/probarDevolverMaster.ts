// Prueba de devolverMaster() (POST /api/remisiones/devolver-master) contra la BASE REAL, pero SIN
// dejar nada: todo corre dentro de una transacción que al final SIEMPRE se revierte (se lanza a
// propósito). Mismo patrón que probarQuitarMasters.ts — no hay base de desarrollo, ver
// feedback_probar_con_transaccion_revertida y project_devoluciones_design en memoria.
//
// Fixture: un master real Salido, con su RemisionDetalle Vigente=1 en una remisión Confirmada
// (junto con una SEGUNDA línea de la misma remisión, para probar que devolver una no toca la otra),
// más un pallet Abierto que hace de destino de la devolución.
//
//   npx tsx scripts/probarDevolverMaster.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { devolverMaster } from "../src/routes/remisiones.ts";

const p = new PrismaClient();
const ROLLBACK = "__ROLLBACK_PRUEBA__";

let ok = 0, fallos = 0;
function check(nombre: string, condicion: boolean, detalle = "") {
  if (condicion) { ok++; console.log(`  OK   ${nombre}`); }
  else { fallos++; console.log(`  FALLA ${nombre} ${detalle}`); }
}

async function esperarError(nombre: string, fn: () => Promise<any>, textoEsperado: string) {
  try {
    await fn();
    check(nombre, false, "(no lanzó error)");
  } catch (err: any) {
    if (err.message === ROLLBACK) throw err;
    check(nombre, String(err.message).includes(textoEsperado), `→ "${err.message}"`);
  }
}

async function main() {
  try {
    await p.$transaction(async (tx: any) => {
      // ── Fixture: la cadena completa Pedido → Detalle → Orden → Etiquetas → Pallets → Masters ────
      const cli: any[] = await tx.$queryRawUnsafe(`SELECT Codigo FROM Clientes LIMIT 1`);
      const det: any[] = await tx.$queryRawUnsafe(`
        SELECT cl.Clase, cl.Proceso, t.Codigo AS Talla, pr.Codigo AS Presentacion, pr.CajasXMaster
        FROM Clase cl JOIN Tallas t JOIN Presentacion pr LIMIT 1
      `);
      const bv: any[] = await tx.$queryRawUnsafe(`SELECT Codigo, AreaCodigo FROM BodegaVirtual WHERE Activo = 1 LIMIT 1`);
      const org: any[] = await tx.$queryRawUnsafe(`SELECT Codigo FROM Origen LIMIT 1`);
      const pis: any[] = await tx.$queryRawUnsafe(`SELECT PiscinaId FROM Piscina LIMIT 1`);
      const emp: any[] = await tx.$queryRawUnsafe(`SELECT Codigo FROM Empaques LIMIT 1`);
      const cong: any[] = await tx.$queryRawUnsafe(`SELECT Codigo FROM UnidadesCongelacion LIMIT 1`);
      const serie: any[] = await tx.$queryRawUnsafe(`SELECT Tipo FROM SerieRemision LIMIT 1`);

      const PEDIDO = "ZZPRUEBA_DEV";
      await tx.$executeRawUnsafe(
        `INSERT INTO Pedidos (CodigoPedido, CodigoCliente, Descripcion, FechaInicio, Estatus)
         VALUES (?, ?, 'PRUEBA AUTOMATICA (revertida)', CURDATE(), 'Proceso')`,
        PEDIDO, cli[0].Codigo);
      await tx.$executeRawUnsafe(
        `INSERT INTO DetallePedido (CodigoPedido, Clase, Proceso, Talla, Presentacion, EmpaqueMaster, CantidadCajas, KgPedido, LibrasPedido)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`,
        PEDIDO, det[0].Clase, det[0].Proceso, det[0].Talla, det[0].Presentacion, emp[0].Codigo, Number(det[0].CajasXMaster) * 100);
      const detalleId = Number((await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`))[0].id);

      await tx.$executeRawUnsafe(
        `INSERT INTO OrdenEtiquetado (Lote, PiscinaId, Ciclo, DetalleId, AreaCodigo, FechaProduccion, Color, Origen, Congelacion, CantidadMaster, Estatus, RegistradoPor)
         VALUES ('ZZPRUEBA', ?, '1', ?, ?, CURDATE(), 'sc', ?, ?, 10, 'Pendiente', 'prueba')`,
        pis[0].PiscinaId, detalleId, bv[0].AreaCodigo, org[0].Codigo, cong[0].Codigo);
      const ordenId = Number((await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`))[0].id);

      const nuevoPallet = async (estatus: string, cantidadMaster: number | null = 10) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO Pallets (Codigo, Estatus, Origen, CantidadMaster, BodegaVirtualCodigo, CreadoPor)
           VALUES (?, ?, ?, ?, ?, 'prueba')`,
          "ZZ" + Math.random().toString(36).slice(2, 8), estatus, org[0].Codigo, cantidadMaster, bv[0].Codigo);
        return Number((await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`))[0].id);
      };
      const nuevoMaster = async (palletId: number, estatus = "EnBodega") => {
        // Correlativo es NOT NULL sin default (ver lib/correlativo.ts): mismo truco que
        // etiquetaImpresa.ts, se entra con un temporal único y se reemplaza ya con el id real.
        await tx.$executeRawUnsafe(
          `INSERT INTO EtiquetaImpresa (OrdenId, Estatus, RegistradoPor, Correlativo) VALUES (?, 'Activa', 'prueba', UUID_SHORT())`, ordenId);
        const etiquetaId = Number((await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`))[0].id);
        await tx.$executeRawUnsafe(`UPDATE EtiquetaImpresa SET Correlativo = ? WHERE EtiquetaId = ?`, "E" + etiquetaId, etiquetaId);
        await tx.$executeRawUnsafe(
          `INSERT INTO Masters (PalletId, EtiquetaId, Estatus, IngresadoPor) VALUES (?, ?, ?, 'prueba')`, palletId, etiquetaId, estatus);
        const masterId = Number((await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`))[0].id);
        return { etiquetaId, masterId, correlativo: "E" + etiquetaId };
      };
      const nuevaRemision = async (estatus: string, confirmadaEn: string | null) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO Remisiones (Folio, Tipo, Estatus, Fecha, ConfirmadaEn, CreadoPor)
           VALUES (?, ?, ?, CURDATE(), ?, 'prueba')`,
          "ZZ-DEV-" + Math.random().toString(36).slice(2, 6), serie[0].Tipo, estatus, confirmadaEn);
        return Number((await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`))[0].id);
      };
      const agregarLinea = async (remisionId: number, masterId: number, vigente: number | null) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO RemisionDetalle (RemisionId, MasterId, Vigente, AgregadoPor) VALUES (?, ?, ?, 'prueba')`,
          remisionId, masterId, vigente);
      };
      const leerMaster = async (masterId: number) =>
        (await tx.$queryRawUnsafe(`SELECT Estatus, PalletId FROM Masters WHERE MasterId = ?`, masterId))[0];
      const leerVigente = async (remisionId: number, masterId: number) => {
        const r: any[] = await tx.$queryRawUnsafe(
          `SELECT Vigente FROM RemisionDetalle WHERE RemisionId = ? AND MasterId = ?`, remisionId, masterId);
        return r[0]?.Vigente;
      };

      const origen = await nuevoPallet("Despachado");
      const destino = await nuevoPallet("Abierto");

      // ── 1. Caso normal: un master Salido de una remisión Confirmada reciente ──────────────────
      const m1 = await nuevoMaster(origen, "Salido");
      const m1b = await nuevoMaster(origen, "Salido"); // segunda línea del mismo embarque — NO debe tocarse
      const remision1 = await nuevaRemision("Confirmada", "2026-09-08 10:00:00");
      await agregarLinea(remision1, m1.masterId, 1);
      await agregarLinea(remision1, m1b.masterId, 1);

      const r1: any = await devolverMaster(tx, {
        correlativo: m1.correlativo, palletDestinoId: destino, motivo: "prueba", operador: "prueba", esAdmin: false,
      });
      check("1. responde ok con el folio de la remisión", r1.ok === true && typeof r1.RemisionFolio === "string", JSON.stringify(r1));

      const m1Ahora = await leerMaster(m1.masterId);
      check("2. el master devuelto queda EnBodega en el pallet destino",
        m1Ahora.Estatus === "EnBodega" && Number(m1Ahora.PalletId) === destino, JSON.stringify(m1Ahora));
      check("3. su línea de la remisión queda Vigente = NULL",
        (await leerVigente(remision1, m1.masterId)) === null);

      const m1bAhora = await leerMaster(m1b.masterId);
      check("4. la OTRA línea del mismo embarque NO se toca (sigue Salido)", m1bAhora.Estatus === "Salido", JSON.stringify(m1bAhora));
      check("5. la OTRA línea sigue Vigente = 1", Number(await leerVigente(remision1, m1b.masterId)) === 1);

      const remision1Estatus: any[] = await tx.$queryRawUnsafe(`SELECT Estatus FROM Remisiones WHERE RemisionId = ?`, remision1);
      check("6. la remisión sigue Confirmada (no se anuló el documento)", remision1Estatus[0].Estatus === "Confirmada");

      const kardex: any[] = await tx.$queryRawUnsafe(
        `SELECT PalletId, PalletOrigenId, RemisionId, Tipo FROM MovimientosBodega WHERE MasterId = ? ORDER BY MovimientoId DESC LIMIT 1`,
        m1.masterId);
      check("7. queda kardex Tipo=DEVOLUCION con pallet origen/destino correctos",
        kardex.length === 1 && kardex[0].Tipo === "DEVOLUCION" && Number(kardex[0].PalletId) === destino
        && Number(kardex[0].PalletOrigenId) === origen && Number(kardex[0].RemisionId) === remision1,
        JSON.stringify(kardex));

      // ── 2. El candado real: un master que sigue EnBodega no tiene nada que devolver ───────────
      const m2 = await nuevoMaster(origen, "EnBodega");
      await esperarError("8. rechaza un master que no está Salido",
        () => devolverMaster(tx, { correlativo: m2.correlativo, palletDestinoId: destino, motivo: "x", operador: "prueba", esAdmin: false }),
        "no está Salido");

      // ── 3. Salido pero SIN remisión vigente detrás (caso raro / dato roto) ─────────────────────
      const m3 = await nuevoMaster(origen, "Salido");
      await esperarError("9. rechaza un Salido sin RemisionDetalle vigente",
        () => devolverMaster(tx, { correlativo: m3.correlativo, palletDestinoId: destino, motivo: "x", operador: "prueba", esAdmin: false }),
        "no tiene una remisión vigente");

      // ── 4. Plazo de gracia vencido: rechaza a quien no es admin, deja pasar al admin ──────────
      const m4 = await nuevoMaster(origen, "Salido");
      const remisionVieja = await nuevaRemision("Confirmada", "2026-01-01 08:00:00");
      await agregarLinea(remisionVieja, m4.masterId, 1);
      await esperarError("10. plazo vencido: rechaza si no es admin",
        () => devolverMaster(tx, { correlativo: m4.correlativo, palletDestinoId: destino, motivo: "x", operador: "prueba", esAdmin: false }),
        "solo un administrador");
      const r4: any = await devolverMaster(tx, {
        correlativo: m4.correlativo, palletDestinoId: destino, motivo: "x", operador: "prueba", esAdmin: true,
      });
      check("11. plazo vencido: un admin sí puede devolver", r4.ok === true, JSON.stringify(r4));

      // ── 5. Destino inválido: cerrado, o a capacidad ────────────────────────────────────────────
      const m5 = await nuevoMaster(origen, "Salido");
      const remision5 = await nuevaRemision("Confirmada", "2026-09-08 10:00:00");
      await agregarLinea(remision5, m5.masterId, 1);
      const destinoCerrado = await nuevoPallet("Cerrado");
      await esperarError("12. rechaza un polín de destino que no está Abierto",
        () => devolverMaster(tx, { correlativo: m5.correlativo, palletDestinoId: destinoCerrado, motivo: "x", operador: "prueba", esAdmin: false }),
        "solo un polín abierto");

      const destinoLleno = await nuevoPallet("Abierto", 1);
      await nuevoMaster(destinoLleno, "EnBodega"); // ya ocupa el único cupo
      await esperarError("13. rechaza un polín de destino ya a su capacidad",
        () => devolverMaster(tx, { correlativo: m5.correlativo, palletDestinoId: destinoLleno, motivo: "x", operador: "prueba", esAdmin: false }),
        "ya llegó a su capacidad");

      // ── 6. Validaciones de entrada ──────────────────────────────────────────────────────────────
      await esperarError("14. exige motivo",
        () => devolverMaster(tx, { correlativo: m5.correlativo, palletDestinoId: destino, motivo: "  ", operador: "prueba", esAdmin: false }),
        "motivo de la devolución es requerido");
      await esperarError("15. exige polín de destino",
        () => devolverMaster(tx, { correlativo: m5.correlativo, palletDestinoId: 0, motivo: "x", operador: "prueba", esAdmin: false }),
        "polín de destino es requerido");
      await esperarError("16. rechaza un correlativo que no existe",
        () => devolverMaster(tx, { correlativo: "E99999999", palletDestinoId: destino, motivo: "x", operador: "prueba", esAdmin: false }),
        "QR no reconocido");

      throw new Error(ROLLBACK);
    }, { timeout: 120_000 });
  } catch (err: any) {
    if (err.message !== ROLLBACK) { console.error("ERROR INESPERADO:", err); fallos++; }
  }

  // El fixture no debe haber sobrevivido: si algo quedó, la transacción no revirtió.
  const sobras: any[] = await p.$queryRawUnsafe(`SELECT CodigoPedido FROM Pedidos WHERE CodigoPedido = 'ZZPRUEBA_DEV'`);
  check("17. la transacción revirtió TODO el fixture", sobras.length === 0);

  console.log(`\n${ok}/${ok + fallos} pruebas OK${fallos ? ` — ${fallos} FALLA(S)` : ""}`);
  await p.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main();
