// Separa el inventario migrado de SUMINISTROS (INI-52) en tres pedidos según la variante del sistema anterior.
//   npx tsx scripts/_separarIni52.ts <inventario.csv> [--commit]
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";

const prisma = new PrismaClient();
const COMMIT = process.argv.includes("--commit");
class Revertir extends Error {}

const DESTINO: Record<string, { pedido: string; sub: string; desc: string }> = {
  "SUMINISTROS": { pedido: "INI-52", sub: "S040", desc: "Inventario inicial — SUMINISTROS" },
  "SUMINISTROS-RETAIL": { pedido: "INI-52-RT", sub: "S041", desc: "Inventario inicial — SUMINISTROS RETAIL" },
  "SUMINISTROS-RE EMPAQUE": { pedido: "INI-52-RE", sub: "S040", desc: "Inventario inicial — SUMINISTROS RE EMPAQUE" },
};

function leerCsv(ruta: string): string[][] {
  const txt = fs.readFileSync(ruta, "latin1"); const filas: string[][] = []; let campo = "", fila: string[] = [], enC = false;
  for (let i = 0; i < txt.length; i++) { const c = txt[i];
    if (enC) { if (c === '"') { if (txt[i + 1] === '"') { campo += '"'; i++; } else enC = false; } else campo += c; }
    else if (c === '"') enC = true; else if (c === ";") { fila.push(campo); campo = ""; }
    else if (c === "\n") { fila.push(campo); filas.push(fila); fila = []; campo = ""; } else if (c !== "\r") campo += c; }
  return filas;
}
const N = (s: any) => String(s ?? "").toUpperCase().replace(/\s+/g, " ").trim();

