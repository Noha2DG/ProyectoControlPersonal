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

// GET /api/permisos?fecha=YYYY-MM-DD[&hasta=YYYY-MM-DD] → por defecto desde esa fecha en adelante;
//   con "hasta" queda acotado al rango [fecha, hasta]
// GET /api/permisos?codigo=CODIGO&desde=YYYY-MM-DD → permisos de un empleado desde esa fecha en adelante
router.get("/", requireAuth, requirePerm("permisos", "ver"), async (req: Request, res: Response) => {
  try {
    const fecha  = req.query.fecha  as string | undefined;
    const hasta  = req.query.hasta  as string | undefined;
    const codigo = req.query.codigo as string | undefined;
    const desde  = req.query.desde  as string | undefined;

    let rows: any[];
    if (codigo && desde) {
      rows = await prisma.$queryRaw`
        SELECT p.id, p.CodigoEmpleado, CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido) AS NombreCompleto, e.CodigoEtalent, p.codigoPermiso, tp.descripcion,
               DATE_FORMAT(p.Fecha, '%Y-%m-%d') AS Fecha, p.Observacion, p.RegistradoPor
        FROM Permisos p
        JOIN Empleados e ON p.CodigoEmpleado = e.Codigo
        JOIN TipoPermiso tp ON p.codigoPermiso = tp.codigoPermiso
        WHERE p.CodigoEmpleado = ${codigo} AND p.Fecha >= ${desde}
        ORDER BY p.Fecha ASC
      `;
    } else if (fecha && hasta) {
      rows = await prisma.$queryRaw`
        SELECT p.id, p.CodigoEmpleado, CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido) AS NombreCompleto, e.CodigoEtalent, p.codigoPermiso, tp.descripcion,
               DATE_FORMAT(p.Fecha, '%Y-%m-%d') AS Fecha, p.Observacion, p.RegistradoPor
        FROM Permisos p
        JOIN Empleados e ON p.CodigoEmpleado = e.Codigo
        JOIN TipoPermiso tp ON p.codigoPermiso = tp.codigoPermiso
        WHERE p.Fecha BETWEEN ${fecha} AND ${hasta}
        ORDER BY CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido) ASC
      `;
    } else if (fecha) {
      rows = await prisma.$queryRaw`
        SELECT p.id, p.CodigoEmpleado, CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido) AS NombreCompleto, e.CodigoEtalent, p.codigoPermiso, tp.descripcion,
               DATE_FORMAT(p.Fecha, '%Y-%m-%d') AS Fecha, p.Observacion, p.RegistradoPor
        FROM Permisos p
        JOIN Empleados e ON p.CodigoEmpleado = e.Codigo
        JOIN TipoPermiso tp ON p.codigoPermiso = tp.codigoPermiso
        WHERE p.Fecha >= ${fecha}
        ORDER BY CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido) ASC
      `;
    } else {
      rows = await prisma.$queryRaw`
        SELECT p.id, p.CodigoEmpleado, CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido) AS NombreCompleto, e.CodigoEtalent, p.codigoPermiso, tp.descripcion,
               DATE_FORMAT(p.Fecha, '%Y-%m-%d') AS Fecha, p.Observacion, p.RegistradoPor
        FROM Permisos p
        JOIN Empleados e ON p.CodigoEmpleado = e.Codigo
        JOIN TipoPermiso tp ON p.codigoPermiso = tp.codigoPermiso
        ORDER BY CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido) ASC
        LIMIT 200
      `;
    }
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/permisos  { CodigoEmpleado, codigoPermiso, Fecha, Observacion }
router.post("/", requireAuth, requirePerm("permisos", "crear"), async (req: Request, res: Response) => {
  try {
    const { CodigoEmpleado, codigoPermiso, Fecha, Observacion } = req.body;
    if (!CodigoEmpleado || !codigoPermiso || !Fecha) {
      res.status(400).json({ error: "Empleado, tipo de permiso y fecha son requeridos" }); return;
    }

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
      INSERT INTO Permisos (CodigoEmpleado, codigoPermiso, Fecha, Observacion, RegistradoPor)
      VALUES (${CodigoEmpleado}, ${codigoPermiso}, ${Fecha}, ${Observacion || null}, ${operador})
    `;
    res.status(201).json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/permisos/:id  { codigoPermiso, Fecha, Observacion }
router.put("/:id", requireAuth, requirePerm("permisos", "editar"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { codigoPermiso, Fecha, Observacion } = req.body;
    await prisma.$executeRaw`
      UPDATE Permisos SET codigoPermiso = ${codigoPermiso}, Fecha = ${Fecha}, Observacion = ${Observacion || null}
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
