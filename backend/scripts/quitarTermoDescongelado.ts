// Descongelado ya no lleva termos ni canastas (usuario, 27 oct 2026). Quita de la base lo que dejó
// la prueba de termos:
//
//   1. Borra el número de termo y el enlace al termo de los 14 renglones de prueba (hojas 120, 129,
//      131 y 132). Solo esos, por su MovimientoId: el peso no se toca, porque en todos lo pesado ya
//      era igual a lo declarado.
//   2. Quita la columna MovimientoPiso.TermoOrigenId (con su llave fk_movpiso_termo): era lo único
//      del termo de Descongelado que tenía la base, y main nunca la usó.
//
// NumeroTermo se queda: lo usan Tratamiento y la cola de Descabezado. La tabla Termos también: es la
// del pesaje de Destajo, no la de Descongelado.
//
// Antes de escribir guarda en Documents/respaldos lo que borra, para poder deshacerlo.
//
//   npx tsx scripts/quitarTermoDescongelado.ts             → ensayo, no escribe
//   npx tsx scripts/quitarTermoDescongelado.ts --aplicar   → respalda, limpia y quita la columna
//   npx tsx scripts/quitarTermoDescongelado.ts --deshacer  → vuelve a crear la columna y restaura el respaldo
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prisma from "../src/lib/prisma.ts";

const aplicar = process.argv.includes("--aplicar");
const deshacer = process.argv.includes("--deshacer");
const IDS = [3703, 3890, 3984, 4045, 4046, 4092, 4093, 4094, 4095, 4100, 4101, 4103, 4106, 4108];
const RESPALDO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../respaldos/termos_descongelado_20261027.json");
const json = (x: any) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2);

async function existe(sql: string, ...args: any[]) {
  const [r]: any[] = await prisma.$queryRawUnsafe(sql, ...args);
  return Number(r.n) > 0;
}
const hayColumna = () => existe(`SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'MovimientoPiso' AND COLUMN_NAME = 'TermoOrigenId'`);
const hayFK = () => existe(`SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'MovimientoPiso' AND CONSTRAINT_NAME = 'fk_movpiso_termo'`);

