// Empanizado: el lote que se toma del piso, lo que se pesa en la báscula y su cierre a Túnel.
// Esquema en backend/scripts/createEmpanizado.ts.
//
// Mismo modelo que Pelado (lib/destajoPiso.ts) pero APARTE de Destajo: el encargado ESCOGE del piso
// EMPANIZADO lo que mandó Tratamiento —ya con el pick-up, es el peso final— y nace un LoteEmpanizado
// (Lote + Clase + Talla). Las personas arman bandejas y cada una se pesa en la báscula con su carnet
// (Pesada, Modo EMPANIZADO): ahí se elige el producto que sale (coco, flat…) y si es exportación
// (con pedido) o venta local. Un mismo lote da varias SALIDAS = producto × destino; no se declaran,
// salen de lo pesado.
//
// Kardex del piso (MovimientoPiso, enlazado con LoteEmpanizadoId):
//   TOMA_EMPANIZADO  piso EMPANIZADO → lote          (BodegaOrigen = EMPANIZADO)
//   BAJADO           lote → piso EMPANIZADO          (lo que no se trabajó; se retoma otro día)
//   DESCARTE         lote → nada                     (merma)
//   PROCESADO        lote → piso TÚNEL               (al cerrar: un renglón por producto y destino)
// Tipo propio para la toma (no DESTAJO) y LoteProceso vacío: así ningún reporte de Pelado la cuenta.
//
// GANANCIA del lote = Kg pesados ÷ (Tomado − Bajado − Descarte) − 1. Es la harina: se MIDE, no hay
// meta (usuario, 20 nov 2026). Sale positiva casi siempre.

import { saldoLineas } from "./destajoPiso.ts";
import { componerCodigoLote, descomponerCodigoLote, piscinaRequiereCiclo, cargarPiscinas, type Piscina } from "./codigoLote.ts";

export const BODEGA_EMPANIZADO = "EMPANIZADO";
export const DESTINO_CIERRE = "TUNEL";
export const DESTINOS_PESADA: Record<string, string> = { EXPORTACION: "Exportación", LOCAL: "Venta local" };

export class ErrorEmpanizado extends Error {
  constructor(public status: number, mensaje: string) { super(mensaje); }
}

const r2 = (n: number) => Number(Number(n).toFixed(2));
// Lo pesado viene en gramos: en kilos se conserva al gramo (3 decimales). El kardex del piso solo
// guarda 2, así que al pasar a Túnel cada salida puede perder hasta 5 g de redondeo.
const kgDeG = (g: number) => Math.round(Number(g)) / 1000;
const enLista = (xs: any[]) => xs.map(() => "?").join(",");
const claveLinea = (x: any) =>
  `${x.RemisionId == null || x.RemisionId === "" ? "" : Number(x.RemisionId)}|${x.Lote}|${x.Clase}|${Number(x.Talla)}|${x.FechaLote ?? ""}`;

// ── Lo que hay al piso ──────────────────────────────────────────────────────────────────────────
// El MISMO saldo que Destajo (destajoPiso.saldoLineas): una línea por lote (remisión, lote, clase,
// talla, fecha del lote) con sus TERMOS adentro. Lo que Tratamiento traslada llega termo por termo
// (MovimientoPiso.NumeroTermo) y lo bajado también lleva termo, así que se toma por lote y termo,
// igual que en Pelado (usuario, 23 nov 2026).
export async function saldoPiso(client: any, bodega = BODEGA_EMPANIZADO, lotes?: string[], fecha?: string) {
  const rows = await saldoLineas(client, bodega, lotes);
  const piscinas = fecha ? await cargarPiscinas(client) : [];
  return rows.map((r: any) => ({
    ...r, Clave: claveLinea(r),
    DiasAlPiso: fecha && r.FechaIngreso ? Math.max(0, Math.round((Date.parse(fecha) - Date.parse(r.FechaIngreso)) / 86400000)) : 0,
    // El lote en que quedaría si se toma hoy (para mostrarlo antes de tomar).
    ...(fecha ? { LoteDia: loteDelDia(String(r.Lote), fecha, piscinas).lote } : {}),
  }));
}

// ── Lote del día ────────────────────────────────────────────────────────────────────────────────
// Lo que se pesa y pasa a Túnel lleva el lote del DÍA en que se trabaja, como en Pelado
// (destajoPiso.tomarDelPiso): la misma piscina y ciclo del lote que llegó al piso, con la fecha de
// hoy. G547Q012 y G647Q012 tomados el martes de la semana 48 quedan los dos en G248Q012 (usuario,
// 24 nov 2026). Lo que se toma sigue saliendo del piso con su lote de origen (el kardex lo guarda).
// Si el código no se puede leer (piscina desconocida, o lleva ciclo y no lo trae), se queda con el
// de origen: no se adivina.
export function loteDelDia(lote: string, fecha: string, piscinas: Piscina[]) {
  const d = descomponerCodigoLote(lote, piscinas);
  if (!d || (piscinaRequiereCiclo(d.piscina.Nombre, d.piscina.CodigoFinca) && !d.ciclo)) return { lote, delDia: false };
  return { lote: componerCodigoLote(d.piscina.Nombre, fecha, d.ciclo ? String(d.ciclo) : ""), delDia: true };
}

