// Prueba de "quitar masters" (por escaneo y por el botón de cada fila) contra la BASE REAL, pero SIN
// dejar nada: todo corre dentro de una transacción que al final SIEMPRE se revierte (se lanza a
// propósito). Así se ejercita el esquema de verdad — llaves foráneas, tipos, el UNIQUE de
// Masters.EtiquetaId — sin sembrar pedidos falsos en producción ni ensuciar la prueba que esté
// corriendo la planta. Es la forma de probar teniendo una sola base: no hay una de desarrollo.
//
//   npx tsx scripts/probarQuitarMasters.ts
//
// Único rastro que deja: los AUTO_INCREMENT avanzan (los ids que usó el fixture quedan como huecos),
// que es inevitable en MariaDB y no afecta a nada.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { quitarMasterEscaneado, quitarMasterDePallet, bloquearPalletAbierto } from "../src/routes/pallets.ts";

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
      const bv: any[] = await tx.$queryRawUnsafe(`SELECT Codigo, AreaCodigo FROM BodegaVirtual LIMIT 1`);
      const org: any[] = await tx.$queryRawUnsafe(`SELECT Codigo FROM Origen LIMIT 1`);
      const pis: any[] = await tx.$queryRawUnsafe(`SELECT PiscinaId FROM Piscina LIMIT 1`);
      const emp: any[] = await tx.$queryRawUnsafe(`SELECT Codigo FROM Empaques LIMIT 1`);
      const cong: any[] = await tx.$queryRawUnsafe(`SELECT Codigo FROM UnidadesCongelacion LIMIT 1`);

      const PEDIDO = "ZZPRUEBA1";
      await tx.$executeRawUnsafe(
        `INSERT INTO Pedidos (CodigoPedido, CodigoCliente, Descripcion, FechaInicio, Estatus)
         VALUES (?, ?, 'PRUEBA AUTOMATICA (revertida)', CURDATE(), 'Proceso')`,
        PEDIDO, cli[0].Codigo);
      // CantidadCajas alto = techo de línea holgado: lo que se prueba es quitar, no el techo.
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

      const nuevoPallet = async (estatus: string) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO Pallets (Codigo, Estatus, Origen, CantidadMaster, BodegaVirtualCodigo, CreadoPor)
           VALUES (?, ?, ?, 10, ?, 'prueba')`,
          "ZZ" + Math.random().toString(36).slice(2, 8), estatus, org[0].Codigo, bv[0].Codigo);
        return Number((await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`))[0].id);
      };
      const nuevoMaster = async (palletId: number) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO EtiquetaImpresa (OrdenId, Tamano, Estatus, RegistradoPor) VALUES (?, '3x1', 'Activa', 'prueba')`, ordenId);
        const etiquetaId = Number((await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`))[0].id);
        await tx.$executeRawUnsafe(
          `INSERT INTO Masters (PalletId, EtiquetaId, Estatus, IngresadoPor) VALUES (?, ?, 'EnBodega', 'prueba')`, palletId, etiquetaId);
        const masterId = Number((await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`))[0].id);
        return { etiquetaId, masterId, correlativo: "E" + etiquetaId };
      };
      const contar = async (palletId: number) =>
        Number((await tx.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM Masters WHERE PalletId = ?`, palletId))[0].n);

      const palletA = await nuevoPallet("Abierto");
      const palletB = await nuevoPallet("Abierto");
      const palletCerrado = await nuevoPallet("Cerrado");

      // ── 1. Caso normal: escaneado directo se BORRA y el correlativo queda libre ────────────────
      const m1 = await nuevoMaster(palletA);
      const antes = await contar(palletA);
      const r1: any = await quitarMasterEscaneado(tx, palletA, m1.correlativo, "prueba");
      check("1. quita el master escaneado", r1.Accion === "Eliminado", JSON.stringify(r1));
      check("2. devuelve MasterId y Correlativo para la pantalla", r1.MasterId === m1.masterId && r1.Correlativo === m1.correlativo, JSON.stringify(r1));
      check("3. la fila de Masters se borró", (await contar(palletA)) === antes - 1);
      check("4. el correlativo queda libre para re-escanearse",
        Number((await tx.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM Masters WHERE EtiquetaId = ?`, m1.etiquetaId))[0].n) === 0);

      // ── 2. El lector manda el número pelado o el correlativo con E ─────────────────────────────
      const m2 = await nuevoMaster(palletA);
      const r2: any = await quitarMasterEscaneado(tx, palletA, String(m2.etiquetaId), "prueba");
      check("5. acepta el correlativo sin la E", r2.Accion === "Eliminado" && r2.Correlativo === m2.correlativo);

      // ── 3. Errores que tiene que atajar ───────────────────────────────────────────────────────
      const m3 = await nuevoMaster(palletB);
      await esperarError("6. rechaza un master de OTRO polín (y lo dice)",
        () => quitarMasterEscaneado(tx, palletA, m3.correlativo, "prueba"), "no está en este polín");
      check("7. el master del otro polín sigue ahí", (await contar(palletB)) === 1);

      await esperarError("8. rechaza un QR que no está en bodega",
        () => quitarMasterEscaneado(tx, palletA, "E99999999", "prueba"), "no está escaneado en ningún polín");
      await esperarError("9. rechaza un correlativo inválido",
        () => quitarMasterEscaneado(tx, palletA, "hola", "prueba"), "Correlativo inválido");
      await esperarError("10. rechaza un pallet inexistente",
        () => quitarMasterEscaneado(tx, 999999999, m3.correlativo, "prueba"), "Pallet no encontrado");

      const mCerrado = await nuevoMaster(palletCerrado);
      await esperarError("11. no deja quitar de un polín Cerrado",
        () => quitarMasterEscaneado(tx, palletCerrado, mCerrado.correlativo, "prueba"), "no está abierto");

      // ── 4. Master llegado por TRASLADO: no se borra, vuelve a su polín de origen ───────────────
      const m4 = await nuevoMaster(palletB);
      await tx.$executeRawUnsafe(`UPDATE Masters SET PalletId = ? WHERE MasterId = ?`, palletA, m4.masterId);
      const codigoB = (await tx.$queryRawUnsafe(`SELECT Codigo FROM Pallets WHERE PalletId = ?`, palletB))[0].Codigo;
      await tx.$executeRawUnsafe(
        `INSERT INTO MovimientosBodega (PalletId, PalletOrigenId, MasterId, Tipo, Usuario, Motivo)
         VALUES (?, ?, ?, 'TRASLADO', 'prueba', 'prueba')`, palletA, palletB, m4.masterId);
      const r4: any = await quitarMasterEscaneado(tx, palletA, m4.correlativo, "prueba");
      check("12. el traslado se deshace en vez de borrar", r4.Accion === "TrasladoDeshecho", JSON.stringify(r4));
      check("13. dice a qué polín volvió la caja", r4.PalletOrigen === codigoB, `→ ${r4.PalletOrigen} vs ${codigoB}`);
      const m4Ahora: any[] = await tx.$queryRawUnsafe(`SELECT PalletId, Estatus FROM Masters WHERE MasterId = ?`, m4.masterId);
      check("14. el master existe y quedó en su polín de origen",
        m4Ahora.length === 1 && Number(m4Ahora[0].PalletId) === palletB && m4Ahora[0].Estatus === "EnBodega", JSON.stringify(m4Ahora));
      check("15. queda el rastro en el kardex",
        Number((await tx.$queryRawUnsafe(
          `SELECT COUNT(*) AS n FROM MovimientosBodega WHERE MasterId = ? AND PalletId = ? AND Tipo = 'TRASLADO'`,
          m4.masterId, palletB))[0].n) === 1);

      // ── 5. Candado de remisión: una caja comprometida no se baja por aquí ──────────────────────
      const serie: any[] = await tx.$queryRawUnsafe(`SELECT Tipo FROM SerieRemision LIMIT 1`);
      const m5 = await nuevoMaster(palletA);
      await tx.$executeRawUnsafe(
        `INSERT INTO Remisiones (Folio, Tipo, Estatus, Fecha, CreadoPor) VALUES ('ZZ-PRUEBA-1', ?, 'Borrador', CURDATE(), 'prueba')`,
        serie[0].Tipo);
      const remisionId = Number((await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`))[0].id);
      await tx.$executeRawUnsafe(
        `INSERT INTO RemisionDetalle (RemisionId, MasterId, Vigente, AgregadoPor) VALUES (?, ?, 1, 'prueba')`,
        remisionId, m5.masterId);
      await esperarError("16. no deja quitar una caja tomada por una remisión",
        () => quitarMasterEscaneado(tx, palletA, m5.correlativo, "prueba"), "ZZ-PRUEBA-1");

      // Y el mismo candado por el otro camino (el botón Quitar de cada fila), que antes reventaba
      // con un error de llave foránea en vez de decir qué pasaba.
      await esperarError("17. mismo candado desde el botón de la fila",
        () => quitarMasterDePallet(tx, palletA, m5.masterId, "prueba"), "ZZ-PRUEBA-1");

      // ── 6. Master ya despachado ────────────────────────────────────────────────────────────────
      const m6 = await nuevoMaster(palletA);
      await tx.$executeRawUnsafe(`UPDATE Masters SET Estatus = 'Salido' WHERE MasterId = ?`, m6.masterId);
      await esperarError("18. no deja quitar una caja que ya salió de bodega",
        () => quitarMasterEscaneado(tx, palletA, m6.correlativo, "prueba"), "ya salió de bodega");

      // ── 7. El camino del botón de la fila sigue funcionando igual ──────────────────────────────
      const m7 = await nuevoMaster(palletA);
      await bloquearPalletAbierto(tx, palletA);
      const r7: any = await quitarMasterDePallet(tx, palletA, m7.masterId, "prueba");
      check("19. el botón Quitar de la fila sigue borrando", r7.Accion === "Eliminado", JSON.stringify(r7));
      await esperarError("20. y rechaza un master que no es de ese polín",
        () => quitarMasterDePallet(tx, palletA, m3.masterId, "prueba"), "no encontrado en este pallet");

      throw new Error(ROLLBACK);
    }, { timeout: 120_000 });
  } catch (err: any) {
    if (err.message !== ROLLBACK) { console.error("ERROR INESPERADO:", err); fallos++; }
  }

  // El fixture no debe haber sobrevivido: si algo quedó, la transacción no revirtió.
  const sobras: any[] = await p.$queryRawUnsafe(`SELECT CodigoPedido FROM Pedidos WHERE CodigoPedido = 'ZZPRUEBA1'`);
  check("21. la transacción revirtió TODO el fixture", sobras.length === 0);

  console.log(`\n${ok}/${ok + fallos} pruebas OK${fallos ? ` — ${fallos} FALLA(S)` : ""}`);
  await p.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main();
