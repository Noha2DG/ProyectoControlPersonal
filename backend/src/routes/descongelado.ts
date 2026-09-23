// Descongelado — la hoja de proceso y el kardex de inventario al piso.
//
// Es la versión en pantalla del formulario FR-7.13-13 que hoy se llena a mano: una hoja por
// propiedad, con entrada declarada, descongelado pesado con área destino, devoluciones a bodega y
// el cuadre del día. El papel ya trae la regla correcta impresa —  "LA DIFERENCIA SE ANOTA, NO SE
// AJUSTA"—  así que acá la merma se escribe como renglón propio al cerrar, nunca se cuadra a la
// fuerza tocando los pesos.
//
// El modelo está en scripts/createInventarioPiso.ts. Lo único que hay que tener presente al leer
// este archivo: LA HOJA ES UN LUGAR. El área entrega a la hoja (CONSUMO), la hoja entrega al área
// siguiente (TRASLADO), a bodega (DEVOLUCION) o a nada (MERMA). Por eso ningún renglón lleva área
// de origen y hoja de origen a la vez, y el saldo se calcula sin mirar el Tipo.
import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";
import { hoyGT } from "../lib/dateGT.ts";

const router = Router();

const LB_POR_KG = 2.20462;

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

// Todo se suma en kilos. Guardar el peso como se capturó Y el normalizado evita que cada reporte
// convierta por su cuenta: destajo registra KG y bodega cuenta libras, y tres conversiones ad hoc
// dan tres totales distintos del mismo dato.
function aKg(peso: number, um: string): number {
  return um === "LB" ? Number((peso / LB_POR_KG).toFixed(2)) : Number(peso.toFixed(2));
}

function num(rows: any[], campos: string[]) {
  return rows.map(r => {
    const o = { ...r };
    for (const c of campos) if (o[c] != null) o[c] = Number(o[c]);
    return o;
  });
}

// ── Saldo al piso ────────────────────────────────────────────────────────────────────────────
// Las dos ramas van por separado y se unen con UNION ALL: MariaDB 10.5 no tiene LATERAL, y una
// vista con UNION ALL se materializa en tabla temporal y pierde los índices. El filtro va SOBRE la
// columna (`FechaProduccion <= ?`), nunca envuelta en DATE(), que obligaría a evaluar fila por fila.
// FechaLote entra al agrupado y al orden: el texto del lote NO ordena por antigüedad (lleva
// día-de-semana + semana), así que sin esta columna no hay PEPS. En el despacho del 22-sep convivía
// producto de 46 y de 137 días, y los 16 lotes quedaban en otra posición si se ordenaba por texto.
// AGRUPA POR REMISIÓN. Por eso el consumo también guarda RemisionId: si solo lo guardara el
// ingreso, lo que se baja no se podría descontar de la remisión de la que salió y el saldo por
// remisión no cerraría nunca. Es además la columna "REMISIÓN N°" que la hoja de papel ya tiene en
// su sección 1 —  en blanco en las tres hojas reales, porque a mano no hay cómo seguirla.
const SQL_SALDO = `
  SELECT t.Bodega, b.Nombre AS NombreBodega, t.RemisionId, rm.Folio AS FolioRemision,
         DATE_FORMAT(rm.ConfirmadaEn, '%Y-%m-%d %H:%i') AS ConfirmadaEn,
         t.Lote, t.Clase, cl.Descripcion AS DescripcionClase,
         t.Talla, ta.Descripcion AS DescripcionTalla,
         DATE_FORMAT(t.FechaLote, '%Y-%m-%d') AS FechaLote,
         -- DIAS AL PISO se cuenta desde que el producto ENTRÓ AL ÁREA, nunca desde la fecha del
         -- lote. Hay lotes congelados del año pasado y su antigüedad de producción no dice nada
         -- sobre si el área lo tiene parado: un lote de hace 300 días que llegó esta mañana lleva
         -- cero días al piso. La regla operativa es que nada se quede más de dos días.
         --
         -- FechaLote sigue viajando, pero solo como fecha —  para el PEPS y la trazabilidad—, no
         -- convertida a un número de días que se leería como alarma.
         DATE_FORMAT(MIN(CASE WHEN t.Delta > 0 THEN t.FechaProduccion END), '%Y-%m-%d') AS FechaIngreso,
         DATEDIFF(?, MIN(CASE WHEN t.Delta > 0 THEN t.FechaProduccion END)) AS DiasAlPiso,
         ROUND(SUM(t.Delta), 2) AS Kg,
         SUM(t.Masters) AS Masters,
         -- El peso de un master viene de la presentación del pedido y NO se teclea nunca. Todo lo
         -- que el área declara se cuenta en masters y los kilos se derivan de aquí, para no meter
         -- una segunda fuente de verdad del peso.
         MAX(t.KgPorMaster) AS KgPorMaster
  FROM (
    SELECT BodegaDestino AS Bodega, RemisionId, Lote, Clase, Talla, FechaLote, FechaProduccion,  PesoKg AS Delta,  Masters, KgPorMaster
      FROM MovimientoPiso WHERE BodegaDestino IS NOT NULL AND FechaProduccion <= ?
    UNION ALL
    SELECT BodegaOrigen  AS Bodega, RemisionId, Lote, Clase, Talla, FechaLote, FechaProduccion, -PesoKg AS Delta, -Masters, KgPorMaster
      FROM MovimientoPiso WHERE BodegaOrigen  IS NOT NULL AND FechaProduccion <= ?
  ) t
  JOIN BodegaVirtual b ON b.Codigo = t.Bodega
  JOIN Clase cl ON cl.Clase = t.Clase
  JOIN Tallas ta ON ta.Codigo = t.Talla
  LEFT JOIN Remisiones rm ON rm.RemisionId = t.RemisionId
`;

