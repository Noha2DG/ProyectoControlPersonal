// Deja una remisión en BORRADOR como quedó de verdad en planta: los polines que el área ya tiene,
// recibidos; el resto, "aún en bodega" y fuera del piso del área. Caso real, 28 oct 2026: RS-0108 se
// regresó a borrador a mano con sus 100 masters en el piso de Descongelado, pero ahí solo quedó el
// 61/70 (B0349 y B0352); el 26/30 (B0372) y el 31/35 (7 de B0367) se quedaron en bodega.
//
// Marca RecibidoEn / RecibidoPor en las líneas de esos polines y deja el ingreso al piso igual a lo
// recibido (sincronizarIngresoDeRemision, con su revisión de saldo: si el área ya trabajó algo de lo
// que se saca, se niega). Antes de aplicar guarda el ingreso y las líneas en Documents/respaldos.
//
//   npx tsx scripts/marcarRecibidosRemision.ts --remision RS-0108 --polines B0349,B0352 \
//       --en "2026-10-28 15:15:04" --por "Entregado por Cindy Benitez"          → simulacro
//   ... --aplicar                                                                → lo aplica
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { sincronizarIngresoDeRemision } from "../src/lib/inventarioPiso.ts";
import { hoyGT } from "../src/lib/dateGT.ts";

const p = new PrismaClient();
const args = process.argv.slice(2);
const arg = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const FOLIO = arg("--remision");
const POLINES = (arg("--polines") ?? "").split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
const EN = arg("--en");
const POR = arg("--por") ?? "Ajuste";
const APLICAR = args.includes("--aplicar");
const SIMULACRO = "__SIMULACRO__";
const json = (v: any) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x), 2);

async function piso(client: any, remisionId: number) {
  return client.$queryRawUnsafe(`
    SELECT mp.MovimientoId, mp.BodegaDestino, mp.Lote, mp.Clase, ta.Descripcion AS Talla, mp.Masters, mp.PesoKg
    FROM MovimientoPiso mp JOIN Tallas ta ON ta.Codigo = mp.Talla
    WHERE mp.RemisionId = ? AND mp.Tipo = 'INGRESO' ORDER BY mp.MovimientoId`, remisionId);
}

async function main() {
  if (!FOLIO || !POLINES.length) throw new Error("Uso: --remision RS-0108 --polines B0349,B0352 [--en 'AAAA-MM-DD HH:MM:SS'] [--por texto] [--aplicar]");
  const [rem]: any[] = await p.$queryRawUnsafe(
    `SELECT RemisionId, Folio, Estatus, BodegaDestino, AreaDestino FROM Remisiones WHERE Folio = ?`, FOLIO);
  if (!rem) throw new Error(`No existe la remisión ${FOLIO}`);
  if (rem.Estatus !== "Borrador") throw new Error(`${FOLIO} está ${rem.Estatus}: este script es para borradores`);
  const remisionId = Number(rem.RemisionId);

  const lineas: any[] = await p.$queryRawUnsafe(`
    SELECT rd.DetalleId, rd.MasterId, rd.RecibidoEn, pa.Codigo AS Polin
    FROM RemisionDetalle rd JOIN Masters m ON m.MasterId = rd.MasterId JOIN Pallets pa ON pa.PalletId = m.PalletId
    WHERE rd.RemisionId = ? AND rd.Vigente = 1`, remisionId);
  const porPolin = new Map<string, number>();
  for (const l of lineas) porPolin.set(l.Polin, (porPolin.get(l.Polin) ?? 0) + 1);
  const faltan = POLINES.filter(c => !porPolin.has(c));
  if (faltan.length) throw new Error(`Estos polines no están en ${FOLIO}: ${faltan.join(", ")}`);
  const recibir = lineas.filter(l => POLINES.includes(l.Polin)).map(l => Number(l.DetalleId));

  console.log(`\n${FOLIO}: polines y masters en la remisión`);
  console.table([...porPolin].map(([Polin, Masters]) => ({ Polin, Masters, Recibido: POLINES.includes(Polin) ? "sí" : "aún en bodega" })));
  console.log("Piso de la remisión antes:");
  console.table(await piso(p, remisionId));

  if (APLICAR) {
    const respaldo = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
      `../../../respaldos/recibidos_${FOLIO}_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.json`);
    fs.mkdirSync(path.dirname(respaldo), { recursive: true });
    fs.writeFileSync(respaldo, json({
      remision: FOLIO,
      ingresos: await p.$queryRawUnsafe(`SELECT * FROM MovimientoPiso WHERE RemisionId = ? AND Tipo = 'INGRESO'`, remisionId),
      lineas: await p.$queryRawUnsafe(`SELECT DetalleId, MasterId, RecibidoEn, RecibidoPor FROM RemisionDetalle WHERE RemisionId = ?`, remisionId),
    }));
    console.log(`Respaldo: ${respaldo}`);
  }

  try {
    await p.$transaction(async (tx: any) => {
      await tx.$queryRawUnsafe(`SELECT RemisionId FROM Remisiones WHERE RemisionId = ? FOR UPDATE`, remisionId);
      await tx.$executeRawUnsafe(
        `UPDATE RemisionDetalle SET RecibidoEn = COALESCE(?, NOW()), RecibidoPor = ? WHERE DetalleId IN (${recibir.map(() => "?").join(",")})`,
        EN, POR, ...recibir);
      const r = await sincronizarIngresoDeRemision(tx, remisionId, rem, hoyGT(), POR);
      console.log(`Recibidos: ${recibir.length} master(s). Piso de la remisión después (${r.kg} kg):`);
      console.table(await piso(tx, remisionId));
      if (!APLICAR) throw new Error(SIMULACRO);
    }, { timeout: 120_000 });
    console.log("Aplicado.");
  } catch (err: any) {
    if (err.message !== SIMULACRO) throw err;
    console.log("Simulacro: no se guardó nada. Para aplicarlo: --aplicar");
  } finally {
    await p.$disconnect();
  }
}

main().catch(err => { console.error(err.message ?? err); process.exit(1); });
