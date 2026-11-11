// Tratamiento (químico) — la hoja "TRATAMIENTO DE CAMARON" en pantalla.
//
// El modelo está en scripts/createTratamiento.ts. En corto: la hoja es una HojaProceso con
// BodegaCodigo = 'TRATAMIENTO' y un cliente previsto, y cada termo (cada renglón del papel) es un
// CONSUMO del piso a la hoja más, a la salida, un TRASLADO al piso del destino y una GANANCIA (o una
// MERMA) por la diferencia. Todos apuntan al consumo con ConsumoId; el consumo ES el termo.
//
// Decisiones del usuario (21-22 oct 2026):
//   - Cada lote se trata aparte y conserva su código, su clase y su talla.
//   - El cliente es una referencia: Empaque lo cambia al escanear el master. No viaja en el kardex.
//   - Pick-up = (tratadas − sin tratar) ÷ sin tratar. El papel dividía entre tratadas en cada termo
//     y entre recibidos en el total del turno: dos números distintos para la misma pregunta.
//   - Pick-up negativo (salió pesando menos) o arriba del 20 % es una ALERTA, no un ajuste: algo
//     pasó con el tiempo o con la dosis y hay que verlo. No se bloquea nada.
//   - La diferencia de báscula entre lo que dejó Pelado y lo que se pesa aquí la decide el
//     encargado: al cerrar da por terminado el lote y el residuo queda como DIFERENCIA. Si un termo
//     pesa MÁS de lo que hay al piso, se le pregunta, y el sobrante entra como DIFERENCIA al piso.
//   - Insumos: solo el consumo de cada hoja.

export const BODEGA = "TRATAMIENTO";
export const PICKUP_MAXIMO = 20;
// Un termo que pesa más de lo que hay al piso es diferencia de báscula hasta cierto punto. Pasado
// este margen ya no es la báscula: es un número mal tecleado (16.87 escrito 168.7).
const MARGEN_DIFERENCIA = 0.10;

export class ErrorNegocio extends Error {
  status: number;
  datos?: any;
  constructor(status: number, mensaje: string, datos?: any) {
    super(mensaje);
    this.status = status;
    this.datos = datos;
  }
}

const r2 = (n: number) => Number(Number(n).toFixed(2));
const enLista = (xs: any[]) => xs.map(() => "?").join(",");
const LB_POR_KG = 2.20462;
const aKg = (peso: number, um: string) => r2(um === "LB" ? peso / LB_POR_KG : peso);

export function pickup(sinTratar: number, tratadas: number | null): number | null {
  if (tratadas == null || !(sinTratar > 0)) return null;
  return Number((((tratadas - sinTratar) / sinTratar) * 100).toFixed(1));
}

export function alertaPickup(p: number | null): "PERDIDA" | "EXCEDE" | null {
  if (p == null) return null;
  if (p < 0) return "PERDIDA";
  if (p > PICKUP_MAXIMO) return "EXCEDE";
  return null;
}

// ── Horas ───────────────────────────────────────────────────────────────────────────────────────
// Las horas llegan como HH:MM. La de inicio de un termo se pega al día más cercano al inicio de la
// hoja: hasta 6 horas antes o 18 después. La hoja se abre cuando alguien la captura y el papel va
// adelante —  el 14-oct se trató desde las 05:00 y el primer marcaje del área fue a las 06:48— , así
// que un termo puede arrancar antes que la hoja. Con finDesdeHora, ese 05:00 caía al día siguiente.
const aMs = (s: string) => {
  const [d, t = "00:00:00"] = s.split(" ");
  const [a, m, dd] = d.split("-").map(Number);
  const [h, mi, se = 0] = t.split(":").map(Number);
  return Date.UTC(a, m - 1, dd, h, mi, se);
};
const deMs = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

export function horaCercana(ref: string, hhmm: string): string {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) throw new ErrorNegocio(400, `Hora inválida: ${hhmm}`);
  const base = aMs(`${ref.slice(0, 10)} ${hhmm}:00`);
  const r = aMs(ref);
  const H = 3600_000;
  for (const dia of [0, 1, -1]) {
    const c = base + dia * 24 * H;
    if (c - r > -6 * H && c - r <= 18 * H) return deMs(c);
  }
  return deMs(base);
}

// La salida va después del inicio: si la hora queda antes, el termo cruzó la medianoche. Es la
// misma regla de finDesdeHora en routes/descongelado.ts.
export function finDesdeHora(ini: string, hhmm: string): string {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) throw new ErrorNegocio(400, `Hora inválida: ${hhmm}`);
  const fin = aMs(`${ini.slice(0, 10)} ${hhmm}:00`);
  return deMs(fin < aMs(ini) ? fin + 24 * 3600_000 : fin);
}

// ── Lecturas ────────────────────────────────────────────────────────────────────────────────────
// La llave de una línea del piso es la misma de Descongelado y de Materia Prima (remisión, lote,
// clase, talla y fecha del lote): un consumo tiene que caer exactamente sobre la fila de la que sale.
export type Clave = { RemisionId: number | null; Lote: string; Clase: string; Talla: number; FechaLote: string | null };
export const claveDe = (x: any) =>
  `${x.RemisionId == null || x.RemisionId === "" ? "" : Number(x.RemisionId)}|${x.Lote}|${x.Clase}|${Number(x.Talla)}|${x.FechaLote ?? ""}`;

/**
 * El saldo al piso por línea. Con `hasta` es el de esa jornada cerrada (lo que quedó al final del
 * día); sin él, el de ahora. Los días al piso se cuentan contra esa misma fecha.
 */
export async function saldoPiso(client: any, bodega = BODEGA, lotes?: string[], hasta?: string) {
  const filtro = (lotes?.length ? `AND Lote IN (${enLista(lotes)})` : "") + (hasta ? " AND FechaProduccion <= ?" : "");
  const rama = [bodega, ...(lotes ?? []), ...(hasta ? [hasta] : [])];
  const args = [hasta ?? null, ...rama, ...rama];
  const rows: any[] = await client.$queryRawUnsafe(`
    SELECT t.RemisionId, t.Lote, t.Clase, cl.Descripcion AS DescripcionClase,
           t.Talla, ta.Descripcion AS DescripcionTalla, DATE_FORMAT(t.FechaLote, '%Y-%m-%d') AS FechaLote,
           DATE_FORMAT(MIN(CASE WHEN t.Delta > 0 THEN t.FechaProduccion END), '%Y-%m-%d') AS FechaIngreso,
           DATEDIFF(COALESCE(?, CURDATE()), MIN(CASE WHEN t.Delta > 0 THEN t.FechaProduccion END)) AS DiasAlPiso,
           ROUND(SUM(t.Delta), 2) AS Kg
      FROM (
        SELECT RemisionId, Lote, Clase, Talla, FechaLote, FechaProduccion,  PesoKg AS Delta
          FROM MovimientoPiso WHERE BodegaDestino = ? ${filtro}
        UNION ALL
        SELECT RemisionId, Lote, Clase, Talla, FechaLote, FechaProduccion, -PesoKg
          FROM MovimientoPiso WHERE BodegaOrigen = ? ${filtro}
      ) t
      JOIN Clase cl ON cl.Clase = t.Clase
      JOIN Tallas ta ON ta.Codigo = t.Talla
     GROUP BY t.RemisionId, t.Lote, t.Clase, cl.Descripcion, t.Talla, ta.Descripcion, t.FechaLote
    HAVING Kg > 0.001
     ORDER BY MIN(CASE WHEN t.Delta > 0 THEN t.FechaProduccion END), t.Lote, t.Clase, t.Talla`, ...args);
  // Los termos de cada línea: solo para el saldo de ahora (el del reporte de una jornada no los usa).
  const lineas = rows.map(r => ({
    ...r,
    RemisionId: r.RemisionId == null ? null : Number(r.RemisionId),
    Talla: Number(r.Talla), Kg: Number(r.Kg),
    DiasAlPiso: r.DiasAlPiso == null ? null : Number(r.DiasAlPiso),
  }));
  if (hasta || !lineas.length) return lineas.map(l => ({ ...l, TermosDetalle: [] as TermoPiso[], Termos: null as string | null }));
  const porLinea = await termosDelPiso(client, bodega, [...new Set(lineas.map(l => String(l.Lote)))]);
  return lineas.map(l => {
    const det = porLinea.get(claveDe(l)) ?? [];
    return { ...l, TermosDetalle: det, Termos: det.filter(t => t.NumeroTermo).map(t => t.NumeroTermo).join(", ") || null };
  });
}

// ── Termos de cada línea del piso ───────────────────────────────────────────────────────────────
// Lo del piso se trata POR TERMO (usuario, 10 nov 2026), igual que lo que se toma de Pelado. Una
// línea llega al cerrar una transacción de Pelado (un PROCESADO con el total); sus termos son los de
// esa transacción con sus pesadas, sin los que Tratamiento ya se llevó aparte. Cada termo se
// identifica por (transacción de Pelado, número): el mismo número puede repetirse entre transacciones.
//   - Lo que entra con termo propio (un termo tomado de Pelado) es su propio termo.
//   - Lo que entra sin termo, o lo que el cierre trasladó y no cuadra con sus termos (más de 0.05 kg),
//     queda "sin termo": a la vista, no escondido.
//   - Lo que sale por termo (CONSUMO con TransaccionId y NumeroTermo) se descuenta de ese termo; lo
//     que sale sin termo (la línea completa, hojas de antes) se descuenta de los más viejos primero.
// Así la suma de los termos es siempre el saldo de la línea.
export type TermoPiso = { TransaccionId: number | null; NumeroTermo: string | null; Kg: number };

