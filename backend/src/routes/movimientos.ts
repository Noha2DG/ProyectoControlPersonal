import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.ts";
import { nowGT, hoyInicioGT } from "../lib/dateGT.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";
import { aplicarCorteMedianoche } from "../lib/corteMedianoche.ts";

const router = Router();

const DIAS = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];

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

// POST /api/movimientos/registrar  { Codigo }  (terminal de kiosco — sin sesión, dispositivo físico fijo)
router.post("/registrar", async (req: Request, res: Response) => {
  const { Codigo } = req.body;
  if (!Codigo) { res.status(400).json({ error: "Código requerido" }); return; }

  try {
    const empleados: any[] = await prisma.$queryRaw`
      SELECT Codigo, CONCAT_WS(' ', PrimerNombre, SegundoNombre, PrimerApellido, SegundoApellido) AS NombreCompleto, Estado
      FROM Empleados WHERE Codigo = ${Codigo} LIMIT 1
    `;
    if (!empleados.length) { res.status(404).json({ error: "Empleado no encontrado" }); return; }
    const emp = empleados[0];
    if (emp.Estado !== "Activo") { res.status(400).json({ error: "Empleado no está activo" }); return; }

    // Si venía de una Entrada de un día calendario anterior (turno que cruzó
    // medianoche), primero la cierra y reabre en el día de hoy antes de decidir
    // si este marcaje es Entrada o Salida.
    await aplicarCorteMedianoche(Codigo);

    const hoyInicio = hoyInicioGT();

    const movimientosHoy: any[] = await prisma.$queryRaw`
      SELECT Tipo FROM Movimientos
      WHERE Codigo = ${Codigo} AND FechaHora >= ${hoyInicio}
      ORDER BY FechaHora ASC
    `;

    if (movimientosHoy.length >= 2) {
      res.status(400).json({ error: "Ya tiene 2 marcajes registrados hoy" });
      return;
    }

    const tipo: "Entrada" | "Salida" =
      movimientosHoy.length === 0 || movimientosHoy[movimientosHoy.length - 1].Tipo === "Salida"
        ? "Entrada"
        : "Salida";

    const ahora     = nowGT();
    const diaSemana = DIAS[new Date().getDay()];
    const operador  = getOperador(req);

    await prisma.$executeRaw`
      INSERT INTO Movimientos (Codigo, NombreEmpleado, Tipo, FechaHora, DiaSemana, Operador)
      VALUES (${Codigo}, ${emp.NombreCompleto}, ${tipo}, ${ahora}, ${diaSemana}, ${operador})
    `;

    // Al marcar Salida del día, cerrar la última área abierta en Transferencias
    if (tipo === "Salida") {
      await prisma.$executeRaw`
        UPDATE Transferencias SET FechaSalida = ${ahora}
        WHERE Codigo = ${Codigo} AND FechaSalida IS NULL
      `;
    }

    res.json({
      empleado: { Codigo: emp.Codigo, NombreCompleto: emp.NombreCompleto },
      tipo,
      diaSemana,
      hora: ahora,
      operador,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/movimientos/hoy  (terminal de kiosco — requiere sesión)
router.get("/hoy", requireAuth, async (_req: Request, res: Response) => {
  try {
    const hoyInicio = hoyInicioGT();
    const rows: any[] = await prisma.$queryRaw`
      SELECT m.id, m.Codigo,
             COALESCE(NULLIF(m.NombreEmpleado,''), NULLIF(CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido), ''), m.Codigo) AS NombreEmpleado,
             m.Tipo,
             DATE_FORMAT(m.FechaHora, '%H:%i:%s') AS Hora,
             DATE_FORMAT(m.FechaHora, '%Y-%m-%d') AS Fecha,
             m.DiaSemana, m.Operador
      FROM Movimientos m
      LEFT JOIN Empleados e ON m.Codigo = e.Codigo
      WHERE m.FechaHora >= ${hoyInicio}
      ORDER BY m.FechaHora DESC
    `;
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/movimientos?fecha=YYYY-MM-DD
router.get("/", requireAuth, requirePerm("movimientos", "ver"), async (req: Request, res: Response) => {
  try {
    const fecha = (req.query.fecha as string) ||
      new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
    const inicio = `${fecha} 00:00:00`;
    const fin    = `${fecha} 23:59:59`;
    const rows: any[] = await prisma.$queryRaw`
      SELECT m.id, m.Codigo,
             COALESCE(NULLIF(m.NombreEmpleado,''), NULLIF(CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido), ''), m.Codigo) AS NombreEmpleado,
             m.Tipo,
             DATE_FORMAT(m.FechaHora, '%Y-%m-%dT%H:%i') AS FechaHoraInput,
             DATE_FORMAT(m.FechaHora, '%H:%i:%s')        AS Hora,
             m.DiaSemana, m.Operador
      FROM Movimientos m
      LEFT JOIN Empleados e ON m.Codigo = e.Codigo
      WHERE m.FechaHora BETWEEN ${inicio} AND ${fin}
      ORDER BY m.FechaHora ASC
    `;
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /api/movimientos/:id  { FechaHora, Tipo }
router.put("/:id", requireAuth, requirePerm("movimientos", "editar"), async (req: Request, res: Response) => {
  try {
    const id   = parseInt(req.params.id);
    const { FechaHora, Tipo } = req.body;
    // FechaHora viene como "2026-06-17T12:08" del input datetime-local → normalizar
    const fh = FechaHora.replace("T", " ") + (FechaHora.length === 16 ? ":00" : "");
    await prisma.$executeRaw`
      UPDATE Movimientos SET FechaHora = ${fh}, Tipo = ${Tipo} WHERE id = ${id}
    `;
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/movimientos/:id
router.delete("/:id", requireAuth, requirePerm("movimientos", "eliminar"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.$executeRaw`DELETE FROM Movimientos WHERE id = ${id}`;
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
