import prisma from "../src/lib/prisma.ts";
await prisma.$executeRawUnsafe("ALTER TABLE Usuarios ADD COLUMN IF NOT EXISTS permisos TEXT NULL");
console.log("OK - columna permisos agregada");
await prisma.$disconnect();
