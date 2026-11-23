// Personal de Empanizado en mesas y bandas con POSICIÓN FIJA (el número impreso en la mesa). Mismas
// reglas que las mesas de Pelado (lib/mesaAsignacion.ts), en tablas propias (PosicionEmpanizado,
// MesasEmpanizado) para no tocar a Pelado:
//   - Días completos ("YYYY-MM-DD"): mover a alguien el día D cierra su posición anterior el D−1 y la
//     nueva cuenta desde D. Así una pesada de la semana pasada sigue diciendo dónde estaba ESE día.
//   - Una persona = una posición vigente; una posición = una persona vigente (lo hace cumplir la base).
//   - Una posición ocupada no se pisa: primero se mueve o se quita a quien la tiene.
// Todas reciben `tx`: cada operación toca varias filas y queda completa o no queda.

export class ErrorPosicion extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
export function validarFecha(fecha: unknown): string {
  const f = String(fecha ?? "");
  if (!FECHA_RE.test(f) || isNaN(Date.parse(f))) throw new ErrorPosicion(400, "Fecha inválida (formato AAAA-MM-DD)");
  return f;
}

type Vigente = { AsignacionId: number; MesaCodigo: string; Posicion: number; FechaInicio: string };

async function vigenteDe(tx: any, codigo: string): Promise<Vigente | null> {
  const rows: any[] = await tx.$queryRawUnsafe(`
    SELECT AsignacionId, MesaCodigo, Posicion, DATE_FORMAT(FechaInicio, '%Y-%m-%d') AS FechaInicio
      FROM PosicionEmpanizado WHERE Codigo = ? AND FechaFin IS NULL FOR UPDATE`, codigo);
  return rows.length ? { ...rows[0], AsignacionId: Number(rows[0].AsignacionId), Posicion: Number(rows[0].Posicion) } : null;
}

/** Asigna o mueve a una persona a una mesa/banda y posición desde `fecha`. */
export async function asignarPosicion(tx: any, d: {
  codigo: string; mesa: string; posicion: number; fecha: string; motivo?: string | null; usuario: string;
}) {
  const codigo = String(d.codigo ?? "").trim().toUpperCase();
  const mesa = String(d.mesa ?? "").trim().toUpperCase();
  const posicion = Number(d.posicion);
  const fecha = validarFecha(d.fecha);
  const motivo = d.motivo?.toString().trim().slice(0, 200) || null;
  if (!codigo || !mesa) throw new ErrorPosicion(400, "Persona y mesa son requeridas");

  const [m]: any[] = await tx.$queryRawUnsafe(`SELECT Nombre, Posiciones, Activa FROM MesasEmpanizado WHERE Codigo = ?`, mesa);
  if (!m) throw new ErrorPosicion(404, `La mesa ${mesa} no existe`);
  if (!Number(m.Activa)) throw new ErrorPosicion(400, `${m.Nombre} está inactiva`);
  if (!Number.isInteger(posicion) || posicion < 1 || posicion > Number(m.Posiciones)) {
    throw new ErrorPosicion(400, `${m.Nombre} tiene posiciones del 1 al ${Number(m.Posiciones)}`);
  }
  const [e]: any[] = await tx.$queryRawUnsafe(`SELECT Estado FROM Empleados WHERE Codigo = ?`, codigo);
  if (!e) throw new ErrorPosicion(404, `El empleado ${codigo} no existe`);
  if (e.Estado !== "Activo") throw new ErrorPosicion(400, `El empleado ${codigo} no está activo`);

  // ¿La posición ya es de otra persona?
  const [ocupa]: any[] = await tx.$queryRawUnsafe(`
    SELECT pe.Codigo, CONCAT_WS(' ', em.PrimerNombre, em.PrimerApellido) AS Nombre
      FROM PosicionEmpanizado pe JOIN Empleados em ON em.Codigo = pe.Codigo
     WHERE pe.MesaCodigo = ? AND pe.Posicion = ? AND pe.FechaFin IS NULL AND pe.Codigo <> ? FOR UPDATE`, mesa, posicion, codigo);
  if (ocupa) throw new ErrorPosicion(400, `La posición ${posicion} de ${m.Nombre} es de ${ocupa.Nombre} (${ocupa.Codigo}): muévala o quítela primero`);

  const actual = await vigenteDe(tx, codigo);
  if (actual) {
    if (actual.MesaCodigo === mesa && actual.Posicion === posicion) throw new ErrorPosicion(400, "La persona ya está en esa posición");
    if (fecha < actual.FechaInicio) throw new ErrorPosicion(400, `La fecha es anterior a su posición actual (desde ${actual.FechaInicio})`);
    if (actual.FechaInicio === fecha) {
      // Empezó hoy mismo: se corrige en su lugar (un tramo de cero días no dice nada).
      await tx.$executeRawUnsafe(
        `UPDATE PosicionEmpanizado SET MesaCodigo = ?, Posicion = ?, Motivo = ?, RegistradoPor = ? WHERE AsignacionId = ?`,
        mesa, posicion, motivo, d.usuario, actual.AsignacionId);
      return { ok: true };
    }
    await tx.$executeRawUnsafe(
      `UPDATE PosicionEmpanizado SET FechaFin = DATE_SUB(?, INTERVAL 1 DAY), MotivoCierre = ? WHERE AsignacionId = ?`,
      fecha, `Pasa a ${mesa} #${posicion}`, actual.AsignacionId);
  } else {
    // Sin posición vigente: que la fecha no caiga dentro de un tramo ya cerrado. Si la quitaron con
    // último día justo `fecha` (la quitaron hoy y hoy mismo va a otro lado) es un movimiento.
    const choque: any[] = await tx.$queryRawUnsafe(`
      SELECT AsignacionId, DATE_FORMAT(FechaInicio, '%Y-%m-%d') AS FechaInicio, DATE_FORMAT(FechaFin, '%Y-%m-%d') AS FechaFin
        FROM PosicionEmpanizado WHERE Codigo = ? AND FechaFin >= ? ORDER BY FechaFin DESC FOR UPDATE`, codigo, fecha);
    if (choque.length === 1 && choque[0].FechaFin === fecha) {
      const c = choque[0];
      if (c.FechaInicio === fecha) await tx.$executeRawUnsafe(`DELETE FROM PosicionEmpanizado WHERE AsignacionId = ?`, c.AsignacionId);
      else await tx.$executeRawUnsafe(
        `UPDATE PosicionEmpanizado SET FechaFin = DATE_SUB(?, INTERVAL 1 DAY), MotivoCierre = ? WHERE AsignacionId = ?`,
        fecha, `Pasa a ${mesa} #${posicion}`, c.AsignacionId);
    } else if (choque.length) {
      throw new ErrorPosicion(400, `Ya tenía posición hasta el ${choque[0].FechaFin}; la nueva debe empezar después`);
    }
  }
  await tx.$executeRawUnsafe(
    `INSERT INTO PosicionEmpanizado (Codigo, MesaCodigo, Posicion, FechaInicio, Motivo, RegistradoPor) VALUES (?, ?, ?, ?, ?, ?)`,
    codigo, mesa, posicion, fecha, motivo, d.usuario);
  return { ok: true };
}