async function termosDelPiso(client: any, bodega: string, lotes: string[]) {
  const out = new Map<string, TermoPiso[]>();
  if (!lotes.length) return out;
  const movs: any[] = await client.$queryRawUnsafe(`
    SELECT m.MovimientoId, m.RemisionId, m.Lote, m.Clase, m.Talla, DATE_FORMAT(m.FechaLote, '%Y-%m-%d') AS FechaLote,
           m.Tipo, m.TransaccionId, NULLIF(TRIM(m.NumeroTermo), '') AS NumeroTermo, m.PesoKg, m.BodegaDestino = ? AS Entra
      FROM MovimientoPiso m
     WHERE (m.BodegaDestino = ? OR m.BodegaOrigen = ?) AND m.Lote IN (${enLista(lotes)})
     ORDER BY m.MovimientoId`, bodega, bodega, bodega, ...lotes);

  // Los termos (con pesadas) de las transacciones que cerraron hacia este piso, y los ya tomados.
  const cierres = [...new Set(movs.filter(m => Number(m.Entra) === 1 && m.Tipo === "PROCESADO" && m.NumeroTermo == null && m.TransaccionId != null)
    .map(m => Number(m.TransaccionId)))];
  const termosDe = new Map<number, { NumeroTermo: string; Kg: number }[]>();
  if (cierres.length) {
    const ts: any[] = await client.$queryRawUnsafe(`
      SELECT t.TransaccionId, t.NumeroTermo, MIN(t.TermoId) AS Orden, SUM(pd.Peso) AS Peso, l.UM
        FROM Termos t
        JOIN PesajeDetalle pd ON pd.TermoId = t.TermoId
        JOIN TransaccionesProduccion tp ON tp.TransaccionId = t.TransaccionId
        JOIN Lotes l ON l.Lote = tp.Lote AND l.Clase = tp.ClaseOrigen
       WHERE t.TransaccionId IN (${enLista(cierres)})
         AND NOT EXISTS (SELECT 1 FROM MovimientoPiso x
                          WHERE x.Tipo = 'PROCESADO' AND x.TransaccionId = t.TransaccionId AND x.NumeroTermo = t.NumeroTermo)
       GROUP BY t.TransaccionId, t.NumeroTermo, l.UM
       ORDER BY t.TransaccionId, MIN(t.TermoId)`, ...cierres);
    for (const t of ts) {
      const id = Number(t.TransaccionId);
      if (!termosDe.has(id)) termosDe.set(id, []);
      termosDe.get(id)!.push({ NumeroTermo: String(t.NumeroTermo), Kg: aKg(Number(t.Peso), String(t.UM)) });
    }
  }

  type Cubeta = TermoPiso & { orden: number };
  const lineas = new Map<string, { cubetas: Map<string, Cubeta>; sinDueno: number }>();
  const cubeta = (L: { cubetas: Map<string, Cubeta> }, t: number | null, n: string | null, orden: number) => {
    const k = `${t ?? ""}|${n ?? ""}`;
    if (!L.cubetas.has(k)) L.cubetas.set(k, { TransaccionId: t, NumeroTermo: n, Kg: 0, orden });
    return L.cubetas.get(k)!;
  };
  for (const m of movs) {
    const k = claveDe({ ...m, RemisionId: m.RemisionId == null ? null : Number(m.RemisionId) });
    if (!lineas.has(k)) lineas.set(k, { cubetas: new Map(), sinDueno: 0 });
    const L = lineas.get(k)!;
    const kg = Number(m.PesoKg);
    const trans = m.TransaccionId == null ? null : Number(m.TransaccionId);
    const orden = Number(m.MovimientoId) * 1000;
    if (Number(m.Entra) === 1) {
      if (m.Tipo === "PROCESADO" && m.NumeroTermo == null && trans != null && termosDe.get(trans)?.length) {
        // El cierre: se reparte en los termos de su transacción; lo que no cuadra queda sin termo.
        const ts = termosDe.get(trans)!;
        let resto = kg;
        ts.forEach((t, i) => { cubeta(L, trans, t.NumeroTermo, orden + i).Kg += t.Kg; resto -= t.Kg; });
        if (Math.abs(resto) > 0.05) {
          if (resto > 0) cubeta(L, null, null, orden + ts.length).Kg += resto;
          else L.sinDueno += -resto;
        } else {
          cubeta(L, trans, ts[ts.length - 1].NumeroTermo, orden).Kg += resto;   // centavos de redondeo
        }
      } else if (trans != null && m.NumeroTermo != null) {
        cubeta(L, trans, String(m.NumeroTermo), orden).Kg += kg;
      } else {
        cubeta(L, null, null, orden).Kg += kg;
      }
    } else {
      const c = trans != null && m.NumeroTermo != null ? L.cubetas.get(`${trans}|${m.NumeroTermo}`) : undefined;
      if (c) {
        c.Kg -= kg;
        if (c.Kg < 0) { L.sinDueno += -c.Kg; c.Kg = 0; }
      } else {
        L.sinDueno += kg;
      }
    }
  }
  for (const [k, L] of lineas) {
    const cs = [...L.cubetas.values()].sort((a, b) => a.orden - b.orden);
    let sinDueno = L.sinDueno;
    for (const c of cs) {
      const quita = Math.min(c.Kg, sinDueno);
      c.Kg -= quita; sinDueno -= quita;
    }
    out.set(k, cs.filter(c => c.Kg > 0.005).map(c => ({ TransaccionId: c.TransaccionId, NumeroTermo: c.NumeroTermo, Kg: r2(c.Kg) })));
  }
  return out;
}

// Los números de los termos de una línea, para anotarlos de guía cuando entra completa: caben en
// NumeroTermo (VARCHAR 20) sin espacios y, si no alcanza, cortados con "…".
const guiaCorta = (det: TermoPiso[] | undefined) => {
  const s = (det ?? []).filter(t => t.NumeroTermo).map(t => t.NumeroTermo).join(",");
  if (!s) return null;
  return s.length <= 20 ? s : `${s.slice(0, 19)}…`;
};

async function saldoDeClave(client: any, bodega: string, c: Clave) {
  const s = (await saldoPiso(client, bodega, [c.Lote])).find(x => claveDe(x) === claveDe(c));
  return s?.Kg ?? 0;
}

// Lo tratado sigue hacia adelante, nunca hacia atrás: las bodegas con piso que vienen después de
// Tratamiento en el flujo (Blast, Túnel, Empinchado, Empanizado…).
export async function destinos(client: any) {
  const rows: any[] = await client.$queryRawUnsafe(`
    SELECT b.Codigo, b.Nombre FROM BodegaVirtual b
     WHERE b.Activo = 1 AND b.LlevaPiso = 1
       AND b.Orden > (SELECT Orden FROM BodegaVirtual WHERE Codigo = ?)
     ORDER BY b.Orden`, BODEGA);
  return rows as { Codigo: string; Nombre: string }[];
}

export async function insumos(client: any) {
  const rows: any[] = await client.$queryRawUnsafe(
    `SELECT Codigo, Nombre, UM, EsQuimico, Orden FROM Insumo WHERE Activo = 1 ORDER BY Orden`);
  return rows.map(r => ({ ...r, EsQuimico: Number(r.EsQuimico) === 1, Orden: Number(r.Orden) }));
}

export async function listarHojas(client: any, fecha: string) {
  const rows: any[] = await client.$queryRawUnsafe(`
    SELECT h.HojaId, DATE_FORMAT(h.FechaProduccion, '%Y-%m-%d') AS FechaProduccion, h.Estatus,
           h.ClienteCodigo, c.RazonSocial AS NombreCliente,
           h.Encargado, CONCAT_WS(' ', e.PrimerNombre, e.PrimerApellido) AS NombreEncargado,
           DATE_FORMAT(h.HoraInicio, '%Y-%m-%d %H:%i') AS HoraInicio,
           DATE_FORMAT(h.HoraFin, '%Y-%m-%d %H:%i') AS HoraFin,
           (SELECT COUNT(*) FROM TratamientoTermo tt JOIN MovimientoPiso m ON m.MovimientoId = tt.ConsumoId
             WHERE m.HojaDestinoId = h.HojaId) AS Termos
      FROM HojaProceso h
      LEFT JOIN Clientes c ON c.Codigo = h.ClienteCodigo
      LEFT JOIN Empleados e ON e.Codigo = h.Encargado
     WHERE h.BodegaCodigo = ? AND h.FechaProduccion = ?
     ORDER BY h.HojaId`, BODEGA, fecha);
  return rows.map(r => ({ ...r, Termos: Number(r.Termos), ClienteCodigo: r.ClienteCodigo == null ? null : Number(r.ClienteCodigo) }));
}

/** Los termos de una hoja, con sus pesos sacados del kardex y el pick-up calculado. */
export async function termosDeHoja(client: any, hojaId: number) {
  return termosDeHojas(client, [hojaId]);
}

/** Los termos de varias hojas en UNA consulta: el reporte del día no hace un viaje por hoja. */
export async function termosDeHojas(client: any, hojaIds: number[]) {
  if (!hojaIds.length) return [];
  const rows: any[] = await client.$queryRawUnsafe(`
    SELECT c.HojaDestinoId AS HojaId, c.MovimientoId AS TermoId, c.NumeroTermo, c.RemisionId, c.Lote, c.Clase, cl.Descripcion AS DescripcionClase,
           c.TransaccionId AS TransaccionPelado,
           EXISTS (SELECT 1 FROM MovimientoPiso p
                    WHERE p.Tipo = 'PROCESADO' AND p.TransaccionId = c.TransaccionId AND p.NumeroTermo = c.NumeroTermo) AS TomadoDePelado,
           c.Talla, ta.Descripcion AS DescripcionTalla, DATE_FORMAT(c.FechaLote, '%Y-%m-%d') AS FechaLote,
           c.PesoKg AS KgSinTratar,
           DATE_FORMAT(t.HoraInicio, '%Y-%m-%d %H:%i') AS HoraInicio,
           DATE_FORMAT(t.HoraSalida, '%Y-%m-%d %H:%i') AS HoraSalida,
           TIMESTAMPDIFF(MINUTE, t.HoraInicio, t.HoraSalida) AS Minutos,
           t.ConteoInicial, t.ConteoFinal, t.QuimicoCodigo, q.Nombre AS NombreQuimico,
           tr.PesoKg AS KgTratadas, tr.BodegaDestino, b.Nombre AS NombreDestino,
           (SELECT ROUND(SUM(d.PesoKg), 2) FROM MovimientoPiso d
             WHERE d.ConsumoId = c.MovimientoId AND d.Tipo = 'DIFERENCIA') AS KgDiferencia
      FROM MovimientoPiso c
      JOIN TratamientoTermo t ON t.ConsumoId = c.MovimientoId
      JOIN Clase cl ON cl.Clase = c.Clase
      JOIN Tallas ta ON ta.Codigo = c.Talla
      LEFT JOIN Insumo q ON q.Codigo = t.QuimicoCodigo
      LEFT JOIN MovimientoPiso tr ON tr.ConsumoId = c.MovimientoId AND tr.Tipo = 'TRASLADO'
      LEFT JOIN BodegaVirtual b ON b.Codigo = tr.BodegaDestino
     WHERE c.HojaDestinoId IN (${enLista(hojaIds)}) AND c.Tipo = 'CONSUMO'
     ORDER BY t.HoraInicio, c.MovimientoId`, ...hojaIds);
  return rows.map(r => {
    const sin = Number(r.KgSinTratar);
    const trat = r.KgTratadas == null ? null : Number(r.KgTratadas);
    const p = pickup(sin, trat);
    return {
      ...r,
      HojaId: Number(r.HojaId), TermoId: Number(r.TermoId), Talla: Number(r.Talla),
      TransaccionPelado: r.TransaccionPelado == null ? null : Number(r.TransaccionPelado),
      TomadoDePelado: Number(r.TomadoDePelado) === 1,
      RemisionId: r.RemisionId == null ? null : Number(r.RemisionId),
      KgSinTratar: sin, KgTratadas: trat,
      KgGanados: trat == null ? null : r2(trat - sin),
      Minutos: r.Minutos == null ? null : Number(r.Minutos),
      ConteoInicial: r.ConteoInicial == null ? null : Number(r.ConteoInicial),
      ConteoFinal: r.ConteoFinal == null ? null : Number(r.ConteoFinal),
      KgDiferencia: r.KgDiferencia == null ? null : Number(r.KgDiferencia),
      Pickup: p, Alerta: alertaPickup(p),
    };
  });
}

