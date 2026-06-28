import { Router, Request, Response } from "express";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";

const router = Router();

function hoyGT(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
}

function primerDiaMes(): string {
  const hoy = hoyGT();
  return `${hoy.slice(0, 7)}-01`;
}

function numerizar(rows: any[], campos: string[]) {
  return rows.map(r => {
    const out = { ...r };
    for (const c of campos) out[c] = Number(out[c]);
    return out;
  });
}

// GET /api/reportes/produccion?desde=&hasta=&finca=
router.get("/produccion", requireAuth, requirePerm("destajo", "ver"), async (req: Request, res: Response) => {
  try {
    const desde = (req.query.desde as string) || primerDiaMes();
    const hasta = (req.query.hasta as string) || hoyGT();
    const finca = req.query.finca as string | undefined;

    const filtroFinca = finca ? "AND f.Codigo = ?" : "";
    const argsFinca = finca ? [finca] : [];

    const porLote: any[] = await prisma.$queryRawUnsafe(`
      SELECT l.Lote, f.Codigo AS CodigoFinca, f.Descripcion AS NombreFinca, l.Clase, c.Descripcion AS DescripcionClase,
             l.Fecha, l.PesoIngreso, l.UM,
             COALESCE((SELECT SUM(pd.Peso) FROM PesajeDetalle pd
                       JOIN TransaccionesProduccion tp ON pd.TransaccionId = tp.TransaccionId
                       WHERE tp.Lote = l.Lote), 0) AS Procesado,
             (SELECT COUNT(*) FROM TransaccionesProduccion tp WHERE tp.Lote = l.Lote) AS NumTransacciones
      FROM Lotes l
      JOIN Clase c ON l.Clase = c.Clase
      JOIN Piscina p ON l.PiscinaId = p.PiscinaId
      JOIN Finca f ON p.CodigoFinca = f.Codigo
      WHERE l.Fecha BETWEEN ? AND ? ${filtroFinca}
      ORDER BY l.Fecha DESC, l.Lote DESC
    `, desde, hasta, ...argsFinca);

    const porLoteTalla: any[] = await prisma.$queryRawUnsafe(`
      SELECT tp.Lote, tp.Talla, ta.Descripcion AS DescripcionTalla, tp.ClasePT, cl.Descripcion AS DescripcionClasePT,
             tp.Estado, COALESCE(SUM(pd.Peso), 0) AS Procesado, COUNT(pd.PesajeId) AS NumPesajes
      FROM TransaccionesProduccion tp
      JOIN Lotes l ON tp.Lote = l.Lote
      JOIN Piscina p ON l.PiscinaId = p.PiscinaId
      JOIN Finca f ON p.CodigoFinca = f.Codigo
      JOIN Tallas ta ON tp.Talla = ta.Codigo
      JOIN Clase cl ON tp.ClasePT = cl.Clase
      LEFT JOIN PesajeDetalle pd ON pd.TransaccionId = tp.TransaccionId
      WHERE l.Fecha BETWEEN ? AND ? ${filtroFinca}
      GROUP BY tp.TransaccionId
      ORDER BY tp.Lote DESC
    `, desde, hasta, ...argsFinca);

    const porTalla: any[] = await prisma.$queryRawUnsafe(`
      SELECT tp.Talla, ta.Descripcion AS DescripcionTalla,
             COALESCE(SUM(pd.Peso), 0) AS Procesado, COUNT(pd.PesajeId) AS NumPesajes
      FROM TransaccionesProduccion tp
      JOIN Lotes l ON tp.Lote = l.Lote
      JOIN Piscina p ON l.PiscinaId = p.PiscinaId
      JOIN Finca f ON p.CodigoFinca = f.Codigo
      JOIN Tallas ta ON tp.Talla = ta.Codigo
      LEFT JOIN PesajeDetalle pd ON pd.TransaccionId = tp.TransaccionId
      WHERE l.Fecha BETWEEN ? AND ? ${filtroFinca}
      GROUP BY tp.Talla
      ORDER BY Procesado DESC
    `, desde, hasta, ...argsFinca);

    const lotesFmt = numerizar(porLote, ["PesoIngreso", "Procesado", "NumTransacciones"])
      .map(l => ({ ...l, Pendiente: l.PesoIngreso - l.Procesado, Rendimiento: l.PesoIngreso > 0 ? (l.Procesado / l.PesoIngreso * 100) : 0 }));
    const detalleFmt = numerizar(porLoteTalla, ["Talla", "Procesado", "NumPesajes"]);
    const tallaFmt = numerizar(porTalla, ["Talla", "Procesado", "NumPesajes"]);

    const totales = lotesFmt.reduce((acc, l) => ({
      PesoIngreso: acc.PesoIngreso + l.PesoIngreso,
      Procesado: acc.Procesado + l.Procesado,
    }), { PesoIngreso: 0, Procesado: 0 });

    res.json({
      desde, hasta,
      porLote: lotesFmt,
      porLoteTalla: detalleFmt,
      porTalla: tallaFmt,
      totales: { ...totales, Pendiente: totales.PesoIngreso - totales.Procesado, Rendimiento: totales.PesoIngreso > 0 ? (totales.Procesado / totales.PesoIngreso * 100) : 0 },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
