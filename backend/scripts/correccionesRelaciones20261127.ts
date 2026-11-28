import "dotenv/config";
import prisma from "../src/lib/prisma.ts";
import { leerMarcaje, registrarBitacora } from "../src/lib/bitacoraMarcaje.ts";

// Correcciones de la revisión de relaciones del 27 nov 2026.
//
//   npx tsx scripts/correccionesRelaciones20261127.ts             → solo muestra qué haría
//   npx tsx scripts/correccionesRelaciones20261127.ts --aplicar   → lo hace
//   npx tsx scripts/correccionesRelaciones20261127.ts --revertir  → deja todo como estaba
//
// Datos (cada cambio queda en BitacoraMarcaje con el valor anterior; --revertir lo repone desde ahí):
//   1. Transferencias abiertas de personas dadas de baja: se cierran a la hora de su Salida de ese día
//      (la baja manual no las cerraba; quedaban "dentro" de su área desde septiembre).
//   2. Transferencias con salida antes que la entrada: la entrada pasa a ser la salida de la anterior
//      de ese día, que es cuando el kiosco la abrió (solo si esa anterior existe y cuadra).
// Estructura:
//   3. Transferencias: una sola abierta por persona (AbiertaCodigo + UNIQUE, como MesaAsignacion) e
//      índice de cobertura para "en qué área estaba a tal hora" (incluye id para que el desempate entre
//      dos que empiezan el mismo segundo siga siendo el mismo de siempre); quita idx_codigo_fechahora,
//      que queda cubierto.
//   4. Pallets.Codigo único: la app busca los polines por ese código (letra de bodega + consecutivo).
//   5. MovimientoPiso.MasterId: columna vacía y sin uso, con borrado en cascada hacia Masters. Se quita.
//   6. MovimientoPiso.PesadaId: comentario en la columna. Guarda el MovimientoId del primer consumo del
//      termo, no un id de Pesada; el nombre engaña.

const MARCA = "Sistema (corrección 27 nov 2026)";
const modo = process.argv.includes("--aplicar") ? "aplicar" : process.argv.includes("--revertir") ? "revertir" : "ver";
const q = async (s: string, ...a: any[]) => (await prisma.$queryRawUnsafe(s, ...a)) as any[];
const ejecutar = async (sql: string) => {
  if (modo === "ver") { console.log(`   (haría) ${sql}`); return; }
  await prisma.$executeRawUnsafe(sql);
  console.log(`   ✓ ${sql}`);
};
const indice = async (t: string, i: string) => (await q(`SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`, t, i)).length > 0;
const columna = async (t: string, c: string) => (await q(`SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`, t, c)).length > 0;
const llave = async (t: string, n: string) => (await q(`SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? LIMIT 1`, t, n)).length > 0;

const COMENTARIO_PESADA = "MovimientoId del primer CONSUMO del termo (agrupa una pesada de Descongelado); NO es Pesada.PesadaId";

async function corregirTransferencia(id: number, cambio: { FechaHora?: string; FechaSalida?: string }) {
  if (modo === "ver") { console.log(`   (haría) transferencia #${id} → ${JSON.stringify(cambio)}`); return; }
  await prisma.$transaction(async tx => {
    const antes = await leerMarcaje(tx, "Transferencias", id);
    if (!antes) return;
    if (cambio.FechaHora) await tx.$executeRaw`UPDATE Transferencias SET FechaHora = ${cambio.FechaHora} WHERE id = ${id}`;
    if (cambio.FechaSalida) await tx.$executeRaw`UPDATE Transferencias SET FechaSalida = ${cambio.FechaSalida} WHERE id = ${id}`;
    const despues = await leerMarcaje(tx, "Transferencias", id);
    await registrarBitacora(tx, { tabla: "Transferencias", id, accion: "EDITAR", antes, despues, usuario: MARCA });
  });
  console.log(`   ✓ transferencia #${id} → ${JSON.stringify(cambio)}`);
}

