// Un master trae toda su descripción (Pedido/Cliente/Lote/Proceso+Talla+Presentación/Área) resuelta
// al vuelo desde EtiquetaImpresa→OrdenEtiquetado→DetallePedido — ni el Pallet ni la Remisión guardan
// nada de esto (ver project_ordenetiquetado_design: "no está ligado a pedido o cliente, se le cargan
// los datos de cada master").
// PesoKG/PesoLb en Presentacion son POR CAJA, no por master (confirmado contra la Descripcion real,
// ej. "AS" = 2 cajas de 10kg = "20 kg" total, PesoKG=10 → 10*2=20 coincide) — el peso del master
// completo es PesoKG/PesoLb * CajasXMaster, no el campo solo.
// Vive aquí (y no en pallets.ts, donde nació) porque Remisiones necesita exactamente el mismo
// detalle por master: duplicar un join de 10 tablas en dos rutas es garantía de que se desincronicen.
export const MASTER_SELECT = `
  SELECT m.MasterId, m.PalletId, m.EtiquetaId, m.Estatus, m.IngresadoPor, m.FechaIngreso,
         pal.Codigo AS PalletCodigo, pal.Estatus AS PalletEstatus,
         oe.OrdenId, oe.Lote, oe.FechaProduccion, oe.AreaCodigo, ar.Nombre AS NombreArea,
         dp.DetalleId, dp.CodigoPedido, dp.Clase, pc.Descripcion AS DescripcionProceso,
         dp.Talla, ta.Descripcion AS DescripcionTalla,
         dp.Presentacion, pr.Descripcion AS DescripcionPresentacion,
         pr.PesoKG * pr.CajasXMaster AS PesoMasterKG, pr.PesoLb * pr.CajasXMaster AS PesoMasterLb,
         ped.CodigoCliente, ped.CodigoSubcliente,
         cli.RazonSocial AS NombreCliente, sub.RazonSocial AS NombreSubcliente
  FROM Masters m
  JOIN Pallets pal ON m.PalletId = pal.PalletId
  JOIN EtiquetaImpresa ei ON m.EtiquetaId = ei.EtiquetaId
  JOIN OrdenEtiquetado oe ON ei.OrdenId = oe.OrdenId
  JOIN DetallePedido dp ON oe.DetalleId = dp.DetalleId
  JOIN Clase cl ON dp.Clase = cl.Clase
  JOIN Procesos pc ON cl.Proceso = pc.Proceso
  JOIN Tallas ta ON dp.Talla = ta.Codigo
  JOIN Presentacion pr ON dp.Presentacion = pr.Codigo
  JOIN Pedidos ped ON dp.CodigoPedido = ped.CodigoPedido
  JOIN Clientes cli ON ped.CodigoCliente = cli.Codigo
  LEFT JOIN Subcliente sub ON ped.CodigoCliente = sub.CodigoCliente AND ped.CodigoSubcliente = sub.CodigoSubcliente
  LEFT JOIN Areas ar ON oe.AreaCodigo = ar.Codigo
`;

// Normaliza una fila de MASTER_SELECT: los BigInt/Decimal de Prisma a number y el correlativo
// derivado ("E" + EtiquetaId — no se guarda como columna, se deriva).
export function formatearMaster(r: any) {
  return {
    ...r,
    MasterId: Number(r.MasterId), PalletId: Number(r.PalletId), EtiquetaId: Number(r.EtiquetaId),
    OrdenId: Number(r.OrdenId), DetalleId: Number(r.DetalleId), Talla: Number(r.Talla),
    CodigoCliente: Number(r.CodigoCliente),
    PesoMasterKG: Number(r.PesoMasterKG), PesoMasterLb: Number(r.PesoMasterLb),
    Correlativo: "E" + Number(r.EtiquetaId),
    FechaProduccion: r.FechaProduccion ? new Date(r.FechaProduccion).toISOString().slice(0, 10) : null,
  };
}