async function main() {
  const variante = new Map<string, string>();
  for (const f of leerCsv(process.argv[2]).slice(1)) if (f[0]?.trim()) variante.set(f[0].trim(), N(f[2]));

  try {
    await prisma.$transaction(async (tx) => {
      const q = (s: string, ...a: any[]) => tx.$queryRawUnsafe(s, ...a) as Promise<any[]>;
      const x = (s: string, ...a: any[]) => tx.$executeRawUnsafe(s, ...a);
      const columnas = async (t: string, excluir: string[]) =>
        (await q(`SHOW COLUMNS FROM ${t}`)).map(c => c.Field).filter(c => !excluir.includes(c));

      const etiquetas = await q(`
        SELECT ei.EtiquetaId, ei.Correlativo, ei.OrdenId, oe.DetalleId, m.MasterId
        FROM EtiquetaImpresa ei JOIN OrdenEtiquetado oe ON oe.OrdenId = ei.OrdenId
        JOIN DetallePedido dp ON dp.DetalleId = oe.DetalleId LEFT JOIN Masters m ON m.EtiquetaId = ei.EtiquetaId
        WHERE dp.CodigoPedido = 'INI-52'`);
      const destinoDe = (e: any) => {
        const v = variante.get(String(e.Correlativo));
        const d = v && DESTINO[v];
        if (!d) throw new Error(`Etiqueta ${e.Correlativo} sin variante reconocida (${v})`);
        return d.pedido;
      };
      for (const e of etiquetas) e.Destino = destinoDe(e);
      const esperado = new Map<string, number>();
      for (const e of etiquetas) esperado.set(e.Destino, (esperado.get(e.Destino) ?? 0) + 1);
      console.log("Etiquetas en INI-52:", etiquetas.length, Object.fromEntries(esperado));

      // ── Pedidos ──
      const base = (await q(`SELECT * FROM Pedidos WHERE CodigoPedido = 'INI-52'`))[0];
      for (const d of Object.values(DESTINO)) {
        if (d.pedido === "INI-52") {
          await x(`UPDATE Pedidos SET CodigoSubcliente = ?, Descripcion = ? WHERE CodigoPedido = 'INI-52'`, d.sub, d.desc);
        } else {
          if ((await q(`SELECT 1 FROM Pedidos WHERE CodigoPedido = ?`, d.pedido)).length) throw new Error(`${d.pedido} ya existe`);
          await x(`INSERT INTO Pedidos (CodigoPedido, CodigoCliente, CodigoSubcliente, Descripcion, FechaInicio, Estatus, EsGeneral) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            d.pedido, base.CodigoCliente, d.sub, d.desc, base.FechaInicio, base.Estatus, base.EsGeneral);
        }
      }

      // ── Líneas: la línea original se queda con un destino; las demás variantes reciben una copia ──
      const colsLinea = await columnas("DetallePedido", ["DetalleId", "CodigoPedido"]);
      const colsHist = (await q(`SHOW COLUMNS FROM DetallePedidoHistorial`)).filter(c => c.Key !== "PRI").map(c => c.Field)
        .filter(c => !["DetalleId", "CodigoPedido", "FechaHora", "RegistradoEn", "CreadoEn"].includes(c));
      const lineaPara = new Map<string, number>(); // `${detalleViejo}|${destino}` -> detalle
      let lineasMovidas = 0, lineasNuevas = 0;
      for (const det of [...new Set(etiquetas.map(e => Number(e.DetalleId)))]) {
        const destinos = [...new Set(etiquetas.filter(e => Number(e.DetalleId) === det).map(e => e.Destino))];
        const seQueda = destinos.includes("INI-52") ? "INI-52" : destinos[0];
        if (seQueda !== "INI-52") {
          await x(`UPDATE DetallePedido SET CodigoPedido = ? WHERE DetalleId = ?`, seQueda, det);
          await x(`UPDATE DetallePedidoHistorial SET CodigoPedido = ? WHERE DetalleId = ?`, seQueda, det);
          lineasMovidas++;
        }
        lineaPara.set(`${det}|${seQueda}`, det);
        for (const dest of destinos.filter(d => d !== seQueda)) {
          await x(`INSERT INTO DetallePedido (CodigoPedido, ${colsLinea.join(", ")}) SELECT ?, ${colsLinea.join(", ")} FROM DetallePedido WHERE DetalleId = ?`, dest, det);
          const nuevo = Number((await q(`SELECT LAST_INSERT_ID() AS id`))[0].id);
          await x(`INSERT INTO DetallePedidoHistorial (DetalleId, CodigoPedido, ${colsHist.join(", ")})
                   SELECT ?, ?, ${colsHist.join(", ")} FROM DetallePedidoHistorial WHERE DetalleId = ? ORDER BY 1 LIMIT 1`, nuevo, dest, det);
          lineaPara.set(`${det}|${dest}`, nuevo);
          lineasNuevas++;
        }
      }
      console.log(`Líneas: ${lineasMovidas} movidas enteras, ${lineasNuevas} creadas por división`);

      // ── Órdenes: misma regla, y las etiquetas de la parte dividida se reapuntan ──
      const colsOrden = await columnas("OrdenEtiquetado", ["OrdenId", "DetalleId", "CantidadMaster"]);
      let ordenesMovidas = 0, ordenesNuevas = 0;
      for (const ord of [...new Set(etiquetas.map(e => Number(e.OrdenId)))]) {
        const suyas = etiquetas.filter(e => Number(e.OrdenId) === ord);
        const det = Number(suyas[0].DetalleId);
        const grupos = new Map<string, any[]>();
        for (const e of suyas) grupos.set(e.Destino, [...(grupos.get(e.Destino) ?? []), e]);
        const [primero, ...resto] = [...grupos.keys()];
        const lineaPrimero = lineaPara.get(`${det}|${primero}`)!;
        if (lineaPrimero !== det || resto.length) {
          await x(`UPDATE OrdenEtiquetado SET DetalleId = ?, CantidadMaster = ? WHERE OrdenId = ?`, lineaPrimero, grupos.get(primero)!.length, ord);
          if (lineaPrimero !== det) ordenesMovidas++;
        }
        for (const dest of resto) {
          const grupo = grupos.get(dest)!;
          await x(`INSERT INTO OrdenEtiquetado (DetalleId, CantidadMaster, ${colsOrden.join(", ")}) SELECT ?, ?, ${colsOrden.join(", ")} FROM OrdenEtiquetado WHERE OrdenId = ?`,
            lineaPara.get(`${det}|${dest}`), grupo.length, ord);
          const nueva = Number((await q(`SELECT LAST_INSERT_ID() AS id`))[0].id);
          await x(`UPDATE EtiquetaImpresa SET OrdenId = ? WHERE EtiquetaId IN (${grupo.map(e => Number(e.EtiquetaId)).join(",")})`, nueva);
          ordenesNuevas++;
        }
      }
      console.log(`Órdenes: ${ordenesMovidas} reapuntadas enteras, ${ordenesNuevas} creadas por división`);

      // ── Remisiones: RemisionDetalle apunta al master (su DetalleId es su propia llave), solo la
      // cabecera guarda pedido. Se recalcula por el pedido de los masters que lleva.
      const cabeceras = await q(`
        SELECT r.RemisionId, r.Folio, GROUP_CONCAT(DISTINCT dp.CodigoPedido) pedidos
        FROM Remisiones r JOIN RemisionDetalle rd ON rd.RemisionId = r.RemisionId
        JOIN Masters m ON m.MasterId = rd.MasterId JOIN EtiquetaImpresa ei ON ei.EtiquetaId = m.EtiquetaId
        JOIN OrdenEtiquetado oe ON oe.OrdenId = ei.OrdenId JOIN DetallePedido dp ON dp.DetalleId = oe.DetalleId
        WHERE r.CodigoPedido = 'INI-52' GROUP BY r.RemisionId`);
      for (const c of cabeceras) {
        const ps = String(c.pedidos).split(",");
        if (ps.length === 1 && ps[0] !== "INI-52") await x(`UPDATE Remisiones SET CodigoPedido = ? WHERE RemisionId = ?`, ps[0], c.RemisionId);
        console.log(`Remisión ${c.Folio}: pedidos de sus líneas = ${c.pedidos}${ps.length > 1 ? " (mixta, cabecera se queda en INI-52)" : ""}`);
      }

      // ── Cuadre ──
      const real = await q(`
        SELECT dp.CodigoPedido, pe.CodigoSubcliente, COUNT(*) etiquetas, SUM(m.Estatus = 'EnBodega') enBodega
        FROM EtiquetaImpresa ei JOIN OrdenEtiquetado oe ON oe.OrdenId = ei.OrdenId JOIN DetallePedido dp ON dp.DetalleId = oe.DetalleId
        JOIN Pedidos pe ON pe.CodigoPedido = dp.CodigoPedido LEFT JOIN Masters m ON m.EtiquetaId = ei.EtiquetaId
        WHERE dp.CodigoPedido IN ('INI-52','INI-52-RT','INI-52-RE') GROUP BY dp.CodigoPedido`);
      console.table(real);
      for (const r of real) if (Number(r.etiquetas) !== esperado.get(r.CodigoPedido)) throw new Error(`CUADRE ROTO en ${r.CodigoPedido}`);
      const descuadre = await q(`
        SELECT oe.OrdenId FROM OrdenEtiquetado oe JOIN DetallePedido dp ON dp.DetalleId = oe.DetalleId
        LEFT JOIN EtiquetaImpresa ei ON ei.OrdenId = oe.OrdenId
        WHERE dp.CodigoPedido IN ('INI-52','INI-52-RT','INI-52-RE') GROUP BY oe.OrdenId HAVING COUNT(ei.EtiquetaId) <> MAX(oe.CantidadMaster)`);
      if (descuadre.length) throw new Error(`Órdenes con CantidadMaster descuadrada: ${descuadre.map(d => d.OrdenId).join(",")}`);
      const remisiones = await q(`
        SELECT r.Folio, r.CodigoPedido, r.Estatus, COUNT(*) masters FROM Remisiones r JOIN RemisionDetalle rd ON rd.RemisionId = r.RemisionId
        WHERE r.CodigoPedido IN ('INI-52','INI-52-RT','INI-52-RE') GROUP BY r.RemisionId`);
      if (remisiones.length) console.table(remisiones);
      console.log("Cuadre OK");
      if (!COMMIT) throw new Revertir();
    }, { timeout: 600_000, maxWait: 60_000 });
    console.log("COMPROMETIDO");
  } catch (e) {
    if (e instanceof Revertir) console.log("ENSAYO: todo revertido");
    else console.log("ERROR:", (e as any).message);
  }
  await prisma.$disconnect();
}
main();
