import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

// Elimina la columna NombreCompleto de Empleados.
// Antes de eliminarla, conserva su valor en PrimerNombre para los empleados
// que todavia no tienen desglosado el nombre en los campos nuevos, para no
// perder el nombre visible en el resto de las vistas (que ahora lo calculan
// con CONCAT_WS(PrimerNombre, SegundoNombre, PrimerApellido, SegundoApellido)).

async function main() {
  const existe: any[] = await prisma.$queryRaw`
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Empleados' AND COLUMN_NAME = 'NombreCompleto'
  `;
  if (!existe.length) {
    console.log("La columna NombreCompleto ya no existe.");
    await prisma.$disconnect();
    return;
  }

  const resultado: any = await prisma.$executeRawUnsafe(`
    UPDATE Empleados
    SET PrimerNombre = NombreCompleto
    WHERE (PrimerNombre IS NULL OR PrimerNombre = '')
      AND (SegundoNombre IS NULL OR SegundoNombre = '')
      AND (PrimerApellido IS NULL OR PrimerApellido = '')
      AND (SegundoApellido IS NULL OR SegundoApellido = '')
      AND NombreCompleto IS NOT NULL AND NombreCompleto <> ''
  `);
  console.log(`Nombres conservados en PrimerNombre para ${resultado} empleado(s) sin desglosar.`);

  await prisma.$executeRawUnsafe(`ALTER TABLE Empleados DROP COLUMN NombreCompleto`);
  console.log("Columna NombreCompleto eliminada de Empleados.");

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
