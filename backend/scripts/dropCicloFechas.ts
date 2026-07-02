import 'dotenv/config';
import prisma from '../src/lib/prisma.ts';

async function main() {
  // Quitar las columnas de fecha de la tabla Ciclo
  await prisma.$executeRawUnsafe(`ALTER TABLE Ciclo DROP COLUMN FechaInicio`);
  console.log('DROP FechaInicio OK');
  await prisma.$executeRawUnsafe(`ALTER TABLE Ciclo DROP COLUMN FechaCierre`);
  console.log('DROP FechaCierre OK');
  await prisma.$disconnect();
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
