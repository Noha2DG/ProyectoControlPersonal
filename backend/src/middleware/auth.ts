import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";

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

const REPORT_API_KEY = process.env.REPORT_API_KEY;

// Comparación a tiempo constante — evita que un atacante infiera la clave midiendo cuánto tarda el
// rechazo carácter por carácter. Buffer.from + timingSafeEqual exige igual longitud, así que se
// descarta el caso de longitudes distintas antes (timingSafeEqual lanza en vez de devolver false).
function claveReporteValida(recibida: string): boolean {
  if (!REPORT_API_KEY) return false;
  const a = Buffer.from(recibida);
  const b = Buffer.from(REPORT_API_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Autenticación para consumidores que no pueden sostener una sesión de usuario (Excel/Power Query
// refrescando un reporte por horas o días, sin que nadie vuelva a iniciar sesión): una API key
// estática por header, atada a un "usuario" sintético de solo lectura con EXACTAMENTE los permisos
// que la propia ruta declara — nunca admin, nunca más que lo que ese reporte necesita. Si la key no
// viene o no coincide, cae al login normal por JWT (mismo comportamiento de siempre para el resto).
export function requireAuthOrApiKey(permisos: Permisos) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const apiKey = req.headers["x-report-key"];
    if (typeof apiKey === "string" && claveReporteValida(apiKey)) {
      req.user = { id: 0, username: "reporte-api", nombre: "Reporte API", rol: "readonly", permisos };
      next();
      return;
    }
    requireAuth(req, res, next);
  };
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.rol !== "admin") {
    res.status(403).json({ error: "Se requiere rol administrador" });
    return;
  }
  next();
}

// Misma regla que usan los middlewares de abajo, expuesta como función simple para chequeos
// puntuales DENTRO de un handler (ej. exigir un permiso extra solo en una rama de la ruta) donde
// no se puede cortar con next()/403 genérico a mitad de la lógica.
export function tienePermiso(req: AuthRequest, mod: string, accion: string): boolean {
  if (req.user?.rol === "admin" && !req.user?.permisos) return true;
  const p = (req.user?.permisos as any)?.[mod];
  return Boolean(p?.[accion]);
}

export function requirePerm(mod: string, accion: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (tienePermiso(req, mod, accion)) { next(); return; }
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
