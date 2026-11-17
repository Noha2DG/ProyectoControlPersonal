import { Router, Request, Response } from "express";
import crypto from "crypto";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm, requireAnyPerm, AuthRequest } from "../middleware/auth.ts";
import { validarEmpaque } from "../lib/empaquePesaje.ts";

// Básculas de empaque (ver scripts/createBalanzas.ts).
//
// Dos clases de cliente:
//   - el CABEZAL (app Báscula Puente): POST /latido con su token en X-Balanza-Token. No usa JWT:
//     la app no tiene usuario, y su token se revoca regenerándolo o desactivando la báscula.
//   - la PANTALLA de configuración: el resto de rutas, con sesión y permiso `basculas`.
//
// Las horas se comparan en SQL (NOW() del servidor de base): la hora del cabezal no es confiable (lo
// vimos con −07:00) y un DATETIME pasado por new Date() en Node se corre de zona.

const router = Router();

/** Sin aviso en este tiempo la báscula se da por fuera de línea. La app avisa cada 30 s. */
const SEG_EN_LINEA = 120;
/** Un comando que nadie recogió en este tiempo ya no se entrega: reiniciar a deshoras confunde. */
const MIN_VIGENCIA_COMANDO = 15;

const CODIGO_OK = /^[A-Z0-9_-]{1,20}$/;
const MODOS = ["PERSONA", "PRODUCTO"];

// Lo que la app sabe ejecutar. Validar aquí evita encolar algo que la app ignoraría en silencio.
const TIPOS: Record<string, (d: any) => any> = {
  REINICIAR_LECTOR: () => null,
  REINICIAR_SERVICIO: () => null,
  VER_TRAMAS: () => null,
  BITACORA: () => null,
  RECARGAR_PAGINA: () => null,
  CERRAR_SESION: () => null,
  PARAMETROS: (d) => {
    const muestras = Number(d?.muestras), tolerancia = Number(d?.tolerancia);
    if (!Number.isInteger(muestras) || muestras < 2 || muestras > 20) throw new Error("Lecturas para estable: entero de 2 a 20");
    if (!Number.isInteger(tolerancia) || tolerancia < 0 || tolerancia > 50) throw new Error("Tolerancia: entero de 0 a 50 g");
    return { muestras, tolerancia };
  },
  PRUEBA_PESO: (d) => {
    const patronG = Number(d?.patronG);
    if (!Number.isInteger(patronG) || patronG < 1 || patronG > 100000) throw new Error("Peso patrón: entero en gramos");
    return { patronG };
  },
};

const hash = (token: string) => crypto.createHash("sha256").update(token, "utf8").digest("hex");
const nuevoToken = () => crypto.randomBytes(24).toString("base64url");
const texto = (v: any, max: number) => (v === undefined || v === null ? null : String(v).slice(0, max));
const entero = (v: any) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);

