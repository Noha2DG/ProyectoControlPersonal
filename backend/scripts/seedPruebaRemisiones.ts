// DATOS DE PRUEBA para el módulo de Remisiones — 3 polines ubicados en bodega física, de 50 masters
// cada uno, cada uno de un cliente distinto (así se puede probar el caso de mezclar producto de
// varios clientes en un mismo contenedor).
//
//   npx tsx scripts/seedPruebaRemisiones.ts            → siembra
//   npx tsx scripts/seedPruebaRemisiones.ts --limpiar  → borra TODO lo que sembró, nada más
//
// NO es catálogo ni configuración: es producto ficticio. Los 3 pedidos llevan el prefijo PRB26 y
// "PRUEBA" en la descripción justamente para poder identificarlos y barrerlos de un solo golpe.
// Siembra la cadena completa igual que la haría la planta:
//   Pedido → DetallePedido → OrdenEtiquetado → EtiquetaImpresa → Pallet → Masters → posición física
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { componerCodigoLote } from "../src/lib/codigoLote.ts";

const p = new PrismaClient();
const LIMPIAR = process.argv.includes("--limpiar");

const MASTERS_POR_PALLET = 50;
const FECHA_PRODUCCION = new Date().toISOString().slice(0, 10);

// Un polín por cliente, con producto/presentación distintos para que las pruebas no sean todas
// iguales. Los códigos de cliente y subcliente son los reales del catálogo.
const LOTES = [
  {
    Pedido: "PRB26001", Cliente: 14, Subcliente: "S032",     // GOLD LAKE — GOLDEN PROFIT (exportación TW)
    Descripcion: "PRUEBA REMISIONES - GOLD LAKE",
    Clase: "E41", Proceso: 41, Talla: 229, Presentacion: "QH", Empaque: "M26",
    PiscinaId: 3, Ciclo: "6", BodegaVirtual: "TUNEL", Origen: "FRESCO", Congelacion: "BLASTF1",
  },
  {
    Pedido: "PRB26002", Cliente: 40, Subcliente: "S039",     // RED CHAMBER COMPANY (US)
    Descripcion: "PRUEBA REMISIONES - RED CHAMBER",
    Clase: "C20", Proceso: 20, Talla: 217, Presentacion: "MB", Empaque: "M26",
    PiscinaId: 4, Ciclo: "6", BodegaVirtual: "MASTERIZADO_ENTERO", Origen: "FRESCO", Congelacion: "BLASTF2",
  },
  {
    Pedido: "PRB26003", Cliente: 51, Subcliente: "W05",      // WALMART (venta local GT)
    Descripcion: "PRUEBA REMISIONES - WALMART",
    Clase: "E46", Proceso: 46, Talla: 233, Presentacion: "JL", Empaque: "M26",
    PiscinaId: 5, Ciclo: "7", BodegaVirtual: "MASTERIZADO_VARIOS", Origen: "FRESCO", Congelacion: "TUNEL",
  },
];

const CODIGOS_PEDIDO = LOTES.map(l => l.Pedido);

async function limpiar() {
  const lista = CODIGOS_PEDIDO.map(c => `'${c}'`).join(",");
  // Orden inverso al de las FK. Se navega desde los pedidos de prueba hacia abajo, así que si el
  // usuario ya creó remisiones reales con este producto, también se van (son igual de ficticias).
  const pallets: any[] = await p.$queryRawUnsafe(`
    SELECT DISTINCT m.PalletId FROM Masters m
    JOIN EtiquetaImpresa ei ON m.EtiquetaId = ei.EtiquetaId
    JOIN OrdenEtiquetado oe ON ei.OrdenId = oe.OrdenId
    JOIN DetallePedido dp ON oe.DetalleId = dp.DetalleId
    WHERE dp.CodigoPedido IN (${lista})
  `);
  const palletIds = pallets.map(r => Number(r.PalletId));

  const remisiones: any[] = palletIds.length ? await p.$queryRawUnsafe(`
    SELECT DISTINCT rd.RemisionId FROM RemisionDetalle rd
    JOIN Masters m ON rd.MasterId = m.MasterId
    WHERE m.PalletId IN (${palletIds.join(",")})
  `) : [];
  const remisionIds = remisiones.map(r => Number(r.RemisionId));

  if (palletIds.length) {
    const pl = palletIds.join(",");
    await p.$executeRawUnsafe(`DELETE FROM MovimientosBodega WHERE PalletId IN (${pl})`);
    await p.$executeRawUnsafe(`DELETE rd FROM RemisionDetalle rd JOIN Masters m ON rd.MasterId = m.MasterId WHERE m.PalletId IN (${pl})`);
    await p.$executeRawUnsafe(`DELETE FROM Masters WHERE PalletId IN (${pl})`);
    await p.$executeRawUnsafe(`DELETE FROM Pallets WHERE PalletId IN (${pl})`);
  }
  if (remisionIds.length) await p.$executeRawUnsafe(`DELETE FROM Remisiones WHERE RemisionId IN (${remisionIds.join(",")})`);

  await p.$executeRawUnsafe(`
    DELETE ei FROM EtiquetaImpresa ei
    JOIN OrdenEtiquetado oe ON ei.OrdenId = oe.OrdenId
    JOIN DetallePedido dp ON oe.DetalleId = dp.DetalleId
    WHERE dp.CodigoPedido IN (${lista})
  `);
  await p.$executeRawUnsafe(`
    DELETE oe FROM OrdenEtiquetado oe
    JOIN DetallePedido dp ON oe.DetalleId = dp.DetalleId
    WHERE dp.CodigoPedido IN (${lista})
  `);
  await p.$executeRawUnsafe(`DELETE FROM DetallePedido WHERE CodigoPedido IN (${lista})`);
  await p.$executeRawUnsafe(`DELETE FROM Pedidos WHERE CodigoPedido IN (${lista})`);

  console.log(`Limpieza lista: ${palletIds.length} polín(es), ${remisionIds.length} remisión(es) y los 3 pedidos de prueba eliminados.`);
}

