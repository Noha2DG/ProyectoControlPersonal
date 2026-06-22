import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.ts";
import { nowGT, hoyInicioGT } from "../lib/dateGT.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";

const router = Router();

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

// POST /api/transferencias  { Codigo, CodigoArea }  (terminal de kiosco — requiere sesión)
router.post("/", requireAuth, async (req: Request, res: Response) => {
  const { Codigo, CodigoArea } = req.body;
  if (!Codigo || !CodigoArea) {
    res.status(400).json({ error: "Código y CodigoArea son requeridos" }); return;
  }
  try {
    const areas: any[] = await prisma.$queryRaw`
      SELECT Codigo, Nombre FROM Areas WHERE Codigo = ${CodigoArea} AND Activa = 1 LIMIT 1
    `;
    if (!areas.length) { res.status(404).json({ error: "Área no encontrada o inactiva" }); return; }

    const empleados: any[] = await prisma.$queryRaw`
      SELECT Codigo, CONCAT_WS(' ', PrimerNombre, SegundoNombre, PrimerApellido, SegundoApellido) AS NombreCompleto
      FROM Empleados WHERE Codigo = ${Codigo} AND Estado = 'Activo' LIMIT 1
    `;
    if (!empleados.length) { res.status(404).json({ error: "Empleado no encontrado o inactivo" }); return; }

    // Última área abierta (para mostrar Area Salida en el formulario)
    const prevTransf: any[] = await prisma.$queryRaw`
      SELECT t.CodigoArea, a.Nombre AS NombreArea
      FROM Transferencias t
      JOIN Areas a ON t.CodigoArea = a.Codigo
      WHERE t.Codigo = ${Codigo} AND t.FechaSalida IS NULL
      ORDER BY t.FechaHora DESC
      LIMIT 1
    `;
    const ultimaArea = prevTransf.length
      ? { Codigo: prevTransf[0].CodigoArea, Nombre: prevTransf[0].NombreArea }
      : null;

    // Verificar estado de movimientos del día
    const hoyInicio = hoyInicioGT();
    const movHoy: any[] = await prisma.$queryRaw`
      SELECT Tipo FROM Movimientos
      WHERE Codigo = ${Codigo} AND FechaHora >= ${hoyInicio}
      ORDER BY FechaHora ASC
    `;
    const tieneEntrada = movHoy.some((m: any) => m.Tipo === "Entrada");
    const tieneSalida  = movHoy.some((m: any) => m.Tipo === "Salida");

    if (!tieneEntrada) {
      res.status(400).json({ error: "No tiene entrada general registrada hoy" });
      return;
    }
    if (tieneSalida) {
      res.status(400).json({ error: "Ya marcó salida general, no puede registrar transferencia" });
      return;
    }

    // Área General (TT) está exenta de planificación — siempre libre
    const AREAS_LIBRES = ["TT"];
    if (!AREAS_LIBRES.includes(CodigoArea)) {
      const hoyFecha = hoyInicio.slice(0, 10);
      const plan: any[] = await prisma.$queryRaw`
        SELECT Cantidad FROM PlanificacionAreas
        WHERE Fecha = ${hoyFecha} AND CodigoArea = ${CodigoArea} LIMIT 1
      `;
      if (!plan.length || Number(plan[0].Cantidad) === 0) {
        res.status(400).json({ error: "Área no programada para hoy" }); return;
      }
      const ocupRows: any[] = await prisma.$queryRaw`
        SELECT COUNT(*) AS cnt FROM Transferencias
        WHERE CodigoArea = ${CodigoArea}
          AND DATE(FechaHora) = ${hoyFecha}
          AND FechaSalida IS NULL
      `;
      const ocupacion = Number(ocupRows[0].cnt);
      if (ocupacion >= Number(plan[0].Cantidad)) {
        res.status(400).json({ error: `Área llena (${ocupacion}/${Number(plan[0].Cantidad)} personas)` }); return;
      }
    }

    const ahora    = nowGT();
    const operador = getOperador(req);

    // Cerrar automáticamente el área anterior
    await prisma.$executeRaw`
      UPDATE Transferencias SET FechaSalida = ${ahora}
      WHERE Codigo = ${Codigo} AND FechaSalida IS NULL
    `;

    // Registrar entrada al nuevo área
    await prisma.$executeRaw`
      INSERT INTO Transferencias (Codigo, CodigoArea, FechaHora, RegistradoPor)
      VALUES (${Codigo}, ${CodigoArea}, ${ahora}, ${operador})
    `;

    res.json({ ok: true, area: areas[0], empleado: empleados[0], ultimaArea });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/transferencias/hoy  (terminal de kiosco — requiere sesión)
router.get("/hoy", requireAuth, async (_req: Request, res: Response) => {
  try {
    const hoyInicio = hoyInicioGT();
    const rows: any[] = await prisma.$queryRaw`
      SELECT
        t.id, t.Codigo,
        CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido) AS NombreCompleto,
        t.CodigoArea,
        a.Nombre   AS NombreArea,
        a.FormaPago,
        DATE_FORMAT(t.FechaHora,   '%H:%i:%s') AS HoraEntrada,
        DATE_FORMAT(t.FechaSalida, '%H:%i:%s') AS HoraSalida,
        TIMESTAMPDIFF(MINUTE, t.FechaHora, COALESCE(t.FechaSalida, NOW())) AS Minutos,
        t.RegistradoPor
      FROM Transferencias t
      JOIN Empleados e ON t.Codigo     = e.Codigo
      JOIN Areas     a ON t.CodigoArea = a.Codigo
      WHERE t.FechaHora >= ${hoyInicio}
      ORDER BY t.FechaHora DESC
      LIMIT 15
    `;
    res.json(rows.map(r => ({ ...r, Minutos: Number(r.Minutos) })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/transferencias?fecha=YYYY-MM-DD → registros desde esa fecha en adelante
router.get("/", requireAuth, requirePerm("transferencias", "ver"), async (req: Request, res: Response) => {
  try {
    const fecha = (req.query.fecha as string) ||
      new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
    const inicio = `${fecha} 00:00:00`;
    const rows: any[] = await prisma.$queryRaw`
      SELECT
        t.id, t.Codigo,
        CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido) AS NombreCompleto,
        t.CodigoArea,
        a.Nombre   AS NombreArea,
        a.FormaPago,
        DATE_FORMAT(t.FechaHora,   '%Y-%m-%d')       AS Fecha,
        DATE_FORMAT(t.FechaHora,   '%Y-%m-%dT%H:%i') AS FechaHoraInput,
        DATE_FORMAT(t.FechaSalida, '%Y-%m-%dT%H:%i') AS FechaSalidaInput,
        DATE_FORMAT(t.FechaHora,   '%H:%i:%s')        AS HoraEntrada,
        DATE_FORMAT(t.FechaSalida, '%H:%i:%s')        AS HoraSalida,
        TIMESTAMPDIFF(MINUTE, t.FechaHora, COALESCE(t.FechaSalida, NOW())) AS Minutos,
        t.RegistradoPor
      FROM Transferencias t
      JOIN Empleados e ON t.Codigo     = e.Codigo
      JOIN Areas     a ON t.CodigoArea = a.Codigo
      WHERE t.FechaHora >= ${inicio}
      ORDER BY t.FechaHora ASC
      LIMIT 500
    `;
    res.json(rows.map(r => ({ ...r, Minutos: Number(r.Minutos) })));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /api/transferencias/:id  { FechaHora, FechaSalida }
router.put("/:id", requireAuth, requirePerm("transferencias", "editar"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { FechaHora, FechaSalida } = req.body;
    const fh  = FechaHora.replace("T", " ") + (FechaHora.length === 16 ? ":00" : "");
    const fhs = FechaSalida
      ? FechaSalida.replace("T", " ") + (FechaSalida.length === 16 ? ":00" : "")
      : null;
    await prisma.$executeRaw`
      UPDATE Transferencias SET FechaHora = ${fh}, FechaSalida = ${fhs} WHERE id = ${id}
    `;
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/transferencias/:id
router.delete("/:id", requireAuth, requirePerm("transferencias", "eliminar"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.$executeRaw`DELETE FROM Transferencias WHERE id = ${id}`;
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
