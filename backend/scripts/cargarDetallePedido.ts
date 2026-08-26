// Carga en bloque de las líneas de producto de un pedido, a partir de las listas del sistema viejo
// (Clase · Talla · Presentación). Nació el 25 ago 2026 para la tienda ORO DEL PACÍFICO y se
// generalizó al día siguiente con TOP FOODS: la lista cambia, el procedimiento no.
//
//   npx tsx scripts/cargarDetallePedido.ts <CodigoPedido> [--commit]
//
// Sin --commit hace la carga completa dentro de una transacción y la revierte al final: sirve para
// ver el resultado real contra producción —incluidas las descripciones armadas, que es como se
// coteja contra la lista original— sin dejar nada escrito.
//
// Replica lo que hace POST /api/detalle-pedido, no el INSERT pelado:
//   · el Proceso NO se escribe a mano, sale de la Clase (está denormalizado en DetallePedido porque
//     la llave única es sobre Proceso y no sobre Clase — ver alterPedidoGeneral.ts);
//   · en un pedido general las cantidades no se planifican: cada línea va con el centinela de 1 caja
//     y el peso de su presentación;
//   · cada alta deja su renglón en DetallePedidoHistorial, para que estas líneas queden
//     indistinguibles de las capturadas a mano en la pantalla de Pedidos.
//
// Los empaques no vienen en las listas del sistema viejo: los define el usuario y por eso viven
// aquí, junto a las tallas de cada grupo.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

const REGISTRADO_POR = "Administrador";

type Grupo = { clase: string; presentacion: string; master: string; accesorio: string | null; tallas: number[] };

