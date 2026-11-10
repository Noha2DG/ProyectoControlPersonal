// Tratamiento (químico) — rutas de la hoja "TRATAMIENTO DE CAMARON". La lógica vive en
// lib/tratamiento.ts; acá solo se traduce HTTP y se abren las transacciones.
import { Router, Response } from "express";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm, AuthRequest } from "../middleware/auth.ts";
import { hoyGT } from "../lib/dateGT.ts";
import { auxiliaresDeHoja } from "./descongelado.ts";
import * as T from "../lib/tratamiento.ts";

const router = Router();

const operador = (req: AuthRequest) => (req.user as any)?.nombre ?? (req.user as any)?.username ?? "Sistema";

function fallo(res: Response, err: any) {
  if (err instanceof T.ErrorNegocio) { res.status(err.status).json({ error: err.message, ...(err.datos ?? {}) }); return; }
  if (String(err?.message ?? "").includes("foreign key")) { res.status(400).json({ error: "Clase, talla, cliente o bodega no existen" }); return; }
  res.status(500).json({ error: err?.message ?? "Error" });
}

const enTx = <R>(fn: (tx: any) => Promise<R>) => prisma.$transaction(fn, { maxWait: 10_000, timeout: 30_000 });

// ── Lecturas ────────────────────────────────────────────────────────────────────────────────────
router.get("/saldo", requireAuth, requirePerm("tratamiento", "ver"), async (_req, res) => {
  try { res.json(await T.saldoPiso(prisma)); } catch (e) { fallo(res, e); }
});

router.get("/catalogos", requireAuth, requirePerm("tratamiento", "ver"), async (_req, res) => {
  try {
    // El cliente de la hoja se escoge de los PEDIDOS ACTIVOS (Estatus 'Proceso'), no de todo el
    // catálogo: se trata para un pedido que está corriendo. Cada cliente trae sus pedidos para
    // reconocerlo (PESCANOVA → 2026-100 RED LOBSTER).
    const pedidos: any[] = await prisma.$queryRawUnsafe(`
      SELECT p.CodigoPedido, p.Descripcion, c.Codigo, c.RazonSocial
        FROM Pedidos p JOIN Clientes c ON c.Codigo = p.CodigoCliente
       WHERE p.Estatus = 'Proceso' AND c.Estatus = 'Activo'
       ORDER BY c.RazonSocial, p.FechaInicio DESC, p.CodigoPedido`);
    const clientes = new Map<number, { Codigo: number; RazonSocial: string; Pedidos: any[] }>();
    for (const p of pedidos) {
      const k = Number(p.Codigo);
      if (!clientes.has(k)) clientes.set(k, { Codigo: k, RazonSocial: p.RazonSocial, Pedidos: [] });
      clientes.get(k)!.Pedidos.push({ CodigoPedido: p.CodigoPedido, Descripcion: p.Descripcion });
    }
    res.json({
      Destinos: await T.destinos(prisma),
      Insumos: await T.insumos(prisma),
      Clientes: [...clientes.values()],
      PickupMaximo: T.PICKUP_MAXIMO,
    });
  } catch (e) { fallo(res, e); }
});

// El reporte es de la JORNADA, no de una hoja: todas las hojas del día y el cuadre del piso.
router.get("/reporte", requireAuth, requirePerm("tratamiento", "ver"), async (req, res) => {
  try { res.json(await T.reporteDia(prisma, String(req.query.fecha || hoyGT()))); } catch (e) { fallo(res, e); }
});

router.get("/hojas", requireAuth, requirePerm("tratamiento", "ver"), async (req, res) => {
  try { res.json(await T.listarHojas(prisma, String(req.query.fecha || hoyGT()))); } catch (e) { fallo(res, e); }
});

router.get("/hojas/:id", requireAuth, requirePerm("tratamiento", "ver"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const hoja = await T.detalleHoja(prisma, id);
    res.json({ ...hoja, Auxiliares: await auxiliaresDeHoja(prisma, id) });
  } catch (e) { fallo(res, e); }
});

// ── La hoja ─────────────────────────────────────────────────────────────────────────────────────
router.post("/hojas", requireAuth, requirePerm("tratamiento", "crear"), async (req: AuthRequest, res) => {
  try {
    const b = req.body ?? {};
    res.status(201).json(await enTx(tx => T.crearHoja(tx, {
      fecha: String(b.FechaProduccion || hoyGT()), cliente: b.ClienteCodigo,
      encargado: b.Encargado || null, horaInicio: b.HoraInicio || null, operador: operador(req),
    })));
  } catch (e) { fallo(res, e); }
});

