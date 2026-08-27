import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm, tienePermiso, AuthRequest } from "../middleware/auth.ts";
import { buscarMasterPorEtiqueta, calcularTechoLinea, MASTER_SELECT, formatearMaster } from "../lib/masters.ts";

const router = Router();

// Error de negocio lanzado DENTRO de una transacción — el catch de la ruta lo traduce a su
// status HTTP en vez de un 500 genérico (mismo patrón que etiquetaImpresa.ts).
class ErrorNegocio extends Error {
  status: number;
  constructor(status: number, mensaje: string) {
    super(mensaje);
    this.status = status;
  }
}

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

// Cuadre = meta de referencia, no bloquea el escaneo (decisión jul 2026): compara lo realmente
// escaneado contra CantidadMaster (la cantidad que se planeó que llevaría el polín al crearlo).
// Mismo patrón que el cierre de captura de Etiquetado. Si el pallet no tiene CantidadMaster (los
// creados antes de esta decisión) no aplica.
function calcularCuadre(cantidadMaster: number | null, escaneados: number): string | null {
  if (cantidadMaster == null) return null;
  if (escaneados === cantidadMaster) return "Completo";
  return escaneados < cantidadMaster ? "Incompleto" : "Sobrante";
}

async function obtenerMastersDePallet(palletId: number) {
  const rows: any[] = await prisma.$queryRawUnsafe(`${MASTER_SELECT} WHERE m.PalletId = ? ORDER BY m.MasterId ASC`, palletId);
  return rows.map(formatearMaster);
}

// Quitar masters solo tiene sentido con el polín Abierto: uno Cerrado está sellado (y si además está
// posicionado, ni siquiera se puede reabrir). Bloquea la fila para serializar contra otro escaneo
// simultáneo al mismo polín, igual que /escanear.
export async function bloquearPalletAbierto(tx: any, palletId: number) {
  const rows: any[] = await tx.$queryRaw`SELECT Codigo, Estatus FROM Pallets WHERE PalletId = ${palletId} LIMIT 1 FOR UPDATE`;
  if (!rows.length) throw new ErrorNegocio(404, "Pallet no encontrado");
  if (rows[0].Estatus !== "Abierto") throw new ErrorNegocio(400, "Este pallet no está abierto, no se pueden quitar masters");
  return rows[0] as { Codigo: string; Estatus: string };
}

// Saca un master del pallet. Hay DOS casos distintos según cómo llegó aquí:
//   - Escaneado directo (ingreso normal): se BORRA la fila de Masters. "Nunca entró a bodega", y el
//     correlativo queda libre para re-escanearse.
//   - Llegado por TRASLADO (consolidación de sobrantes): NO se puede borrar — ese master sí existe
//     en bodega desde antes, borrarlo lo haría desaparecer del inventario. Se DESHACE el traslado:
//     vuelve a su polín de origen, que es de donde salió.
//     Además la fila de Masters está referenciada por el kardex (fk_movbodega_master), así que un
//     DELETE reventaba con error de llave foránea — que es como se detectó este caso.
// Compartida por las dos formas de quitar (el botón de cada fila y el escaneo en tanda): son la
// misma operación, lo único que cambia es cómo se identificó el master.
export async function quitarMasterDePallet(tx: any, palletId: number, masterId: number, operador: string) {
  const masterRows: any[] = await tx.$queryRaw`
    SELECT MasterId, Estatus FROM Masters WHERE MasterId = ${masterId} AND PalletId = ${palletId} LIMIT 1 FOR UPDATE
  `;
  if (!masterRows.length) throw new ErrorNegocio(404, "Master no encontrado en este pallet");

  // Un master tomado por una remisión no se puede quitar por aquí: su fila está referenciada desde
  // RemisionDetalle, así que el DELETE reventaría con llave foránea y el traslado deshecho lo sacaría
  // de debajo de una salida ya registrada. Se saca primero de la remisión (mismo criterio que usa
  // /escanear para no dejar mover una caja comprometida).
  const remisionRows: any[] = await tx.$queryRaw`
    SELECT r.Folio FROM RemisionDetalle rd
    JOIN Remisiones r ON rd.RemisionId = r.RemisionId
    WHERE rd.MasterId = ${masterId} AND rd.Vigente = 1 LIMIT 1
  `;
  if (remisionRows.length) {
    throw new ErrorNegocio(400, masterRows[0].Estatus === "Salido"
      ? `Este master ya salió de bodega en la remisión ${remisionRows[0].Folio} — no se puede quitar del polín.`
      : `Este master está comprometido en la remisión ${remisionRows[0].Folio} — quítalo de ahí antes de sacarlo del polín.`);
  }
  if (masterRows[0].Estatus === "Salido") {
    throw new ErrorNegocio(400, "Este master ya salió de bodega — no se puede quitar del polín.");
  }

  // El último traslado hacia ESTE pallet dice de dónde vino. Si no hay ninguno, el master
  // entró por escaneo normal y se puede borrar.
  const trasladoRows: any[] = await tx.$queryRaw`
    SELECT mb.PalletOrigenId, po.Codigo AS PalletOrigenCodigo, po.Estatus AS PalletOrigenEstatus
    FROM MovimientosBodega mb
    LEFT JOIN Pallets po ON mb.PalletOrigenId = po.PalletId
    WHERE mb.MasterId = ${masterId} AND mb.Tipo = 'TRASLADO' AND mb.PalletId = ${palletId}
    ORDER BY mb.MovimientoId DESC LIMIT 1
  `;

  if (!trasladoRows.length || trasladoRows[0].PalletOrigenId == null) {
    await tx.$executeRaw`DELETE FROM Masters WHERE MasterId = ${masterId} AND PalletId = ${palletId}`;
    return { ok: true, Accion: "Eliminado", MasterId: masterId, PalletOrigen: null as string | null };
  }

  // Vuelve como EnBodega: su polín de origen está Abierto (es el único desde el que se pudo
  // haber movido), así que ahí las cajas son carga normal del polín.
  const origenId = Number(trasladoRows[0].PalletOrigenId);
  await tx.$executeRaw`UPDATE Masters SET PalletId = ${origenId}, Estatus = 'EnBodega' WHERE MasterId = ${masterId}`;
  await tx.$executeRaw`
    INSERT INTO MovimientosBodega (PalletId, PalletOrigenId, MasterId, Tipo, PosicionOrigenId, PosicionDestinoId, Usuario, Motivo)
    VALUES (${origenId}, ${palletId}, ${masterId}, 'TRASLADO', NULL, NULL, ${operador},
            ${`Traslado deshecho: vuelve al polín ${trasladoRows[0].PalletOrigenCodigo}`})
  `;
  return { ok: true, Accion: "TrasladoDeshecho", MasterId: masterId, PalletOrigen: trasladoRows[0].PalletOrigenCodigo as string };
}

