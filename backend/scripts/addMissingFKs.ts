import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

// Movimientos.Codigo y PlanificacionAreas.CodigoArea quedaron sin FK explícita
// (a diferencia de Altas/Bajas/Transferencias/Permisos, que sí referencian Empleados/Areas).
// Se confirmó que no hay filas huérfanas antes de agregar las restricciones.
const FKS = [
  { tabla: "Movimientos", constraint: "fk_movimientos_empleado", sql: "ADD CONSTRAINT fk_movimientos_empleado FOREIGN KEY (Codigo) REFERENCES Empleados(Codigo)" },
  { tabla: "PlanificacionAreas", constraint: "fk_planificacion_area", sql: "ADD CONSTRAINT fk_planificacion_area FOREIGN KEY (CodigoArea) REFERENCES Areas(Codigo)" },
];

async function main() {
  for (const fk of FKS) {
    const existe: any[] = await prisma.$queryRaw`
      SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${fk.tabla} AND CONSTRAINT_NAME = ${fk.constraint}
    `;
    if (existe.length) {
      console.log(`${fk.constraint} ya existe en ${fk.tabla}.`);
      continue;
    }
    await prisma.$executeRawUnsafe(`ALTER TABLE ${fk.tabla} ${fk.sql}`);
    console.log(`${fk.constraint} agregada a ${fk.tabla}.`);
  }
  await prisma.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