/**
 * Totales del turno. El pick-up es el de lo que ya salió: un termo todavía en el termo no tiene. Por
 * eso los kilos en termo van aparte —  sin ellos, "recibidos 1,053 · tratados 995 · ganados +98" se
 * leía como pérdida y era ganancia: lo que faltaba seguía en el termo.
 *   KgRecibidos − KgEnTermo = lo que salió sin tratar;  KgTratados − eso = KgGanados.
 */
export function totales(termos: Awaited<ReturnType<typeof termosDeHoja>>) {
  const recibidos = r2(termos.reduce((s, t) => s + t.KgSinTratar, 0));
  const salidos = termos.filter(t => t.KgTratadas != null);
  const base = r2(salidos.reduce((s, t) => s + t.KgSinTratar, 0));
  const tratados = r2(salidos.reduce((s, t) => s + (t.KgTratadas ?? 0), 0));
  const p = pickup(base, salidos.length ? tratados : null);
  return {
    Termos: termos.length, EnTermo: termos.length - salidos.length,
    KgRecibidos: recibidos, KgEnTermo: r2(recibidos - base), KgTratados: tratados, KgGanados: r2(tratados - base),
    Pickup: p, Alerta: alertaPickup(p), Alertas: termos.filter(t => t.Alerta).length,
  };
}

/**
 * Las líneas del piso de las que tomó la hoja y que todavía tienen kilos: son las que el encargado
 * puede dar por terminadas al cerrar. Si la hoja ya está cerrada, también trae las diferencias que
 * dejó.
 */
export async function lineasDeHoja(client: any, hojaId: number) {
  const tomadas: any[] = await client.$queryRawUnsafe(`
    SELECT RemisionId, Lote, Clase, Talla, DATE_FORMAT(FechaLote, '%Y-%m-%d') AS FechaLote,
           ROUND(SUM(CASE WHEN Motivo IS NULL THEN PesoKg ELSE 0 END), 2) AS KgTomado
      FROM MovimientoPiso WHERE HojaDestinoId = ? AND Tipo = 'CONSUMO'
     GROUP BY RemisionId, Lote, Clase, Talla, FechaLote`, hojaId);
  if (!tomadas.length) return [];
  const lotes = [...new Set(tomadas.map(t => String(t.Lote)))];
  const saldo = new Map((await saldoPiso(client, BODEGA, lotes)).map(s => [claveDe(s), s]));
  const dif: any[] = await client.$queryRawUnsafe(`
    SELECT RemisionId, Lote, Clase, Talla, DATE_FORMAT(FechaLote, '%Y-%m-%d') AS FechaLote, ROUND(SUM(PesoKg), 2) AS Kg
      FROM MovimientoPiso WHERE HojaOrigenId = ? AND Tipo = 'DIFERENCIA'
     GROUP BY RemisionId, Lote, Clase, Talla, FechaLote`, hojaId);
  const difPor = new Map(dif.map(d => [claveDe(d), Number(d.Kg)]));
  return tomadas.map(t => {
    const k = claveDe(t);
    const s = saldo.get(k);
    return {
      Clave: k, RemisionId: t.RemisionId == null ? null : Number(t.RemisionId),
      Lote: t.Lote, Clase: t.Clase, Talla: Number(t.Talla), FechaLote: t.FechaLote,
      DescripcionClase: s?.DescripcionClase ?? null, DescripcionTalla: s?.DescripcionTalla ?? null,
      KgTomado: Number(t.KgTomado), KgAlPiso: s?.Kg ?? 0, KgDiferencia: difPor.get(k) ?? 0,
    };
  });
}

export async function detalleHoja(client: any, hojaId: number) {
  const [h]: any[] = await client.$queryRawUnsafe(`
    SELECT h.HojaId, h.BodegaCodigo, DATE_FORMAT(h.FechaProduccion, '%Y-%m-%d') AS FechaProduccion, h.Estatus,
           h.ClienteCodigo, c.RazonSocial AS NombreCliente,
           h.Encargado, CONCAT_WS(' ', e.PrimerNombre, e.PrimerApellido) AS NombreEncargado,
           DATE_FORMAT(h.HoraInicio, '%Y-%m-%d %H:%i') AS HoraInicio,
           DATE_FORMAT(h.HoraFin, '%Y-%m-%d %H:%i') AS HoraFin,
           h.Personas, h.Observaciones, h.CreadoPor, h.CerradaPor,
           DATE_FORMAT(h.CerradaEn, '%Y-%m-%d %H:%i') AS CerradaEn
      FROM HojaProceso h
      LEFT JOIN Clientes c ON c.Codigo = h.ClienteCodigo
      LEFT JOIN Empleados e ON e.Codigo = h.Encargado
     WHERE h.HojaId = ?`, hojaId);
  if (!h || h.BodegaCodigo !== BODEGA) throw new ErrorNegocio(404, "Hoja de tratamiento no encontrada");
  const termos = await termosDeHoja(client, hojaId);
  const ins: any[] = await client.$queryRawUnsafe(`
    SELECT i.Codigo, i.Nombre, i.UM, i.EsQuimico, hi.Cantidad
      FROM Insumo i LEFT JOIN HojaInsumo hi ON hi.InsumoCodigo = i.Codigo AND hi.HojaId = ?
     WHERE i.Activo = 1 OR hi.Cantidad IS NOT NULL
     ORDER BY i.Orden`, hojaId);
  return {
    ...h,
    ClienteCodigo: h.ClienteCodigo == null ? null : Number(h.ClienteCodigo),
    Personas: h.Personas == null ? null : Number(h.Personas),
    Termos: termos,
    Totales: totales(termos),
    Insumos: ins.map(i => ({ Codigo: i.Codigo, Nombre: i.Nombre, UM: i.UM, EsQuimico: Number(i.EsQuimico) === 1,
                             Cantidad: i.Cantidad == null ? null : Number(i.Cantidad) })),
    Lineas: await lineasDeHoja(client, hojaId),
  };
}

// ── Escrituras ──────────────────────────────────────────────────────────────────────────────────
async function hojaParaEditar(tx: any, hojaId: number) {
  const [h]: any[] = await tx.$queryRawUnsafe(`
    SELECT HojaId, BodegaCodigo, Estatus, DATE_FORMAT(FechaProduccion, '%Y-%m-%d') AS Fecha,
           DATE_FORMAT(HoraInicio, '%Y-%m-%d %H:%i:%s') AS Ini
      FROM HojaProceso WHERE HojaId = ? FOR UPDATE`, hojaId);
  if (!h || h.BodegaCodigo !== BODEGA) throw new ErrorNegocio(404, "Hoja de tratamiento no encontrada");
  if (h.Estatus !== "Abierta") throw new ErrorNegocio(400, "La hoja está cerrada: reábrala para cambiarla");
  return h as { HojaId: number; Fecha: string; Ini: string | null };
}

async function termoParaEditar(tx: any, termoId: number) {
  const [c]: any[] = await tx.$queryRawUnsafe(`
    SELECT c.MovimientoId, c.HojaDestinoId, c.RemisionId, c.Lote, c.Clase, c.Talla,
           DATE_FORMAT(c.FechaLote, '%Y-%m-%d') AS FechaLote, c.PesoKg, c.NumeroTermo, c.TransaccionId,
           DATE_FORMAT(t.HoraInicio, '%Y-%m-%d %H:%i:%s') AS HoraInicio
      FROM MovimientoPiso c JOIN TratamientoTermo t ON t.ConsumoId = c.MovimientoId
     WHERE c.MovimientoId = ? FOR UPDATE`, termoId);
  if (!c) throw new ErrorNegocio(404, "Termo no encontrado");
  const hoja = await hojaParaEditar(tx, Number(c.HojaDestinoId));
  return { c, hoja };
}

async function validarCliente(tx: any, cliente: any) {
  const codigo = Number(cliente);
  if (!codigo) throw new ErrorNegocio(400, "Escoja el cliente previsto");
  const [c]: any[] = await tx.$queryRawUnsafe(`SELECT Codigo, Estatus FROM Clientes WHERE Codigo = ?`, codigo);
  if (!c) throw new ErrorNegocio(400, `El cliente ${codigo} no existe`);
  return codigo;
}

async function validarQuimico(tx: any, q: any) {
  if (q == null || q === "") return null;
  const [r]: any[] = await tx.$queryRawUnsafe(`SELECT Codigo FROM Insumo WHERE Codigo = ? AND EsQuimico = 1`, String(q));
  if (!r) throw new ErrorNegocio(400, `${q} no es un químico del catálogo`);
  return String(q);
}

const conteo = (v: any, que: string) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ErrorNegocio(400, `El conteo ${que} debe ser un entero mayor que cero`);
  return n;
};