// GET /api/descongelado/saldo?area=DE&hasta=YYYY-MM-DD
// El saldo al piso de un área: lo que entró menos lo que salió, desde siempre hasta esa jornada.
// No hay proceso de cierre nocturno que arrastre nada — si nadie sacó el producto, sigue ahí.
router.get("/saldo", requireAuth, requirePerm("descongelado", "ver"), async (req: Request, res: Response) => {
  try {
    const hasta = (req.query.hasta as string) || hoyGT();
    const bodega = (req.query.bodega || req.query.area) as string | undefined;
    const filtro = bodega ? "WHERE t.Bodega = ?" : "";
    // Tres veces la misma fecha, en el orden en que MySQL ata los placeholders: la de DiasAlPiso
    // en el SELECT y las dos del WHERE de cada rama del UNION.
    const args = bodega ? [hasta, hasta, hasta, bodega] : [hasta, hasta, hasta];
    // Lo más viejo primero: es el orden en que hay que bajar el producto, y el único que le sirve a
    // quien decide qué descongelar. Los lotes sin FechaLote (carga manual) van al final.
    // Remisión más vieja primero (por cuándo la confirmó bodega) y, dentro de cada una, el lote más
    // viejo primero. Ese es el orden en que hay que bajar el producto.
    const rows: any[] = await prisma.$queryRawUnsafe(
      `${SQL_SALDO} ${filtro}
       GROUP BY t.Bodega, b.Nombre, t.RemisionId, rm.Folio, rm.ConfirmadaEn,
                t.Lote, t.Clase, cl.Descripcion, t.Talla, ta.Descripcion, t.FechaLote
       HAVING ABS(Kg) > 0.001
       ORDER BY t.Bodega, rm.ConfirmadaEn IS NULL, rm.ConfirmadaEn ASC, t.RemisionId,
                t.FechaLote IS NULL, t.FechaLote ASC, t.Lote, t.Talla`, ...args);
    res.json(num(rows, ["Kg", "Talla", "Masters", "KgPorMaster", "DiasAlPiso", "RemisionId"]));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/descongelado/resumen?area=DE&fecha=YYYY-MM-DD
// El total de lo INGRESADO de la jornada, que no se puede perder aunque el producto ya se haya
// descongelado y salido del piso. El saldo solo dice lo que queda; el reporte necesita además
// cuánto llegó, y esos dos números dejan de coincidir en cuanto alguien baja el primer master.
router.get("/resumen", requireAuth, requirePerm("descongelado", "ver"), async (req: Request, res: Response) => {
  try {
    const fecha = (req.query.fecha as string) || hoyGT();
    const bodega = (req.query.bodega as string) || (req.query.area as string) || "DESCONGELADO";
    const [r]: any[] = await prisma.$queryRaw`
      SELECT
        ROUND(COALESCE(SUM(CASE WHEN Tipo = 'INGRESO'    THEN PesoKg  END), 0), 2) AS IngresadoKg,
        COALESCE(SUM(CASE WHEN Tipo = 'INGRESO'          THEN Masters END), 0)     AS IngresadoMasters,
        COUNT(DISTINCT CASE WHEN Tipo = 'INGRESO' THEN RemisionId END)             AS Remisiones,
        ROUND(COALESCE(SUM(CASE WHEN Tipo = 'CONSUMO'    THEN PesoKg  END), 0), 2) AS DescongeladoKg,
        COALESCE(SUM(CASE WHEN Tipo = 'CONSUMO'          THEN Masters END), 0)     AS DescongeladoMasters,
        ROUND(COALESCE(SUM(CASE WHEN Tipo = 'DEVOLUCION' THEN PesoKg  END), 0), 2) AS DevueltoKg,
        ROUND(COALESCE(SUM(CASE WHEN Tipo = 'MERMA'      THEN PesoKg  END), 0), 2) AS MermaKg
      FROM MovimientoPiso
      WHERE FechaProduccion = ${fecha} AND (BodegaDestino = ${bodega} OR BodegaOrigen = ${bodega})`;

    // El saldo es acumulado, no del día: lo que quedó de jornadas anteriores sigue contando.
    const [s]: any[] = await prisma.$queryRaw`
      SELECT ROUND(COALESCE(SUM(Delta), 0), 2) AS Kg, COALESCE(SUM(DeltaM), 0) AS Masters FROM (
        SELECT PesoKg AS Delta, Masters AS DeltaM FROM MovimientoPiso
          WHERE BodegaDestino = ${bodega} AND FechaProduccion <= ${fecha}
        UNION ALL
        SELECT -PesoKg AS Delta, -Masters AS DeltaM FROM MovimientoPiso
          WHERE BodegaOrigen = ${bodega} AND FechaProduccion <= ${fecha}
      ) t`;

    res.json({
      ...num([r], ["IngresadoKg", "IngresadoMasters", "Remisiones", "DescongeladoKg",
                   "DescongeladoMasters", "DevueltoKg", "MermaKg"])[0],
      AlPisoKg: Number(s.Kg), AlPisoMasters: Number(s.Masters),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/descongelado/auxiliares?area=DE&fecha=YYYY-MM-DD
// Quién PASÓ por el área en la jornada, no quién está parado ahí en este momento: la hoja declara
// con cuánta gente se trabajó el turno, y a media tarde el conteo instantáneo ya perdió a todos los
// que entraron temprano y se fueron a otra área.
//
// La condición es de TRASLAPE, no de igualdad de fecha: una transferencia que abrió ayer y sigue
// abierta hoy cuenta para hoy, y `FechaSalida IS NULL` (nunca marcó salida) también. Preguntar por
// DATE(FechaHora) = fecha perdería las dos cosas.
//
// El encargado NO se descuenta aquí: la pantalla lo quita de la lista cuando se elige, porque se
// escoge después de cargar esto y el número tiene que moverse con esa decisión.
router.get("/auxiliares", requireAuth, requirePerm("descongelado", "ver"), async (req: Request, res: Response) => {
  try {
    const fecha = (req.query.fecha as string) || hoyGT();
    const bodega = (req.query.bodega as string) || "DESCONGELADO";
    // Se cuenta a quien pasó por CUALQUIER área de la bodega: Pelado/Descabezado son siete áreas
    // que son el mismo piso y la misma gente, así que preguntar por un solo código dejaría fuera a
    // casi todos.
    const rows: any[] = await prisma.$queryRaw`
      SELECT tr.Codigo,
             CONCAT_WS(' ', e.PrimerNombre, e.PrimerApellido) AS Nombre,
             DATE_FORMAT(MIN(tr.FechaHora), '%H:%i') AS Desde,
             DATE_FORMAT(MAX(COALESCE(tr.FechaSalida, NOW())), '%H:%i') AS Hasta,
             SUM(TIMESTAMPDIFF(MINUTE, tr.FechaHora, COALESCE(tr.FechaSalida, NOW()))) AS Minutos
      FROM Transferencias tr
      JOIN Empleados e ON e.Codigo = tr.Codigo
      JOIN Areas ar ON ar.Codigo = tr.CodigoArea
      WHERE ar.BodegaVirtualCodigo = ${bodega}
        AND tr.FechaHora < DATE_ADD(${fecha}, INTERVAL 1 DAY)
        AND (tr.FechaSalida IS NULL OR tr.FechaSalida >= ${fecha})
      GROUP BY tr.Codigo, e.PrimerNombre, e.PrimerApellido
      ORDER BY MIN(tr.FechaHora)`;
    res.json(num(rows, ["Minutos"]));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/descongelado/bodegas — las bodegas que llevan inventario al piso, en orden de flujo.
// Son los destinos posibles de un traslado y el catálogo que ordena todo el módulo.
router.get("/bodegas", requireAuth, requirePerm("descongelado", "ver"), async (_req: Request, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT Codigo, Nombre, Orden FROM BodegaVirtual
       WHERE Activo = 1 AND LlevaPiso = 1 ORDER BY Orden`;
    res.json(num(rows, ["Orden"]));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Hojas ────────────────────────────────────────────────────────────────────────────────────
const SQL_HOJA = `
  SELECT h.HojaId, h.BodegaCodigo, b.Nombre AS NombreBodega, h.FechaProduccion,
         DATE_FORMAT(h.HoraInicio, '%Y-%m-%d %H:%i') AS HoraInicio,
         DATE_FORMAT(h.HoraFin,    '%Y-%m-%d %H:%i') AS HoraFin,
         h.Propiedad, h.Encargado,
         CONCAT_WS(' ', e.PrimerNombre, e.PrimerApellido) AS NombreEncargado,
         h.Personas, h.MetabisulfitoKg, h.Estatus, h.Observaciones,
         h.CreadoPor, DATE_FORMAT(h.CreadoEn, '%Y-%m-%d %H:%i') AS CreadoEn,
         h.CerradaPor, DATE_FORMAT(h.CerradaEn, '%Y-%m-%d %H:%i') AS CerradaEn,
         COALESCE((SELECT SUM(m.PesoKg) FROM MovimientoPiso m WHERE m.HojaDestinoId = h.HojaId), 0) AS KgEntrada,
         COALESCE((SELECT SUM(m.PesoKg) FROM MovimientoPiso m WHERE m.HojaOrigenId  = h.HojaId AND m.Tipo = 'TRASLADO'), 0) AS KgDescongelado,
         COALESCE((SELECT SUM(m.PesoKg) FROM MovimientoPiso m WHERE m.HojaOrigenId  = h.HojaId AND m.Tipo = 'DEVOLUCION'), 0) AS KgDevuelto,
         COALESCE((SELECT SUM(m.PesoKg) FROM MovimientoPiso m WHERE m.HojaOrigenId  = h.HojaId AND m.Tipo = 'MERMA'), 0) AS KgMerma
  FROM HojaProceso h
  JOIN BodegaVirtual b ON b.Codigo = h.BodegaCodigo
  LEFT JOIN Empleados e ON e.Codigo = h.Encargado
`;

const CAMPOS_HOJA = ["HojaId", "Personas", "MetabisulfitoKg", "KgEntrada", "KgDescongelado", "KgDevuelto", "KgMerma"];

// El rendimiento que pidió el usuario: lo pesado de verdad contra lo que se declaró que entró.
// El master faltante NO se separa — por decisión suya, entra completo en este porcentaje.
function conRendimiento(rows: any[]) {
  return num(rows, CAMPOS_HOJA).map(h => ({
    ...h,
    Rendimiento: h.KgEntrada > 0 ? Number((100 * h.KgDescongelado / h.KgEntrada).toFixed(2)) : null,
  }));
}

// GET /api/descongelado/hojas?fecha=YYYY-MM-DD&estatus=Abierta
router.get("/hojas", requireAuth, requirePerm("descongelado", "ver"), async (req: Request, res: Response) => {
  try {
    const fecha = (req.query.fecha as string) || hoyGT();
    const estatus = req.query.estatus as string | undefined;
    const filtro = estatus ? "AND h.Estatus = ?" : "";
    const args = estatus ? [fecha, estatus] : [fecha];
    const rows: any[] = await prisma.$queryRawUnsafe(
      `${SQL_HOJA} WHERE h.FechaProduccion = ? ${filtro} ORDER BY h.HoraInicio ASC, h.HojaId ASC`, ...args);
    res.json(conRendimiento(rows));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/descongelado/hojas/:id — la hoja con sus tres secciones
router.get("/hojas/:id", requireAuth, requirePerm("descongelado", "ver"), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const hojas: any[] = await prisma.$queryRawUnsafe(`${SQL_HOJA} WHERE h.HojaId = ?`, id);
    if (!hojas.length) { res.status(404).json({ error: "Hoja no encontrada" }); return; }

    const renglones: any[] = await prisma.$queryRawUnsafe(`
      SELECT m.MovimientoId, m.Tipo, m.Lote, m.Clase, cl.Descripcion AS DescripcionClase,
             m.Talla, ta.Descripcion AS DescripcionTalla,
             m.Peso, m.UM, m.PesoKg, m.Masters, m.KgPorMaster,
             m.BodegaOrigen, m.BodegaDestino, bd.Nombre AS NombreBodegaDestino,
             m.AreaDeclarada, ar.Nombre AS NombreAreaDeclarada,
             m.RemisionId, r.Folio AS FolioRemision, m.NumeroTermo, m.Motivo, m.RegistradoPor,
             DATE_FORMAT(m.FechaHora, '%Y-%m-%d %H:%i') AS FechaHora
      FROM MovimientoPiso m
      JOIN Clase cl ON cl.Clase = m.Clase
      JOIN Tallas ta ON ta.Codigo = m.Talla
      LEFT JOIN BodegaVirtual bd ON bd.Codigo = m.BodegaDestino
      LEFT JOIN Areas ar ON ar.Codigo = m.AreaDeclarada
      LEFT JOIN Remisiones r ON r.RemisionId = m.RemisionId
      WHERE m.HojaOrigenId = ? OR m.HojaDestinoId = ?
      ORDER BY m.MovimientoId ASC`, id, id);

    const lineas = num(renglones, ["MovimientoId", "Talla", "Peso", "PesoKg", "Masters", "KgPorMaster"]);
    res.json({
      ...conRendimiento(hojas)[0],
      entrada:     lineas.filter(l => l.Tipo === "CONSUMO"),
      descongelado: lineas.filter(l => l.Tipo === "TRASLADO"),
      devoluciones: lineas.filter(l => l.Tipo === "DEVOLUCION"),
      merma:       lineas.filter(l => l.Tipo === "MERMA"),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/descongelado/hojas
router.post("/hojas", requireAuth, requirePerm("descongelado", "crear"), async (req: Request, res: Response) => {
  try {
    const { FechaProduccion, HoraInicio, Propiedad, Encargado, Personas, BodegaCodigo, AreaCodigo } = req.body;
    const fecha = FechaProduccion || hoyGT();
    const propiedad = Propiedad === "MAQUILA" ? "MAQUILA" : "OROPSA";
    if (!Encargado) { res.status(400).json({ error: "El encargado es requerido" }); return; }

    await prisma.$executeRaw`
      INSERT INTO HojaProceso (BodegaCodigo, FechaProduccion, HoraInicio, Propiedad, Encargado, Personas, CreadoPor)
      VALUES (${BodegaCodigo || AreaCodigo || "DESCONGELADO"}, ${fecha}, ${HoraInicio || null}, ${propiedad}, ${Encargado},
              ${Personas === '' || Personas == null ? null : Number(Personas)}, ${getOperador(req)})
    `;
    const [r]: any[] = await prisma.$queryRaw`SELECT LAST_INSERT_ID() AS id`;
    res.status(201).json({ ok: true, HojaId: Number(r.id) });
  } catch (err: any) {
    if (err.message?.includes("foreign key")) res.status(400).json({ error: "La bodega o el encargado no existen" });
    else res.status(500).json({ error: err.message });
  }
});

// PUT /api/descongelado/hojas/:id — cabecera (solo mientras está abierta)
router.put("/hojas/:id", requireAuth, requirePerm("descongelado", "editar"), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { HoraInicio, HoraFin, Propiedad, Encargado, Personas, MetabisulfitoKg, Observaciones } = req.body;
    const [h]: any[] = await prisma.$queryRaw`SELECT Estatus FROM HojaProceso WHERE HojaId = ${id} LIMIT 1`;
    if (!h) { res.status(404).json({ error: "Hoja no encontrada" }); return; }
    if (h.Estatus !== "Abierta") { res.status(400).json({ error: "La hoja ya está cerrada" }); return; }

    await prisma.$executeRaw`
      UPDATE HojaProceso SET
        HoraInicio = ${HoraInicio || null}, HoraFin = ${HoraFin || null},
        Propiedad = ${Propiedad === "MAQUILA" ? "MAQUILA" : "OROPSA"},
        Encargado = ${Encargado || null}, Personas = ${Personas === '' || Personas == null ? null : Number(Personas)},
        MetabisulfitoKg = ${MetabisulfitoKg != null && MetabisulfitoKg !== "" ? Number(MetabisulfitoKg) : null},
        Observaciones = ${Observaciones || null}
      WHERE HojaId = ${id}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Renglones ────────────────────────────────────────────────────────────────────────────────
async function hojaAbierta(id: number) {
  const [h]: any[] = await prisma.$queryRaw`
    SELECT HojaId, BodegaCodigo, FechaProduccion, Estatus FROM HojaProceso WHERE HojaId = ${id} LIMIT 1`;
  if (!h) return { error: "Hoja no encontrada", status: 404 };
  if (h.Estatus !== "Abierta") return { error: "La hoja ya está cerrada", status: 400 };
  return { hoja: h };
}

function fechaDeHoja(hoja: any): string {
  // FechaProduccion viene como DATE (medianoche UTC): toISOString da el día correcto, mientras que
  // cualquier getter local le restaría 6 horas y lo movería al día anterior (ver utils/fecha.js).
  return new Date(hoja.FechaProduccion).toISOString().slice(0, 10);
}

// POST /api/descongelado/hojas/:id/entrada — sección 1: el área entrega a la hoja.
// Ojo: NO es el ingreso al piso. Eso lo hizo la remisión, que pudo ser de ayer — bodega saca el
// producto un día antes para descongelar al siguiente. Acá solo se consume del saldo del área.
router.post("/hojas/:id/entrada", requireAuth, requirePerm("descongelado", "crear"), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const chk = await hojaAbierta(id);
    if ("error" in chk) { res.status(chk.status!).json({ error: chk.error }); return; }

    const { Lote, Clase, Talla, Masters, KgPorMaster, Peso, UM, RemisionId } = req.body;
    if (!Lote || !Clase) { res.status(400).json({ error: "Lote y Clase son requeridos" }); return; }

    // El peso declarado sale de Masters x KgPorMaster cuando vienen los dos; si no, del peso suelto.
    const declarado = (Masters && KgPorMaster)
      ? Number((Number(Masters) * Number(KgPorMaster)).toFixed(2))
      : Number(Peso);
    if (!declarado || declarado <= 0) { res.status(400).json({ error: "El peso declarado debe ser mayor que cero" }); return; }

    const um = UM === "LB" ? "LB" : "KG";
    const kg = aKg(declarado, um);
    const talla = Talla ? Number(Talla) : 900;

    // El saldo se lleva POR REMISIÓN, así que la disponibilidad se mide dentro de la remisión de la
    // que salió el renglón. `<=>` y no `=` porque RemisionId puede ser NULL (producto que entró por
    // un ajuste, sin remisión detrás) y con `=` esas filas no casarían nunca consigo mismas.
    const remId = RemisionId ? Number(RemisionId) : null;
    const [disp]: any[] = await prisma.$queryRaw`
      SELECT ROUND(COALESCE(SUM(Delta), 0), 2) AS Kg, COALESCE(SUM(DeltaM), 0) AS Masters FROM (
        SELECT PesoKg AS Delta, Masters AS DeltaM FROM MovimientoPiso
          WHERE BodegaDestino = ${chk.hoja.BodegaCodigo} AND RemisionId <=> ${remId}
            AND Lote = ${Lote} AND Clase = ${Clase} AND Talla = ${talla}
        UNION ALL
        SELECT -PesoKg AS Delta, -Masters AS DeltaM FROM MovimientoPiso
          WHERE BodegaOrigen = ${chk.hoja.BodegaCodigo} AND RemisionId <=> ${remId}
            AND Lote = ${Lote} AND Clase = ${Clase} AND Talla = ${talla}
      ) t`;
    const disponible = Number(disp.Kg);
    const mastersDisp = Number(disp.Masters);

    // Se controla por MASTERS cuando el renglón viene contado en masters, que es como el área
    // declara: los kilos salen de la presentación del pedido y no se teclean. Así el control habla
    // el mismo idioma que la báscula del andén y no hay que comparar decimales.
    if (Masters && Number(Masters) > mastersDisp) {
      res.status(400).json({
        error: `De esa remisión solo quedan ${mastersDisp} masters de ${Lote} ${Clase} al piso; está bajando ${Number(Masters)}.`,
      });
      return;
    }
    if (kg > disponible + 0.001) {
      res.status(400).json({
        error: `De esa remisión solo quedan ${disponible.toFixed(2)} kg de ${Lote} ${Clase} al piso; está bajando ${kg.toFixed(2)} kg.`,
      });
      return;
    }

    // FechaLote se copia del saldo para que el renglón conserve la antigüedad del lote y el PEPS
    // siga funcionando aguas abajo.
    await prisma.$executeRaw`
      INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaOrigen, HojaDestinoId, Lote, Clase, Talla, FechaLote,
                                  Peso, UM, PesoKg, Masters, KgPorMaster, RemisionId, RegistradoPor)
      VALUES ('CONSUMO', ${fechaDeHoja(chk.hoja)}, ${chk.hoja.BodegaCodigo}, ${id}, ${Lote}, ${Clase}, ${talla},
              (SELECT FechaLote FROM (
                 SELECT FechaLote FROM MovimientoPiso
                  WHERE BodegaDestino = ${chk.hoja.BodegaCodigo} AND RemisionId <=> ${remId}
                    AND Lote = ${Lote} AND Clase = ${Clase} AND Talla = ${talla}
                    AND FechaLote IS NOT NULL ORDER BY MovimientoId LIMIT 1) x),
              ${declarado}, ${um}, ${kg},
              ${Masters ? Number(Masters) : null}, ${KgPorMaster ? Number(KgPorMaster) : null},
              ${remId}, ${getOperador(req)})
    `;
    res.status(201).json({ ok: true });
  } catch (err: any) {
    if (err.message?.includes("foreign key")) res.status(400).json({ error: "Clase, talla o remisión no existen" });
    else res.status(500).json({ error: err.message });
  }
});

// POST /api/descongelado/hojas/:id/salida — sección 2: la hoja entrega al área siguiente,
// con el peso REAL de báscula y el área destino.
router.post("/hojas/:id/salida", requireAuth, requirePerm("descongelado", "crear"), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const chk = await hojaAbierta(id);
    if ("error" in chk) { res.status(chk.status!).json({ error: chk.error }); return; }

    const { Lote, Clase, Talla, Peso, UM, BodegaDestino, AreaDeclarada, NumeroTermo, RemisionId } = req.body;
    if (!Lote || !Clase || !BodegaDestino) {
      res.status(400).json({ error: "Lote, Clase y bodega destino son requeridos" }); return;
    }
    const peso = Number(Peso);
    if (!peso || peso <= 0) { res.status(400).json({ error: "El peso pesado debe ser mayor que cero" }); return; }
    if (BodegaDestino === chk.hoja.BodegaCodigo) {
      res.status(400).json({ error: "La bodega destino no puede ser la misma que la de la hoja" }); return;
    }

    const talla = Talla ? Number(Talla) : 900;
    const remId = RemisionId ? Number(RemisionId) : null;

    // La sección 2 es el espejo de la 1: solo se puede descongelar lo que entró a ESTA hoja. Sin
    // esto, un renglón tecleado de más saldría hacia el área siguiente sin haber salido de ninguna
    // parte, y el área destino recibiría producto que nadie entregó.
    const [enHoja]: any[] = await prisma.$queryRaw`
      SELECT ROUND(COALESCE(SUM(PesoKg), 0), 2) AS Kg, MAX(FechaLote) AS FechaLote
        FROM MovimientoPiso
       WHERE HojaDestinoId = ${id} AND RemisionId <=> ${remId}
         AND Lote = ${Lote} AND Clase = ${Clase} AND Talla = ${talla}`;
    if (Number(enHoja.Kg) <= 0) {
      res.status(400).json({ error: `${Lote} ${Clase} no está en la entrada de esta hoja — agréguelo primero en la sección 1.` });
      return;
    }

    const um = UM === "LB" ? "LB" : "KG";
    // El peso real NO se valida contra el declarado: que salga menos es lo normal (faltó un master,
    // o el glaseo). El control está en el cierre, que rechaza que el total salido supere al entrado.
    await prisma.$executeRaw`
      INSERT INTO MovimientoPiso (Tipo, FechaProduccion, HojaOrigenId, BodegaDestino, AreaDeclarada,
                                  Lote, Clase, Talla, FechaLote,
                                  Peso, UM, PesoKg, NumeroTermo, RemisionId, RegistradoPor)
      VALUES ('TRASLADO', ${fechaDeHoja(chk.hoja)}, ${id}, ${BodegaDestino}, ${AreaDeclarada || null},
              ${Lote}, ${Clase}, ${talla},
              ${enHoja.FechaLote}, ${peso}, ${um}, ${aKg(peso, um)},
              ${NumeroTermo || null}, ${remId}, ${getOperador(req)})
    `;
    res.status(201).json({ ok: true });
  } catch (err: any) {
    if (err.message?.includes("foreign key")) res.status(400).json({ error: "Clase, talla, bodega o área declarada no existen" });
    else res.status(500).json({ error: err.message });
  }
});

// POST /api/descongelado/hojas/:id/devolucion — sección 3: regresa a bodega sin descongelar.
router.post("/hojas/:id/devolucion", requireAuth, requirePerm("descongelado", "crear"), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const chk = await hojaAbierta(id);
    if ("error" in chk) { res.status(chk.status!).json({ error: chk.error }); return; }

    const { Lote, Clase, Talla, Masters, Peso, UM, Motivo } = req.body;
    if (!Lote || !Clase) { res.status(400).json({ error: "Lote y Clase son requeridos" }); return; }
    const peso = Number(Peso);
    if (!peso || peso <= 0) { res.status(400).json({ error: "El peso devuelto debe ser mayor que cero" }); return; }

    const um = UM === "LB" ? "LB" : "KG";
    await prisma.$executeRaw`
      INSERT INTO MovimientoPiso (Tipo, FechaProduccion, HojaOrigenId, Lote, Clase, Talla,
                                  Peso, UM, PesoKg, Masters, Motivo, RegistradoPor)
      VALUES ('DEVOLUCION', ${fechaDeHoja(chk.hoja)}, ${id}, ${Lote}, ${Clase},
              ${Talla ? Number(Talla) : 900}, ${peso}, ${um}, ${aKg(peso, um)},
              ${Masters ? Number(Masters) : null}, ${Motivo || null}, ${getOperador(req)})
    `;
    res.status(201).json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/descongelado/renglon/:id — corrección de captura, solo con la hoja abierta.
router.delete("/renglon/:id", requireAuth, requirePerm("descongelado", "eliminar"), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const [m]: any[] = await prisma.$queryRaw`
      SELECT COALESCE(HojaOrigenId, HojaDestinoId) AS HojaId, Tipo FROM MovimientoPiso WHERE MovimientoId = ${id} LIMIT 1`;
    if (!m) { res.status(404).json({ error: "Renglón no encontrado" }); return; }
    if (m.Tipo === "MERMA") { res.status(400).json({ error: "La merma la escribe el cierre; reabra la hoja para rehacerla" }); return; }

    const [h]: any[] = await prisma.$queryRaw`SELECT Estatus FROM HojaProceso WHERE HojaId = ${Number(m.HojaId)} LIMIT 1`;
    if (h?.Estatus !== "Abierta") { res.status(400).json({ error: "La hoja ya está cerrada" }); return; }

    await prisma.$executeRaw`DELETE FROM MovimientoPiso WHERE MovimientoId = ${id}`;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/descongelado/hojas/:id/cerrar
// El cuadre del día. La merma se ESCRIBE como renglón: si quedara implícita, el saldo del área
// nunca bajaría por lo que se perdió y el kardex quedaría inflado para siempre.
//
// Todo va dentro de una transacción de BD con la hoja bloqueada (FOR UPDATE) para que dos cierres
// simultáneos no escriban dos mermas sobre la misma hoja.
router.post("/hojas/:id/cerrar", requireAuth, requirePerm("descongelado", "cerrar"), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const operador = getOperador(req);
    const { HoraFin } = req.body;

    const out = await prisma.$transaction(async (tx) => {
      const [h]: any[] = await tx.$queryRaw`
        SELECT HojaId, BodegaCodigo, FechaProduccion, Estatus FROM HojaProceso WHERE HojaId = ${id} LIMIT 1 FOR UPDATE`;
      if (!h) return { error: "Hoja no encontrada", status: 404 };
      if (h.Estatus !== "Abierta") return { error: "La hoja ya está cerrada", status: 400 };

      const [c]: any[] = await tx.$queryRaw`
        SELECT ROUND(COALESCE(SUM(CASE WHEN HojaDestinoId = ${id} THEN PesoKg ELSE 0 END), 0), 2) AS Entro,
               ROUND(COALESCE(SUM(CASE WHEN HojaOrigenId  = ${id} THEN PesoKg ELSE 0 END), 0), 2) AS Salio
        FROM MovimientoPiso WHERE HojaDestinoId = ${id} OR HojaOrigenId = ${id}`;
      const entro = Number(c.Entro), salio = Number(c.Salio);
      if (entro <= 0) return { error: "La hoja no tiene entrada declarada; no se puede cerrar", status: 400 };

      const merma = Number((entro - salio).toFixed(2));
      // Salir más de lo que entró no es merma negativa: es un error de captura, y cerrarlo dejaría
      // el saldo del área con producto que nunca existió.
      if (merma < 0) {
        return { error: `Lo descongelado y devuelto (${salio.toFixed(2)} kg) supera la entrada declarada (${entro.toFixed(2)} kg). Revise los pesos antes de cerrar.`, status: 400 };
      }

      if (merma > 0) {
        const [primero]: any[] = await tx.$queryRaw`
          SELECT Lote, Clase FROM MovimientoPiso WHERE HojaDestinoId = ${id} ORDER BY MovimientoId ASC LIMIT 1`;
        const fecha = new Date(h.FechaProduccion).toISOString().slice(0, 10);
        await tx.$executeRaw`
          INSERT INTO MovimientoPiso (Tipo, FechaProduccion, HojaOrigenId, Lote, Clase, Talla,
                                      Peso, UM, PesoKg, Motivo, RegistradoPor)
          VALUES ('MERMA', ${fecha}, ${id}, ${primero.Lote}, ${primero.Clase}, 900,
                  ${merma}, 'KG', ${merma}, 'cuadre del día', ${operador})
        `;
      }

      await tx.$executeRaw`
        UPDATE HojaProceso SET Estatus = 'Cerrada', HoraFin = ${HoraFin || null},
                               CerradaPor = ${operador}, CerradaEn = NOW()
        WHERE HojaId = ${id}
      `;
      return { ok: true, Entro: entro, Salio: salio, Merma: merma,
               Rendimiento: Number((100 * salio / entro).toFixed(2)) };
    });

    if (!("ok" in out)) { res.status((out as any).status).json({ error: (out as any).error }); return; }
    res.json(out);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/descongelado/hojas/:id/reabrir — quita la merma y deja la hoja editable otra vez.
router.post("/hojas/:id/reabrir", requireAuth, requirePerm("descongelado", "cerrar"), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const out = await prisma.$transaction(async (tx) => {
      const [h]: any[] = await tx.$queryRaw`SELECT Estatus FROM HojaProceso WHERE HojaId = ${id} LIMIT 1 FOR UPDATE`;
      if (!h) return { error: "Hoja no encontrada", status: 404 };
      if (h.Estatus !== "Cerrada") return { error: "La hoja no está cerrada", status: 400 };
      // La merma es un cálculo del cierre, no una captura: se borra y se vuelve a escribir al
      // cerrar de nuevo. Los renglones capturados por la gente no se tocan.
      await tx.$executeRaw`DELETE FROM MovimientoPiso WHERE HojaOrigenId = ${id} AND Tipo = 'MERMA'`;
      await tx.$executeRaw`
        UPDATE HojaProceso SET Estatus = 'Abierta', CerradaPor = NULL, CerradaEn = NULL WHERE HojaId = ${id}`;
      return { ok: true };
    });
    if (!("ok" in out)) { res.status((out as any).status).json({ error: (out as any).error }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
