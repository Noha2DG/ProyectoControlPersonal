import { Router, Response } from "express";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm, AuthRequest } from "../middleware/auth.ts";
import { panoramaPlanta, ritmoPlanta } from "../lib/panoramaPlanta.ts";

const router = Router();

function hoyGT(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
}

// La pantalla de Reportes se refresca sola cada 2 min y puede estar abierta en varias computadoras:
// el resultado se guarda por fecha y las peticiones simultáneas comparten la misma consulta (mismo
// criterio que /reportes/ranking-produccion). La base está en otro servidor y se mide CPU.
// Un día ya cerrado no cambia: se guarda 10 min. El de hoy, 1 min.
const CACHE_HOY_MS = 60_000, CACHE_PASADO_MS = 600_000;
type Entrada = { en: number; datos?: any; vuelo?: Promise<any> };

function conCache(cache: Map<string, Entrada>, calcular: (fecha: string) => Promise<any>) {
  return async (req: AuthRequest, res: Response) => {
    try {
      const fecha = String(req.query.fecha || hoyGT());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { res.status(400).json({ error: "Fecha inválida" }); return; }
      const c = cache.get(fecha);
      if (c?.datos && Date.now() - c.en < (fecha < hoyGT() ? CACHE_PASADO_MS : CACHE_HOY_MS)) { res.json(c.datos); return; }
      if (c?.vuelo) { res.json(await c.vuelo); return; }
      const vuelo = calcular(fecha).then(datos => {
        const conHora = { ...datos, Actualizado: new Date().toLocaleTimeString("es-GT", { timeZone: "America/Guatemala", hour: "2-digit", minute: "2-digit", hour12: false }) };
        cache.set(fecha, { en: Date.now(), datos: conHora });
        return conHora;
      }).catch(err => { cache.delete(fecha); throw err; });
      cache.set(fecha, { en: 0, vuelo });
      res.json(await vuelo);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
}

// GET /api/gerencia/panorama?fecha=YYYY-MM-DD — flujo entre áreas, números de cada área y piso.
router.get("/panorama", requireAuth, requirePerm("gerencia", "ver"),
  conCache(new Map(), fecha => panoramaPlanta(prisma, fecha)));

// GET /api/gerencia/panorama/ritmo?fecha=YYYY-MM-DD — lb/hr de las peladoras por día. Aparte porque es
// lo más pesado: la pantalla muestra primero el panorama y lo pide después.
router.get("/panorama/ritmo", requireAuth, requirePerm("gerencia", "ver"),
  conCache(new Map(), fecha => ritmoPlanta(prisma, fecha)));

export default router;