// Resuelve si un correlativo/EtiquetaId ya fue confirmado en bodega (existe en Masters) y, si es
// así, dónde quedó — mismo dato que pallets.ts ya usaba para rechazar un doble-escaneo, ahora
// compartido también con Impresión para advertir ANTES de reimprimir (ver project_ordenetiquetado_design).
// client acepta tanto el PrismaClient global como una tx de prisma.$transaction (misma firma $queryRaw).
export async function buscarMasterPorEtiqueta(client: any, etiquetaId: number) {
  const rows: any[] = await client.$queryRaw`
    SELECT m.MasterId, m.PalletId, m.Estatus, m.IngresadoPor, m.FechaIngreso,
           p.Codigo AS PalletCodigo, p.Estatus AS PalletEstatus, p.PosicionId,
           po.Codigo AS PosicionCodigo, bv.Nombre AS NombreArea,
           (SELECT r.Folio FROM RemisionDetalle rd
              JOIN Remisiones r ON rd.RemisionId = r.RemisionId
            WHERE rd.MasterId = m.MasterId AND rd.Vigente = 1 LIMIT 1) AS RemisionFolio
    FROM Masters m
    JOIN Pallets p ON m.PalletId = p.PalletId
    LEFT JOIN BodegaVirtual bv ON p.BodegaVirtualCodigo = bv.Codigo
    LEFT JOIN Posiciones po ON p.PosicionId = po.PosicionId
    WHERE m.EtiquetaId = ${etiquetaId} LIMIT 1
  `;
  if (!rows.length) return null;
  const r = rows[0];
  return {
    MasterId: Number(r.MasterId),
    PalletId: Number(r.PalletId),
    PalletCodigo: r.PalletCodigo as string,
    PalletEstatus: r.PalletEstatus as string,
    // EnBodega | Suelto | Salido. "Salido" es el candado que sustituye a PosicionCodigo una vez que
    // el producto se despachó: la remisión LIBERA la posición física, así que sin este dato un
    // master ya embarcado volvería a verse como "sin posición" y quedaría reimprimible/anulable.
    Estatus: r.Estatus as string,
    // Folio de la remisión VIGENTE que lo tiene tomado (Borrador o Confirmada), si hay alguna.
    RemisionFolio: (r.RemisionFolio ?? null) as string | null,
    // Posición física del pallet (null mientras siga en bodega virtual). Un pallet posicionado está
    // sellado: anular/reimprimir/quitar masters quedan bloqueados aguas arriba.
    PosicionId: r.PosicionId == null ? null : Number(r.PosicionId),
    PosicionCodigo: (r.PosicionCodigo ?? null) as string | null,
    NombreArea: r.NombreArea as string | null,
    IngresadoPor: r.IngresadoPor as string | null,
    FechaIngreso: r.FechaIngreso as Date,
  };
}

export interface MasterEscaneadoInfo {
  PalletCodigo: string;
  PalletEstatus: string;
  // EnBodega | Suelto | Salido — ver la nota en buscarMasterPorEtiqueta: una vez despachado, la
  // posición ya se liberó, así que este es el único dato que distingue "salió de la planta".
  Estatus: string;
  // Igual que en buscarMasterPorEtiqueta: null mientras el pallet siga en bodega virtual. Con esto
  // el rango en bloque puede distinguir "ya escaneado" (excluido, pero sin nada especial que decir)
  // de "sellado en bodega física" (excluido porque ya es inventario, no solo porque ya se escaneó).
  PosicionId: number | null;
  PosicionCodigo: string | null;
  NombreArea: string | null;
  IngresadoPor: string | null;
  FechaIngreso: Date;
}

// Batch de buscarMasterPorEtiqueta para un rango de correlativos — evita N consultas al reimprimir
// por bloque (reimprimir-bloque puede cubrir hasta 1000 a la vez). El Map solo trae los EtiquetaId
// que SÍ están ya escaneados; los que no aparecen ahí no están en Masters.
export async function buscarMastersEnRango(client: any, desde: number, hasta: number): Promise<Map<number, MasterEscaneadoInfo>> {
  const rows: any[] = await client.$queryRaw`
    SELECT m.EtiquetaId, m.Estatus, p.Codigo AS PalletCodigo, p.Estatus AS PalletEstatus, p.PosicionId,
           po.Codigo AS PosicionCodigo, bv.Nombre AS NombreArea,
           m.IngresadoPor, m.FechaIngreso
    FROM Masters m
    JOIN Pallets p ON m.PalletId = p.PalletId
    LEFT JOIN BodegaVirtual bv ON p.BodegaVirtualCodigo = bv.Codigo
    LEFT JOIN Posiciones po ON p.PosicionId = po.PosicionId
    WHERE m.EtiquetaId BETWEEN ${desde} AND ${hasta}
  `;
  const mapa = new Map<number, MasterEscaneadoInfo>();
  for (const r of rows) {
    mapa.set(Number(r.EtiquetaId), {
      PalletCodigo: r.PalletCodigo, PalletEstatus: r.PalletEstatus, Estatus: r.Estatus,
      PosicionId: r.PosicionId == null ? null : Number(r.PosicionId), PosicionCodigo: r.PosicionCodigo ?? null,
      NombreArea: r.NombreArea,
      IngresadoPor: r.IngresadoPor, FechaIngreso: r.FechaIngreso,
    });
  }
  return mapa;
}

