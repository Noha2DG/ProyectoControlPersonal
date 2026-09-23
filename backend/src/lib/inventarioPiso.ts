// Puente entre bodega y el inventario al piso.
//
// Cuando bodega confirma una remisión con destino a un área, el producto entra al piso de esa área.
// Automático, sin que nadie lo acepte en otra pantalla: la confirmación YA es la entrega firmada —
// `Remisiones.RecibidoPor` lleva al empleado del área que la recibió. Una aceptación aparte dejaría
// el producto en limbo entre las dos pantallas, despachado por bodega y no recibido por nadie, que
// es exactamente el hueco que este módulo existe para cerrar.
//
// Vive acá y no dentro de routes/remisiones.ts porque lo usan dos llamadores: la confirmación desde
// la pantalla y scripts/cargarIngresosPiso.ts, que carga una jornada ya pasada. Dos copias de esta
// consulta terminarían dando dos inventarios distintos para el mismo despacho.
//
// EL LOTE SE COPIA TAL CUAL de la orden de etiquetado, con su fecha de producción. Eso es lo que
// impide el rebautizo: si el área lo volviera a teclear, un lote de mayo se convertiría en uno de la
// semana en curso y se borrarían meses de trazabilidad.

export const MARCA_REMISION = "Remisión confirmada";

// Una fila por (remisión, lote, fecha del lote, clase, talla, peso del master). La fecha del lote
// entra al agrupado a propósito: el mismo texto de lote puede traer dos fechas de producción
// distintas —  G220EM00-E00 tiene 11 y 12 de mayo—  y colapsarlas perdería la diferencia.
const SQL_LINEAS = `
  SELECT oe.Lote,
         DATE_FORMAT(oe.FechaProduccion, '%Y-%m-%d') AS FechaLote,
         dp.Clase, dp.Talla,
         COUNT(*) AS Masters,
         ROUND(pre.PesoKG * pre.CajasXMaster, 3) AS KgPorMaster,
         ROUND(COUNT(*) * pre.PesoKG * pre.CajasXMaster, 2) AS Kg
  FROM RemisionDetalle rd
  JOIN Masters m  ON m.MasterId = rd.MasterId
  JOIN EtiquetaImpresa e ON e.EtiquetaId = m.EtiquetaId
  JOIN OrdenEtiquetado oe ON oe.OrdenId = e.OrdenId
  JOIN DetallePedido dp ON dp.DetalleId = oe.DetalleId
  JOIN Presentacion pre ON pre.Codigo = dp.Presentacion
  WHERE rd.RemisionId = ? AND rd.Vigente = 1
  GROUP BY oe.Lote, oe.FechaProduccion, dp.Clase, dp.Talla, pre.PesoKG, pre.CajasXMaster
`;

/**
 * Mete al piso del área lo que trae una remisión. Se llama DENTRO de la transacción que confirma,
 * para que el producto entre al inventario en el mismo instante en que sale de bodega — o no entre
 * en absoluto si la confirmación falla.
 */
