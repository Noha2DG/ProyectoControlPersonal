// Materia Prima de Destajo tomada del inventario al piso.
//
// El lote de Destajo ya no se teclea cuando el producto viene de bodega: el encargado de Pelado o
// Descabezado lo ESCOGE de lo que tiene al piso (lo que Descongelado le trasladó, o lo que una
// remisión le cargó directo). El código, la clase y el peso salen de ahí —  el peso es el de la
// báscula de Descongelado, no uno tecleado. Antes se rehacía a mano: G240K025 con 976.1 kg en el piso
// se capturaba como G243K025 con 976.1 kg en Materia Prima.
//
// Lo JALA Pelado, no lo empuja Descongelado. La versión que creaba el lote sola al descongelar
// (41c50a2, revertida el 13 oct 2026) dejaba lotes que nadie había pedido; acá el lote nace cuando
// el encargado decide trabajarlo.
//
// Todo vive en el kardex del piso (MovimientoPiso), enlazado al lote con LoteProceso/ClaseProceso:
//   DESTAJO   piso de la bodega → lote de Destajo   (BodegaOrigen = la bodega)
//   BAJADO    mesa → piso de la bodega              (BodegaDestino = la bodega; se retoma otro día).
//             Motivo "Sobrante" (no se terminó) o "Rojo" (se separa y se vuelve a revisar).
//   DESCARTE  mesa → nada                           (sin bodega: es merma, no inventario)
//   COLA      lote entero → piso de Pelado           (un renglón por termo; ver registrarCola)
// UNIFICAR junta varias líneas de la misma finca en el lote de una de ellas (la de más kilos por
// omisión); cada línea sigue diciendo en el kardex de qué lote de origen vino.
// No hace falta ninguna columna nueva: las de enlace quedaron puestas con el esquema de 41c50a2.
//
// RENDIMIENTO del lote = Procesado ÷ (Ingreso − Bajado). Lo bajado (sobrante o rojo) no se trabajó,
// así que no cuenta; el descarte sí se trabajó y se perdió, así que se queda dentro como merma.
// El rojo NO es descarte: se separa, vuelve al piso y se revisa otra vez.
//
// LOTE ENTERO (C20 → cola en Descabezado): el pesaje por persona es la CABEZA (lo que se paga), así
// que Procesado ÷ Ingreso daba ~35 % y no era un rendimiento. La cola no va a nadie: se pesa por termo
// y entra al piso de Pelado como inventario. Su rendimiento es Cola ÷ (Ingreso − Bajado), y el total
// (Cabeza + Cola) ÷ (Ingreso − Bajado) sirve de cuadre.
import { componerCodigoLote, descomponerCodigoLote, piscinaRequiereCiclo, FINCAS_SIN_CICLO } from "./codigoLote.ts";

// Bodegas cuyo piso alimenta Destajo. Pelado y Descabezado son dos áreas con piso propio desde el
// 20 oct 2026 (scripts/separarPeladoDescabezado.ts).
export const BODEGAS_CON_DESTAJO = ["PELADO", "DESCABEZADO"];

// Lotes entero que se descabezan, y las clases de cola que salen de ellos (decisión del usuario,
// 21 oct 2026; C26 —entero IQF— se agregó el mismo día). La cola va siempre al piso de Pelado.
export const CLASES_ENTERO = ["C20", "C23", "C24", "C25", "C26", "L20", "L21", "L22"];
export const CLASES_COLA = ["D30", "D33", "D34", "D35"];
const BODEGA_COLA = "PELADO";
/**
 * La cola que le corresponde a un entero por omisión: sifón → cola sifón (D35), entero-R → cola-R
 * (D33), el resto D30. Un lote de piscina sifón (G343EM-SIFON) es sifón aunque su clase sea otra,
 * como el C26 —entero IQF—. Es solo la sugerencia: el encargado escoge la clase al registrar.
 */
export function claseColaSugerida(claseEntero: string, lote = "") {
  if (claseEntero === "C24" || /SIFON/i.test(lote)) return "D35";
  return claseEntero === "C25" ? "D33" : "D30";
}
export const esEntero = (clase: string) => CLASES_ENTERO.includes(String(clase));

const LB_POR_KG = 2.20462;

export class ErrorNegocio extends Error {
  status: number;
  constructor(status: number, mensaje: string) {
    super(mensaje);
    this.status = status;
  }
}

type Piscina = { PiscinaId: number; Nombre: string; CodigoFinca: string };

const enLista = (xs: any[]) => xs.map(() => "?").join(",");
const r2 = (n: number) => Number(n.toFixed(2));

// ── Cuadre del lote ─────────────────────────────────────────────────────────────────────────────
// Bajado y descarte en la unidad DEL LOTE: un lote manual en libras recibe libras. Se usa el peso
// tal como se capturó cuando la unidad coincide, para no perder centésimas yendo y viniendo de kilos.
const sumaAjuste = (tipo: string, alias: string) => `
  COALESCE((SELECT SUM(CASE WHEN m.UM = ${alias}.UM THEN m.Peso
                            WHEN ${alias}.UM = 'LB' THEN m.PesoKg * ${LB_POR_KG}
                            ELSE m.PesoKg END)
              FROM MovimientoPiso m
             WHERE m.LoteProceso = ${alias}.Lote AND m.ClaseProceso = ${alias}.Clase AND m.Tipo = '${tipo}'), 0)`;