async function aplicar() {
  console.log("1. Transferencias abiertas de personas dadas de baja");
  const abiertas = await q(`
    SELECT t.id, t.Codigo, DATE_FORMAT(t.FechaHora, '%Y-%m-%d %H:%i:%s') AS ini,
           (SELECT DATE_FORMAT(MIN(m.FechaHora), '%Y-%m-%d %H:%i:%s') FROM Movimientos m
             WHERE m.Codigo = t.Codigo AND m.Tipo = 'Salida' AND m.FechaHora >= t.FechaHora
               AND m.FechaHora < DATE(t.FechaHora) + INTERVAL 1 DAY) AS salida,
           CONCAT(DATE(t.FechaHora), ' 23:59:59') AS finDia
      FROM Transferencias t JOIN Empleados e ON e.Codigo = t.Codigo
     WHERE t.FechaSalida IS NULL AND e.Estado <> 'Activo'`);
  if (!abiertas.length) console.log("   ninguna");
  for (const a of abiertas) {
    console.log(`   ${a.Codigo} #${a.id} desde ${a.ini}: ${a.salida ? "a su Salida de ese día" : "al final de ese día (no marcó Salida)"}`);
    await corregirTransferencia(Number(a.id), { FechaSalida: a.salida ?? a.finDia });
  }

  console.log("2. Transferencias con salida antes que la entrada");
  const invertidas = await q(`
    SELECT t.id, t.Codigo, DATE_FORMAT(t.FechaHora, '%Y-%m-%d %H:%i:%s') AS ini, DATE_FORMAT(t.FechaSalida, '%Y-%m-%d %H:%i:%s') AS fin,
           (SELECT DATE_FORMAT(MAX(p.FechaSalida), '%Y-%m-%d %H:%i:%s') FROM Transferencias p
             WHERE p.Codigo = t.Codigo AND p.id <> t.id AND p.FechaSalida <= t.FechaSalida
               AND p.FechaSalida >= DATE(t.FechaSalida)) AS anterior
      FROM Transferencias t WHERE t.FechaSalida < t.FechaHora`);
  if (!invertidas.length) console.log("   ninguna");
  for (const t of invertidas) {
    if (!t.anterior) { console.log(`   ${t.Codigo} #${t.id} (${t.ini} → ${t.fin}): sin una anterior que cuadre, se deja para revisión`); continue; }
    console.log(`   ${t.Codigo} #${t.id} (${t.ini} → ${t.fin}): la entrada pasa a ${t.anterior}, salida de su transferencia anterior`);
    await corregirTransferencia(Number(t.id), { FechaHora: t.anterior });
  }

  console.log("3. Transferencias: una abierta por persona + índice de cobertura");
  const dobles = await q(`SELECT Codigo, COUNT(*) n FROM Transferencias WHERE FechaSalida IS NULL GROUP BY Codigo HAVING COUNT(*) > 1`);
  if (dobles.length) {
    console.log(`   ✗ hay personas con más de una abierta (${dobles.map(d => d.Codigo).join(", ")}): no se agrega la regla`);
  } else if (await columna("Transferencias", "AbiertaCodigo")) {
    console.log("   AbiertaCodigo ya existe");
  } else {
    await ejecutar(`ALTER TABLE Transferencias ADD COLUMN AbiertaCodigo varchar(50) GENERATED ALWAYS AS (IF(FechaSalida IS NULL, Codigo, NULL)) STORED, ADD UNIQUE KEY uq_trans_abierta (AbiertaCodigo)`);
  }
  if (await indice("Transferencias", "idx_trans_codigo_cobertura")) console.log("   idx_trans_codigo_cobertura ya existe");
  else await ejecutar(`ALTER TABLE Transferencias ADD INDEX idx_trans_codigo_cobertura (Codigo, FechaHora, id, FechaSalida, CodigoArea), ALGORITHM=INPLACE, LOCK=NONE`);
  if (!(await indice("Transferencias", "idx_codigo_fechahora"))) console.log("   idx_codigo_fechahora ya no existe");
  else if (modo === "ver" || (await indice("Transferencias", "idx_trans_codigo_cobertura"))) await ejecutar(`ALTER TABLE Transferencias DROP INDEX idx_codigo_fechahora, ALGORITHM=INPLACE, LOCK=NONE`);

  console.log("4. Pallets.Codigo único");
  const repetidos = await q(`SELECT Codigo FROM Pallets WHERE Codigo IS NOT NULL GROUP BY Codigo HAVING COUNT(*) > 1`);
  if (repetidos.length) console.log(`   ✗ códigos repetidos (${repetidos.map(r => r.Codigo).join(", ")}): no se agrega`);
  else if (await indice("Pallets", "uq_pallet_codigo")) console.log("   ya existe");
  else await ejecutar(`ALTER TABLE Pallets ADD UNIQUE KEY uq_pallet_codigo (Codigo), ALGORITHM=INPLACE, LOCK=NONE`);

  console.log("5. MovimientoPiso.MasterId (vacía, con borrado en cascada)");
  if (!(await columna("MovimientoPiso", "MasterId"))) console.log("   ya no existe");
  else {
    const usados = Number((await q(`SELECT COUNT(*) n FROM MovimientoPiso WHERE MasterId IS NOT NULL`))[0].n);
    if (usados) console.log(`   ✗ tiene ${usados} fila(s) con valor: no se quita`);
    else {
      if (await llave("MovimientoPiso", "fk_movpiso_master")) await ejecutar(`ALTER TABLE MovimientoPiso DROP FOREIGN KEY fk_movpiso_master`);
      await ejecutar(`ALTER TABLE MovimientoPiso DROP INDEX idx_movpiso_master, DROP COLUMN MasterId`);
    }
  }

  console.log("6. Comentario en MovimientoPiso.PesadaId");
  await ejecutar(`ALTER TABLE MovimientoPiso MODIFY COLUMN PesadaId int(11) DEFAULT NULL COMMENT '${COMENTARIO_PESADA}'`);
}

