import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";

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

// Cada permiso es un rango [Fecha, FechaFin] (ver alterPermisoRango.ts), así que los filtros por
// fecha preguntan por TRASLAPE y no por igualdad: unas vacaciones del 20 al 30 tienen que salir al
// consultar el 25, aunque no empiecen ni terminen ese día. Con el filtro anterior (Fecha >= X) un
// permiso en curso desaparecía justo los días que estaba vigente, que es cuando hace falta verlo.
const SELECT_PERMISO = `
  SELECT p.id, p.CodigoEmpleado,
         CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido) AS NombreCompleto,
         e.CodigoEtalent, p.codigoPermiso, tp.descripcion,
         DATE_FORMAT(p.Fecha, '%Y-%m-%d') AS Fecha,
         DATE_FORMAT(p.FechaFin, '%Y-%m-%d') AS FechaFin,
         p.Observacion, p.RegistradoPor
  FROM Permisos p
  JOIN Empleados e ON p.CodigoEmpleado = e.Codigo
  JOIN TipoPermiso tp ON p.codigoPermiso = tp.codigoPermiso
`;

const ORDEN_NOMBRE = `ORDER BY CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido) ASC`;

// GET /api/permisos?fecha=YYYY-MM-DD[&hasta=YYYY-MM-DD] → vigentes en esa fecha o después;
//   con "hasta" quedan acotados a los que se traslapan con el rango [fecha, hasta]
// GET /api/permisos?codigo=CODIGO&desde=YYYY-MM-DD → permisos de un empleado vigentes desde esa fecha
router.get("/", requireAuth, requirePerm("permisos", "ver"), async (req: Request, res: Response) => {
  try {
    const fecha  = req.query.fecha  as string | undefined;
    const hasta  = req.query.hasta  as string | undefined;
    const codigo = req.query.codigo as string | undefined;
    const desde  = req.query.desde  as string | undefined;

    let rows: any[];
    if (codigo && desde) {
      rows = await prisma.$queryRawUnsafe(
        `${SELECT_PERMISO} WHERE p.CodigoEmpleado = ? AND p.FechaFin >= ? ORDER BY p.Fecha ASC`,
        codigo, desde
      );
    } else if (fecha && hasta) {
      rows = await prisma.$queryRawUnsafe(
        `${SELECT_PERMISO} WHERE p.Fecha <= ? AND p.FechaFin >= ? ${ORDEN_NOMBRE}`,
        hasta, fecha
      );
    } else if (fecha) {
      rows = await prisma.$queryRawUnsafe(`${SELECT_PERMISO} WHERE p.FechaFin >= ? ${ORDEN_NOMBRE}`, fecha);
    } else {
      rows = await prisma.$queryRawUnsafe(`${SELECT_PERMISO} ${ORDEN_NOMBRE} LIMIT 200`);
    }
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// FechaFin es opcional en el cuerpo: un permiso de un día se sigue creando mandando solo Fecha, y el
// rango queda [Fecha, Fecha]. Se valida aquí además del CHECK de la base para poder devolver un 400
// con un mensaje que explique qué pasó, en vez del error crudo de la restricción.
function resolverRango(Fecha: any, FechaFin: any): { fin: string } | { error: string } {
  const fin = FechaFin || Fecha;
  if (fin < Fecha) return { error: "La fecha de fin no puede ser anterior a la de inicio" };
  return { fin };
}

// POST /api/permisos  { CodigoEmpleado, codigoPermiso, Fecha, FechaFin?, Observacion }
router.post("/", requireAuth, requirePerm("permisos", "crear"), async (req: Request, res: Response) => {
  try {
    const { CodigoEmpleado, codigoPermiso, Fecha, FechaFin, Observacion } = req.body;
    if (!CodigoEmpleado || !codigoPermiso || !Fecha) {
      res.status(400).json({ error: "Empleado, tipo de permiso y fecha son requeridos" }); return;
    }

    const rango = resolverRango(Fecha, FechaFin);
    if ("error" in rango) { res.status(400).json({ error: rango.error }); return; }

    const empleados: any[] = await prisma.$queryRaw`
      SELECT Codigo FROM Empleados WHERE Codigo = ${CodigoEmpleado} LIMIT 1
    `;
    if (!empleados.length) { res.status(404).json({ error: "Empleado no encontrado" }); return; }

    const tipos: any[] = await prisma.$queryRaw`
      SELECT codigoPermiso FROM TipoPermiso WHERE codigoPermiso = ${codigoPermiso} AND Activo = 1 LIMIT 1
    `;
    if (!tipos.length) { res.status(404).json({ error: "Tipo de permiso no encontrado o inactivo" }); return; }

    const operador = getOperador(req);
    await prisma.$executeRaw`
      INSERT INTO Permisos (CodigoEmpleado, codigoPermiso, Fecha, FechaFin, Observacion, RegistradoPor)
      VALUES (${CodigoEmpleado}, ${codigoPermiso}, ${Fecha}, ${rango.fin}, ${Observacion || null}, ${operador})
    `;
    res.status(201).json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/permisos/:id  { codigoPermiso, Fecha, FechaFin?, Observacion }
router.put("/:id", requireAuth, requirePerm("permisos", "editar"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { codigoPermiso, Fecha, FechaFin, Observacion } = req.body;
    if (!codigoPermiso || !Fecha) {
      res.status(400).json({ error: "Tipo de permiso y fecha son requeridos" }); return;
    }

    const rango = resolverRango(Fecha, FechaFin);
    if ("error" in rango) { res.status(400).json({ error: rango.error }); return; }

    await prisma.$executeRaw`
      UPDATE Permisos
      SET codigoPermiso = ${codigoPermiso}, Fecha = ${Fecha}, FechaFin = ${rango.fin},
          Observacion = ${Observacion || null}
      WHERE id = ${id}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/permisos/:id
router.delete("/:id", requireAuth, requirePerm("permisos", "eliminar"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.$executeRaw`DELETE FROM Permisos WHERE id = ${id}`;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