/** Columnas SQL Bajado, Descarte y Cola de un lote, para pegar en un SELECT sobre Lotes con alias `alias`. */
export function sqlAjustesLote(alias = "l") {
  return `ROUND(${sumaAjuste("BAJADO", alias)}, 2) AS Bajado, ROUND(${sumaAjuste("DESCARTE", alias)}, 2) AS Descarte, ` +
         `ROUND(${sumaAjuste("COLA", alias)}, 2) AS Cola`;
}

/** Rendimiento sobre lo trabajado: lo bajado al piso no se trabajó; el descarte sí (es merma). */
export function rendimientoLote(ingreso: number, bajado: number, procesado: number) {
  const trabajado = ingreso - bajado;
  return trabajado > 0 ? (procesado / trabajado) * 100 : 0;
}

/**
 * Los números de un lote entero: lo pesado es CABEZA, la cola sale de los termos. El rendimiento del
 * lote es el de cola; el total (cabeza + cola) es el cuadre contra lo trabajado.
 */
export function rendimientosEntero(ingreso: number, bajado: number, cabeza: number, cola: number, descarte: number) {
  const trabajado = ingreso - bajado;
  const pct = (x: number) => (trabajado > 0 ? (x / trabajado) * 100 : 0);
  return {
    Cabeza: r2(cabeza), Total: r2(cabeza + cola),
    RendimientoCabeza: pct(cabeza), RendimientoCola: pct(cola), RendimientoTotal: pct(cabeza + cola),
    Diferencia: r2(trabajado - descarte - cabeza - cola),
  };
}

/** Ingreso, procesado, bajado y descarte de un lote, con la fila del lote bloqueada. */
export async function cuadreLote(tx: any, lote: string, clase: string) {
  const [l]: any[] = await tx.$queryRawUnsafe(`
    SELECT l.Lote, l.Clase, l.PesoIngreso, l.UM, l.Origen, DATE_FORMAT(COALESCE(l.FechaProduccion, l.Fecha), '%Y-%m-%d') AS FechaProduccion,
           COALESCE((SELECT SUM(pd.Peso) FROM PesajeDetalle pd
                       JOIN TransaccionesProduccion tp ON tp.TransaccionId = pd.TransaccionId
                      WHERE tp.Lote = l.Lote AND tp.ClaseOrigen = l.Clase), 0) AS Procesado,
           (SELECT COUNT(*) FROM TransaccionesProduccion tp WHERE tp.Lote = l.Lote AND tp.ClaseOrigen = l.Clase) AS Transacciones,
           ${sqlAjustesLote("l")}
      FROM Lotes l WHERE l.Lote = ? AND l.Clase = ? FOR UPDATE`, lote, clase);
  if (!l) throw new ErrorNegocio(404, `No existe el lote ${lote} ${clase}`);
  const c = {
    Lote: String(l.Lote), Clase: String(l.Clase), UM: String(l.UM), Origen: String(l.Origen),
    FechaProduccion: String(l.FechaProduccion),
    Ingreso: Number(l.PesoIngreso), Procesado: Number(l.Procesado), Transacciones: Number(l.Transacciones),
    Bajado: Number(l.Bajado), Descarte: Number(l.Descarte), Cola: Number(l.Cola),
  };
  return { ...c, Pendiente: r2(c.Ingreso - c.Bajado - c.Descarte - c.Procesado) };
}

// Kilos a la unidad del lote, y peso capturado en la unidad del lote a kilos.
const aUnidadLote = (kg: number, um: string) => (um === "LB" ? kg * LB_POR_KG : kg);
const aKg = (peso: number, um: string) => r2(um === "LB" ? peso / LB_POR_KG : peso);

// ── Saldo al piso ───────────────────────────────────────────────────────────────────────────────
// La llave es la misma con la que Descongelado agrupa su saldo (remisión, lote, clase, talla y fecha
// del lote): una toma tiene que caer exactamente sobre la fila de la que sale, o la pantalla del
// piso mostraría un +976 y un −976 en dos renglones en vez de un saldo en cero.
const claveLinea = (x: any) =>
  `${x.RemisionId == null || x.RemisionId === "" ? "" : Number(x.RemisionId)}|${x.Lote}|${x.Clase}|${Number(x.Talla)}|${x.FechaLote ?? ""}`;

