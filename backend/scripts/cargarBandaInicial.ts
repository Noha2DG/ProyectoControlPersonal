// Carga del personal fijo de BANDA desde Downloads/MESAS.xlsx (las 41 marcadas "BANDA").
//
// En la carga inicial (cargarMesasIniciales.ts) no se cargaron porque entonces BANDA era "sin mesa".
// El 7 oct 2026 BANDA pasó a ser una mesa con personal fijo, así que se asignan con la misma fecha
// que el resto (2026-09-29). Se saltan quienes ya no están activos o ya tienen mesa vigente.
//
// Uso:
//   npx tsx backend/scripts/cargarBandaInicial.ts            → solo muestra lo que haría
//   npx tsx backend/scripts/cargarBandaInicial.ts --aplicar  → escribe (todo o nada)

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { asignarMesa } from "../src/lib/mesaAsignacion.ts";

const prisma = new PrismaClient();

const FECHA = "2026-09-29";
const MOTIVO = "Carga inicial MESAS.xlsx (Banda)";
const CODIGOS = [
  "AVI0003", "BOR0003", "CAA0001", "CAN0006", "CAN0007", "CON0008", "CRU0001", "CRU0002", "CUX0001", "CUX0003",
  "DEL0009", "DEL0010", "DIA0008", "EST0008", "GAL0001", "GAR0023", "GOM0019", "GON0012", "JUA0008", "LIM0004",
  "LOP0078", "LOP0085", "LOP0087", "MOL0003", "MON0004", "MOR0012", "PED0001", "PER0007", "RAM0009", "RIV0005",
  "ROD0013", "ROD0016", "SAM0004", "SAN0003", "SAN0029", "SAS0001", "TEL0001", "TOC0001", "VEL0012", "VEL0015",
  "YOZ0001",
];

async function main() {
  const aplicar = process.argv.includes("--aplicar");
  const ph = CODIGOS.map(() => "?").join(",");
  const emp: any[] = await prisma.$queryRawUnsafe(`
    SELECT e.Codigo, e.Estado, CONCAT_WS(' ', e.PrimerNombre, e.PrimerApellido) AS Nombre,
           (SELECT COUNT(*) FROM MesaAsignacion ma WHERE ma.Codigo = e.Codigo) AS Filas
    FROM Empleados e WHERE e.Codigo IN (${ph})`, ...CODIGOS);
  const porCodigo = new Map(emp.map(e => [e.Codigo, e]));
  const cargar = CODIGOS.filter(c => porCodigo.get(c)?.Estado === "Activo" && Number(porCodigo.get(c).Filas) === 0);
  const saltados = CODIGOS.filter(c => !cargar.includes(c)).map(c => {
    const e = porCodigo.get(c);
    return `${c} (${!e ? "no existe" : e.Estado !== "Activo" ? e.Estado : "ya tiene mesa/historial"})`;
  });
  console.log(`${aplicar ? "Cargando" : "Vista previa"}: ${cargar.length} a BANDA desde ${FECHA}`);
  console.log(`  ${cargar.map(c => `${c} ${porCodigo.get(c).Nombre}`).join(", ")}`);
  if (saltados.length) console.log(`Se saltan ${saltados.length}: ${saltados.join(", ")}`);
  if (!aplicar) { console.log("\nPara escribir: agrega --aplicar"); return; }

  await prisma.$transaction(async tx => {
    for (const codigo of cargar) await asignarMesa(tx, { codigo, mesa: "BANDA", esLider: false, fecha: FECHA, motivo: MOTIVO, usuario: "Carga inicial" });
  }, { maxWait: 10_000, timeout: 120_000 });
  const r: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) n FROM MesaAsignacion WHERE MesaCodigo = 'BANDA' AND FechaFin IS NULL`);
  console.log(`BANDA queda con ${Number(r[0].n)} personas vigentes`);
}

main()
  .catch(err => { console.error(err.message ?? err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
