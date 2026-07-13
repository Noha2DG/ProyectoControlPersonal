import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";
import { componerCodigoLote, piscinaRequiereCiclo } from "../lib/codigoLote.ts";

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

// Formato: <letraAño><díaSemanaISO><semanaISO><primeraParteDePiscina>-<segundaParteDePiscina>-<ciclo>
// ej. piscina "EM07-E01", martes (2) semana 27 de 2026 (G), ciclo 5 → G227EM07-E01-5
async function generarCodigoLote(piscinaId: number, fecha: string, cicloNumero?: number) {
  const piscinas: any[] = await prisma.$queryRaw`SELECT Nombre FROM Piscina WHERE PiscinaId = ${piscinaId} LIMIT 1`;
  if (!piscinas.length) return null;
  let secuencial: string;
  if (cicloNumero) {
    secuencial = String(cicloNumero);
  } else {
    const countRows: any[] = await prisma.$queryRaw`SELECT COUNT(*) AS n FROM Lotes WHERE Fecha = ${fecha}`;
    secuencial = String(Number(countRows[0].n) + 1);
  }
  return componerCodigoLote(String(piscinas[0].Nombre), fecha, secuencial);
}

function formatear(rows: any[]) {
  return rows.map(r => ({
    ...r,
    PesoIngreso: Number(r.PesoIngreso),
    Procesado: Number(r.Procesado),
    Pendiente: Number(r.PesoIngreso) - Number(r.Procesado),
    Activo: Number(r.Activo) === 1,
  }));
}

const SELECT_LOTES = `
  SELECT l.Lote, l.CicloId, l.PiscinaId, l.Clase, c.Descripcion AS DescripcionClase,
         l.TallaReferencia, t.Descripcion AS DescripcionTallaReferencia,
         l.Fecha, l.PesoIngreso, l.UM, l.AlmacenCodigo, l.Activo, l.RegistradoPor,
         f.Codigo AS CodigoFinca, f.Descripcion AS NombreFinca, p.Nombre AS NombrePiscina,
         ci.Anio, ci.Ciclo,
         COALESCE((SELECT SUM(pd.Peso) FROM PesajeDetalle pd
                   JOIN TransaccionesProduccion tp ON pd.TransaccionId = tp.TransaccionId
                   WHERE tp.Lote = l.Lote AND tp.ClaseOrigen = l.Clase), 0) AS Procesado
  FROM Lotes l
  JOIN Clase c ON l.Clase = c.Clase
  JOIN Piscina p ON l.PiscinaId = p.PiscinaId
  JOIN Finca f ON p.CodigoFinca = f.Codigo
  LEFT JOIN Ciclo ci ON l.CicloId = ci.CicloId
  LEFT JOIN Tallas t ON l.TallaReferencia = t.Codigo
`;