async function saldoLineas(client: any, bodega: string, lotes?: string[]) {
  const filtro = lotes?.length ? `AND Lote IN (${enLista(lotes)})` : "";
  const args = lotes?.length ? [bodega, ...lotes, bodega, ...lotes] : [bodega, bodega];
  const rows: any[] = await client.$queryRawUnsafe(`
    SELECT t.RemisionId, rm.Folio AS FolioRemision, t.Lote, t.Clase, cl.Descripcion AS DescripcionClase,
           t.Talla, ta.Descripcion AS DescripcionTalla, DATE_FORMAT(t.FechaLote, '%Y-%m-%d') AS FechaLote,
           DATE_FORMAT(MIN(CASE WHEN t.Delta > 0 THEN t.FechaProduccion END), '%Y-%m-%d') AS FechaIngreso,
           ROUND(SUM(t.Delta), 2) AS Kg, SUM(t.Masters) AS Masters, MAX(t.KgPorMaster) AS KgPorMaster,
           MAX(t.EsBajado) AS EsBajado, MAX(t.EsRojo) AS EsRojo, MAX(t.EsCola) AS EsCola
      FROM (
        SELECT RemisionId, Lote, Clase, Talla, FechaLote, FechaProduccion,  PesoKg AS Delta,  Masters, KgPorMaster,
               Tipo = 'BAJADO' AS EsBajado, Tipo = 'BAJADO' AND Motivo LIKE 'Rojo%' AS EsRojo, Tipo = 'COLA' AS EsCola
          FROM MovimientoPiso WHERE BodegaDestino = ? ${filtro}
        UNION ALL
        SELECT RemisionId, Lote, Clase, Talla, FechaLote, FechaProduccion, -PesoKg, -Masters, KgPorMaster, 0, 0, 0
          FROM MovimientoPiso WHERE BodegaOrigen = ? ${filtro}
      ) t
      JOIN Clase cl ON cl.Clase = t.Clase
      JOIN Tallas ta ON ta.Codigo = t.Talla
      LEFT JOIN Remisiones rm ON rm.RemisionId = t.RemisionId
     GROUP BY t.RemisionId, rm.Folio, rm.ConfirmadaEn, t.Lote, t.Clase, cl.Descripcion, t.Talla, ta.Descripcion, t.FechaLote
    HAVING Kg > 0.001
     ORDER BY t.FechaLote IS NULL, t.FechaLote, rm.ConfirmadaEn, t.Lote, t.Clase, t.Talla`, ...args);
  return rows.map(r => ({
    ...r,
    RemisionId: r.RemisionId == null ? null : Number(r.RemisionId),
    Talla: Number(r.Talla), Kg: Number(r.Kg),
    Masters: r.Masters == null ? null : Number(r.Masters),
    KgPorMaster: r.KgPorMaster == null ? null : Number(r.KgPorMaster),
    EsBajado: Number(r.EsBajado) === 1,
    EsRojo: Number(r.EsRojo) === 1,
    EsCola: Number(r.EsCola) === 1,
  }));
}

async function cargarPiscinas(client: any): Promise<Piscina[]> {
  return (await client.$queryRawUnsafe(`SELECT PiscinaId, Nombre, CodigoFinca FROM Piscina`) as any[])
    .map(p => ({ PiscinaId: Number(p.PiscinaId), Nombre: String(p.Nombre), CodigoFinca: String(p.CodigoFinca) }));
}

// Año del ciclo: el del lote de ORIGEN (su letra), no el de hoy. El ciclo es la siembra de la que
// salió el camarón, y un lote de diciembre procesado en enero sigue siendo de ella.
const anioDeCodigo = (lote: string, respaldo: string) => {
  const c = String(lote || "").toUpperCase().charCodeAt(0);
  return c >= 65 && c <= 90 ? 2020 + (c - 65) : Number(respaldo.slice(0, 4));
};

/** Lo que una bodega con destajo tiene al piso, con el lote de Destajo que le tocaría hoy. */
export async function saldoParaDestajo(client: any, bodega: string, fecha: string) {
  if (!BODEGAS_CON_DESTAJO.includes(bodega)) throw new ErrorNegocio(400, `${bodega} no alimenta Destajo`);
  const [lineas, piscinas, fincas] = [
    await saldoLineas(client, bodega),
    await cargarPiscinas(client),
    await client.$queryRawUnsafe(`SELECT Codigo, Descripcion FROM Finca`) as any[],
  ];
  const nombreFinca = new Map(fincas.map((f: any) => [String(f.Codigo), String(f.Descripcion)]));
  // Lotes que ya existen hoy, para avisar en pantalla antes de que el servidor lo rechace.
  const hoy: any[] = await client.$queryRawUnsafe(
    `SELECT Lote, Clase, Origen FROM Lotes WHERE Fecha = ?`, fecha);
  const existentes = new Map(hoy.map(x => [`${x.Lote}|${x.Clase}`, String(x.Origen)]));

  return lineas.map(l => {
    const d = descomponerCodigoLote(String(l.Lote), piscinas);
    const legible = !!d && !(piscinaRequiereCiclo(d.piscina.Nombre, d.piscina.CodigoFinca) && !d.ciclo);
    const loteDestajo = legible ? componerCodigoLote(d!.piscina.Nombre, fecha, d!.ciclo ? String(d!.ciclo) : "") : null;
    return {
      ...l,
      Clave: claveLinea(l),
      DiasAlPiso: l.FechaIngreso ? Math.max(0, Math.round((Date.parse(fecha) - Date.parse(l.FechaIngreso)) / 86400000)) : 0,
      Legible: legible,
      PiscinaId: d?.piscina.PiscinaId ?? null,
      NombrePiscina: d?.piscina.Nombre ?? null,
      CodigoFinca: d?.piscina.CodigoFinca ?? null,
      NombreFinca: d ? nombreFinca.get(d.piscina.CodigoFinca) ?? d.piscina.CodigoFinca : null,
      Ciclo: d?.ciclo ?? null,
      NoUnificable: !!d && noSeUnifica(d.piscina),
      LoteDestajo: loteDestajo,
      ExisteHoy: loteDestajo ? existentes.get(`${loteDestajo}|${l.Clase}`) ?? null : null,
    };
  });
}

// Sifones y lotes genéricos (EM00-E00, TM00-E00) van siempre solos: no entran a una unificación.
const noSeUnifica = (p: { Nombre: string }) => /SIFON|00-E00/i.test(p.Nombre);

// ── Tomar del piso ──────────────────────────────────────────────────────────────────────────────
type LineaToma = {
  RemisionId: number | null; Lote: string; Clase: string; Talla: number; FechaLote: string | null;
  Kg: number; PiscinaId?: number | null; Ciclo?: number | null;
};

