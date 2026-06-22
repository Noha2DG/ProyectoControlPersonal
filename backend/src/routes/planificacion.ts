import { Router, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";

const router = Router();

// Áreas exentas de planificación — siempre disponibles sin restricción
const AREAS_LIBRES = ["TT"];

// GET /api/planificacion/kiosco  (terminal de kiosco — requiere sesión)
// Retorna áreas activas con planificación de HOY + ocupación actual
router.get("/kiosco", requireAuth, async (_req: Request, res: Response) => {
  try {
    const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
    const rows: any[] = await prisma.$queryRaw`
      SELECT
        a.Codigo       AS CodigoArea,
        a.Nombre,
        a.FormaPago,
        COALESCE(p.Cantidad, 0) AS Cantidad,
        COUNT(t.id)             AS ocupacion
      FROM Areas a
      LEFT JOIN PlanificacionAreas p
             ON p.CodigoArea = a.Codigo AND p.Fecha = ${hoy}
      LEFT JOIN Transferencias t
             ON t.CodigoArea = a.Codigo
            AND DATE(t.FechaHora) = ${hoy}
            AND t.FechaSalida IS NULL
      WHERE a.Activa = 1
      GROUP BY a.Codigo, a.Nombre, a.FormaPago, p.Cantidad
      ORDER BY a.Nombre ASC
    `;
    res.json(rows.map(r => {
      const libre    = AREAS_LIBRES.includes(r.CodigoArea);
      const cantidad = Number(r.Cantidad);
      const ocupacion = Number(r.ocupacion);
      return {
        CodigoArea: r.CodigoArea,
        Nombre:     r.Nombre,
        FormaPago:  r.FormaPago,
        Cantidad:   cantidad,
        ocupacion,
        disponible: libre ? 999 : Math.max(0, cantidad - ocupacion),
        bloqueada:  libre ? false : cantidad === 0,
        libre,
      };
    }));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/planificacion?fecha=YYYY-MM-DD  (admin)
router.get("/", requireAuth, requirePerm("planificacion", "ver"), async (req: Request, res: Response) => {
  try {
    const fecha = (req.query.fecha as string) ||
      new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
    const rows: any[] = await prisma.$queryRaw`
      SELECT
        a.Codigo        AS CodigoArea,
        a.Nombre,
        a.FormaPago,
        a.Activa,
        COALESCE(p.Cantidad, 0) AS Cantidad,
        COUNT(t.id)             AS ocupacion
      FROM Areas a
      LEFT JOIN PlanificacionAreas p
             ON p.CodigoArea = a.Codigo AND p.Fecha = ${fecha}
      LEFT JOIN Transferencias t
             ON t.CodigoArea = a.Codigo
            AND DATE(t.FechaHora) = ${fecha}
            AND t.FechaSalida IS NULL
      WHERE a.Activa = 1
      GROUP BY a.Codigo, a.Nombre, a.FormaPago, a.Activa, p.Cantidad
      ORDER BY a.Nombre ASC
    `;
    res.json(rows.map(r => ({
      CodigoArea: r.CodigoArea,
      Nombre:     r.Nombre,
      FormaPago:  r.FormaPago,
      Activa:     Number(r.Activa) === 1,
      Cantidad:   Number(r.Cantidad),
      ocupacion:  Number(r.ocupacion),
      disponible: Math.max(0, Number(r.Cantidad) - Number(r.ocupacion)),
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/planificacion  { fecha, items: [{ CodigoArea, Cantidad }] }
router.put("/", requireAuth, requirePerm("planificacion", "editar"), async (req: Request, res: Response) => {
  const { fecha, items } = req.body as { fecha: string; items: { CodigoArea: string; Cantidad: number }[] };
  if (!fecha || !Array.isArray(items)) {
    res.status(400).json({ error: "Fecha e items son requeridos" }); return;
  }
  if (!items.length) { res.json({ ok: true }); return; }
  try {
    const values = Prisma.join(
      items.map(item => Prisma.sql`(${fecha}, ${item.CodigoArea}, ${Math.max(0, Number(item.Cantidad) || 0)})`)
    );
    await prisma.$executeRaw`
      INSERT INTO PlanificacionAreas (Fecha, CodigoArea, Cantidad)
      VALUES ${values}
      ON DUPLICATE KEY UPDATE Cantidad = VALUES(Cantidad)
    `;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
