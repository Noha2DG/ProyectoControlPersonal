// Panorama de planta (Gerencia): el recorrido del producto Bodega → Descongelado → Pelado →
// Tratamiento, y a dónde sale de cada área. Todo sale del kardex del piso (MovimientoPiso); no se
// captura nada nuevo.
//
// Se devuelven los movimientos POR DÍA desde el inicio del rango más largo (el lunes de la semana o
// el día 1 del mes, el que sea antes) hasta la fecha pedida, y la pantalla suma Día, Semana y Mes sin
// volver a preguntar. El "día" es FechaProduccion (la jornada), como en el resto del piso.
//
// Origen de cada movimiento que entra a un área:
//   INGRESO con remisión              → BODEGA
//   TRASLADO / MERMA desde una hoja    → la bodega de la hoja (Descongelado, Tratamiento)
//   PROCESADO (cierre de transacción)  → la bodega de la que se tomó el lote (DESTAJO), casi siempre PELADO
// Lo bajado de las mesas y los ajustes no son flujo entre áreas y no entran.
//
// EMPANIZADO (27 nov 2026): lo que sale del área NO es el kardex (el PROCESADO a Túnel nace solo al
// cerrar el lote) sino lo que pesan las BÁSCULAS (Pesada, Modo EMPANIZADO), por día de producción.
// Todo lo pesado va a TÚNEL, como en las demás áreas: Red Lobster / venta local es el CLIENTE para el
// que se trabaja, no un destino (usuario, 27 nov 2026), y solo aparece en el resumen del área. Lo
// pesado lleva la harina, así que sale más de lo que entra: la diferencia es la ganancia, no un error.
import { calcularLbHora, agruparPorArea } from "../../../frontend/src/utils/destajo.js";
import { tiemposProduccion } from "./empanizado.ts";

const AREAS = ["DESCONGELADO", "PELADO", "TRATAMIENTO", "EMPANIZADO"];
const AREAS_PELADORAS = ["PELADO Y DEVENADO", "PELADO Y PINCHADO"];
// Los DATETIME llegan de Prisma como Date con la hora de Guatemala en los dígitos (la "Z" miente, ver
// frontend/src/utils/fecha.js); calcularLbHora espera el mismo texto ISO que recibe el navegador.
const iso = (d: any) => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));