/**
 * Crea (o suma a) los lotes de Destajo del día con lo que el encargado escogió del piso, y saca ese
 * producto del piso.
 *
 * Con `unificar`, todas las líneas van a UN lote por clase: el de la línea `baseLote` que escoge el
 * encargado entre las marcadas —  en la planta se usa uno de los que se están trabajando, casi siempre
 * el de más libras. Lo escoge siempre él: no hay valor por omisión. Es para las tandas de pocas
 * libras de muchos lotes. Lo absorbido no se pierde: cada línea guarda de qué lote de origen vino.
 */
export async function tomarDelPiso(
  tx: any, p: { bodega: string; lineas: LineaToma[]; unificar: boolean; baseLote?: string | null;
                fecha: string; operador: string }
) {
  const { bodega, fecha, operador } = p;
  if (!BODEGAS_CON_DESTAJO.includes(bodega)) throw new ErrorNegocio(400, `${bodega} no alimenta Destajo`);
  if (!p.lineas.length) throw new ErrorNegocio(400, "No escogió nada del piso");

  // Dos encargados tomando a la vez del mismo piso: la disponibilidad se calcula sumando y no se
  // puede bloquear sola, así que se serializa sobre la fila de la bodega.
  await tx.$queryRawUnsafe(`SELECT Codigo FROM BodegaVirtual WHERE Codigo = ? FOR UPDATE`, bodega);

  const lineas = p.lineas.map(l => {
    const kg = r2(Number(l.Kg));
    if (!(kg > 0)) throw new ErrorNegocio(400, `${l.Lote} ${l.Clase}: los kilos deben ser mayores que cero`);
    return { ...l, Kg: kg, Talla: Number(l.Talla) || 900,
             RemisionId: l.RemisionId == null || (l.RemisionId as any) === "" ? null : Number(l.RemisionId),
             FechaLote: l.FechaLote || null };
  });

  // Disponibilidad contra un saldo que va bajando: la misma línea dos veces en la petición mide la
  // segunda contra lo que dejó la primera.
  const saldo = await saldoLineas(tx, bodega, [...new Set(lineas.map(l => l.Lote))]);
  const hay = new Map(saldo.map(s => [claveLinea(s), s]));
  const usado = new Map<string, number>();
  for (const l of lineas) {
    const k = claveLinea(l);
    const s = hay.get(k);
    const queda = (s?.Kg ?? 0) - (usado.get(k) ?? 0);
    if (l.Kg > queda + 0.001) {
      throw new ErrorNegocio(400, `De ${l.Lote} ${l.Clase} solo quedan ${Math.max(queda, 0).toFixed(2)} kg al piso; está tomando ${l.Kg.toFixed(2)} kg.`);
    }
    usado.set(k, (usado.get(k) ?? 0) + l.Kg);
  }

  // A qué lote de Destajo va cada línea.
  const piscinas = await cargarPiscinas(tx);
  const porId = new Map(piscinas.map(x => [x.PiscinaId, x]));
  const destinos = lineas.map(l => {
    let piscina: Piscina | undefined, ciclo: number | null = null;
    if (l.PiscinaId) {
      // El encargado escogió la piscina de un código que no se pudo leer.
      piscina = porId.get(Number(l.PiscinaId));
      if (!piscina) throw new ErrorNegocio(400, `${l.Lote}: la piscina escogida no existe`);
      ciclo = l.Ciclo ? Number(l.Ciclo) : null;
    } else {
      const d = descomponerCodigoLote(l.Lote, piscinas);
      if (!d) throw new ErrorNegocio(400, `No se reconoce la piscina del lote ${l.Lote}: escójala a mano`);
      piscina = d.piscina; ciclo = d.ciclo;
    }
    return { l, piscina, ciclo, anio: anioDeCodigo(l.Lote, fecha) };
  });
  const sinCiclo = (d: { l: { Lote: string }; piscina: Piscina; ciclo: number | null }) =>
    piscinaRequiereCiclo(d.piscina.Nombre, d.piscina.CodigoFinca) && !d.ciclo;

  // Unificar: una sola finca, y nunca un proveedor externo (Maquila, Importación, Pescado): ahí cada
  // lote es un contenedor y su merma se calcula por separado —  la de maquila se le rinde al cliente.
  let base: (typeof destinos)[number] | null = null;
  if (p.unificar) {
    const fincas = [...new Set(destinos.map(d => d.piscina.CodigoFinca))];
    if (fincas.length > 1) {
      throw new ErrorNegocio(400, `Solo se pueden unificar lotes de la misma finca (escogió de ${fincas.join(", ")})`);
    }
    if (FINCAS_SIN_CICLO.includes(fincas[0])) {
      throw new ErrorNegocio(400, `Los lotes de ${fincas[0]} no se unifican: cada lote es un contenedor y su merma se calcula por separado`);
    }
    const solos = [...new Set(destinos.filter(d => noSeUnifica(d.piscina)).map(d => d.l.Lote))];
    if (solos.length) {
      throw new ErrorNegocio(400, `${solos.join(", ")} no se unifica: sifón y lotes genéricos (00-E00) van solos`);
    }
    // El lote que da el código: siempre el que escogió el encargado entre los marcados.
    if (!p.baseLote) throw new ErrorNegocio(400, "Escoja con cuál lote se unifica");
    const elegido = destinos.find(d => d.l.Lote === p.baseLote);
    if (!elegido) throw new ErrorNegocio(400, `El lote ${p.baseLote} no está entre los que escogió para unificar`);
    base = elegido;
    if (sinCiclo(base)) {
      throw new ErrorNegocio(400, `${base.l.Lote}: la piscina ${base.piscina.Nombre} lleva ciclo y el código no lo trae; escoja otro lote para unificar`);
    }
  } else {
    const d = destinos.find(sinCiclo);
    if (d) throw new ErrorNegocio(400, `${d.l.Lote}: la piscina ${d.piscina.Nombre} lleva ciclo y el código no lo trae`);
  }

  // Agrupar por lote de Destajo (código + clase).
  const grupos = new Map<string, { lote: string; clase: string; piscina: Piscina; ciclo: number | null;
                                   anio: number; lineas: typeof lineas }>();
  for (const d of destinos) {
    const { piscina, ciclo, anio } = base ?? d;
    const lote = componerCodigoLote(piscina.Nombre, fecha, ciclo ? String(ciclo) : "");
    const k = `${lote}|${d.l.Clase}`;
    if (!grupos.has(k)) grupos.set(k, { lote, clase: d.l.Clase, piscina, ciclo, anio, lineas: [] });
    grupos.get(k)!.lineas.push(d.l);
  }

  // Un lote MANUAL de hoy con el mismo código casi siempre es este mismo producto tecleado a mano
  // (pasaba con G243K025). Sumarle el piso contaría el peso dos veces.
  const claves = [...grupos.values()];
  const existentes: any[] = await tx.$queryRawUnsafe(
    `SELECT Lote, Clase, Origen, PesoIngreso, UM FROM Lotes
      WHERE (Lote, Clase) IN (${claves.map(() => "(?, ?)").join(",")}) FOR UPDATE`,
    ...claves.flatMap(g => [g.lote, g.clase]));
  for (const e of existentes) {
    if (String(e.Origen) === "MANUAL") {
      throw new ErrorNegocio(400,
        `Ya existe el lote ${e.Lote} ${e.Clase} capturado a mano con ${Number(e.PesoIngreso).toFixed(2)} ${e.UM}. ` +
        `Si es este mismo producto, elimínelo o corríjalo antes de tomarlo del piso.`);
    }
  }
  const umDe = new Map(existentes.map(e => [`${e.Lote}|${e.Clase}`, String(e.UM)]));

  const creados: { Lote: string; Clase: string; Kg: number; Lineas: number }[] = [];
  for (const g of claves) {
    let cicloId: number | null = null;
    if (g.ciclo) {
      await tx.$executeRawUnsafe(`INSERT IGNORE INTO Ciclo (PiscinaId, Anio, Ciclo) VALUES (?, ?, ?)`,
        g.piscina.PiscinaId, g.anio, g.ciclo);
      const [c]: any[] = await tx.$queryRawUnsafe(
        `SELECT CicloId FROM Ciclo WHERE PiscinaId = ? AND Anio = ? AND Ciclo = ? LIMIT 1`, g.piscina.PiscinaId, g.anio, g.ciclo);
      cicloId = c?.CicloId ? Number(c.CicloId) : null;
    }
    const kg = r2(g.lineas.reduce((s, l) => s + l.Kg, 0));
    const tallas = [...new Set(g.lineas.map(l => l.Talla).filter(t => t !== 900))];
    const um = umDe.get(`${g.lote}|${g.clase}`) ?? "KG";
    await tx.$executeRawUnsafe(`
      INSERT INTO Lotes (Lote, CicloId, PiscinaId, Clase, TallaReferencia, Fecha, FechaProduccion,
                         PesoIngreso, UM, RegistradoPor, Origen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'KG', ?, 'PISO')
      ON DUPLICATE KEY UPDATE PesoIngreso = ROUND(PesoIngreso + ?, 2), Activo = 1`,
      g.lote, cicloId, g.piscina.PiscinaId, g.clase, tallas.length === 1 ? tallas[0] : null,
      fecha, fecha, kg, operador, r2(aUnidadLote(kg, um)));
    creados.push({ Lote: g.lote, Clase: g.clase, Kg: kg, Lineas: g.lineas.length });
  }

  // La salida del piso, una fila por línea escogida, enlazada a su lote de Destajo. Los masters se
  // descuentan en proporción cuando la línea los trae (remisión directa); lo que llega de
  // Descongelado viene pesado y sin masters.
  const filas: string[] = [], args: any[] = [];
  for (const g of claves) {
    for (const l of g.lineas) {
      const s = hay.get(claveLinea(l));
      let masters: number | null = null;
      if (s?.Masters && s.KgPorMaster) {
        masters = l.Kg >= s.Kg - 0.001 ? s.Masters : Math.min(s.Masters, Math.round(l.Kg / s.KgPorMaster));
      }
      filas.push("('DESTAJO',?,?,?,?,?,?,?,'KG',?,?,?,?,?,?,?)");
      args.push(fecha, bodega, l.Lote, l.Clase, l.Talla, l.FechaLote, l.Kg, l.Kg, masters,
                s?.KgPorMaster ?? null, l.RemisionId, g.lote, g.clase, operador);
    }
  }
  await tx.$executeRawUnsafe(`
    INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaOrigen, Lote, Clase, Talla, FechaLote,
                                Peso, UM, PesoKg, Masters, KgPorMaster, RemisionId, LoteProceso, ClaseProceso, RegistradoPor)
    VALUES ${filas.join(",")}`, ...args);

  return { ok: true, lotes: creados };
}

