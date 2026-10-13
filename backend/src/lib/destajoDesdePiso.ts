// Puente entre Descongelado y Destajo.
//
// Cuando Descongelado despacha a Pelado/Descabezado, el producto entra solo a Materia Prima: nadie
// en Pelado vuelve a crear el lote ni a teclear el peso. Antes se hacía a mano y salían dos pesos para
// el mismo camarón —  el de báscula de Descongelado y uno tecleado (3,500 kg que luego eran 6,000).
//
// EL LOTE DE DESTAJO ES EL DEL DÍA EN QUE SE PROCESA, no el de origen: G629Q005 (producido en julio)
// se procesa hoy como G240Q005, que es como la planta ya trabajaba y el código que sigue a Etiquetado.
// Lo que antes se perdía es de dónde venía; ahora cada TRASLADO guarda en LoteProceso/ClaseProceso el
// lote de Destajo que alimentó, así que desde G240Q005 se llega a G629Q005 y a su remisión.
//
// Varios lotes de origen de la misma piscina, ciclo y clase en el mismo día caen en UN lote de
// Destajo que va sumando: el código no los distingue (lleva la fecha de hoy, no la de origen).
//
// El peso de ingreso de un lote del piso es la suma de sus TRASLADO y no se teclea. Para corregirlo,
// Descongelado borra o recaptura su renglón, y eso pasa por quitarDeDestajo.
//
// Vive acá y no dentro de una ruta porque lo usan dos: descongelar (automático) y "Por asignar" en
// Materia Prima (cuando el código del lote no se pudo leer). Dos copias de este cálculo terminarían
// dando dos lotes distintos para el mismo despacho.
import { componerCodigoLote, descomponerCodigoLote, piscinaRequiereCiclo } from "./codigoLote.ts";

// Bodegas virtuales cuyo producto se trabaja a destajo. Pelado (DS, DT) y Descabezado (DU) comparten
// el piso físico, por eso es una sola.
export const BODEGAS_CON_DESTAJO = ["PELADO_DESCABEZADO"];

// Mismo factor que utils/destajo.js: un lote manual pudo haberse capturado en libras.
const LB_POR_KG = 2.20462;

type Piscina = { PiscinaId: number; Nombre: string; CodigoFinca: string };

export type LoteAlimentado = { Lote: string; Clase: string; Kg: number; MovimientoIds: number[] };

const enLista = (ids: number[]) => ids.map(() => "?").join(",");

/**
 * Suma a un lote de Destajo (creándolo si hace falta) los TRASLADO dados, todos de la misma piscina,
 * ciclo y clase. Devuelve el lote que quedó alimentado.
 */
async function asignarALote(
  tx: any, piscina: Piscina, ciclo: number | null, anioOrigen: number, clase: string,
  fecha: string, movs: { MovimientoId: number; PesoKg: number; Talla: number }[], operador: string
): Promise<LoteAlimentado> {
  const conCiclo = piscinaRequiereCiclo(piscina.Nombre, piscina.CodigoFinca) ? ciclo : null;
  const lote = componerCodigoLote(piscina.Nombre, fecha, conCiclo ? String(conCiclo) : "");

  let cicloId: number | null = null;
  if (conCiclo) {
    // El año del ciclo es el del lote de ORIGEN (su letra), no el de hoy: el ciclo es la siembra
    // de la que salió el camarón, y un lote de diciembre procesado en enero sigue siendo de ella.
    await tx.$executeRawUnsafe(
      `INSERT IGNORE INTO Ciclo (PiscinaId, Anio, Ciclo) VALUES (?, ?, ?)`, piscina.PiscinaId, anioOrigen, conCiclo);
    const [c]: any[] = await tx.$queryRawUnsafe(
      `SELECT CicloId FROM Ciclo WHERE PiscinaId = ? AND Anio = ? AND Ciclo = ? LIMIT 1`,
      piscina.PiscinaId, anioOrigen, conCiclo);
    cicloId = c?.CicloId ? Number(c.CicloId) : null;
  }

  const kg = Number(movs.reduce((s, m) => s + m.PesoKg, 0).toFixed(2));
  // La talla de referencia solo se pone si todo lo que entra es de la misma: con dos tallas no hay
  // una que represente al lote.
  const tallas = [...new Set(movs.map(m => m.Talla).filter(t => t && t !== 900))];
  const tallaRef = tallas.length === 1 ? tallas[0] : null;

  // ON DUPLICATE: el mismo lote del día ya existe (otra tanda, o uno manual). Se suma en SU unidad
  // —  un lote manual en libras recibe libras—  y un MANUAL pasa a MIXTO para que se revise: ahí el
  // peso ya no es solo el de báscula.
  await tx.$executeRawUnsafe(`
    INSERT INTO Lotes (Lote, CicloId, PiscinaId, Clase, TallaReferencia, Fecha, FechaProduccion,
                       PesoIngreso, UM, RegistradoPor, Origen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'KG', ?, 'PISO')
    ON DUPLICATE KEY UPDATE
      PesoIngreso = ROUND(PesoIngreso + IF(UM = 'LB', VALUES(PesoIngreso) * ${LB_POR_KG}, VALUES(PesoIngreso)), 2),
      Origen = IF(Origen = 'MANUAL', 'MIXTO', Origen),
      Activo = 1`,
    lote, cicloId, piscina.PiscinaId, clase, tallaRef, fecha, fecha, kg, operador);

  const ids = movs.map(m => m.MovimientoId);
  await tx.$executeRawUnsafe(
    `UPDATE MovimientoPiso SET LoteProceso = ?, ClaseProceso = ?, DestajoPendiente = NULL
      WHERE MovimientoId IN (${enLista(ids)})`, lote, clase, ...ids);

  return { Lote: lote, Clase: clase, Kg: kg, MovimientoIds: ids };
}