// ── Tomar del piso ──────────────────────────────────────────────────────────────────────────────
// Una línea por termo escogido (sin termo = se toma de la línea, para lo que llegó sin termo).
type LineaToma = { RemisionId: number | null; Lote: string; Clase: string; Talla: number; FechaLote: string | null; Kg: number; Termo?: string | null };

/**
 * Saca del piso lo que escogió el encargado y lo pone en su LoteEmpanizado (uno por lote del DÍA +
 * Clase + Talla, ver loteDelDia). Si ya hay uno ABIERTO de lo mismo, suma ahí: así no se parte el
 * pesaje en dos lotes.
 */
export async function tomarDelPiso(tx: any, p: { lineas: LineaToma[]; fecha: string; operador: string }) {
  if (!p.lineas?.length) throw new ErrorEmpanizado(400, "No escogió nada del piso");
  // Dos personas tomando a la vez: el saldo se calcula sumando, así que se serializa en la bodega.
  await tx.$queryRawUnsafe(`SELECT Codigo FROM BodegaVirtual WHERE Codigo = ? FOR UPDATE`, BODEGA_EMPANIZADO);

  const lineas = p.lineas.map(l => {
    const kg = r2(Number(l.Kg));
    if (!(kg > 0)) throw new ErrorEmpanizado(400, `${l.Lote} ${l.Clase}: los kilos deben ser mayores que cero`);
    const termo = l.Termo == null ? "" : String(l.Termo).trim();
    return { ...l, Kg: kg, Talla: Number(l.Talla), Lote: String(l.Lote), Clase: String(l.Clase),
             RemisionId: l.RemisionId == null || (l.RemisionId as any) === "" ? null : Number(l.RemisionId),
             FechaLote: l.FechaLote || null, Termo: termo || null };
  });

  // Contra un saldo que va bajando: la línea y, si se escogió, el termo (igual que Pelado).
  const saldo = await saldoPiso(tx, BODEGA_EMPANIZADO, [...new Set(lineas.map(l => l.Lote))]);
  const hay = new Map(saldo.map((s: any) => [s.Clave, s]));
  const usado = new Map<string, number>();
  for (const l of lineas) {
    const k = claveLinea(l);
    const s: any = hay.get(k);
    const queda = (s?.Kg ?? 0) - (usado.get(k) ?? 0);
    if (l.Kg > queda + 0.001) {
      throw new ErrorEmpanizado(400, `De ${l.Lote} ${l.Clase} solo quedan ${Math.max(queda, 0).toFixed(2)} kg al piso; está tomando ${l.Kg.toFixed(2)} kg.`);
    }
    usado.set(k, (usado.get(k) ?? 0) + l.Kg);
    if (l.Termo) {
      const kt = `${k}#${l.Termo}`;
      const t = (s?.TermosDetalle ?? []).find((x: any) => x.Termo === l.Termo);
      if (!t) throw new ErrorEmpanizado(400, `${l.Lote} ${l.Clase}: el termo ${l.Termo} ya no está al piso`);
      const quedaTermo = t.Kg - (usado.get(kt) ?? 0);
      if (l.Kg > quedaTermo + 0.001) {
        throw new ErrorEmpanizado(400, `Del termo ${l.Termo} (${l.Lote}) solo quedan ${Math.max(quedaTermo, 0).toFixed(2)} kg; está tomando ${l.Kg.toFixed(2)} kg.`);
      }
      usado.set(kt, (usado.get(kt) ?? 0) + l.Kg);
    }
  }

  // Un LoteEmpanizado por lote del día + clase + talla: lotes de origen distintos de la misma piscina
  // (llegaron otro día) caen juntos.
  const piscinas = await cargarPiscinas(tx);
  const grupos = new Map<string, { Lote: string; delDia: boolean; lineas: typeof lineas }>();
  for (const l of lineas) {
    const dia = loteDelDia(l.Lote, p.fecha, piscinas);
    const k = `${dia.lote}|${l.Clase}|${l.Talla}`;
    if (!grupos.has(k)) grupos.set(k, { Lote: dia.lote, delDia: dia.delDia, lineas: [] });
    grupos.get(k)!.lineas.push(l);
  }

  const lotes: { LoteEmpanizadoId: number; Lote: string; Clase: string; Talla: number; Kg: number; Nuevo: boolean }[] = [];
  for (const { Lote, delDia, lineas: g } of grupos.values()) {
    const { Clase, Talla } = g[0];
    // El lote del día es de hoy; si se quedó con el de origen, conserva la fecha de ese lote.
    const fechaLote = delDia ? p.fecha : g.map(x => x.FechaLote).filter(Boolean).sort()[0] ?? null;
    const [abierto]: any[] = await tx.$queryRawUnsafe(
      `SELECT LoteEmpanizadoId FROM LoteEmpanizado WHERE Lote = ? AND Clase = ? AND Talla = ? AND Estado = 'Abierto' FOR UPDATE`,
      Lote, Clase, Talla);
    let id: number, nuevo = false;
    if (abierto) id = Number(abierto.LoteEmpanizadoId);
    else {
      await tx.$executeRawUnsafe(
        `INSERT INTO LoteEmpanizado (Lote, Clase, Talla, FechaLote, Fecha, CreadoPor) VALUES (?, ?, ?, ?, ?, ?)`,
        Lote, Clase, Talla, fechaLote, p.fecha, p.operador);
      const [{ nid }]: any[] = await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS nid`);
      id = Number(nid); nuevo = true;
    }
    const filas: string[] = [], args: any[] = [];
    for (const l of g) {
      filas.push("('TOMA_EMPANIZADO', ?, ?, ?, ?, ?, ?, ?, 'KG', ?, ?, ?, ?, ?)");
      args.push(p.fecha, BODEGA_EMPANIZADO, l.Lote, l.Clase, l.Talla, l.FechaLote, l.Kg, l.Kg, l.RemisionId, l.Termo, id, p.operador);
    }
    await tx.$executeRawUnsafe(`
      INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaOrigen, Lote, Clase, Talla, FechaLote,
                                  Peso, UM, PesoKg, RemisionId, NumeroTermo, LoteEmpanizadoId, RegistradoPor)
      VALUES ${filas.join(",")}`, ...args);
    lotes.push({ LoteEmpanizadoId: id, Lote, Clase, Talla, Kg: r2(g.reduce((s, x) => s + x.Kg, 0)), Nuevo: nuevo });
  }
  return { ok: true, lotes };
}

// ── Números de un lote ──────────────────────────────────────────────────────────────────────────
const SQL_SUMAS = `
  ROUND(COALESCE((SELECT SUM(m.PesoKg) FROM MovimientoPiso m WHERE m.LoteEmpanizadoId = le.LoteEmpanizadoId AND m.Tipo = 'TOMA_EMPANIZADO'), 0), 2) AS Tomado,
  ROUND(COALESCE((SELECT SUM(m.PesoKg) FROM MovimientoPiso m WHERE m.LoteEmpanizadoId = le.LoteEmpanizadoId AND m.Tipo = 'BAJADO'), 0), 2) AS Bajado,
  ROUND(COALESCE((SELECT SUM(m.PesoKg) FROM MovimientoPiso m WHERE m.LoteEmpanizadoId = le.LoteEmpanizadoId AND m.Tipo = 'DESCARTE'), 0), 2) AS Descarte,
  ROUND(COALESCE((SELECT SUM(m.PesoKg) FROM MovimientoPiso m WHERE m.LoteEmpanizadoId = le.LoteEmpanizadoId AND m.Tipo = 'PROCESADO'), 0), 2) AS Trasladado,
  COALESCE((SELECT SUM(p.PesoNetoG) FROM Pesada p WHERE p.LoteEmpanizadoId = le.LoteEmpanizadoId AND p.Anulada = 0), 0) AS PesadoG,
  (SELECT COUNT(*) FROM Pesada p WHERE p.LoteEmpanizadoId = le.LoteEmpanizadoId AND p.Anulada = 0) AS Bandejas,
  (SELECT COUNT(DISTINCT p.PersonaCodigo) FROM Pesada p WHERE p.LoteEmpanizadoId = le.LoteEmpanizadoId AND p.Anulada = 0) AS Personas`;

const SQL_LOTE = `
  SELECT le.LoteEmpanizadoId, le.Lote, le.Clase, cl.Descripcion AS DescripcionClase, le.Talla, ta.Descripcion AS DescripcionTalla,
         DATE_FORMAT(le.FechaLote, '%Y-%m-%d') AS FechaLote, DATE_FORMAT(le.Fecha, '%Y-%m-%d') AS Fecha, le.Estado,
         le.CreadoPor, DATE_FORMAT(le.CreadoEn, '%Y-%m-%d %H:%i') AS CreadoEn,
         le.CerradoPor, DATE_FORMAT(le.CerradoEn, '%Y-%m-%d %H:%i') AS CerradoEn,
         ${SQL_SUMAS}
    FROM LoteEmpanizado le
    LEFT JOIN Clase cl ON cl.Clase = le.Clase
    LEFT JOIN Tallas ta ON ta.Codigo = le.Talla`;

function numerosLote(r: any) {
  const Tomado = Number(r.Tomado), Bajado = Number(r.Bajado), Descarte = Number(r.Descarte);
  const Pesado = kgDeG(r.PesadoG);
  const Trabajado = r2(Tomado - Bajado - Descarte);
  return {
    ...r, LoteEmpanizadoId: Number(r.LoteEmpanizadoId), Talla: Number(r.Talla),
    Tomado, Bajado, Descarte, Trasladado: Number(r.Trasladado), Pesado, Trabajado,
    Bandejas: Number(r.Bandejas), Personas: Number(r.Personas),
    // Sin nada trabajado no hay ganancia que medir (null, no 0 %).
    GananciaPct: Trabajado > 0 && Pesado > 0 ? r2((Pesado / Trabajado - 1) * 100) : null,
    PesadoG: undefined,
  };
}

export async function listarLotes(client: any, f: { estado: "Abierto" | "Cerrado"; desde?: string; hasta?: string }) {
  const rows: any[] = f.estado === "Abierto"
    ? await client.$queryRawUnsafe(`${SQL_LOTE} WHERE le.Estado = 'Abierto' ORDER BY le.Fecha, le.LoteEmpanizadoId`)
    : await client.$queryRawUnsafe(`${SQL_LOTE}
        WHERE le.Estado = 'Cerrado' AND le.CerradoEn >= ? AND le.CerradoEn < DATE_ADD(?, INTERVAL 1 DAY)
        ORDER BY le.CerradoEn DESC`, f.desde, f.hasta);
  const lotes = rows.map(numerosLote);
  const salidas = await salidasDe(client, lotes.map(l => l.LoteEmpanizadoId));
  return lotes.map(l => ({ ...l, Salidas: salidas.get(l.LoteEmpanizadoId) ?? [] }));
}

async function cargarLote(client: any, id: number, bloquear = false) {
  if (bloquear) await client.$queryRawUnsafe(`SELECT LoteEmpanizadoId FROM LoteEmpanizado WHERE LoteEmpanizadoId = ? FOR UPDATE`, id);
  const [r]: any[] = await client.$queryRawUnsafe(`${SQL_LOTE} WHERE le.LoteEmpanizadoId = ?`, id);
  if (!r) throw new ErrorEmpanizado(404, "Ese lote de Empanizado no existe");
  return numerosLote(r);
}

// Salidas = lo pesado agrupado por producto que sale, su TALLA, destino y pedido. En Empanizado
// Pesada.Talla es la talla del producto que sale (puede no ser la del lote, que vive en
// LoteEmpanizado.Talla); usuario, 23 nov 2026.
async function salidasDe(client: any, ids: number[]) {
  const out = new Map<number, any[]>();
  if (!ids.length) return out;
  const rows: any[] = await client.$queryRawUnsafe(`
    SELECT p.LoteEmpanizadoId, p.ClaseSalida, cl.Descripcion AS DescripcionClaseSalida, p.Talla, ta.Descripcion AS DescripcionTalla,
           p.Destino, p.CodigoPedido,
           c.RazonSocial AS Cliente, COUNT(*) AS Bandejas, COUNT(DISTINCT p.PersonaCodigo) AS Personas,
           SUM(p.PesoNetoG) AS PesoG
      FROM Pesada p
      LEFT JOIN Clase cl ON cl.Clase = p.ClaseSalida
      LEFT JOIN Tallas ta ON ta.Codigo = p.Talla
      LEFT JOIN Pedidos pe ON pe.CodigoPedido = p.CodigoPedido
      LEFT JOIN Clientes c ON c.Codigo = pe.CodigoCliente
     WHERE p.LoteEmpanizadoId IN (${enLista(ids)}) AND p.Anulada = 0
     GROUP BY p.LoteEmpanizadoId, p.ClaseSalida, cl.Descripcion, p.Talla, ta.Descripcion, p.Destino, p.CodigoPedido, c.RazonSocial
     ORDER BY p.ClaseSalida, p.Talla, p.Destino, p.CodigoPedido`, ...ids);
  for (const r of rows) {
    const id = Number(r.LoteEmpanizadoId);
    if (!out.has(id)) out.set(id, []);
    out.get(id)!.push({
      ClaseSalida: r.ClaseSalida, DescripcionClaseSalida: r.DescripcionClaseSalida,
      Talla: Number(r.Talla), DescripcionTalla: r.DescripcionTalla, Destino: r.Destino,
      CodigoPedido: r.CodigoPedido, Cliente: r.Cliente, Bandejas: Number(r.Bandejas), Personas: Number(r.Personas),
      Kg: kgDeG(r.PesoG),
    });
  }
  return out;
}

/** El lote con sus salidas, movimientos y lo pesado por persona. */
export async function detalleLote(client: any, id: number) {
  const lote = await cargarLote(client, id);
  const salidas = (await salidasDe(client, [id])).get(id) ?? [];
  const movimientos: any[] = await client.$queryRawUnsafe(`
    SELECT m.MovimientoId, m.Tipo, DATE_FORMAT(m.FechaHora, '%Y-%m-%d %H:%i') AS FechaHora, m.Lote, m.Clase, m.Talla,
           DATE_FORMAT(m.FechaLote, '%Y-%m-%d') AS FechaLote, m.PesoKg, m.Motivo, m.NumeroTermo, m.RegistradoPor, rm.Folio AS FolioRemision,
           COALESCE(m.BodegaOrigen, m.BodegaDestino) AS Bodega
      FROM MovimientoPiso m LEFT JOIN Remisiones rm ON rm.RemisionId = m.RemisionId
     WHERE m.LoteEmpanizadoId = ? ORDER BY m.MovimientoId`, id);
  const personas: any[] = await client.$queryRawUnsafe(`
    SELECT p.PersonaCodigo AS Codigo, CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido) AS Nombre,
           MAX(p.MesaCodigo) AS MesaCodigo, MAX(p.Posicion) AS Posicion, COUNT(*) AS Bandejas, SUM(p.PesoNetoG) AS PesoG,
           SUM(p.Resultado = 'BAJO') AS BajoPeso, SUM(p.Resultado = 'SOBRE') AS SobrePeso
      FROM Pesada p LEFT JOIN Empleados e ON e.Codigo = p.PersonaCodigo
     WHERE p.LoteEmpanizadoId = ? AND p.Anulada = 0
     GROUP BY p.PersonaCodigo, e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido
     ORDER BY PesoG DESC`, id);
  return {
    ...lote, Salidas: salidas,
    Movimientos: movimientos.map(m => ({ ...m, MovimientoId: Number(m.MovimientoId), Talla: Number(m.Talla), PesoKg: Number(m.PesoKg) })),
    PorPersona: personas.map(p => ({ ...p, Posicion: p.Posicion == null ? null : Number(p.Posicion), Bandejas: Number(p.Bandejas), Kg: kgDeG(p.PesoG), PesoG: undefined, BajoPeso: Number(p.BajoPeso ?? 0), SobrePeso: Number(p.SobrePeso ?? 0) })),
  };
}

// ── Bajar al piso y descarte ────────────────────────────────────────────────────────────────────
function exigirAbierto(l: { Estado: string; Lote: string }) {
  if (l.Estado !== "Abierto") throw new ErrorEmpanizado(400, `El lote ${l.Lote} ya está cerrado: reábralo para cambiarlo`);
}

// Lo bajado y lo descartado no pueden pasar de lo que se tomó. Lo pesado NO cuenta como techo: con
// la harina pesa más que la materia prima que se usó.
function validarAjuste(l: any, kg: number, que: string) {
  if (!(kg > 0)) throw new ErrorEmpanizado(400, "Los kilos deben ser mayores que cero");
  const queda = r2(l.Tomado - l.Bajado - l.Descarte);
  if (kg > queda + 0.001) throw new ErrorEmpanizado(400, `Del lote ${l.Lote} solo quedan ${Math.max(queda, 0).toFixed(2)} kg tomados; no se pueden ${que} ${kg.toFixed(2)} kg.`);
}

/**
 * Lo que no se trabajó regresa al piso de EMPANIZADO con sus kilos, su talla y el termo en que queda
 * (usuario, 23 nov 2026, como en Pelado). Sale en "Al piso" como bajado, con su termo, y se vuelve a
 * tomar otro día.
 */
export async function bajarAlPiso(tx: any, id: number, a: {
  kg: number; talla?: number | null; termo?: string | null; motivo?: string | null; fecha: string; operador: string;
}) {
  const l = await cargarLote(tx, id, true);
  exigirAbierto(l);
  const kg = r2(Number(a.kg));
  validarAjuste(l, kg, "bajar");
  const termo = String(a.termo ?? "").trim();
  if (!termo) throw new ErrorEmpanizado(400, "Falta el número de termo en que queda al piso");
  if (termo.length > 20) throw new ErrorEmpanizado(400, "El número de termo es demasiado largo");
  const talla = Number(a.talla) || l.Talla;
  const [t]: any[] = await tx.$queryRawUnsafe(`SELECT Codigo FROM Tallas WHERE Codigo = ?`, talla);
  if (!t) throw new ErrorEmpanizado(400, "Elija la talla");
  await tx.$executeRawUnsafe(`
    INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaDestino, Lote, Clase, Talla, FechaLote,
                                Peso, UM, PesoKg, Motivo, NumeroTermo, LoteEmpanizadoId, RegistradoPor)
    VALUES ('BAJADO', ?, ?, ?, ?, ?, ?, ?, 'KG', ?, ?, ?, ?, ?)`,
    a.fecha, BODEGA_EMPANIZADO, l.Lote, l.Clase, talla, l.FechaLote, kg, kg,
    String(a.motivo ?? "").trim().slice(0, 200) || "Sobrante", termo, id, a.operador);
  return { ok: true };
}

export async function registrarDescarte(tx: any, id: number, a: { kg: number; motivo?: string | null; fecha: string; operador: string }) {
  const l = await cargarLote(tx, id, true);
  exigirAbierto(l);
  const kg = r2(Number(a.kg));
  validarAjuste(l, kg, "descartar");
  const motivo = String(a.motivo ?? "").trim().slice(0, 200);
  if (!motivo) throw new ErrorEmpanizado(400, "Escriba el motivo del descarte");
  await tx.$executeRawUnsafe(`
    INSERT INTO MovimientoPiso (Tipo, FechaProduccion, Lote, Clase, Talla, FechaLote,
                                Peso, UM, PesoKg, Motivo, LoteEmpanizadoId, RegistradoPor)
    VALUES ('DESCARTE', ?, ?, ?, ?, ?, ?, 'KG', ?, ?, ?, ?)`,
    a.fecha, l.Lote, l.Clase, l.Talla, l.FechaLote, kg, kg, motivo, id, a.operador);
  return { ok: true };
}

// Lo que se mandó a un piso tiene que seguir ahí para poder deshacerlo: si ya lo tomó otro, borrarlo
// dejaría ese saldo en negativo. `kg` es cuánto de esa llave se quiere quitar.
async function sigueAlPiso(tx: any, bodega: string, llave: any, kg: number) {
  const s = (await saldoPiso(tx, bodega, [String(llave.Lote)])).find(x => x.Clave === claveLinea(llave));
  return (s?.Kg ?? 0) >= kg - 0.001;
}

/**
 * Deshace una toma, un bajado o un descarte de un lote abierto.
 *   toma     → vuelve al piso. Si el lote se queda sin tomas, sin nada más y sin pesadas, desaparece.
 *   bajado   → solo mientras siga al piso (nadie lo volvió a tomar).
 *   descarte → siempre.
 */
export async function deshacerMovimiento(tx: any, movimientoId: number) {
  const [m]: any[] = await tx.$queryRawUnsafe(`
    SELECT MovimientoId, Tipo, RemisionId, Lote, Clase, Talla, DATE_FORMAT(FechaLote, '%Y-%m-%d') AS FechaLote,
           PesoKg, LoteEmpanizadoId FROM MovimientoPiso WHERE MovimientoId = ? FOR UPDATE`, movimientoId);
  if (!m || m.LoteEmpanizadoId == null || !["TOMA_EMPANIZADO", "BAJADO", "DESCARTE"].includes(String(m.Tipo))) {
    throw new ErrorEmpanizado(404, "Ese movimiento no existe o no es de Empanizado");
  }
  const id = Number(m.LoteEmpanizadoId);
  const l = await cargarLote(tx, id, true);
  exigirAbierto(l);
  const kg = Number(m.PesoKg);

  if (m.Tipo === "TOMA_EMPANIZADO") {
    const tomado = r2(l.Tomado - kg);
    if (tomado < l.Bajado + l.Descarte - 0.001) {
      throw new ErrorEmpanizado(400, `No se puede devolver: el lote quedaría con ${tomado.toFixed(2)} kg tomados y ya tiene ${(l.Bajado + l.Descarte).toFixed(2)} kg bajados o descartados. Deshaga eso primero.`);
    }
    if (tomado <= 0.001 && l.Bandejas > 0) {
      throw new ErrorEmpanizado(400, `El lote ya tiene ${l.Bandejas} bandejas pesadas: no se puede devolver todo lo tomado.`);
    }
    await tx.$executeRawUnsafe(`DELETE FROM MovimientoPiso WHERE MovimientoId = ?`, movimientoId);
    const [q]: any[] = await tx.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM MovimientoPiso WHERE LoteEmpanizadoId = ?`, id);
    const [pz]: any[] = await tx.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM Pesada WHERE LoteEmpanizadoId = ?`, id);
    if (Number(q.n) === 0 && Number(pz.n) === 0) {
      await tx.$executeRawUnsafe(`DELETE FROM LoteEmpanizado WHERE LoteEmpanizadoId = ?`, id);
      return { ok: true, LoteBorrado: true };
    }
    return { ok: true, LoteBorrado: false };
  }
  if (m.Tipo === "BAJADO" && !(await sigueAlPiso(tx, BODEGA_EMPANIZADO, m, kg))) {
    throw new ErrorEmpanizado(400, "Lo bajado ya se volvió a tomar del piso: deshaga primero esa toma.");
  }
  await tx.$executeRawUnsafe(`DELETE FROM MovimientoPiso WHERE MovimientoId = ?`, movimientoId);
  return { ok: true };
}

// ── Cerrar y reabrir ────────────────────────────────────────────────────────────────────────────
/**
 * Cierra el lote: lo pesado pasa al piso de Túnel, un renglón por producto que sale, talla y destino
 * (exportación / venta local), con el mismo código de lote y la clase del producto. Desde ese
 * momento la báscula ya no acepta bandejas para este lote.
 */
export async function cerrarLote(tx: any, id: number, fecha: string, operador: string) {
  const l = await cargarLote(tx, id, true);
  if (l.Estado === "Cerrado") return { ok: true, YaCerrado: true, Trasladado: [] as any[] };
  if (!(l.Pesado > 0)) {
    throw new ErrorEmpanizado(400, `El lote ${l.Lote} no tiene bandejas pesadas. Si no se va a trabajar, devuelva lo tomado al piso.`);
  }
  const [tunel]: any[] = await tx.$queryRawUnsafe(
    `SELECT Codigo, Nombre FROM BodegaVirtual WHERE Codigo = ? AND Activo = 1 AND LlevaPiso = 1`, DESTINO_CIERRE);
  if (!tunel) throw new ErrorEmpanizado(400, "La bodega Túnel no está activa: no hay a dónde trasladar");

  const grupos: any[] = await tx.$queryRawUnsafe(`
    SELECT ClaseSalida, Talla, Destino, SUM(PesoNetoG) AS PesoG, COUNT(*) AS Bandejas
      FROM Pesada WHERE LoteEmpanizadoId = ? AND Anulada = 0
     GROUP BY ClaseSalida, Talla, Destino ORDER BY ClaseSalida, Talla, Destino`, id);
  const trasladado: { Clase: string; Talla: number; Destino: string; Kg: number; Bandejas: number }[] = [];
  for (const g of grupos) {
    const kg = r2(Number(g.PesoG) / 1000);
    if (!(kg > 0)) continue;
    const destino = String(g.Destino ?? "");
    await tx.$executeRawUnsafe(`
      INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaDestino, Lote, Clase, Talla, FechaLote,
                                  Peso, UM, PesoKg, Motivo, LoteEmpanizadoId, RegistradoPor)
      VALUES ('PROCESADO', ?, ?, ?, ?, ?, ?, ?, 'KG', ?, ?, ?, ?)`,
      fecha, DESTINO_CIERRE, l.Lote, g.ClaseSalida, Number(g.Talla), l.FechaLote, kg, kg,
      `Empanizado · ${DESTINOS_PESADA[destino] ?? destino} · ${Number(g.Bandejas)} bandejas`, id, operador);
    trasladado.push({ Clase: String(g.ClaseSalida), Talla: Number(g.Talla), Destino: destino, Kg: kg, Bandejas: Number(g.Bandejas) });
  }
  await tx.$executeRawUnsafe(
    `UPDATE LoteEmpanizado SET Estado = 'Cerrado', CerradoPor = ?, CerradoEn = NOW() WHERE LoteEmpanizadoId = ?`, operador, id);
  return { ok: true, Destino: String(tunel.Nombre), Trasladado: trasladado };
}

/** Reabre el lote y saca de Túnel lo que se trasladó al cerrarlo, mientras Túnel no lo haya usado. */
export async function reabrirLote(tx: any, id: number) {
  const l = await cargarLote(tx, id, true);
  if (l.Estado === "Abierto") return { ok: true, YaAbierto: true };
  const movs: any[] = await tx.$queryRawUnsafe(`
    SELECT MovimientoId, BodegaDestino, RemisionId, Lote, Clase, Talla, DATE_FORMAT(FechaLote, '%Y-%m-%d') AS FechaLote, PesoKg
      FROM MovimientoPiso WHERE LoteEmpanizadoId = ? AND Tipo = 'PROCESADO' FOR UPDATE`, id);
  // Exportación y venta local del mismo producto caen en la misma línea del piso: se suman.
  const porLinea = new Map<string, { m: any; kg: number }>();
  for (const m of movs) {
    const k = `${m.BodegaDestino}#${claveLinea(m)}`;
    const x = porLinea.get(k) ?? { m, kg: 0 };
    x.kg += Number(m.PesoKg);
    porLinea.set(k, x);
  }
  for (const { m, kg } of porLinea.values()) {
    if (!(await sigueAlPiso(tx, String(m.BodegaDestino), m, kg))) {
      throw new ErrorEmpanizado(400, `Túnel ya usó ${m.Lote} ${m.Clase}: no se puede reabrir el lote.`);
    }
  }
  try {
    await tx.$executeRawUnsafe(
      `UPDATE LoteEmpanizado SET Estado = 'Abierto', CerradoPor = NULL, CerradoEn = NULL WHERE LoteEmpanizadoId = ?`, id);
  } catch (err: any) {
    if (String(err.message).includes("Duplicate")) {
      throw new ErrorEmpanizado(400, `Ya hay otro lote abierto de ${l.Lote} ${l.Clase} talla ${l.Talla}: ciérrelo antes de reabrir este.`);
    }
    throw err;
  }
  await tx.$executeRawUnsafe(`DELETE FROM MovimientoPiso WHERE LoteEmpanizadoId = ? AND Tipo = 'PROCESADO'`, id);
  return { ok: true, Deshecho: movs.length };
}

