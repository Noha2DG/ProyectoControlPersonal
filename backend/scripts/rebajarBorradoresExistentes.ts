// Una sola vez, AL DESPLEGAR "rebajar al escanear" (28 oct 2026): los borradores que ya estaban
// armados tienen sus masters todavía EnBodega, porque se escanearon con la regla vieja (bodega se
// rebajaba al confirmar). Este script les aplica la regla nueva: salen de bodega (Salido + SALIDA en
// el kardex + polín vacío Despachado). El piso del área no se toca: lo recibe al confirmar, que es la
// entrega; mientras tanto el área los ve "aún en bodega".
//
// Correrlo DESPUÉS de desplegar el código nuevo, nunca antes: el código viejo rechaza confirmar una
// remisión con masters Salido ("ya salieron de bodega en otro documento").
//
// Sin argumentos solo muestra lo que haría (y lo prueba dentro de una transacción revertida).
//   npx tsx scripts/rebajarBorradoresExistentes.ts            → simulacro
//   npx tsx scripts/rebajarBorradoresExistentes.ts --aplicar  → lo aplica
//
// Para deshacerlo en un borrador: quitarle las líneas o eliminarlo desde la pantalla, que ya las
// regresa a bodega con la regla nueva.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { rebajarBorrador } from "../src/routes/remisiones.ts";

const p = new PrismaClient();
const APLICAR = process.argv.includes("--aplicar");
const SIMULACRO = "__SIMULACRO__";

async function main() {
  const borradores: any[] = await p.$queryRawUnsafe(`
    SELECT r.RemisionId, r.Folio, r.BodegaDestino,
           SUM(CASE WHEN m.Estatus <> 'Salido' THEN 1 ELSE 0 END) AS EnBodega
    FROM Remisiones r
    JOIN RemisionDetalle rd ON rd.RemisionId = r.RemisionId AND rd.Vigente = 1
    JOIN Masters m ON m.MasterId = rd.MasterId
    WHERE r.Estatus = 'Borrador'
    GROUP BY r.RemisionId, r.Folio, r.BodegaDestino
    HAVING EnBodega > 0
    ORDER BY r.RemisionId`);
  if (!borradores.length) { console.log("No hay borradores con masters en bodega. Nada que hacer."); return; }

  try {
    await p.$transaction(async (tx: any) => {
      for (const b of borradores) {
        const r = await rebajarBorrador(tx, Number(b.RemisionId), "Sistema (rebaja al escanear)");
        console.log(`  ${r.Folio}: ${r.Rebajados} master(s) salen de bodega` +
          (b.BodegaDestino ? ` · ${b.BodegaDestino} los recibe al confirmar` : ""));
      }
      if (!APLICAR) throw new Error(SIMULACRO);
    }, { timeout: 300_000 });
    console.log("\nAplicado.");
  } catch (err: any) {
    if (err.message !== SIMULACRO) throw err;
    console.log("\nSimulacro: no se guardó nada. Para aplicarlo: --aplicar");
  } finally {
    await p.$disconnect();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
