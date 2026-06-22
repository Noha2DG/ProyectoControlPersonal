import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm, AuthRequest } from "../middleware/auth.ts";

const router = Router();

router.use(requireAuth);

function mapUsuario(r: any) {
  return {
    id:         Number(r.id),
    username:   r.username,
    nombre:     r.nombre,
    rol:        r.rol,
    activo:     Number(r.activo),
    permisos:   r.permisos ? JSON.parse(r.permisos) : null,
    created_at: r.created_at,
  };
}

// GET /api/usuarios
router.get("/", requirePerm("usuarios", "ver"), async (_req: Request, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT id, username, nombre, rol, activo, permisos, created_at
      FROM Usuarios ORDER BY nombre ASC
    `;
    res.json(rows.map(mapUsuario));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/usuarios
router.post("/", requirePerm("usuarios", "crear"), async (req: Request, res: Response) => {
  const { username, password, nombre, rol, permisos } = req.body;
  if (!username || !password || !nombre || !rol) {
    res.status(400).json({ error: "Todos los campos son requeridos" });
    return;
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const permisosJson = permisos ? JSON.stringify(permisos) : null;
    await prisma.$executeRaw`
      INSERT INTO Usuarios (username, password, nombre, rol, permisos)
      VALUES (${username}, ${hash}, ${nombre}, ${rol}, ${permisosJson})
    `;
    const rows: any[] = await prisma.$queryRaw`
      SELECT id, username, nombre, rol, activo, permisos, created_at
      FROM Usuarios WHERE username = ${username}
    `;
    res.status(201).json(mapUsuario(rows[0]));
  } catch (err: any) {
    if (err.message?.includes("Duplicate")) {
      res.status(400).json({ error: "El nombre de usuario ya existe" });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// PUT /api/usuarios/:id
router.put("/:id", requirePerm("usuarios", "editar"), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { nombre, rol, activo, password, permisos } = req.body;
  const activoVal = activo ? 1 : 0;
  const permisosJson: string | null = permisos != null ? JSON.stringify(permisos) : null;
  try {
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await prisma.$executeRaw`
        UPDATE Usuarios
        SET nombre=${nombre}, rol=${rol}, activo=${activoVal}, password=${hash}, permisos=${permisosJson}
        WHERE id=${id}
      `;
    } else {
      await prisma.$executeRaw`
        UPDATE Usuarios
        SET nombre=${nombre}, rol=${rol}, activo=${activoVal}, permisos=${permisosJson}
        WHERE id=${id}
      `;
    }
    const rows: any[] = await prisma.$queryRaw`
      SELECT id, username, nombre, rol, activo, permisos, created_at FROM Usuarios WHERE id=${id}
    `;
    res.json(mapUsuario(rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/usuarios/:id
router.delete("/:id", requirePerm("usuarios", "eliminar"), async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (req.user?.id === id) {
    res.status(400).json({ error: "No puedes eliminar tu propio usuario" });
    return;
  }
  try {
    await prisma.$executeRaw`DELETE FROM Usuarios WHERE id=${id}`;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