router.put("/hojas/:id", requireAuth, requirePerm("tratamiento", "editar"), async (req, res) => {
  try {
    const b = req.body ?? {};
    res.json(await enTx(tx => T.editarHoja(tx, Number(req.params.id), {
      cliente: b.ClienteCodigo, encargado: b.Encargado, horaInicio: b.HoraInicio, observaciones: b.Observaciones,
    })));
  } catch (e) { fallo(res, e); }
});

router.delete("/hojas/:id", requireAuth, requirePerm("tratamiento", "eliminar"), async (req, res) => {
  try { res.json(await enTx(tx => T.eliminarHoja(tx, Number(req.params.id)))); } catch (e) { fallo(res, e); }
});

router.put("/hojas/:id/insumos", requireAuth, requirePerm("tratamiento", "editar"), async (req: AuthRequest, res) => {
  try {
    res.json(await enTx(tx => T.guardarInsumos(tx, Number(req.params.id), req.body?.Insumos ?? [], operador(req))));
  } catch (e) { fallo(res, e); }
});

// Las personas se cuentan al cerrar, del marcaje dentro de la ventana de la hoja —  igual que en
// Descongelado: nadie las teclea, es un dato que el sistema ya tiene.
router.post("/hojas/:id/cerrar", requireAuth, requirePerm("tratamiento", "cerrar"), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const horaFin = /^\d{2}:\d{2}$/.test(String(req.body?.HoraFin ?? "")) ? String(req.body.HoraFin) : null;
    const out = await enTx(async tx => {
      const gente = await auxiliaresDeHoja(tx, id, horaFin);
      return T.cerrarHoja(tx, id, {
        horaFin, terminar: Array.isArray(req.body?.Terminar) ? req.body.Terminar.map(String) : [],
        personas: gente?.Personas ?? null, operador: operador(req),
      });
    });
    res.json(out);
  } catch (e) { fallo(res, e); }
});

router.post("/hojas/:id/reabrir", requireAuth, requirePerm("tratamiento", "cerrar"), async (req, res) => {
  try { res.json(await enTx(tx => T.reabrirHoja(tx, Number(req.params.id)))); } catch (e) { fallo(res, e); }
});

// ── En lote ─────────────────────────────────────────────────────────────────────────────────────
// Marcar lo del piso y "Tratar": la hoja del cliente se abre sola (o se reutiliza la abierta).
router.post("/tratar", requireAuth, requirePerm("tratamiento", "crear"), async (req: AuthRequest, res) => {
  try {
    const b = req.body ?? {};
    res.status(201).json(await enTx(tx => T.tratarDelPiso(tx, {
      fecha: String(b.FechaProduccion || hoyGT()), cliente: b.ClienteCodigo, encargado: b.Encargado || null,
      horaInicio: b.HoraInicio || null, termos: b.Termos ?? [], operador: operador(req),
    })));
  } catch (e) { fallo(res, e); }
});

// Varios termos que salen juntos.
router.post("/salidas", requireAuth, requirePerm("tratamiento", "crear"), async (req: AuthRequest, res) => {
  try {
    const b = req.body ?? {};
    res.json(await enTx(tx => T.registrarSalidas(tx, {
      horaSalida: String(b.HoraSalida ?? ""), destino: String(b.BodegaDestino ?? ""), salidas: b.Salidas ?? [], operador: operador(req),
    })));
  } catch (e) { fallo(res, e); }
});

// ── Los termos ──────────────────────────────────────────────────────────────────────────────────
router.post("/hojas/:id/termos", requireAuth, requirePerm("tratamiento", "crear"), async (req: AuthRequest, res) => {
  try {
    res.status(201).json(await enTx(tx => T.registrarEntrada(tx, Number(req.params.id), req.body ?? {}, operador(req))));
  } catch (e) { fallo(res, e); }
});

router.put("/termos/:id", requireAuth, requirePerm("tratamiento", "editar"), async (req, res) => {
  try { res.json(await enTx(tx => T.editarEntrada(tx, Number(req.params.id), req.body ?? {}))); } catch (e) { fallo(res, e); }
});

router.put("/termos/:id/salida", requireAuth, requirePerm("tratamiento", "crear"), async (req: AuthRequest, res) => {
  try {
    res.json(await enTx(tx => T.registrarSalida(tx, Number(req.params.id), req.body ?? {}, operador(req))));
  } catch (e) { fallo(res, e); }
});

router.delete("/termos/:id/salida", requireAuth, requirePerm("tratamiento", "editar"), async (req, res) => {
  try { res.json(await enTx(tx => T.deshacerSalida(tx, Number(req.params.id)))); } catch (e) { fallo(res, e); }
});

router.delete("/termos/:id", requireAuth, requirePerm("tratamiento", "eliminar"), async (req, res) => {
  try { res.json(await enTx(tx => T.eliminarTermo(tx, Number(req.params.id)))); } catch (e) { fallo(res, e); }
});

export default router;
