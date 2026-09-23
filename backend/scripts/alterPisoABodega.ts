// SUPERSEDIDO (23 sep 2026) por fusionarBodegas.ts: BodegaProceso se disolvió dentro de
// BodegaVirtual, que era la que tenía los 634 polines colgando. Este script queda como registro de
// lo que se corrió; NO lo vuelva a correr — recrearía la tabla que la fusión eliminó.

// Mueve el inventario al piso del nivel ÁREA al nivel BODEGA.
//
// El producto se para en una bodega (Descongelado, Pelado/Descabezado…), no en un código de área:
// dentro de una misma bodega hay siete áreas que son el mismo piso y la misma gente. Llevar el
// saldo por código de área lo partía en pedazos que no corresponden a ningún lugar físico.
//
// Lo que NO se pierde: `AreaDeclarada` guarda el área fina a la que se dijo que iba el producto.
// La hoja de papel escribe "Pelado" o "Descabezado" como destino aunque sean el mismo piso — no es
// dónde va, es qué se le va a hacer— y ese dato se conserva como declaración, sin partir el saldo.
//
// Es idempotente y seguro de correr con la planta trabajando: agrega columnas al final (INSTANT),
// rellena, y recién entonces suelta las viejas.
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

async function columnaExiste(tabla: string, col: string): Promise<boolean> {
  const [r]: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, tabla, col);
  return Number(r.n) > 0;
}

async function soltarFK(tabla: string, col: string) {
  const fks: any[] = await prisma.$queryRawUnsafe(
    `SELECT CONSTRAINT_NAME AS n FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
        AND REFERENCED_TABLE_NAME IS NOT NULL`, tabla, col);
  for (const f of fks) await prisma.$executeRawUnsafe(`ALTER TABLE ${tabla} DROP FOREIGN KEY ${f.n}`);
}

async function main() {
  // ── HojaProceso: la hoja pertenece a una bodega, no a un área.
  await prisma.$executeRawUnsafe(
    `ALTER TABLE HojaProceso ADD COLUMN IF NOT EXISTS BodegaCodigo VARCHAR(20) NULL`);
  await prisma.$executeRawUnsafe(`
    UPDATE HojaProceso h JOIN Areas a ON a.Codigo = h.AreaCodigo
       SET h.BodegaCodigo = a.BodegaProcesoCodigo
     WHERE h.BodegaCodigo IS NULL AND a.BodegaProcesoCodigo IS NOT NULL`);

  // ── MovimientoPiso: los dos extremos pasan a ser bodegas; el área fina queda como declaración.
  for (const col of ["BodegaOrigen", "BodegaDestino"]) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE MovimientoPiso ADD COLUMN IF NOT EXISTS ${col} VARCHAR(20) NULL`);
  }
  await prisma.$executeRawUnsafe(
    `ALTER TABLE MovimientoPiso ADD COLUMN IF NOT EXISTS AreaDeclarada VARCHAR(10) NULL`);

  const o = Number(await prisma.$executeRawUnsafe(`
    UPDATE MovimientoPiso m JOIN Areas a ON a.Codigo = m.AreaOrigen
       SET m.BodegaOrigen = a.BodegaProcesoCodigo
     WHERE m.BodegaOrigen IS NULL AND a.BodegaProcesoCodigo IS NOT NULL`));
  const d = Number(await prisma.$executeRawUnsafe(`
    UPDATE MovimientoPiso m JOIN Areas a ON a.Codigo = m.AreaDestino
       SET m.BodegaDestino = a.BodegaProcesoCodigo,
           m.AreaDeclarada = COALESCE(m.AreaDeclarada, m.AreaDestino)
     WHERE m.BodegaDestino IS NULL AND a.BodegaProcesoCodigo IS NOT NULL`));
  console.log(`Rellenados: ${o} orígenes y ${d} destinos.`);

  // Nadie puede quedar sin bodega: sería producto en un lugar que no existe.
  const [huerf]: any[] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS n FROM MovimientoPiso
     WHERE (AreaOrigen IS NOT NULL AND BodegaOrigen IS NULL)
        OR (AreaDestino IS NOT NULL AND BodegaDestino IS NULL)`);
  if (Number(huerf.n) > 0) {
    console.error(`ABORTA: ${huerf.n} movimientos quedaron sin bodega. Revise Areas.BodegaProcesoCodigo.`);
    process.exit(1);
  }

  // ── Recién ahora se sueltan las viejas y se ponen las llaves e índices nuevos.
  for (const [tabla, col] of [["MovimientoPiso", "AreaOrigen"], ["MovimientoPiso", "AreaDestino"],
                              ["HojaProceso", "AreaCodigo"]] as [string, string][]) {
    if (await columnaExiste(tabla, col)) {
      await soltarFK(tabla, col);
      await prisma.$executeRawUnsafe(`ALTER TABLE ${tabla} DROP COLUMN ${col}`);
      console.log(`  ${tabla}.${col} eliminada.`);
    }
  }

  const llaves: [string, string, string, string][] = [
    ["MovimientoPiso", "fk_movpiso_bodegaorigen",  "BodegaOrigen",  "BodegaProceso(Codigo)"],
    ["MovimientoPiso", "fk_movpiso_bodegadestino", "BodegaDestino", "BodegaProceso(Codigo)"],
    ["MovimientoPiso", "fk_movpiso_areadeclarada", "AreaDeclarada", "Areas(Codigo)"],
    ["HojaProceso",    "fk_hojaproceso_bodega",    "BodegaCodigo",  "BodegaProceso(Codigo)"],
  ];
  for (const [tabla, nombre, col, ref] of llaves) {
    const [ya]: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`, tabla, nombre);
    if (Number(ya.n) === 0) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${tabla} ADD CONSTRAINT ${nombre} FOREIGN KEY (${col}) REFERENCES ${ref}`);
    }
  }
  // Las dos ramas del saldo, ahora por bodega.
  for (const [nombre, cols] of [["idx_movpiso_bdestino", "(BodegaDestino, FechaProduccion)"],
                                ["idx_movpiso_borigen",  "(BodegaOrigen, FechaProduccion)"]] as [string, string][]) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE MovimientoPiso ADD INDEX IF NOT EXISTS ${nombre} ${cols}`);
  }
  console.log("Llaves e índices nuevos listos.");

  const r: any[] = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(BodegaDestino, BodegaOrigen) AS Bodega, Tipo, COUNT(*) AS n,
           GROUP_CONCAT(DISTINCT AreaDeclarada) AS Areas
    FROM MovimientoPiso GROUP BY 1, 2 ORDER BY 1, 2`);
  console.log("\n  Movimientos por bodega:");
  for (const x of r) console.log(`    ${String(x.Bodega).padEnd(22)} ${String(x.Tipo).padEnd(10)} ${String(x.n).padStart(3)}  área declarada: ${x.Areas ?? "—"}`);

  const h: any[] = await prisma.$queryRawUnsafe(`SELECT HojaId, BodegaCodigo, Estatus FROM HojaProceso`);
  console.log("\n  Hojas:");
  for (const x of h) console.log(`    #${x.HojaId} ${x.BodegaCodigo} ${x.Estatus}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
