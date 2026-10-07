// Carga inicial de personas a mesas de pelado desde Downloads/MESAS.xlsx (versión del 6 oct 2026).
//
// Va escrita aquí en vez de leer el Excel porque el backend no tiene librería de Excel, y porque así
// queda en el repo exactamente qué se cargó. Criterio acordado con el usuario:
//   - MESA 1–8 del Excel → MESA01–MESA08 (Puesto LIDER = líder de la mesa).
//   - Puesto APRENDIZAJE (estaban dentro de las mesas 1–4) → APRENDIZAJE 1–4 (APR01–APR04) según el
//     número de su mesa de origen. Las mesas de aprendizaje quedan sin líder por ahora.
//   - BANDA, EMPINCHADO y RENUNCIA no se cargan: Banda es "sin mesa definida" (cae sola quien pesa
//     sin asignación) y Empinchado está pendiente de aclarar.
//   - DON0003 (marcada renuncia, pesó el 6 oct) y TZO0001 (no venía en el Excel) quedan fuera: el 6 de
//     octubre fue su último día y RRHH registra la baja.
//
// Uso:
//   npx tsx backend/scripts/cargarMesasIniciales.ts            → solo muestra lo que haría
//   npx tsx backend/scripts/cargarMesasIniciales.ts --aplicar  → escribe (todo o nada)

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { asignarMesa } from "../src/lib/mesaAsignacion.ts";

const prisma = new PrismaClient();

// Se cargó el 6 oct 2026 con fecha 2026-10-06 y el 7 oct se adelantó al 2026-09-29 (decisión del
// usuario: las integrantes eran las mismas esa semana, y así la gráfica de 5 días sale completa).
const FECHA = "2026-09-29";
const MOTIVO = "Carga inicial MESAS.xlsx";

// [Codigo, Mesa, EsLider]
const CARGA: [string, string, 0 | 1][] = [
  ["MOR0009", "MESA01", 1], ["FUE0001", "MESA01", 0], ["POC0001", "MESA01", 0], ["SIP0001", "MESA01", 0],
  ["SUM0004", "MESA01", 0], ["SUM0006", "MESA01", 0],
  ["MOR0003", "MESA02", 1], ["QUE0004", "MESA02", 0], ["REY0001", "MESA02", 0], ["SAZ0001", "MESA02", 0],
  ["VAS0005", "MESA02", 0], ["VEL0008", "MESA02", 0],
  ["VEL0005", "MESA03", 1], ["CAN0001", "MESA03", 0], ["COJ0001", "MESA03", 0], ["JER0001", "MESA03", 0],
  ["SAL0005", "MESA03", 0], ["VAL0006", "MESA03", 0],
  ["LEM0003", "MESA04", 1], ["CHA0001", "MESA04", 0], ["CHI0003", "MESA04", 0], ["EST0009", "MESA04", 0],
  ["HER0007", "MESA04", 0], ["RAM0030", "MESA04", 0],
  ["LEM0004", "MESA05", 1], ["ARD0002", "MESA05", 0], ["CAL0004", "MESA05", 0], ["GAR0035", "MESA05", 0],
  ["GOM0002", "MESA05", 0], ["JUA0005", "MESA05", 0], ["PER0002", "MESA05", 0],
  ["GAR0007", "MESA06", 1], ["AGU0010", "MESA06", 0], ["AGU0011", "MESA06", 0], ["AVA0002", "MESA06", 0],
  ["GAR0005", "MESA06", 0], ["MON0001", "MESA06", 0],
  ["CHU0001", "MESA07", 1], ["AVI0001", "MESA07", 0], ["BAR0012", "MESA07", 0], ["EST0001", "MESA07", 0],
  ["GOM0016", "MESA07", 0], ["LOP0089", "MESA07", 0],
  ["LOP0064", "MESA08", 1], ["MON0005", "MESA08", 0], ["MOR0026", "MESA08", 0], ["PER0004", "MESA08", 0],
  ["REN0001", "MESA08", 0],
  ["GOM0005", "APR01", 0],
  ["ALO0003", "APR02", 0], ["DIA0013", "APR02", 0], ["DUA0005", "APR02", 0], ["GAR0017", "APR02", 0], ["ROD0025", "APR02", 0],
  ["OLI0002", "APR03", 0], ["PAX0001", "APR03", 0], ["ROD0018", "APR03", 0],
  ["CAN0002", "APR04", 0], ["CAN0005", "APR04", 0], ["EST0006", "APR04", 0], ["HER0031", "APR04", 0], ["LOP0090", "APR04", 0],
];

async function main() {
  const aplicar = process.argv.includes("--aplicar");

  const repetidos = CARGA.map(c => c[0]).filter((c, i, a) => a.indexOf(c) !== i);
  if (repetidos.length) throw new Error(`Códigos repetidos en la lista: ${repetidos.join(", ")}`);

  const ya: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM MesaAsignacion WHERE Motivo = ?`, MOTIVO);
  if (Number(ya[0].n) > 0) throw new Error(`La carga inicial ya se aplicó (${Number(ya[0].n)} filas con motivo "${MOTIVO}")`);

  const codigos = CARGA.map(c => c[0]);
  const emp: any[] = await prisma.$queryRawUnsafe(
    `SELECT Codigo, Estado, CONCAT_WS(' ', PrimerNombre, PrimerApellido) AS Nombre FROM Empleados WHERE Codigo IN (${codigos.map(() => "?").join(",")})`,
    ...codigos);
  const porCodigo = new Map(emp.map(e => [e.Codigo, e]));
  const problemas = codigos.filter(c => porCodigo.get(c)?.Estado !== "Activo");
  if (problemas.length) throw new Error(`No existen o no están activos: ${problemas.join(", ")}`);

  const porMesa = new Map<string, string[]>();
  for (const [codigo, mesa, lider] of CARGA) {
    porMesa.set(mesa, [...(porMesa.get(mesa) ?? []), `${codigo} ${porCodigo.get(codigo).Nombre}${lider ? " ★" : ""}`]);
  }
  console.log(`${aplicar ? "Cargando" : "Vista previa (sin escribir)"} — ${CARGA.length} personas desde ${FECHA}:`);
  for (const [mesa, personas] of porMesa) console.log(`  ${mesa.padEnd(7)} (${personas.length}) ${personas.join(", ")}`);

  if (!aplicar) { console.log("\nPara escribir: agrega --aplicar"); return; }

  await prisma.$transaction(async tx => {
    for (const [codigo, mesa, lider] of CARGA) {
      await asignarMesa(tx, { codigo, mesa, esLider: lider === 1, fecha: FECHA, motivo: MOTIVO, usuario: "Carga inicial" });
    }
  }, { timeout: 60000 });

  const r: any[] = await prisma.$queryRawUnsafe(`
    SELECT MesaCodigo, COUNT(*) AS n, SUM(EsLider) AS lideres FROM MesaAsignacion WHERE FechaFin IS NULL GROUP BY MesaCodigo ORDER BY MesaCodigo`);
  console.log("\nVigentes por mesa:");
  for (const x of r) console.log(`  ${x.MesaCodigo.padEnd(7)} ${Number(x.n)} personas, ${Number(x.lideres)} líder`);
}

main()
  .catch(err => { console.error(err.message ?? err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
