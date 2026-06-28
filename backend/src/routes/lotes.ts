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

// Número de semana ISO-8601 y día de semana ISO (lunes=1...domingo=7) de una fecha "YYYY-MM-DD".
// Se usa Date.UTC para evitar corrimientos de zona horaria.
function isoSemana(fecha: string) {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const date = new Date(Date.UTC(anio, mes - 1, dia));
  const diaSemanaISO = date.getUTCDay() || 7;
  const jueves = new Date(date);
  jueves.setUTCDate(date.getUTCDate() + 4 - diaSemanaISO);
  const inicioAnio = new Date(Date.UTC(jueves.getUTCFullYear(), 0, 1));
  const semana = Math.ceil((((jueves.getTime() - inicioAnio.getTime()) / 86400000) + 1) / 7);
  return { diaSemanaISO, semana };
}

// Letra de año (A=2020, B=2021... G=2026) + día de semana ISO + semana ISO (2 dígitos).
function segmentoFecha(fecha: string) {
  const [anio] = fecha.split("-").map(Number);
  const letra = String.fromCharCode(65 + (anio - 2020));
  const { diaSemanaISO, semana } = isoSemana(fecha);
  return `${letra}${diaSemanaISO}${String(semana).padStart(2, "0")}`;
}

// Formato: <letraAño><díaSemanaISO><semanaISO><primeraParteDePiscina>-<segundaParteDePiscina>-<secuencial>
// ej. piscina "EM07-E01", jueves (4) de la semana ISO 26 de 2026 (G), 1er lote del día → G426EM07-E01-1
async function generarCodigoLote(piscinaId: number, fecha: string) {
  const piscinas: any[] = await prisma.$queryRaw`SELECT Nombre FROM Piscina WHERE PiscinaId = ${piscinaId} LIMIT 1`;
  if (!piscinas.length) return null;
  const [parte1, parte2] = String(piscinas[0].Nombre).split("-");
  const countRows: any[] = await prisma.$queryRaw`SELECT COUNT(*) AS n FROM Lotes WHERE Fecha = ${fecha}`;
  const secuencial = String(Number(countRows[0].n) + 1);
  return [`${segmentoFecha(fecha)}${parte1}`, parte2, secuencial].filter(Boolean).join("-");
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
         l.Fecha, l.PesoIngreso, l.UM, l.AlmacenCodigo, l.Activo, l.RegistradoPor,
         f.Codigo AS CodigoFinca, f.Descripcion AS NombreFinca, p.Nombre AS NombrePiscina,
         ci.Anio, ci.Ciclo,
         COALESCE((SELECT SUM(pd.Peso) FROM PesajeDetalle pd
                   JOIN TransaccionesProduccion tp ON pd.TransaccionId = tp.TransaccionId
                   WHERE tp.Lote = l.Lote), 0) AS Procesado
  FROM Lotes l
  JOIN Clase c ON l.Clase = c.Clase
  JOIN Piscina p ON l.PiscinaId = p.PiscinaId
  JOIN Finca f ON p.CodigoFinca = f.Codigo
  LEFT JOIN Ciclo ci ON l.CicloId = ci.CicloId
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

// POST /api/lotes  { PiscinaId, CicloId?, Clase, Fecha, PesoIngreso, UM, AlmacenCodigo }
// El código de Lote se genera automáticamente: AñoLetra+DíaSemana+Semana - Piscina - secuencial del día.
// CicloId es opcional: Maquila, Importación y Proveedores de Pescado no manejan ciclo de cosecha.
router.post("/", requireAuth, requirePerm("destajo", "crear"), async (req: Request, res: Response) => {
  try {
    const { PiscinaId, CicloId, Clase, Fecha, PesoIngreso, UM, AlmacenCodigo } = req.body;
    if (!PiscinaId || !Clase || !Fecha || !PesoIngreso || !AlmacenCodigo) {
      res.status(400).json({ error: "Piscina, Clase, Fecha, Peso de ingreso y Almacén son requeridos" });
      return;
    }
    const lote = await generarCodigoLote(Number(PiscinaId), Fecha);
    if (!lote) { res.status(404).json({ error: "Piscina no encontrada" }); return; }

    const operador = getOperador(req);
    await prisma.$executeRaw`
      INSERT INTO Lotes (Lote, CicloId, PiscinaId, Clase, Fecha, PesoIngreso, UM, AlmacenCodigo, RegistradoPor)
      VALUES (${lote}, ${CicloId ? Number(CicloId) : null}, ${Number(PiscinaId)}, ${Clase}, ${Fecha}, ${Number(PesoIngreso)}, ${UM || "KG"}, ${AlmacenCodigo}, ${operador})
    `;
    res.status(201).json({ ok: true, Lote: lote });
  } catch (err: any) {
    if (err.message?.includes("Duplicate")) res.status(400).json({ error: "Ya existe un lote con ese código generado, intente nuevamente" });
    else if (err.message?.includes("foreign key")) res.status(400).json({ error: "Piscina, Ciclo, Clase o Almacén no existen" });
    else res.status(500).json({ error: err.message });
  }
});

// PUT /api/lotes/:lote  { PesoIngreso, Fecha, AlmacenCodigo, Activo }
router.put("/:lote", requireAuth, requirePerm("destajo", "editar"), async (req: Request, res: Response) => {
  try {
    const { PesoIngreso, Fecha, AlmacenCodigo, Activo } = req.body;
    const lote = req.params.lote;

    // No se puede dejar el peso de ingreso por debajo de lo que ese lote ya tiene procesado —
    // si no, el lote queda con Pendiente negativo y bloquea cualquier pesaje futuro sin explicación.
    const procesado: any[] = await prisma.$queryRaw`
      SELECT COALESCE(SUM(pd.Peso), 0) AS Procesado
      FROM PesajeDetalle pd JOIN TransaccionesProduccion tp ON pd.TransaccionId = tp.TransaccionId
      WHERE tp.Lote = ${lote}
    `;
    const procesadoActual = Number(procesado[0].Procesado);
    if (Number(PesoIngreso) < procesadoActual) {
      res.status(400).json({ error: `El peso de ingreso no puede ser menor a lo ya procesado en este lote (${procesadoActual.toFixed(2)})` });
      return;
    }

    const activo = Activo === false || Activo === 0 ? 0 : 1;
    await prisma.$executeRaw`
      UPDATE Lotes SET PesoIngreso = ${Number(PesoIngreso)}, Fecha = ${Fecha}, AlmacenCodigo = ${AlmacenCodigo}, Activo = ${activo}
      WHERE Lote = ${lote}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/lotes/:lote  (solo si no tiene transacciones de producción registradas — corrección de error de captura)
router.delete("/:lote", requireAuth, requirePerm("destajo", "eliminar"), async (req: Request, res: Response) => {
  try {
    const lote = req.params.lote;
    const trans: any[] = await prisma.$queryRaw`SELECT COUNT(*) AS n FROM TransaccionesProduccion WHERE Lote = ${lote}`;
    if (Number(trans[0].n) > 0) {
      res.status(400).json({ error: "No se puede eliminar: este lote ya tiene transacciones de producción registradas" });
      return;
    }
    await prisma.$executeRaw`DELETE FROM Lotes WHERE Lote = ${lote}`;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
