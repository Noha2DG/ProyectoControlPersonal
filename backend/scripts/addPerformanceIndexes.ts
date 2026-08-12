import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

// Índices identificados en la auditoría de rendimiento: columnas usadas en WHERE/JOIN
// frecuentes en tablas de alto volumen (escaneos de entrada/salida, transferencias de área,
// entrega de uniformes, permisos) que no quedaban cubiertas por la PK/UNIQUE/FK existente.
const INDICES = [
  { tabla: "Movimientos",        nombre: "idx_codigo_fecha",  columnas: "(Codigo, FechaHora)" },
  { tabla: "Transferencias",     nombre: "idx_fechahora",      columnas: "(FechaHora)" },
  { tabla: "EntregaEquipo",      nombre: "idx_fecha",          columnas: "(Fecha)" },
  { tabla: "Permisos",           nombre: "idx_codigo_fecha",   columnas: "(CodigoEmpleado, Fecha)" },

  // Ago 2026, segunda ronda: el reporte de producción tardaba ~8 s. Resolver "¿en qué área estaba
  // esta persona cuando hizo esta pesada?" es una búsqueda por (Codigo, FechaHora DESC) una vez por
  // pesaje, y solo había índices sueltos de Codigo y de FechaHora — con el de Codigo solo, cada
  // lookup leía y ordenaba las ~95 transferencias de esa persona. El compuesto lo vuelve un salto
  // directo al último registro anterior a esa hora.
  { tabla: "Transferencias",     nombre: "idx_codigo_fechahora", columnas: "(Codigo, FechaHora)" },
  // PesajeDetalle no tenía ningún índice por fecha: todo filtro por día o por rango (reporte,
  // ranking de pared, kiosco) escaneaba la tabla completa. Va a seguir creciendo todos los días.
  { tabla: "PesajeDetalle",      nombre: "idx_pesaje_fecha",     columnas: "(FechaHora)" },
];

async function main() {
  for (const idx of INDICES) {
    const existe: any[] = await prisma.$queryRaw`
      SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${idx.tabla} AND INDEX_NAME = ${idx.nombre}
    `;
    if (existe.length) {
      console.log(`${idx.tabla}.${idx.nombre} ya existe.`);
      continue;
    }
    await prisma.$executeRawUnsafe(`CREATE INDEX ${idx.nombre} ON ${idx.tabla} ${idx.columnas}`);
    console.log(`${idx.tabla}.${idx.nombre} ${idx.columnas} creado.`);
  }
  await prisma.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