async function ritmoPorDia(q: (sql: string, ...a: any[]) => Promise<any[]>, inicio: string, fecha: string) {
  const pPesadas = q(`
    SELECT pd.Codigo AS IdEmpleado, pd.FechaHora, pd.Peso AS Kilos, tp.ClasePT AS Producto, tp.Talla
      FROM PesajeDetalle pd JOIN TransaccionesProduccion tp ON tp.TransaccionId = pd.TransaccionId
     WHERE pd.FechaHora >= ? AND pd.FechaHora < DATE_ADD(?, INTERVAL 1 DAY)`, inicio, fecha);
  // Las transferencias que pueden estar vigentes en el rango: las que empezaron hasta 3 días antes.
  // Una abierta desde antes no da ancla del mismo día de todos modos (calcularLbHora la descarta).
  // Solo las de peladoras (área y ancla) y las de pausa: traer todas las áreas eran 17 mil filas y
  // 1.9 s. Una transferencia se cierra al pasar a otra área, así que no hace falta ver las demás para
  // saber cuál estaba vigente.
  const pTransf = q(`
    SELECT tr.Codigo, tr.FechaHora, tr.FechaSalida, a.Nombre AS Area, a.GeneraPaga
      FROM Transferencias tr JOIN Areas a ON a.Codigo = tr.CodigoArea
     WHERE tr.FechaHora >= DATE_SUB(?, INTERVAL 3 DAY) AND tr.FechaHora < DATE_ADD(?, INTERVAL 1 DAY)
       AND (a.Nombre IN (${AREAS_PELADORAS.map(() => "?").join(",")}) OR a.GeneraPaga = 0)
       -- Solo de quien pesó en el rango: las pausas de todo el personal eran la mitad de las filas.
       AND tr.Codigo IN (SELECT DISTINCT pd.Codigo FROM PesajeDetalle pd
                          WHERE pd.FechaHora >= ? AND pd.FechaHora < DATE_ADD(?, INTERVAL 1 DAY))
     ORDER BY tr.Codigo, tr.FechaHora`, inicio, fecha, ...AREAS_PELADORAS, inicio, fecha);
  const [pesadas, transf] = await Promise.all([pPesadas, pTransf]);
  if (!pesadas.length) return [];
  const porEmp = new Map<string, any[]>();
  for (const t of transf) { if (!porEmp.has(t.Codigo)) porEmp.set(t.Codigo, []); porEmp.get(t.Codigo)!.push(t); }
  const filas: any[] = [];
  for (const p of pesadas) {
    const ts = porEmp.get(p.IdEmpleado) ?? [];
    const t0 = new Date(p.FechaHora).getTime();
    let vig: any = null;
    for (const t of ts) {
      if (new Date(t.FechaHora).getTime() > t0) break;
      if (t.FechaSalida == null || new Date(t.FechaSalida).getTime() >= t0) vig = t;
    }
    if (!vig || !AREAS_PELADORAS.includes(vig.Area)) continue;
    filas.push({ IdEmpleado: p.IdEmpleado, FechaHora: iso(p.FechaHora), EntradaArea: iso(vig.FechaHora), Kilos: Number(p.Kilos),
                 Area: vig.Area, Producto: p.Producto, Talla: Number(p.Talla) });
  }
  const pausas = transf.filter(t => Number(t.GeneraPaga) === 0)
    .map(t => ({ IdEmpleado: t.Codigo, FechaHora: iso(t.FechaHora), FechaSalida: iso(t.FechaSalida) }));
  const por = new Map<string, { Fecha: string; Lb: number; Horas: number; LbSinTiempo: number; Personas: Set<string> }>();
  for (const f of calcularLbHora(filas, agruparPorArea, pausas) as any[]) {
    const d = por.get(f.Fecha) ?? { Fecha: f.Fecha, Lb: 0, Horas: 0, LbSinTiempo: 0, Personas: new Set<string>() };
    if (f.LbPorHora != null) { d.Lb += f.Lb; d.Horas += f.Horas; }
    d.LbSinTiempo += f.LbSinTiempo || 0;
    d.Personas.add(f.IdEmpleado);
    por.set(f.Fecha, d);
  }
  return [...por.values()].sort((a, b) => a.Fecha.localeCompare(b.Fecha))
    .map(d => ({ Fecha: d.Fecha, Lb: r2(d.Lb), Horas: r2(d.Horas), LbSinTiempo: r2(d.LbSinTiempo), Personas: d.Personas.size }));
}
const r2 = (n: any) => Math.round(Number(n || 0) * 100) / 100;

function rangos(fecha: string) {
  const [a, m, d] = fecha.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  const lunes = new Date(f); lunes.setUTCDate(f.getUTCDate() - ((f.getUTCDay() + 6) % 7));
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  const mes = `${fecha.slice(0, 7)}-01`;
  return {
    dia: { desde: fecha, hasta: fecha },
    semana: { desde: iso(lunes), hasta: fecha },
    mes: { desde: mes, hasta: fecha },
    inicio: iso(lunes) < mes ? iso(lunes) : mes,
  };
}

// Junta varias consultas por día en una lista { Fecha, campo: kg, ... } ordenada por fecha.
function unir(...partes: [any[], string, string][]) {
  const m = new Map<string, any>();
  for (const [filas, campo, col] of partes) {
    for (const f of filas) {
      const x = m.get(f.Fecha) ?? { Fecha: f.Fecha };
      x[campo] = r2(f[col]);
      m.set(f.Fecha, x);
    }
  }
  return [...m.values()].sort((a, b) => a.Fecha.localeCompare(b.Fecha));
}