const kilos = (v: any, que: string) => {
  const n = r2(Number(v));
  if (!(n > 0)) throw new ErrorNegocio(400, `Los kg ${que} deben ser mayores que cero`);
  return n;
};

export async function crearHoja(tx: any, p: { fecha: string; cliente: any; encargado?: string | null;
                                              horaInicio?: string | null; operador: string }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.fecha)) throw new ErrorNegocio(400, "Fecha inválida");
  const cliente = await validarCliente(tx, p.cliente);
  // Una hoja por cliente: si ya hay una abierta ese día para ese cliente, los termos van ahí.
  const [ya]: any[] = await tx.$queryRawUnsafe(`
    SELECT HojaId FROM HojaProceso
     WHERE BodegaCodigo = ? AND FechaProduccion = ? AND ClienteCodigo = ? AND Estatus = 'Abierta' LIMIT 1`,
    BODEGA, p.fecha, cliente);
  if (ya) throw new ErrorNegocio(400, `Ya hay una hoja abierta de ese cliente ese día (#${ya.HojaId}): use esa.`);
  const ini = p.horaInicio && /^\d{2}:\d{2}$/.test(p.horaInicio) ? `${p.fecha} ${p.horaInicio}:00` : null;
  await tx.$executeRawUnsafe(`
    INSERT INTO HojaProceso (BodegaCodigo, FechaProduccion, ClienteCodigo, Encargado, HoraInicio, Estatus, CreadoPor)
    VALUES (?, ?, ?, ?, ?, 'Abierta', ?)`, BODEGA, p.fecha, cliente, p.encargado || null, ini, p.operador);
  const [r]: any[] = await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`);
  return { HojaId: Number(r.id) };
}

export async function editarHoja(tx: any, hojaId: number, p: { cliente?: any; encargado?: string | null;
                                                                horaInicio?: string | null; observaciones?: string | null }) {
  const h = await hojaParaEditar(tx, hojaId);
  if (p.cliente !== undefined) {
    const cliente = await validarCliente(tx, p.cliente);
    await tx.$executeRawUnsafe(`UPDATE HojaProceso SET ClienteCodigo = ? WHERE HojaId = ?`, cliente, hojaId);
  }
  if (p.encargado !== undefined) {
    await tx.$executeRawUnsafe(`UPDATE HojaProceso SET Encargado = ? WHERE HojaId = ?`, p.encargado || null, hojaId);
  }
  if (p.horaInicio) {
    if (!/^\d{2}:\d{2}$/.test(p.horaInicio)) throw new ErrorNegocio(400, "Hora de inicio inválida");
    await tx.$executeRawUnsafe(`UPDATE HojaProceso SET HoraInicio = ? WHERE HojaId = ?`, `${h.Fecha} ${p.horaInicio}:00`, hojaId);
  }
  if (p.observaciones !== undefined) {
    await tx.$executeRawUnsafe(`UPDATE HojaProceso SET Observaciones = ? WHERE HojaId = ?`,
      p.observaciones ? String(p.observaciones).slice(0, 500) : null, hojaId);
  }
  return { ok: true };
}

/** Solo una hoja vacía se elimina: con termos o insumos ya es un registro del día. */
export async function eliminarHoja(tx: any, hojaId: number) {
  await hojaParaEditar(tx, hojaId);
  const [n]: any[] = await tx.$queryRawUnsafe(`
    SELECT (SELECT COUNT(*) FROM MovimientoPiso WHERE HojaDestinoId = ? OR HojaOrigenId = ?) AS m,
           (SELECT COUNT(*) FROM HojaInsumo WHERE HojaId = ?) AS i`, hojaId, hojaId, hojaId);
  if (Number(n.m) > 0 || Number(n.i) > 0) throw new ErrorNegocio(400, "La hoja ya tiene termos o insumos: quítelos antes de eliminarla");
  await tx.$executeRawUnsafe(`DELETE FROM HojaProceso WHERE HojaId = ?`, hojaId);
  return { ok: true };
}

export type Entrada = Clave & {
  NumeroTermo?: string | null; HoraInicio: string; ConteoInicial?: any; Quimico?: any; KgSinTratar?: any;
  AceptarDiferencia?: boolean;
  // La línea del piso entra COMPLETA, con los kg que tenga al piso en ese momento (usuario, 10 nov
  // 2026: se trata tal como llega de Pelado, sin anotar termo ni pesar). KgSinTratar se ignora.
  TodaLaLinea?: boolean;
  // Un TERMO de la línea del piso (TransaccionTermo + NumeroTermo; los dos null = lo que está sin
  // termo): entra completo con lo que le queda al piso (termosDelPiso). KgSinTratar se ignora.
  TermoPiso?: boolean;
  TransaccionTermo?: any;
};

/**
 * Entra a tratamiento: sus kg sin tratar salen del piso en ese momento. El número de termo es
 * opcional: lo traen los termos tomados de Pelado; lo que entra del piso tal cual no lo lleva.
 */
export async function registrarEntrada(tx: any, hojaId: number, e: Entrada, operador: string) {
  const hoja = await hojaParaEditar(tx, hojaId);
  let numero = String(e.NumeroTermo ?? "").trim() || null;
  const todaLaLinea = !!e.TodaLaLinea;
  // Lo que entra completo (la línea o un termo del piso) toma sus kg del piso, no de lo tecleado.
  let kg = todaLaLinea || e.TermoPiso ? 0 : kilos(e.KgSinTratar, "sin tratar");
  const quimico = await validarQuimico(tx, e.Quimico);
  const conteoIni = conteo(e.ConteoInicial, "inicial");
  const clave: Clave = {
    RemisionId: e.RemisionId == null || (e.RemisionId as any) === "" ? null : Number(e.RemisionId),
    Lote: String(e.Lote ?? "").trim(), Clase: String(e.Clase ?? "").trim(),
    Talla: Number(e.Talla) || 900, FechaLote: e.FechaLote || null,
  };
  if (!clave.Lote || !clave.Clase) throw new ErrorNegocio(400, "Escoja el lote del inventario al piso");

  // Dos termos a la vez sobre el mismo piso: el saldo se calcula sumando y no se bloquea solo, así
  // que se serializa sobre la fila de la bodega (mismo patrón que tomarDelPiso).
  await tx.$queryRawUnsafe(`SELECT Codigo FROM BodegaVirtual WHERE Codigo = ? FOR UPDATE`, BODEGA);
  const hay = await saldoDeClave(tx, BODEGA, clave);
  if (hay <= 0.001) throw new ErrorNegocio(400, `${clave.Lote} ${clave.Clase} ya no tiene kilos al piso de Tratamiento`);
  // La línea completa lleva de guía los termos de Pelado de los que salió (si no traía número).
  if (todaLaLinea) {
    kg = r2(hay);
    if (!numero) numero = guiaCorta((await termosDelPiso(tx, BODEGA, [clave.Lote])).get(claveDe(clave)));
  }
  // Un termo del piso entra completo, con lo que le queda.
  let transTermo: number | null = null;
  if (e.TermoPiso) {
    transTermo = e.TransaccionTermo == null || e.TransaccionTermo === "" ? null : Number(e.TransaccionTermo);
    const det = (await termosDelPiso(tx, BODEGA, [clave.Lote])).get(claveDe(clave)) ?? [];
    const t = det.find(x => x.TransaccionId === transTermo && x.NumeroTermo === numero);
    if (!t) throw new ErrorNegocio(400, `${numero ? `El termo ${numero}` : "Lo que estaba sin termo"} de ${clave.Lote} ${clave.Clase} ya no está al piso`);
    kg = t.Kg;
  }
  const exceso = r2(kg - hay);
  if (exceso > 0.001) {
    if (exceso > Math.max(1, hay * MARGEN_DIFERENCIA)) {
      throw new ErrorNegocio(400,
        `El termo pesa ${kg.toFixed(2)} kg y al piso solo hay ${hay.toFixed(2)} kg de ${clave.Lote} ${clave.Clase}. ` +
        `Son ${exceso.toFixed(2)} kg de más: revise el peso.`);
    }
    if (!e.AceptarDiferencia) {
      throw new ErrorNegocio(409,
        `El termo pesa ${exceso.toFixed(2)} kg más de lo que hay al piso (${hay.toFixed(2)} kg). ` +
        `¿Es diferencia de báscula?`, { Codigo: "DIFERENCIA", KgAlPiso: hay, Exceso: exceso });
    }
  }

  const ini = horaCercana(hoja.Ini ?? `${hoja.Fecha} 06:00:00`, String(e.HoraInicio ?? ""));
  await tx.$executeRawUnsafe(`
    INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaOrigen, HojaDestinoId, RemisionId, Lote, Clase, Talla,
                                FechaLote, Peso, UM, PesoKg, NumeroTermo, RegistradoPor)
    VALUES ('CONSUMO', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'KG', ?, ?, ?)`,
    hoja.Fecha, BODEGA, hojaId, clave.RemisionId, clave.Lote, clave.Clase, clave.Talla, clave.FechaLote,
    kg, kg, numero, operador);
  const [r]: any[] = await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`);
  const termoId = Number(r.id);
  // De qué transacción de Pelado es el termo: con el número, lo identifica en termosDelPiso.
  if (transTermo != null) await tx.$executeRawUnsafe(`UPDATE MovimientoPiso SET TransaccionId = ? WHERE MovimientoId = ?`, transTermo, termoId);
  if (exceso > 0.001) {
    // El sobrante entra al piso antes de que el termo lo tome: el piso queda en cero, no en negativo.
    await tx.$executeRawUnsafe(`
      INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaDestino, RemisionId, Lote, Clase, Talla, FechaLote,
                                  Peso, UM, PesoKg, NumeroTermo, ConsumoId, Motivo, RegistradoPor)
      VALUES ('DIFERENCIA', ?, ?, ?, ?, ?, ?, ?, ?, 'KG', ?, ?, ?, 'Diferencia de báscula (sobrante)', ?)`,
      hoja.Fecha, BODEGA, clave.RemisionId, clave.Lote, clave.Clase, clave.Talla, clave.FechaLote,
      exceso, exceso, numero, termoId, operador);
  }
  await tx.$executeRawUnsafe(`
    INSERT INTO TratamientoTermo (ConsumoId, HoraInicio, ConteoInicial, QuimicoCodigo) VALUES (?, ?, ?, ?)`,
    termoId, ini, conteoIni, quimico);
  // La hoja empieza con su primer termo: si el papel arrancó antes que el sistema, se corre.
  if (!hoja.Ini || ini < hoja.Ini) {
    await tx.$executeRawUnsafe(`UPDATE HojaProceso SET HoraInicio = ? WHERE HojaId = ?`, ini, hojaId);
  }
  return { TermoId: termoId, KgDiferencia: exceso > 0.001 ? exceso : 0 };
}

