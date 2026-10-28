// Saca del piso del área lo que bodega YA devolvió de una remisión confirmada antes de que Devolver
// master descontara el piso (arreglado el 28 oct 2026). Caso real: RS-0106, donde Descongelado veía
// 80 masters de 31/35 que Cindy había devuelto a bodega esa mañana en los polines B0367 y B0369.
//
// Por llave (lote, fecha, clase, talla, peso del master) descuenta como mucho el EXCESO del piso: lo
// que el ingreso tiene de más sobre las líneas que siguen vigentes. Así no descuenta dos veces si la
// remisión ya se corrigió a mano (RS-0096 se rehízo con sus vigentes el 27 oct) o si se corre otra vez.
// Usa la misma descontarDevolucionDelPiso que Devolver master, con su revisión de saldo: si el área ya
// trabajó ese producto, se niega.
//
//   npx tsx scripts/descontarDevueltosDelPiso.ts                       → lista las remisiones con exceso
//   npx tsx scripts/descontarDevueltosDelPiso.ts --remision RS-0106    → simulacro de esa remisión
//   npx tsx scripts/descontarDevueltosDelPiso.ts --remision RS-0106 --aplicar
//
// Antes de aplicar guarda las filas de INGRESO de la remisión en Documents/respaldos.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { descontarDevolucionDelPiso } from "../src/lib/inventarioPiso.ts";

const p = new PrismaClient();
const args = process.argv.slice(2);
const FOLIO = args.includes("--remision") ? args[args.indexOf("--remision") + 1] : null;
const APLICAR = args.includes("--aplicar");
const SIMULACRO = "__SIMULACRO__";
const json = (v: any) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x), 2);

// La llave del piso de cada master, calculada igual que el ingreso (lib/inventarioPiso.ts).
const LLAVE = `
  oe.Lote, DATE_FORMAT(oe.FechaProduccion, '%Y-%m-%d') AS FechaLote, dp.Clase, dp.Talla, ta.Descripcion AS DescripcionTalla,
  ROUND(pre.PesoKG * pre.CajasXMaster, 3) AS KgPorMaster`;
const JOINS = `
  JOIN Masters m ON m.MasterId = rd.MasterId
  JOIN EtiquetaImpresa e ON e.EtiquetaId = m.EtiquetaId
  JOIN OrdenEtiquetado oe ON oe.OrdenId = e.OrdenId
  JOIN DetallePedido dp ON dp.DetalleId = oe.DetalleId
  JOIN Presentacion pre ON pre.Codigo = dp.Presentacion
  JOIN Tallas ta ON ta.Codigo = dp.Talla`;
const clave = (r: any) => [r.Lote, r.FechaLote ?? "", r.Clase, String(r.Talla), Number(r.KgPorMaster).toFixed(3)].join("|");

// Por llave: masters en el ingreso del piso, masters vigentes y masters devueltos desde bodega.
async function analizar(client: any, remisionId: number) {
  const ingreso: any[] = await client.$queryRawUnsafe(`
    SELECT Lote, DATE_FORMAT(FechaLote, '%Y-%m-%d') AS FechaLote, Clase, Talla, KgPorMaster,
           SUM(Masters) AS Masters, ROUND(SUM(PesoKg), 2) AS Kg
    FROM MovimientoPiso WHERE RemisionId = ? AND Tipo = 'INGRESO'
    GROUP BY Lote, FechaLote, Clase, Talla, KgPorMaster`, remisionId);
  const vigentes: any[] = await client.$queryRawUnsafe(`
    SELECT ${LLAVE}, COUNT(*) AS Masters FROM RemisionDetalle rd ${JOINS}
    WHERE rd.RemisionId = ? AND rd.Vigente = 1
    GROUP BY oe.Lote, oe.FechaProduccion, dp.Clase, dp.Talla, ta.Descripcion, pre.PesoKG, pre.CajasXMaster`, remisionId);
  // Devuelto desde bodega = línea desmarcada con su DEVOLUCION en el kardex de bodega por esta
  // remisión (Devolver master). Lo devuelto desde el área ya salió del piso allá y no cuenta.
  const devueltos: any[] = await client.$queryRawUnsafe(`
    SELECT rd.MasterId, ${LLAVE} FROM RemisionDetalle rd ${JOINS}
    WHERE rd.RemisionId = ? AND rd.Vigente IS NULL
      AND EXISTS (SELECT 1 FROM MovimientosBodega mb
                  WHERE mb.MasterId = rd.MasterId AND mb.RemisionId = rd.RemisionId AND mb.Tipo = 'DEVOLUCION'
                    AND mb.Motivo LIKE 'Devolución de la remisión%')
    ORDER BY rd.MasterId`, remisionId);

  const vig = new Map(vigentes.map(v => [clave(v), Number(v.Masters)]));
  const porClave = new Map<string, number[]>();
  for (const d of devueltos) porClave.set(clave(d), [...(porClave.get(clave(d)) ?? []), Number(d.MasterId)]);

  return ingreso.map(i => {
    const k = clave(i);
    const exceso = Math.max(0, Number(i.Masters ?? 0) - (vig.get(k) ?? 0));
    const candidatos = porClave.get(k) ?? [];
    return { ...i, Masters: Number(i.Masters ?? 0), Kg: Number(i.Kg), Vigentes: vig.get(k) ?? 0, Exceso: exceso,
             Devueltos: candidatos.length, ids: candidatos.slice(0, exceso) };
  });
}