// ── Bajar al piso y descarte ────────────────────────────────────────────────────────────────────
type Ajuste = { lote: string; clase: string; peso: number; talla?: number | null; nota?: string | null;
                bodega?: string | null; motivo?: string | null; fecha: string; operador: string };

// "Rojo: se ve oscuro" — el motivo va primero para que el saldo reconozca el rojo (Motivo LIKE 'Rojo%').
const textoMotivo = (a: Ajuste) =>
  [a.motivo, a.nota].map(x => (x ? String(x).trim() : "")).filter(Boolean).join(": ").slice(0, 200) || null;
const MOTIVOS_BAJADO = ["Sobrante", "Rojo"];

// El techo de un ajuste: no se puede bajar ni descartar más de lo que queda sin pesar en el lote.
function validarAjuste(c: Awaited<ReturnType<typeof cuadreLote>>, peso: number, que: string) {
  if (!(peso > 0)) throw new ErrorNegocio(400, "El peso debe ser mayor que cero");
  if (peso > c.Pendiente + 0.001) {
    throw new ErrorNegocio(400, `Al lote ${c.Lote} ${c.Clase} solo le quedan ${Math.max(c.Pendiente, 0).toFixed(2)} ${c.UM} sin pesar; no se pueden ${que} ${peso.toFixed(2)}.`);
  }
}