async function sembrar() {
  const yaExiste: any[] = await p.$queryRawUnsafe(
    `SELECT CodigoPedido FROM Pedidos WHERE CodigoPedido IN (${CODIGOS_PEDIDO.map(c => `'${c}'`).join(",")})`
  );
  if (yaExiste.length) {
    console.error(`Estos pedidos de prueba ya existen: ${yaExiste.map(r => r.CodigoPedido).join(", ")}`);
    console.error("Corre primero:  npx tsx scripts/seedPruebaRemisiones.ts --limpiar");
    process.exit(1);
  }

  const libres: any[] = await p.$queryRawUnsafe(`
    SELECT PosicionId, Codigo FROM Posiciones
    WHERE Bloqueada = 0 AND PosicionId NOT IN (SELECT PosicionId FROM Pallets WHERE PosicionId IS NOT NULL)
    ORDER BY RackId, Nivel, Posicion LIMIT ${LOTES.length}
  `);
  if (libres.length < LOTES.length) throw new Error("No hay suficientes posiciones libres en bodega física");

  const resumen: any[] = [];

  for (let i = 0; i < LOTES.length; i++) {
    const L = LOTES[i];
    const pos = libres[i];

    const pres: any[] = await p.$queryRawUnsafe(
      `SELECT CajasXMaster, PesoKG, PesoLb FROM Presentacion WHERE Codigo = ?`, L.Presentacion
    );
    const cajasXMaster = Number(pres[0].CajasXMaster);
    const pesoKgCaja = Number(pres[0].PesoKG);
    const pesoLbCaja = Number(pres[0].PesoLb);

    // El pedido se programa a 60 masters y se producen 50: así el techo de la línea NO queda topado
    // y todavía se pueden escanear masters nuevos a mano si hace falta durante la prueba.
    const objetivoMasters = MASTERS_POR_PALLET + 10;
    const cantidadCajas = objetivoMasters * cajasXMaster;

    await p.$executeRawUnsafe(
      `INSERT INTO Pedidos (CodigoPedido, CodigoCliente, CodigoSubcliente, Descripcion, FechaInicio, Estatus)
       VALUES (?, ?, ?, ?, ?, 'Proceso')`,
      L.Pedido, L.Cliente, L.Subcliente, L.Descripcion, FECHA_PRODUCCION
    );

    await p.$executeRawUnsafe(
      `INSERT INTO DetallePedido (CodigoPedido, Clase, Proceso, Talla, Presentacion, EmpaqueMaster, CantidadCajas, KgPedido, LibrasPedido)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      L.Pedido, L.Clase, L.Proceso, L.Talla, L.Presentacion, L.Empaque,
      cantidadCajas, +(cantidadCajas * pesoKgCaja).toFixed(3), +(cantidadCajas * pesoLbCaja).toFixed(3)
    );
    const dRow: any[] = await p.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`);
    const detalleId = Number(dRow[0].id);

    // El código de lote se arma con la MISMA función que usan Destajo y Etiquetado — no a mano,
    // para que estos lotes de prueba tengan exactamente el formato real (letra año + semana ISO).
    const piscina: any[] = await p.$queryRawUnsafe(`SELECT Nombre FROM Piscina WHERE PiscinaId = ?`, L.PiscinaId);
    const lote = componerCodigoLote(piscina[0].Nombre, FECHA_PRODUCCION, L.Ciclo);

    const bv: any[] = await p.$queryRawUnsafe(`SELECT Codigo, Letra, AreaCodigo FROM BodegaVirtual WHERE Codigo = ?`, L.BodegaVirtual);

    await p.$executeRawUnsafe(
      `INSERT INTO OrdenEtiquetado (Lote, PiscinaId, Ciclo, DetalleId, AreaCodigo, FechaProduccion, Color, Origen, Congelacion, CantidadMaster, Estatus, RegistradoPor)
       VALUES (?, ?, ?, ?, ?, ?, 'sc', ?, ?, ?, 'Pendiente', 'Datos de prueba')`,
      lote, L.PiscinaId, L.Ciclo, detalleId, bv[0].AreaCodigo, FECHA_PRODUCCION,
      L.Origen, L.Congelacion, MASTERS_POR_PALLET
    );
    const oRow: any[] = await p.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`);
    const ordenId = Number(oRow[0].id);

    // El código del polín sale del contador real de su bodega virtual, no de un número inventado:
    // así estos polines no chocan con los que la planta genere después.
    await p.$executeRawUnsafe(`UPDATE BodegaVirtual SET UltimoSecuencial = UltimoSecuencial + 1 WHERE Codigo = ?`, bv[0].Codigo);
    const sec: any[] = await p.$queryRawUnsafe(`SELECT UltimoSecuencial FROM BodegaVirtual WHERE Codigo = ?`, bv[0].Codigo);
    const codigoPallet = String(bv[0].Letra) + String(Number(sec[0].UltimoSecuencial)).padStart(4, "0");

    await p.$executeRawUnsafe(
      `INSERT INTO Pallets (Codigo, Estatus, Origen, CantidadMaster, BodegaVirtualCodigo, PosicionId, CreadoPor, CerradoPor, CerradoEn)
       VALUES (?, 'Cerrado', ?, ?, ?, ?, 'Datos de prueba', 'Datos de prueba', NOW())`,
      codigoPallet, L.Origen, MASTERS_POR_PALLET, bv[0].Codigo, Number(pos.PosicionId)
    );
    const palRow: any[] = await p.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`);
    const palletId = Number(palRow[0].id);

    // 50 etiquetas + sus 50 masters. Se insertan una por una porque cada Master necesita el
    // EtiquetaId recién generado; a 150 filas el costo es irrelevante.
    const correlativos: number[] = [];
    for (let n = 0; n < MASTERS_POR_PALLET; n++) {
      await p.$executeRawUnsafe(
        `INSERT INTO EtiquetaImpresa (OrdenId, Tamano, Estatus, RegistradoPor) VALUES (?, '3x1', 'Activa', 'Datos de prueba')`,
        ordenId
      );
      const eRow: any[] = await p.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`);
      const etiquetaId = Number(eRow[0].id);
      correlativos.push(etiquetaId);
      await p.$executeRawUnsafe(
        `INSERT INTO Masters (PalletId, EtiquetaId, Estatus, IngresadoPor) VALUES (?, ?, 'EnBodega', 'Datos de prueba')`,
        palletId, etiquetaId
      );
      await p.$executeRawUnsafe(
        `INSERT INTO ImpresionLog (EtiquetaId, Motivo, ImpresoPor) VALUES (?, 'Datos de prueba', 'Datos de prueba')`,
        etiquetaId
      );
    }

    // El INGRESO del kardex es lo que hace que el mapa de bodega muestre quién y cuándo la ubicó.
    await p.$executeRawUnsafe(
      `INSERT INTO MovimientosBodega (PalletId, Tipo, PosicionOrigenId, PosicionDestinoId, Usuario)
       VALUES (?, 'INGRESO', NULL, ?, 'Datos de prueba')`,
      palletId, Number(pos.PosicionId)
    );

    resumen.push({
      Polin: codigoPallet, Posicion: pos.Codigo, Pedido: L.Pedido, Lote: lote,
      Masters: MASTERS_POR_PALLET,
      Correlativos: `E${correlativos[0]} … E${correlativos[correlativos.length - 1]}`,
      Kg: +(MASTERS_POR_PALLET * cajasXMaster * pesoKgCaja).toFixed(2),
    });
    console.log(`  ${codigoPallet} en ${pos.Codigo} — ${L.Descripcion} — 50 masters (E${correlativos[0]}…E${correlativos.at(-1)})`);
  }

  console.log("\n=== Sembrado ===");
  console.table(resumen);
  const tot: any[] = await p.$queryRawUnsafe(`
    SELECT (SELECT COUNT(*) FROM Pallets) AS Pallets, (SELECT COUNT(*) FROM Masters) AS Masters,
           (SELECT COUNT(*) FROM EtiquetaImpresa) AS Etiquetas
  `);
  console.log("Totales en BD:", JSON.stringify(tot[0], (_k, v) => (typeof v === "bigint" ? Number(v) : v)));
  console.log("\nPara borrar todo esto:  npx tsx scripts/seedPruebaRemisiones.ts --limpiar");
}

(LIMPIAR ? limpiar() : sembrar())
  .catch(e => { console.error("ERROR:", e.message); process.exitCode = 1; })
  .finally(() => p.$disconnect());
