import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const usuarios = [
  { username: "admin",  password: "Admin2026!",  nombre: "Administrador",  rol: "admin" },
  { username: "rrhh",   password: "Rrhh2026!",   nombre: "Usuario RRHH",   rol: "rrhh"  },
];

async function main() {
  for (const u of usuarios) {
    const hash = await bcrypt.hash(u.password, 10);
    await prisma.$executeRawUnsafe(
      `INSERT INTO Usuarios (username, password, nombre, rol)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE password = VALUES(password), nombre = VALUES(nombre)`,
      u.username, hash, u.nombre, u.rol
    );
    console.log(`Usuario '${u.username}' (${u.rol}) creado/actualizado.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error("ERROR:", e.message); process.exit(1); });