export interface TechoLinea {
  // null = el pedido es general/de almacenaje (Pedidos.EsGeneral): no hay cantidad planificada, así
  // que no hay techo contra el cual comparar. TODO consumidor debe tratar null como "sin límite" —
  // ver project_pedido_general_design. Ojo: para esas líneas CantidadCajas vale 1 de centinela, y
  // CEILING(1 / CajasXMaster) da 1 siempre, así que interpretarlo como techo topa la línea en un
  // solo master y bloquea hasta el escaneo del segundo.
  Objetivo: number | null;
  Escaneado: number;
}

// Objetivo = CEILING(CantidadCajas / CajasXMaster) de la línea de pedido. Escaneado = masters YA
// confirmados en bodega de esa línea, en cualquier pallet, sumando TODAS las capturas de Etiquetado
// que compartan ese DetalleId — es el "segundo techo" real (contra lo confirmado en bodega, no
// contra lo declarado). Movida aquí desde pallets.ts (donde nació) para reusarla también en el
// reporte de Impresión — la llamada original dentro de la transacción de escanear sigue igual, el
// candado de concurrencia lo pone el caller con FOR UPDATE antes de invocar esta función.
export async function calcularTechoLinea(client: any, detalleId: number): Promise<TechoLinea | null> {
  const detalle: any[] = await client.$queryRaw`
    SELECT dp.CantidadCajas, pr.CajasXMaster, ped.EsGeneral
    FROM DetallePedido dp
    JOIN Presentacion pr ON dp.Presentacion = pr.Codigo
    JOIN Pedidos ped ON dp.CodigoPedido = ped.CodigoPedido
    WHERE dp.DetalleId = ${detalleId} LIMIT 1
  `;
  if (!detalle.length) return null;
  const objetivo = Number(detalle[0].EsGeneral) === 1
    ? null
    : Math.ceil(Number(detalle[0].CantidadCajas) / Number(detalle[0].CajasXMaster));
  const escaneadoRows: any[] = await client.$queryRaw`
    SELECT COUNT(*) AS n FROM Masters m
    JOIN EtiquetaImpresa ei ON m.EtiquetaId = ei.EtiquetaId
    JOIN OrdenEtiquetado oe ON ei.OrdenId = oe.OrdenId
    WHERE oe.DetalleId = ${detalleId}
  `;
  return { Objetivo: objetivo, Escaneado: Number(escaneadoRows[0].n) };
}

// Batch de calcularTechoLinea para varias líneas a la vez — evita N consultas al listar capturas de
// Etiquetado (una pantalla con 50 filas puede repetir la misma línea varias veces si tiene varias
// capturas). Líneas sin DetallePedido válido simplemente no aparecen en el Map devuelto.
export async function calcularTechoLineaBatch(client: any, detalleIds: number[]): Promise<Map<number, TechoLinea>> {
  const mapa = new Map<number, TechoLinea>();
  const ids = [...new Set(detalleIds)];
  if (!ids.length) return mapa;
  const placeholders = ids.map(() => "?").join(",");

  const detalles: any[] = await client.$queryRawUnsafe(`
    SELECT dp.DetalleId, dp.CantidadCajas, pr.CajasXMaster, ped.EsGeneral
    FROM DetallePedido dp
    JOIN Presentacion pr ON dp.Presentacion = pr.Codigo
    JOIN Pedidos ped ON dp.CodigoPedido = ped.CodigoPedido
    WHERE dp.DetalleId IN (${placeholders})
  `, ...ids);

  const escaneados: any[] = await client.$queryRawUnsafe(`
    SELECT oe.DetalleId, COUNT(*) AS n
    FROM Masters m
    JOIN EtiquetaImpresa ei ON m.EtiquetaId = ei.EtiquetaId
    JOIN OrdenEtiquetado oe ON ei.OrdenId = oe.OrdenId
    WHERE oe.DetalleId IN (${placeholders})
    GROUP BY oe.DetalleId
  `, ...ids);
  const escaneadoPorDetalle = new Map<number, number>(escaneados.map((r: any) => [Number(r.DetalleId), Number(r.n)]));

  for (const d of detalles) {
    const detalleId = Number(d.DetalleId);
    const objetivo = Number(d.EsGeneral) === 1
      ? null
      : Math.ceil(Number(d.CantidadCajas) / Number(d.CajasXMaster));
    mapa.set(detalleId, { Objetivo: objetivo, Escaneado: escaneadoPorDetalle.get(detalleId) ?? 0 });
  }
  return mapa;
}
