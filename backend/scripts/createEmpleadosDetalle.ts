import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

// Agrega los campos de la pestaña "Personal" directamente a la tabla Empleados
// (en vez de una tabla separada) y migra/elimina EmpleadosDetalle si existía.

const COLUMNS: { name: string; ddl: string }[] = [
  { name: "PrimerNombre", ddl: "VARCHAR(100)" },
  { name: "SegundoNombre", ddl: "VARCHAR(100)" },
  { name: "TercerNombre", ddl: "VARCHAR(100)" },
  { name: "PrimerApellido", ddl: "VARCHAR(100)" },
  { name: "SegundoApellido", ddl: "VARCHAR(100)" },
  { name: "ApellidoCasada", ddl: "VARCHAR(100)" },
  { name: "PaisNacimiento", ddl: "VARCHAR(100)" },
  { name: "FechaNacimiento", ddl: "DATE NULL" },
  { name: "DepartamentoNacimiento", ddl: "VARCHAR(100)" },
  { name: "MunicipioNacimiento", ddl: "VARCHAR(100)" },
  { name: "Etnia", ddl: "VARCHAR(50)" },
  { name: "Nacionalidad", ddl: "VARCHAR(100)" },
  { name: "PaisDPI", ddl: "VARCHAR(100)" },
  { name: "DepartamentoDPI", ddl: "VARCHAR(100)" },
  { name: "MunicipioDPI", ddl: "VARCHAR(100)" },
  { name: "VencimientoDPI", ddl: "DATE NULL" },
  { name: "NIT", ddl: "VARCHAR(20)" },
  { name: "SeguroSocial", ddl: "VARCHAR(20)" },
  { name: "Celular", ddl: "VARCHAR(20)" },
  { name: "Telefono", ddl: "VARCHAR(20)" },
  { name: "PermisoTrabajo", ddl: "VARCHAR(50)" },
  { name: "TituloPersonal", ddl: "VARCHAR(20)" },
  { name: "NumeroHijos", ddl: "INT DEFAULT 0" },
  { name: "NivelAcademico", ddl: "VARCHAR(50)" },
  { name: "TipoSangre", ddl: "VARCHAR(10)" },
  { name: "Beneficiario", ddl: "VARCHAR(150)" },
  { name: "Profesion", ddl: "VARCHAR(100)" },
];

async function main() {
  for (const col of COLUMNS) {
    const exists: any[] = await prisma.$queryRaw`
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Empleados' AND COLUMN_NAME = ${col.name}
    `;
    if (!exists.length) {
      await prisma.$executeRawUnsafe(`ALTER TABLE Empleados ADD COLUMN ${col.name} ${col.ddl}`);
      console.log(`Columna ${col.name} agregada a Empleados.`);
    }
  }

  const detalleExiste: any[] = await prisma.$queryRaw`
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'EmpleadosDetalle'
  `;
  if (detalleExiste.length) {
    const sets = COLUMNS.map(c => `e.${c.name} = d.${c.name}`).join(", ");
    await prisma.$executeRawUnsafe(`
      UPDATE Empleados e
      JOIN EmpleadosDetalle d ON d.Codigo = e.Codigo
      SET ${sets}
    `);
    await prisma.$executeRawUnsafe(`DROP TABLE EmpleadosDetalle`);
    console.log("Datos migrados desde EmpleadosDetalle y tabla eliminada.");
  }

  console.log("Listo.");
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
