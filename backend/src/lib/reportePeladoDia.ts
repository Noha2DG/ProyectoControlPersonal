// Reporte del día de Pelado (Destajo → Reporte → Reporte del Día).
//
// Es la hoja de papel "Pelado y desvenado" del turno, sacada del sistema:
//   1. Recibido      lo que entró al piso de PELADO ese día (traslados de Descongelado, cola de
//                    Descabezado, remisiones). Lo BAJADO de las mesas no es recibido: ya era de Pelado.
//   2. Procesado     lo pesado ese día en los lotes que salieron del piso de Pelado, por lote, clase PT,
//                    talla y a dónde se mandó (el PROCESADO que se registra al cerrar la transacción).
//   3. Queda al piso el saldo del piso de PELADO al terminar el día.
//
// CUADRE: MP trabajada = tomado del piso − bajado de las mesas. Rendimiento = pelado ÷ MP trabajada,
// pero solo de los lotes TERMINADOS (ver lotesDia abajo).
// Cáscara = MP trabajada − pelado (incluye el descarte) es SOLO informativa: no entra en el
// rendimiento (decisión del usuario, 16 nov 2026). El piso se comprueba
// aparte: al iniciar + recibido ± ajustes − otras salidas − MP trabajada tiene que dar lo que queda.
//
// El "día" es FechaProduccion del movimiento (la jornada), no la hora del reloj, igual que el resto
// del piso. Lo pesado sí va por la hora de la pesada (no hay otra), en rango de índice: nunca
// DATE() sobre la columna.
//
// PERSONAL por el área donde marcaron ese día (Transferencias que EMPIEZAN ese día; el corte de
// medianoche abre una por día). DB, DJ y DC son compartidas con Descabezado: se cuentan aquí porque
// el registro las tiene con PELADO (scripts/separarPeladoDescabezado.ts).
//
// Lb/hr no sale de aquí: lo calcula la pantalla con utils/destajo.js sobre el /produccion del mismo
// día, para que sea el mismo número que Lb/Hora y Por Talla.

const BODEGA = "PELADO";
const PUESTOS: Record<string, string> = {
  DS: "Peladoras", DT: "Peladoras", DY: "Soportes", DJ: "Chequeadores", DB: "Encargado", DC: "QC",
};
const r2 = (n: any) => Math.round(Number(n || 0) * 100) / 100;

// Quién mandó el producto: la bodega de la hoja que lo trasladó, la bodega de origen del movimiento,
// o lo que el tipo de movimiento dice.
const ENVIA = `COALESCE(bh.Nombre, bo.Nombre,
  CASE WHEN m.Tipo = 'COLA' THEN 'Descabezado' WHEN m.RemisionId IS NOT NULL THEN 'Bodega (remisión)' ELSE m.Tipo END)`;
const JOIN_ENVIA = `
  LEFT JOIN HojaProceso h ON h.HojaId = m.HojaOrigenId
  LEFT JOIN BodegaVirtual bh ON bh.Codigo = h.BodegaCodigo
  LEFT JOIN BodegaVirtual bo ON bo.Codigo = m.BodegaOrigen`;

