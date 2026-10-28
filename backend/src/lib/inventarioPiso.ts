// Puente entre bodega y el inventario al piso.
//
// Cuando una remisión con destino a un área recibe producto, ese producto entra al piso del área.
// Desde el 28 oct 2026 eso pasa AL ESCANEAR, no al confirmar (usuario: "todo producto que entre a
// remisión sea rebajado del sistema aunque no se confirme salida"): bodega lo rebaja en el acto y el
// área lo ve en el acto. Antes, una remisión que se quedaba en borrador dejaba el producto contado en
// bodega y ausente del piso, aunque ya estuviera en el área.
// Automático, sin que nadie lo acepte en otra pantalla: una aceptación aparte dejaría el producto en
// limbo entre las dos pantallas, despachado por bodega y no recibido por nadie, que es exactamente el
// hueco que este módulo existe para cerrar.
//
// Vive acá y no dentro de routes/remisiones.ts porque lo usan dos llamadores: la remisión desde la
// pantalla y scripts/cargarIngresosPiso.ts, que carga una jornada ya pasada. Dos copias de esta
// consulta terminarían dando dos inventarios distintos para el mismo despacho.
//
// EL LOTE SE COPIA TAL CUAL de la orden de etiquetado, con su fecha de producción. Eso es lo que
// impide el rebautizo: si el área lo volviera a teclear, un lote de mayo se convertiría en uno de la
// semana en curso y se borrarían meses de trazabilidad.

export const MARCA_REMISION = "Remisión confirmada";

// Lo que se quita del piso ya lo trabajó el área. Es un rechazo de negocio, no una falla: quien llama
// lo traduce a un 400 con este mensaje.
export class PisoEnNegativo extends Error {}

// Una fila por (remisión, lote, fecha del lote, clase, talla, peso del master). La fecha del lote
// entra al agrupado a propósito: el mismo texto de lote puede traer dos fechas de producción
// distintas —  G220EM00-E00 tiene 11 y 12 de mayo—  y colapsarlas perdería la diferencia.
// `sin` deja fuera esa cantidad de masters (sus ids van después del de la remisión): es lo que va a
// quedar en la remisión cuando se le quiten.
const sqlLineas = (sin = 0) => `
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
    ${sin ? `AND rd.MasterId NOT IN (${Array(sin).fill("?").join(",")})` : ""}
  GROUP BY oe.Lote, oe.FechaProduccion, dp.Clase, dp.Talla, pre.PesoKG, pre.CajasXMaster
`;

type Destino = { BodegaDestino?: string | null; AreaDestino?: string | null };

// Desde oct 2026 la remisión trae la BODEGA a la que se carga (Remisiones.BodegaDestino). Las de
// antes solo traen el ÁREA (AreaDestino) y se traduce por su bodega —  Pelado son seis áreas que
// comparten el mismo piso.
//
// LlevaPiso = 1 es parte de la condición, no un adorno: hay bodegas que existen en el catálogo
// sin llevar inventario al piso —  las que solo son origen de polín (Bodega, Devoluciones). Sin
// este filtro, una remisión a cualquiera de ellas abriría un saldo al piso que nadie va a cuadrar.
async function bodegaConPiso(tx: any, destino: Destino): Promise<string | null> {
  if (!destino.BodegaDestino && !destino.AreaDestino) return null;
  const [b]: any[] = destino.BodegaDestino
    ? await tx.$queryRawUnsafe(
        `SELECT Codigo AS Bodega FROM BodegaVirtual WHERE Codigo = ? AND LlevaPiso = 1`, destino.BodegaDestino)
    : await tx.$queryRawUnsafe(
        `SELECT a.BodegaVirtualCodigo AS Bodega FROM Areas a
           JOIN BodegaVirtual b ON b.Codigo = a.BodegaVirtualCodigo AND b.LlevaPiso = 1
          WHERE a.Codigo = ?`, destino.AreaDestino ?? null);
  return b?.Bodega ?? null;
}

/**
 * Mete al piso del área TODO lo que trae una remisión, de una vez. Lo usa scripts/cargarIngresosPiso.ts
 * para cargar jornadas pasadas; la pantalla usa sincronizarIngresoDeRemision (abajo), que lo va
 * metiendo a medida que se escanea.
 */
