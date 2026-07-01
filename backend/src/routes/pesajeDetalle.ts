import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
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

async function resolverTermo(tx: any, transaccionId: number, numeroTermo: number, almacenOrigen: string) {
  let termos: any[] = await tx.$queryRaw`
    SELECT TermoId FROM Termos WHERE TransaccionId = ${transaccionId} AND NumeroTermo = ${numeroTermo} LIMIT 1
  `;
  if (!termos.length) {
    try {
      await tx.$executeRaw`
        INSERT INTO Termos (TransaccionId, NumeroTermo, AlmacenActual, Capacidad) VALUES (${transaccionId}, ${numeroTermo}, ${almacenOrigen}, 150)
      `;
    } catch (err: any) {
      if (!err.message?.includes("Duplicate")) throw err; // creado en paralelo por otra estación justo ahora — se recupera abajo
    }
    termos = await tx.$queryRaw`
      SELECT TermoId FROM Termos WHERE TransaccionId = ${transaccionId} AND NumeroTermo = ${numeroTermo} LIMIT 1
    `;
  }
  return termos[0].TermoId;
}

// Bloquea la fila de la transacción (FOR UPDATE) y revalida su Estado dentro de la transacción de BD —
// esto serializa contra un DELETE concurrente de la misma transacción (ver transaccionesProduccion.ts)
// y evita leer un Estado que cambió justo después de leerlo afuera.
async function bloquearTransaccionAbierta(tx: any, transaccionId: number) {
  const trans: any[] = await tx.$queryRaw`
    SELECT Lote, AlmacenOrigen, Estado FROM TransaccionesProduccion WHERE TransaccionId = ${transaccionId} LIMIT 1 FOR UPDATE
  `;
  if (!trans.length) return { error: "Transacción no encontrada", status: 404 };
  if (trans[0].Estado !== "Abierta") return { error: "La transacción está cerrada", status: 400 };
  return { trans: trans[0] };
}

// Bloquea la fila del lote (FOR UPDATE) y calcula cuánta materia prima sigue disponible — al estar dentro
// de la misma transacción de BD que el INSERT/UPDATE de PesajeDetalle, dos pesadas concurrentes contra el
// mismo lote ya no pueden leer el mismo "disponible" y juntas exceder el 100% del peso de ingreso.
async function verificarDisponibilidad(tx: any, lote: string, pesoNuevo: number, excluirPesajeId?: number) {
  const lotes: any[] = await tx.$queryRaw`SELECT PesoIngreso, UM FROM Lotes WHERE Lote = ${lote} LIMIT 1 FOR UPDATE`;
  if (!lotes.length) return { ok: false, error: "Lote no encontrado", status: 404 };
  const { PesoIngreso, UM } = lotes[0];
  const procesado: any[] = await tx.$queryRaw`
    SELECT COALESCE(SUM(pd.Peso), 0) AS Procesado
    FROM PesajeDetalle pd
    JOIN TransaccionesProduccion tp ON pd.TransaccionId = tp.TransaccionId
    WHERE tp.Lote = ${lote} ${excluirPesajeId ? Prisma.sql`AND pd.PesajeId != ${excluirPesajeId}` : Prisma.empty}
  `;
  const procesadoActual = Number(procesado[0].Procesado);
  const disponible = Number(PesoIngreso) - procesadoActual;
  if (pesoNuevo > disponible) {
    return {
      ok: false, status: 400,
      error: `No hay suficiente materia prima en el lote. Disponible: ${disponible.toFixed(2)} ${UM}, intentando agregar ${pesoNuevo.toFixed(2)} ${UM}`,
    };
  }
  return { ok: true, disponible, pesoIngreso: Number(PesoIngreso), procesadoActual, UM };
}

function formatear(rows: any[]) {
  return rows.map(r => ({ ...r, PesajeId: Number(r.PesajeId), TransaccionId: Number(r.TransaccionId), TermoId: Number(r.TermoId), NumeroTermo: Number(r.NumeroTermo), Peso: Number(r.Peso) }));
}

const SELECT_PESAJE = `
  SELECT pd.PesajeId, pd.TransaccionId, pd.TermoId, t.NumeroTermo, pd.Codigo,
         CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido) AS NombreCompleto,
         pd.Peso, pd.UM, pd.FechaHora, pd.RegistradoPor
  FROM PesajeDetalle pd
  JOIN Empleados e ON pd.Codigo = e.Codigo
  JOIN Termos t ON pd.TermoId = t.TermoId
`;

