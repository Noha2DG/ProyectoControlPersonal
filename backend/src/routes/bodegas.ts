import { Router, Request, Response } from "express";
import prisma from "../lib/prisma.ts";

const router = Router();

// GET /api/bodegas — el catálogo único de bodegas. Antes estaba partido en dos tablas que
// respondían la misma pregunta: BodegaVirtual (el prefijo del código de polín) y BodegaProceso
// (dónde se para el producto en el flujo). Ver scripts/fusionarBodegas.ts.
//
// ?generan=1 devuelve solo las que generan correlativo de polín — las que tienen Letra. Es lo que
// necesita el selector de "Nuevo pallet": Descongelado o un Blast son bodegas reales pero no
// producen polines, y ofrecerlas ahí sería ofrecer un código que no se puede formar.
router.get("/", async (req: Request, res: Response) => {
  try {
    const soloGeneran = String(req.query.generan ?? "") === "1";
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT Codigo, Nombre, Letra, Orden, LlevaPiso, Activo
        FROM BodegaVirtual
       ${soloGeneran ? "WHERE Letra IS NOT NULL" : ""}
       ORDER BY Orden, Nombre
    `);
    res.json(rows.map(r => ({
      ...r,
      LlevaPiso: Number(r.LlevaPiso) === 1,
      Activo: Number(r.Activo) === 1,
      // El frontend viejo leía AreaCodigo como el valor del selector. Ya no existe esa columna —
      // la bodega ES el destino— pero se manda el código para que una pestaña sin recargar no
      // mande un value vacío.
      AreaCodigo: r.Codigo,
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
