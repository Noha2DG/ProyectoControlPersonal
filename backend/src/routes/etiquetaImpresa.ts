import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm, requireAnyPerm, tienePermiso } from "../middleware/auth.ts";
import { resolverRutaBtw } from "./disenoEtiquetaCliente.ts";
import { buscarMasterPorEtiqueta, calcularTechoLinea } from "../lib/masters.ts";

const router = Router();

// Error de negocio lanzado DENTRO de una transacción (donde no se puede responder directo al
// cliente) — el catch de la ruta lo traduce a su status HTTP en vez de un 500 genérico.
class ErrorNegocio extends Error {
  status: number;
  constructor(status: number, mensaje: string) {
    super(mensaje);
    this.status = status;
  }
}

// El aviso de impresión de BarTender viaja con un JWT propio, no con la sesión del operador: quien
// llama es un programa de escritorio que no tiene login. Se distingue por el subject para que un
// token de sesión normal no sirva de credencial de impresión ni al revés.
const TOKEN_BARTENDER_SUBJECT = "bartender-impreso";
// 12 horas: cubre un turno completo. Una tanda que se quedó abierta en el Designer de un día para
// otro deja de poder confirmarse sola — se vuelve a abrir desde la pantalla y se emite otro token.
const TOKEN_BARTENDER_VIGENCIA = "12h";

