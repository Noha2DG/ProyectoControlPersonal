import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

// Revisión de índices del 27 nov 2026, medida en el servidor contra la base real.
//
//   npx tsx scripts/optimizarIndices20261127.ts             → solo muestra qué haría
//   npx tsx scripts/optimizarIndices20261127.ts --aplicar   → lo hace
//   npx tsx scripts/optimizarIndices20261127.ts --revertir  → deja los índices como estaban
//
// Todo va con ALGORITHM=INPLACE, LOCK=NONE: la tabla se sigue leyendo y escribiendo mientras se
// construye el índice (segundos en tablas de este tamaño).

const NUEVOS = [
  // Ocupación por área de hoy (kiosco de marcaje cada 30 s, pantalla de planificación y cada
  // marcaje de área). Solo había índice por CodigoArea: leía todas las transferencias del área.
  { tabla: "Transferencias", nombre: "idx_trans_area_fechahora", columnas: "CodigoArea, FechaHora" },
  // Barrido de etiquetas vencidas (cada 15 min): de ~69 mil activas, solo las que nunca entraron a
  // bodega (~150) pueden vencer. Antes recorría todas.
  { tabla: "EtiquetaImpresa", nombre: "idx_etiqueta_vencimiento", columnas: "Estatus, PrimerIngresoBodega, CreadoEn" },
];

// Cubiertos por otro índice que empieza con las mismas columnas: no aportan a ninguna búsqueda y
// cuestan en cada escritura. `cubre` es el que queda haciendo su trabajo (y sostiene la llave
// foránea, si la columna tiene una). Movimientos.idx_codigo_fecha lo creaba addPerformanceIndexes.ts
// antes de que existiera el UNIQUE (Codigo, FechaHora, Tipo); no volver a correr ese script.
const REDUNDANTES = [
  { tabla: "Transferencias", nombre: "fk_trans_area", columnas: "CodigoArea", cubre: "idx_trans_area_fechahora" },
  { tabla: "Movimientos", nombre: "idx_codigo", columnas: "Codigo", cubre: "uniq_codigo_fecha_tipo" },
  { tabla: "Movimientos", nombre: "idx_codigo_fecha", columnas: "Codigo, FechaHora", cubre: "uniq_codigo_fecha_tipo" },
  { tabla: "ColaEtiquetaBartender", nombre: "idx_cola_orden", columnas: "OrdenId", cubre: "idx_cola_pendiente" },
  { tabla: "Termos", nombre: "idx_termos_transaccion", columnas: "TransaccionId", cubre: "uq_termos_transaccion_numero" },
  { tabla: "TransaccionesProduccion", nombre: "idx_transprod_lote", columnas: "Lote", cubre: "idx_transprod_lote_clase" },
];

const modo = process.argv.includes("--aplicar") ? "aplicar" : process.argv.includes("--revertir") ? "revertir" : "ver";

async function columnasDe(tabla: string, nombre: string): Promise<string | null> {
  const r: any[] = await prisma.$queryRaw`
    SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ', ') AS cols
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${tabla} AND INDEX_NAME = ${nombre}`;
  return r[0]?.cols ?? null;
}

async function ejecutar(sql: string) {
  if (modo === "ver") { console.log(`   (haría) ${sql}`); return; }
  await prisma.$executeRawUnsafe(sql);
  console.log(`   ✓ ${sql}`);
}

async function main() {
  console.log(`Modo: ${modo}${modo === "ver" ? " — no cambia nada; usa --aplicar o --revertir" : ""}\n`);

  if (modo !== "revertir") {
    for (const i of NUEVOS) {
      const actual = await columnasDe(i.tabla, i.nombre);
      if (actual) { console.log(`${i.tabla}.${i.nombre} ya existe (${actual})`); continue; }
      await ejecutar(`ALTER TABLE ${i.tabla} ADD INDEX ${i.nombre} (${i.columnas}), ALGORITHM=INPLACE, LOCK=NONE`);
    }
    for (const r of REDUNDANTES) {
      const actual = await columnasDe(r.tabla, r.nombre);
      if (!actual) { console.log(`${r.tabla}.${r.nombre} ya no existe`); continue; }
      if (actual !== r.columnas) { console.log(`✗ ${r.tabla}.${r.nombre} es (${actual}), no (${r.columnas}) — no se toca`); continue; }
      // El que lo cubre tiene que existir y empezar por las mismas columnas, si no se queda.
      const cubre = await columnasDe(r.tabla, r.cubre);
      const cubreReal = cubre ?? (modo === "ver" ? NUEVOS.find(n => n.tabla === r.tabla && n.nombre === r.cubre)?.columnas ?? null : null);
      if (!cubreReal || !(cubreReal === r.columnas || cubreReal.startsWith(r.columnas + ", "))) {
        console.log(`✗ ${r.tabla}.${r.nombre}: ${r.cubre} no existe o no lo cubre — no se toca`); continue;
      }
      await ejecutar(`ALTER TABLE ${r.tabla} DROP INDEX ${r.nombre}, ALGORITHM=INPLACE, LOCK=NONE`);
    }
  } else {
    // Primero se reponen los quitados (el de Transferencias sostiene la llave foránea de CodigoArea
    // en cuanto se quite el nuevo) y después se quitan los nuevos.
    for (const r of REDUNDANTES) {
      if (await columnasDe(r.tabla, r.nombre)) { console.log(`${r.tabla}.${r.nombre} ya existe`); continue; }
      await ejecutar(`ALTER TABLE ${r.tabla} ADD INDEX ${r.nombre} (${r.columnas}), ALGORITHM=INPLACE, LOCK=NONE`);
    }
    for (const i of NUEVOS) {
      if (!(await columnasDe(i.tabla, i.nombre))) { console.log(`${i.tabla}.${i.nombre} no existe`); continue; }
      await ejecutar(`ALTER TABLE ${i.tabla} DROP INDEX ${i.nombre}, ALGORITHM=INPLACE, LOCK=NONE`);
    }
  }
  await prisma.$disconnect();
}

main().catch(async e => { console.error("ERROR:", e.message); await prisma.$disconnect(); process.exit(1); });