export async function registrarIngresoDesdeRemision(
  tx: any, remisionId: number, areaDestino: string, fechaJornada: string, operador: string
): Promise<{ lineas: number; kg: number }> {
  // La remisión trae el ÁREA de destino (Remisiones.AreaDestino), pero el inventario al piso vive
  // por BODEGA: Pelado/Descabezado son siete áreas que comparten el mismo piso. Se traduce acá.
  //
  // LlevaPiso = 1 es parte de la condición, no un adorno: hay bodegas que existen en el catálogo
  // sin llevar inventario al piso — las cinco todavía sin decidir (Empaque IQF, Reempaque…) y las
  // que solo son origen de polín (Bodega, Devoluciones). Sin este filtro, una remisión a cualquiera
  // de ellas abriría un saldo al piso que nadie va a cuadrar nunca.
  const [ar]: any[] = await tx.$queryRawUnsafe(
    `SELECT a.BodegaVirtualCodigo AS Bodega FROM Areas a
       JOIN BodegaVirtual b ON b.Codigo = a.BodegaVirtualCodigo AND b.LlevaPiso = 1
      WHERE a.Codigo = ?`, areaDestino);
  const bodega = ar?.Bodega;
  if (!bodega) return { lineas: 0, kg: 0 };   // área que no lleva inventario al piso (baño, RRHH…)
  const lineas: any[] = await tx.$queryRawUnsafe(SQL_LINEAS, remisionId);
  if (!lineas.length) return { lineas: 0, kg: 0 };

  // Un solo INSERT con todas las filas: el backend habla con la base por red y una remisión de
  // veinte líneas serían veinte viajes con los candados de la transacción tomados.
  const args: any[] = [];
  const filas = lineas.map(l => {
    args.push(fechaJornada, bodega, l.Lote, l.Clase, l.Talla, l.FechaLote,
      Number(l.Kg), Number(l.Kg), Number(l.Masters), Number(l.KgPorMaster), remisionId, operador);
    return "('INGRESO',?,?,?,?,?,?,?,'KG',?,?,?,?,?)";
  }).join(",");

  await tx.$executeRawUnsafe(
    `INSERT INTO MovimientoPiso
       (Tipo, FechaProduccion, BodegaDestino, Lote, Clase, Talla, FechaLote,
        Peso, UM, PesoKg, Masters, KgPorMaster, RemisionId, RegistradoPor)
     VALUES ${filas}`, ...args);

  return { lineas: lineas.length, kg: Number(lineas.reduce((s, l) => s + Number(l.Kg), 0).toFixed(2)) };
}

/**
 * Saca del piso lo que había metido una remisión, al anularla.
 *
 * Se niega si el área ya trabajó ese producto. Borrar el ingreso de algo que ya se descongeló
 * dejaría el saldo en negativo: producto que el sistema afirma que nunca entró pero que sí salió.
 * En ese caso la salida correcta es un AJUSTE con motivo, no deshacer la historia.
 */
export async function revertirIngresoDeRemision(tx: any, remisionId: number): Promise<number> {
  const conflictos: any[] = await tx.$queryRawUnsafe(`
    SELECT i.Lote, i.Clase, i.Talla, ROUND(i.Kg, 2) AS Ingreso, ROUND(COALESCE(s.Kg, 0), 2) AS Saldo
    FROM (
      SELECT BodegaDestino AS Bodega, Lote, Clase, Talla, SUM(PesoKg) AS Kg
        FROM MovimientoPiso WHERE RemisionId = ? AND Tipo = 'INGRESO'
       GROUP BY BodegaDestino, Lote, Clase, Talla
    ) i
    LEFT JOIN (
      SELECT Bodega, Lote, Clase, Talla, SUM(Delta) AS Kg FROM (
        SELECT BodegaDestino AS Bodega, Lote, Clase, Talla,  PesoKg AS Delta
          FROM MovimientoPiso WHERE BodegaDestino IS NOT NULL
        UNION ALL
        SELECT BodegaOrigen  AS Bodega, Lote, Clase, Talla, -PesoKg AS Delta
          FROM MovimientoPiso WHERE BodegaOrigen  IS NOT NULL
      ) u GROUP BY Bodega, Lote, Clase, Talla
    ) s ON s.Bodega = i.Bodega AND s.Lote = i.Lote AND s.Clase = i.Clase AND s.Talla = i.Talla
    WHERE COALESCE(s.Kg, 0) - i.Kg < -0.001
  `, remisionId);

  if (conflictos.length) {
    const c = conflictos[0];
    throw new Error(
      `El área ya trabajó producto de esta remisión (lote ${c.Lote} ${c.Clase}: quedan ${c.Saldo} kg ` +
      `de los ${c.Ingreso} kg que entraron). Anularla dejaría el inventario al piso en negativo — ` +
      `corrija con un ajuste en Descongelado en vez de anular.`);
  }

  return Number(await tx.$executeRawUnsafe(
    `DELETE FROM MovimientoPiso WHERE RemisionId = ? AND Tipo = 'INGRESO'`, remisionId));
}