/** Corrige los datos de entrada. Los kilos solo mientras el termo no haya salido. */
export async function editarEntrada(tx: any, termoId: number, e: Partial<Entrada>) {
  const { c, hoja } = await termoParaEditar(tx, termoId);
  // Un termo tomado de Pelado es el termo físico de Pelado con lo que pesaron en él: su número y sus
  // kilos no se corrigen aquí (se quita el termo, vuelve a Pelado, y allá se corrigen las pesadas).
  if (c.TransaccionId != null) {
    if (e.NumeroTermo !== undefined && String(e.NumeroTermo ?? "").trim() !== String(c.NumeroTermo)) {
      throw new ErrorNegocio(400, "El número es el del termo de Pelado: no se cambia aquí");
    }
    if (e.KgSinTratar !== undefined && Math.abs(Number(e.KgSinTratar) - Number(c.PesoKg)) > 0.001) {
      throw new ErrorNegocio(400, "Los kg son los de las pesadas de Pelado: quite el termo para que vuelva a Pelado y corrija allá");
    }
  }
  if (e.NumeroTermo !== undefined) {
    // Opcional: lo que entró del piso tal cual no lleva número de termo.
    const numero = String(e.NumeroTermo ?? "").trim() || null;
    await tx.$executeRawUnsafe(`UPDATE MovimientoPiso SET NumeroTermo = ? WHERE MovimientoId = ? OR ConsumoId = ?`,
      numero, termoId, termoId);
  }
  if (e.HoraInicio !== undefined) {
    const ini = horaCercana(hoja.Ini ?? `${hoja.Fecha} 06:00:00`, String(e.HoraInicio));
    await tx.$executeRawUnsafe(`UPDATE TratamientoTermo SET HoraInicio = ? WHERE ConsumoId = ?`, ini, termoId);
    if (!hoja.Ini || ini < hoja.Ini) await tx.$executeRawUnsafe(`UPDATE HojaProceso SET HoraInicio = ? WHERE HojaId = ?`, ini, hoja.HojaId);
  }
  if (e.ConteoInicial !== undefined) {
    await tx.$executeRawUnsafe(`UPDATE TratamientoTermo SET ConteoInicial = ? WHERE ConsumoId = ?`, conteo(e.ConteoInicial, "inicial"), termoId);
  }
  if (e.Quimico !== undefined) {
    await tx.$executeRawUnsafe(`UPDATE TratamientoTermo SET QuimicoCodigo = ? WHERE ConsumoId = ?`, await validarQuimico(tx, e.Quimico), termoId);
  }
  if (e.KgSinTratar !== undefined) {
    const kg = kilos(e.KgSinTratar, "sin tratar");
    if (Math.abs(kg - Number(c.PesoKg)) > 0.001) {
      const [s]: any[] = await tx.$queryRawUnsafe(
        `SELECT COUNT(*) AS n FROM MovimientoPiso WHERE ConsumoId = ? AND Tipo IN ('TRASLADO','DIFERENCIA')`, termoId);
      if (Number(s.n) > 0) {
        throw new ErrorNegocio(400, "Para cambiar los kg sin tratar, quite primero la salida del termo (o elimine el termo y vuelva a registrarlo)");
      }
      await tx.$queryRawUnsafe(`SELECT Codigo FROM BodegaVirtual WHERE Codigo = ? FOR UPDATE`, BODEGA);
      const hay = await saldoDeClave(tx, BODEGA, c);
      if (kg > Number(c.PesoKg) + hay + 0.001) {
        throw new ErrorNegocio(400, `Al piso solo quedan ${hay.toFixed(2)} kg más de ${c.Lote} ${c.Clase}`);
      }
      await tx.$executeRawUnsafe(`UPDATE MovimientoPiso SET Peso = ?, PesoKg = ? WHERE MovimientoId = ?`, kg, kg, termoId);
    }
  }
  return { ok: true };
}

export type Salida = { HoraSalida: string; ConteoFinal?: any; KgTratadas: any; BodegaDestino: string };

/** Quita la salida de un termo, solo si lo tratado sigue al piso del destino (nadie lo tomó). */
async function quitarSalida(tx: any, termoId: number) {
  const [tr]: any[] = await tx.$queryRawUnsafe(`
    SELECT MovimientoId, BodegaDestino, RemisionId, Lote, Clase, Talla, DATE_FORMAT(FechaLote, '%Y-%m-%d') AS FechaLote, PesoKg
      FROM MovimientoPiso WHERE ConsumoId = ? AND Tipo = 'TRASLADO' FOR UPDATE`, termoId);
  if (!tr) return false;
  await tx.$queryRawUnsafe(`SELECT Codigo FROM BodegaVirtual WHERE Codigo = ? FOR UPDATE`, tr.BodegaDestino);
  const hay = await saldoDeClave(tx, String(tr.BodegaDestino), tr);
  if (hay < Number(tr.PesoKg) - 0.001) {
    throw new ErrorNegocio(400, `Lo tratado de este termo ya lo tomó ${tr.BodegaDestino}: no se puede deshacer la salida.`);
  }
  await tx.$executeRawUnsafe(
    `DELETE FROM MovimientoPiso WHERE ConsumoId = ? AND Tipo IN ('TRASLADO','GANANCIA','MERMA')`, termoId);
  await tx.$executeRawUnsafe(
    `UPDATE TratamientoTermo SET HoraSalida = NULL, ConteoFinal = NULL WHERE ConsumoId = ?`, termoId);
  return true;
}

/**
 * El termo sale de la tina: lo tratado pasa al piso del destino en ese momento, sin esperar a que
 * se cierre la hoja. Registrarla otra vez reemplaza la anterior.
 */
export async function registrarSalida(tx: any, termoId: number, s: Salida, operador: string) {
  const { c, hoja } = await termoParaEditar(tx, termoId);
  const trat = kilos(s.KgTratadas, "tratadas");
  const destino = String(s.BodegaDestino ?? "");
  if (!(await destinos(tx)).some(d => d.Codigo === destino)) throw new ErrorNegocio(400, "Escoja a dónde va lo tratado");
  const conteoFin = conteo(s.ConteoFinal, "final");
  if (!/^\d{2}:\d{2}$/.test(String(s.HoraSalida ?? ""))) throw new ErrorNegocio(400, "Falta la hora de salida");
  const salida = finDesdeHora(String(c.HoraInicio), String(s.HoraSalida));

  await quitarSalida(tx, termoId);
  const sin = Number(c.PesoKg);
  const comun = [c.RemisionId, c.Lote, c.Clase, Number(c.Talla), c.FechaLote];
  await tx.$executeRawUnsafe(`
    INSERT INTO MovimientoPiso (Tipo, FechaProduccion, HojaOrigenId, BodegaDestino, RemisionId, Lote, Clase, Talla,
                                FechaLote, Peso, UM, PesoKg, NumeroTermo, ConsumoId, RegistradoPor)
    VALUES ('TRASLADO', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'KG', ?, ?, ?, ?)`,
    hoja.Fecha, hoja.HojaId, destino, ...comun, trat, trat, c.NumeroTermo, termoId, operador);
  const dif = r2(trat - sin);
  if (dif > 0.001) {
    await tx.$executeRawUnsafe(`
      INSERT INTO MovimientoPiso (Tipo, FechaProduccion, HojaDestinoId, RemisionId, Lote, Clase, Talla, FechaLote,
                                  Peso, UM, PesoKg, NumeroTermo, ConsumoId, RegistradoPor)
      VALUES ('GANANCIA', ?, ?, ?, ?, ?, ?, ?, ?, 'KG', ?, ?, ?, ?)`,
      hoja.Fecha, hoja.HojaId, ...comun, dif, dif, c.NumeroTermo, termoId, operador);
  } else if (dif < -0.001) {
    await tx.$executeRawUnsafe(`
      INSERT INTO MovimientoPiso (Tipo, FechaProduccion, HojaOrigenId, RemisionId, Lote, Clase, Talla, FechaLote,
                                  Peso, UM, PesoKg, NumeroTermo, ConsumoId, Motivo, RegistradoPor)
      VALUES ('MERMA', ?, ?, ?, ?, ?, ?, ?, ?, 'KG', ?, ?, ?, 'Pick-up negativo', ?)`,
      hoja.Fecha, hoja.HojaId, ...comun, -dif, -dif, c.NumeroTermo, termoId, operador);
  }
  await tx.$executeRawUnsafe(
    `UPDATE TratamientoTermo SET HoraSalida = ?, ConteoFinal = ? WHERE ConsumoId = ?`, salida, conteoFin, termoId);
  const p = pickup(sin, trat);
  return { ok: true, Pickup: p, Alerta: alertaPickup(p) };
}

export async function deshacerSalida(tx: any, termoId: number) {
  await termoParaEditar(tx, termoId);
  if (!(await quitarSalida(tx, termoId))) throw new ErrorNegocio(400, "El termo todavía no tiene salida");
  return { ok: true };
}

/**
 * Quita el termo: sus kg sin tratar vuelven al piso de Tratamiento. Si se tomó de Pelado, VUELVE A
 * PELADO (usuario, 10 nov 2026): se borra también su PROCESADO y el termo queda abierto otra vez para
 * pesar. Solo mientras la transacción de Pelado siga abierta; cerrada, sus kilos ya no tendrían a
 * dónde volver.
 */
