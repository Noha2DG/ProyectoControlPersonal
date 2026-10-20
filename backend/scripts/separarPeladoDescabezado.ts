// Separa la bodega virtual PELADO_DESCABEZADO en dos: PELADO y DESCABEZADO.
//
// Son dos áreas de trabajo distintas, con su propio piso: lo que Descongelado manda a Pelado no es lo
// que manda a Descabezado, y el saldo al piso de cada una tiene que cuadrar por separado. Juntas, el
// destino del descongelado no decía a cuál de las dos fue la libra.
//
// La vieja no se renombra: Codigo es la llave y las cinco FK que apuntan a BodegaVirtual son RESTRICT.
// Se crean las dos nuevas, se repuntan las áreas y se quita la vieja. Al momento de escribir esto
// (20 oct 2026) solo la usaban las 8 áreas: ningún movimiento al piso, hoja ni polín. Si ya hubiera
// alguno, el script se niega —  esas filas no se pueden repartir a ciegas entre las dos.
//
// Áreas compartidas (DB Encargado, DC QC, DJ Chequeadores "Pelado/Descabezado") quedan con PELADO, que
// es el registro que las tenía. Se cambian desde Catálogos → Áreas si hace falta.
//
// Las dos nuevas toman el Orden de la vieja (3); el catálogo ya desempata por Nombre.
//
//   npx tsx scripts/separarPeladoDescabezado.ts             → ensayo: dice qué haría, no escribe
//   npx tsx scripts/separarPeladoDescabezado.ts --aplicar   → lo hace, en una transacción
//   npx tsx scripts/separarPeladoDescabezado.ts --deshacer  → vuelve a juntarlas (solo si siguen vacías)
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

const VIEJA = "PELADO_DESCABEZADO";
const NUEVAS = [
  { Codigo: "PELADO",      Nombre: "Pelado" },
  { Codigo: "DESCABEZADO", Nombre: "Descabezado" },
];
// El resto de las áreas de la vieja se queda con PELADO.
const A_DESCABEZADO = ["DU", "SD"];

const aplicar = process.argv.includes("--aplicar");
const deshacer = process.argv.includes("--deshacer");

async function usos(tx: any, codigo: string) {
  const [r]: any[] = await tx.$queryRawUnsafe(`
    SELECT (SELECT COUNT(*) FROM MovimientoPiso WHERE ? IN (BodegaOrigen, BodegaDestino)) AS Movimientos,
           (SELECT COUNT(*) FROM HojaProceso WHERE BodegaCodigo = ?) AS Hojas,
           (SELECT COUNT(*) FROM Pallets WHERE BodegaVirtualCodigo = ?) AS Pallets`, codigo, codigo, codigo);
  return { Movimientos: Number(r.Movimientos), Hojas: Number(r.Hojas), Pallets: Number(r.Pallets) };
}

async function areasDe(tx: any, codigo: string) {
  return (await tx.$queryRawUnsafe(
    `SELECT Codigo, Nombre FROM Areas WHERE BodegaVirtualCodigo = ? ORDER BY Codigo`, codigo)) as any[];
}

async function separar() {
  const [vieja]: any[] = await prisma.$queryRawUnsafe(`SELECT * FROM BodegaVirtual WHERE Codigo = ?`, VIEJA);
  if (!vieja) { console.log(`${VIEJA} ya no existe. Nada que hacer.`); return; }

  const u = await usos(prisma, VIEJA);
  if (u.Movimientos || u.Hojas || u.Pallets) {
    throw new Error(`${VIEJA} ya tiene datos (${JSON.stringify(u)}): no se pueden repartir a ciegas entre Pelado y Descabezado.`);
  }
  const areas = await areasDe(prisma, VIEJA);
  console.log(`${VIEJA} → Orden ${vieja.Orden}, LlevaPiso ${vieja.LlevaPiso}, sin movimientos, hojas ni polines.`);
  for (const a of areas) {
    const destino = A_DESCABEZADO.includes(a.Codigo) ? "DESCABEZADO" : "PELADO";
    console.log(`  área ${a.Codigo.padEnd(3)} ${String(a.Nombre).padEnd(34)} → ${destino}`);
  }
  if (!aplicar) { console.log("\nEnsayo: no se escribió nada. Corre con --aplicar para hacerlo."); return; }

  await prisma.$transaction(async (tx) => {
    for (const n of NUEVAS) {
      await tx.$executeRawUnsafe(
        `INSERT INTO BodegaVirtual (Codigo, Nombre, Letra, UltimoSecuencial, Activo, Orden, LlevaPiso)
         VALUES (?, ?, NULL, 0, ?, ?, ?)`, n.Codigo, n.Nombre, vieja.Activo, vieja.Orden, vieja.LlevaPiso);
    }
    // Por código de área, no en bloque: solo las que se listaron arriba.
    for (const a of areas) {
      const destino = A_DESCABEZADO.includes(a.Codigo) ? "DESCABEZADO" : "PELADO";
      await tx.$executeRawUnsafe(
        `UPDATE Areas SET BodegaVirtualCodigo = ? WHERE Codigo = ? AND BodegaVirtualCodigo = ?`, destino, a.Codigo, VIEJA);
    }
    // RESTRICT en las cinco FK: si algo siguiera apuntando a la vieja, esto falla y se revierte todo.
    await tx.$executeRawUnsafe(`DELETE FROM BodegaVirtual WHERE Codigo = ?`, VIEJA);
  }, { timeout: 30000, maxWait: 15000 });

  console.log("\nHecho. Quedan:");
  for (const n of NUEVAS) {
    console.log(`  ${n.Codigo}: ${(await areasDe(prisma, n.Codigo)).map(a => a.Codigo).join(", ")}`);
  }
}

async function juntar() {
  const [hay]: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM BodegaVirtual WHERE Codigo = ?`, VIEJA);
  if (Number(hay.n)) { console.log(`${VIEJA} ya existe. Nada que deshacer.`); return; }
  for (const n of NUEVAS) {
    const u = await usos(prisma, n.Codigo);
    if (u.Movimientos || u.Hojas || u.Pallets) {
      throw new Error(`${n.Codigo} ya tiene datos (${JSON.stringify(u)}): juntarlas mezclaría dos pisos que ya cuadran por separado.`);
    }
  }
  const [p]: any[] = await prisma.$queryRawUnsafe(`SELECT * FROM BodegaVirtual WHERE Codigo = 'PELADO'`);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `INSERT INTO BodegaVirtual (Codigo, Nombre, Letra, UltimoSecuencial, Activo, Orden, LlevaPiso)
       VALUES (?, 'Pelado/Descabezado', NULL, 0, ?, ?, ?)`, VIEJA, p.Activo, p.Orden, p.LlevaPiso);
    for (const n of NUEVAS) {
      await tx.$executeRawUnsafe(`UPDATE Areas SET BodegaVirtualCodigo = ? WHERE BodegaVirtualCodigo = ?`, VIEJA, n.Codigo);
      await tx.$executeRawUnsafe(`DELETE FROM BodegaVirtual WHERE Codigo = ?`, n.Codigo);
    }
  }, { timeout: 30000, maxWait: 15000 });
  console.log(`Juntadas de nuevo en ${VIEJA}: ${(await areasDe(prisma, VIEJA)).map(a => a.Codigo).join(", ")}`);
}

(deshacer ? juntar() : separar())
  .catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