export async function reportePeladoDia(client: any, fecha: string) {
  const q = (sql: string, ...args: any[]) => client.$queryRawUnsafe(sql, ...args) as Promise<any[]>;

  // Un renglón por lote (+ clase y talla), como en la hoja de papel: Descongelado manda termo por
  // termo y uno por movimiento eran 18 renglones del mismo lote. Sin hora (decisión del usuario);
  // quién lo mandó y con qué remisión van juntos en el texto, para no partir el lote.
  const recibido = await q(`
    SELECT MIN(m.MovimientoId) AS MovimientoId,
           GROUP_CONCAT(DISTINCT CONCAT(${ENVIA}, IFNULL(CONCAT(' · ', rm.Folio), '')) ORDER BY rm.Folio SEPARATOR ', ') AS Envia,
           COUNT(*) AS Termos,
           m.Lote, m.Clase, cl.Descripcion AS DescripcionClase, m.Talla, ta.Descripcion AS DescripcionTalla,
           ROUND(SUM(m.PesoKg), 2) AS Kg
      FROM MovimientoPiso m ${JOIN_ENVIA}
      JOIN Clase cl ON cl.Clase = m.Clase
      JOIN Tallas ta ON ta.Codigo = m.Talla
      LEFT JOIN Remisiones rm ON rm.RemisionId = m.RemisionId
     WHERE m.BodegaDestino = ? AND m.FechaProduccion = ? AND m.Tipo NOT IN ('BAJADO', 'AJUSTE')
     GROUP BY m.Lote, m.Clase, cl.Descripcion, m.Talla, ta.Descripcion
     ORDER BY m.Lote, m.Clase, m.Talla`, BODEGA, fecha);

  // Movimientos del día que no son recibido.
  const [f]: any[] = await q(`
    SELECT
      COALESCE(SUM(CASE WHEN BodegaOrigen = ? AND Tipo = 'DESTAJO' THEN PesoKg END), 0) AS Tomado,
      COALESCE(SUM(CASE WHEN BodegaDestino = ? AND Tipo = 'BAJADO' THEN PesoKg END), 0) AS Bajado,
      COALESCE(SUM(CASE WHEN Tipo = 'AJUSTE' THEN IF(BodegaDestino = ?, PesoKg, -PesoKg) END), 0) AS Ajustes,
      COALESCE(SUM(CASE WHEN BodegaOrigen = ? AND Tipo NOT IN ('DESTAJO', 'AJUSTE') THEN PesoKg END), 0) AS OtrasSalidas
      FROM MovimientoPiso
     WHERE (BodegaDestino = ? OR BodegaOrigen = ?) AND FechaProduccion = ?`,
    BODEGA, BODEGA, BODEGA, BODEGA, BODEGA, BODEGA, fecha);

  // Saldo del piso antes y después del día, con la MISMA llave con que la pantalla del piso cuenta
  // su saldo (remisión, lote, clase, talla, fecha del lote; lib/destajoPiso.ts saldoLineas) y, como
  // ella, solo los renglones positivos. Sumado de un solo golpe sale negativo: el arranque de Tomar
  // del piso (6 nov 2026) sacó con AJUSTE renglones que habían entrado con otra llave, y esos quedan
  // en negativo para siempre sin que el encargado los vea.
  const lineas = await q(`
    SELECT t.RemisionId, t.Lote, t.Clase, cl.Descripcion AS DescripcionClase, t.Talla, ta.Descripcion AS DescripcionTalla,
           ROUND(SUM(CASE WHEN t.FechaProduccion < ? THEN t.Delta ELSE 0 END), 2) AS Antes,
           ROUND(SUM(t.Delta), 2) AS Despues,
           DATE_FORMAT(MIN(CASE WHEN t.Delta > 0 THEN t.FechaProduccion END), '%Y-%m-%d') AS FechaIngreso,
           GROUP_CONCAT(DISTINCT t.Envia ORDER BY t.Envia SEPARATOR ', ') AS VinoDe
      FROM (
        SELECT m.RemisionId, m.Lote, m.Clase, m.Talla, m.FechaLote, m.FechaProduccion, m.PesoKg AS Delta,
               IF(m.Tipo = 'BAJADO', 'Bajado de mesa', IF(m.Tipo = 'AJUSTE', NULL, ${ENVIA})) AS Envia
          FROM MovimientoPiso m ${JOIN_ENVIA}
         WHERE m.BodegaDestino = ? AND m.FechaProduccion <= ?
        UNION ALL
        SELECT m.RemisionId, m.Lote, m.Clase, m.Talla, m.FechaLote, m.FechaProduccion, -m.PesoKg, NULL
          FROM MovimientoPiso m
         WHERE m.BodegaOrigen = ? AND m.FechaProduccion <= ?
      ) t
      JOIN Clase cl ON cl.Clase = t.Clase
      JOIN Tallas ta ON ta.Codigo = t.Talla
     GROUP BY t.RemisionId, t.Lote, t.Clase, cl.Descripcion, t.Talla, ta.Descripcion, t.FechaLote
    HAVING Antes > 0.001 OR Despues > 0.001`, fecha, BODEGA, fecha, BODEGA, fecha);

  // Lo que queda, juntando las líneas del mismo lote/clase/talla (la remisión no se imprime).
  const quedan = new Map<string, any>();
  for (const l of lineas.filter(x => Number(x.Despues) > 0.001)) {
    const k = `${l.Lote}|${l.Clase}|${l.Talla}`;
    const a = quedan.get(k);
    if (!a) { quedan.set(k, { ...l, Kg: Number(l.Despues) }); continue; }
    a.Kg += Number(l.Despues);
    if (l.FechaIngreso && (!a.FechaIngreso || l.FechaIngreso < a.FechaIngreso)) a.FechaIngreso = l.FechaIngreso;
    a.VinoDe = [...new Set(`${a.VinoDe ?? ""}, ${l.VinoDe ?? ""}`.split(", ").filter(Boolean))].sort().join(", ");
  }
  const alPiso = [...quedan.values()]
    .map(({ Antes, Despues, RemisionId, ...x }) => ({ ...x, Kg: r2(x.Kg) }))
    .sort((a, b) => String(a.FechaIngreso).localeCompare(String(b.FechaIngreso)) || String(a.Lote).localeCompare(String(b.Lote)) || a.Talla - b.Talla);
  const inicioKg = lineas.reduce((s, l) => s + Math.max(0, Number(l.Antes)), 0);

  // Lo pesado ese día en los lotes que salieron del piso de Pelado. Destino: a dónde mandó lo pelado
  // la transacción al cerrarse (o el termo que Tratamiento se llevó con la transacción abierta).
  const procesado = await q(`
    SELECT tp.Lote, tp.ClaseOrigen, tp.ClasePT AS Clase, cl.Descripcion AS DescripcionClase,
           tp.Talla, ta.Descripcion AS DescripcionTalla,
           COALESCE((SELECT GROUP_CONCAT(DISTINCT bv.Nombre ORDER BY bv.Nombre SEPARATOR ', ')
                       FROM MovimientoPiso mp JOIN BodegaVirtual bv ON bv.Codigo = mp.BodegaDestino
                      WHERE mp.Tipo = 'PROCESADO' AND mp.TransaccionId = tp.TransaccionId), 'En proceso') AS Destino,
           ROUND(SUM(pd.Peso), 2) AS Kg
      FROM PesajeDetalle pd
      JOIN TransaccionesProduccion tp ON tp.TransaccionId = pd.TransaccionId
      JOIN Clase cl ON cl.Clase = tp.ClasePT
      JOIN Tallas ta ON ta.Codigo = tp.Talla
     WHERE pd.FechaHora >= ? AND pd.FechaHora < DATE_ADD(?, INTERVAL 1 DAY)
       AND EXISTS (SELECT 1 FROM MovimientoPiso d
                    WHERE d.Tipo = 'DESTAJO' AND d.BodegaOrigen = ?
                      AND d.LoteProceso = tp.Lote AND d.ClaseProceso = tp.ClaseOrigen)
     GROUP BY tp.Lote, tp.ClaseOrigen, tp.ClasePT, cl.Descripcion, tp.Talla, ta.Descripcion, Destino
     ORDER BY tp.Lote, tp.Talla, tp.ClasePT`, fecha, fecha, BODEGA);

  // RENDIMIENTO por lote, solo de los TERMINADOS (todas sus transacciones cerradas). A medio turno lo
  // tomado del piso sigue en las mesas sin pelar: 1,212 kg pelados ÷ 2,398 tomados daba 50 % el
  // 16 nov a mediodía, y la mitad era producto en la mesa, no cáscara. Lotes = los que salieron del
  // piso de Pelado ese día; su pelado es todo lo pesado en ellos, sea del día que sea.
  const lotesDia = await q(`
    SELECT d.LoteProceso AS Lote, d.ClaseProceso AS Clase, SUM(d.PesoKg) AS Tomado,
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
     WHERE d.Tipo = 'DESTAJO' AND d.BodegaOrigen = ? AND d.FechaProduccion = ?
     GROUP BY d.LoteProceso, d.ClaseProceso`, BODEGA, fecha);
  const suma = (xs: any[], c: string) => r2(xs.reduce((s, x) => s + Number(x[c]), 0));
  const terminados = lotesDia.filter(l => Number(l.Transacciones) > 0 && Number(l.Abiertas) === 0);
  const enMesas = lotesDia.filter(l => !terminados.includes(l));
  const mpTerminada = r2(suma(terminados, "Tomado") - suma(terminados, "Bajado"));
  const peladoTerminado = suma(terminados, "Pelado");

  // Personal por área de marcaje. Las horas del turno son las de las peladoras.
  const personal = await q(`
    SELECT tr.CodigoArea, COUNT(DISTINCT tr.Codigo) AS Personas, COUNT(*) AS Marcajes,
           DATE_FORMAT(MIN(tr.FechaHora), '%H:%i') AS Inicio,
           -- Solo las salidas del mismo día: una salida olvidada que se cierra al día siguiente
           -- (o nunca) no es la hora en que terminó el turno.
           DATE_FORMAT(MAX(CASE WHEN tr.FechaSalida < DATE_ADD(?, INTERVAL 1 DAY) THEN tr.FechaSalida END), '%H:%i') AS Fin,
           SUM(tr.FechaSalida IS NULL OR tr.FechaSalida >= DATE_ADD(?, INTERVAL 1 DAY)) AS SinSalida,
           GROUP_CONCAT(DISTINCT CONCAT_WS(' ', e.PrimerNombre, e.PrimerApellido) ORDER BY e.PrimerNombre SEPARATOR ', ') AS Nombres
      FROM Transferencias tr
      JOIN Empleados e ON e.Codigo = tr.Codigo
     WHERE tr.CodigoArea IN (${Object.keys(PUESTOS).map(() => "?").join(",")})
       AND tr.FechaHora >= ? AND tr.FechaHora < DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY tr.CodigoArea`, fecha, fecha, ...Object.keys(PUESTOS), fecha, fecha);

  const porPuesto: Record<string, number> = { Peladoras: 0, Soportes: 0, Chequeadores: 0, Encargado: 0, QC: 0 };
  for (const p of personal) porPuesto[PUESTOS[p.CodigoArea]] += Number(p.Personas);
  const de = (cod: string) => personal.find(p => p.CodigoArea === cod);
  const pelado = de("DS") ?? de("DT");
  const encargado = de("DB");

  const recibidoKg = r2(recibido.reduce((s, x) => s + Number(x.Kg), 0));
  const quedaKg = r2(alPiso.reduce((s, x) => s + Number(x.Kg), 0));
  const peladoKg = r2(procesado.reduce((s, x) => s + Number(x.Kg), 0));
  const inicio = r2(inicioKg), ajustes = r2(f.Ajustes), otras = r2(f.OtrasSalidas);
  const tomado = r2(f.Tomado), bajado = r2(f.Bajado);
  // Lo trabajado se cuenta en las mesas (tomado − bajado), que no depende de renglones viejos del piso.
  const mpTrabajada = r2(tomado - bajado);
  // Y el piso tiene que cerrar con eso: si no, algo se movió sin registrarse (o el saldo arrastra un
  // renglón negativo de antes) y el reporte lo dice en vez de esconderlo.
  const diferenciaPiso = r2(inicio + recibidoKg + ajustes - otras - mpTrabajada - quedaKg);

  return {
    Fecha: fecha,
    Encargado: encargado?.Nombres ?? null,
    HoraInicio: pelado?.Inicio ?? null,
    // Con más de una de cada diez peladoras sin salida, el turno sigue en curso. Unas pocas son
    // salidas olvidadas y no detienen la hora de fin.
    HoraFin: pelado && Number(pelado.SinSalida) <= Number(pelado.Marcajes) * 0.1 ? pelado.Fin : null,
    SinSalida: pelado ? Number(pelado.SinSalida) : 0,
    Personal: { ...porPuesto, Total: Object.values(porPuesto).reduce((a, b) => a + b, 0) },
    Recibido: recibido.map(x => ({ ...x, MovimientoId: Number(x.MovimientoId), Termos: Number(x.Termos), Talla: Number(x.Talla), Kg: Number(x.Kg) })),
    Procesado: procesado.map(x => ({ ...x, Talla: Number(x.Talla), Kg: Number(x.Kg) })),
    AlPiso: alPiso.map(x => ({ ...x, Talla: Number(x.Talla) })),
    Cuadre: {
      InicioKg: inicio, RecibidoKg: recibidoKg, AjustesKg: ajustes, OtrasSalidasKg: otras, AlPisoKg: quedaKg,
      MpTrabajadaKg: mpTrabajada, PeladoKg: peladoKg, CascaraKg: r2(mpTrabajada - peladoKg),
      Rendimiento: mpTerminada > 0 ? (peladoTerminado / mpTerminada) * 100 : null,
      LotesTerminados: terminados.length, MpTerminadaKg: mpTerminada, PeladoTerminadoKg: peladoTerminado,
      LotesEnMesas: enMesas.length,
      EnMesasMpKg: r2(suma(enMesas, "Tomado") - suma(enMesas, "Bajado")), EnMesasPeladoKg: suma(enMesas, "Pelado"),
      TomadoKg: tomado, BajadoKg: bajado, DiferenciaPisoKg: diferenciaPiso,
    },
  };
}
