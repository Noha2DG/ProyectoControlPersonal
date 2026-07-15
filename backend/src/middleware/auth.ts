import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface Permisos {
  empleados?:      { ver?: boolean; crear?: boolean; editar?: boolean; baja?: boolean };
  kiosco?:         { ver?: boolean };
  kiosco_areas?:   { ver?: boolean };
  equipo?:         { ver?: boolean };
  movimientos?:    { ver?: boolean; editar?: boolean; eliminar?: boolean };
  transferencias?: { ver?: boolean; editar?: boolean; eliminar?: boolean };
  areas?:          { ver?: boolean; crear?: boolean; editar?: boolean; eliminar?: boolean };
  usuarios?:       { ver?: boolean; crear?: boolean; editar?: boolean; eliminar?: boolean };
  planificacion?:  { ver?: boolean; editar?: boolean };
  tipos_permiso?:  { ver?: boolean; crear?: boolean; editar?: boolean; eliminar?: boolean };
  permisos?:       { ver?: boolean; crear?: boolean; editar?: boolean; eliminar?: boolean };
  catalogos?:      { ver?: boolean; crear?: boolean; editar?: boolean; eliminar?: boolean };
  destajo?:        { ver?: boolean; crear?: boolean; editar?: boolean; eliminar?: boolean };
  etiquetado?:     { ver?: boolean; crear?: boolean; editar?: boolean; eliminar?: boolean; imprimir?: boolean };
  bodega?:         { ver?: boolean; escanear?: boolean; editar?: boolean; eliminar?: boolean };
}

export interface AuthPayload {
  id: number;
  username: string;
  nombre: string;
  rol: "admin" | "rrhh" | "readonly" | "kiosco";
  permisos?: Permisos | null;
}

export interface AuthRequest extends Request {
  user?: AuthPayload;
}

const SECRET = process.env.JWT_SECRET!;

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  try {
    req.user = jwt.verify(header.slice(7), SECRET) as AuthPayload;
    next();
  } catch {
    res.status(401).json({ error: "Token inválido o expirado" });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.rol !== "admin") {
    res.status(403).json({ error: "Se requiere rol administrador" });
    return;
  }
  next();
}

export function requirePerm(mod: string, accion: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    // Admin sin permisos configurados = acceso total (usuario legacy / inicial)
    if (req.user?.rol === "admin" && !req.user?.permisos) { next(); return; }
    // Si tiene permisos explícitos, siempre verificar (sin importar el rol)
    const p = (req.user?.permisos as any)?.[mod];
    if (p?.[accion]) { next(); return; }
    res.status(403).json({ error: "Sin permiso para esta acción" });
  };
}

// Igual que requirePerm, pero basta con cumplir cualquiera de los pares [modulo, accion] dados.
// Se usa en lecturas compartidas entre módulos (ej. Lotes/Pedidos los consulta tanto Destajo/Catálogos
// como Etiquetado) donde exigir un solo módulo obligaría a dar de más permisos de otro módulo.
export function requireAnyPerm(checks: [string, string][]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.user?.rol === "admin" && !req.user?.permisos) { next(); return; }
    const permisos = req.user?.permisos as any;
    const ok = checks.some(([mod, accion]) => permisos?.[mod]?.[accion]);
    if (ok) { next(); return; }
    res.status(403).json({ error: "Sin permiso para esta acción" });
  };
}
