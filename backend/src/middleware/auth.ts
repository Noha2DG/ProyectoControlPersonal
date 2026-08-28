import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface Permisos {
  empleados?:      { ver?: boolean; crear?: boolean; editar?: boolean; baja?: boolean };
  kiosco?:         { ver?: boolean };
  kiosco_areas?:   { ver?: boolean };
  kiosco_destajo?: { ver?: boolean };
  kiosco_ranking?: { ver?: boolean };
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
  // `trasladar` va aparte de `editar` porque mueve cajas de un polin SELLADO (cerrado y ya ubicado
  // en el rack) a otro sin des-ubicarlo. `editar` es la operacion diaria —armar y corregir polines
  // abiertos— y la tiene toda la cuadrilla; romper el sello de uno posicionado es de unos pocos.
  bodega?:         { ver?: boolean; escanear?: boolean; editar?: boolean; trasladar?: boolean; eliminar?: boolean };
  // `anular` va aparte de `editar` y de `eliminar` a propósito: anular una remisión confirmada
  // devuelve al inventario producto que YA SALIÓ físicamente de la planta. Es la válvula de escape
  // del módulo (mismo criterio con que `bodega.editar` gobierna desubicar/desarmar, y no `escanear`).
  // `eliminar` solo borra borradores, que nunca tocaron inventario — compartirlos daría el poder de
  // revertir embarques a quien solo necesita limpiar sus propios borradores.
  remisiones?:     { ver?: boolean; crear?: boolean; editar?: boolean; eliminar?: boolean; imprimir?: boolean; anular?: boolean };
  // Pedidos, Clientes y Subcliente salieron de `catalogos` para vivir acá. El motivo no es de menú:
  // quien captura proformas necesita corregirlas a diario, y con `catalogos` eso le entregaba además
  // Presentaciones — donde vive CajasXMaster, el número que convierte cajas a master y define el
  // objetivo de TODOS los pedidos. Editarlo movía la meta de pedidos pasados y futuros sin que nadie
  // se enterara. `catalogos` queda para lo que casi nadie toca.
  pedidos?:        { ver?: boolean; crear?: boolean; editar?: boolean; eliminar?: boolean };
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
