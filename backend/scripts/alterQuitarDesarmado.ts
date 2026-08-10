// Elimina el estado 'Desarmado' del ciclo de vida de los polines (decisión del usuario, 8 ago 2026).
//
// Por qué: desarmar y reabrir terminaron siendo redundantes. Reabrir ya deja el polín en condiciones
// de recibir cajas nuevas Y de ceder las suyas a otro polín, que era todo lo que aportaba desarmar —
// pero sin matar el polín ni volverlo irreversible. Un concepto menos que explicar en planta.
//
// Los polines que quedaron 'Desarmado' se pasan a 'Abierto' y sus masters 'Suelto' a 'EnBodega':
// sin esto quedarían muertos (un 'Desarmado' no se reabre, no se ubica y no recibe escaneos), con su
// producto atrapado. 'Abierto' es exactamente lo que ahora significaría haberlos desarmado.
//
// El kardex NO se toca: los movimientos 'DESARME' históricos se conservan, como todo en esa tabla.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const antes: any[] = await p.$queryRawUnsafe(`
    SELECT pal.Codigo, pal.Estatus, pal.PosicionId,
           SUM(m.Estatus = 'Suelto') AS Sueltos, SUM(m.Estatus = 'EnBodega') AS EnBodega
    FROM Pallets pal LEFT JOIN Masters m ON m.PalletId = pal.PalletId
    WHERE pal.Estatus = 'Desarmado' GROUP BY pal.PalletId
  `);
  if (!antes.length) {
    console.log("No hay polines en estado 'Desarmado' — nada que migrar.");
  } else {
    console.log("Polines a migrar:");
    for (const a of antes) console.log(`  ${a.Codigo}: ${Number(a.Sueltos ?? 0)} suelto(s), ${Number(a.EnBodega ?? 0)} en bodega`);

    // Los desarmados nunca tienen posición (desarmar la exigía liberada), así que pasar a 'Abierto'
    // no puede dejar un polín abierto ocupando un rack.
    const conPosicion = antes.filter(a => a.PosicionId != null);
    if (conPosicion.length) {
      console.error(`ERROR: ${conPosicion.length} polín(es) desarmados tienen posición — no se migran, revisar a mano.`);
      await p.$disconnect();
      process.exit(1);
    }

    const pallets = await p.$executeRawUnsafe(`UPDATE Pallets SET Estatus = 'Abierto' WHERE Estatus = 'Desarmado'`);
    console.log(`\n${pallets} polín(es) pasados de 'Desarmado' a 'Abierto'.`);
  }

  // Los masters 'Suelto' pierden sentido: el estado ahora se deriva del polín (Abierto = manipulable).
  const masters = await p.$executeRawUnsafe(`UPDATE Masters SET Estatus = 'EnBodega' WHERE Estatus = 'Suelto'`);
  console.log(`${masters} master(s) pasados de 'Suelto' a 'EnBodega'.`);

  const restos: any[] = await p.$queryRawUnsafe(`
    SELECT (SELECT COUNT(*) FROM Pallets WHERE Estatus = 'Desarmado') AS PalletsDesarmados,
           (SELECT COUNT(*) FROM Masters WHERE Estatus = 'Suelto') AS MastersSueltos
  `);
  console.log("\nVerificación (ambos deben ser 0):", JSON.stringify(restos[0], (_k, v) => (typeof v === "bigint" ? Number(v) : v)));

  const estado: any[] = await p.$queryRawUnsafe(`
    SELECT pal.Codigo, pal.Estatus, pal.CantidadMaster AS Capacidad, po.Codigo AS Posicion,
           SUM(m.Estatus <> 'Salido') AS EnPolin, SUM(m.Estatus = 'Salido') AS Salidos
    FROM Pallets pal
    LEFT JOIN Masters m ON m.PalletId = pal.PalletId
    LEFT JOIN Posiciones po ON pal.PosicionId = po.PosicionId
    GROUP BY pal.PalletId ORDER BY pal.PalletId
  `);
  console.log("\nEstado final de los polines:");
  for (const e of estado) {
    console.log(`  ${e.Codigo}: ${e.Estatus}${e.Posicion ? ` @ ${e.Posicion}` : ""} — ${Number(e.EnPolin ?? 0)}/${e.Capacidad ?? "?"}${Number(e.Salidos ?? 0) ? ` (+${Number(e.Salidos)} despachados)` : ""}`);
  }

  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