export async function registrarIngresoDesdeRemision(
  tx: any, remisionId: number, destino: Destino,
  fechaJornada: string, operador: string
): Promise<{ lineas: number; kg: number }> {
  const bodega = await bodegaConPiso(tx, destino);
  if (!bodega) return { lineas: 0, kg: 0 };   // bodega sin inventario al piso, o área sin bodega
  const lineas: any[] = await tx.$queryRawUnsafe(sqlLineas(), remisionId);
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
 * Deja el ingreso al piso de una remisión igual a lo que la remisión trae —  o va a traer, sin los
 * masters de `sinMasters`, que quien llama está por quitarle. Se llama dentro de la misma
 * transacción cada vez que el borrador gana o pierde líneas o cambia de destino, y otra vez al
 * confirmar (por los borradores que se armaron antes de que el piso se llenara al escanear).
 *
 * Una fila de INGRESO por llave (bodega, lote, fecha del lote, clase, talla, peso del master), que se
 * ACTUALIZA en vez de sumarle filas: escaneando caja por caja quedaría una fila por master, y cada
 * una redondea sus kilos por su lado —  al descongelar la línea completa sobrarían centésimas al
 * piso. Con una sola fila los kilos son los mismos que daba confirmar de una vez. La fila conserva la
 * jornada en que entró la primera caja de esa llave.
 *
 * Se niega si lo que se quita ya lo trabajó el área: igual que al anular, dejaría el saldo al piso en
 * negativo. Se revisa ANTES de escribir nada, para que el rechazo no deje nada a medias.
 */
export async function sincronizarIngresoDeRemision(
  tx: any, remisionId: number, destino: Destino, fechaJornada: string, operador: string,
  sinMasters: number[] = [],
): Promise<{ lineas: number; kg: number }> {
  const bodega = await bodegaConPiso(tx, destino);
  const deseadas: any[] = bodega
    ? await tx.$queryRawUnsafe(sqlLineas(sinMasters.length), remisionId, ...sinMasters) : [];
  const actuales: any[] = await tx.$queryRawUnsafe(`
    SELECT MovimientoId, BodegaDestino AS Bodega, Lote, DATE_FORMAT(FechaLote, '%Y-%m-%d') AS FechaLote,
           Clase, Talla, KgPorMaster, Masters, PesoKg
      FROM MovimientoPiso WHERE RemisionId = ? AND Tipo = 'INGRESO'
     ORDER BY MovimientoId FOR UPDATE`, remisionId);

  // La llave de la fila lleva el peso del master; la del saldo no, porque AL PISO no lo separa.
  const grupo = (b: string, l: any) => [b, l.Lote, l.FechaLote ?? "", l.Clase, String(l.Talla)].join("|");
  const clave = (b: string, l: any) => `${grupo(b, l)}|${Number(l.KgPorMaster ?? 0).toFixed(3)}`;
  const porClave = new Map<string, any[]>();
  for (const a of actuales) {
    const k = clave(a.Bodega, a);
    porClave.set(k, [...(porClave.get(k) ?? []), a]);
  }

  // Primero el plan, sin escribir: qué se inserta, qué se actualiza, qué se borra, y cuánto cambia
  // cada grupo del saldo.
  const insertar: any[] = [];
  const actualizar: { id: number; kg: number; masters: number }[] = [];
  const borrar: number[] = [];
  const cambio = new Map<string, number>();
  const sumar = (g: string, kg: number) => cambio.set(g, (cambio.get(g) ?? 0) + kg);
  for (const d of deseadas) {
    const k = clave(bodega!, d);
    const [fila, ...sobran] = porClave.get(k) ?? [];
    porClave.delete(k);
    const kg = Number(d.Kg), masters = Number(d.Masters);
    for (const s of sobran) { borrar.push(Number(s.MovimientoId)); sumar(grupo(bodega!, d), -Number(s.PesoKg)); }
    if (!fila) {
      insertar.push(d);
      sumar(grupo(bodega!, d), kg);
    } else if (Number(fila.Masters) !== masters || Math.abs(Number(fila.PesoKg) - kg) > 0.001) {
      actualizar.push({ id: Number(fila.MovimientoId), kg, masters });
      sumar(grupo(bodega!, d), kg - Number(fila.PesoKg));
    }
  }
  // Lo que la remisión ya no trae: líneas quitadas, o el destino cambió de bodega.
  for (const filas of porClave.values()) {
    for (const f of filas) { borrar.push(Number(f.MovimientoId)); sumar(grupo(f.Bodega, f), -Number(f.PesoKg)); }
  }

  // Donde el ingreso baja, el saldo de esta remisión tiene que alcanzar —  mismo saldo que AL PISO
  // (por remisión, lote, clase, talla y fecha del lote).
  const bajan = [...cambio].filter(([, kg]) => kg < -0.001);
  if (bajan.length) {
    const saldos: any[] = await tx.$queryRawUnsafe(`
      SELECT Bodega, Lote, DATE_FORMAT(FechaLote, '%Y-%m-%d') AS FechaLote, Clase, Talla, SUM(Delta) AS Kg FROM (
        SELECT BodegaDestino AS Bodega, Lote, Clase, Talla, FechaLote,  PesoKg AS Delta
          FROM MovimientoPiso WHERE RemisionId = ? AND BodegaDestino IS NOT NULL
        UNION ALL
        SELECT BodegaOrigen  AS Bodega, Lote, Clase, Talla, FechaLote, -PesoKg AS Delta
          FROM MovimientoPiso WHERE RemisionId = ? AND BodegaOrigen  IS NOT NULL
      ) t GROUP BY Bodega, Lote, Clase, Talla, FechaLote`, remisionId, remisionId);
    const saldo = new Map(saldos.map(s => [grupo(s.Bodega, s), Number(s.Kg)]));
    for (const [g, kg] of bajan) {
      const queda = (saldo.get(g) ?? 0) + kg;
      if (queda < -0.001) {
        const [, lote, , clase] = g.split("|");
        throw new PisoEnNegativo(
          `El área ya trabajó ese producto (lote ${lote} ${clase}: quitarlo dejaría ${queda.toFixed(2)} kg al piso). ` +
          `Lo que ya se descongeló o se tomó del piso no puede regresar a bodega quitándolo de la remisión.`);
      }
    }
  }

  for (const d of insertar) {
    await tx.$executeRawUnsafe(
      `INSERT INTO MovimientoPiso
         (Tipo, FechaProduccion, BodegaDestino, Lote, Clase, Talla, FechaLote,
          Peso, UM, PesoKg, Masters, KgPorMaster, RemisionId, RegistradoPor)
       VALUES ('INGRESO',?,?,?,?,?,?,?,'KG',?,?,?,?,?)`,
      fechaJornada, bodega, d.Lote, d.Clase, d.Talla, d.FechaLote,
      Number(d.Kg), Number(d.Kg), Number(d.Masters), Number(d.KgPorMaster), remisionId, operador);
  }
  for (const u of actualizar) {
    await tx.$executeRawUnsafe(
      `UPDATE MovimientoPiso SET Peso = ?, PesoKg = ?, Masters = ? WHERE MovimientoId = ?`, u.kg, u.kg, u.masters, u.id);
  }
  if (borrar.length) {
    await tx.$executeRawUnsafe(
      `DELETE FROM MovimientoPiso WHERE MovimientoId IN (${borrar.map(() => "?").join(",")})`, ...borrar);
  }

  return { lineas: deseadas.length, kg: Number(deseadas.reduce((s, l) => s + Number(l.Kg), 0).toFixed(2)) };
}

/**
 * Saca del piso del área lo que bodega devuelve de una remisión YA CONFIRMADA: un master (Devolver
 * master) o un polín que no se llevaron (Devolver polín). Sin esto el producto quedaba contado dos
 * veces —  en bodega y al piso—: RS-0096 el 27 oct y RS-0106 el 28 oct 2026, donde Descongelado veía
 * 80 masters de 31/35 que se habían quedado en bodega.
 *
 * A diferencia de sincronizarIngresoDeRemision, NO recalcula la remisión entera: descuenta
 * exactamente esos masters de su lote y talla. Una confirmada vieja pudo tener devoluciones hechas
 * desde el área, que ya salieron del piso allá, y recalcularla las descontaría otra vez.
 *
 * Se niega si el área ya trabajó ese producto (entonces sí estaba con ellos). Revisa ANTES de
 * escribir. Si el piso ya no tiene ese ingreso —  se vació en un reset, o la remisión es de antes del
 * piso—  no hay nada que descontar.
 */
export async function descontarDevolucionDelPiso(
  tx: any, remisionId: number, destino: Destino, masterIds: number[],
): Promise<{ kg: number }> {
  const bodega = await bodegaConPiso(tx, destino);
  if (!bodega || !masterIds.length) return { kg: 0 };

  const grupos: any[] = await tx.$queryRawUnsafe(`
    SELECT oe.Lote, DATE_FORMAT(oe.FechaProduccion, '%Y-%m-%d') AS FechaLote, dp.Clase, dp.Talla,
           ta.Descripcion AS DescripcionTalla, pre.PesoKG * pre.CajasXMaster AS KgExacto, COUNT(*) AS Masters
    FROM Masters m
    JOIN EtiquetaImpresa e ON e.EtiquetaId = m.EtiquetaId
    JOIN OrdenEtiquetado oe ON oe.OrdenId = e.OrdenId
    JOIN DetallePedido dp ON dp.DetalleId = oe.DetalleId
    JOIN Presentacion pre ON pre.Codigo = dp.Presentacion
    JOIN Tallas ta ON ta.Codigo = dp.Talla
    WHERE m.MasterId IN (${masterIds.map(() => "?").join(",")})
    GROUP BY oe.Lote, oe.FechaProduccion, dp.Clase, dp.Talla, ta.Descripcion, pre.PesoKG, pre.CajasXMaster`, ...masterIds);

  // Primero el plan y la revisión del saldo; después se escribe.
  const plan: { filas: any[]; quedan: number; kgQueda: number }[] = [];
  let kgTotal = 0;
  for (const g of grupos) {
    const kgExacto = Number(g.KgExacto);
    const filas: any[] = await tx.$queryRawUnsafe(`
      SELECT MovimientoId, Masters, PesoKg FROM MovimientoPiso
      WHERE RemisionId = ? AND Tipo = 'INGRESO' AND BodegaDestino = ? AND Lote = ? AND Clase = ? AND Talla = ?
        AND FechaLote <=> ? AND ABS(KgPorMaster - ?) < 0.0005
      ORDER BY MovimientoId FOR UPDATE`,
      remisionId, bodega, g.Lote, g.Clase, g.Talla, g.FechaLote, Number(kgExacto.toFixed(3)));
    if (!filas.length) continue;

    const tiene = filas.reduce((s, f) => s + Number(f.Masters ?? 0), 0);
    const kgTiene = filas.reduce((s, f) => s + Number(f.PesoKg), 0);
    const quedan = Math.max(0, tiene - Number(g.Masters));
    const kgQueda = quedan ? Number((quedan * kgExacto).toFixed(2)) : 0;
    const kgQuita = Number((kgTiene - kgQueda).toFixed(2));

    const [s]: any[] = await tx.$queryRawUnsafe(`
      SELECT COALESCE(SUM(CASE WHEN BodegaDestino = ? THEN PesoKg ELSE -PesoKg END), 0) AS Kg
      FROM MovimientoPiso
      WHERE RemisionId = ? AND Lote = ? AND Clase = ? AND Talla = ? AND FechaLote <=> ?
        AND (BodegaDestino = ? OR BodegaOrigen = ?)`,
      bodega, remisionId, g.Lote, g.Clase, g.Talla, g.FechaLote, bodega, bodega);
    const saldo = Number(s?.Kg ?? 0);
    if (saldo - kgQuita < -0.001) {
      const [b]: any[] = await tx.$queryRawUnsafe(`SELECT Nombre FROM BodegaVirtual WHERE Codigo = ?`, bodega);
      const area = b?.Nombre ?? bodega;
      throw new PisoEnNegativo(
        `${area} ya trabajó ese producto (lote ${g.Lote} ${g.Clase} ${g.DescripcionTalla}: al piso quedan ` +
        `${saldo.toFixed(2)} kg y lo que se devuelve pesa ${kgQuita.toFixed(2)} kg). Si de verdad regresó a bodega, ` +
        `primero hay que deshacerlo en ${area}.`);
    }
    plan.push({ filas, quedan, kgQueda });
    kgTotal += kgQuita;
  }

  // La fila más vieja conserva lo que queda (y la jornada en que entró); las demás se borran.
  for (const x of plan) {
    const [primera, ...resto] = x.filas;
    const borrar = [...resto.map(f => Number(f.MovimientoId)), ...(x.quedan ? [] : [Number(primera.MovimientoId)])];
    if (x.quedan) {
      await tx.$executeRawUnsafe(
        `UPDATE MovimientoPiso SET Peso = ?, PesoKg = ?, Masters = ? WHERE MovimientoId = ?`,
        x.kgQueda, x.kgQueda, x.quedan, Number(primera.MovimientoId));
    }
    if (borrar.length) {
      await tx.$executeRawUnsafe(
        `DELETE FROM MovimientoPiso WHERE MovimientoId IN (${borrar.map(() => "?").join(",")})`, ...borrar);
    }
  }
  return { kg: Number(kgTotal.toFixed(2)) };
}

/**
 * Lo que una remisión le dejó al piso de su área, por lote y talla: cuánto entró, cuánto ya trabajó el
 * área y cuánto queda. Es lo que ve bodega en el panel de la remisión para saber qué buscar: si queda
 * algo al piso y el área dice que no lo tiene, se quedó en bodega y hay que devolverlo.
 * Los masters de lo trabajado pueden faltar (un ajuste o una merma van en kg), así que lo que manda es
 * el kg; los masters que quedan solo se informan si cuadran.
 */
export async function pisoDeRemision(client: any, remisionId: number, destino: Destino) {
  const bodega = await bodegaConPiso(client, destino);
  if (!bodega) return null;
  const [b]: any[] = await client.$queryRawUnsafe(`SELECT Nombre FROM BodegaVirtual WHERE Codigo = ?`, bodega);
  const filas: any[] = await client.$queryRawUnsafe(`
    SELECT t.Lote, t.Clase, cl.Descripcion AS DescripcionClase, t.Talla, ta.Descripcion AS DescripcionTalla,
           DATE_FORMAT(t.FechaLote, '%Y-%m-%d') AS FechaLote,
           SUM(CASE WHEN t.Entra = 1 THEN COALESCE(t.Masters, 0) ELSE 0 END) AS EntroMasters,
           ROUND(SUM(CASE WHEN t.Entra = 1 THEN t.PesoKg ELSE 0 END), 2)    AS EntroKg,
           SUM(CASE WHEN t.Entra = 1 THEN 0 ELSE COALESCE(t.Masters, 0) END) AS SalioMasters,
           ROUND(SUM(CASE WHEN t.Entra = 1 THEN 0 ELSE t.PesoKg END), 2)    AS SalioKg
    FROM (
      SELECT Lote, Clase, Talla, FechaLote, Masters, PesoKg, CASE WHEN BodegaDestino = ? THEN 1 ELSE 0 END AS Entra
        FROM MovimientoPiso WHERE RemisionId = ? AND (BodegaDestino = ? OR BodegaOrigen = ?)
    ) t
    JOIN Clase cl ON cl.Clase = t.Clase
    JOIN Tallas ta ON ta.Codigo = t.Talla
    GROUP BY t.Lote, t.Clase, cl.Descripcion, t.Talla, ta.Descripcion, t.FechaLote
    ORDER BY t.FechaLote, t.Lote, ta.Descripcion`, bodega, remisionId, bodega, bodega);
  return {
    Bodega: bodega, NombreBodega: b?.Nombre ?? bodega,
    Lineas: filas.map(f => {
      const entroM = Number(f.EntroMasters), entroKg = Number(f.EntroKg);
      const quedaKg = Number((entroKg - Number(f.SalioKg)).toFixed(2));
      // Masters que quedan = kg que quedan ÷ peso del master, solo si da un número entero.
      const kgPorMaster = entroM ? entroKg / entroM : 0;
      const m = kgPorMaster ? Math.round(quedaKg / kgPorMaster) : null;
      const cuadra = m != null && Math.abs(quedaKg - m * kgPorMaster) < 0.05;
      return {
        Lote: f.Lote, Clase: f.Clase, DescripcionClase: f.DescripcionClase, Talla: Number(f.Talla),
        DescripcionTalla: f.DescripcionTalla, FechaLote: f.FechaLote,
        EntroMasters: entroM, EntroKg: entroKg, SalioKg: Number(f.SalioKg),
        QuedaKg: quedaKg, QuedaMasters: cuadra ? m : null,
      };
    }),
  };
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