/**
 * Lleva a Destajo los TRASLADO recién escritos. Se llama DENTRO de la transacción que descongela:
 * el lote aparece en Materia Prima en el mismo instante en que el producto sale de la hoja, o no
 * aparece si el descongelado falla.
 *
 * Lo que no va a una bodega con destajo se ignora. Un código de lote que no se puede leer NO hace
 * fallar el descongelado —  el producto ya se movió—: queda marcado DestajoPendiente y el encargado
 * de Pelado escoge la piscina en "Por asignar".
 */
export async function alimentarDestajo(
  tx: any, trasladoIds: number[], fecha: string, operador: string
): Promise<{ lotes: LoteAlimentado[]; porAsignar: number[] }> {
  if (!trasladoIds.length) return { lotes: [], porAsignar: [] };
  const movs: any[] = await tx.$queryRawUnsafe(`
    SELECT MovimientoId, Lote, Clase, Talla, PesoKg FROM MovimientoPiso
     WHERE MovimientoId IN (${enLista(trasladoIds)}) AND Tipo = 'TRASLADO' AND LoteProceso IS NULL
       AND BodegaDestino IN (${enLista(BODEGAS_CON_DESTAJO)})`, ...trasladoIds, ...BODEGAS_CON_DESTAJO);
  if (!movs.length) return { lotes: [], porAsignar: [] };

  const piscinas: Piscina[] = (await tx.$queryRawUnsafe(
    `SELECT PiscinaId, Nombre, CodigoFinca FROM Piscina`) as any[])
    .map(p => ({ PiscinaId: Number(p.PiscinaId), Nombre: String(p.Nombre), CodigoFinca: String(p.CodigoFinca) }));

  const grupos = new Map<string, { piscina: Piscina; ciclo: number | null; anio: number; clase: string; movs: any[] }>();
  const porAsignar: number[] = [];
  for (const m of movs) {
    const d = descomponerCodigoLote(String(m.Lote), piscinas);
    // Una piscina de cultivo sin ciclo en el código no se puede adivinar: el ciclo es lo que separa
    // sus lotes. Va a Por asignar igual que un código ilegible.
    if (!d || (piscinaRequiereCiclo(d.piscina.Nombre, d.piscina.CodigoFinca) && !d.ciclo)) {
      porAsignar.push(Number(m.MovimientoId));
      continue;
    }
    const anio = 2020 + (String(m.Lote).toUpperCase().charCodeAt(0) - 65);
    const k = `${d.piscina.PiscinaId}|${d.ciclo ?? ""}|${anio}|${m.Clase}`;
    if (!grupos.has(k)) grupos.set(k, { piscina: d.piscina, ciclo: d.ciclo, anio, clase: String(m.Clase), movs: [] });
    grupos.get(k)!.movs.push({ MovimientoId: Number(m.MovimientoId), PesoKg: Number(m.PesoKg), Talla: Number(m.Talla) });
  }

  const lotes: LoteAlimentado[] = [];
  for (const g of grupos.values()) {
    lotes.push(await asignarALote(tx, g.piscina, g.ciclo, g.anio, g.clase, fecha, g.movs, operador));
  }
  if (porAsignar.length) {
    await tx.$executeRawUnsafe(
      `UPDATE MovimientoPiso SET DestajoPendiente = 1 WHERE MovimientoId IN (${enLista(porAsignar)})`, ...porAsignar);
  }
  return { lotes, porAsignar };
}

/**
 * "Por asignar": el encargado escoge la piscina (y el ciclo) de un TRASLADO cuyo código no se leyó.
 * Usa la fecha del propio movimiento —  la de la hoja de Descongelado— , no la de hoy, para que el lote
 * caiga en el mismo día en que llegó.
 */
