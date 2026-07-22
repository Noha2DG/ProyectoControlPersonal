// Resuelve si un correlativo/EtiquetaId ya fue confirmado en bodega (existe en Masters) y, si es
// así, dónde quedó — mismo dato que pallets.ts ya usaba para rechazar un doble-escaneo, ahora
// compartido también con Impresión para advertir ANTES de reimprimir (ver project_ordenetiquetado_design).
// client acepta tanto el PrismaClient global como una tx de prisma.$transaction (misma firma $queryRaw).
export async function buscarMasterPorEtiqueta(client: any, etiquetaId: number) {
  const rows: any[] = await client.$queryRaw`
    SELECT m.MasterId, m.PalletId, m.IngresadoPor, m.FechaIngreso,
           p.Codigo AS PalletCodigo, p.Estatus AS PalletEstatus, p.PosicionId,
           po.Codigo AS PosicionCodigo, bv.Nombre AS NombreArea
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
    SELECT m.EtiquetaId, p.Codigo AS PalletCodigo, p.Estatus AS PalletEstatus, p.PosicionId,
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
      PalletCodigo: r.PalletCodigo, PalletEstatus: r.PalletEstatus,
      PosicionId: r.PosicionId == null ? null : Number(r.PosicionId), PosicionCodigo: r.PosicionCodigo ?? null,
      NombreArea: r.NombreArea,
      IngresadoPor: r.IngresadoPor, FechaIngreso: r.FechaIngreso,
    });
  }
  return mapa;
}

export interface TechoLinea {
  Objetivo: number;
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
    SELECT dp.CantidadCajas, pr.CajasXMaster
    FROM DetallePedido dp JOIN Presentacion pr ON dp.Presentacion = pr.Codigo
    WHERE dp.DetalleId = ${detalleId} LIMIT 1
  `;
  if (!detalle.length) return null;
  const objetivo = Math.ceil(Number(detalle[0].CantidadCajas) / Number(detalle[0].CajasXMaster));
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
    SELECT dp.DetalleId, dp.CantidadCajas, pr.CajasXMaster
    FROM DetallePedido dp JOIN Presentacion pr ON dp.Presentacion = pr.Codigo
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
    const objetivo = Math.ceil(Number(d.CantidadCajas) / Number(d.CajasXMaster));
    mapa.set(detalleId, { Objetivo: objetivo, Escaneado: escaneadoPorDetalle.get(detalleId) ?? 0 });
  }
  return mapa;
}
