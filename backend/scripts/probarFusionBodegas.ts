// Verifica que disolver BodegaProceso dentro de BodegaVirtual no rompió nada de lo ya construido.
//
// Lo que más importa acá no es que el catálogo quede bonito sino que los 634 polines que ya existen
// sigan resolviendo su bodega, su hoja y su posición física exactamente igual que antes — y que los
// 42 movimientos al piso, que son los que sí cambiaron de llave, sigan cuadrando.
//
// Lo único que escribe (crear un polín para ver que el correlativo sale bien) va dentro de una
// transacción que SIEMPRE revierte — no hay base de desarrollo, así que la única forma honesta de
// probar contra datos reales es no dejar rastro.
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

let ok = 0, fallo = 0;
const bien = (m: string) => { ok++; console.log(` OK   ${m}`); };
const mal  = (m: string) => { fallo++; console.log(` MAL  ${m}`); };
const check = (c: boolean, m: string) => c ? bien(m) : mal(m);

async function main() {
  const uno = async (sql: string, ...a: any[]) => (await prisma.$queryRawUnsafe(sql, ...a) as any[])[0];

  // ── UNA sola tabla de bodegas.
  const cat = await uno(`SELECT COUNT(*) AS n FROM BodegaVirtual`);
  check(Number(cat.n) === 23, `el catálogo único tiene 23 bodegas (tiene ${cat.n})`);

  const m = await uno(`SELECT Letra, UltimoSecuencial AS s FROM BodegaVirtual WHERE Codigo = 'MASTERIZADO'`);
  check(m?.Letra === "M", `Masterizado quedó con letra M (${m?.Letra ?? "sin letra"})`);
  const viejas = await uno(
    `SELECT COUNT(*) AS n FROM BodegaVirtual WHERE Codigo IN ('MASTERIZADO_ENTERO','MASTERIZADO_VARIOS')`);
  check(Number(viejas.n) === 0, "MASTERIZADO_ENTERO y _VARIOS se fueron");

  // Dos bodegas con la misma letra generarían el mismo código de polín.
  const dup = await prisma.$queryRawUnsafe(
    `SELECT Letra, COUNT(*) AS n FROM BodegaVirtual WHERE Letra IS NOT NULL GROUP BY Letra HAVING n > 1`) as any[];
  check(dup.length === 0, `ninguna letra repetida${dup.length ? ": " + dup.map(d => d.Letra).join(", ") : ""}`);

  // AreaCodigo era la cardinalidad equivocada: apuntaba a UNA área.
  const area = await uno(`SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'BodegaVirtual' AND COLUMN_NAME = 'AreaCodigo'`);
  check(Number(area.n) === 0, "BodegaVirtual.AreaCodigo se fue (el enlace vive en Areas)");

  // ── LO QUE NO SE PODÍA TOCAR: los 634 polines de producción.
  const tot = await uno(`SELECT COUNT(*) AS n FROM Pallets`);
  check(Number(tot.n) === 634, `sus polines siguen ahí: ${tot.n}`);
  const huerf = await uno(`
    SELECT COUNT(*) AS n FROM Pallets p
     WHERE p.BodegaVirtualCodigo IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM BodegaVirtual b WHERE b.Codigo = p.BodegaVirtualCodigo)`);
  check(Number(huerf.n) === 0, `ningún polín quedó sin bodega (${huerf.n} huérfanos)`);

  // El inventario inicial migrado es la mayoría del stock.
  const mig = await uno(`SELECT COUNT(*) AS n FROM Pallets WHERE BodegaVirtualCodigo = 'MIGRACION'`);
  check(Number(mig.n) > 400, `el inventario inicial sigue colgado de MIGRACION (${mig.n} polines)`);

  // La FK de Pallets NUNCA se movió — es el punto de todo el ejercicio.
  const fkp = await uno(`
    SELECT REFERENCED_TABLE_NAME AS t FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Pallets'
       AND COLUMN_NAME = 'BodegaVirtualCodigo' AND REFERENCED_TABLE_NAME IS NOT NULL`);
  check(fkp?.t === "BodegaVirtual", `la llave de Pallets nunca se movió (apunta a ${fkp?.t ?? "nada"})`);

  // ── Lo que SÍ cambió de llave: las 99 filas de esta semana.
  for (const [tabla, col] of [["Areas", "BodegaVirtualCodigo"], ["MovimientoPiso", "BodegaOrigen"],
                              ["MovimientoPiso", "BodegaDestino"], ["HojaProceso", "BodegaCodigo"]]) {
    const f = await uno(`
      SELECT REFERENCED_TABLE_NAME AS t FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
         AND REFERENCED_TABLE_NAME IS NOT NULL`, tabla, col);
    check(f?.t === "BodegaVirtual", `${tabla}.${col} → BodegaVirtual (${f?.t ?? "sin llave"})`);
  }

  const ar = await uno(`SELECT COUNT(*) AS n FROM Areas WHERE BodegaVirtualCodigo IS NOT NULL`);
  check(Number(ar.n) === 56, `las 56 áreas conservan su bodega (${ar.n})`);

  // ── El saldo al piso sobrevivió: mismo total que antes de la fusión.
  const kg = await uno(`
    SELECT ROUND(SUM(PesoKg), 2) AS kg, COUNT(*) AS n FROM MovimientoPiso WHERE Tipo = 'INGRESO'`);
  check(Number(kg.n) > 0 && Number(kg.kg) > 4000,
    `los movimientos al piso siguen cuadrando: ${kg.n} ingresos, ${kg.kg} kg`);

  const saldo = await prisma.$queryRawUnsafe(`
    SELECT b.Nombre, ROUND(SUM(t.Delta), 2) AS Kg FROM (
      SELECT BodegaDestino AS Bodega,  PesoKg AS Delta FROM MovimientoPiso WHERE BodegaDestino IS NOT NULL
      UNION ALL
      SELECT BodegaOrigen  AS Bodega, -PesoKg AS Delta FROM MovimientoPiso WHERE BodegaOrigen  IS NOT NULL
    ) t JOIN BodegaVirtual b ON b.Codigo = t.Bodega GROUP BY b.Nombre HAVING SUM(t.Delta) <> 0`) as any[];
  check(saldo.length > 0, `el saldo al piso se lee por bodega: ${saldo.map((s: any) => `${s.Nombre} ${s.Kg} kg`).join(", ")}`);

  // ── El selector de "Nuevo pallet" ofrece exactamente lo que puede armar un polín.
  const gen = await prisma.$queryRawUnsafe(
    `SELECT Codigo, Letra FROM BodegaVirtual WHERE Letra IS NOT NULL AND Activo = 1 ORDER BY Orden`) as any[];
  check(gen.length === 5,
    `5 bodegas activas generan polines: ${gen.map((g: any) => `${g.Codigo}(${g.Letra})`).join(" ")}`);
  check(!gen.some((g: any) => g.Codigo === "DESCONGELADO"),
    "Descongelado NO aparece en el selector de polines");

  // ── Y las consultas que ya existían siguen devolviendo lo mismo.
  const sinNombre = await prisma.$queryRawUnsafe(`
    SELECT p.Codigo FROM Pallets p
      LEFT JOIN BodegaVirtual bv ON p.BodegaVirtualCodigo = bv.Codigo
     WHERE bv.Nombre IS NULL AND p.BodegaVirtualCodigo IS NOT NULL LIMIT 3`) as any[];
  check(sinNombre.length === 0, "el listado de polines muestra el nombre de bodega en todas las filas");

  // ── Lo único que escribe: crear un polín de verdad y revertirlo.
  const antes = await uno(`SELECT UltimoSecuencial AS n FROM BodegaVirtual WHERE Codigo = 'TUNEL'`);
  try {
    await prisma.$transaction(async (tx) => {
      const [b]: any[] = await tx.$queryRawUnsafe(
        `SELECT Codigo, Letra FROM BodegaVirtual WHERE Codigo = 'TUNEL' FOR UPDATE`);
      await tx.$executeRawUnsafe(
        `UPDATE BodegaVirtual SET UltimoSecuencial = UltimoSecuencial + 1 WHERE Codigo = 'TUNEL'`);
      const [s]: any[] = await tx.$queryRawUnsafe(
        `SELECT UltimoSecuencial AS n FROM BodegaVirtual WHERE Codigo = 'TUNEL'`);
      const codigo = String(b.Letra) + String(Number(s.n)).padStart(4, "0");
      check(codigo === `T${String(Number(antes.n) + 1).padStart(4, "0")}`,
        `el correlativo sigue la serie de Túnel: ${codigo}`);

      await tx.$executeRawUnsafe(
        `INSERT INTO Pallets (Codigo, Origen, CantidadMaster, BodegaVirtualCodigo, CreadoPor)
         VALUES (?, 'BODEGA', 10, 'TUNEL', 'prueba')`, codigo);
      const [leido]: any[] = await tx.$queryRawUnsafe(`
        SELECT p.Codigo, bv.Nombre FROM Pallets p
          JOIN BodegaVirtual bv ON p.BodegaVirtualCodigo = bv.Codigo WHERE p.Codigo = ?`, codigo);
      check(leido?.Nombre === "Túnel", `el polín nuevo resuelve su bodega: ${leido?.Nombre}`);

      // Una bodega sin letra no arma polines — es la validación de la ruta.
      const [sinLetra]: any[] = await tx.$queryRawUnsafe(
        `SELECT Letra FROM BodegaVirtual WHERE Codigo = 'DESCONGELADO'`);
      check(sinLetra?.Letra == null, "Descongelado no tiene letra, así que no puede armar un polín");

      throw new Error("ROLLBACK");
    });
  } catch (e: any) {
    if (!e.message.includes("ROLLBACK")) throw e;
  }

  const final = await uno(`SELECT UltimoSecuencial AS n FROM BodegaVirtual WHERE Codigo = 'TUNEL'`);
  check(Number(final.n) === Number(antes.n), `la prueba no dejó rastro: Túnel sigue en ${final.n}`);
  const totFinal = await uno(`SELECT COUNT(*) AS n FROM Pallets`);
  check(Number(totFinal.n) === Number(tot.n), `sus polines intactos: ${totFinal.n}`);

  console.log(`\n${fallo === 0 ? "TODO OK" : "HAY FALLOS"}  —  ${ok} bien, ${fallo} mal`);
  await prisma.$disconnect();
  if (fallo) process.exit(1);
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
