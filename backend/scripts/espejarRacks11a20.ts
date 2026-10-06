// Invierte la numeración de la fila de racks 11–20 para que el Rack 20 quede frente al Rack 1
// y el Rack 11 frente al Rack 10 (la fila 1–10 no cambia).
//
// No se mueve ningún pallet: se renombra cada lugar físico. La posición que estaba en
// (Rack r, Nivel n, Posición p) pasa a llamarse (Rack 31−r, Nivel n, Posición p) y conserva su
// PosicionId, así que Pallets.PosicionId, el kardex (MovimientosBodega) y los bloqueos siguen
// apuntando al mismo lugar de la bodega. Racks.Orden también se invierte (31−Orden) para que el
// mapa dibuje el Rack 20 abajo a la izquierda: sin eso el contenido salta al lado contrario de la
// pantalla. Racks.Nombre no cambia.
//
// Es su propia inversa: correrlo dos veces deja todo como estaba.
//
//   npx tsx scripts/espejarRacks11a20.ts            → ensayo, siempre revierte
//   npx tsx scripts/espejarRacks11a20.ts --aplicar  → confirma el cambio
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APLICAR = process.argv.includes("--aplicar");
const n = (v: any) => (typeof v === "bigint" || (v && typeof v === "object" && "toNumber" in v) ? Number(v) : v);

const RESUMEN = `
  SELECT pos.RackId, COUNT(*) AS Pos, SUM(pos.Bloqueada) AS Bloq, COUNT(pa.PalletId) AS Ocup
  FROM Posiciones pos LEFT JOIN Pallets pa ON pa.PosicionId = pos.PosicionId
  WHERE pos.RackId BETWEEN 11 AND 20 GROUP BY pos.RackId ORDER BY pos.RackId`;

class Revertir extends Error {}

async function main() {
  try {
    await prisma.$transaction(async (tx) => {
      const antesPos: any[] = await tx.$queryRawUnsafe(
        `SELECT PosicionId, RackId, Nivel, Posicion FROM Posiciones WHERE RackId BETWEEN 11 AND 20 FOR UPDATE`);
      const antes: any[] = await tx.$queryRawUnsafe(RESUMEN);
      const movAntes: any[] = await tx.$queryRawUnsafe(`SELECT COUNT(*) AS c, COALESCE(SUM(PosicionOrigenId),0) + COALESCE(SUM(PosicionDestinoId),0) AS s FROM MovimientosBodega`);
      const palAntes: any[] = await tx.$queryRawUnsafe(`SELECT COUNT(*) AS c, COALESCE(SUM(PosicionId),0) AS s FROM Pallets`);
      if (antesPos.length !== 320) throw new Error(`Se esperaban 320 posiciones en racks 11–20, hay ${antesPos.length}`);

      // Paso 1: apartar las 320 filas (Posicion +100, Codigo con prefijo) para no chocar con los UNIQUE.
      await tx.$executeRawUnsafe(
        `UPDATE Posiciones SET Posicion = Posicion + 100, Codigo = CONCAT('X', Codigo) WHERE RackId BETWEEN 11 AND 20`);
      // Paso 2: rack espejo. MariaDB asigna de izquierda a derecha con valores ya actualizados:
      // Codigo va primero para que lea RackId y Posicion originales.
      const n2 = await tx.$executeRawUnsafe(`
        UPDATE Posiciones
        SET Codigo   = CONCAT('R', LPAD(31 - RackId, 2, '0'), '-N', Nivel, '-P', Posicion - 100),
            RackId   = 31 - RackId,
            Posicion = Posicion - 100
        WHERE RackId BETWEEN 11 AND 20 AND Posicion > 100`);
      if (n2 !== 320) throw new Error(`El paso 2 tocó ${n2} filas, se esperaban 320`);
      // Paso 3: orden de dibujo del mapa.
      const n3 = await tx.$executeRawUnsafe(
        `UPDATE Racks SET Orden = 31 - Orden WHERE RackId BETWEEN 11 AND 20 AND Orden BETWEEN 11 AND 20`);
      if (n3 !== 10) throw new Error(`El paso 3 tocó ${n3} racks, se esperaban 10`);

      // Verificación
      const despuesPos: any[] = await tx.$queryRawUnsafe(
        `SELECT PosicionId, RackId, Nivel, Posicion, Codigo FROM Posiciones WHERE RackId BETWEEN 11 AND 20`);
      const porId = new Map(despuesPos.map((r) => [n(r.PosicionId), r]));
      for (const a of antesPos) {
        const d = porId.get(n(a.PosicionId));
        const esperado = `R${String(31 - n(a.RackId)).padStart(2, "0")}-N${n(a.Nivel)}-P${n(a.Posicion)}`;
        if (!d || n(d.RackId) !== 31 - n(a.RackId) || n(d.Nivel) !== n(a.Nivel) || n(d.Posicion) !== n(a.Posicion) || d.Codigo !== esperado)
          throw new Error(`PosicionId ${n(a.PosicionId)} quedó mal: ${JSON.stringify(d, (_k, v) => n(v))}`);
      }
      const malCodigo: any[] = await tx.$queryRawUnsafe(`
        SELECT COUNT(*) AS c FROM Posiciones
        WHERE Codigo <> CONCAT('R', LPAD(RackId, 2, '0'), '-N', Nivel, '-P', Posicion)`);
      if (n(malCodigo[0].c) !== 0) throw new Error(`${n(malCodigo[0].c)} posiciones con Codigo inconsistente`);

      const despues: any[] = await tx.$queryRawUnsafe(RESUMEN);
      const porRack = new Map(despues.map((r) => [n(r.RackId), r]));
      console.log("Rack  antes(ocup/bloq)  →  después(ocup/bloq)");
      for (const a of antes) {
        const d = porRack.get(n(a.RackId))!;
        const e = antes.find((x) => n(x.RackId) === 31 - n(a.RackId))!; // lo que ahora debe tener este rack
        if (n(d.Ocup) !== n(e.Ocup) || n(d.Bloq) !== n(e.Bloq) || n(d.Pos) !== 32)
          throw new Error(`Rack ${n(a.RackId)} no recibió el contenido del rack ${31 - n(a.RackId)}`);
        console.log(`R${n(a.RackId)}    ${n(a.Ocup)}/${n(a.Bloq)}  →  ${n(d.Ocup)}/${n(d.Bloq)}`);
      }

      const movDespues: any[] = await tx.$queryRawUnsafe(`SELECT COUNT(*) AS c, COALESCE(SUM(PosicionOrigenId),0) + COALESCE(SUM(PosicionDestinoId),0) AS s FROM MovimientosBodega`);
      const palDespues: any[] = await tx.$queryRawUnsafe(`SELECT COUNT(*) AS c, COALESCE(SUM(PosicionId),0) AS s FROM Pallets`);
      if (String(n(movAntes[0].c)) + n(movAntes[0].s) !== String(n(movDespues[0].c)) + n(movDespues[0].s)) throw new Error("El kardex cambió");
      if (String(n(palAntes[0].c)) + n(palAntes[0].s) !== String(n(palDespues[0].c)) + n(palDespues[0].s)) throw new Error("Pallets cambió");
      console.log("OK: 320 posiciones renombradas; Pallets y MovimientosBodega intactos.");

      if (!APLICAR) throw new Revertir();
    }, { timeout: 30000 });
    console.log("APLICADO.");
  } catch (e) {
    if (e instanceof Revertir) console.log("Ensayo: transacción revertida, nada cambió.");
    else { console.error("ERROR:", (e as Error).message); process.exitCode = 1; }
  } finally {
    await prisma.$disconnect();
  }
}

main();