async function revertir() {
  console.log("6. Comentario de PesadaId");
  await ejecutar(`ALTER TABLE MovimientoPiso MODIFY COLUMN PesadaId int(11) DEFAULT NULL`);
  console.log("5. MovimientoPiso.MasterId");
  if (await columna("MovimientoPiso", "MasterId")) console.log("   ya existe");
  else {
    await ejecutar(`ALTER TABLE MovimientoPiso ADD COLUMN MasterId int(11) DEFAULT NULL, ADD INDEX idx_movpiso_master (MasterId)`);
    await ejecutar(`ALTER TABLE MovimientoPiso ADD CONSTRAINT fk_movpiso_master FOREIGN KEY (MasterId) REFERENCES Masters (MasterId) ON DELETE CASCADE`);
  }
  console.log("4. Pallets.Codigo");
  if (await indice("Pallets", "uq_pallet_codigo")) await ejecutar(`ALTER TABLE Pallets DROP INDEX uq_pallet_codigo`);
  console.log("3. Transferencias");
  if (!(await indice("Transferencias", "idx_codigo_fechahora"))) await ejecutar(`ALTER TABLE Transferencias ADD INDEX idx_codigo_fechahora (Codigo, FechaHora), ALGORITHM=INPLACE, LOCK=NONE`);
  if (await indice("Transferencias", "idx_trans_codigo_cobertura")) await ejecutar(`ALTER TABLE Transferencias DROP INDEX idx_trans_codigo_cobertura`);
  if (await columna("Transferencias", "AbiertaCodigo")) await ejecutar(`ALTER TABLE Transferencias DROP INDEX uq_trans_abierta, DROP COLUMN AbiertaCodigo`);
  console.log("1-2. Datos corregidos: se reponen desde la bitácora");
  const hechos = await q(`SELECT RegistroId AS id, Antes FROM BitacoraMarcaje WHERE Tabla = 'Transferencias' AND Accion = 'EDITAR' AND Usuario = ? ORDER BY id DESC`, MARCA);
  for (const h of hechos) {
    const a = JSON.parse(h.Antes);
    if (modo === "ver") { console.log(`   (haría) #${h.id} ← ${a.FechaHora} → ${a.FechaSalida ?? "abierta"}`); continue; }
    await prisma.$executeRaw`UPDATE Transferencias SET FechaHora = ${a.FechaHora}, FechaSalida = ${a.FechaSalida ?? null} WHERE id = ${Number(h.id)}`;
    console.log(`   ✓ #${h.id} ← ${a.FechaHora} → ${a.FechaSalida ?? "abierta"}`);
  }
}

console.log(`Modo: ${modo}${modo === "ver" ? " — no cambia nada; usa --aplicar o --revertir" : ""}\n`);
try {
  if (modo === "revertir") await revertir(); else await aplicar();
} catch (e: any) {
  console.error("ERROR:", e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