const CARGAS: Record<string, { nota: string; grupos: Grupo[] }> = {
  // Tienda ORO DEL PACÍFICO — cargado el 25 ago 2026 (DetalleId 83-98).
  // La 261 y la 376 se describen las dos "150/200" (261 es de la escala de entero y 376 de la de
  // colas): van las dos, confirmado con el usuario.
  "1205070": {
    nota: "Tienda Oro del Pacífico",
    grupos: [
      { clase: "D30", presentacion: "NY", master: "M26", accesorio: "B28", tallas: [261, 356, 361, 366, 371, 376, 381] },
      { clase: "C20", presentacion: "PD", master: "M26", accesorio: "B41", tallas: [213, 217, 221, 229, 233, 237, 241, 245, 249] },
    ],
  },
  // TOP FOODS — 26 ago 2026. E41 y P14 comparten tallas en NL, pero son procesos distintos (41 y
  // 14), así que no chocan contra la llave única del pedido.
  "2026010": {
    nota: "Top Foods",
    grupos: [
      { clase: "E41", presentacion: "NL", master: "M26", accesorio: "B25", tallas: [321, 326, 336, 341, 346, 351, 356] },
      { clase: "P14", presentacion: "NL", master: "M26", accesorio: "B25", tallas: [346, 351, 356, 361] },
      { clase: "E41", presentacion: "NY", master: "M26", accesorio: "B25", tallas: [305] },
      { clase: "E41", presentacion: "PQ", master: "M26", accesorio: "B56", tallas: [341, 346] },
    ],
  },
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

class Revertir extends Error {}

async function main() {
  const PEDIDO = process.argv[2];
  const COMMIT = process.argv.includes("--commit");
  const carga = CARGAS[PEDIDO];
  if (!carga) throw new Error(`Uso: cargarDetallePedido.ts <CodigoPedido> [--commit]\nPedidos con lista definida: ${Object.keys(CARGAS).join(", ")}`);

  const pedido: any[] = await p.$queryRaw`
    SELECT CodigoPedido, Descripcion, Estatus, EsGeneral FROM Pedidos WHERE CodigoPedido = ${PEDIDO}
  `;
  if (!pedido.length) throw new Error(`El pedido ${PEDIDO} no existe`);
  if (Number(pedido[0].EsGeneral) !== 1) throw new Error(`El pedido ${PEDIDO} no es general: no aplica el centinela de 1 caja`);
  console.log(`Pedido ${PEDIDO} — ${pedido[0].Descripcion} (${pedido[0].Estatus}, general) · ${carga.nota}`);

  const resumen: string[] = [];
  try {
    await p.$transaction(async tx => {
      for (const grupo of carga.grupos) {
        // Mismo contexto que arma el endpoint: Proceso desde la Clase y el peso desde la Presentación.
        const ctx: any[] = await tx.$queryRaw`
          SELECT cl.Proceso, cl.Descripcion AS DescClase, pr.PesoKG, pr.PesoLb, pr.Descripcion AS DescPres
          FROM Clase cl JOIN Presentacion pr ON pr.Codigo = ${grupo.presentacion}
          WHERE cl.Clase = ${grupo.clase} LIMIT 1
        `;
        if (!ctx.length) throw new Error(`Clase ${grupo.clase} o presentación ${grupo.presentacion} no existen`);
        const proceso = Number(ctx[0].Proceso);
        const kg = round3(Number(ctx[0].PesoKG));
        const lb = round3(Number(ctx[0].PesoLb));

        for (const talla of grupo.tallas) {
          const talladesc: any[] = await tx.$queryRaw`SELECT Descripcion FROM Tallas WHERE Codigo = ${talla} LIMIT 1`;
          if (!talladesc.length) throw new Error(`La talla ${talla} no existe`);

          // La llave única es (CodigoPedido, Proceso, Talla, Presentacion): si la línea ya está, se
          // deja como está en vez de reventar contra el índice a media carga. Eso hace el script
          // repetible: se puede volver a correr con la lista ampliada y solo entra lo que falta.
          const yaEsta: any[] = await tx.$queryRaw`
            SELECT DetalleId FROM DetallePedido
            WHERE CodigoPedido = ${PEDIDO} AND Proceso = ${proceso} AND Talla = ${talla} AND Presentacion = ${grupo.presentacion}
            LIMIT 1
          `;
          if (yaEsta.length) {
            resumen.push(`  = ${grupo.clase} ${String(talla).padEnd(3)} ${grupo.presentacion}  ya existía (DetalleId ${yaEsta[0].DetalleId})`);
            continue;
          }

          await tx.$executeRaw`
            INSERT INTO DetallePedido (CodigoPedido, Clase, Proceso, Talla, Presentacion, EmpaqueMaster, EmpaqueAccesorio, CantidadCajas, KgPedido, LibrasPedido)
            VALUES (${PEDIDO}, ${grupo.clase}, ${proceso}, ${talla}, ${grupo.presentacion}, ${grupo.master}, ${grupo.accesorio}, 1, ${kg}, ${lb})
          `;
          const filas: any[] = await tx.$queryRaw`SELECT LAST_INSERT_ID() AS id`;
          const detalleId = Number(filas[0].id);

          await tx.$executeRaw`
            INSERT INTO DetallePedidoHistorial
              (DetalleId, CodigoPedido, Accion, Clase, Proceso, Talla, Presentacion,
               EmpaqueMaster, EmpaqueAccesorio, CantidadCajas, KgPedido, LibrasPedido, RegistradoPor)
            VALUES (${detalleId}, ${PEDIDO}, 'Alta', ${grupo.clase}, ${proceso}, ${talla}, ${grupo.presentacion},
                    ${grupo.master}, ${grupo.accesorio}, 1, ${kg}, ${lb}, ${REGISTRADO_POR})
          `;
          resumen.push(`  + ${grupo.clase} ${String(talla).padEnd(3)} ${grupo.presentacion}  ${ctx[0].DescClase}-${ctx[0].DescPres}-${talladesc[0].Descripcion}  (${kg} kg / ${lb} lb)  ${grupo.master}${grupo.accesorio ? "+" + grupo.accesorio : ""}  DetalleId ${detalleId}`);
        }
      }
      if (!COMMIT) throw new Revertir();
    }, { timeout: 60_000 });
  } catch (err) {
    if (!(err instanceof Revertir)) throw err;
  }

  console.log(resumen.join("\n"));
  const altas = resumen.filter(r => r.startsWith("  +")).length;
  const existentes = resumen.filter(r => r.startsWith("  =")).length;
  console.log(`\n${altas} línea(s) nueva(s), ${existentes} ya existente(s).`);
  console.log(COMMIT ? "GUARDADO." : "SIMULACIÓN — la transacción se revirtió, no se escribió nada. Repetir con --commit.");
}

main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => p.$disconnect());