// ── Posición de una persona ─────────────────────────────────────────────────────────────────────
/** Mesa/banda y posición vigentes de la persona en una fecha (null si no tiene). */
export async function posicionDe(client: any, codigo: string, fecha: string) {
  const [r]: any[] = await client.$queryRawUnsafe(`
    SELECT pe.MesaCodigo, me.Nombre AS MesaNombre, me.Tipo AS MesaTipo, pe.Posicion
      FROM PosicionEmpanizado pe JOIN MesasEmpanizado me ON me.Codigo = pe.MesaCodigo
     WHERE pe.Codigo = ? AND pe.FechaInicio <= ? AND (pe.FechaFin IS NULL OR pe.FechaFin >= ?)
     ORDER BY pe.FechaInicio DESC LIMIT 1`, codigo, fecha, fecha);
  return r ? { MesaCodigo: String(r.MesaCodigo), MesaNombre: String(r.MesaNombre), MesaTipo: String(r.MesaTipo), Posicion: Number(r.Posicion) } : null;
}

// ── Reporte de producción ───────────────────────────────────────────────────────────────────────
/**
 * Lo pesado en Empanizado entre dos fechas, por día, persona, lote, producto y destino. Solo
 * bandejas no anuladas. La pantalla arma de aquí los totales por persona y por lote. Es la base del
 * pago de Empanizado, aparte del de Pelado.
 */
