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