/** Saca a la persona de su posición: `ultimoDia` es el último día que cuenta ahí. */
export async function quitarPosicion(tx: any, d: { codigo: string; ultimoDia: string; motivo?: string | null }) {
  const codigo = String(d.codigo ?? "").trim().toUpperCase();
  const ultimoDia = validarFecha(d.ultimoDia);
  const actual = await vigenteDe(tx, codigo);
  if (!actual) throw new ErrorPosicion(404, "La persona no tiene posición vigente");
  if (ultimoDia < actual.FechaInicio) {
    throw new ErrorPosicion(400, `El último día no puede ser anterior a su inicio (${actual.FechaInicio}); si fue un error, use Deshacer`);
  }
  await tx.$executeRawUnsafe(`UPDATE PosicionEmpanizado SET FechaFin = ?, MotivoCierre = ? WHERE AsignacionId = ?`,
    ultimoDia, d.motivo?.toString().trim().slice(0, 200) || "Se quitó de la posición", actual.AsignacionId);
  return { ok: true };
}

/** Deshace una asignación vigente capturada por error; si cerró otra el día antes, esa vuelve a quedar vigente. */
export async function deshacerPosicion(tx: any, asignacionId: number) {
  const [a]: any[] = await tx.$queryRawUnsafe(`
    SELECT Codigo, FechaFin, DATE_FORMAT(FechaInicio, '%Y-%m-%d') AS FechaInicio
      FROM PosicionEmpanizado WHERE AsignacionId = ? FOR UPDATE`, asignacionId);
  if (!a) throw new ErrorPosicion(404, "Asignación no encontrada");
  if (a.FechaFin !== null) throw new ErrorPosicion(400, "Solo se puede deshacer la asignación vigente");
  await tx.$executeRawUnsafe(`DELETE FROM PosicionEmpanizado WHERE AsignacionId = ?`, asignacionId);
  const [anterior]: any[] = await tx.$queryRawUnsafe(`
    SELECT AsignacionId FROM PosicionEmpanizado
     WHERE Codigo = ? AND FechaFin = DATE_SUB(?, INTERVAL 1 DAY) ORDER BY FechaInicio DESC LIMIT 1`, a.Codigo, a.FechaInicio);
  if (anterior) {
    try {
      await tx.$executeRawUnsafe(`UPDATE PosicionEmpanizado SET FechaFin = NULL, MotivoCierre = NULL WHERE AsignacionId = ?`, anterior.AsignacionId);
    } catch (err: any) {
      if (String(err.message).includes("Duplicate")) throw new ErrorPosicion(400, "No se puede devolverla a su posición anterior: ya la ocupa otra persona");
      throw err;
    }
  }
  return { ok: true, reabrioAnterior: !!anterior };
}

/** Al dar de baja a un empleado se cierra su posición con la fecha de baja. */
// Si la tabla todavía no existe (código desplegado antes de correr scripts/createEmpanizado.ts) no
// hay posición que cerrar: la baja NO debe fallar por eso (la baja automática corre sola cada día).
export async function cerrarPosicionPorBaja(tx: any, codigo: string, fechaBaja: string) {
  try {
    await tx.$executeRawUnsafe(
      `UPDATE PosicionEmpanizado SET FechaFin = GREATEST(FechaInicio, ?), MotivoCierre = 'Baja del empleado'
        WHERE Codigo = ? AND FechaFin IS NULL`, fechaBaja, codigo);
  } catch (err: any) {
    if (!/doesn't exist|1146/.test(String(err.message))) throw err;
  }
}
