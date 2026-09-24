import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.ts";
import { requireAuth, AuthRequest } from "../middleware/auth.ts";

const router = Router();
const SECRET = process.env.JWT_SECRET!;

// Un kiosco es una pantalla fija de planta que nadie atiende: no hay quien vuelva a iniciar sesión
// cuando el token vence, y en planta nadie sabe la contraseña, así que un vencimiento —por largo que
// sea— acaba convirtiéndose en una pantalla muerta hasta que alguien de sistemas vaya a desbloquearla.
// Antes eran 30 días apoyados en la renovación silenciosa cada 12 h de AuthContext, pero eso solo
// aguanta mientras el equipo siga encendido y con red: una PC apagada un mes largo llegaba igual al
// login. Por eso el token de kiosco va SIN `exp`.
//
// El precio, que hay que tener presente: un token de kiosco copiado del navegador sirve para siempre,
// y desactivar la cuenta (`activo = 0`) NO lo invalida, porque eso solo se comprueba al iniciar sesión
// o al renovar — no en cada petición. Para revocar uno de verdad hay que cambiar JWT_SECRET, y eso
// cierra TODAS las sesiones del sistema. Es un intercambio aceptable para cuentas de una sola pantalla
// y permisos de solo ver; pensarlo dos veces antes de darle rol kiosco a una cuenta que escriba.
function firmarToken(payload: object, rol: string) {
  return rol === "kiosco"
    ? jwt.sign(payload, SECRET)
    : jwt.sign(payload, SECRET, { expiresIn: "8h" });
}

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
    const token = firmarToken(payload, user.rol);
    res.json({ token, user: payload });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/refresh — re-emite el token con el rol/permisos actuales de la BD.
// Necesario porque rol/permisos viajan embebidos en el JWT: si un admin edita su propia
// cuenta desde Usuarios, la sesión activa sigue autorizando con los valores viejos hasta
// que se reemite el token (normalmente solo pasaría al volver a iniciar sesión).
router.post("/refresh", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT id, username, nombre, rol, activo, permisos
      FROM Usuarios WHERE id = ${req.user!.id} LIMIT 1
    `;
    const user = rows[0];
    if (!user || !user.activo) {
      res.status(401).json({ error: "Cuenta inactiva o no encontrada" });
      return;
    }
    const permisos = user.permisos ? JSON.parse(user.permisos) : null;
    const payload = { id: user.id, username: user.username, nombre: user.nombre, rol: user.rol, permisos };
    const token = firmarToken(payload, user.rol);
    res.json({ token, user: payload });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