// A lo sumo `n` consultas en vuelo: el pool de Prisma en kronos es de 3 conexiones y lo comparten
// pesaje, etiquetas y kioscos (mismo criterio que MAX_CONSULTAS_REPORTE en routes/reportes.ts). La
// base está en otro servidor: cada consulta, aun chica, cuesta ~0.3 s de ida y vuelta, así que en fila
// once consultas eran 6 s.
function limitador(n: number) {
  let enVuelo = 0; const cola: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (enVuelo >= n) await new Promise<void>(r => cola.push(r));
    enVuelo++;
    try { return await fn(); } finally { enVuelo--; cola.shift()?.(); }
  };
}

export async function panoramaPlanta(client: any, fecha: string) {
  const turno = limitador(2);
  const q = (sql: string, ...args: any[]) => turno(() => client.$queryRawUnsafe(sql, ...args) as Promise<any[]>);
  const R = rangos(fecha);

  // Movimientos entre áreas, por día. La MERMA de una hoja va como destino 'MERMA'.
  const diarioP = q(`
    SELECT Fecha, Origen, Destino, ROUND(SUM(Kg), 2) AS Kg FROM (
      SELECT DATE_FORMAT(m.FechaProduccion, '%Y-%m-%d') AS Fecha,
             CASE WHEN m.Tipo = 'INGRESO' AND m.RemisionId IS NOT NULL THEN 'BODEGA'
                  WHEN m.HojaOrigenId IS NOT NULL THEN h.BodegaCodigo
                  WHEN m.Tipo = 'PROCESADO' THEN (SELECT d.BodegaOrigen FROM MovimientoPiso d
                                                   WHERE d.Tipo = 'DESTAJO' AND d.LoteProceso = m.LoteProceso
                                                     AND d.ClaseProceso = m.ClaseProceso LIMIT 1)
             END AS Origen,
             IF(m.Tipo = 'MERMA', 'MERMA', m.BodegaDestino) AS Destino,
             m.PesoKg AS Kg
        FROM MovimientoPiso m
        LEFT JOIN HojaProceso h ON h.HojaId = m.HojaOrigenId
       WHERE m.FechaProduccion BETWEEN ? AND ?
         AND m.Tipo IN ('INGRESO', 'TRASLADO', 'PROCESADO', 'MERMA')
    ) t
    WHERE Destino IS NOT NULL
      AND (Origen IN ('DESCONGELADO', 'PELADO', 'TRATAMIENTO') OR (Origen = 'BODEGA' AND Destino = 'DESCONGELADO'))
    GROUP BY Fecha, Origen, Destino
    ORDER BY Fecha`, R.inicio, fecha);

  // Lotes que Pelado tomó del piso, con lo pelado y si ya están terminados (sin transacción abierta):
  // el rendimiento solo cuenta los terminados (a medio turno, lo tomado sigue en las mesas).
  const lotesP = q(`
    SELECT d.LoteProceso AS Lote, d.ClaseProceso AS Clase,
           DATE_FORMAT(MIN(d.FechaProduccion), '%Y-%m-%d') AS Fecha, SUM(d.PesoKg) AS Tomado,
           (SELECT COALESCE(SUM(b.PesoKg), 0) FROM MovimientoPiso b
             WHERE b.Tipo = 'BAJADO' AND b.LoteProceso = d.LoteProceso AND b.ClaseProceso = d.ClaseProceso) AS Bajado,
           (SELECT COALESCE(SUM(pd.Peso), 0) FROM PesajeDetalle pd
              JOIN TransaccionesProduccion tp ON tp.TransaccionId = pd.TransaccionId
             WHERE tp.Lote = d.LoteProceso AND tp.ClaseOrigen = d.ClaseProceso) AS Pelado,
           (SELECT COUNT(*) FROM TransaccionesProduccion tp
             WHERE tp.Lote = d.LoteProceso AND tp.ClaseOrigen = d.ClaseProceso) AS Transacciones,
           (SELECT COUNT(*) FROM TransaccionesProduccion tp
             WHERE tp.Lote = d.LoteProceso AND tp.ClaseOrigen = d.ClaseProceso AND tp.Estado = 'Abierta') AS Abiertas
      FROM MovimientoPiso d
     WHERE d.Tipo = 'DESTAJO' AND d.BodegaOrigen = 'PELADO' AND d.FechaProduccion BETWEEN ? AND ?
     GROUP BY d.LoteProceso, d.ClaseProceso`, R.inicio, fecha);

  // Lo que queda al piso de cada área al cerrar la fecha, renglón por renglón con la misma llave que
  // la pantalla del piso (remisión, lote, clase, talla, fecha del lote) y solo los renglones
  // positivos: sumado de golpe da negativo por los AJUSTE del arranque de Tomar del piso (6 nov).
  const pisoP = q(`
    SELECT t.Bodega, t.Lote, t.Clase, ta.Descripcion AS Talla, ROUND(SUM(t.Delta), 2) AS Kg,
           DATEDIFF(?, MIN(CASE WHEN t.Delta > 0 THEN t.FechaProduccion END)) AS Dias
      FROM (
        SELECT BodegaDestino AS Bodega, RemisionId, Lote, Clase, Talla, FechaLote, FechaProduccion, PesoKg AS Delta
          FROM MovimientoPiso WHERE BodegaDestino IN (${AREAS.map(() => "?").join(",")}) AND FechaProduccion <= ?
        UNION ALL
        SELECT BodegaOrigen, RemisionId, Lote, Clase, Talla, FechaLote, FechaProduccion, -PesoKg
          FROM MovimientoPiso WHERE BodegaOrigen IN (${AREAS.map(() => "?").join(",")}) AND FechaProduccion <= ?
      ) t
      JOIN Tallas ta ON ta.Codigo = t.Talla
     GROUP BY t.Bodega, t.RemisionId, t.Lote, t.Clase, t.Talla, ta.Descripcion, t.FechaLote
    HAVING Kg > 0.009
     ORDER BY Dias DESC, Kg DESC`, fecha, ...AREAS, fecha, ...AREAS, fecha);

  // ── Los números propios de cada área, por día (las mismas cuentas que sus pantallas) ──────────
  // Descongelado (routes/descongelado.ts, reporteJornada): RECIBIDO = lo que entró al piso y no vino
  // de una hoja del área; lo DESCONGELADO es el traslado de sus hojas, pesado contra lo declarado del
  // consumo al que está atado (los renglones sin par no tienen declarado); RENDIMIENTO = pesado ÷
  // declarado, solo con par. El día es el de la hoja.
  // Las seis sumas por día salen en UNA consulta (UNION ALL, una marca G por bloque): con la base en
  // otro servidor cada viaje cuesta ~0.3 s aunque la consulta sea chica, así que separadas eran la
  // mitad del tiempo de la pantalla. Columnas genéricas V1..V5; cada bloque dice qué es cada una.
  const AR = AREAS.map(() => "?").join(",");
  const sumasP = q(`
    SELECT 'DES_REC' AS G, DATE_FORMAT(m.FechaProduccion, '%Y-%m-%d') AS Fecha, ROUND(SUM(m.PesoKg), 2) AS V1,
           NULL AS V2, NULL AS V3, NULL AS V4, NULL AS V5
      FROM MovimientoPiso m LEFT JOIN HojaProceso ho ON ho.HojaId = m.HojaOrigenId
     WHERE m.BodegaDestino = 'DESCONGELADO' AND m.FechaProduccion BETWEEN ? AND ?
       AND (m.HojaOrigenId IS NULL OR ho.BodegaCodigo <> 'DESCONGELADO')
     GROUP BY m.FechaProduccion
    UNION ALL
    SELECT 'DES_HOJ', DATE_FORMAT(h.FechaProduccion, '%Y-%m-%d'),
           ROUND(SUM(CASE WHEN t.Tipo = 'TRASLADO' THEN t.PesoKg END), 2),
           ROUND(SUM(CASE WHEN t.Tipo = 'TRASLADO' AND c.MovimientoId IS NOT NULL THEN c.PesoKg END), 2),
           ROUND(SUM(CASE WHEN t.Tipo = 'TRASLADO' AND c.MovimientoId IS NOT NULL THEN t.PesoKg END), 2),
           ROUND(SUM(CASE WHEN t.Tipo = 'DEVOLUCION' THEN t.PesoKg END), 2),
           ROUND(SUM(CASE WHEN t.Tipo = 'MERMA' THEN t.PesoKg END), 2)
      FROM MovimientoPiso t
      JOIN HojaProceso h ON h.HojaId = t.HojaOrigenId AND h.BodegaCodigo = 'DESCONGELADO'
      LEFT JOIN MovimientoPiso c ON c.MovimientoId = t.ConsumoId
     WHERE t.Tipo IN ('TRASLADO', 'DEVOLUCION', 'MERMA') AND h.FechaProduccion BETWEEN ? AND ?
     GROUP BY h.FechaProduccion
    UNION ALL
    SELECT 'PEL_PES', DATE_FORMAT(pd.FechaHora, '%Y-%m-%d'), ROUND(SUM(pd.Peso), 2), NULL, NULL, NULL, NULL
      FROM PesajeDetalle pd
      JOIN TransaccionesProduccion tp ON tp.TransaccionId = pd.TransaccionId
     WHERE pd.FechaHora >= ? AND pd.FechaHora < DATE_ADD(?, INTERVAL 1 DAY)
       AND EXISTS (SELECT 1 FROM MovimientoPiso d WHERE d.Tipo = 'DESTAJO' AND d.BodegaOrigen = 'PELADO'
                     AND d.LoteProceso = tp.Lote AND d.ClaseProceso = tp.ClaseOrigen)
     GROUP BY DATE_FORMAT(pd.FechaHora, '%Y-%m-%d')
    UNION ALL
    SELECT 'PEL_PIS', DATE_FORMAT(FechaProduccion, '%Y-%m-%d'),
           ROUND(SUM(CASE WHEN Tipo = 'DESTAJO' AND BodegaOrigen = 'PELADO' THEN PesoKg END), 2),
           ROUND(SUM(CASE WHEN Tipo = 'BAJADO' AND BodegaDestino = 'PELADO' THEN PesoKg END), 2), NULL, NULL, NULL
      FROM MovimientoPiso
     WHERE FechaProduccion BETWEEN ? AND ? AND (BodegaOrigen = 'PELADO' OR BodegaDestino = 'PELADO')
     GROUP BY FechaProduccion
    UNION ALL
    SELECT 'TRA_HOJ', DATE_FORMAT(h.FechaProduccion, '%Y-%m-%d'),
           ROUND(SUM(c.PesoKg), 2), ROUND(SUM(CASE WHEN tr.MovimientoId IS NOT NULL THEN c.PesoKg END), 2),
           ROUND(SUM(tr.PesoKg), 2), NULL, NULL
      FROM MovimientoPiso c
      JOIN HojaProceso h ON h.HojaId = c.HojaDestinoId AND h.BodegaCodigo = 'TRATAMIENTO'
      JOIN TratamientoTermo tt ON tt.ConsumoId = c.MovimientoId
      LEFT JOIN MovimientoPiso tr ON tr.ConsumoId = c.MovimientoId AND tr.Tipo = 'TRASLADO'
     WHERE c.Tipo = 'CONSUMO' AND h.FechaProduccion BETWEEN ? AND ?
     GROUP BY h.FechaProduccion
    UNION ALL
    -- Empanizado, lo pesado en las básculas (las mismas bandejas que Producción por persona; sin
    -- destino cuenta como exportación, igual que esa pantalla). Gramos.
    SELECT 'EMP_PES', DATE_FORMAT(FechaProduccion, '%Y-%m-%d'),
           SUM(CASE WHEN Destino = 'LOCAL' THEN 0 ELSE PesoNetoG END), SUM(CASE WHEN Destino = 'LOCAL' THEN PesoNetoG ELSE 0 END),
           SUM(Destino IS NULL OR Destino <> 'LOCAL'), SUM(Destino = 'LOCAL'), NULL
      FROM Pesada
     WHERE Modo = 'EMPANIZADO' AND Anulada = 0 AND FechaProduccion BETWEEN ? AND ?
     GROUP BY FechaProduccion
    UNION ALL
    -- Empanizado, lo tomado del piso por los lotes (y lo que volvió al piso o se descartó).
    SELECT 'EMP_PIS', DATE_FORMAT(FechaProduccion, '%Y-%m-%d'),
           ROUND(SUM(CASE WHEN Tipo = 'TOMA_EMPANIZADO' THEN PesoKg END), 2),
           ROUND(SUM(CASE WHEN Tipo = 'BAJADO' THEN PesoKg END), 2),
           ROUND(SUM(CASE WHEN Tipo = 'DESCARTE' THEN PesoKg END), 2), NULL, NULL
      FROM MovimientoPiso
     WHERE LoteEmpanizadoId IS NOT NULL AND Tipo IN ('TOMA_EMPANIZADO', 'BAJADO', 'DESCARTE')
       AND FechaProduccion BETWEEN ? AND ?
     GROUP BY FechaProduccion
    UNION ALL
    -- Empanizado, ganancia de los lotes CERRADOS ese día (como el rendimiento de Pelado, solo lo
    -- terminado: a medio lote lo tomado sigue en las mesas). Pesado ÷ (tomado − bajado − descarte).
    SELECT 'EMP_LOT', DATE_FORMAT(le.CerradoEn, '%Y-%m-%d'),
           ROUND(SUM((SELECT COALESCE(SUM(CASE m.Tipo WHEN 'TOMA_EMPANIZADO' THEN m.PesoKg ELSE -m.PesoKg END), 0)
                        FROM MovimientoPiso m WHERE m.LoteEmpanizadoId = le.LoteEmpanizadoId
                         AND m.Tipo IN ('TOMA_EMPANIZADO', 'BAJADO', 'DESCARTE'))), 2),
           SUM((SELECT COALESCE(SUM(p.PesoNetoG), 0) FROM Pesada p WHERE p.LoteEmpanizadoId = le.LoteEmpanizadoId AND p.Anulada = 0)),
           COUNT(*), NULL, NULL
      FROM LoteEmpanizado le
     WHERE le.Estado = 'Cerrado' AND le.CerradoEn >= ? AND le.CerradoEn < DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY DATE_FORMAT(le.CerradoEn, '%Y-%m-%d')
    UNION ALL
    SELECT CONCAT('HOJAS_', BodegaCodigo), NULL, COUNT(*), NULL, NULL, NULL, NULL
      FROM HojaProceso WHERE Estatus = 'Abierta' AND BodegaCodigo IN (${AR})
     GROUP BY BodegaCodigo
    UNION ALL
    -- Empanizado no lleva hojas: sus lotes abiertos hacen ese papel.
    SELECT 'LOTES_EMPANIZADO', NULL, COUNT(*), NULL, NULL, NULL, NULL FROM LoteEmpanizado WHERE Estado = 'Abierto'`,
    R.inicio, fecha, R.inicio, fecha, R.inicio, fecha, R.inicio, fecha, R.inicio, fecha,
    R.inicio, fecha, R.inicio, fecha, R.inicio, fecha, ...AREAS);

  const [diario, lotes, piso, sumas] = await Promise.all([diarioP, lotesP, pisoP, sumasP]);
  const bloque = (g: string, ...campos: string[]) => sumas.filter(x => x.G === g).map(x => {
    const o: any = { Fecha: x.Fecha };
    campos.forEach((c, k) => { o[c] = x[`V${k + 1}`]; });
    return o;
  });
  const desRecibido = bloque("DES_REC", "Kg");
  const desHojas = bloque("DES_HOJ", "Pesado", "Declarado", "PesadoConPar", "Devuelto", "Merma");
  const pelPesado = bloque("PEL_PES", "Kg");
  const pelPiso = bloque("PEL_PIS", "Tomado", "Bajado");
  const traHojas = bloque("TRA_HOJ", "Recibido", "Base", "Tratado");
  const kgG = (x: any) => Math.round(Number(x || 0)) / 1000;
  const empPesado = bloque("EMP_PES", "ExpG", "LocG", "ExpBandejas", "LocBandejas")
    .map(x => ({ Fecha: x.Fecha, Exportacion: kgG(x.ExpG), Local: kgG(x.LocG), Pesado: kgG(Number(x.ExpG || 0) + Number(x.LocG || 0)),
                 Bandejas: Number(x.ExpBandejas || 0) + Number(x.LocBandejas || 0) }));
  const empPiso = bloque("EMP_PIS", "Tomado", "Bajado", "Descarte");
  const empLotes = bloque("EMP_LOT", "TrabajadoCerrados", "PesadoG", "LotesCerrados")
    .map(x => ({ ...x, PesadoCerrados: kgG(x.PesadoG) }));
  const lotesEmpAbiertos = Number(sumas.find(x => x.G === "LOTES_EMPANIZADO")?.V1 ?? 0);
  // Lo pesado es la salida de Empanizado en el gráfico de flujo, y va a Túnel (ver encabezado).
  const empFlujo = empPesado.map(x => ({ Fecha: x.Fecha, Origen: "EMPANIZADO", Destino: "TUNEL", Kg: x.Pesado }))
    .filter(x => x.Kg > 0);
  const hojas = sumas.filter(x => String(x.G).startsWith("HOJAS_")).map(x => ({ Bodega: String(x.G).slice(6), Abiertas: x.V1 }));

  const alPiso: Record<string, { Kg: number; Lineas: any[] }> = {};
  for (const a of AREAS) alPiso[a] = { Kg: 0, Lineas: [] };
  for (const p of piso) {
    const b = alPiso[p.Bodega]; if (!b) continue;
    b.Kg = r2(b.Kg + Number(p.Kg));
    // Se juntan las líneas del mismo lote/clase/talla (la remisión no se muestra); antigüedad = la mayor.
    const k = `${p.Lote}|${p.Clase}|${p.Talla}`;
    const ya = b.Lineas.find(x => x.k === k);
    if (ya) { ya.Kg = r2(ya.Kg + Number(p.Kg)); ya.Dias = Math.max(ya.Dias, Number(p.Dias)); }
    else b.Lineas.push({ k, Lote: p.Lote, Clase: p.Clase, Talla: p.Talla, Kg: Number(p.Kg), Dias: Number(p.Dias) });
  }
  for (const b of Object.values(alPiso)) b.Lineas = b.Lineas.sort((x, y) => y.Dias - x.Dias || y.Kg - x.Kg).map(({ k, ...x }) => x);

  return {
    Fecha: fecha,
    Rangos: { dia: R.dia, semana: R.semana, mes: R.mes },
    Diario: [...diario.map(x => ({ Fecha: x.Fecha, Origen: x.Origen, Destino: x.Destino, Kg: Number(x.Kg) })), ...empFlujo],
    Lotes: lotes.map(l => ({
      Lote: l.Lote, Clase: l.Clase, Fecha: l.Fecha, Tomado: r2(l.Tomado), Bajado: r2(l.Bajado), Pelado: r2(l.Pelado),
      Terminado: Number(l.Transacciones) > 0 && Number(l.Abiertas) === 0,
    })),
    AlPiso: alPiso,
    // Por día y por área, con números (null = 0). La pantalla suma el periodo.
    PorDia: {
      DESCONGELADO: unir([desRecibido, "Recibido", "Kg"], [desHojas, "Pesado", "Pesado"], [desHojas, "Declarado", "Declarado"],
                         [desHojas, "PesadoConPar", "PesadoConPar"], [desHojas, "Devuelto", "Devuelto"], [desHojas, "Merma", "Merma"]),
      PELADO: unir([pelPiso, "Tomado", "Tomado"], [pelPiso, "Bajado", "Bajado"], [pelPesado, "Pelado", "Kg"]),
      TRATAMIENTO: unir([traHojas, "Recibido", "Recibido"], [traHojas, "Base", "Base"], [traHojas, "Tratado", "Tratado"]),
      EMPANIZADO: unir([empPiso, "Tomado", "Tomado"], [empPiso, "Bajado", "Bajado"], [empPiso, "Descarte", "Descarte"],
                       [empPesado, "Pesado", "Pesado"], [empPesado, "Exportacion", "Exportacion"], [empPesado, "Local", "Local"],
                       [empPesado, "Bandejas", "Bandejas"], [empLotes, "TrabajadoCerrados", "TrabajadoCerrados"],
                       [empLotes, "PesadoCerrados", "PesadoCerrados"], [empLotes, "LotesCerrados", "LotesCerrados"]),
    },
    HojasAbiertas: Object.fromEntries(hojas.map(h => [h.Bodega, Number(h.Abiertas)])),
    LotesEmpanizadoAbiertos: lotesEmpAbiertos,
  };
}

