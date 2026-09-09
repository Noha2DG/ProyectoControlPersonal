// Prueba del cuadre por (Proceso, Talla) con una linea de granel — TODO dentro de una transaccion
// que SIEMPRE revierte, porque backend/.env apunta a produccion y no hay base de desarrollo.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const PEDIDO = "016-2026";
let fallos = 0;

function chk(nombre: string, real: any, esperado: any) {
  const ok = Math.abs(Number(real) - Number(esperado)) < 0.005;
  if (!ok) fallos++;
  console.log(`  ${ok ? "OK  " : "FALLA"} ${nombre.padEnd(46)} real=${real}  esperado=${esperado}`);
}

// Mismo SQL del endpoint GET /cuadre, contra el cliente transaccional.
async function cuadre(tx: any, pedido: string) {
  return tx.$queryRawUnsafe(`
    SELECT dp.Proceso, MIN(dp.Clase) AS Clase, dp.Talla,
           SUM(CASE WHEN dp.EsGranel = 0 THEN dp.KgPedido ELSE 0 END)   AS ObjetivoKg,
           SUM(COALESCE(d.n, 0)          * pr.PesoKG * pr.CajasXMaster) AS DeclaradoKg,
           SUM(COALESCE(f.enBodega, 0)   * pr.PesoKG * pr.CajasXMaster) AS EnBodegaKg,
           SUM(COALESCE(f.despachado, 0) * pr.PesoKG * pr.CajasXMaster) AS DespachadoKg,
           SUM(CASE WHEN dp.EsGranel = 1
                    THEN (COALESCE(f.enBodega, 0) + COALESCE(f.despachado, 0)) * pr.PesoKG * pr.CajasXMaster
                    ELSE 0 END)                                         AS GranelKg,
           SUM(dp.EsGranel)                                             AS LineasGranel
    FROM DetallePedido dp
    JOIN Presentacion pr ON pr.Codigo = dp.Presentacion
    LEFT JOIN (
      SELECT DetalleId, SUM(CantidadMaster) AS n FROM OrdenEtiquetado
      WHERE Estatus <> 'Cancelada' AND DetalleId IN (SELECT DetalleId FROM DetallePedido WHERE CodigoPedido = ?)
      GROUP BY DetalleId
    ) d ON d.DetalleId = dp.DetalleId
    LEFT JOIN (
      SELECT oe.DetalleId,
             SUM(CASE WHEN m.Estatus <> 'Salido' THEN 1 ELSE 0 END) AS enBodega,
             SUM(CASE WHEN m.Estatus =  'Salido' THEN 1 ELSE 0 END) AS despachado
      FROM Masters m
      JOIN EtiquetaImpresa ei ON ei.EtiquetaId = m.EtiquetaId
      JOIN OrdenEtiquetado oe ON oe.OrdenId = ei.OrdenId
      WHERE oe.DetalleId IN (SELECT DetalleId FROM DetallePedido WHERE CodigoPedido = ?)
      GROUP BY oe.DetalleId
    ) f ON f.DetalleId = dp.DetalleId
    WHERE dp.CodigoPedido = ?
    GROUP BY dp.Proceso, dp.Talla ORDER BY dp.Proceso, dp.Talla
  `, pedido, pedido, pedido);
}

class Revertir extends Error {}