/**
 * Lo que no se terminó en la mesa (Sobrante) o lo que se separa para revisarlo otra vez (Rojo) vuelve
 * al piso de la bodega; se retoma otro día desde "Tomar del piso".
 */
export async function bajarAlPiso(tx: any, a: Ajuste) {
  const c = await cuadreLote(tx, a.lote, a.clase);
  const peso = r2(Number(a.peso));
  validarAjuste(c, peso, "bajar");
  const motivo = a.motivo ? String(a.motivo) : "Sobrante";
  if (!MOTIVOS_BAJADO.includes(motivo)) throw new ErrorNegocio(400, `Motivo de bajado no válido: ${motivo}`);

  // Por omisión, al piso del que salió el lote; un lote manual (fresco) no tiene, y va a Pelado.
  let bodega = a.bodega ? String(a.bodega) : null;
  if (!bodega) {
    const [o]: any[] = await tx.$queryRawUnsafe(
      `SELECT BodegaOrigen FROM MovimientoPiso WHERE LoteProceso = ? AND ClaseProceso = ? AND Tipo = 'DESTAJO' LIMIT 1`,
      a.lote, a.clase);
    bodega = o?.BodegaOrigen ? String(o.BodegaOrigen) : BODEGAS_CON_DESTAJO[0];
  }
  if (!BODEGAS_CON_DESTAJO.includes(bodega)) throw new ErrorNegocio(400, `${bodega} no recibe lo bajado de Destajo`);

  await tx.$executeRawUnsafe(`
    INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaDestino, Lote, Clase, Talla, FechaLote,
                                Peso, UM, PesoKg, Motivo, LoteProceso, ClaseProceso, RegistradoPor)
    VALUES ('BAJADO', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    a.fecha, bodega, c.Lote, c.Clase, Number(a.talla) || 900, c.FechaProduccion,
    peso, c.UM, aKg(peso, c.UM), textoMotivo({ ...a, motivo }), c.Lote, c.Clase, a.operador);
  return { ok: true, Bodega: bodega };
}

/** Descarte: merma del lote. No va al piso y SÍ cuenta en el rendimiento. El rojo no es descarte. */
export async function registrarDescarte(tx: any, a: Ajuste) {
  const c = await cuadreLote(tx, a.lote, a.clase);
  const peso = r2(Number(a.peso));
  validarAjuste(c, peso, "descartar");
  if (/^rojo/i.test(String(a.motivo ?? ""))) {
    throw new ErrorNegocio(400, "El rojo no es descarte: se separa y se baja al piso para revisarlo otra vez");
  }
  const motivo = textoMotivo(a);
  await tx.$executeRawUnsafe(`
    INSERT INTO MovimientoPiso (Tipo, FechaProduccion, Lote, Clase, Talla, FechaLote,
                                Peso, UM, PesoKg, Motivo, LoteProceso, ClaseProceso, RegistradoPor)
    VALUES ('DESCARTE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    a.fecha, c.Lote, c.Clase, Number(a.talla) || 900, c.FechaProduccion,
    peso, c.UM, aKg(peso, c.UM), motivo, c.Lote, c.Clase, a.operador);
  return { ok: true };
}

// ── Cola de un lote entero ──────────────────────────────────────────────────────────────────────
/**
 * Un termo de cola que sale de un lote entero en Descabezado. No va a ninguna persona —  lo que se
 * paga es la cabeza, que ya está en el pesaje— : se pesa el termo lleno y entra al piso de Pelado,
 * que lo toma desde "Tomar del piso" (antes creaba el D30 a mano con el mismo código).
 *
 * El número de termo se teclea: no es el mismo que se anota en el pesaje de cabeza.
 *
 * NO se resta de lo disponible para pesar ni del Pendiente: cabeza y cola se pesan por separado y
 * pueden sumar más que el ingreso (agua, hielo), y restarla podría trabar el pesaje de cabeza, que es
 * el pago.
 */
export async function registrarCola(
  tx: any, a: { lote: string; clase: string; peso: number; termo: string; claseCola: string;
                talla?: number | null; fecha: string; operador: string }
) {
  const c = await cuadreLote(tx, a.lote, a.clase);
  if (!esEntero(c.Clase)) throw new ErrorNegocio(400, `${c.Lote} ${c.Clase} no es un lote entero: no produce cola`);
  if (!CLASES_COLA.includes(a.claseCola)) {
    throw new ErrorNegocio(400, `La cola tiene que ser ${CLASES_COLA.join(", ")} (llegó ${a.claseCola || "vacía"})`);
  }
  const termo = String(a.termo ?? "").trim();
  if (!termo) throw new ErrorNegocio(400, "Falta el número de termo");
  if (termo.length > 20) throw new ErrorNegocio(400, "El número de termo es demasiado largo");
  const peso = r2(Number(a.peso));
  if (!(peso > 0)) throw new ErrorNegocio(400, "El peso debe ser mayor que cero");
  // Techo de cordura, no de cuadre: la cola no puede pasar de lo que se trabajó del lote.
  const trabajado = c.Ingreso - c.Bajado;
  if (c.Cola + peso > trabajado + 0.001) {
    throw new ErrorNegocio(400,
      `La cola del lote ${c.Lote} quedaría en ${(c.Cola + peso).toFixed(2)} ${c.UM}, más que lo trabajado (${trabajado.toFixed(2)}).`);
  }

  await tx.$executeRawUnsafe(`
    INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaDestino, Lote, Clase, Talla, FechaLote,
                                Peso, UM, PesoKg, NumeroTermo, LoteProceso, ClaseProceso, RegistradoPor)
    VALUES ('COLA', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    a.fecha, BODEGA_COLA, c.Lote, a.claseCola, Number(a.talla) || 900, c.FechaProduccion,
    peso, c.UM, aKg(peso, c.UM), termo, c.Lote, c.Clase, a.operador);
  return { ok: true, Bodega: BODEGA_COLA };
}

// Lo que un lote mandó a un piso (bajado o cola) tiene que seguir ahí para poder deshacerlo: si ya lo
// tomó otro lote, borrarlo dejaría ese saldo en negativo.
async function sigueAlPiso(tx: any, movimientoId: number) {
  const [b]: any[] = await tx.$queryRawUnsafe(`
    SELECT BodegaDestino, RemisionId, Lote, Clase, Talla, DATE_FORMAT(FechaLote, '%Y-%m-%d') AS FechaLote, PesoKg
      FROM MovimientoPiso WHERE MovimientoId = ?`, movimientoId);
  const s = (await saldoLineas(tx, String(b.BodegaDestino), [String(b.Lote)])).find(x => claveLinea(x) === claveLinea(b));
  return (s?.Kg ?? 0) >= Number(b.PesoKg) - 0.001;
}

// ── Devolver el lote completo al piso ───────────────────────────────────────────────────────────
/**
 * Un lote tomado del piso no se elimina: se DEVUELVE. Todo regresa como estaba antes de tomarlo —
 * sus tomas vuelven al piso, se anulan sus bajados y descartes, se borran sus transacciones vacías
 * — y el lote desaparece. Solo mientras no tenga nada pesado: con pesaje ya no se puede devolver
 * todo, y lo que no se trabajó se baja con "Bajar al piso".
 */
export async function devolverLoteAlPiso(tx: any, lote: string, clase: string) {
  const c = await cuadreLote(tx, lote, clase);
  if (c.Origen === "MANUAL") throw new ErrorNegocio(400, `${lote} ${clase} se capturó a mano: no vino del piso`);
  if (c.Procesado > 0.001) {
    throw new ErrorNegocio(400,
      `${lote} ${clase} ya tiene ${c.Procesado.toFixed(2)} ${c.UM} pesados: no se puede devolver completo. ` +
      `Lo que no se trabajó se baja con "Bajar al piso".`);
  }

  // Lo bajado y la cola tienen que seguir al piso: si ya los tomó otro lote, devolver este dejaría
  // ese saldo en negativo.
  const movs = await movimientosDeLote(tx, lote, clase);
  for (const m of movs.filter(x => x.Tipo === "BAJADO" || x.Tipo === "COLA")) {
    if (!(await sigueAlPiso(tx, m.MovimientoId))) {
      throw new ErrorNegocio(400, m.Tipo === "COLA"
        ? `La cola de ${lote} ya la tomó Pelado; devuelva primero ese lote.`
        : `Lo que se bajó de ${lote} ya se volvió a tomar del piso; devuelva primero ese otro lote.`);
    }
  }

  // Transacciones sin pesaje (Procesado en cero ya lo garantiza): se van con sus termos, igual que
  // al eliminarlas a mano.
  const trans: any[] = await tx.$queryRawUnsafe(
    `SELECT TransaccionId FROM TransaccionesProduccion WHERE Lote = ? AND ClaseOrigen = ? FOR UPDATE`, lote, clase);
  const ids = trans.map(t => Number(t.TransaccionId));
  if (ids.length) {
    const [p]: any[] = await tx.$queryRawUnsafe(
      `SELECT COUNT(*) AS n FROM PesajeDetalle WHERE TransaccionId IN (${enLista(ids)})`, ...ids);
    if (Number(p.n) > 0) throw new ErrorNegocio(400, `${lote} ${clase} tiene pesajes registrados: no se puede devolver completo.`);
    await tx.$executeRawUnsafe(`DELETE FROM Termos WHERE TransaccionId IN (${enLista(ids)})`, ...ids);
    await tx.$executeRawUnsafe(`DELETE FROM TransaccionesProduccion WHERE TransaccionId IN (${enLista(ids)})`, ...ids);
  }

  const kgAlPiso = r2(movs.filter(m => m.Tipo === "DESTAJO").reduce((t, m) => t + m.PesoKg, 0));
  await tx.$executeRawUnsafe(
    `DELETE FROM MovimientoPiso WHERE LoteProceso = ? AND ClaseProceso = ? AND Tipo IN ('DESTAJO', 'BAJADO', 'DESCARTE', 'COLA')`,
    lote, clase);
  await tx.$executeRawUnsafe(`DELETE FROM Lotes WHERE Lote = ? AND Clase = ?`, lote, clase);
  return { ok: true, KgAlPiso: kgAlPiso, Transacciones: ids.length,
           Bajados: movs.filter(m => m.Tipo === "BAJADO").length, Descartes: movs.filter(m => m.Tipo === "DESCARTE").length };
}

// ── Movimientos de un lote y deshacer ───────────────────────────────────────────────────────────
export async function movimientosDeLote(client: any, lote: string, clase: string) {
  const rows: any[] = await client.$queryRawUnsafe(`
    SELECT m.MovimientoId, m.Tipo, DATE_FORMAT(m.FechaHora, '%Y-%m-%d %H:%i') AS FechaHora,
           DATE_FORMAT(m.FechaProduccion, '%Y-%m-%d') AS Fecha,
           m.Lote AS LoteOrigen, m.Clase, m.Talla, ta.Descripcion AS DescripcionTalla,
           m.Peso, m.UM, m.PesoKg, m.Motivo, m.NumeroTermo, rm.Folio AS FolioRemision,
           COALESCE(m.BodegaOrigen, m.BodegaDestino) AS Bodega, b.Nombre AS NombreBodega, m.RegistradoPor
      FROM MovimientoPiso m
      JOIN Tallas ta ON ta.Codigo = m.Talla
      LEFT JOIN Remisiones rm ON rm.RemisionId = m.RemisionId
      LEFT JOIN BodegaVirtual b ON b.Codigo = COALESCE(m.BodegaOrigen, m.BodegaDestino)
     WHERE m.LoteProceso = ? AND m.ClaseProceso = ? AND m.Tipo IN ('DESTAJO', 'BAJADO', 'DESCARTE', 'COLA')
     ORDER BY m.MovimientoId`, lote, clase);
  return rows.map(r => ({ ...r, MovimientoId: Number(r.MovimientoId), Talla: Number(r.Talla),
                          Peso: Number(r.Peso), PesoKg: Number(r.PesoKg) }));
}

/**
 * Deshace una toma, un bajado o un descarte. Solo el encargado (permiso de edición de Destajo).
 *   toma     → el producto vuelve al piso y el lote baja su ingreso; si el lote nació del piso y se
 *              queda sin nada ni transacciones, se borra (es un lote que nunca existió).
 *   bajado   → solo mientras nadie lo haya vuelto a tomar del piso.
 *   cola     → igual: solo mientras Pelado no la haya tomado.
 *   descarte → siempre.
 */
export async function deshacerMovimiento(tx: any, movimientoId: number) {
  const [m]: any[] = await tx.$queryRawUnsafe(`
    SELECT MovimientoId, Tipo, BodegaOrigen, BodegaDestino, RemisionId, Lote, Clase, Talla,
           DATE_FORMAT(FechaLote, '%Y-%m-%d') AS FechaLote, Peso, UM, PesoKg, LoteProceso, ClaseProceso
      FROM MovimientoPiso WHERE MovimientoId = ? FOR UPDATE`, movimientoId);
  if (!m || !m.LoteProceso || !["DESTAJO", "BAJADO", "DESCARTE", "COLA"].includes(String(m.Tipo))) {
    throw new ErrorNegocio(404, "Ese movimiento no existe o no es de Materia Prima");
  }
  const lote = String(m.LoteProceso), clase = String(m.ClaseProceso);
  const c = await cuadreLote(tx, lote, clase);

  if (m.Tipo === "DESTAJO") {
    const resta = r2(aUnidadLote(Number(m.PesoKg), c.UM));
    const nuevo = r2(c.Ingreso - resta);
    const comprometido = c.Procesado + c.Bajado + c.Descarte + c.Cola;
    if (nuevo < comprometido - 0.001) {
      throw new ErrorNegocio(400,
        `No se puede devolver al piso: el lote ${lote} ${clase} quedaría con ${Math.max(nuevo, 0).toFixed(2)} ${c.UM} de ingreso ` +
        `y ya tiene ${comprometido.toFixed(2)} pesado, bajado, descartado o en cola.`);
    }
    await tx.$executeRawUnsafe(`DELETE FROM MovimientoPiso WHERE MovimientoId = ?`, movimientoId);
    const [q]: any[] = await tx.$queryRawUnsafe(
      `SELECT COUNT(*) AS n FROM MovimientoPiso WHERE LoteProceso = ? AND ClaseProceso = ?`, lote, clase);
    if (c.Origen === "PISO" && Number(q.n) === 0 && c.Transacciones === 0) {
      await tx.$executeRawUnsafe(`DELETE FROM Lotes WHERE Lote = ? AND Clase = ?`, lote, clase);
      return { ok: true, LoteBorrado: true };
    }
    await tx.$executeRawUnsafe(`UPDATE Lotes SET PesoIngreso = ? WHERE Lote = ? AND Clase = ?`, Math.max(nuevo, 0), lote, clase);
    return { ok: true, LoteBorrado: false };
  }

  if ((m.Tipo === "BAJADO" || m.Tipo === "COLA") && !(await sigueAlPiso(tx, movimientoId))) {
    throw new ErrorNegocio(400, m.Tipo === "COLA"
      ? "Esa cola ya la tomó Pelado del piso; deshaga primero esa toma."
      : "Lo bajado ya se volvió a tomar del piso; deshaga primero esa toma.");
  }
  await tx.$executeRawUnsafe(`DELETE FROM MovimientoPiso WHERE MovimientoId = ?`, movimientoId);
  return { ok: true };
}