// GET /api/pesaje?transaccion=ID
router.get("/", requireAuth, requirePerm("destajo", "ver"), async (req: Request, res: Response) => {
  try {
    const transaccionId = req.query.transaccion ? Number(req.query.transaccion) : undefined;
    if (!transaccionId) { res.status(400).json({ error: "transaccion es requerido" }); return; }
    const rows: any[] = await prisma.$queryRawUnsafe(
      `${SELECT_PESAJE} WHERE pd.TransaccionId = ? ORDER BY pd.PesajeId DESC`, transaccionId
    );
    res.json(formatear(rows));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pesaje  { TransaccionId, NumeroTermo, Codigo, Peso }
// El termo no se elige de una lista generada por el sistema: el operador escribe el número de termo
// que tiene físicamente enfrente. Si ese número no existe aún para esta transacción, se crea solo.
router.post("/", requireAuth, requirePerm("destajo", "crear"), async (req: Request, res: Response) => {
  try {
    const { TransaccionId, NumeroTermo, Codigo, Peso } = req.body;
    if (!TransaccionId || !NumeroTermo || !Codigo || Peso == null) {
      res.status(400).json({ error: "Transacción, Número de Termo, Código de empleado y Peso son requeridos" });
      return;
    }

    const empleados: any[] = await prisma.$queryRaw`
      SELECT Codigo, CONCAT_WS(' ', PrimerNombre, SegundoNombre, PrimerApellido, SegundoApellido) AS NombreCompleto, Estado
      FROM Empleados WHERE Codigo = ${Codigo} LIMIT 1
    `;
    if (!empleados.length) { res.status(404).json({ error: "Empleado no encontrado" }); return; }
    if (empleados[0].Estado !== "Activo") { res.status(400).json({ error: "Empleado no está activo" }); return; }

    // Solo puede pesar si su transferencia abierta más reciente lo ubica en Pelado y Devenado (DS) o Descabezado (DU)
    const areaActual: any[] = await prisma.$queryRaw`
      SELECT t.CodigoArea, a.Nombre AS NombreArea FROM Transferencias t
      JOIN Areas a ON t.CodigoArea = a.Codigo
      WHERE t.Codigo = ${Codigo} AND t.FechaSalida IS NULL
      ORDER BY t.FechaHora DESC LIMIT 1
    `;
    if (!areaActual.length || !["DS", "DU"].includes(areaActual[0].CodigoArea)) {
      res.status(400).json({
        error: "Debe darse transferencia en el área DS o DU",
        areaActual: areaActual.length ? { Codigo: areaActual[0].CodigoArea, Nombre: areaActual[0].NombreArea } : null,
      });
      return;
    }

    const operador = getOperador(req);

    const resultado = await prisma.$transaction(async (tx) => {
      const bloqueo = await bloquearTransaccionAbierta(tx, Number(TransaccionId));
      if ("error" in bloqueo) return bloqueo;

      const disponibilidad = await verificarDisponibilidad(tx, bloqueo.trans.Lote, Number(Peso));
      if (!disponibilidad.ok) return disponibilidad;

      const termoId = await resolverTermo(tx, Number(TransaccionId), Number(NumeroTermo), bloqueo.trans.AlmacenOrigen);

      await tx.$executeRaw`
        INSERT INTO PesajeDetalle (TransaccionId, TermoId, Codigo, Peso, RegistradoPor)
        VALUES (${Number(TransaccionId)}, ${Number(termoId)}, ${Codigo}, ${Number(Peso)}, ${operador})
      `;
      return { ok: true };
    });

    if (!("ok" in resultado) || !resultado.ok) {
      res.status((resultado as any).status || 400).json({ error: (resultado as any).error });
      return;
    }
    res.status(201).json({ ok: true, empleado: { Codigo: empleados[0].Codigo, NombreCompleto: empleados[0].NombreCompleto } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/pesaje/:id  { Peso, NumeroTermo }  (corrección de captura — solo peso y número de termo)
router.put("/:id", requireAuth, requirePerm("destajo", "editar"), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { Peso, NumeroTermo } = req.body;
    if (!NumeroTermo || Peso == null) { res.status(400).json({ error: "Número de Termo y Peso son requeridos" }); return; }

    const actual: any[] = await prisma.$queryRaw`SELECT TransaccionId FROM PesajeDetalle WHERE PesajeId = ${id} LIMIT 1`;
    if (!actual.length) { res.status(404).json({ error: "Pesaje no encontrado" }); return; }
    const transaccionId = Number(actual[0].TransaccionId);

    const resultado = await prisma.$transaction(async (tx) => {
      const bloqueo = await bloquearTransaccionAbierta(tx, transaccionId);
      if ("error" in bloqueo) return bloqueo;

      const disponibilidad = await verificarDisponibilidad(tx, bloqueo.trans.Lote, Number(Peso), id);
      if (!disponibilidad.ok) return disponibilidad;

      const termoId = await resolverTermo(tx, transaccionId, Number(NumeroTermo), bloqueo.trans.AlmacenOrigen);

      await tx.$executeRaw`UPDATE PesajeDetalle SET TermoId = ${Number(termoId)}, Peso = ${Number(Peso)} WHERE PesajeId = ${id}`;
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

// DELETE /api/pesaje/:id  (corrección de captura)
router.delete("/:id", requireAuth, requirePerm("destajo", "eliminar"), async (req: Request, res: Response) => {
  try {
    await prisma.$executeRaw`DELETE FROM PesajeDetalle WHERE PesajeId = ${Number(req.params.id)}`;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