export async function asignarPendiente(
  tx: any, movimientoId: number, piscinaId: number, cicloNumero: number | null, operador: string
): Promise<LoteAlimentado | { error: string }> {
  const [m]: any[] = await tx.$queryRawUnsafe(`
    SELECT MovimientoId, Lote, Clase, Talla, PesoKg, DATE_FORMAT(FechaProduccion, '%Y-%m-%d') AS Fecha,
           YEAR(COALESCE(FechaLote, FechaProduccion)) AS Anio
      FROM MovimientoPiso
     WHERE MovimientoId = ? AND Tipo = 'TRASLADO' AND DestajoPendiente = 1 AND LoteProceso IS NULL
     FOR UPDATE`, movimientoId);
  if (!m) return { error: "Ese renglón ya no está pendiente — recargue la pantalla" };
  const [p]: any[] = await tx.$queryRawUnsafe(
    `SELECT PiscinaId, Nombre, CodigoFinca FROM Piscina WHERE PiscinaId = ?`, piscinaId);
  if (!p) return { error: "Piscina no encontrada" };
  const piscina: Piscina = { PiscinaId: Number(p.PiscinaId), Nombre: String(p.Nombre), CodigoFinca: String(p.CodigoFinca) };
  if (piscinaRequiereCiclo(piscina.Nombre, piscina.CodigoFinca) && !cicloNumero) {
    return { error: `La piscina ${piscina.Nombre} lleva ciclo: indíquelo` };
  }
  return asignarALote(tx, piscina, cicloNumero, Number(m.Anio), String(m.Clase), String(m.Fecha),
    [{ MovimientoId: Number(m.MovimientoId), PesoKg: Number(m.PesoKg), Talla: Number(m.Talla) }], operador);
}

/**
 * Deshace lo que un TRASLADO le sumó a su lote de Destajo, antes de borrarlo en Descongelado.
 * Devuelve un error (no lanza) si el lote ya tiene pesado más de lo que le quedaría: borrar el
 * renglón dejaría Pendiente negativo y bloquearía el pesaje, la misma regla del PUT de lotes.
 *
 * Si el lote nació del piso y se queda sin peso ni transacciones, se borra: es un lote que nunca
 * existió. Un MIXTO que se queda sin nada del piso vuelve a MANUAL.
 */
export async function quitarDeDestajo(tx: any, movimientoId: number): Promise<{ error?: string }> {
  const [m]: any[] = await tx.$queryRawUnsafe(
    `SELECT LoteProceso, ClaseProceso, PesoKg FROM MovimientoPiso WHERE MovimientoId = ?`, movimientoId);
  if (!m?.LoteProceso) return {};
  const lote = String(m.LoteProceso), clase = String(m.ClaseProceso);

  const [l]: any[] = await tx.$queryRawUnsafe(`
    SELECT PesoIngreso, UM, Origen,
           (SELECT COALESCE(SUM(pd.Peso), 0) FROM PesajeDetalle pd
              JOIN TransaccionesProduccion tp ON tp.TransaccionId = pd.TransaccionId
             WHERE tp.Lote = l.Lote AND tp.ClaseOrigen = l.Clase) AS Procesado,
           (SELECT COUNT(*) FROM TransaccionesProduccion tp WHERE tp.Lote = l.Lote AND tp.ClaseOrigen = l.Clase) AS Trans
      FROM Lotes l WHERE l.Lote = ? AND l.Clase = ? FOR UPDATE`, lote, clase);
  if (!l) return {};

  const resta = String(l.UM) === "LB" ? Number(m.PesoKg) * LB_POR_KG : Number(m.PesoKg);
  const nuevo = Number((Number(l.PesoIngreso) - resta).toFixed(2));
  if (nuevo < Number(l.Procesado) - 0.001) {
    return { error: `El lote ${lote} ${clase} de Destajo ya tiene ${Number(l.Procesado).toFixed(2)} pesado; ` +
                    `quitarle este renglón lo dejaría con ${Math.max(nuevo, 0).toFixed(2)} de ingreso. ` +
                    `Corrija primero el pesaje en Destajo.` };
  }

  await tx.$executeRawUnsafe(
    `UPDATE MovimientoPiso SET LoteProceso = NULL, ClaseProceso = NULL WHERE MovimientoId = ?`, movimientoId);
  const [q]: any[] = await tx.$queryRawUnsafe(
    `SELECT COUNT(*) AS n FROM MovimientoPiso WHERE LoteProceso = ? AND ClaseProceso = ?`, lote, clase);
  const quedanDelPiso = Number(q.n);

  if (String(l.Origen) === "PISO" && quedanDelPiso === 0 && Number(l.Trans) === 0) {
    await tx.$executeRawUnsafe(`DELETE FROM Lotes WHERE Lote = ? AND Clase = ?`, lote, clase);
    return {};
  }
  await tx.$executeRawUnsafe(
    `UPDATE Lotes SET PesoIngreso = ?, Origen = IF(Origen = 'MIXTO' AND ? = 0, 'MANUAL', Origen)
      WHERE Lote = ? AND Clase = ?`, Math.max(nuevo, 0), quedanDelPiso, lote, clase);
  return {};
}