/**
 * Ritmo de las peladoras por día (lb/hr), aparte del panorama: es lo más pesado (todas las pesadas
 * del rango) y la pantalla lo pide después, ya mostrando el flujo y las tarjetas.
 * Por día: libras y horas válidas; lb/hr = Lb ÷ Horas (también al sumar un periodo).
 */
export async function ritmoPlanta(client: any, fecha: string) {
  const turno = limitador(2);
  const q = (sql: string, ...args: any[]) => turno(() => client.$queryRawUnsafe(sql, ...args) as Promise<any[]>);
  const inicio = rangos(fecha).inicio;
  // tiemposProduccion consulta por su cuenta: se le pasa un cliente que respeta el mismo limitador.
  const [Ritmo, RitmoEmpanizado] = await Promise.all([
    ritmoPorDia(q, inicio, fecha),
    ritmoEmpanizadoPorDia({ $queryRawUnsafe: q }, inicio, fecha),
  ]);
  return { Fecha: fecha, Ritmo, RitmoEmpanizado };
}

/**
 * Lb/hora de Empanizado por día y destino, con la MISMA cuenta que Empanizado → Producción por persona
 * (pages/EmpanizadoPage.jsx): cada destino aparte, ancla = la Transferencia que cubre la bandeja,
 * pausas en áreas sin paga, calcularLbHora. Se agrupa por día para que la semana y el mes se sumen
 * (Lb ÷ Horas) como el ritmo de las peladoras.
 */
