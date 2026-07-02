import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.ts";

const router = Router();
const SECRET = process.env.JWT_SECRET!;

// POST /api/auth/login
router.post("/login", async (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Usuario y contraseña requeridos" });
    return;
  }
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT id, username, password, nombre, rol, activo, permisos
      FROM Usuarios WHERE username = ${username} LIMIT 1
    `;
    const user = rows[0];
    if (!user || !user.activo) {
      res.status(401).json({ error: "Credenciales inválidas" });
      return;
    }
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      res.status(401).json({ error: "Credenciales inválidas" });
      return;
    }
    const permisos = user.permisos ? JSON.parse(user.permisos) : null;
    const payload = { id: user.id, username: user.username, nombre: user.nombre, rol: user.rol, permisos };
    // El kiosco es un dispositivo físico que permanece logueado sin interacción humana;
    // un token de 8h lo deja "Token inválido o expirado" a medio turno.
    const expiresIn = user.rol === "kiosco" ? "30d" : "8h";
    const token = jwt.sign(payload, SECRET, { expiresIn });
    res.json({ token, user: payload });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
