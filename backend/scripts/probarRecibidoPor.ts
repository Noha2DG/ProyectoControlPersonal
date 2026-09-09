// Prueba de resolverDestino() con el campo RecibidoPor nuevo (ver project_devoluciones_design y la
// conversación del 9 sep 2026 sobre Transferencias) contra la BASE REAL, dentro de una transacción
// que siempre se revierte — mismo patrón que probarDevolverMaster.ts, no hay base de desarrollo.
//
//   npx tsx scripts/probarRecibidoPor.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { resolverDestino } from "../src/routes/remisiones.ts";

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
      const serieArea: any[] = await tx.$queryRawUnsafe(`SELECT Tipo, Nombre, Destino, TipoCliente, PidePedido FROM SerieRemision WHERE Destino = 'Area' LIMIT 1`);
      const serieCliente: any[] = await tx.$queryRawUnsafe(`SELECT Tipo, Nombre, Destino, TipoCliente, PidePedido FROM SerieRemision WHERE Destino = 'Cliente' AND PidePedido = 0 LIMIT 1`);
      const empleado: any[] = await tx.$queryRawUnsafe(`SELECT Codigo FROM Empleados WHERE Estado = 'Activo' LIMIT 1`);
      const area: any[] = await tx.$queryRawUnsafe(`SELECT Codigo FROM Areas WHERE Activa = 1 LIMIT 1`);
      const cliente: any[] = await tx.$queryRawUnsafe(`SELECT Codigo FROM Clientes LIMIT 1`);
      if (!serieArea.length) { console.log("  (sin series Destino=Area en catálogo — se omite la prueba)"); return; }

      // ── 1. Serie de área SIN RecibidoPor → rechaza ─────────────────────────────────────────────
      await esperarError("1. exige RecibidoPor en una serie de traslado interno",
        () => resolverDestino(tx, serieArea[0], { AreaDestino: area[0].Codigo }),
        "Quién recibe en el área es requerido");

      // ── 2. Serie de área con un código de empleado inexistente → rechaza ──────────────────────
      await esperarError("2. rechaza un empleado que no existe",
        () => resolverDestino(tx, serieArea[0], { AreaDestino: area[0].Codigo, RecibidoPor: "ZZNOEXISTE99" }),
        "no existe o no está activo");

      // ── 3. Serie de área con empleado real y activo → resuelve y lo devuelve tal cual ─────────
      const destino1: any = await resolverDestino(tx, serieArea[0], { AreaDestino: area[0].Codigo, RecibidoPor: empleado[0].Codigo });
      check("3. resuelve RecibidoPor con un empleado activo", destino1.RecibidoPor === empleado[0].Codigo, JSON.stringify(destino1));
      check("4. AreaDestino queda como se mandó", destino1.AreaDestino === area[0].Codigo);
      check("5. CodigoCliente queda null (destino Area)", destino1.CodigoCliente === null);

      // ── 4. Un empleado dado de baja no puede figurar como RecibidoPor ─────────────────────────
      const bajaRows: any[] = await tx.$queryRawUnsafe(`SELECT Codigo FROM Empleados WHERE Estado <> 'Activo' LIMIT 1`);
      if (bajaRows.length) {
        await esperarError("6. rechaza un empleado dado de baja",
          () => resolverDestino(tx, serieArea[0], { AreaDestino: area[0].Codigo, RecibidoPor: bajaRows[0].Codigo }),
          "no existe o no está activo");
      } else {
        console.log("  (sin empleados de baja en la base — se omite la prueba 6)");
      }

      // ── 5. Una serie a Cliente NUNCA exige ni guarda RecibidoPor ──────────────────────────────
      if (serieCliente.length) {
        const destino2: any = await resolverDestino(tx, serieCliente[0], { CodigoCliente: cliente[0].Codigo });
        check("7. una serie a Cliente resuelve con RecibidoPor = null", destino2.RecibidoPor === null, JSON.stringify(destino2));
      } else {
        console.log("  (sin series Destino=Cliente sin pedido en catálogo — se omite la prueba 7)");
      }

      throw new Error(ROLLBACK);
    }, { timeout: 60_000 });
  } catch (err: any) {
    if (err.message !== ROLLBACK) { console.error("ERROR INESPERADO:", err); fallos++; }
  }

  console.log(`\n${ok}/${ok + fallos} pruebas OK${fallos ? ` — ${fallos} FALLA(S)` : ""}`);
  await p.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main();