async function main() {
  if (!FOLIO) {
    const rems: any[] = await p.$queryRawUnsafe(`
      SELECT DISTINCT r.RemisionId, r.Folio FROM Remisiones r
      JOIN MovimientoPiso mp ON mp.RemisionId = r.RemisionId AND mp.Tipo = 'INGRESO'
      JOIN RemisionDetalle rd ON rd.RemisionId = r.RemisionId AND rd.Vigente IS NULL
      WHERE r.Estatus = 'Confirmada' ORDER BY r.RemisionId`);
    const filas: any[] = [];
    for (const r of rems) {
      for (const a of await analizar(p, Number(r.RemisionId))) {
        if (a.ids.length) filas.push({ Folio: r.Folio, Lote: a.Lote, Clase: a.Clase, Talla: a.Talla, AlPiso: a.Masters, Vigentes: a.Vigentes, ADescontar: a.ids.length });
      }
    }
    if (!filas.length) console.log("Ninguna remisión confirmada tiene al piso producto que bodega ya devolvió.");
    else { console.table(filas); console.log("Para corregir una: --remision <folio> (y --aplicar)"); }
    await p.$disconnect();
    return;
  }

  const [rem]: any[] = await p.$queryRawUnsafe(
    `SELECT RemisionId, Folio, Estatus, BodegaDestino, AreaDestino FROM Remisiones WHERE Folio = ?`, FOLIO);
  if (!rem) throw new Error(`No existe la remisión ${FOLIO}`);
  if (rem.Estatus !== "Confirmada") throw new Error(`${FOLIO} está ${rem.Estatus}: este script es solo para confirmadas`);
  const remisionId = Number(rem.RemisionId);

  const antes = await analizar(p, remisionId);
  console.log(`\n${FOLIO} → piso de ${rem.BodegaDestino ?? rem.AreaDestino}`);
  console.table(antes.map(a => ({ Lote: a.Lote, Clase: a.Clase, Talla: a.Talla, AlPiso: a.Masters, Kg: a.Kg, Vigentes: a.Vigentes, DevueltosDesdeBodega: a.Devueltos, ADescontar: a.ids.length })));
  const ids = antes.flatMap(a => a.ids);
  if (!ids.length) { console.log("Nada que descontar."); await p.$disconnect(); return; }

  if (APLICAR) {
    const respaldo = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
      `../../../respaldos/piso_${FOLIO}_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.json`);
    const filas = await p.$queryRawUnsafe(`SELECT * FROM MovimientoPiso WHERE RemisionId = ? AND Tipo = 'INGRESO'`, remisionId);
    fs.mkdirSync(path.dirname(respaldo), { recursive: true });
    fs.writeFileSync(respaldo, json({ remision: FOLIO, ingresos: filas, masters: ids }));
    console.log(`Respaldo: ${respaldo}`);
  }

  try {
    await p.$transaction(async (tx: any) => {
      const r = await descontarDevolucionDelPiso(tx, remisionId, { BodegaDestino: rem.BodegaDestino, AreaDestino: rem.AreaDestino }, ids);
      const despues = await analizar(tx, remisionId);
      console.log(`Sale del piso: ${ids.length} master(s), ${r.kg} kg. Queda así:`);
      console.table(despues.map(a => ({ Lote: a.Lote, Clase: a.Clase, Talla: a.Talla, AlPiso: a.Masters, Kg: a.Kg, Vigentes: a.Vigentes })));
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