// Quitar un master identificándolo por el QR que se acaba de leer, en vez de por su fila en la
// tabla. Todo el criterio vive aquí (y no en el handler) para que la ruta quede de una línea y esta
// operación se pueda ejercitar contra la base real sin levantar el servidor.
export async function quitarMasterEscaneado(tx: any, palletId: number, correlativo: any, operador: string) {
  const etiquetaId = parseCorrelativo(correlativo);
  if (!etiquetaId) throw new ErrorNegocio(400, "Correlativo inválido");

  await bloquearPalletAbierto(tx, palletId);

  const master = await buscarMasterPorEtiqueta(tx, etiquetaId);
  if (!master) throw new ErrorNegocio(404, "Este master no está escaneado en ningún polín");
  // Escanear la caja equivocada es el error que este flujo tiene que atajar: si el QR es de otro
  // polín no se toca nada, se dice dónde está y el operador la devuelve a su lugar.
  if (master.PalletId !== palletId) {
    throw new ErrorNegocio(400, `Este master no está en este polín, está en el ${master.PalletCodigo}`);
  }

  const resultado = await quitarMasterDePallet(tx, palletId, master.MasterId, operador);
  // Correlativo de vuelta para que la pantalla arme el renglón del historial de la tanda con lo que
  // ya tiene cargado del master — sin repetir aquí el join de 10 tablas por cada escaneo.
  return { ...resultado, Correlativo: "E" + etiquetaId };
}