// Lo que necesita calcularLbHora (frontend/src/utils/destajo.js, el MISMO cálculo de Lb/Hora que destajo)
// para la Lb/hora de Empanizado (usuario, 26 nov 2026): cada bandeja con su hora y peso, las entradas a
// área de esas personas (ancla del primer bloque del día) y sus pausas en áreas que no generan paga.
// En arreglos compactos [código, hora, …] porque un rango largo son decenas de miles de bandejas.
// Las horas van como texto de Guatemala ('YYYY-MM-DDTHH:MM:SS', sin Z) para no correrlas 6 h.
export async function tiemposProduccion(client: any, desde: string, hasta: string) {
  const F = `'%Y-%m-%dT%H:%i:%s'`;
  const personas = `SELECT DISTINCT PersonaCodigo FROM Pesada
                     WHERE Modo = 'EMPANIZADO' AND Anulada = 0 AND PersonaCodigo IS NOT NULL AND FechaProduccion BETWEEN ? AND ?`;
  const [bandejas, entradas, pausas]: any[][] = await Promise.all([
    client.$queryRawUnsafe(`
      SELECT PersonaCodigo AS c, DATE_FORMAT(CreadoEn, ${F}) AS t, PesoNetoG AS g, Destino AS d FROM Pesada
       WHERE Modo = 'EMPANIZADO' AND Anulada = 0 AND PersonaCodigo IS NOT NULL AND FechaProduccion BETWEEN ? AND ?`, desde, hasta),
    client.$queryRawUnsafe(`
      SELECT tr.Codigo AS c, DATE_FORMAT(tr.FechaHora, ${F}) AS i, DATE_FORMAT(tr.FechaSalida, ${F}) AS s FROM Transferencias tr
       WHERE tr.Codigo IN (${personas}) AND tr.FechaHora < DATE_ADD(?, INTERVAL 1 DAY)
         AND (tr.FechaSalida IS NULL OR tr.FechaSalida >= ?)`, desde, hasta, hasta, desde),
    client.$queryRawUnsafe(`
      SELECT tr.Codigo AS c, DATE_FORMAT(tr.FechaHora, ${F}) AS i, DATE_FORMAT(tr.FechaSalida, ${F}) AS s FROM Transferencias tr
        JOIN Areas a ON a.Codigo = tr.CodigoArea AND a.GeneraPaga = 0
       WHERE tr.Codigo IN (${personas}) AND tr.FechaHora < DATE_ADD(?, INTERVAL 1 DAY)
         AND (tr.FechaSalida IS NULL OR tr.FechaSalida >= ?)`, desde, hasta, hasta, desde),
  ]);
  return {
    // 4.º elemento = destino (EXPORTACION / LOCAL): la pantalla separa Red Lobster de venta local (27 nov 2026).
    bandejas: bandejas.map(b => [b.c, b.t, Number(b.g), b.d]),
    entradas: entradas.map(e => [e.c, e.i, e.s]),
    pausas: pausas.map(e => [e.c, e.i, e.s]),
  };
}

