import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";
import {
  CAMPOS_DISENO, TAMANOS_ETIQUETA, TAMANO_DEFECTO, escalarPosicionesDefecto,
  type Posiciones, type TamanoId,
} from "../lib/zpl.ts";

const router = Router();

function getOperador(req: Request): string {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return "Sistema";
    const payload: any = jwt.verify(header.slice(7), process.env.JWT_SECRET!);
    return payload.nombre ?? payload.username ?? "Sistema";
  } catch {
    return "Sistema";
  }
}

function tamanoValido(tamano: any): tamano is TamanoId {
  return typeof tamano === "string" && tamano in TAMANOS_ETIQUETA;
}

export async function obtenerPosiciones(tamano: TamanoId = TAMANO_DEFECTO): Promise<Posiciones> {
  const rows: any[] = await prisma.$queryRaw`SELECT Campo, X, Y, Visible FROM DisenoEtiqueta WHERE Tamano = ${tamano}`;
  const posiciones = { ...escalarPosicionesDefecto(tamano) };
  for (const r of rows) {
    if ((CAMPOS_DISENO as readonly string[]).includes(r.Campo)) {
      (posiciones as any)[r.Campo] = { X: Number(r.X), Y: Number(r.Y), Visible: Number(r.Visible) === 1 };
    }
  }
  return posiciones;
}

// GET /api/diseno-etiqueta/tamanos — catálogo de tamaños de etiqueta disponibles (para el selector)
router.get("/tamanos", requireAuth, requirePerm("etiquetado", "imprimir"), (_req: Request, res: Response) => {
  res.json(Object.entries(TAMANOS_ETIQUETA).map(([id, t]) => ({ id, ...t })));
});

// GET /api/diseno-etiqueta?tamano=4x2
router.get("/", requireAuth, requirePerm("etiquetado", "imprimir"), async (req: Request, res: Response) => {
  try {
    const tamano = tamanoValido(req.query.tamano) ? req.query.tamano : TAMANO_DEFECTO;
    res.json(await obtenerPosiciones(tamano));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/diseno-etiqueta?tamano=4x2  { pedido: {X,Y,Visible}, clienteSubcliente: {X,Y,Visible}, ... } (todos los campos de CAMPOS_DISENO)
router.put("/", requireAuth, requirePerm("etiquetado", "imprimir"), async (req: Request, res: Response) => {
  try {
    const tamano = tamanoValido(req.query.tamano) ? req.query.tamano : TAMANO_DEFECTO;
    const body = req.body;
    for (const campo of CAMPOS_DISENO) {
      const val = body[campo];
      if (!val || !Number.isFinite(Number(val.X)) || !Number.isFinite(Number(val.Y))) {
        res.status(400).json({ error: `Posición inválida o faltante para "${campo}"` });
        return;
      }
    }
    const operador = getOperador(req);
    for (const campo of CAMPOS_DISENO) {
      await prisma.$executeRaw`
        INSERT INTO DisenoEtiqueta (Campo, Tamano, X, Y, Visible, ActualizadoPor)
        VALUES (${campo}, ${tamano}, ${Number(body[campo].X)}, ${Number(body[campo].Y)}, ${body[campo].Visible ? 1 : 0}, ${operador})
        ON DUPLICATE KEY UPDATE X = VALUES(X), Y = VALUES(Y), Visible = VALUES(Visible), ActualizadoPor = VALUES(ActualizadoPor)
      `;
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
