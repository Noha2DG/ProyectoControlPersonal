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

function formatear(rows: any[]) {
  return rows.map(r => ({
    ...r,
    TransaccionId: Number(r.TransaccionId),
    Talla: Number(r.Talla),
    Procesado: Number(r.Procesado),
  }));
}

const SELECT_TRANS = `
  SELECT tp.TransaccionId, tp.Lote, tp.Proceso, pr.Descripcion AS DescripcionProceso,
         tp.ClasePT, cl.Descripcion AS DescripcionClasePT, tp.Talla, ta.Descripcion AS DescripcionTalla,
         tp.AlmacenOrigen, tp.AlmacenDestino, tp.Estado, tp.FechaHora, tp.FechaProduccion, tp.RegistradoPor,
         COALESCE((SELECT SUM(pd.Peso) FROM PesajeDetalle pd WHERE pd.TransaccionId = tp.TransaccionId), 0) AS Procesado
  FROM TransaccionesProduccion tp
  JOIN Procesos pr ON tp.Proceso = pr.Proceso
  JOIN Clase cl ON tp.ClasePT = cl.Clase
  JOIN Tallas ta ON tp.Talla = ta.Codigo
`;

// GET /api/transacciones-produccion?lote=XXX | ?estado=Abierta
// El filtro por lote (vista operativa del día) solo muestra transacciones Abiertas — las Cerradas
// ya quedaron resueltas y se consultan desde el Reporte, no aquí.
router.get("/", requireAuth, requirePerm("destajo", "ver"), async (req: Request, res: Response) => {
  try {
    const lote = req.query.lote as string | undefined;
    const estado = req.query.estado as string | undefined;
    let rows: any[];
    if (lote) {
      rows = await prisma.$queryRawUnsafe(`${SELECT_TRANS} WHERE tp.Lote = ? AND tp.Estado = 'Abierta' ORDER BY tp.TransaccionId DESC`, lote);
    } else if (estado) {
      rows = await prisma.$queryRawUnsafe(`${SELECT_TRANS} WHERE tp.Estado = ? ORDER BY tp.TransaccionId DESC LIMIT 200`, estado);
    } else {
      rows = await prisma.$queryRawUnsafe(`${SELECT_TRANS} ORDER BY tp.TransaccionId DESC LIMIT 200`);
    }
    res.json(formatear(rows));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/transacciones-produccion  { Lote, Proceso, ClasePT, Talla, AlmacenOrigen, AlmacenDestino, FechaProduccion }
router.post("/", requireAuth, requirePerm("destajo", "crear"), async (req: Request, res: Response) => {
  try {
    const { Lote, Proceso, ClasePT, Talla, AlmacenOrigen, AlmacenDestino, FechaProduccion } = req.body;
    if (!Lote || !Proceso || !ClasePT || !Talla || !AlmacenOrigen || !AlmacenDestino) {
      res.status(400).json({ error: "Lote, Proceso, Clase PT, Talla, Almacén origen y destino son requeridos" });
      return;
    }
    const lotes: any[] = await prisma.$queryRaw`SELECT Lote FROM Lotes WHERE Lote = ${Lote} AND Activo = 1 LIMIT 1`;
    if (!lotes.length) { res.status(404).json({ error: "Lote no encontrado o inactivo" }); return; }

    const operador = getOperador(req);
    await prisma.$executeRaw`
      INSERT INTO TransaccionesProduccion (Lote, Proceso, ClasePT, Talla, AlmacenOrigen, AlmacenDestino, FechaProduccion, RegistradoPor)
      VALUES (${Lote}, ${Number(Proceso)}, ${ClasePT}, ${Number(Talla)}, ${AlmacenOrigen}, ${AlmacenDestino}, ${FechaProduccion || new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" })}, ${operador})
    `;
    res.status(201).json({ ok: true });
  } catch (err: any) {
    if (err.message?.includes("foreign key")) res.status(400).json({ error: "Proceso, Clase PT, Talla o Almacén no existen" });
    else res.status(500).json({ error: err.message });
  }
});

// PUT /api/transacciones-produccion/:id  { Estado }
router.put("/:id", requireAuth, requirePerm("destajo", "editar"), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { Estado } = req.body;
    if (!["Abierta", "Cerrada"].includes(Estado)) { res.status(400).json({ error: "Estado inválido" }); return; }
    await prisma.$executeRaw`UPDATE TransaccionesProduccion SET Estado = ${Estado} WHERE TransaccionId = ${id}`;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/transacciones-produccion/:id  (solo si no tiene pesajes registrados — corrección de error de captura)
// Bloquea la fila (FOR UPDATE) dentro de una transacción de BD antes de revisar/borrar — esto serializa
// contra un POST/PUT de pesaje concurrente sobre la misma transacción (ver pesajeDetalle.ts), evitando que
// un pesaje se cuele justo entre el conteo de "0 pesajes" y el borrado.
router.delete("/:id", requireAuth, requirePerm("destajo", "eliminar"), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const resultado = await prisma.$transaction(async (tx) => {
      const trans: any[] = await tx.$queryRaw`SELECT TransaccionId FROM TransaccionesProduccion WHERE TransaccionId = ${id} LIMIT 1 FOR UPDATE`;
      if (!trans.length) return { error: "Transacción no encontrada", status: 404 };

      const pesajes: any[] = await tx.$queryRaw`SELECT COUNT(*) AS n FROM PesajeDetalle WHERE TransaccionId = ${id}`;
      if (Number(pesajes[0].n) > 0) {
        return { error: "No se puede eliminar: esta transacción ya tiene pesajes registrados", status: 400 };
      }

      await tx.$executeRaw`DELETE FROM Termos WHERE TransaccionId = ${id}`;
      await tx.$executeRaw`DELETE FROM TransaccionesProduccion WHERE TransaccionId = ${id}`;
      return { ok: true };
    });

    if (!("ok" in resultado) || !resultado.ok) {
      res.status((resultado as any).status || 400).json({ error: (resultado as any).error });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
