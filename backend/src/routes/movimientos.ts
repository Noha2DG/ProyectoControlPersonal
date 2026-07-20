import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.ts";
import { nowGT, hoyInicioGT, diaSemanaDe } from "../lib/dateGT.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";
import { aplicarCorteMedianoche, LIMITE_HORAS_JORNADA } from "../lib/corteMedianoche.ts";

const router = Router();

const TIPOS_VALIDOS = ["Entrada", "Salida"];
const OPERADOR_SISTEMA = "Sistema";

function esDuplicado(err: any): boolean {
  return err?.code === "P2010" || /Duplicate entry/i.test(err?.message ?? "");
}

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
      SELECT Tipo, Operador FROM Movimientos
      WHERE Codigo = ${Codigo} AND FechaHora >= ${hoyInicio}
      ORDER BY FechaHora ASC
    `;

    // Si el turno venía de ayer (corte de medianoche), el primer movimiento de
    // hoy es la Entrada sintética del corte y el siguiente es la Salida real
    // que la cierra: ese par cierra el turno de ayer, no cuenta como
    // asistencia del día de hoy para el límite de 2 marcajes.
    const marcajesDeHoy =
      movimientosHoy[0]?.Operador === OPERADOR_SISTEMA && movimientosHoy[0]?.Tipo === "Entrada"
        ? movimientosHoy.slice(2)
        : movimientosHoy;

    if (marcajesDeHoy.length >= 2) {
      res.status(400).json({ error: "Ya tiene 2 marcajes registrados hoy" });
      return;
    }

    const tipo: "Entrada" | "Salida" =
      movimientosHoy.length === 0 || movimientosHoy[movimientosHoy.length - 1].Tipo === "Salida"
        ? "Entrada"
        : "Salida";

    const ahora     = nowGT();
    const diaSemana = diaSemanaDe(ahora);
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

// GET /api/movimientos/ciclos-abiertos → empleados cuyo último movimiento es Entrada y lleva
// LIMITE_HORAS_JORNADA horas o más sin Salida. El corte de medianoche los deja así a propósito
// (ver corteMedianoche.ts) para que un supervisor los revise — este endpoint es la lista de esa revisión.
router.get("/ciclos-abiertos", requireAuth, requirePerm("movimientos", "ver"), async (_req: Request, res: Response) => {
  try {
    const abiertos: any[] = await prisma.$queryRaw`
      SELECT m1.Codigo,
             COALESCE(NULLIF(m1.NombreEmpleado,''), NULLIF(CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido), ''), m1.Codigo) AS NombreEmpleado,
             DATE_FORMAT(m1.FechaHora, '%Y-%m-%d %H:%i:%s') AS FechaHora
      FROM Movimientos m1
      INNER JOIN (
        SELECT Codigo, MAX(FechaHora) AS UltimaFecha FROM Movimientos GROUP BY Codigo
      ) m2 ON m1.Codigo = m2.Codigo AND m1.FechaHora = m2.UltimaFecha
      LEFT JOIN Empleados e ON m1.Codigo = e.Codigo
      WHERE m1.Tipo = 'Entrada'
    `;
    const ahora = Date.parse(nowGT().replace(" ", "T"));
    const resultado = abiertos
      .map(r => ({
        Codigo: r.Codigo,
        NombreEmpleado: r.NombreEmpleado,
        FechaHora: r.FechaHora,
        HorasAbierto: (ahora - Date.parse(r.FechaHora.replace(" ", "T"))) / 3600000,
      }))
      .filter(r => r.HorasAbierto >= LIMITE_HORAS_JORNADA)
      .sort((a, b) => b.HorasAbierto - a.HorasAbierto);
    res.json(resultado);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/movimientos?fecha=YYYY-MM-DD → registros desde esa fecha en adelante
router.get("/", requireAuth, requirePerm("movimientos", "ver"), async (req: Request, res: Response) => {
  try {
    const fecha = (req.query.fecha as string) ||
      new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
    const inicio = `${fecha} 00:00:00`;
    const rows: any[] = await prisma.$queryRaw`
      SELECT m.id, m.Codigo,
             COALESCE(NULLIF(m.NombreEmpleado,''), NULLIF(CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido), ''), m.Codigo) AS NombreEmpleado,
             m.Tipo,
             DATE_FORMAT(m.FechaHora, '%Y-%m-%dT%H:%i') AS FechaHoraInput,
             DATE_FORMAT(m.FechaHora, '%Y-%m-%d')        AS Fecha,
             DATE_FORMAT(m.FechaHora, '%H:%i:%s')        AS Hora,
             m.DiaSemana, m.Operador
      FROM Movimientos m
      LEFT JOIN Empleados e ON m.Codigo = e.Codigo
      WHERE m.FechaHora >= ${inicio}
      ORDER BY m.FechaHora ASC
    `;
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /api/movimientos  { Codigo, Tipo, FechaHora }  (alta manual de admin — corrección por falta de gafete)
router.post("/", requireAuth, requirePerm("movimientos", "editar"), async (req: Request, res: Response) => {
  try {
    const { Codigo, Tipo, FechaHora } = req.body;
    if (!Codigo || !FechaHora) { res.status(400).json({ error: "Código y Fecha/Hora son requeridos" }); return; }
    if (!TIPOS_VALIDOS.includes(Tipo)) { res.status(400).json({ error: "Tipo inválido" }); return; }

    const empleados: any[] = await prisma.$queryRaw`
      SELECT Codigo, CONCAT_WS(' ', PrimerNombre, SegundoNombre, PrimerApellido, SegundoApellido) AS NombreCompleto
      FROM Empleados WHERE Codigo = ${Codigo} LIMIT 1
    `;
    if (!empleados.length) { res.status(404).json({ error: "Empleado no encontrado" }); return; }

    const fh = FechaHora.replace("T", " ") + (FechaHora.length === 16 ? ":00" : "");
    const diaSemana = diaSemanaDe(fh);
    const operador  = getOperador(req);

    try {
      await prisma.$executeRaw`
        INSERT INTO Movimientos (Codigo, NombreEmpleado, Tipo, FechaHora, DiaSemana, Operador)
        VALUES (${Codigo}, ${empleados[0].NombreCompleto}, ${Tipo}, ${fh}, ${diaSemana}, ${operador})
      `;
    } catch (err: any) {
      if (esDuplicado(err)) { res.status(400).json({ error: "Ya existe un registro idéntico para ese empleado, fecha/hora y tipo" }); return; }
      throw err;
    }
    res.status(201).json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /api/movimientos/:id  { Codigo, FechaHora, Tipo }
router.put("/:id", requireAuth, requirePerm("movimientos", "editar"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { Codigo, FechaHora, Tipo } = req.body;
    if (!Codigo || !FechaHora) { res.status(400).json({ error: "Código y Fecha/Hora son requeridos" }); return; }
    if (!TIPOS_VALIDOS.includes(Tipo)) { res.status(400).json({ error: "Tipo inválido" }); return; }

    const empleados: any[] = await prisma.$queryRaw`
      SELECT Codigo, CONCAT_WS(' ', PrimerNombre, SegundoNombre, PrimerApellido, SegundoApellido) AS NombreCompleto
      FROM Empleados WHERE Codigo = ${Codigo} LIMIT 1
    `;
    if (!empleados.length) { res.status(404).json({ error: "Empleado no encontrado" }); return; }

    // FechaHora viene como "2026-06-17T12:08" del input datetime-local → normalizar
    const fh = FechaHora.replace("T", " ") + (FechaHora.length === 16 ? ":00" : "");
    const diaSemana = diaSemanaDe(fh);

    try {
      await prisma.$executeRaw`
        UPDATE Movimientos
        SET Codigo = ${Codigo}, NombreEmpleado = ${empleados[0].NombreCompleto},
            Tipo = ${Tipo}, FechaHora = ${fh}, DiaSemana = ${diaSemana}
        WHERE id = ${id}
      `;
    } catch (err: any) {
      if (esDuplicado(err)) { res.status(400).json({ error: "Ya existe un registro idéntico para ese empleado, fecha/hora y tipo" }); return; }
      throw err;
    }
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
