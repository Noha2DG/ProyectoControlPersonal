import prisma from "../src/lib/prisma.ts";
await prisma.$executeRawUnsafe(
  "ALTER TABLE Usuarios MODIFY COLUMN rol VARCHAR(20) NOT NULL DEFAULT 'readonly'"
);
console.log("OK - columna rol cambiada a VARCHAR(20)");
await prisma.$disconnect();