export async function eliminarTermo(tx: any, termoId: number) {
  // La transacción de Pelado se bloquea ANTES que la hoja, en el mismo orden que al tomar el termo.
  const [pre]: any[] = await tx.$queryRawUnsafe(`
    SELECT c.TransaccionId, c.NumeroTermo,
           EXISTS (SELECT 1 FROM MovimientoPiso p
                    WHERE p.Tipo = 'PROCESADO' AND p.TransaccionId = c.TransaccionId AND p.NumeroTermo = c.NumeroTermo) AS DePelado
      FROM MovimientoPiso c WHERE c.MovimientoId = ? AND c.Tipo = 'CONSUMO'`, termoId);
  // Un termo que salió del piso también lleva su transacción, pero ese vuelve al piso, no a Pelado.
  const transPelado = pre?.TransaccionId == null || Number(pre.DePelado) !== 1 ? null : Number(pre.TransaccionId);
  if (transPelado != null) {
    const [tp]: any[] = await tx.$queryRawUnsafe(
      `SELECT Estado FROM TransaccionesProduccion WHERE TransaccionId = ? FOR UPDATE`, transPelado);
    if (tp && String(tp.Estado) !== "Abierta") {
      throw new ErrorNegocio(400,
        `El termo ${pre.NumeroTermo} vino de la transacción #${transPelado} de Pelado, que ya se cerró: reábrala para devolverle el termo.`);
    }
  }
  await termoParaEditar(tx, termoId);
  await quitarSalida(tx, termoId);
  // El sobrante de báscula que entró por este termo también se va: sin el termo no hay de qué.
  await tx.$executeRawUnsafe(`DELETE FROM MovimientoPiso WHERE ConsumoId = ? AND Tipo = 'DIFERENCIA'`, termoId);
  await tx.$executeRawUnsafe(`DELETE FROM TratamientoTermo WHERE ConsumoId = ?`, termoId);
  await tx.$executeRawUnsafe(`DELETE FROM MovimientoPiso WHERE MovimientoId = ?`, termoId);
  if (transPelado != null) {
    await tx.$executeRawUnsafe(
      `DELETE FROM MovimientoPiso WHERE Tipo = 'PROCESADO' AND TransaccionId = ? AND NumeroTermo = ?`, transPelado, String(pre.NumeroTermo));
  }
  return { ok: true, VolvioAPelado: transPelado != null };
}

/** El consumo de insumos de la hoja. Reemplaza lo anterior; una cantidad vacía o en cero lo quita. */
export async function guardarInsumos(tx: any, hojaId: number, lista: { Codigo: string; Cantidad: any }[], operador: string) {
  await hojaParaEditar(tx, hojaId);
  const validos = new Set((await insumos(tx)).map(i => i.Codigo));
  // Todo se valida antes de borrar: una lista con un error no puede dejar la hoja a medias.
  const filas: [string, number][] = [];
  for (const i of lista ?? []) {
    if (i.Cantidad == null || i.Cantidad === "") continue;
    const n = r2(Number(i.Cantidad));
    if (!Number.isFinite(n) || n < 0) throw new ErrorNegocio(400, `Cantidad inválida para ${i.Codigo}`);
    if (n === 0) continue;
    if (!validos.has(String(i.Codigo))) throw new ErrorNegocio(400, `${i.Codigo} no es un insumo del catálogo`);
    filas.push([String(i.Codigo), n]);
  }
  await tx.$executeRawUnsafe(`DELETE FROM HojaInsumo WHERE HojaId = ?`, hojaId);
  for (const [codigo, n] of filas) {
    await tx.$executeRawUnsafe(
      `INSERT INTO HojaInsumo (HojaId, InsumoCodigo, Cantidad, RegistradoPor) VALUES (?, ?, ?, ?)`,
      hojaId, codigo, n, operador);
  }
  return { ok: true };
}

/**
 * Cierra la hoja. Todos los termos tienen que haber salido. Las líneas que el encargado da por
 * terminadas dejan su residuo como DIFERENCIA: un CONSUMO del piso a la hoja y la DIFERENCIA de la
 * hoja a nada, el mismo par de siempre, para que el piso quede en cero y la hoja cuadre.
 */
