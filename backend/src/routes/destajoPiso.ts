// Materia Prima tomada del inventario al piso: tomar, unificar, bajar al piso y descarte.
// La lógica vive en lib/destajoPiso.ts; acá solo se traduce HTTP.
import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";
import { hoyGT } from "../lib/dateGT.ts";
import {
  BODEGAS_CON_DESTAJO, ErrorNegocio, saldoParaDestajo, tomarDelPiso, bajarAlPiso, registrarDescarte,
  movimientosDeLote, deshacerMovimiento, cuadreLote, devolverLoteAlPiso, registrarCola, infoCierre,
} from "../lib/destajoPiso.ts";

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

function responderError(res: Response, err: any) {
  if (err instanceof ErrorNegocio) res.status(err.status).json({ error: err.message });
  else if (err.message?.includes("foreign key")) res.status(400).json({ error: "Clase, talla o bodega no existen" });
  else res.status(500).json({ error: err.message });
}

// Escrituras de varias filas contra una base al otro lado de la red: el valor por omisión de Prisma
// (5 s) es para una o dos escrituras.
const TX = { timeout: 30000, maxWait: 15000 };

// GET /api/destajo-piso/bodegas — los pisos que alimentan Destajo (Pelado, Descabezado).
router.get("/bodegas", requireAuth, requirePerm("destajo", "ver"), async (_req: Request, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT Codigo, Nombre FROM BodegaVirtual WHERE Activo = 1 AND Codigo IN (${BODEGAS_CON_DESTAJO.map(() => "?").join(",")})
        ORDER BY Orden, Nombre`, ...BODEGAS_CON_DESTAJO);
    res.json(rows);
  } catch (err: any) {
    responderError(res, err);
  }
});

// GET /api/destajo-piso/saldo?bodega=PELADO — lo que hay al piso, con el lote de Destajo que tocaría hoy.
router.get("/saldo", requireAuth, requirePerm("destajo", "ver"), async (req: Request, res: Response) => {
  try {
    res.json(await saldoParaDestajo(prisma, String(req.query.bodega ?? ""), hoyGT()));
  } catch (err: any) {
    responderError(res, err);
  }
});

// POST /api/destajo-piso/tomar  { Bodega, Unificar, BaseLote?, Lineas: [{ RemisionId, Lote, Clase, Talla, FechaLote, Kg, PiscinaId?, Ciclo? }] }
// BaseLote: al unificar, el lote de origen (entre los marcados) que da el código. Obligatorio al unificar.
router.post("/tomar", requireAuth, requirePerm("destajo", "crear"), async (req: Request, res: Response) => {
  try {
    const lineas = Array.isArray(req.body.Lineas) ? req.body.Lineas : [];
    const out = await prisma.$transaction(tx => tomarDelPiso(tx, {
      bodega: String(req.body.Bodega ?? ""), lineas, unificar: !!req.body.Unificar,
      baseLote: req.body.BaseLote ? String(req.body.BaseLote) : null,
      fecha: hoyGT(), operador: getOperador(req),
    }), TX);
    res.status(201).json(out);
  } catch (err: any) {
    responderError(res, err);
  }
});

// GET /api/destajo-piso/lote/:lote/:clase — cuadre y movimientos del piso de un lote.
router.get("/lote/:lote/:clase", requireAuth, requirePerm("destajo", "ver"), async (req: Request, res: Response) => {
  try {
    const lote = String(req.params.lote), clase = String(req.params.clase);
    const cuadre = await cuadreLote(prisma, lote, clase);
    res.json({ ...cuadre, Movimientos: await movimientosDeLote(prisma, lote, clase) });
  } catch (err: any) {
    responderError(res, err);
  }
});

// POST /api/destajo-piso/lote/:lote/:clase/bajar  { Peso, Motivo: "Sobrante" | "Rojo", Talla?, Bodega?, Nota? }
router.post("/lote/:lote/:clase/bajar", requireAuth, requirePerm("destajo", "editar"), async (req: Request, res: Response) => {
  try {
    const out = await prisma.$transaction(tx => bajarAlPiso(tx, {
      lote: String(req.params.lote), clase: String(req.params.clase), peso: Number(req.body.Peso),
      talla: req.body.Talla ? Number(req.body.Talla) : null, bodega: req.body.Bodega || null,
      motivo: req.body.Motivo || null, nota: req.body.Nota || null, fecha: hoyGT(), operador: getOperador(req),
    }), TX);
    res.status(201).json(out);
  } catch (err: any) {
    responderError(res, err);
  }
});

// POST /api/destajo-piso/lote/:lote/:clase/descarte  { Peso, Talla?, Motivo, Nota? }
router.post("/lote/:lote/:clase/descarte", requireAuth, requirePerm("destajo", "editar"), async (req: Request, res: Response) => {
  try {
    const out = await prisma.$transaction(tx => registrarDescarte(tx, {
      lote: String(req.params.lote), clase: String(req.params.clase), peso: Number(req.body.Peso),
      talla: req.body.Talla ? Number(req.body.Talla) : null, motivo: req.body.Motivo || null,
      nota: req.body.Nota || null, fecha: hoyGT(), operador: getOperador(req),
    }), TX);
    res.status(201).json(out);
  } catch (err: any) {
    responderError(res, err);
  }
});

// POST /api/destajo-piso/lote/:lote/:clase/cola  { Peso, NumeroTermo, ClaseCola, Talla? }
// Un termo de cola de un lote entero: entra al piso de Pelado.
router.post("/lote/:lote/:clase/cola", requireAuth, requirePerm("destajo", "editar"), async (req: Request, res: Response) => {
  try {
    const out = await prisma.$transaction(tx => registrarCola(tx, {
      lote: String(req.params.lote), clase: String(req.params.clase), peso: Number(req.body.Peso),
      termo: String(req.body.NumeroTermo ?? ""), claseCola: String(req.body.ClaseCola ?? ""),
      talla: req.body.Talla ? Number(req.body.Talla) : null, fecha: hoyGT(), operador: getOperador(req),
    }), TX);
    res.status(201).json(out);
  } catch (err: any) {
    responderError(res, err);
  }
});

// POST /api/destajo-piso/lote/:lote/:clase/devolver — el lote completo regresa al piso y desaparece.
// Reemplaza a "Eliminar" para los lotes tomados del piso.
router.post("/lote/:lote/:clase/devolver", requireAuth, requirePerm("destajo", "editar"), async (req: Request, res: Response) => {
  try {
    res.json(await prisma.$transaction(tx => devolverLoteAlPiso(tx, String(req.params.lote), String(req.params.clase)), TX));
  } catch (err: any) {
    responderError(res, err);
  }
});

// GET /api/destajo-piso/transaccion/:id/cierre — qué se traslada al cerrarla y a qué pisos puede ir.
router.get("/transaccion/:id/cierre", requireAuth, requirePerm("destajo", "ver"), async (req: Request, res: Response) => {
  try {
    res.json(await infoCierre(prisma, Number(req.params.id)));
  } catch (err: any) {
    responderError(res, err);
  }
});

// DELETE /api/destajo-piso/movimiento/:id — deshacer una toma, un bajado o un descarte.
router.delete("/movimiento/:id", requireAuth, requirePerm("destajo", "editar"), async (req: Request, res: Response) => {
  try {
    res.json(await prisma.$transaction(tx => deshacerMovimiento(tx, Number(req.params.id)), TX));
  } catch (err: any) {
    responderError(res, err);
  }
});

export default router;
