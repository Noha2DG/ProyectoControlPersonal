import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma.ts";
import { nowGT } from "../lib/dateGT.ts";
import { requireAuth } from "../middleware/auth.ts";

const router = Router();

// Toda esta API es de terminal de kiosco (entrega/devolución de uniformes) — requiere sesión
router.use(requireAuth);

function getOperador(req: Request): string {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return "Kiosco";
    const payload: any = jwt.verify(header.slice(7), process.env.JWT_SECRET!);
    return payload.nombre ?? payload.username ?? "Kiosco";
  } catch {
    return "Kiosco";
  }
}

function hoyGT(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
}

async function obtenerDetalle(entregaId: number) {
  const detalle: any[] = await prisma.$queryRaw`
    SELECT d.CodigoTipoEquipo, t.Nombre, d.Devuelto
    FROM EntregaEquipoDetalle d
    JOIN TiposEquipo t ON d.CodigoTipoEquipo = t.Codigo
    WHERE d.EntregaId = ${entregaId}
    ORDER BY t.Nombre ASC
  `;
  return detalle.map(d => ({ ...d, Devuelto: !!d.Devuelto }));
}

// GET /api/equipo/tipos
router.get("/tipos", async (_req: Request, res: Response) => {
  try {
    const rows = await prisma.$queryRaw`SELECT Codigo, Nombre FROM TiposEquipo WHERE Activo = 1 ORDER BY Nombre ASC`;
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/equipo/entrega/:codigo  → estado de hoy para ese empleado (asignación pendiente, en curso o cerrada)
router.get("/entrega/:codigo", async (req: Request, res: Response) => {
  try {
    const codigo = req.params.codigo;
    const empleados: any[] = await prisma.$queryRaw`
      SELECT Codigo, CONCAT_WS(' ', PrimerNombre, SegundoNombre, PrimerApellido, SegundoApellido) AS NombreCompleto, Estado
      FROM Empleados WHERE Codigo = ${codigo} LIMIT 1
    `;
    if (!empleados.length) { res.status(404).json({ error: "Empleado no encontrado" }); return; }
    if (empleados[0].Estado !== "Activo") { res.status(400).json({ error: "Empleado no está activo" }); return; }

    const fecha = hoyGT();
    const entregas: any[] = await prisma.$queryRaw`
      SELECT id, FechaHoraEntrega, FechaHoraDevolucion, Estado
      FROM EntregaEquipo WHERE Codigo = ${codigo} AND Fecha = ${fecha} LIMIT 1
    `;

    const empleado = { Codigo: empleados[0].Codigo, NombreCompleto: empleados[0].NombreCompleto };
    if (!entregas.length) { res.json({ empleado, entrega: null }); return; }

    const items = await obtenerDetalle(entregas[0].id);
    res.json({ empleado, entrega: { ...entregas[0], items } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/equipo/entrega  { Codigo, items: ["PAN","GOR",...] }
router.post("/entrega", async (req: Request, res: Response) => {
  try {
    const { Codigo, items } = req.body;
    if (!Codigo) { res.status(400).json({ error: "Código requerido" }); return; }
    if (!Array.isArray(items) || items.length === 0) { res.status(400).json({ error: "Seleccione al menos un equipo" }); return; }

    const empleados: any[] = await prisma.$queryRaw`
      SELECT Codigo, CONCAT_WS(' ', PrimerNombre, SegundoNombre, PrimerApellido, SegundoApellido) AS NombreCompleto, Estado
      FROM Empleados WHERE Codigo = ${Codigo} LIMIT 1
    `;
    if (!empleados.length) { res.status(404).json({ error: "Empleado no encontrado" }); return; }
    if (empleados[0].Estado !== "Activo") { res.status(400).json({ error: "Empleado no está activo" }); return; }

    const fecha = hoyGT();
    const existente: any[] = await prisma.$queryRaw`
      SELECT id FROM EntregaEquipo WHERE Codigo = ${Codigo} AND Fecha = ${fecha} LIMIT 1
    `;
    if (existente.length) { res.status(400).json({ error: "Este empleado ya tiene equipo asignado hoy" }); return; }

    const operador = getOperador(req);
    const ahora = nowGT();
    await prisma.$executeRaw`
      INSERT INTO EntregaEquipo (Codigo, Fecha, FechaHoraEntrega, RegistradoPorEntrega)
      VALUES (${Codigo}, ${fecha}, ${ahora}, ${operador})
    `;
    const creada: any[] = await prisma.$queryRaw`
      SELECT id FROM EntregaEquipo WHERE Codigo = ${Codigo} AND Fecha = ${fecha} LIMIT 1
    `;
    const entregaId = creada[0].id;

    const valores = Prisma.join(items.map((codigoTipo: string) => Prisma.sql`(${entregaId}, ${codigoTipo})`));
    await prisma.$executeRaw`
      INSERT INTO EntregaEquipoDetalle (EntregaId, CodigoTipoEquipo) VALUES ${valores}
    `;

    res.status(201).json({
      empleado: { Codigo: empleados[0].Codigo, NombreCompleto: empleados[0].NombreCompleto },
      entrega: { id: entregaId, items: await obtenerDetalle(entregaId) },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/equipo/entrega/:id/agregar  { items: ["CHU","GOR"] }
// Agrega equipo adicional a una entrega ya abierta (p. ej. cambio de área a medio turno)
router.put("/entrega/:id/agregar", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) { res.status(400).json({ error: "Seleccione al menos un equipo" }); return; }

    const entregas: any[] = await prisma.$queryRaw`SELECT id, FechaHoraDevolucion FROM EntregaEquipo WHERE id = ${id} LIMIT 1`;
    if (!entregas.length) { res.status(404).json({ error: "Entrega no encontrada" }); return; }
    if (entregas[0].FechaHoraDevolucion) { res.status(400).json({ error: "Esta entrega ya fue cerrada, no se puede agregar equipo" }); return; }

    const valores = Prisma.join(items.map((codigoTipo: string) => Prisma.sql`(${id}, ${codigoTipo})`));
    await prisma.$executeRaw`
      INSERT IGNORE INTO EntregaEquipoDetalle (EntregaId, CodigoTipoEquipo) VALUES ${valores}
    `;

    res.json({ ok: true, items: await obtenerDetalle(id) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/equipo/entrega/:id/devolucion  { devueltos: ["PAN","GOR"] }
router.put("/entrega/:id/devolucion", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { devueltos } = req.body;
    if (!Array.isArray(devueltos)) { res.status(400).json({ error: "Lista de equipo devuelto requerida" }); return; }

    const entregas: any[] = await prisma.$queryRaw`SELECT id, FechaHoraDevolucion FROM EntregaEquipo WHERE id = ${id} LIMIT 1`;
    if (!entregas.length) { res.status(404).json({ error: "Entrega no encontrada" }); return; }
    if (entregas[0].FechaHoraDevolucion) { res.status(400).json({ error: "Esta entrega ya fue cerrada" }); return; }

    const ahora = nowGT();
    const operador = getOperador(req);

    await prisma.$executeRaw`
      UPDATE EntregaEquipoDetalle SET Devuelto = 0, FechaHoraDevolucion = NULL WHERE EntregaId = ${id}
    `;
    if (devueltos.length) {
      const lista = Prisma.join(devueltos.map((c: string) => Prisma.sql`${c}`));
      await prisma.$executeRaw`
        UPDATE EntregaEquipoDetalle SET Devuelto = 1, FechaHoraDevolucion = ${ahora}
        WHERE EntregaId = ${id} AND CodigoTipoEquipo IN (${lista})
      `;
    }

    const total: any[]     = await prisma.$queryRaw`SELECT COUNT(*) AS n FROM EntregaEquipoDetalle WHERE EntregaId = ${id}`;
    const devueltosN: any[] = await prisma.$queryRaw`SELECT COUNT(*) AS n FROM EntregaEquipoDetalle WHERE EntregaId = ${id} AND Devuelto = 1`;
    const estado = Number(devueltosN[0].n) === Number(total[0].n) ? "Completo" : "Incompleto";

    await prisma.$executeRaw`
      UPDATE EntregaEquipo
      SET FechaHoraDevolucion = ${ahora}, RegistradoPorDevolucion = ${operador}, Estado = ${estado}
      WHERE id = ${id}
    `;

    res.json({ ok: true, estado, items: await obtenerDetalle(id) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/equipo/hoy  → listado del día para la pantalla kiosco
router.get("/hoy", async (_req: Request, res: Response) => {
  try {
    const fecha = hoyGT();
    const entregas: any[] = await prisma.$queryRaw`
      SELECT e.id, e.Codigo,
             CONCAT_WS(' ', emp.PrimerNombre, emp.SegundoNombre, emp.PrimerApellido, emp.SegundoApellido) AS NombreCompleto,
             DATE_FORMAT(e.FechaHoraEntrega, '%H:%i:%s') AS HoraEntrega,
             DATE_FORMAT(e.FechaHoraDevolucion, '%H:%i:%s') AS HoraDevolucion,
             e.Estado
      FROM EntregaEquipo e
      JOIN Empleados emp ON e.Codigo = emp.Codigo
      WHERE e.Fecha = ${fecha}
      ORDER BY e.FechaHoraEntrega DESC
    `;
    if (!entregas.length) { res.json([]); return; }

    // Una sola consulta para el detalle de todas las entregas del día (evita N+1)
    const ids = Prisma.join(entregas.map((e: any) => Prisma.sql`${e.id}`));
    const detalle: any[] = await prisma.$queryRaw`
      SELECT d.EntregaId, d.CodigoTipoEquipo, t.Nombre, d.Devuelto
      FROM EntregaEquipoDetalle d
      JOIN TiposEquipo t ON d.CodigoTipoEquipo = t.Codigo
      WHERE d.EntregaId IN (${ids})
      ORDER BY t.Nombre ASC
    `;

    const porEntrega = new Map<number, any[]>();
    for (const d of detalle) {
      const lista = porEntrega.get(d.EntregaId) ?? [];
      lista.push({ CodigoTipoEquipo: d.CodigoTipoEquipo, Nombre: d.Nombre, Devuelto: !!d.Devuelto });
      porEntrega.set(d.EntregaId, lista);
    }

    res.json(entregas.map((e: any) => ({ ...e, items: porEntrega.get(e.id) ?? [] })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
