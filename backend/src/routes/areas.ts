import { Router, Request, Response } from "express";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";

const router = Router();

// Grupo es texto libre (no hay catálogo de grupos), así que la normalización es lo único que impide
// que "TUNEL", " Tunel" y "TÚNEL " terminen siendo tres grupos distintos en un GROUP BY. Se guarda
// en MAYÚSCULAS y con espacios colapsados; vacío se guarda como NULL, no como "".
function normalizarGrupo(valor: unknown): string | null {
  const v = String(valor ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  return v || null;
}

// GET /api/areas  (público — kiosco lo necesita sin auth)
//
// Viaja también la bodega a la que pertenece el área. Sin eso, el selector de destino de una
// remisión ofrece las 74 áreas —  incluidas Baño, Cafetería y RRHH—  y bodega puede despachar
// producto a un lugar donde no hay dónde ponerlo. Quien tiene bodega es un destino real; quien no,
// es un lugar donde la gente marca pero el camarón no pasa.
router.get("/", async (_req: Request, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT a.Codigo, a.Nombre, a.Grupo, a.FormaPago, a.Activa,
             a.BodegaVirtualCodigo, b.Nombre AS NombreBodega, b.Orden AS OrdenBodega, b.LlevaPiso
      FROM Areas a
      LEFT JOIN BodegaVirtual b ON b.Codigo = a.BodegaVirtualCodigo
      ORDER BY a.Nombre ASC
    `;
    res.json(rows.map(r => ({
      ...r, Activa: Number(r.Activa) === 1,
      LlevaPiso: r.LlevaPiso == null ? null : Number(r.LlevaPiso) === 1,
      OrdenBodega: r.OrdenBodega == null ? null : Number(r.OrdenBodega),
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/areas
router.post("/", requireAuth, requirePerm("areas", "crear"), async (req: Request, res: Response) => {
  try {
    const { Codigo, Nombre, Grupo, FormaPago, BodegaVirtualCodigo } = req.body;
    if (!Codigo || !Nombre) { res.status(400).json({ error: "Código y Nombre son requeridos" }); return; }
    await prisma.$executeRaw`
      INSERT INTO Areas (Codigo, Nombre, Grupo, FormaPago, BodegaVirtualCodigo)
      VALUES (${Codigo.toUpperCase()}, ${Nombre}, ${normalizarGrupo(Grupo)}, ${FormaPago || null},
              ${BodegaVirtualCodigo || null})
    `;
    res.status(201).json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/areas/:codigo
router.put("/:codigo", requireAuth, requirePerm("areas", "editar"), async (req: Request, res: Response) => {
  try {
    const codigo = req.params.codigo;
    const { Nombre, Grupo, FormaPago, Activa, BodegaVirtualCodigo } = req.body;
    const activa = Activa === false || Activa === 0 ? 0 : 1;
    await prisma.$executeRaw`
      UPDATE Areas SET Nombre = ${Nombre}, Grupo = ${normalizarGrupo(Grupo)},
                       FormaPago = ${FormaPago || null}, Activa = ${activa},
                       BodegaVirtualCodigo = ${BodegaVirtualCodigo || null}
      WHERE Codigo = ${codigo}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/areas/:codigo → desactivar lógico
router.delete("/:codigo", requireAuth, requirePerm("areas", "eliminar"), async (req: Request, res: Response) => {
  try {
    const codigo = req.params.codigo;
    await prisma.$executeRaw`UPDATE Areas SET Activa = 0 WHERE Codigo = ${codigo}`;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