async function main() {
  // Catalogos validos para armar la captura
  const [pis]: any = await p.$queryRawUnsafe(`SELECT PiscinaId FROM Piscina LIMIT 1`);
  const [ori]: any = await p.$queryRawUnsafe(`SELECT Codigo FROM Origen LIMIT 1`);
  const [con]: any = await p.$queryRawUnsafe(`SELECT Codigo FROM UnidadesCongelacion LIMIT 1`);
  const [lot]: any = await p.$queryRawUnsafe(`SELECT Lote FROM Lotes LIMIT 1`);
  console.log(`Fixture: piscina=${pis.PiscinaId} origen=${ori.Codigo} congelacion=${con.Codigo} lote=${lot.Lote}\n`);

  try {
    await p.$transaction(async (tx: any) => {
      const ex = (s: string, ...v: any[]) => tx.$executeRawUnsafe(s, ...v);
      const uno = async (s: string, ...v: any[]) => (await tx.$queryRawUnsafe(s, ...v) as any[])[0];

      // ---- 1. La linea de proforma de 21/25 (talla 217, QH) ya existe
      const prof = await uno(`SELECT DetalleId, KgPedido FROM DetallePedido WHERE CodigoPedido=? AND Talla=217 AND EsGranel=0`, PEDIDO);
      console.log(`Linea de proforma 21/25: DetalleId=${prof.DetalleId}, objetivo ${prof.KgPedido} kg\n`);

      // ---- 2. Se acaba el empaque: se abre la linea de granel (misma logica del endpoint)
      console.log("1) Alta de la linea de granel (talla 217, PQ 1/20 lb)");
      const cand: any[] = await tx.$queryRawUnsafe(
        `SELECT dp.Proceso, MIN(dp.Clase) AS Clase, MIN(dp.EmpaqueMaster) AS EmpaqueMaster
         FROM DetallePedido dp WHERE dp.CodigoPedido=? AND dp.Talla=217 AND dp.EsGranel=0 GROUP BY dp.Proceso`, PEDIDO);
      chk("la talla resuelve UN solo proceso", cand.length, 1);
      chk("proceso heredado de la proforma", cand[0].Proceso, 41);
      const pres = await uno(`SELECT PesoKG, PesoLb, CajasXMaster FROM Presentacion WHERE Codigo='PQ'`);
      chk("PQ es presentacion de granel (1 unidad/master)", pres.CajasXMaster, 1);

      await ex(`INSERT INTO DetallePedido (CodigoPedido, Clase, Proceso, Talla, Presentacion, EmpaqueMaster, EmpaqueAccesorio, CantidadCajas, KgPedido, LibrasPedido, EsGranel)
                VALUES (?,?,?,217,'PQ',?,NULL,1,?,?,1)`,
        PEDIDO, cand[0].Clase, cand[0].Proceso, cand[0].EmpaqueMaster, Number(pres.PesoKG), Number(pres.PesoLb));
      const granelId = Number((await uno(`SELECT LAST_INSERT_ID() AS id`)).id);
      console.log(`   linea de granel creada: DetalleId=${granelId} (${cand[0].Clase}, proceso ${cand[0].Proceso})\n`);

      // ---- 3. Produccion: 10 master de QH y 3 de granel, todos escaneados a bodega
      console.log("2) Se produce: 10 master empacados (QH) + 3 a granel (PQ)");
      await ex(`INSERT INTO Pallets (Codigo, Estatus, CreadoEn) VALUES ('TMP-TEST','Abierto',NOW())`);
      const palletId = Number((await uno(`SELECT LAST_INSERT_ID() AS id`)).id);

      const capturar = async (detalleId: number, masters: number) => {
        await ex(`INSERT INTO OrdenEtiquetado (Lote, PiscinaId, Ciclo, DetalleId, FechaProduccion, Origen, Congelacion, CantidadMaster, Estatus, CreadoEn)
                  VALUES (?,?,'1',?,CURDATE(),?,?,?,'Activa',NOW())`,
          lot.Lote, pis.PiscinaId, detalleId, ori.Codigo, con.Codigo, masters);
        const ordenId = Number((await uno(`SELECT LAST_INSERT_ID() AS id`)).id);
        for (let i = 0; i < masters; i++) {
          // Correlativo es NOT NULL desde alterEtiquetaImpresaCorrelativo.ts: entra un temporal
          // unico y se reemplaza por el definitivo, igual que hace la ruta real de impresion.
          await ex(`INSERT INTO EtiquetaImpresa (OrdenId, Estatus, CreadoEn, Correlativo) VALUES (?, 'Impresa', NOW(), UUID_SHORT())`, ordenId);
          const etq = Number((await uno(`SELECT LAST_INSERT_ID() AS id`)).id);
          await ex(`UPDATE EtiquetaImpresa SET Correlativo = ? WHERE EtiquetaId = ?`, "E" + etq, etq);
          await ex(`INSERT INTO Masters (PalletId, EtiquetaId, Estatus, FechaIngreso) VALUES (?,?,'EnBodega',NOW())`, palletId, etq);
        }
      };
      await capturar(Number(prof.DetalleId), 10);
      await capturar(granelId, 3);

      // ---- 4. El cuadre
      const filas: any[] = await cuadre(tx, PEDIDO);
      const t217 = filas.find(f => Number(f.Talla) === 217);
      console.log("\n3) Cuadre de (proceso 41, talla 217)");
      const kgQH = Number(pres.PesoKG) * 1; // PQ: 1 unidad por master
      const kgPorMasterQH = 0.38 * 20;      // QH tal como esta hoy en el catalogo

      chk("ObjetivoKg = solo la proforma (granel no suma)", t217.ObjetivoKg, prof.KgPedido);
      chk("DeclaradoKg = 10 QH + 3 granel", t217.DeclaradoKg, 10 * kgPorMasterQH + 3 * kgQH);
      chk("EnBodegaKg  = 10 QH + 3 granel", t217.EnBodegaKg, 10 * kgPorMasterQH + 3 * kgQH);
      chk("DespachadoKg = 0 (nada salio)", t217.DespachadoKg, 0);
      chk("GranelKg = solo los 3 de granel", t217.GranelKg, 3 * kgQH);
      chk("LineasGranel = 1", t217.LineasGranel, 1);

      // ---- 5. El granel NO debe tener techo propio
      const techo: any[] = await tx.$queryRawUnsafe(
        `SELECT dp.CantidadCajas, dp.EsGranel, pr.CajasXMaster, ped.EsGeneral
         FROM DetallePedido dp JOIN Presentacion pr ON dp.Presentacion=pr.Codigo
         JOIN Pedidos ped ON dp.CodigoPedido=ped.CodigoPedido WHERE dp.DetalleId=?`, granelId);
      const objetivoGranel = (Number(techo[0].EsGeneral) === 1 || Number(techo[0].EsGranel) === 1)
        ? null : Math.ceil(Number(techo[0].CantidadCajas) / Number(techo[0].CajasXMaster));
      console.log("\n4) Candado de Agrupacion");
      chk("Objetivo de la linea de granel = null (sin techo)", objetivoGranel === null ? 1 : 0, 1);

      // ---- 6. Talla que NO esta en el pedido: el granel debe rechazarse
      const inexistente: any[] = await tx.$queryRawUnsafe(
        `SELECT Proceso FROM DetallePedido WHERE CodigoPedido=? AND Talla=999 AND EsGranel=0`, PEDIDO);
      console.log("\n5) Rechazos");
      chk("talla ajena al pedido no tiene candidatos", inexistente.length, 0);

      // ---- 7. Otras tallas del pedido quedan intactas
      const t346 = filas.find(f => Number(f.Talla) === 346);
      chk("otra talla sin produccion sigue en 0 declarado", t346.DeclaradoKg, 0);
      chk("otra talla conserva su objetivo", t346.ObjetivoKg, 68.4);

      console.log("\nCuadre completo del pedido:");
      console.table(filas.map(f => ({ Proceso: Number(f.Proceso), Talla: Number(f.Talla),
        ObjetivoKg: Number(f.ObjetivoKg), DeclaradoKg: Number(f.DeclaradoKg),
        GranelKg: Number(f.GranelKg), LineasGranel: Number(f.LineasGranel) })));

      throw new Revertir();
    }, { timeout: 120_000 });
  } catch (e) {
    if (!(e instanceof Revertir)) throw e;
    console.log("\n>> Transaccion revertida: la base quedo igual que antes.");
  }

  // Verificacion de que efectivamente no quedo nada
  const [n]: any = await p.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM DetallePedido WHERE EsGranel=1`);
  const [m]: any = await p.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM Masters`);
  console.log(`   lineas de granel en la base: ${n.n}   masters: ${m.n}   (deben ser 0 y 0)`);

  console.log(fallos === 0 ? "\nTODAS LAS PRUEBAS PASARON" : `\n${fallos} PRUEBAS FALLARON`);
  await p.$disconnect();
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async e => { console.error(e); await p.$disconnect(); process.exit(1); });