// Acepta el correlativo tal como lo ve el operador ("E120") o el número pelado (120).
function parseCorrelativo(valor: any): number | null {
  const n = Number(String(valor ?? "").trim().replace(/^[eE]/, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
}

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

// Datos de la orden + línea de pedido necesarios para armar el ZPL de una etiqueta.
// El Proceso (no la Clase completa) es lo que se imprime — mismo criterio ya usado en la lista
// de Líneas de EtiquetadoPage ("quitar la familia, dejar solo proceso y talla").
async function obtenerDatosOrden(ordenId: number) {
  const rows: any[] = await prisma.$queryRaw`
    SELECT oe.OrdenId, oe.DetalleId, oe.Lote, oe.CantidadMaster, oe.Estatus AS EstatusOrden, oe.Color, oe.FechaProduccion,
           dp.CodigoPedido, pc.Descripcion AS DescripcionProceso, ta.Descripcion AS DescripcionTalla,
           pr.Descripcion AS DescripcionPresentacion,
           cli.RazonSocial AS NombreCliente, sub.RazonSocial AS NombreSubcliente,
           ped.CodigoCliente, ped.CodigoSubcliente,
           org.Descripcion AS DescripcionOrigen, cong.Descripcion AS DescripcionCongelacion, ar.Nombre AS NombreArea
    FROM OrdenEtiquetado oe
    JOIN DetallePedido dp ON oe.DetalleId = dp.DetalleId
    JOIN Clase cl ON dp.Clase = cl.Clase
    JOIN Procesos pc ON cl.Proceso = pc.Proceso
    JOIN Tallas ta ON dp.Talla = ta.Codigo
    JOIN Presentacion pr ON dp.Presentacion = pr.Codigo
    JOIN Pedidos ped ON dp.CodigoPedido = ped.CodigoPedido
    JOIN Clientes cli ON ped.CodigoCliente = cli.Codigo
    LEFT JOIN Subcliente sub ON ped.CodigoCliente = sub.CodigoCliente AND ped.CodigoSubcliente = sub.CodigoSubcliente
    JOIN Origen org ON oe.Origen = org.Codigo
    JOIN UnidadesCongelacion cong ON oe.Congelacion = cong.Codigo
    LEFT JOIN Areas ar ON oe.AreaCodigo = ar.Codigo
    WHERE oe.OrdenId = ${ordenId} LIMIT 1
  `;
  return rows[0] ?? null;
}

function datosDesdeOrden(orden: any, correlativo: string) {
  return {
    correlativo,
    codigoPedido: orden.CodigoPedido,
    cliente: orden.NombreCliente,
    subcliente: orden.NombreSubcliente,
    proceso: orden.DescripcionProceso,
    talla: orden.DescripcionTalla,
    presentacion: orden.DescripcionPresentacion,
    lote: orden.Lote,
    color: orden.Color,
    origen: orden.DescripcionOrigen,
    congelacion: orden.DescripcionCongelacion,
    area: orden.NombreArea,
    fechaProduccion: orden.FechaProduccion ? new Date(orden.FechaProduccion).toISOString().slice(0, 10) : null,
  };
}


// GET /api/etiqueta-impresa?orden=123 — histórico de etiquetas impresas de una captura
router.get("/", requireAuth, requirePerm("etiquetado", "imprimir"), async (req: Request, res: Response) => {
  try {
    const ordenId = req.query.orden ? Number(req.query.orden) : undefined;
    if (!ordenId) { res.status(400).json({ error: "Parámetro 'orden' requerido" }); return; }
    const rows: any[] = await prisma.$queryRaw`
      SELECT ei.EtiquetaId, ei.OrdenId, ei.Estatus, ei.RegistradoPor, ei.CreadoEn,
             (SELECT COUNT(*) FROM ImpresionLog il WHERE il.EtiquetaId = ei.EtiquetaId) AS VecesImpresa
      FROM EtiquetaImpresa ei
      WHERE ei.OrdenId = ${ordenId}
      ORDER BY ei.EtiquetaId ASC
    `;
    res.json(rows.map(r => ({
      ...r, EtiquetaId: Number(r.EtiquetaId), OrdenId: Number(r.OrdenId), VecesImpresa: Number(r.VecesImpresa),
      Correlativo: "E" + r.EtiquetaId,
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/etiqueta-impresa  { OrdenId }
// Crea TODAS las etiquetas pendientes de esa captura (CantidadMaster - Impresas) de una vez —
// revisado jul 2026: ya no es una por una bajo demanda, se declara e imprime en bloque al confirmar.
// Cada una es su propia EtiquetaImpresa con su propio correlativo/QR; el ZPL de todas se concatena
// (varios bloques ^XA...^XZ) en un solo envío a Browser Print, que la impresora imprime en secuencia.
router.post("/", requireAuth, requirePerm("etiquetado", "imprimir"), async (req: Request, res: Response) => {
  try {
    const { OrdenId, ConfirmarLineaCompleta } = req.body;
    if (!OrdenId) { res.status(400).json({ error: "OrdenId es requerido" }); return; }

    const orden = await obtenerDatosOrden(Number(OrdenId));
    if (!orden) { res.status(404).json({ error: "Orden de etiquetado no encontrada" }); return; }

    // Respaldo de servidor del aviso "línea ya completa" — antes solo vivía como confirm() en el
    // frontend, sin nada que lo respaldara si alguien llamaba la API directo. Mismo criterio
    // "advertir, no bloquear" de siempre: se detiene con 409 salvo que venga
    // ConfirmarLineaCompleta=true (el frontend ya lo manda así una vez que el usuario confirmó en
    // pantalla). No necesita candado de concurrencia — es informativo, no un cupo que proteger.
    // Objetivo null = pedido general: no hay objetivo que alcanzar, así que no hay nada que advertir.
    if (!ConfirmarLineaCompleta) {
      const techo = await calcularTechoLinea(prisma, Number(orden.DetalleId));
      if (techo && techo.Objetivo !== null && techo.Escaneado >= techo.Objetivo) {
        res.status(409).json({
          error: `La línea de este pedido ya tiene ${techo.Escaneado}/${techo.Objetivo} masters escaneados en bodega — ya alcanzó su objetivo.`,
          LineaCompleta: true, Objetivo: techo.Objetivo, Escaneado: techo.Escaneado,
        });
        return;
      }
    }

    const operador = getOperador(req);
    const correlativos: string[] = [];
    let impresas = 0;
    let pendientes = 0;

    // Estatus + cupo + creación en la MISMA transacción, con la fila de la captura bloqueada
    // (FOR UPDATE): antes el conteo se hacía fuera y dos estaciones confirmando la misma captura
    // a la vez leían ambas el mismo "pendientes" y duplicaban la tanda completa. Con el candado,
    // la segunda espera el commit de la primera y ya ve el cupo consumido.
    // LAST_INSERT_ID() es por conexión — debe leerse en la misma transacción que el INSERT,
    // si no el pool de conexiones puede devolver el id de otra sesión concurrente.
    await prisma.$transaction(async (tx) => {
      const capturaRows: any[] = await tx.$queryRaw`
        SELECT CantidadMaster, Estatus FROM OrdenEtiquetado WHERE OrdenId = ${Number(OrdenId)} FOR UPDATE
      `;
      if (!capturaRows.length) throw new ErrorNegocio(404, "Orden de etiquetado no encontrada");
      if (capturaRows[0].Estatus === "Cancelada") throw new ErrorNegocio(400, "Esta captura está cancelada, no se puede imprimir");

      const impresasRows: any[] = await tx.$queryRaw`
        SELECT COUNT(*) AS n FROM EtiquetaImpresa WHERE OrdenId = ${Number(OrdenId)} AND Estatus = 'Activa'
      `;
      impresas = Number(impresasRows[0].n);
      const cantidadMaster = Number(capturaRows[0].CantidadMaster);
      pendientes = cantidadMaster - impresas;
      if (pendientes <= 0) throw new ErrorNegocio(400, `Ya se imprimieron las ${cantidadMaster} etiquetas declaradas para esta captura`);

      for (let i = 0; i < pendientes; i++) {
        await tx.$executeRaw`INSERT INTO EtiquetaImpresa (OrdenId, RegistradoPor) VALUES (${Number(OrdenId)}, ${operador})`;
        const fila: any[] = await tx.$queryRaw`SELECT LAST_INSERT_ID() AS id`;
        const id = Number(fila[0].id);
        await tx.$executeRaw`INSERT INTO ImpresionLog (EtiquetaId, Motivo, ImpresoPor) VALUES (${id}, ${"Impresión inicial"}, ${operador})`;

        // Cola de la etiqueta de CLIENTE (BarTender -> Epson A4). Va en la misma transacción que la
        // etiqueta interna de Zebra porque un master necesita las dos: si la transacción se revierte,
        // no debe quedar una pidiendo imprimirse sin la otra.
        // Los descriptivos se copian, no se referencian: la fila debe conservar lo que se imprimió
        // aunque el pedido se edite después. ImpresoEn queda NULL hasta que BarTender confirme.
        await tx.$executeRaw`
          INSERT INTO ColaEtiquetaBartender
            (EtiquetaId, OrdenId, Correlativo, CodigoPedido, Cliente, Subcliente, Proceso, Talla,
             Presentacion, Lote, Color, Origen, Congelacion, Area, FechaProduccion)
          VALUES (${id}, ${Number(OrdenId)}, ${"E" + id}, ${orden.CodigoPedido}, ${orden.NombreCliente},
                  ${orden.NombreSubcliente}, ${orden.DescripcionProceso}, ${orden.DescripcionTalla},
                  ${orden.DescripcionPresentacion}, ${orden.Lote}, ${orden.Color},
                  ${orden.DescripcionOrigen}, ${orden.DescripcionCongelacion}, ${orden.NombreArea},
                  ${orden.FechaProduccion})
        `;
        correlativos.push("E" + id);
      }
    }, { timeout: 60_000 });

    // Ya no se devuelve ZPL: la impresión física la hace BarTender leyendo ColaEtiquetaBartender.
    // Acá solo se reservan los correlativos y se deja la cola lista para que el operador abra
    // BarTender con el rango recién creado.
    res.status(201).json({
      ok: true, Cantidad: pendientes, Correlativos: correlativos,
      Impresas: impresas + pendientes, CantidadMaster: Number(orden.CantidadMaster),
    });
  } catch (err: any) {
    if (err instanceof ErrorNegocio) { res.status(err.status).json({ error: err.message }); return; }
    res.status(500).json({ error: err.message });
  }
});

// GET /api/etiqueta-impresa/orden/:ordenId/bartender[?desde=28&hasta=37]
// Datos para abrir BarTender Designer con la etiqueta de CLIENTE (la de arte complejo, que va a la
// Epson A4). No sustituye la etiqueta interna 3x1 de la Zebra: son dos caminos paralelos.
//
// Devuelve una URL del protocolo oroetiqueta://, que un manejador registrado en la PC del operador
// traduce a `BarTend.exe /F="plantilla.btw" /?Orden= /?Desde= /?Hasta=` (ver
// herramientas/bartender/). Esa vuelta existe porque el backend corre en kronos, en internet, y no
// puede lanzar programas en la máquina del operador; el navegador tampoco.
//
// El filtro lleva OrdenId ADEMÁS del rango, nunca el rango solo: los EtiquetaId son
// autoincrementales y otra orden imprimiendo a la vez puede intercalar ids, así que un rango suelto
// podría arrastrar etiquetas de otro pedido.
router.get("/orden/:ordenId/bartender", requireAuth, requirePerm("etiquetado", "imprimir"), async (req: Request, res: Response) => {
  try {
    const ordenId = Number(req.params.ordenId);
    const orden = await obtenerDatosOrden(ordenId);
    if (!orden) { res.status(404).json({ error: "Orden de etiquetado no encontrada" }); return; }

    const rutaBtw = await resolverRutaBtw(Number(orden.CodigoCliente), orden.CodigoSubcliente);
    if (!rutaBtw) {
      res.status(400).json({
        error: `No hay diseño de BarTender asignado a ${orden.NombreSubcliente || orden.NombreCliente}. ` +
               `Asígnalo en Pedidos y Clientes → Clientes y Subclientes.`,
      });
      return;
    }

    // Sin rango explícito se abre todo lo que siga activo de esta orden.
    let desde = parseCorrelativo(req.query.desde);
    let hasta = parseCorrelativo(req.query.hasta);
    if (desde === null || hasta === null) {
      const rango: any[] = await prisma.$queryRaw`
        SELECT MIN(EtiquetaId) AS minId, MAX(EtiquetaId) AS maxId
        FROM EtiquetaImpresa WHERE OrdenId = ${ordenId} AND Estatus = 'Activa'
      `;
      if (rango[0].minId === null) { res.status(400).json({ error: "Esta captura no tiene etiquetas activas que imprimir" }); return; }
      desde = Number(rango[0].minId);
      hasta = Number(rango[0].maxId);
    }
    if (desde > hasta) { res.status(400).json({ error: "El correlativo inicial no puede ser mayor que el final" }); return; }

    // Se cuenta contra la cola, no contra EtiquetaImpresa, para poder distinguir lo ya impreso por
    // BarTender (ImpresoEn con fecha) de lo que sigue pendiente en papel.
    const conteo: any[] = await prisma.$queryRaw`
      SELECT COUNT(*) AS total, SUM(ImpresoEn IS NULL) AS pendientes
      FROM ColaEtiquetaBartender
      WHERE OrdenId = ${ordenId} AND EtiquetaId BETWEEN ${desde} AND ${hasta}
    `;

    // Credencial de un solo uso para que BarTender pueda avisar que imprimió (ver POST
    // /bartender/impreso). Va firmada con el rango adentro: no es una llave general de la API, solo
    // permite marcar ESTE tramo de ESTA captura, y caduca. Así el .btw no guarda ninguna contraseña
    // permanente — es un archivo que cualquiera puede abrir desde el recurso compartido.
    const token = jwt.sign(
      { o: ordenId, d: desde, h: hasta },
      process.env.JWT_SECRET!,
      { subject: TOKEN_BARTENDER_SUBJECT, expiresIn: TOKEN_BARTENDER_VIGENCIA }
    );

    const url = `oroetiqueta://imprimir?btw=${encodeURIComponent(rutaBtw)}`
      + `&orden=${ordenId}&desde=${desde}&hasta=${hasta}&token=${encodeURIComponent(token)}`;

    res.json({
      OrdenId: ordenId,
      RutaBtw: rutaBtw,
      Desde: desde,
      Hasta: hasta,
      Correlativos: `E${desde} a E${hasta}`,
      Etiquetas: Number(conteo[0].total),
      Pendientes: Number(conteo[0].pendientes ?? 0),
      Cliente: orden.NombreCliente,
      Subcliente: orden.NombreSubcliente,
      Url: url,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/etiqueta-impresa/orden/:ordenId/reservar  { Desde, Hasta }
// Deja escrito en la cola qué tanda va a salir AHORA, justo antes de abrir BarTender. La plantilla
// filtra por eso y no por rango, así que su consulta es una línea fija sin solicitudes de consulta:
//
//     SELECT * FROM ColaEtiquetaBartender
//      WHERE SolicitadoEn IS NOT NULL AND ImpresoEn IS NULL
//      ORDER BY EtiquetaId
//
// LIMITACIÓN CONOCIDA: una tanda a la vez. Reservar suelta lo reservado antes, así que dos
// estaciones imprimiendo simultáneamente se pisan — la segunda le quita la tanda a la primera, que
// termina imprimiendo etiquetas ajenas y confirmando las suyas sin que hayan salido. Se probó una
// versión con un id por reserva que lo resolvía (columna ReservaId + una solicitud ?Reserva en la
// plantilla) y se descartó porque complicaba la configuración de los diseños.
//
// El paso 1 (soltar lo anterior) y el paso 2 (reservar) van en la MISMA transacción: si se
// separaran, un fallo entre ambos dejaría la cola vacía y BarTender imprimiría cero etiquetas.
router.post("/orden/:ordenId/reservar", requireAuth, requirePerm("etiquetado", "imprimir"), async (req: Request, res: Response) => {
  try {
    const ordenId = Number(req.params.ordenId);
    if (!ordenId) { res.status(400).json({ error: "OrdenId inválido" }); return; }
    const desde = parseCorrelativo(req.body?.Desde);
    const hasta = parseCorrelativo(req.body?.Hasta);
    if (!desde || !hasta || desde > hasta) { res.status(400).json({ error: "Rango de correlativos inválido" }); return; }

    const operador = getOperador(req);

    const reservadas = await prisma.$transaction(async (tx) => {
      // Lo que quedó reservado de un intento anterior se suelta: si el operador abrió BarTender y no
      // imprimió, esas etiquetas siguen pendientes, solo dejan de estar en la cola de "imprimir ahora".
      await tx.$executeRaw`
        UPDATE ColaEtiquetaBartender
           SET SolicitadoEn = NULL, SolicitadoPor = NULL
         WHERE SolicitadoEn IS NOT NULL AND ImpresoEn IS NULL
      `;
      return await tx.$executeRaw`
        UPDATE ColaEtiquetaBartender
           SET SolicitadoEn = NOW(), SolicitadoPor = ${operador}
         WHERE OrdenId = ${ordenId} AND EtiquetaId BETWEEN ${desde} AND ${hasta} AND ImpresoEn IS NULL
      `;
      // 60 s como el resto del módulo: el valor por omisión de Prisma son 5 s, y con la base en otro
      // servidor (~111 ms por ida y vuelta) dos UPDATE más BEGIN/COMMIT se pasaban de ese margen.
    }, { timeout: 60_000 });

    res.json({ ok: true, OrdenId: ordenId, Desde: desde, Hasta: hasta, Reservadas: Number(reservadas) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/etiqueta-impresa/bartender/impreso  { Token, Orden, Desde, Hasta, Impresora }
// Aviso de BarTender al terminar de imprimir — es lo que cierra el ciclo. Sin esto "impresa" solo
// quiere decir "correlativo reservado", que es lo que la pantalla muestra como Generadas: papel y
// base de datos podían discrepar sin que nadie se enterara (ej. la PC sin el protocolo instalado,
// donde el botón no abría nada y la captura igual se veía completa).
//
// Lo dispara el evento de documento "Print Job Sent" con la acción "Send Web Service Request" —
// ver herramientas/bartender/README.md para cómo se configura del lado de la plantilla.
//
// NO lleva requireAuth a propósito: quien llama es BarTender, un programa de escritorio que no
// tiene sesión. La credencial es el token firmado que se emitió al abrir la plantilla.
router.post("/bartender/impreso", async (req: Request, res: Response) => {
  try {
    const { Token, Orden, Desde, Hasta, Impresora } = req.body ?? {};
    if (!Token) { res.status(401).json({ error: "Falta el token de impresión" }); return; }

    let permiso: any;
    try {
      permiso = jwt.verify(String(Token), process.env.JWT_SECRET!, { subject: TOKEN_BARTENDER_SUBJECT });
    } catch (err: any) {
      res.status(401).json({
        error: err?.name === "TokenExpiredError"
          ? "El permiso de impresión venció. Vuelve a abrir la plantilla desde Impresión de Etiquetas."
          : "Token de impresión inválido",
      });
      return;
    }

    const ordenId = Number(permiso.o);
    const techoDesde = Number(permiso.d);
    const techoHasta = Number(permiso.h);

    // El rango del cuerpo son los prompts con los que BarTender REALMENTE imprimió: el operador pudo
    // estrecharlos en el diálogo de la plantilla, y ese es el dato verdadero. El token solo pone el
    // techo — nunca se marca fuera de lo que se autorizó. Sin rango en el cuerpo se toma el techo.
    //
    // Un valor presente pero ilegible NO se degrada al techo: si el prompt del .btw quedó mal
    // nombrado, BarTender manda basura sin quejarse, y confirmar la tanda completa por eso sería
    // decir que salió papel que nadie vio. Mejor un error visible en la bitácora de BarTender.
    const rangoInformado = (valor: any, porDefecto: number): number => {
      if (valor === undefined || valor === null || String(valor).trim() === "") return porDefecto;
      const n = parseCorrelativo(valor);
      if (n === null) throw new ErrorNegocio(400, `Correlativo inválido en el aviso de impresión: "${valor}"`);
      return n;
    };
    const desde = rangoInformado(Desde, techoDesde);
    const hasta = rangoInformado(Hasta, techoHasta);
    if (Orden != null && Number(Orden) !== ordenId) {
      res.status(403).json({ error: "El token no corresponde a esa captura" }); return;
    }
    if (desde > hasta || desde < techoDesde || hasta > techoHasta) {
      res.status(403).json({ error: "El rango informado se sale del que autorizó el token" }); return;
    }

    const impresora = typeof Impresora === "string" && Impresora.trim()
      ? Impresora.trim().slice(0, 200) : null;

    // ImpresoEn IS NULL deja la operación idempotente: la acción de BarTender trae reintentos
    // propios, y un aviso repetido no debe correr la hora ni contar la etiqueta dos veces.
    const marcadas = await prisma.$executeRaw`
      UPDATE ColaEtiquetaBartender
         SET ImpresoEn = NOW(), Impresora = ${impresora}
       WHERE OrdenId = ${ordenId} AND EtiquetaId BETWEEN ${desde} AND ${hasta} AND ImpresoEn IS NULL
    `;

    res.json({ ok: true, OrdenId: ordenId, Desde: desde, Hasta: hasta, Marcadas: Number(marcadas) });
  } catch (err: any) {
    if (err instanceof ErrorNegocio) { res.status(err.status).json({ error: err.message }); return; }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/etiqueta-impresa/orden/:ordenId/confirmar-impresion  { Desde, Hasta }
// Confirmación HUMANA de que la tanda salió en papel, para cuando BarTender no avisa solo (la
// plantilla sin la acción configurada, una PC vieja, la impresora conectada a otra máquina).
//
// Existe porque la alternativa es peor: sin esto, la única salida cuando el aviso falla es entrar a
// la base a mano, y una captura que se quedó sin confirmar bloquea el filtro `ImpresoEn IS NULL`
// para siempre.
//
// Lo que NO hace es marcar solo. Aquí una persona con permiso de impresión afirma haber visto el
// papel, y queda escrito quién fue: Impresora guarda "Confirmado por X" en vez del nombre real del
// equipo, para que después se distinga de un aviso automático de BarTender. Esa diferencia importa
// — un dato que el sistema observó y uno que alguien aseguró no valen lo mismo al investigar.
router.post("/orden/:ordenId/confirmar-impresion", requireAuth, requirePerm("etiquetado", "imprimir"), async (req: Request, res: Response) => {
  try {
    const ordenId = Number(req.params.ordenId);
    if (!ordenId) { res.status(400).json({ error: "Captura inválida" }); return; }
    const { Desde, Hasta } = req.body ?? {};

    // Sin rango se confirma todo lo pendiente de la captura.
    const desde = parseCorrelativo(Desde);
    const hasta = parseCorrelativo(Hasta);
    if ((Desde != null && desde === null) || (Hasta != null && hasta === null)) {
      res.status(400).json({ error: "Rango de correlativos inválido" }); return;
    }
    if (desde !== null && hasta !== null && desde > hasta) {
      res.status(400).json({ error: "El correlativo inicial no puede ser mayor que el final" }); return;
    }

    const operador = getOperador(req);
    const marca = `Confirmado por ${operador}`.slice(0, 200);

    const marcadas = desde !== null && hasta !== null
      ? await prisma.$executeRaw`
          UPDATE ColaEtiquetaBartender SET ImpresoEn = NOW(), Impresora = ${marca}
           WHERE OrdenId = ${ordenId} AND EtiquetaId BETWEEN ${desde} AND ${hasta} AND ImpresoEn IS NULL`
      : await prisma.$executeRaw`
          UPDATE ColaEtiquetaBartender SET ImpresoEn = NOW(), Impresora = ${marca}
           WHERE OrdenId = ${ordenId} AND ImpresoEn IS NULL`;

    if (Number(marcadas) === 0) {
      res.status(400).json({ error: "No hay etiquetas pendientes de confirmar en esa captura" }); return;
    }
    res.json({ ok: true, OrdenId: ordenId, Marcadas: Number(marcadas), ConfirmadoPor: operador });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/etiqueta-impresa/:id/consultar  (acepta "E47" o "47" en :id)
// Consulta completa de un correlativo: existencia/Estatus, qué producto lleva, historial de
// impresión (ImpresionLog), y si ya está escaneado en bodega (y dónde). Sirve en dos lugares: en
// Impresión, para investigar un correlativo antes de anularlo; y en Bodega, para entender un escaneo
// rechazado o una caja que aparece sin explicación — por eso acepta también el permiso bodega.ver,
// no solo etiquetado.imprimir.
router.get("/:id/consultar", requireAuth, requireAnyPerm([["etiquetado", "imprimir"], ["bodega", "ver"]]), async (req: Request, res: Response) => {
  try {
    const etiquetaId = parseCorrelativo(req.params.id);
    if (!etiquetaId) { res.status(400).json({ error: "Correlativo inválido" }); return; }

    const etiquetaRows: any[] = await prisma.$queryRaw`
      SELECT EtiquetaId, OrdenId, Estatus, RegistradoPor, CreadoEn, AnuladoPor, AnuladoEn, MotivoAnulacion
      FROM EtiquetaImpresa WHERE EtiquetaId = ${etiquetaId} LIMIT 1
    `;
    if (!etiquetaRows.length) { res.status(404).json({ error: `No existe ninguna etiqueta con el correlativo E${etiquetaId}` }); return; }
    const etiqueta = etiquetaRows[0];

    const [orden, historialRows, master] = await Promise.all([
      obtenerDatosOrden(Number(etiqueta.OrdenId)),
      prisma.$queryRaw`
        SELECT LogId, Motivo, ReimpresionForzada, ImpresoPor, FechaHora
        FROM ImpresionLog WHERE EtiquetaId = ${etiquetaId} ORDER BY FechaHora ASC, LogId ASC
      ` as Promise<any[]>,
      buscarMasterPorEtiqueta(prisma, etiquetaId),
    ]);

    res.json({
      EtiquetaId: etiquetaId,
      Correlativo: "E" + etiquetaId,
      Estatus: etiqueta.Estatus,
      Anulacion: etiqueta.Estatus === "Anulada"
        ? { AnuladoPor: etiqueta.AnuladoPor, AnuladoEn: etiqueta.AnuladoEn, Motivo: etiqueta.MotivoAnulacion }
        : null,
      CapturaEstatus: orden?.EstatusOrden ?? null,
      Producto: orden ? datosDesdeOrden(orden, "E" + etiquetaId) : null,
      VecesImpresa: historialRows.length,
      Historial: historialRows.map(h => ({
        LogId: Number(h.LogId), Motivo: h.Motivo, ReimpresionForzada: Boolean(Number(h.ReimpresionForzada)),
        ImpresoPor: h.ImpresoPor, FechaHora: h.FechaHora,
      })),
      YaEscaneado: Boolean(master),
      Master: master,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/etiqueta-impresa/:id/anular  { Motivo }
// Cierra el hueco real que tenía el estatus 'Anulada': existía en el schema y se validaba al
// escanear, pero no había ninguna ruta que lo estableciera. Para una etiqueta cuyo master
// físico se dañó, se reprocesó o se descartó ANTES de llegar a bodega — sin esto, esa etiqueta queda
// "Activa" para siempre: cuenta como impresa pero nunca se va a poder escanear, y cualquier reporte
// de Declarado/Impreso/Escaneado muestra un faltante fantasma permanente. Requiere etiquetado.editar
// (no solo imprimir) — es una corrección
// administrativa, no la operación diaria.
router.put("/:id/anular", requireAuth, requirePerm("etiquetado", "editar"), async (req: Request, res: Response) => {
  try {
    const etiquetaId = Number(req.params.id);
    const { Motivo } = req.body;
    if (!Motivo || !String(Motivo).trim()) { res.status(400).json({ error: "El motivo de la anulación es requerido" }); return; }

    const etiquetaRows: any[] = await prisma.$queryRaw`SELECT EtiquetaId, Estatus FROM EtiquetaImpresa WHERE EtiquetaId = ${etiquetaId} LIMIT 1`;
    if (!etiquetaRows.length) { res.status(404).json({ error: "Etiqueta no encontrada" }); return; }
    if (etiquetaRows[0].Estatus !== "Activa") { res.status(400).json({ error: "Esta etiqueta ya está anulada" }); return; }

    // A propósito NO se rechaza aquí si la captura padre está Cancelada — al revés que reactivar,
    // anular es exactamente la herramienta correcta para cerrar una etiqueta huérfana de
    // una captura cancelada (nunca va a escanearse), así que bloquearla dejaría esas etiquetas sin
    // ninguna salida posible.

    // Si el master ya está en bodega, anularla no tiene sentido — la corrección correcta es quitarlo
    // del pallet (libera el correlativo), no anular una etiqueta que ya cumplió su propósito.
    // Y si el pallet ya está POSICIONADO en bodega física, ni siquiera existe esa corrección: el
    // contenido está sellado (candado de posicionamiento) — solo una des-ubicación administrativa
    // lo reabre.
    const master = await buscarMasterPorEtiqueta(prisma, etiquetaId);
    if (master) {
      // Despachado = fuera de la planta. Va ANTES del chequeo de posición a propósito: la remisión
      // libera la posición al confirmarse, así que un master embarcado llega aquí con PosicionCodigo
      // en null y, sin esta rama, caería en el mensaje genérico "quítalo del pallet primero" — una
      // corrección imposible sobre producto que ya se entregó al cliente.
      if (master.Estatus === "Salido") {
        res.status(400).json({
          error: `Este master ya salió de bodega${master.RemisionFolio ? ` en la remisión ${master.RemisionFolio}` : ""} — no se puede anular su etiqueta.`,
        });
        return;
      }
      if (master.PosicionCodigo) {
        res.status(400).json({
          error: `Este master está en el pallet ${master.PalletCodigo}, ya posicionado en bodega física (${master.PosicionCodigo}) — su contenido está sellado y no se puede anular.`,
        });
        return;
      }
      res.status(400).json({
        error: `Este master ya está escaneado en bodega (pallet ${master.PalletCodigo}) — no se puede anular. Si es una corrección, quítalo del pallet primero.`,
      });
      return;
    }

    const operador = getOperador(req);
    await prisma.$executeRaw`
      UPDATE EtiquetaImpresa SET Estatus = 'Anulada', AnuladoPor = ${operador}, AnuladoEn = NOW(), MotivoAnulacion = ${String(Motivo).trim()}
      WHERE EtiquetaId = ${etiquetaId}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/etiqueta-impresa/:id/reactivar — corrección administrativa (ej. se anuló por error).
// Mismo criterio que Pallets.reabrir: limpia los datos de la anulación en vez de conservar un
// historial de ciclos, porque es una corrección puntual, no una operación frecuente.
router.put("/:id/reactivar", requireAuth, requirePerm("etiquetado", "editar"), async (req: Request, res: Response) => {
  try {
    const etiquetaId = Number(req.params.id);
    const etiquetaRows: any[] = await prisma.$queryRaw`SELECT EtiquetaId, OrdenId, Estatus FROM EtiquetaImpresa WHERE EtiquetaId = ${etiquetaId} LIMIT 1`;
    if (!etiquetaRows.length) { res.status(404).json({ error: "Etiqueta no encontrada" }); return; }
    if (etiquetaRows[0].Estatus !== "Anulada") { res.status(400).json({ error: "Esta etiqueta no está anulada" }); return; }

    // A diferencia de anular, reactivar SÍ se bloquea si la captura padre está cancelada — no tiene
    // sentido devolver una etiqueta a Activa bajo una captura que ya no es válida.
    const capturaRows: any[] = await prisma.$queryRaw`SELECT Estatus FROM OrdenEtiquetado WHERE OrdenId = ${Number(etiquetaRows[0].OrdenId)} LIMIT 1`;
    if (capturaRows.length && capturaRows[0].Estatus === "Cancelada") {
      res.status(400).json({ error: "La captura de esta etiqueta está cancelada, no se puede reactivar." });
      return;
    }

    await prisma.$executeRaw`
      UPDATE EtiquetaImpresa SET Estatus = 'Activa', AnuladoPor = NULL, AnuladoEn = NULL, MotivoAnulacion = NULL
      WHERE EtiquetaId = ${etiquetaId}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/etiqueta-impresa/atascadas?horas=24
// Alerta operativa: etiquetas impresas hace más de N horas (default 24) que todavía no tienen master
// correspondiente en bodega. Es la señal más temprana posible de una etiqueta perdida, pegada a la
// caja equivocada, o simplemente olvidada en algún rincón de planta — detectarlo aquí evita que el
// hueco se descubra recién cuando el pallet ya está en la bodega física real, donde es más caro
// corregirlo. Excluye Anuladas a propósito: una etiqueta anulada nunca va a escanearse y eso es lo
// esperado, no una alerta. También excluye las de una captura Cancelada — esas tampoco van a
// escanearse nunca (no es que estén "perdidas", su captura ya no es válida); la corrección ahí es
// anularlas desde el historial, no investigarlas como si fueran un extravío real.
router.get("/atascadas", requireAuth, requirePerm("etiquetado", "imprimir"), async (req: Request, res: Response) => {
  try {
    const horas = Number(req.query.horas) > 0 ? Number(req.query.horas) : 24;
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT ei.EtiquetaId, ei.CreadoEn, ei.RegistradoPor, TIMESTAMPDIFF(HOUR, ei.CreadoEn, NOW()) AS HorasDesdeImpresion,
             dp.CodigoPedido, cli.RazonSocial AS NombreCliente, sub.RazonSocial AS NombreSubcliente,
             oe.Lote, pc.Descripcion AS DescripcionProceso, ta.Descripcion AS DescripcionTalla, pr.Descripcion AS DescripcionPresentacion
      FROM EtiquetaImpresa ei
      JOIN OrdenEtiquetado oe ON ei.OrdenId = oe.OrdenId
      JOIN DetallePedido dp ON oe.DetalleId = dp.DetalleId
      JOIN Clase cl ON dp.Clase = cl.Clase
      JOIN Procesos pc ON cl.Proceso = pc.Proceso
      JOIN Tallas ta ON dp.Talla = ta.Codigo
      JOIN Presentacion pr ON dp.Presentacion = pr.Codigo
      JOIN Pedidos ped ON dp.CodigoPedido = ped.CodigoPedido
      JOIN Clientes cli ON ped.CodigoCliente = cli.Codigo
      LEFT JOIN Subcliente sub ON ped.CodigoCliente = sub.CodigoCliente AND ped.CodigoSubcliente = sub.CodigoSubcliente
      LEFT JOIN Masters m ON ei.EtiquetaId = m.EtiquetaId
      WHERE ei.Estatus = 'Activa' AND oe.Estatus != 'Cancelada' AND m.MasterId IS NULL AND ei.CreadoEn < (NOW() - INTERVAL ? HOUR)
      ORDER BY ei.CreadoEn ASC
      LIMIT 500
    `, horas);
    res.json(rows.map(r => ({
      ...r,
      EtiquetaId: Number(r.EtiquetaId),
      Correlativo: "E" + Number(r.EtiquetaId),
      HorasDesdeImpresion: Number(r.HorasDesdeImpresion),
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