/**
 * Ritmo del DÍA ANTERIOR para comparar en la gráfica (usuario, 27 nov 2026): el último día con bandejas
 * de Empanizado antes de `fecha` (el lunes se compara con el sábado), por destino y hora del reloj.
 * Ya agregado en el servidor: [destino, hora, gramos, personas, bandejas] (unas 20 filas).
 */
export async function ritmoAnterior(client: any, fecha: string) {
  // Busca hacia atrás hasta 14 días (índice FechaProduccion+BalanzaCodigo).
  const [u]: any[] = await client.$queryRawUnsafe(`
    SELECT DATE_FORMAT(MAX(FechaProduccion), '%Y-%m-%d') AS f FROM Pesada
     WHERE Modo = 'EMPANIZADO' AND Anulada = 0 AND FechaProduccion < ? AND FechaProduccion >= DATE_SUB(?, INTERVAL 14 DAY)`, fecha, fecha);
  if (!u?.f) return null;
  const rows: any[] = await client.$queryRawUnsafe(`
    SELECT COALESCE(Destino, 'EXPORTACION') AS d, HOUR(CreadoEn) AS h, SUM(PesoNetoG) AS g,
           COUNT(DISTINCT PersonaCodigo) AS p, COUNT(*) AS b
      FROM Pesada WHERE Modo = 'EMPANIZADO' AND Anulada = 0 AND PersonaCodigo IS NOT NULL AND FechaProduccion = ?
     GROUP BY d, h`, u.f);
  return { fecha: u.f, horas: rows.map(r => [r.d, Number(r.h), Number(r.g), Number(r.p), Number(r.b)]) };
}