async function ritmoEmpanizadoPorDia(client: any, inicio: string, fecha: string) {
  const t = await tiemposProduccion(client, inicio, fecha);
  if (!t.bandejas.length) return [];
  const entradasDe = new Map<string, [string, string | null][]>();
  for (const [c, i, s] of t.entradas) { if (!entradasDe.has(c)) entradasDe.set(c, []); entradasDe.get(c)!.push([i, s]); }
  const entrada = (c: string, h: string) => {
    let mejor: string | null = null;
    for (const [i, s] of entradasDe.get(c) ?? []) if (i <= h && (s == null || s >= h) && (mejor == null || i > mejor)) mejor = i;
    return mejor;
  };
  const pausas = t.pausas.map(([c, i, s]: any[]) => ({ IdEmpleado: c, FechaHora: i, FechaSalida: s }));
  const salida: { Fecha: string; Destino: string; Lb: number; Horas: number; Personas: number }[] = [];
  for (const destino of ["EXPORTACION", "LOCAL"]) {
    const pesadas = t.bandejas.filter((b: any[]) => (b[3] === "LOCAL" ? "LOCAL" : "EXPORTACION") === destino)
      .map(([c, h, g]: any[]) => ({ IdEmpleado: c, Nombre: c, FechaHora: h, Kilos: g / 1000, EntradaArea: entrada(c, h) }));
    // Un grupo por día: el primer bloque de cada día se ancla a la entrada, como en la pantalla de un día.
    const porDia = (p: any) => { const d = String(p.FechaHora).slice(0, 10); return { key: d, campos: { Fecha: d } }; };
    const por = new Map<string, { Lb: number; Horas: number; Personas: Set<string> }>();
    for (const f of calcularLbHora(pesadas, porDia, pausas) as any[]) {
      const d = por.get(f.Fecha) ?? { Lb: 0, Horas: 0, Personas: new Set<string>() };
      if (f.LbPorHora != null) { d.Lb += f.Lb; d.Horas += f.Horas; }
      d.Personas.add(f.IdEmpleado);
      por.set(f.Fecha, d);
    }
    for (const [Fecha, d] of por) salida.push({ Fecha, Destino: destino, Lb: r2(d.Lb), Horas: r2(d.Horas), Personas: d.Personas.size });
  }
  return salida.sort((a, b) => a.Fecha.localeCompare(b.Fecha) || a.Destino.localeCompare(b.Destino));
}