// GET /api/pallets?estatus=Abierto&fecha=2026-07-14
router.get("/", requireAuth, requirePerm("bodega", "ver"), async (req: Request, res: Response) => {
  try {
    const estatus = req.query.estatus as string | undefined;
    const fecha = req.query.fecha as string | undefined;
    const condiciones: string[] = [];
    const params: any[] = [];
    if (estatus) { condiciones.push("p.Estatus = ?"); params.push(estatus); }
    if (fecha) { condiciones.push("DATE(p.CreadoEn) = ?"); params.push(fecha); }
    const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT p.PalletId, p.Codigo, p.Estatus, p.Origen, org.Descripcion AS DescripcionOrigen, p.CantidadMaster,
             p.BodegaVirtualCodigo, bv.Nombre AS NombreBodegaVirtual,
             p.PosicionId, po.Codigo AS PosicionCodigo,
             p.CreadoPor, p.CreadoEn, p.CerradoPor, p.CerradoEn,
             -- Lo que SIGUE en el polín vs. lo que ya se despachó. Antes se contaba todo junto, así
             -- que un polín al que una remisión le sacó la mitad seguía mostrándose lleno y no había
             -- cómo detectar los que quedaron a medias ocupando una posición entera.
             (SELECT COUNT(*) FROM Masters m WHERE m.PalletId = p.PalletId AND m.Estatus <> 'Salido') AS CantidadMasters,
             (SELECT COUNT(*) FROM Masters m WHERE m.PalletId = p.PalletId AND m.Estatus = 'Salido') AS CantidadSalidos
      FROM Pallets p
      LEFT JOIN Origen org ON p.Origen = org.Codigo
      LEFT JOIN BodegaVirtual bv ON p.BodegaVirtualCodigo = bv.Codigo
      LEFT JOIN Posiciones po ON p.PosicionId = po.PosicionId
      ${where} ORDER BY p.PalletId DESC LIMIT 500
    `, ...params);
    res.json(rows.map(r => {
      const cantidadMaster = r.CantidadMaster == null ? null : Number(r.CantidadMaster);
      const cantidadMasters = Number(r.CantidadMasters);
      const cantidadSalidos = Number(r.CantidadSalidos);
      return {
        ...r, PalletId: Number(r.PalletId), CantidadMaster: cantidadMaster,
        CantidadMasters: cantidadMasters, CantidadSalidos: cantidadSalidos,
        // El Cuadre sigue midiendo lo que se ARMÓ (meta vs. total escaneado alguna vez), no lo que
        // queda: un polín que se armó completo y después despachó la mitad no fue "incompleto" al
        // armarlo. Lo que quedó a medias se ve en CantidadMasters/CantidadSalidos.
        Cuadre: calcularCuadre(cantidadMaster, cantidadMasters + cantidadSalidos),
      };
    }));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pallets/:id — cabecera + sus masters (con datos derivados)
// GET /api/pallets/codigo/:codigo — el mismo detalle, pero resolviendo por el código que trae el QR
// de la hoja del polín ("T0010"). Existe para que la consulta de la pantalla de Bodega acepte tanto
// un correlativo de master como un código de polín: quien está en piso lee lo que tiene enfrente y
// no sabe (ni tiene por qué) qué tipo de código es cada uno.
router.get("/codigo/:codigo", requireAuth, requirePerm("bodega", "ver"), async (req: Request, res: Response) => {
  try {
    const codigo = String(req.params.codigo ?? "").trim().toUpperCase();
    if (!codigo) { res.status(400).json({ error: "Código de polín requerido" }); return; }
    const rows: any[] = await prisma.$queryRaw`SELECT PalletId FROM Pallets WHERE Codigo = ${codigo} LIMIT 1`;
    if (!rows.length) { res.status(404).json({ error: `No existe ningún polín con el código ${codigo}` }); return; }
    res.json(await detallePallet(Number(rows[0].PalletId)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", requireAuth, requirePerm("bodega", "ver"), async (req: Request, res: Response) => {
  try {
    const palletId = Number(req.params.id);
    const detalle = await detallePallet(palletId);
    if (!detalle) { res.status(404).json({ error: "Pallet no encontrado" }); return; }
    res.json(detalle);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Cabecera + masters de un polín. Compartida por las dos formas de pedirlo (por id y por código)
// para que las dos devuelvan exactamente la misma forma.
async function detallePallet(palletId: number) {
  {
    const rows: any[] = await prisma.$queryRaw`
      SELECT p.*, org.Descripcion AS DescripcionOrigen, bv.Nombre AS NombreBodegaVirtual,
             po.Codigo AS PosicionCodigo
      FROM Pallets p
      LEFT JOIN Origen org ON p.Origen = org.Codigo
      LEFT JOIN BodegaVirtual bv ON p.BodegaVirtualCodigo = bv.Codigo
      LEFT JOIN Posiciones po ON p.PosicionId = po.PosicionId
      WHERE p.PalletId = ${palletId} LIMIT 1
    `;
    if (!rows.length) return null;
    // Se devuelven TODOS los masters, incluidos los ya despachados: el polín es también un registro
    // histórico. Los conteos sí separan, para que la pantalla pueda mostrar qué queda de verdad.
    const masters = await obtenerMastersDePallet(palletId);
    const cantidadMaster = rows[0].CantidadMaster == null ? null : Number(rows[0].CantidadMaster);
    const salidos = masters.filter((m: any) => m.Estatus === "Salido").length;
    // Quién lo subió al rack: último 'INGRESO' del kardex (un polín puede haberse des-ubicado y
    // vuelto a ubicar, así que vale el vigente). Mismo criterio que el mapa de la bodega física.
    const ubic: any[] = rows[0].PosicionId == null ? [] : await prisma.$queryRaw`
      SELECT Usuario, Fecha FROM MovimientosBodega
      WHERE PalletId = ${palletId} AND Tipo = 'INGRESO' ORDER BY MovimientoId DESC LIMIT 1
    `;
    return {
      ...rows[0], PalletId: Number(rows[0].PalletId), CantidadMaster: cantidadMaster,
      UbicadoPor: ubic[0]?.Usuario ?? null, UbicadoEn: ubic[0]?.Fecha ?? null,
      Masters: masters,
      CantidadMasters: masters.length - salidos, CantidadSalidos: salidos,
      Cuadre: calcularCuadre(cantidadMaster, masters.length),
    };
  }
}

// POST /api/pallets  { Origen, CantidadMaster, AreaCodigo }
// Crea un pallet vacío y Abierto. Sin Pedido/Cliente/línea de pedido: se arma solo con lo que se
// escanee después — pero SÍ requiere Origen (informativo, no filtra qué se puede escanear ahí),
// CantidadMaster (meta de referencia, no bloquea el escaneo) y AreaCodigo — el área REAL donde se
// está trabajando (Túnel, Masterizado...), no un tipo de bodega elegido a mano. De ahí el sistema
// resuelve solo la bodega virtual correspondiente (BodegaVirtual.AreaCodigo) y su letra de código
// (ej. "T0001" para Túnel) — el pallet queda en esa bodega virtual antes de pasar a la bodega
// física real (asignación de posición + hoja física impresa — todavía no existe ese siguiente paso).
router.post("/", requireAuth, requirePerm("bodega", "escanear"), async (req: Request, res: Response) => {
  try {
    const { Origen, CantidadMaster, AreaCodigo } = req.body;
    if (!Origen) { res.status(400).json({ error: "El origen es requerido" }); return; }
    if (!AreaCodigo) { res.status(400).json({ error: "El área es requerida" }); return; }
    const cantidad = Number(CantidadMaster);
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      res.status(400).json({ error: "La cantidad de masters del pallet debe ser un entero positivo" });
      return;
    }

    const operador = getOperador(req);
    let nuevoPalletId = 0;
    let codigo = "";
    // El secuencial de la bodega virtual se incrementa dentro de la transacción (UPDATE ...
    // SET x = x + 1 bloquea la fila hasta el commit) — dos pallets creados a la vez en la misma
    // bodega virtual no pueden terminar con el mismo código.
    await prisma.$transaction(async (tx) => {
      const bvRows: any[] = await tx.$queryRaw`SELECT Codigo, Letra, Activo FROM BodegaVirtual WHERE AreaCodigo = ${AreaCodigo} FOR UPDATE`;
      if (!bvRows.length) throw new ErrorNegocio(404, "Esta área todavía no tiene bodega virtual asignada");
      if (!Number(bvRows[0].Activo)) throw new ErrorNegocio(400, "La bodega virtual de esta área está inactiva");
      const bodegaVirtualCodigo = String(bvRows[0].Codigo);

      await tx.$executeRaw`UPDATE BodegaVirtual SET UltimoSecuencial = UltimoSecuencial + 1 WHERE Codigo = ${bodegaVirtualCodigo}`;
      const secRows: any[] = await tx.$queryRaw`SELECT UltimoSecuencial FROM BodegaVirtual WHERE Codigo = ${bodegaVirtualCodigo}`;
      codigo = String(bvRows[0].Letra) + String(Number(secRows[0].UltimoSecuencial)).padStart(4, "0");

      await tx.$executeRaw`
        INSERT INTO Pallets (Codigo, Origen, CantidadMaster, BodegaVirtualCodigo, CreadoPor)
        VALUES (${codigo}, ${Origen}, ${cantidad}, ${bodegaVirtualCodigo}, ${operador})
      `;
      const fila: any[] = await tx.$queryRaw`SELECT LAST_INSERT_ID() AS id`;
      nuevoPalletId = Number(fila[0].id);
    }, { timeout: 30_000 });

    res.status(201).json({ ok: true, PalletId: nuevoPalletId, Codigo: codigo });
  } catch (err: any) {
    if (err instanceof ErrorNegocio) { res.status(err.status).json({ error: err.message }); return; }
    if (err.message?.includes("foreign key")) { res.status(400).json({ error: "El origen no existe" }); return; }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pallets/:id/escanear  { Correlativo }
// Ingresa un master físico a este pallet. Válido solo si: el correlativo existe, su EtiquetaImpresa
// no está Anulada, no fue escaneado antes (candado real = UNIQUE en Masters.EtiquetaId, no solo la
// verificación previa) y no rompe el techo de su línea de pedido.
router.post("/:id/escanear", requireAuth, requirePerm("bodega", "escanear"), async (req: AuthRequest, res: Response) => {
  try {
    const palletId = Number(req.params.id);
    const etiquetaId = parseCorrelativo(req.body.Correlativo);
    if (!etiquetaId) { res.status(400).json({ error: "Correlativo inválido" }); return; }
    const operador = getOperador(req);
    // Mover cajas desde un polín SELLADO (Cerrado, con o sin posición) es deliberado y viaja aparte:
    // lo manda en true el botón "+ Master de otro Pallet". Sin esta bandera el escaneo normal se
    // comporta igual que siempre y sigue exigiendo que el polín de origen esté Abierto.
    const desdeSellado = req.body.DesdeSellado === true;
    // `as` y no anotación a secas: se asigna DENTRO del callback de la transacción, que TypeScript no
    // sigue, y con la anotación normal lo estrecha a null y marca error al leerlo después.
    let traslado = null as { PalletOrigen: string; PosicionOrigen: string | null; DesdeSellado: boolean; PosicionLiberada: string | null } | null;

    await prisma.$transaction(async (tx) => {
      const palletRows: any[] = await tx.$queryRaw`
        SELECT Codigo, Estatus, CantidadMaster FROM Pallets WHERE PalletId = ${palletId} FOR UPDATE
      `;
      if (!palletRows.length) throw new ErrorNegocio(404, "Pallet no encontrado");
      if (palletRows[0].Estatus !== "Abierto") throw new ErrorNegocio(400, "Este pallet no está abierto");

      // CantidadMaster es la CAPACIDAD del polín y sí frena el escaneo (decisión del usuario, 8 ago
      // 2026 — antes era solo una meta de referencia que se informaba como "Sobrante"): si se pide
      // el número al crearlo, es porque define cuánto cabe.
      // Se cuenta lo que está FÍSICAMENTE encima (Estatus <> 'Salido'): si a un polín le despacharon
      // 2 cajas, vuelve a haber lugar para 2. Los polines viejos sin cantidad declarada no tienen tope.
      // El FOR UPDATE de arriba serializa este chequeo contra dos escaneos simultáneos al mismo polín.
      const capacidad = palletRows[0].CantidadMaster == null ? null : Number(palletRows[0].CantidadMaster);
      if (capacidad != null) {
        const carga: any[] = await tx.$queryRaw`
          SELECT COUNT(*) AS n FROM Masters WHERE PalletId = ${palletId} AND Estatus <> 'Salido'
        `;
        if (Number(carga[0].n) >= capacidad) {
          throw new ErrorNegocio(400,
            `El polín ${palletRows[0].Codigo} ya llegó a su capacidad de ${capacidad} master(s). Ciérralo y abre otro, o ajusta su capacidad si se declaró mal.`);
        }
      }

      const etiquetaRows: any[] = await tx.$queryRaw`
        SELECT EtiquetaId, OrdenId, Estatus FROM EtiquetaImpresa WHERE EtiquetaId = ${etiquetaId} LIMIT 1
      `;
      if (!etiquetaRows.length) throw new ErrorNegocio(404, "QR no reconocido");
      if (etiquetaRows[0].Estatus !== "Activa") throw new ErrorNegocio(400, "Esta etiqueta está anulada, no se puede ingresar a bodega");

      // Un master ya escaneado puede ser un doble-escaneo (error) o una CONSOLIDACIÓN de sobrantes
      // (legítima): quedaron 5 cajas de un polín y se pasan a otro para no dejar media posición de
      // rack ocupada. Lo que distingue un caso del otro es que el polín de ORIGEN esté Abierto: un
      // polín abierto se está trabajando, sus cajas están accesibles; uno Cerrado está sellado.
      // (Antes esto exigía "desarmar" el polín origen; esa operación se eliminó el 8 ago 2026 por
      // redundante — reabrir ya deja el polín en condiciones de dar y recibir cajas.)
      const yaEscaneado = await buscarMasterPorEtiqueta(tx, etiquetaId);
      if (yaEscaneado) {
        if (yaEscaneado.Estatus === "Salido") {
          throw new ErrorNegocio(400,
            `Este master ya salió de bodega${yaEscaneado.RemisionFolio ? ` en la remisión ${yaEscaneado.RemisionFolio}` : ""} — no puede volver a escanearse.`);
        }
        if (yaEscaneado.RemisionFolio) {
          throw new ErrorNegocio(400, `Este master está comprometido en la remisión ${yaEscaneado.RemisionFolio} — quítalo de ahí antes de moverlo.`);
        }
        if (yaEscaneado.PalletId === palletId) {
          throw new ErrorNegocio(400, "Este master ya está en este mismo pallet");
        }
        // Un polín Cerrado (y más si está ubicado) está sellado: su contenido es definitivo y por eso
        // el escaneo normal no lo toca. Pero en piso la gente sí toma cajas de un polín ubicado para
        // completar otro, y obligarlos a des-ubicar → reabrir → mover → cerrar → volver a ubicar por
        // tres cajas hacía que el movimiento no se registrara. Con `DesdeSellado` se permite el mismo
        // movimiento que ya hace una remisión —sacar masters de un polín sellado sin des-ubicarlo—
        // pero como acción DELIBERADA y con permiso aparte: 'bodega:editar', el mismo que exige
        // des-ubicar, no el de escanear que tiene cualquier operador de bodega.
        if (yaEscaneado.PalletEstatus !== "Abierto") {
          const fecha = new Date(yaEscaneado.FechaIngreso).toLocaleString("es-GT");
          if (!desdeSellado) {
            throw new ErrorNegocio(400,
              `Este master está en el polín ${yaEscaneado.PalletCodigo} (${fecha}), que está ${String(yaEscaneado.PalletEstatus).toLowerCase()}. Usa "+ Master de otro Pallet" para moverlo sin des-ubicarlo, o reabre ese polín.`);
          }
          if (!tienePermiso(req, "bodega", "editar")) {
            throw new ErrorNegocio(403,
              `El polín ${yaEscaneado.PalletCodigo} está ${String(yaEscaneado.PalletEstatus).toLowerCase()} — mover cajas de un polín sellado requiere permiso de edición en Bodega.`);
          }
          if (yaEscaneado.PalletEstatus === "Cancelado") {
            throw new ErrorNegocio(400, `El polín ${yaEscaneado.PalletCodigo} está cancelado — sus cajas no se pueden mover.`);
          }
        }

        // Traslado: se MUEVE la fila, no se inserta una nueva. El master ya está contado en el techo
        // de su línea de pedido — un INSERT inflaría ese conteo y terminaría bloqueando producción
        // legítima de la línea. Por lo mismo, aquí NO se revalida el techo: el total no cambia.
        // FechaIngreso/IngresadoPor se conservan: son su entrada original a bodega, y el traslado
        // queda registrado aparte en el kardex.
        await tx.$executeRaw`UPDATE Masters SET PalletId = ${palletId}, Estatus = 'EnBodega' WHERE MasterId = ${yaEscaneado.MasterId}`;
        // La posición de ORIGEN sí se anota cuando el polín estaba ubicado: es lo que después
        // permite reconstruir de qué casilla del rack salió la caja, igual que hace una remisión.
        await tx.$executeRaw`
          INSERT INTO MovimientosBodega (PalletId, PalletOrigenId, MasterId, Tipo, PosicionOrigenId, PosicionDestinoId, Usuario, Motivo)
          VALUES (${palletId}, ${yaEscaneado.PalletId}, ${yaEscaneado.MasterId}, 'TRASLADO', ${yaEscaneado.PosicionId}, NULL, ${operador},
                  ${yaEscaneado.PosicionCodigo
                    ? `Tomado del polín ${yaEscaneado.PalletCodigo} en ${yaEscaneado.PosicionCodigo}`
                    : `Consolidado desde el polín ${yaEscaneado.PalletCodigo}`})
        `;

        // Si al origen no le quedó ni una caja, su casilla del rack se libera — misma regla que al
        // confirmar una remisión. Una tarima vacía no puede seguir bloqueando una posición. Se
        // evalúa con NOT EXISTS en la propia consulta para no depender de haber contado bien en JS.
        let posicionLiberada: string | null = null;
        if (yaEscaneado.PosicionId != null) {
          const afectadas = Number(await tx.$executeRaw`
            UPDATE Pallets SET PosicionId = NULL
            WHERE PalletId = ${yaEscaneado.PalletId}
              AND NOT EXISTS (SELECT 1 FROM Masters m WHERE m.PalletId = ${yaEscaneado.PalletId} AND m.Estatus <> 'Salido')
          `);
          if (afectadas) posicionLiberada = yaEscaneado.PosicionCodigo;
        }

        traslado = {
          PalletOrigen: yaEscaneado.PalletCodigo,
          PosicionOrigen: yaEscaneado.PosicionCodigo,
          DesdeSellado: yaEscaneado.PalletEstatus !== "Abierto",
          PosicionLiberada: posicionLiberada,
        };
        return;
      }

      const ordenRows: any[] = await tx.$queryRaw`SELECT DetalleId FROM OrdenEtiquetado WHERE OrdenId = ${Number(etiquetaRows[0].OrdenId)} LIMIT 1`;
      if (!ordenRows.length) throw new ErrorNegocio(404, "Orden de etiquetado no encontrada");
      const detalleId = Number(ordenRows[0].DetalleId);

      // Bloquea las filas de OrdenEtiquetado de esta línea para serializar el techo contra
      // escaneos concurrentes de otros masters de la misma línea (mismo patrón de candado que ya
      // usa etiquetaImpresa.ts para el cupo de impresión).
      await tx.$queryRaw`SELECT OrdenId FROM OrdenEtiquetado WHERE DetalleId = ${detalleId} FOR UPDATE`;
      const techo = await calcularTechoLinea(tx, detalleId);
      if (!techo) throw new ErrorNegocio(404, "Línea de pedido no encontrada");
      // Objetivo null = pedido general/de almacenaje: no hay cantidad comprometida, así que no hay
      // techo que romper y el pallet recibe cuanto se produzca (ver project_pedido_general_design).
      // Este es el único punto de bodega que cambia; el flujo de entrada es el mismo de siempre.
      if (techo.Objetivo !== null && techo.Escaneado + 1 > techo.Objetivo) {
        throw new ErrorNegocio(400, `Esta línea de pedido ya tiene ${techo.Escaneado} de ${techo.Objetivo} masters escaneados en bodega — no se puede escanear otro más.`);
      }

      await tx.$executeRaw`INSERT INTO Masters (PalletId, EtiquetaId, IngresadoPor) VALUES (${palletId}, ${etiquetaId}, ${operador})`;
    }, { timeout: 30_000 });

    const masterRows: any[] = await prisma.$queryRawUnsafe(`${MASTER_SELECT} WHERE m.PalletId = ? AND m.EtiquetaId = ? LIMIT 1`, palletId, etiquetaId);
    const cantidadRows: any[] = await prisma.$queryRaw`SELECT COUNT(*) AS n FROM Masters WHERE PalletId = ${palletId}`;
    res.status(201).json({
      ok: true, Master: formatearMaster(masterRows[0]), CantidadMasters: Number(cantidadRows[0].n),
      // El frontend lo usa para avisar que la caja vino de otro polín y no es un ingreso nuevo.
      Traslado: traslado != null, PalletOrigen: traslado?.PalletOrigen ?? null,
      PosicionOrigen: traslado?.PosicionOrigen ?? null,
      DesdeSellado: traslado?.DesdeSellado ?? false,
      PosicionLiberada: traslado?.PosicionLiberada ?? null,
    });
  } catch (err: any) {
    if (err instanceof ErrorNegocio) { res.status(err.status).json({ error: err.message }); return; }
    if (err.message?.includes("Duplicate")) { res.status(400).json({ error: "Este master ya fue escaneado" }); return; }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pallets/:id/cerrar — congela el conteo, bloquea más escaneos en este pallet.
router.post("/:id/cerrar", requireAuth, requirePerm("bodega", "escanear"), async (req: Request, res: Response) => {
  try {
    const palletId = Number(req.params.id);
    const rows: any[] = await prisma.$queryRaw`SELECT Estatus FROM Pallets WHERE PalletId = ${palletId} LIMIT 1`;
    if (!rows.length) { res.status(404).json({ error: "Pallet no encontrado" }); return; }
    if (rows[0].Estatus !== "Abierto") { res.status(400).json({ error: "Este pallet no está abierto" }); return; }

    const operador = getOperador(req);
    await prisma.$executeRaw`
      UPDATE Pallets SET Estatus = 'Cerrado', CerradoPor = ${operador}, CerradoEn = NOW() WHERE PalletId = ${palletId}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/pallets/:id/reabrir — corrección administrativa (ej. se cerró por error).
// Este es el cerrojo maestro del candado de posicionamiento: un pallet con posición física NUNCA
// se reabre — al quedar Cerrado para siempre, quitar/escanear masters y (transitivamente) anular
// sus etiquetas quedan sellados. La única salida es la des-ubicación administrativa en Bodega.
router.put("/:id/reabrir", requireAuth, requirePerm("bodega", "editar"), async (req: Request, res: Response) => {
  try {
    const palletId = Number(req.params.id);
    const rows: any[] = await prisma.$queryRaw`
      SELECT p.Estatus, p.PosicionId, po.Codigo AS PosicionCodigo
      FROM Pallets p LEFT JOIN Posiciones po ON p.PosicionId = po.PosicionId
      WHERE p.PalletId = ${palletId} LIMIT 1
    `;
    if (!rows.length) { res.status(404).json({ error: "Pallet no encontrado" }); return; }
    if (rows[0].PosicionId != null) {
      res.status(400).json({
        error: `Este pallet ya está posicionado en la bodega física (${rows[0].PosicionCodigo}) — su contenido está sellado y no se puede reabrir. Si es una corrección, primero des-ubícalo desde Bodega — Ubicaciones.`,
      });
      return;
    }
    if (rows[0].Estatus !== "Cerrado") { res.status(400).json({ error: "Este pallet no está cerrado" }); return; }

    await prisma.$executeRaw`
      UPDATE Pallets SET Estatus = 'Abierto', CerradoPor = NULL, CerradoEn = NULL WHERE PalletId = ${palletId}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/pallets/:id/capacidad  { CantidadMaster } — corrige la capacidad declarada.
// Existe porque desde que la capacidad FRENA el escaneo, un número mal tecleado al crear el polín
// dejaría al operador trabado sin salida: no podría meter la caja 51 en un polín donde sí cabe.
// Solo con el polín Abierto, y nunca por debajo de lo que ya tiene encima (eso lo dejaría en un
// estado imposible: más carga que capacidad).
router.put("/:id/capacidad", requireAuth, requirePerm("bodega", "escanear"), async (req: Request, res: Response) => {
  try {
    const palletId = Number(req.params.id);
    const nueva = Number(req.body.CantidadMaster);
    if (!Number.isInteger(nueva) || nueva <= 0) {
      res.status(400).json({ error: "La capacidad debe ser un entero positivo" });
      return;
    }

    await prisma.$transaction(async (tx) => {
      const rows: any[] = await tx.$queryRaw`
        SELECT Codigo, Estatus FROM Pallets WHERE PalletId = ${palletId} LIMIT 1 FOR UPDATE
      `;
      if (!rows.length) throw new ErrorNegocio(404, "Pallet no encontrado");
      if (rows[0].Estatus !== "Abierto") throw new ErrorNegocio(400, "Solo se puede ajustar la capacidad de un polín Abierto");

      const carga: any[] = await tx.$queryRaw`
        SELECT COUNT(*) AS n FROM Masters WHERE PalletId = ${palletId} AND Estatus <> 'Salido'
      `;
      if (nueva < Number(carga[0].n)) {
        throw new ErrorNegocio(400, `El polín ${rows[0].Codigo} ya tiene ${Number(carga[0].n)} master(s) encima — la capacidad no puede quedar por debajo de eso.`);
      }
      await tx.$executeRaw`UPDATE Pallets SET CantidadMaster = ${nueva} WHERE PalletId = ${palletId}`;
    }, { timeout: 30_000 });

    res.json({ ok: true, CantidadMaster: nueva });
  } catch (err: any) {
    if (err instanceof ErrorNegocio) { res.status(err.status).json({ error: err.message }); return; }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/pallets/:id/masters/:masterId — saca un master del pallet, identificado desde su fila
// en la tabla. Solo con el pallet Abierto. La lógica real está en quitarMasterDePallet.
router.delete("/:id/masters/:masterId", requireAuth, requirePerm("bodega", "editar"), async (req: Request, res: Response) => {
  try {
    const palletId = Number(req.params.id);
    const masterId = Number(req.params.masterId);
    const operador = getOperador(req);
    let respuesta: any = { ok: true };

    await prisma.$transaction(async (tx) => {
      await bloquearPalletAbierto(tx, palletId);
      respuesta = await quitarMasterDePallet(tx, palletId, masterId, operador);
    }, { timeout: 30_000 });

    res.json(respuesta);
  } catch (err: any) {
    if (err instanceof ErrorNegocio) { res.status(err.status).json({ error: err.message }); return; }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pallets/:id/quitar  { Correlativo } — el espejo de /escanear: saca del polín el master
// del QR que se acaba de leer. Existe porque corregir con el botón de cada fila obliga a BUSCAR la
// caja en la tabla y confirmar una por una, y cuando hay que bajar 20 cajas de un polín mal armado
// eso es justamente donde se quita la que no era. Con el lector, la caja que se baja es la que se
// quita — el mismo criterio de "se escanea, no se elige de una lista" del resto de bodega.
router.post("/:id/quitar", requireAuth, requirePerm("bodega", "editar"), async (req: Request, res: Response) => {
  try {
    const palletId = Number(req.params.id);
    const operador = getOperador(req);
    const respuesta = await prisma.$transaction(
      (tx) => quitarMasterEscaneado(tx, palletId, req.body.Correlativo, operador),
      { timeout: 30_000 },
    );
    res.json(respuesta);
  } catch (err: any) {
    if (err instanceof ErrorNegocio) { res.status(err.status).json({ error: err.message }); return; }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/pallets/:id — solo si está Abierto, sin masters y SIN historia en el kardex.
// Lo del kardex es nuevo (8 ago 2026): desde que existen los traslados, un polín puede quedar vacío
// pero haber participado en movimientos (recibió cajas y se las quitaron). Borrarlo destruiría ese
// registro — y el kardex es inmutable por diseño, de ahí el error de llave foránea que aparecía.
// La salida para ese caso es cancelarlo, no borrarlo: conserva la historia y lo saca de la operación.
router.delete("/:id", requireAuth, requirePerm("bodega", "eliminar"), async (req: Request, res: Response) => {
  try {
    const palletId = Number(req.params.id);
    const rows: any[] = await prisma.$queryRaw`
      SELECT p.Codigo, p.Estatus, (SELECT COUNT(*) FROM Masters m WHERE m.PalletId = p.PalletId) AS n,
             (SELECT COUNT(*) FROM MovimientosBodega mb
              WHERE mb.PalletId = p.PalletId OR mb.PalletOrigenId = p.PalletId) AS movimientos
      FROM Pallets p WHERE p.PalletId = ${palletId} LIMIT 1
    `;
    if (!rows.length) { res.status(404).json({ error: "Pallet no encontrado" }); return; }
    if (rows[0].Estatus !== "Abierto") { res.status(400).json({ error: "Solo se puede eliminar un pallet Abierto" }); return; }
    if (Number(rows[0].n) > 0) { res.status(400).json({ error: "Este pallet ya tiene masters escaneados, no se puede eliminar" }); return; }
    if (Number(rows[0].movimientos) > 0) {
      res.status(400).json({
        error: `El polín ${rows[0].Codigo} ya tiene movimientos registrados en el kardex (recibió o soltó cajas), así que no se puede borrar sin perder esa historia. Cancélalo en su lugar.`,
      });
      return;
    }

    await prisma.$executeRaw`DELETE FROM Pallets WHERE PalletId = ${palletId}`;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pallets/:id/cancelar — da de baja un polín Abierto y vacío conservando su historia.
// Es la alternativa a eliminar cuando el polín ya tocó el kardex. 'Cancelado' queda fuera de todas
// las colas operativas: /pendientes y /ubicar filtran por 'Cerrado', y no puede recibir escaneos.
router.post("/:id/cancelar", requireAuth, requirePerm("bodega", "eliminar"), async (req: Request, res: Response) => {
  try {
    const palletId = Number(req.params.id);
    const rows: any[] = await prisma.$queryRaw`
      SELECT p.Codigo, p.Estatus, (SELECT COUNT(*) FROM Masters m WHERE m.PalletId = p.PalletId) AS n
      FROM Pallets p WHERE p.PalletId = ${palletId} LIMIT 1
    `;
    if (!rows.length) { res.status(404).json({ error: "Pallet no encontrado" }); return; }
    if (rows[0].Estatus === "Cancelado") { res.status(400).json({ error: `El polín ${rows[0].Codigo} ya está cancelado` }); return; }
    if (rows[0].Estatus !== "Abierto") { res.status(400).json({ error: "Solo se puede cancelar un polín Abierto" }); return; }
    if (Number(rows[0].n) > 0) { res.status(400).json({ error: "Este polín tiene masters escaneados — quítalos antes de cancelarlo" }); return; }

    await prisma.$executeRaw`UPDATE Pallets SET Estatus = 'Cancelado' WHERE PalletId = ${palletId}`;
    res.json({ ok: true, Codigo: rows[0].Codigo });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