export async function reporteProduccion(client: any, desde: string, hasta: string) {
  const rows: any[] = await client.$queryRawUnsafe(`
    SELECT DATE_FORMAT(p.FechaProduccion, '%Y-%m-%d') AS Fecha, p.PersonaCodigo AS Codigo,
           CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido) AS Nombre,
           p.MesaCodigo, me.Nombre AS MesaNombre, p.Posicion, p.LoteEmpanizadoId, p.Lote, p.Talla, ta.Descripcion AS DescripcionTalla,
           p.ClaseSalida, cl.Descripcion AS DescripcionClaseSalida, p.Destino, p.CodigoPedido,
           COUNT(*) AS Bandejas, SUM(p.PesoNetoG) AS PesoG,
           SUM(p.Resultado = 'BAJO') AS BajoPeso, SUM(p.Resultado = 'SOBRE') AS SobrePeso, MAX(p.UnidadesRef) AS UnidadesRef,
           DATE_FORMAT(MIN(p.CreadoEn), '%H:%i') AS Primera, DATE_FORMAT(MAX(p.CreadoEn), '%H:%i') AS Ultima
      FROM Pesada p
      LEFT JOIN Empleados e ON e.Codigo = p.PersonaCodigo
      LEFT JOIN MesasEmpanizado me ON me.Codigo = p.MesaCodigo
      LEFT JOIN Clase cl ON cl.Clase = p.ClaseSalida
      LEFT JOIN Tallas ta ON ta.Codigo = p.Talla
     WHERE p.Modo = 'EMPANIZADO' AND p.Anulada = 0 AND p.FechaProduccion BETWEEN ? AND ?
     GROUP BY Fecha, p.PersonaCodigo, e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido,
              p.MesaCodigo, me.Nombre, p.Posicion, p.LoteEmpanizadoId, p.Lote, p.Talla, ta.Descripcion,
              p.ClaseSalida, cl.Descripcion, p.Destino, p.CodigoPedido
     ORDER BY Fecha, p.MesaCodigo IS NULL, p.MesaCodigo, p.Posicion, Nombre`, desde, hasta);
  return rows.map(r => ({
    ...r, Posicion: r.Posicion == null ? null : Number(r.Posicion), Talla: Number(r.Talla),
    LoteEmpanizadoId: r.LoteEmpanizadoId == null ? null : Number(r.LoteEmpanizadoId),
    Bandejas: Number(r.Bandejas), Kg: kgDeG(r.PesoG), PesoG: undefined,
    BajoPeso: Number(r.BajoPeso ?? 0), SobrePeso: Number(r.SobrePeso ?? 0), UnidadesRef: r.UnidadesRef == null ? null : Number(r.UnidadesRef),
  }));
}
