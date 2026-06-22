import { Router, Request, Response } from "express";
import prisma from "./prisma.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";

interface CampoExtra {
  columna: string;
  requerido?: boolean;
}

interface CatalogoOpts {
  tabla: string;
  pk: string;
  pkEsNumero?: boolean;
  camposExtra?: CampoExtra[];
  orderBy?: string;
}

// Factory para catálogos simples (Código + Descripción [+ campos extra] + Activo).
// tabla/pk/camposExtra vienen siempre de config fija en el código (no de input del usuario),
// por eso es seguro interpolarlos en el SQL; los valores siempre van parametrizados.
export function crearCatalogoRouter(opts: CatalogoOpts) {
  const router = Router();
  const { tabla, pk, camposExtra = [], orderBy = "Descripcion" } = opts;
  const columnasExtra = camposExtra.map(c => c.columna);
  const columnas = [pk, "Descripcion", ...columnasExtra, "Activo"];

  function parsePk(raw: string) {
    return opts.pkEsNumero ? Number(raw) : raw;
  }

  // GET /api/<recurso>  (público — lo usan pantallas de captura para llenar combos)
  router.get("/", async (_req: Request, res: Response) => {
    try {
      const sql = `SELECT ${columnas.join(", ")} FROM ${tabla} ORDER BY ${orderBy} ASC`;
      const rows: any[] = await prisma.$queryRawUnsafe(sql);
      res.json(rows.map(r => ({ ...r, Activo: Number(r.Activo) === 1 })));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/<recurso>
  router.post("/", requireAuth, requirePerm("catalogos", "crear"), async (req: Request, res: Response) => {
    try {
      const body = req.body;
      if (!body[pk] || !body.Descripcion) {
        res.status(400).json({ error: `${pk} y Descripcion son requeridos` });
        return;
      }
      for (const c of camposExtra) {
        if (c.requerido && !body[c.columna]) {
          res.status(400).json({ error: `${c.columna} es requerido` });
          return;
        }
      }
      const valores = [parsePk(String(body[pk])), body.Descripcion, ...columnasExtra.map(c => body[c] ?? null)];
      const placeholders = columnas.slice(0, -1).map(() => "?").join(", ");
      const sql = `INSERT INTO ${tabla} (${columnas.slice(0, -1).join(", ")}) VALUES (${placeholders})`;
      await prisma.$executeRawUnsafe(sql, ...valores);
      res.status(201).json({ ok: true });
    } catch (err: any) {
      if (err.message?.includes("Duplicate")) res.status(400).json({ error: "Ese código ya existe" });
      else res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/<recurso>/:codigo
  router.put("/:codigo", requireAuth, requirePerm("catalogos", "editar"), async (req: Request, res: Response) => {
    try {
      const codigo = parsePk(req.params.codigo);
      const body = req.body;
      const activo = body.Activo === false || body.Activo === 0 ? 0 : 1;
      const sets = ["Descripcion = ?", ...columnasExtra.map(c => `${c} = ?`), "Activo = ?"];
      const valores = [body.Descripcion, ...columnasExtra.map(c => body[c] ?? null), activo, codigo];
      const sql = `UPDATE ${tabla} SET ${sets.join(", ")} WHERE ${pk} = ?`;
      await prisma.$executeRawUnsafe(sql, ...valores);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/<recurso>/:codigo → baja lógica (Activo = 0)
  router.delete("/:codigo", requireAuth, requirePerm("catalogos", "eliminar"), async (req: Request, res: Response) => {
    try {
      const codigo = parsePk(req.params.codigo);
      const sql = `UPDATE ${tabla} SET Activo = 0 WHERE ${pk} = ?`;
      await prisma.$executeRawUnsafe(sql, codigo);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