function mismoHash(a: string, b: string) {
  const x = Buffer.from(a, "hex"), y = Buffer.from(b, "hex");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ─── Cabezal ─────────────────────────────────────────────────────────────────────────────────

// POST /api/balanzas/latido — el cabezal avisa que sigue vivo, entrega resultados de comandos y
// recoge los nuevos. Responde siempre rápido: es lo único que el cabezal hace contra el servidor.
router.post("/latido", async (req: Request, res: Response) => {
  try {
    const token = String(req.header("X-Balanza-Token") ?? "");
    const codigo = String(req.body?.codigo ?? "").trim().toUpperCase();
    if (!token || !CODIGO_OK.test(codigo)) { res.status(401).json({ error: "Báscula o token faltante" }); return; }

    const [b]: any[] = await prisma.$queryRaw`
      SELECT Codigo, TokenHash, Activa FROM Balanza WHERE Codigo = ${codigo} LIMIT 1`;
    if (!b || !b.TokenHash || !mismoHash(b.TokenHash, hash(token))) {
      res.status(401).json({ error: "Token inválido para " + codigo }); return;
    }
    if (Number(b.Activa) !== 1) { res.status(403).json({ error: `${codigo} está desactivada` }); return; }

    const d = req.body ?? {};
    const resultados: any[] = Array.isArray(d.resultados) ? d.resultados.slice(0, 20) : [];

    const comandos = await prisma.$transaction(async (tx) => {
      for (const r of resultados) {
        const id = entero(r?.id);
        if (!id) continue;
        const resultado = typeof r.resultado === "string" ? r.resultado : JSON.stringify(r.resultado ?? null);
        await tx.$executeRaw`
          UPDATE BalanzaComando
             SET Estado = ${r.ok ? "OK" : "ERROR"}, Resultado = ${resultado.slice(0, 60000)}, TerminadoEn = NOW()
           WHERE ComandoId = ${id} AND BalanzaCodigo = ${codigo} AND Estado = 'ENTREGADO'`;
      }

      await tx.$executeRaw`
        UPDATE Balanza
           SET UltimoContacto = NOW(),
               EstadoPuerto = ${texto(d.estadoPuerto, 20)},
               DetallePuerto = ${texto(d.detalle, 255)},
               UltimoPesoG = ${entero(d.gramos)},
               Estable = ${d.estable === undefined ? null : (d.estable ? 1 : 0)},
               PaginasConectadas = ${entero(d.paginas)},
               VersionApp = ${texto(d.version, 20)},
               IpLocal = ${texto(d.ip, 45)},
               Equipo = ${texto(d.equipo, 100)},
               EncendidoSeg = ${entero(d.encendidoSeg)},
               Parametros = ${d.parametros ? JSON.stringify(d.parametros).slice(0, 255) : null}
         WHERE Codigo = ${codigo}`;

      await tx.$executeRaw`
        UPDATE BalanzaComando SET Estado = 'VENCIDO', TerminadoEn = NOW()
         WHERE BalanzaCodigo = ${codigo} AND Estado = 'PENDIENTE'
           AND CreadoEn < NOW() - INTERVAL ${MIN_VIGENCIA_COMANDO} MINUTE`;

      const pendientes: any[] = await tx.$queryRaw`
        SELECT ComandoId, Tipo, Datos FROM BalanzaComando
         WHERE BalanzaCodigo = ${codigo} AND Estado = 'PENDIENTE'
         ORDER BY ComandoId LIMIT 10 FOR UPDATE`;
      for (const p of pendientes) {
        await tx.$executeRaw`
          UPDATE BalanzaComando SET Estado = 'ENTREGADO', EntregadoEn = NOW() WHERE ComandoId = ${p.ComandoId}`;
      }
      return pendientes.map(p => ({ id: p.ComandoId, tipo: p.Tipo, datos: p.Datos ? JSON.parse(p.Datos) : null }));
    });

    res.json({ ok: true, comandos });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Pantalla de configuración ───────────────────────────────────────────────────────────────

// GET /api/balanzas — todas, con su estado de conexión calculado en la base.
router.get("/", requireAuth, requirePerm("basculas", "ver"), async (_req: AuthRequest, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT b.Codigo, b.Nombre, b.BodegaVirtualCodigo, bv.Nombre AS BodegaNombre, b.Modo, b.Activa,
             b.EstadoPuerto, b.DetallePuerto, b.UltimoPesoG, b.Estable, b.PaginasConectadas,
             b.VersionApp, b.IpLocal, b.Equipo, b.EncendidoSeg, b.Parametros,
             DATE_FORMAT(b.UltimoContacto, '%Y-%m-%d %H:%i:%s') AS UltimoContacto,
             TIMESTAMPDIFF(SECOND, b.UltimoContacto, NOW()) AS SegSinContacto,
             (b.TokenHash IS NOT NULL) AS TieneToken,
             (SELECT COUNT(*) FROM BalanzaComando c WHERE c.BalanzaCodigo = b.Codigo AND c.Estado IN ('PENDIENTE','ENTREGADO')) AS ComandosEnCurso,
             s.SesionId, s.Modo AS SesionModo, sbv.Nombre AS SesionBodega, sa.Nombre AS SesionArea,
             CONCAT_WS(' ', se.PrimerNombre, se.PrimerApellido) AS SesionOperadora
        FROM Balanza b
        LEFT JOIN BodegaVirtual bv ON bv.Codigo = b.BodegaVirtualCodigo
        -- "Dónde está ahora": la sesión abierta de la pesadora (la bodega y el modo son suyos).
        LEFT JOIN SesionBascula s ON s.BalanzaCodigo = b.Codigo AND s.Fin IS NULL
        LEFT JOIN BodegaVirtual sbv ON sbv.Codigo = s.BodegaVirtualCodigo
        LEFT JOIN Areas sa ON sa.Codigo = s.AreaCodigo
        LEFT JOIN Empleados se ON se.Codigo = s.OperadoraCodigo
       ORDER BY b.Codigo`);
    res.json({
      segEnLinea: SEG_EN_LINEA,
      balanzas: rows.map(r => {
        const seg = r.SegSinContacto === null ? null : Number(r.SegSinContacto);
        return {
          ...r,
          Activa: Number(r.Activa) === 1,
          Estable: r.Estable === null ? null : Number(r.Estable) === 1,
          TieneToken: Number(r.TieneToken) === 1,
          ComandosEnCurso: Number(r.ComandosEnCurso),
          SegSinContacto: seg,
          EnLinea: seg !== null && seg <= SEG_EN_LINEA,
          Parametros: r.Parametros ? JSON.parse(r.Parametros) : null,
        };
      }),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

async function validarDatos(body: any) {
  const nombre = String(body?.Nombre ?? "").trim().slice(0, 100);
  const modo = String(body?.Modo ?? "PRODUCTO").toUpperCase();
  if (!MODOS.includes(modo)) throw new Error("Modo debe ser PERSONA o PRODUCTO");
  const bodega = body?.BodegaVirtualCodigo ? String(body.BodegaVirtualCodigo) : null;
  if (bodega) {
    const [bv]: any[] = await prisma.$queryRaw`SELECT Codigo FROM BodegaVirtual WHERE Codigo = ${bodega} LIMIT 1`;
    if (!bv) throw new Error(`No existe la bodega ${bodega}`);
  }
  return { nombre, modo, bodega };
}

// POST /api/balanzas — registra una báscula y devuelve su token UNA sola vez.
router.post("/", requireAuth, requirePerm("basculas", "configurar"), async (req: AuthRequest, res: Response) => {
  try {
    const codigo = String(req.body?.Codigo ?? "").trim().toUpperCase();
    if (!CODIGO_OK.test(codigo)) { res.status(400).json({ error: "Código inválido: letras, números, - y _ (máx. 20), ej. BAL-01" }); return; }
    const { nombre, modo, bodega } = await validarDatos(req.body);
    const [ya]: any[] = await prisma.$queryRaw`SELECT Codigo FROM Balanza WHERE Codigo = ${codigo}`;
    if (ya) { res.status(409).json({ error: `${codigo} ya está registrada` }); return; }
    const token = nuevoToken();
    await prisma.$executeRaw`
      INSERT INTO Balanza (Codigo, Nombre, BodegaVirtualCodigo, Modo, TokenHash, RegistradoPor)
      VALUES (${codigo}, ${nombre}, ${bodega}, ${modo}, ${hash(token)}, ${req.user!.username})`;
    res.status(201).json({ Codigo: codigo, Token: token });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/balanzas/:codigo — nombre, bodega, modo y si está activa.
router.put("/:codigo", requireAuth, requirePerm("basculas", "configurar"), async (req: AuthRequest, res: Response) => {
  try {
    const codigo = String(req.params.codigo).toUpperCase();
    const { nombre, modo, bodega } = await validarDatos(req.body);
    const activa = req.body?.Activa === false ? 0 : 1;
    const n = await prisma.$executeRaw`
      UPDATE Balanza SET Nombre = ${nombre}, BodegaVirtualCodigo = ${bodega}, Modo = ${modo}, Activa = ${activa}
       WHERE Codigo = ${codigo}`;
    if (!n) { res.status(404).json({ error: "No existe" }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/balanzas/:codigo/token — token nuevo; el anterior deja de servir en ese momento.
router.post("/:codigo/token", requireAuth, requirePerm("basculas", "configurar"), async (req: AuthRequest, res: Response) => {
  try {
    const codigo = String(req.params.codigo).toUpperCase();
    const token = nuevoToken();
    const n = await prisma.$executeRaw`UPDATE Balanza SET TokenHash = ${hash(token)} WHERE Codigo = ${codigo}`;
    if (!n) { res.status(404).json({ error: "No existe" }); return; }
    res.json({ Codigo: codigo, Token: token });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/balanzas/:codigo/comandos — deja un comando para el próximo aviso del cabezal.
router.post("/:codigo/comandos", requireAuth, requirePerm("basculas", "comandos"), async (req: AuthRequest, res: Response) => {
  try {
    const codigo = String(req.params.codigo).toUpperCase();
    const tipo = String(req.body?.Tipo ?? "").toUpperCase();
    const validar = TIPOS[tipo];
    if (!validar) { res.status(400).json({ error: `Comando desconocido: ${tipo}` }); return; }
    let datos: any;
    try { datos = validar(req.body?.Datos); } catch (e: any) { res.status(400).json({ error: e.message }); return; }
    const [b]: any[] = await prisma.$queryRaw`SELECT Activa FROM Balanza WHERE Codigo = ${codigo}`;
    if (!b) { res.status(404).json({ error: "No existe" }); return; }
    if (Number(b.Activa) !== 1) { res.status(400).json({ error: `${codigo} está desactivada` }); return; }
    await prisma.$executeRaw`
      INSERT INTO BalanzaComando (BalanzaCodigo, Tipo, Datos, CreadoPor)
      VALUES (${codigo}, ${tipo}, ${datos === null ? null : JSON.stringify(datos)}, ${req.user!.username})`;
    res.status(201).json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Áreas que pesan ─────────────────────────────────────────────────────────────────────────
// Toda la configuración de básculas vive en este módulo (decisión del usuario): qué áreas usan
// básculas y con qué modo se editan aquí, aunque las columnas estén en Areas (alterAreasPesaje.ts).
// Va ANTES de "/:codigo/..." para que "areas" no se lea como un código de báscula.

// GET /api/balanzas/areas — áreas activas con su bodega y su configuración de pesaje.
router.get("/areas", requireAuth, requirePerm("basculas", "ver"), async (_req: AuthRequest, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT a.Codigo, a.Nombre, a.Grupo, a.BodegaVirtualCodigo, bv.Nombre AS BodegaNombre,
             a.EsPesadora, a.ModoPesaje, a.PideCarrito
        FROM Areas a
        LEFT JOIN BodegaVirtual bv ON bv.Codigo = a.BodegaVirtualCodigo
       WHERE a.Activa = 1
       ORDER BY a.EsPesadora DESC, a.Grupo, a.Nombre`);
    res.json(rows.map(r => ({ ...r, EsPesadora: Number(r.EsPesadora) === 1, PideCarrito: Number(r.PideCarrito) === 1 })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/balanzas/areas/:codigo — { EsPesadora, ModoPesaje: PERSONA | PRODUCTO | null, PideCarrito }
router.put("/areas/:codigo", requireAuth, requirePerm("basculas", "configurar"), async (req: AuthRequest, res: Response) => {
  try {
    const codigo = String(req.params.codigo);
    const es = req.body?.EsPesadora ? 1 : 0;
    const m = String(req.body?.ModoPesaje ?? "").toUpperCase();
    const modo = MODOS.includes(m) ? m : null;
    const carrito = es && req.body?.PideCarrito ? 1 : 0;
    const n = await prisma.$executeRaw`
      UPDATE Areas SET EsPesadora = ${es}, ModoPesaje = ${es ? modo : null}, PideCarrito = ${carrito} WHERE Codigo = ${codigo}`;
    if (!n) { res.status(404).json({ error: "No existe el área" }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Tipos de empaque ────────────────────────────────────────────────────────────────────────
// Lectura: también la usa la pantalla de pesaje (permiso aparte `pesaje_bascula`).

const CODIGO_EMPAQUE = /^[A-Z0-9_-]{1,20}$/;

router.get("/empaques", requireAuth, requireAnyPerm([["basculas", "ver"], ["pesaje_bascula", "usar"]]),
  async (req: AuthRequest, res: Response) => {
    try {
      const soloActivos = String(req.query.activos ?? "") === "1";
      const rows: any[] = await prisma.$queryRawUnsafe(`
        SELECT Codigo, Nombre, Unidad, PesoNetoG, TaraG, DeshidratacionPct, DeshidratacionG, PesoBrutoG,
               MargenPosG, MargenNegG, MinG, MaxG, ConRango, Activo, ModificadoPor,
               DATE_FORMAT(COALESCE(ModificadoEn, CreadoEn), '%Y-%m-%d %H:%i') AS Modificado
          FROM EmpaquePesaje ${soloActivos ? "WHERE Activo = 1" : ""} ORDER BY Activo DESC, Nombre`);
      res.json(rows.map(r => ({ ...r, Activo: Number(r.Activo) === 1, ConRango: Number(r.ConRango) === 1, DeshidratacionPct: Number(r.DeshidratacionPct) })));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

// POST /api/balanzas/empaques/calcular — vista previa del rango mientras se escribe (no guarda).
router.post("/empaques/calcular", requireAuth, requirePerm("basculas", "ver"), (req: AuthRequest, res: Response) => {
  try { res.json(validarEmpaque({ Nombre: "x", ...req.body })); } catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.post("/empaques", requireAuth, requirePerm("basculas", "configurar"), async (req: AuthRequest, res: Response) => {
  try {
    const codigo = String(req.body?.Codigo ?? "").trim().toUpperCase();
    if (!CODIGO_EMPAQUE.test(codigo)) { res.status(400).json({ error: "Código: letras, números, - y _ (máx. 20)" }); return; }
    const e = validarEmpaque(req.body);
    const [ya]: any[] = await prisma.$queryRaw`SELECT Codigo FROM EmpaquePesaje WHERE Codigo = ${codigo}`;
    if (ya) { res.status(409).json({ error: `Ya existe el tipo de empaque ${codigo}` }); return; }
    await prisma.$executeRaw`
      INSERT INTO EmpaquePesaje (Codigo, Nombre, Unidad, PesoNetoG, TaraG, DeshidratacionPct, DeshidratacionG,
                                 PesoBrutoG, MargenPosG, MargenNegG, MinG, MaxG, ConRango, ModificadoPor)
      VALUES (${codigo}, ${e.Nombre}, ${e.Unidad}, ${e.PesoNetoG}, ${e.TaraG}, ${e.DeshidratacionPct}, ${e.DeshidratacionG},
              ${e.PesoBrutoG}, ${e.MargenPosG}, ${e.MargenNegG}, ${e.MinG}, ${e.MaxG}, ${e.ConRango}, ${req.user!.username})`;
    res.status(201).json({ ok: true, Codigo: codigo });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/balanzas/empaques/:codigo — cambia el rango para lo que se pese de aquí en adelante; las
// pesadas ya guardadas conservan el rango con que se pesaron.
router.put("/empaques/:codigo", requireAuth, requirePerm("basculas", "configurar"), async (req: AuthRequest, res: Response) => {
  try {
    const codigo = String(req.params.codigo).toUpperCase();
    const e = validarEmpaque(req.body);
    const activo = req.body?.Activo === false ? 0 : 1;
    const n = await prisma.$executeRaw`
      UPDATE EmpaquePesaje
         SET Nombre = ${e.Nombre}, Unidad = ${e.Unidad}, PesoNetoG = ${e.PesoNetoG}, TaraG = ${e.TaraG},
             DeshidratacionPct = ${e.DeshidratacionPct}, DeshidratacionG = ${e.DeshidratacionG}, PesoBrutoG = ${e.PesoBrutoG},
             MargenPosG = ${e.MargenPosG}, MargenNegG = ${e.MargenNegG}, MinG = ${e.MinG}, MaxG = ${e.MaxG}, ConRango = ${e.ConRango},
             Activo = ${activo}, ModificadoEn = NOW(), ModificadoPor = ${req.user!.username}
       WHERE Codigo = ${codigo}`;
    if (!n) { res.status(404).json({ error: "No existe" }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/balanzas/:codigo/comandos — los últimos 30, con su resultado.
router.get("/:codigo/comandos", requireAuth, requirePerm("basculas", "ver"), async (req: AuthRequest, res: Response) => {
  try {
    const codigo = String(req.params.codigo).toUpperCase();
    const rows: any[] = await prisma.$queryRaw`
      SELECT ComandoId, Tipo, Datos, Estado, Resultado, CreadoPor,
             DATE_FORMAT(CreadoEn, '%Y-%m-%d %H:%i:%s') AS CreadoEn,
             DATE_FORMAT(EntregadoEn, '%Y-%m-%d %H:%i:%s') AS EntregadoEn,
             DATE_FORMAT(TerminadoEn, '%Y-%m-%d %H:%i:%s') AS TerminadoEn,
             TIMESTAMPDIFF(SECOND, EntregadoEn, NOW()) AS SegDesdeEntrega
        FROM BalanzaComando WHERE BalanzaCodigo = ${codigo}
       ORDER BY ComandoId DESC LIMIT 30`;
    res.json(rows.map(r => ({
      ...r,
      Datos: r.Datos ? JSON.parse(r.Datos) : null,
      SegDesdeEntrega: r.SegDesdeEntrega === null ? null : Number(r.SegDesdeEntrega),
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