async function main() {
  const columna = await hayColumna();
  console.log(`Columna TermoOrigenId: ${columna ? "existe" : "no existe"} · FK fk_movpiso_termo: ${await hayFK() ? "sí" : "no"}`);

  if (deshacer) {
    if (!fs.existsSync(RESPALDO)) throw new Error(`No está el respaldo ${RESPALDO}`);
    const filas: any[] = JSON.parse(fs.readFileSync(RESPALDO, "utf8"));
    if (!columna) await prisma.$executeRawUnsafe(`ALTER TABLE MovimientoPiso ADD COLUMN TermoOrigenId INT NULL`);
    if (!(await hayFK())) {
      await prisma.$executeRawUnsafe(`ALTER TABLE MovimientoPiso ADD CONSTRAINT fk_movpiso_termo
        FOREIGN KEY (TermoOrigenId) REFERENCES MovimientoPiso(MovimientoId)`);
    }
    // Un renglón que ya se quitó de la hoja se salta, y un enlace a uno quitado queda vacío.
    const vivos: any[] = await prisma.$queryRawUnsafe(
      `SELECT MovimientoId FROM MovimientoPiso WHERE MovimientoId IN (${filas.map(f => Number(f.MovimientoId)).join(",")})`);
    const existen = new Set(vivos.map(r => Number(r.MovimientoId)));
    let n = 0;
    for (const f of filas) {
      if (!existen.has(f.MovimientoId)) continue;
      const enlace = f.TermoOrigenId != null && existen.has(f.TermoOrigenId) ? f.TermoOrigenId : null;
      n += await prisma.$executeRawUnsafe(
        `UPDATE MovimientoPiso SET NumeroTermo = ?, TermoOrigenId = ? WHERE MovimientoId = ?`, f.NumeroTermo, enlace, f.MovimientoId);
    }
    console.log(`Columna creada y ${n} de ${filas.length} renglones restaurados (los que ya no existen se saltan).`);
    return;
  }

  // Lo que dice la base hoy: todo renglón de Descongelado con termo, y cualquier enlace fuera de él.
  const conTermo: any[] = await prisma.$queryRawUnsafe(`
    SELECT m.MovimientoId, m.HojaOrigenId, m.Tipo, m.NumeroTermo, ${columna ? "m.TermoOrigenId" : "NULL AS TermoOrigenId"},
           m.Lote, m.Clase, m.PesoKg, m.BodegaDestino
      FROM MovimientoPiso m JOIN HojaProceso h ON h.HojaId = m.HojaOrigenId AND h.BodegaCodigo = 'DESCONGELADO'
     WHERE m.NumeroTermo IS NOT NULL ${columna ? "OR m.TermoOrigenId IS NOT NULL" : ""}
     ORDER BY m.MovimientoId`);
  const encontrados = conTermo.map(r => Number(r.MovimientoId));
  const nuevos = encontrados.filter(id => !IDS.includes(id));
  const faltan = IDS.filter(id => !encontrados.includes(id));
  for (const r of conTermo) console.log(`  #${r.MovimientoId} hoja ${r.HojaOrigenId} ${r.Tipo} termo=${r.NumeroTermo} enlace=${r.TermoOrigenId} ${r.Lote} ${r.Clase} ${r.PesoKg} kg → ${r.BodegaDestino}`);
  console.log(`${encontrados.length} renglones de Descongelado con termo; de la lista: ${IDS.length - faltan.length} de ${IDS.length}.`);
  if (nuevos.length) throw new Error(`Hay renglones con termo que no están en la lista (${nuevos.join(", ")}): revísalos antes de seguir`);
  if (columna) {
    const [fuera]: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) AS n FROM MovimientoPiso m
       WHERE m.TermoOrigenId IS NOT NULL AND m.MovimientoId NOT IN (${IDS.join(",")})`);
    if (Number(fuera.n) > 0) throw new Error(`${fuera.n} renglones fuera de la lista usan TermoOrigenId: no se quita la columna`);
  }
  if (!aplicar) { console.log("Ensayo: no se escribió nada. Corre con --aplicar para hacerlo."); return; }

  if (conTermo.length) {
    if (fs.existsSync(RESPALDO)) throw new Error(`Ya existe ${RESPALDO}: no se sobreescribe. Muévelo si de verdad hay que volver a respaldar.`);
    fs.mkdirSync(path.dirname(RESPALDO), { recursive: true });
    fs.writeFileSync(RESPALDO, json(conTermo.map(r => ({
      MovimientoId: Number(r.MovimientoId), HojaOrigenId: Number(r.HojaOrigenId), NumeroTermo: r.NumeroTermo,
      TermoOrigenId: r.TermoOrigenId == null ? null : Number(r.TermoOrigenId),
    }))));
    console.log(`Respaldo: ${RESPALDO}`);
    await prisma.$transaction(async (tx) => {
      const n = await tx.$executeRawUnsafe(
        `UPDATE MovimientoPiso SET NumeroTermo = NULL${columna ? ", TermoOrigenId = NULL" : ""}
          WHERE MovimientoId IN (${encontrados.join(",")}) AND Tipo = 'TRASLADO'`);
      if (n !== encontrados.length) throw new Error(`Se iban a limpiar ${encontrados.length} renglones y fueron ${n}: no se guardó nada`);
    });
    console.log(`${encontrados.length} renglones sin termo.`);
  }
  if (await hayFK()) await prisma.$executeRawUnsafe(`ALTER TABLE MovimientoPiso DROP FOREIGN KEY fk_movpiso_termo`);
  if (await hayColumna()) await prisma.$executeRawUnsafe(`ALTER TABLE MovimientoPiso DROP COLUMN TermoOrigenId`);
  console.log(`Columna TermoOrigenId: ${await hayColumna() ? "SIGUE" : "quitada"} · FK: ${await hayFK() ? "SIGUE" : "quitada"}.`);
}

main()
  .catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