export async function cerrarHoja(tx: any, hojaId: number, p: { horaFin?: string | null; terminar?: string[];
                                                               personas?: number | null; operador: string }) {
  const hoja = await hojaParaEditar(tx, hojaId);
  const termos = await termosDeHoja(tx, hojaId);
  if (!termos.length) throw new ErrorNegocio(400, "La hoja no tiene termos: no hay nada que cerrar");
  const enTermo = termos.filter(t => t.KgTratadas == null);
  if (enTermo.length) {
    throw new ErrorNegocio(400, `Falta la salida de ${enTermo.length} termo${enTermo.length > 1 ? "s" : ""}: ` +
      enTermo.map(t => t.NumeroTermo ?? `${t.Lote} ${t.DescripcionTalla}`).join(", "));
  }

  const terminar = new Set(p.terminar ?? []);
  if (terminar.size) {
    await tx.$queryRawUnsafe(`SELECT Codigo FROM BodegaVirtual WHERE Codigo = ? FOR UPDATE`, BODEGA);
    const lineas = await lineasDeHoja(tx, hojaId);
    for (const k of terminar) {
      const l = lineas.find(x => x.Clave === k);
      if (!l) throw new ErrorNegocio(400, "Solo se da por terminado un lote del que tomó esta hoja");
      if (l.KgAlPiso <= 0.001) continue;
      const comun = [l.RemisionId, l.Lote, l.Clase, l.Talla, l.FechaLote, l.KgAlPiso, l.KgAlPiso];
      await tx.$executeRawUnsafe(`
        INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaOrigen, HojaDestinoId, RemisionId, Lote, Clase, Talla,
                                    FechaLote, Peso, UM, PesoKg, Motivo, RegistradoPor)
        VALUES ('CONSUMO', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'KG', ?, 'Diferencia de báscula', ?)`,
        hoja.Fecha, BODEGA, hojaId, ...comun, p.operador);
      const [r]: any[] = await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`);
      await tx.$executeRawUnsafe(`
        INSERT INTO MovimientoPiso (Tipo, FechaProduccion, HojaOrigenId, RemisionId, Lote, Clase, Talla,
                                    FechaLote, Peso, UM, PesoKg, ConsumoId, Motivo, RegistradoPor)
        VALUES ('DIFERENCIA', ?, ?, ?, ?, ?, ?, ?, ?, 'KG', ?, ?, 'Diferencia de báscula', ?)`,
        hoja.Fecha, hojaId, ...comun, Number(r.id), p.operador);
    }
  }

  // Sin hora de fin, la hoja termina con la salida del último termo.
  const ultima = termos.map(t => t.HoraSalida).filter(Boolean).sort().pop() as string | undefined;
  const ini = hoja.Ini ?? `${hoja.Fecha} 00:00:00`;
  const fin = p.horaFin && /^\d{2}:\d{2}$/.test(p.horaFin) ? finDesdeHora(ini, p.horaFin)
            : ultima ? `${ultima}:00` : null;
  await tx.$executeRawUnsafe(`
    UPDATE HojaProceso SET Estatus = 'Cerrada', HoraFin = ?, Personas = ?, CerradaPor = ?, CerradaEn = NOW()
     WHERE HojaId = ?`, fin, p.personas ?? null, p.operador, hojaId);
  return { ok: true, Totales: totales(termos) };
}

/** Reabre la hoja: las diferencias que dejó el cierre se borran y esos kilos vuelven al piso. */
export async function reabrirHoja(tx: any, hojaId: number) {
  const [h]: any[] = await tx.$queryRawUnsafe(
    `SELECT BodegaCodigo, Estatus FROM HojaProceso WHERE HojaId = ? FOR UPDATE`, hojaId);
  if (!h || h.BodegaCodigo !== BODEGA) throw new ErrorNegocio(404, "Hoja de tratamiento no encontrada");
  if (h.Estatus !== "Cerrada") throw new ErrorNegocio(400, "La hoja ya está abierta");
  const dif: any[] = await tx.$queryRawUnsafe(
    `SELECT MovimientoId, ConsumoId FROM MovimientoPiso WHERE HojaOrigenId = ? AND Tipo = 'DIFERENCIA' FOR UPDATE`, hojaId);
  if (dif.length) {
    await tx.$executeRawUnsafe(`DELETE FROM MovimientoPiso WHERE MovimientoId IN (${enLista(dif)})`, ...dif.map(d => Number(d.MovimientoId)));
    await tx.$executeRawUnsafe(`DELETE FROM MovimientoPiso WHERE MovimientoId IN (${enLista(dif)})`, ...dif.map(d => Number(d.ConsumoId)));
  }
  await tx.$executeRawUnsafe(
    `UPDATE HojaProceso SET Estatus = 'Abierta', CerradaPor = NULL, CerradaEn = NULL WHERE HojaId = ?`, hojaId);
  return { ok: true, DiferenciasBorradas: dif.length };
}

// ── Reporte de la jornada ───────────────────────────────────────────────────────────────────────
// El día completo del área, no una hoja: las hojas (una por cliente previsto), el cuadre del piso,
// lo tratado por destino, por cliente y por lote, y el consumo de insumos. Sin personas, sin la lista
// de termos con alerta ni la de diferencias (decisión del usuario, 22 oct 2026): el detalle por termo
// está en la hoja impresa de cada turno, y el total de diferencias sigue en el cuadre.
//
// El cuadre se arma con el kardex y no con las hojas, para que diga dónde está TODO lo que entró:
//   al piso al iniciar + recibido en la jornada − tomado por los termos − diferencias = queda al piso
// y "queda al piso" sale de la misma función del saldo, así que si el cuadre no cierra es que hay un
// movimiento que el reporte no clasificó (se muestra como "otras salidas", nunca se esconde).
const ORIGEN: Record<string, string> = {
  PROCESADO: "Pelado (cierre de transacción)", DIFERENCIA: "Diferencia de báscula (sobrante)",
  INGRESO: "Remisión de bodega", TRASLADO: "Traslado de otra hoja", BAJADO: "Bajado de una mesa", COLA: "Cola de Descabezado",
};

export async function reporteDia(client: any, fecha: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ErrorNegocio(400, "Fecha inválida");
  const hojas = await listarHojas(client, fecha);
  const todos = await termosDeHojas(client, hojas.map(h => h.HojaId));
  const cliente = new Map(hojas.map(h => [h.HojaId, h.NombreCliente]));
  const termos = todos.map(t => ({ ...t, NombreCliente: cliente.get(t.HojaId) }));
  const porHoja = hojas.map(h => ({ ...h, Totales: totales(todos.filter(t => t.HojaId === h.HojaId)) }));

  // ── Cuadre del piso ──
  const [ini]: any[] = await client.$queryRawUnsafe(`
    SELECT ROUND(COALESCE(SUM(CASE WHEN BodegaDestino = ? THEN PesoKg ELSE -PesoKg END), 0), 2) AS Kg
      FROM MovimientoPiso WHERE (BodegaDestino = ? OR BodegaOrigen = ?) AND FechaProduccion < ?`, BODEGA, BODEGA, BODEGA, fecha);
  const recibido: any[] = await client.$queryRawUnsafe(`
    SELECT m.MovimientoId, m.Tipo, m.Lote, m.Clase, cl.Descripcion AS DescripcionClase, m.Talla, ta.Descripcion AS DescripcionTalla,
           DATE_FORMAT(m.FechaLote, '%Y-%m-%d') AS FechaLote, m.PesoKg, m.TransaccionId, m.NumeroTermo
      FROM MovimientoPiso m JOIN Clase cl ON cl.Clase = m.Clase JOIN Tallas ta ON ta.Codigo = m.Talla
     WHERE m.BodegaDestino = ? AND m.FechaProduccion = ?
     ORDER BY m.MovimientoId`, BODEGA, fecha);
  const salidas: any[] = await client.$queryRawUnsafe(`
    SELECT m.MovimientoId, m.Motivo, m.PesoKg, tt.ConsumoId IS NOT NULL AS EsTermo
      FROM MovimientoPiso m
      LEFT JOIN TratamientoTermo tt ON tt.ConsumoId = m.MovimientoId
     WHERE m.BodegaOrigen = ? AND m.FechaProduccion = ?`, BODEGA, fecha);
  const sum = (xs: any[]) => r2(xs.reduce((s, x) => s + Number(x.PesoKg), 0));
  const deTermos = salidas.filter(s => Number(s.EsTermo) === 1);
  const diferencias = salidas.filter(s => Number(s.EsTermo) !== 1 && s.Motivo === "Diferencia de báscula");
  const otras = salidas.filter(s => Number(s.EsTermo) !== 1 && s.Motivo !== "Diferencia de báscula");
  const alPiso = await saldoPiso(client, BODEGA, undefined, fecha);

  // ── Agrupados de lo tratado (solo termos que ya salieron) ──
  const agrupar = (clave: (t: any) => string, base: (t: any) => any) => {
    const m = new Map<string, any>();
    for (const t of termos) {
      const k = clave(t);
      const g = m.get(k) ?? { ...base(t), Termos: 0, KgSinTratar: 0, KgTratadas: 0, BaseSalida: 0, Alertas: 0 };
      g.Termos++; g.KgSinTratar = r2(g.KgSinTratar + t.KgSinTratar);
      if (t.KgTratadas != null) { g.KgTratadas = r2(g.KgTratadas + t.KgTratadas); g.BaseSalida = r2(g.BaseSalida + t.KgSinTratar); }
      if (t.Alerta) g.Alertas++;
      m.set(k, g);
    }
    return [...m.values()].map(g => {
      const p = pickup(g.BaseSalida, g.BaseSalida > 0 ? g.KgTratadas : null);
      return { ...g, KgEnTermo: r2(g.KgSinTratar - g.BaseSalida), KgGanados: r2(g.KgTratadas - g.BaseSalida), Pickup: p, Alerta: alertaPickup(p) };
    });
  };
  const porLote = agrupar(t => `${t.Lote}|${t.Clase}|${t.Talla}`,
    t => ({ Lote: t.Lote, Clase: t.Clase, DescripcionClase: t.DescripcionClase, Talla: t.Talla, DescripcionTalla: t.DescripcionTalla }))
    .sort((a, b) => a.Lote.localeCompare(b.Lote) || a.Talla - b.Talla);
  const porCliente = agrupar(t => String(t.NombreCliente ?? "—"), t => ({ Cliente: t.NombreCliente ?? "—" }));
  const porDestino = new Map<string, { Destino: string; Termos: number; Kg: number }>();
  for (const t of termos.filter(x => x.KgTratadas != null)) {
    const d = porDestino.get(t.NombreDestino) ?? { Destino: t.NombreDestino, Termos: 0, Kg: 0 };
    d.Termos++; d.Kg = r2(d.Kg + t.KgTratadas);
    porDestino.set(t.NombreDestino, d);
  }

  const insumosDia: any[] = await client.$queryRawUnsafe(`
    SELECT i.Codigo, i.Nombre, i.UM, ROUND(SUM(hi.Cantidad), 2) AS Cantidad
      FROM HojaInsumo hi JOIN HojaProceso h ON h.HojaId = hi.HojaId JOIN Insumo i ON i.Codigo = hi.InsumoCodigo
     WHERE h.BodegaCodigo = ? AND h.FechaProduccion = ?
     GROUP BY i.Codigo, i.Nombre, i.UM, i.Orden ORDER BY i.Orden`, BODEGA, fecha);
  const tot = totales(termos);

  const recibidoKg = sum(recibido);
  return {
    Fecha: fecha,
    PickupMaximo: PICKUP_MAXIMO,
    Hojas: porHoja,
    Totales: tot,
    Cuadre: {
      InicioKg: Number(ini.Kg), RecibidoKg: recibidoKg, TomadoTermosKg: sum(deTermos),
      DiferenciasKg: sum(diferencias), OtrasSalidasKg: sum(otras),
      AlPisoKg: r2(alPiso.reduce((s, l) => s + l.Kg, 0)),
    },
    Recibido: recibido.map(x => ({
      ...x, Origen: x.Tipo === "PROCESADO" && x.NumeroTermo ? `Pelado (termo ${x.NumeroTermo} tomado en proceso)` : ORIGEN[x.Tipo] ?? x.Tipo, MovimientoId: Number(x.MovimientoId), Talla: Number(x.Talla), PesoKg: Number(x.PesoKg),
    })),
    PorLote: porLote,
    PorCliente: porCliente,
    PorDestino: [...porDestino.values()],
    Insumos: insumosDia.map(i => ({
      ...i, Cantidad: Number(i.Cantidad),
      // Cuánto se gastó por cada 100 kg tratados: el número que se compara entre días y clientes.
      Por100Kg: tot.KgTratados > 0 ? Number(((Number(i.Cantidad) / tot.KgTratados) * 100).toFixed(2)) : null,
    })),
    AlPiso: alPiso,
  };
}

// ── En lote: tratar lo del piso y sacar varios termos a la vez ──────────────────────────────────
// La hoja no se abre a mano (decisión del usuario, 22 oct 2026): se marca lo del piso, "Tratar" y se
// escoge el cliente. Si ese cliente ya tiene hoja abierta ese día, los termos van ahí; si no, se crea
// —  una hoja por cliente, como dice el papel— , y nunca queda una hoja vacía.
//
// Todo o nada: corre dentro de UNA transacción, y si un termo falla no queda escrito ninguno. El
// error dice cuál renglón fue (Indice) para que la pantalla lo marque en su sitio. Los kg sin tratar
// llegan siempre tecleados: se pesan en Tratamiento, no se copian del piso.
const conIndice = (i: number, e: any) => {
  if (e instanceof ErrorNegocio) {
    throw new ErrorNegocio(e.status, `Renglón ${i + 1}: ${e.message}`, { ...(e.datos ?? {}), Indice: i });
  }
  throw e;
};

// El lote es todo o nada por sí mismo, no solo porque la ruta abra una transacción: si un renglón
// falla, se deshace lo que ya habían escrito los anteriores (los termos registrados, la hoja si se
// acababa de abrir), aunque quien llame siga dentro de una transacción más grande —  como la prueba.
// No se usa SAVEPOINT porque MariaDB no lo acepta por el protocolo de consultas preparadas de Prisma.
async function todoONada<R>(fn: (deshacer: (f: () => Promise<any>) => void) => Promise<R>): Promise<R> {
  const pendientes: (() => Promise<any>)[] = [];
  try {
    return await fn(f => { pendientes.push(f); });
  } catch (e) {
    for (const f of pendientes.reverse()) await f();
    throw e;
  }
}

// ── Termos de Pelado ────────────────────────────────────────────────────────────────────────────
// Tratamiento no espera a que Pelado cierre la transacción (usuario, 10 nov 2026): los termos se van
// llenando durante el día y cada uno necesita sus 3-4 horas de tratamiento. Tratamiento ve los termos
// de las transacciones abiertas de Pelado —  el pesaje por persona ya dice en qué termo cae cada
// pesada—  y TOMA el que va a trabajar:
//   - PROCESADO de ese termo (con NumeroTermo y TransaccionId) al piso de Tratamiento, y en el mismo
//     paso su CONSUMO en la hoja, con el mismo número de termo y la transacción de Pelado.
//   - El termo queda cerrado para Pelado: no se pesa más en él ni se corrigen sus pesadas
//     (routes/pesajeDetalle.ts), y la pantalla de pesaje lo avisa.
//   - Al cerrar la transacción, Pelado solo traslada lo que no se llevó Tratamiento
//     (lib/destajoPiso.ts, infoCierre.PorTrasladar).
//   - Quitar el termo de la hoja lo devuelve a Pelado (eliminarTermo).
// Los kg sin tratar son los de las pesadas del termo: es el mismo termo físico.
const FAMILIAS_DE_COLA = ["D", "M"];   // las de lib/destajoPiso.ts: ahí lo pesado es cabeza, no se trata

/** Los termos con pesadas de las transacciones abiertas de Pelado que Tratamiento todavía no tomó. */
export async function termosEnPelado(client: any) {
  const rows: any[] = await client.$queryRawUnsafe(`
    SELECT tp.TransaccionId, tp.Lote, tp.ClaseOrigen, tp.ClasePT AS Clase, cp.Descripcion AS DescripcionClase,
           tp.Talla, ta.Descripcion AS DescripcionTalla, pr.Descripcion AS DescripcionProceso, l.UM,
           DATE_FORMAT(COALESCE(l.FechaProduccion, l.Fecha), '%Y-%m-%d') AS FechaLote,
           t.NumeroTermo, COUNT(pd.PesajeId) AS Pesadas, SUM(pd.Peso) AS Peso,
           DATE_FORMAT(MIN(pd.FechaHora), '%Y-%m-%d %H:%i') AS Primera,
           DATE_FORMAT(MAX(pd.FechaHora), '%Y-%m-%d %H:%i') AS Ultima,
           TIMESTAMPDIFF(MINUTE, MAX(pd.FechaHora), NOW()) AS MinutosSinPesar
      FROM TransaccionesProduccion tp
      JOIN Clase cp ON cp.Clase = tp.ClasePT
      JOIN Tallas ta ON ta.Codigo = tp.Talla
      JOIN Procesos pr ON pr.Proceso = tp.Proceso
      JOIN Lotes l ON l.Lote = tp.Lote AND l.Clase = tp.ClaseOrigen
      JOIN Termos t ON t.TransaccionId = tp.TransaccionId
      JOIN PesajeDetalle pd ON pd.TermoId = t.TermoId
     WHERE tp.Estado = 'Abierta' AND COALESCE(cp.Familia, '') NOT IN (${enLista(FAMILIAS_DE_COLA)})
       AND NOT EXISTS (SELECT 1 FROM MovimientoPiso m
                        WHERE m.Tipo = 'PROCESADO' AND m.TransaccionId = tp.TransaccionId AND m.NumeroTermo = t.NumeroTermo)
     GROUP BY tp.TransaccionId, tp.Lote, tp.ClaseOrigen, tp.ClasePT, cp.Descripcion, tp.Talla, ta.Descripcion,
              pr.Descripcion, l.UM, l.FechaProduccion, l.Fecha, t.TermoId, t.NumeroTermo
    HAVING SUM(pd.Peso) > 0
     ORDER BY tp.Lote, tp.ClasePT, tp.Talla, MIN(pd.FechaHora)`, ...FAMILIAS_DE_COLA);
  return rows.map(r => ({
    ...r,
    TransaccionId: Number(r.TransaccionId), Talla: Number(r.Talla), Pesadas: Number(r.Pesadas),
    Peso: r2(Number(r.Peso)), Kg: aKg(Number(r.Peso), String(r.UM)),
    MinutosSinPesar: r.MinutosSinPesar == null ? null : Number(r.MinutosSinPesar),
  }));
}

export type TermoPelado = { TransaccionId: any; NumeroTermo: any; HoraInicio: string; Kg?: any };

/** Tratamiento toma un termo de Pelado y lo mete a la hoja (ver arriba). */
export async function tomarTermoDePelado(tx: any, hojaId: number, fecha: string, x: TermoPelado, operador: string) {
  const id = Number(x.TransaccionId);
  const numero = String(x.NumeroTermo ?? "").trim();
  if (!id || !numero) throw new ErrorNegocio(400, "Falta la transacción o el número del termo de Pelado");
  // La misma fila que bloquea cada pesada (routes/pesajeDetalle.ts): una pesada y la toma del mismo
  // termo no pueden cruzarse.
  const [bloq]: any[] = await tx.$queryRawUnsafe(
    `SELECT Estado FROM TransaccionesProduccion WHERE TransaccionId = ? FOR UPDATE`, id);
  if (!bloq) throw new ErrorNegocio(404, `La transacción #${id} de Pelado no existe`);
  if (String(bloq.Estado) !== "Abierta") {
    throw new ErrorNegocio(400, `La transacción #${id} de Pelado ya se cerró: lo pesado se trasladó al cerrarla`);
  }
  const [t]: any[] = await tx.$queryRawUnsafe(`
    SELECT tp.Lote, tp.ClaseOrigen, tp.ClasePT, tp.Talla, cp.Familia, l.UM,
           DATE_FORMAT(COALESCE(l.FechaProduccion, l.Fecha), '%Y-%m-%d') AS FechaLote
      FROM TransaccionesProduccion tp
      JOIN Clase cp ON cp.Clase = tp.ClasePT
      JOIN Lotes l ON l.Lote = tp.Lote AND l.Clase = tp.ClaseOrigen
     WHERE tp.TransaccionId = ?`, id);
  if (FAMILIAS_DE_COLA.includes(String(t.Familia ?? ""))) {
    throw new ErrorNegocio(400, `La transacción #${id} es de Descabezado: lo pesado ahí es cabeza`);
  }
  const [ya]: any[] = await tx.$queryRawUnsafe(
    `SELECT 1 AS x FROM MovimientoPiso WHERE Tipo = 'PROCESADO' AND TransaccionId = ? AND NumeroTermo = ? LIMIT 1`, id, numero);
  if (ya) throw new ErrorNegocio(400, `Tratamiento ya tomó el termo ${numero} de la transacción #${id}`);
  const [p]: any[] = await tx.$queryRawUnsafe(`
    SELECT COALESCE(SUM(pd.Peso), 0) AS Peso FROM PesajeDetalle pd JOIN Termos te ON te.TermoId = pd.TermoId
     WHERE te.TransaccionId = ? AND te.NumeroTermo = ?`, id, numero);
  const peso = r2(Number(p.Peso));
  if (!(peso > 0)) throw new ErrorNegocio(400, `El termo ${numero} no tiene pesadas en la transacción #${id}`);
  const um = String(t.UM);
  const kg = aKg(peso, um);
  // Lo que se vio en pantalla tiene que ser lo que se lleva: si entró una pesada mientras tanto, se avisa.
  if (x.Kg != null && x.Kg !== "" && Math.abs(Number(x.Kg) - kg) > 0.005) {
    throw new ErrorNegocio(409,
      `El termo ${numero} cambió mientras lo escogía: ahora tiene ${kg.toFixed(2)} kg (antes ${Number(x.Kg).toFixed(2)}). ` +
      `Actualice y vuelva a tomarlo.`, { Codigo: "CAMBIO", Kg: kg });
  }

  await tx.$executeRawUnsafe(`
    INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaDestino, Lote, Clase, Talla, FechaLote,
                                Peso, UM, PesoKg, NumeroTermo, LoteProceso, ClaseProceso, TransaccionId, RegistradoPor)
    VALUES ('PROCESADO', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    fecha, BODEGA, t.Lote, t.ClasePT, Number(t.Talla), t.FechaLote, peso, um, kg, numero, t.Lote, t.ClaseOrigen, id, operador);
  const e = await registrarEntrada(tx, hojaId, {
    RemisionId: null, Lote: String(t.Lote), Clase: String(t.ClasePT), Talla: Number(t.Talla), FechaLote: t.FechaLote,
    NumeroTermo: numero, HoraInicio: x.HoraInicio, KgSinTratar: kg,
  }, operador);
  await tx.$executeRawUnsafe(`UPDATE MovimientoPiso SET TransaccionId = ? WHERE MovimientoId = ?`, id, e.TermoId);
  return { ...e, TransaccionId: id, NumeroTermo: numero, Kg: kg };
}

const conIndicePelado = (i: number, numero: any, e: any) => {
  if (e instanceof ErrorNegocio) {
    throw new ErrorNegocio(e.status, `Termo ${numero ?? ""} de Pelado: ${e.message}`, { ...(e.datos ?? {}), IndicePelado: i });
  }
  throw e;
};

export async function tratarDelPiso(tx: any, p: {
  fecha: string; cliente: any; encargado?: string | null; horaInicio?: string | null;
  termos: Entrada[]; termosPelado?: TermoPelado[]; operador: string;
}) {
  const dePiso = Array.isArray(p.termos) ? p.termos : [];
  const dePelado = Array.isArray(p.termosPelado) ? p.termosPelado : [];
  if (!dePiso.length && !dePelado.length) throw new ErrorNegocio(400, "No escogió nada del piso ni de Pelado");
  return todoONada(async deshacer => {
    const cliente = await validarCliente(tx, p.cliente);
    const [abierta]: any[] = await tx.$queryRawUnsafe(`
      SELECT HojaId FROM HojaProceso
       WHERE BodegaCodigo = ? AND FechaProduccion = ? AND ClienteCodigo = ? AND Estatus = 'Abierta'
       ORDER BY HojaId LIMIT 1 FOR UPDATE`, BODEGA, p.fecha, cliente);
    let hojaId: number;
    if (abierta) hojaId = Number(abierta.HojaId);
    else {
      hojaId = (await crearHoja(tx, { fecha: p.fecha, cliente, encargado: p.encargado, horaInicio: p.horaInicio, operador: p.operador })).HojaId;
      deshacer(() => tx.$executeRawUnsafe(`DELETE FROM HojaProceso WHERE HojaId = ?`, hojaId));
    }
    const termos = [];
    for (const [i, e] of dePiso.entries()) {
      try {
        const t = await registrarEntrada(tx, hojaId, e, p.operador);
        deshacer(() => eliminarTermo(tx, t.TermoId));
        termos.push(t);
      } catch (err) { conIndice(i, err); }
    }
    for (const [i, x] of dePelado.entries()) {
      try {
        const t = await tomarTermoDePelado(tx, hojaId, p.fecha, x, p.operador);
        deshacer(() => eliminarTermo(tx, t.TermoId));
        termos.push(t);
      } catch (err) { conIndicePelado(i, x?.NumeroTermo, err); }
    }
    return { HojaId: hojaId, HojaNueva: !abierta, Termos: termos };
  });
}

/** Varios termos salen juntos: hora y destino comunes, kg tratadas y conteo final de cada uno. */
export async function registrarSalidas(tx: any, p: {
  horaSalida: string; destino: string; salidas: { TermoId: any; KgTratadas: any; ConteoFinal?: any }[]; operador: string;
}) {
  if (!Array.isArray(p.salidas) || !p.salidas.length) throw new ErrorNegocio(400, "No escogió ningún termo");
  return todoONada(async deshacer => {
    const out = [];
    for (const [i, s] of p.salidas.entries()) {
      try {
        // En lote solo salen termos que no han salido: corregir una salida es de uno en uno, porque
        // deshacer el lote borraría la salida anterior en vez de devolverla.
        const [ya]: any[] = await tx.$queryRawUnsafe(
          `SELECT COUNT(*) AS n FROM MovimientoPiso WHERE ConsumoId = ? AND Tipo = 'TRASLADO'`, Number(s.TermoId));
        if (Number(ya?.n) > 0) throw new ErrorNegocio(400, "Ese termo ya salió: use \"Corregir salida\"");
        out.push(await registrarSalida(tx, Number(s.TermoId),
          { HoraSalida: p.horaSalida, BodegaDestino: p.destino, KgTratadas: s.KgTratadas, ConteoFinal: s.ConteoFinal }, p.operador));
        deshacer(() => deshacerSalida(tx, Number(s.TermoId)));
      } catch (err) { conIndice(i, err); }
    }
    return { ok: true, Salidas: out };
  });
}