// GET /api/lotes?activo=1&fecha=YYYY-MM-DD
router.get("/", requireAuth, requirePerm("destajo", "ver"), async (req: Request, res: Response) => {
  try {
    const soloActivos = req.query.activo === "1";
    const fecha = req.query.fecha as string | undefined;
    const condiciones = [
      ...(soloActivos ? ["l.Activo = 1"] : []),
      ...(fecha ? ["l.Fecha = ?"] : []),
    ];
    const args = fecha ? [fecha] : [];
    const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
    const rows: any[] = await prisma.$queryRawUnsafe(
      `${SELECT_LOTES} ${where} ORDER BY l.Fecha DESC, l.Lote DESC LIMIT 500`, ...args
    );
    res.json(formatear(rows));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/lotes  { PiscinaId, CicloNumero?, Clase, TallaReferencia?, Fecha, PesoIngreso, UM }
// El código de Lote se genera automáticamente: AñoLetra+DíaSemana+Semana - Piscina - secuencial del día.
// CicloNumero es el número de ciclo (ej. 6). Si no existe para esa piscina+año, se crea automáticamente.
router.post("/", requireAuth, requirePerm("destajo", "crear"), async (req: Request, res: Response) => {
  try {
    const { PiscinaId, CicloNumero, Clase, TallaReferencia, Fecha, PesoIngreso, UM } = req.body;
    if (!PiscinaId || !Clase || !Fecha || !PesoIngreso) {
      res.status(400).json({ error: "Piscina, Clase, Fecha y Peso de ingreso son requeridos" });
      return;
    }

    // Los sifones, piscinas genéricas ("00-E00") y fincas proveedoras externas (Importación, Maquila,
    // Proveedores de Pescado) no son piscinas de cultivo real — nunca deben llevar ciclo, sin importar
    // lo que llegue en CicloNumero. Ver piscinaRequiereCiclo en lib/codigoLote.ts.
    const piscinaRows: any[] = await prisma.$queryRaw`SELECT Nombre, CodigoFinca FROM Piscina WHERE PiscinaId = ${Number(PiscinaId)} LIMIT 1`;
    if (!piscinaRows.length) { res.status(404).json({ error: "Piscina no encontrada" }); return; }
    const requiereCiclo = piscinaRequiereCiclo(String(piscinaRows[0].Nombre), String(piscinaRows[0].CodigoFinca));

    const cicloNum = (requiereCiclo && CicloNumero) ? Number(CicloNumero) : undefined;
    const lote = await generarCodigoLote(Number(PiscinaId), Fecha, cicloNum);
    if (!lote) { res.status(404).json({ error: "Piscina no encontrada" }); return; }

    let resolvedCicloId: number | null = null;
    if (cicloNum) {
      const anio = Number(Fecha.split("-")[0]);
      await prisma.$executeRaw`
        INSERT IGNORE INTO Ciclo (PiscinaId, Anio, Ciclo)
        VALUES (${Number(PiscinaId)}, ${anio}, ${cicloNum})
      `;
      const rows: any[] = await prisma.$queryRaw`
        SELECT CicloId FROM Ciclo
        WHERE PiscinaId = ${Number(PiscinaId)} AND Anio = ${anio} AND Ciclo = ${cicloNum}
        LIMIT 1
      `;
      resolvedCicloId = rows[0]?.CicloId ? Number(rows[0].CicloId) : null;
    }

    const operador = getOperador(req);
    await prisma.$executeRaw`
      INSERT INTO Lotes (Lote, CicloId, PiscinaId, Clase, TallaReferencia, Fecha, PesoIngreso, UM, RegistradoPor)
      VALUES (${lote}, ${resolvedCicloId}, ${Number(PiscinaId)}, ${Clase}, ${TallaReferencia ? Number(TallaReferencia) : null}, ${Fecha}, ${Number(PesoIngreso)}, ${UM || "KG"}, ${operador})
    `;
    res.status(201).json({ ok: true, Lote: lote });
  } catch (err: any) {
    if (err.message?.includes("Duplicate")) res.status(400).json({ error: "Ya existe un lote para esta piscina, ciclo, fecha y clase" });
    else if (err.message?.includes("foreign key")) res.status(400).json({ error: "Piscina, Clase o Talla no válidos" });
    else res.status(500).json({ error: err.message });
  }
});

// PUT /api/lotes/:lote/:clase  { PesoIngreso, Fecha, TallaReferencia?, Activo }
// El texto de Lote puede repetirse entre Clases del mismo Piscina+Ciclo+Fecha (ver
// project_destajo_lote_clase_en_codigo) — la fila real siempre se identifica por Lote+Clase juntos.
router.put("/:lote/:clase", requireAuth, requirePerm("destajo", "editar"), async (req: Request, res: Response) => {
  try {
    const { PesoIngreso, Fecha, TallaReferencia, Activo } = req.body;
    const lote = req.params.lote;
    const clase = req.params.clase;

    // No se puede dejar el peso de ingreso por debajo de lo que ese lote ya tiene procesado —
    // si no, el lote queda con Pendiente negativo y bloquea cualquier pesaje futuro sin explicación.
    const procesado: any[] = await prisma.$queryRaw`
      SELECT COALESCE(SUM(pd.Peso), 0) AS Procesado
      FROM PesajeDetalle pd JOIN TransaccionesProduccion tp ON pd.TransaccionId = tp.TransaccionId
      WHERE tp.Lote = ${lote} AND tp.ClaseOrigen = ${clase}
    `;
    const procesadoActual = Number(procesado[0].Procesado);
    if (Number(PesoIngreso) < procesadoActual) {
      res.status(400).json({ error: `El peso de ingreso no puede ser menor a lo ya procesado en este lote (${procesadoActual.toFixed(2)})` });
      return;
    }

    const activo = Activo === false || Activo === 0 ? 0 : 1;
    await prisma.$executeRaw`
      UPDATE Lotes SET PesoIngreso = ${Number(PesoIngreso)}, Fecha = ${Fecha}, TallaReferencia = ${TallaReferencia ? Number(TallaReferencia) : null}, Activo = ${activo}
      WHERE Lote = ${lote} AND Clase = ${clase}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/lotes/:lote/:clase  (solo si no tiene transacciones de producción registradas — corrección de error de captura)
router.delete("/:lote/:clase", requireAuth, requirePerm("destajo", "eliminar"), async (req: Request, res: Response) => {
  try {
    const lote = req.params.lote;
    const clase = req.params.clase;
    const trans: any[] = await prisma.$queryRaw`SELECT COUNT(*) AS n FROM TransaccionesProduccion WHERE Lote = ${lote} AND ClaseOrigen = ${clase}`;
    if (Number(trans[0].n) > 0) {
      res.status(400).json({ error: "No se puede eliminar: este lote ya tiene transacciones de producción registradas" });
      return;
    }
    await prisma.$executeRaw`DELETE FROM Lotes WHERE Lote = ${lote} AND Clase = ${clase}`;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
