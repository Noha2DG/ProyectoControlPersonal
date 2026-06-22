import prisma from "../src/lib/prisma.ts";

// Ver definicion actual de la columna rol
const cols = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM Usuarios WHERE Field = 'rol'");
console.log("Columna actual:", JSON.stringify(cols, null, 2));

await prisma.$disconnect();
