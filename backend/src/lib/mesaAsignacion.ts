// Reglas para asignar personas a mesas de pelado (tabla MesaAsignacion, ver
// backend/scripts/createMesaAsignacion.ts). Todas reciben `tx` porque cada operación toca varias
// filas y tiene que quedar completa o no quedar: las rutas las llaman dentro de prisma.$transaction,
// y las pruebas dentro de una transacción que siempre se revierte.
//
// Las fechas son días completos ("YYYY-MM-DD"): mover a alguien el día D cierra su mesa anterior el
// D−1 y la nueva cuenta desde D. Coincide con el cálculo de Lb/Hora, que también reinicia cada día,
// así que un cambio de mesa nunca parte un bloque de tiempo.

export class ErrorMesa extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validarFecha(fecha: unknown): string {
  const f = String(fecha ?? "");
  if (!FECHA_RE.test(f) || isNaN(Date.parse(f))) throw new ErrorMesa(400, "Fecha inválida (formato AAAA-MM-DD)");
  return f;
}

type Vigente = { AsignacionId: number; MesaCodigo: string; EsLider: number; FechaInicio: string };

async function vigenteDe(tx: any, codigo: string): Promise<Vigente | null> {
  const rows: any[] = await tx.$queryRawUnsafe(`
    SELECT AsignacionId, MesaCodigo, EsLider, DATE_FORMAT(FechaInicio, '%Y-%m-%d') AS FechaInicio
    FROM MesaAsignacion WHERE Codigo = ? AND FechaFin IS NULL FOR UPDATE`, codigo);
  return rows.length ? { ...rows[0], AsignacionId: Number(rows[0].AsignacionId), EsLider: Number(rows[0].EsLider) } : null;
}

// Cambia mesa o liderazgo de una fila vigente a partir de `fecha`. Si la fila empezó ese mismo día
// se corrige en su lugar (no tiene sentido un tramo de cero días); si no, se cierra el día anterior
// y se abre una nueva — así el historial guarda quién estuvo dónde y con qué papel.
async function reemplazarVigente(tx: any, actual: Vigente, codigo: string, mesa: string, esLider: boolean,
  fecha: string, motivo: string | null, usuario: string) {
  if (actual.FechaInicio === fecha) {
    await tx.$executeRawUnsafe(
      `UPDATE MesaAsignacion SET MesaCodigo = ?, EsLider = ?, Motivo = ?, RegistradoPor = ? WHERE AsignacionId = ?`,
      mesa, esLider ? 1 : 0, motivo, usuario, actual.AsignacionId);
    return;
  }
  const cierre = actual.MesaCodigo === mesa ? (esLider ? "Pasa a líder" : "Deja de ser líder") : `Pasa a ${mesa}`;
  await tx.$executeRawUnsafe(
    `UPDATE MesaAsignacion SET FechaFin = DATE_SUB(?, INTERVAL 1 DAY), MotivoCierre = ? WHERE AsignacionId = ?`,
    fecha, cierre, actual.AsignacionId);
  await tx.$executeRawUnsafe(
    `INSERT INTO MesaAsignacion (Codigo, MesaCodigo, EsLider, FechaInicio, Motivo, RegistradoPor) VALUES (?, ?, ?, ?, ?, ?)`,
    codigo, mesa, esLider ? 1 : 0, fecha, motivo, usuario);
}

// Asigna, mueve o cambia el liderazgo de una persona desde `fecha`.
// Si se marca como líder y la mesa ya tiene otra líder vigente, a esa otra se le quita el
// liderazgo desde la misma fecha (sigue en la mesa) — cambiar de líder es una sola acción.
export async function asignarMesa(tx: any, datos: {
  codigo: string; mesa: string; esLider: boolean; fecha: string; motivo?: string | null; usuario: string;
}): Promise<{ lideresReemplazadas: string[] }> {
  const codigo = String(datos.codigo ?? "").trim().toUpperCase();
  const mesa = String(datos.mesa ?? "").trim().toUpperCase();
  const fecha = validarFecha(datos.fecha);
  const motivo = datos.motivo?.toString().trim() || null;
  if (!codigo || !mesa) throw new ErrorMesa(400, "Persona y mesa son requeridas");

  const mesas: any[] = await tx.$queryRawUnsafe(`SELECT Nombre, Tipo, Activa FROM Mesas WHERE Codigo = ?`, mesa);
  if (!mesas.length) throw new ErrorMesa(404, `La mesa ${mesa} no existe`);
  if (!Number(mesas[0].Activa)) throw new ErrorMesa(400, `${mesas[0].Nombre} está inactiva`);

  const emp: any[] = await tx.$queryRawUnsafe(`SELECT Estado FROM Empleados WHERE Codigo = ?`, codigo);
  if (!emp.length) throw new ErrorMesa(404, `El empleado ${codigo} no existe`);
  if (emp[0].Estado !== "Activo") throw new ErrorMesa(400, `El empleado ${codigo} no está activo`);

  const actual = await vigenteDe(tx, codigo);
  if (actual) {
    if (actual.MesaCodigo === mesa && !!actual.EsLider === datos.esLider)
      throw new ErrorMesa(400, "La persona ya está en esa mesa con ese papel");
    if (fecha < actual.FechaInicio)
      throw new ErrorMesa(400, `La fecha es anterior a su mesa actual (desde ${actual.FechaInicio})`);
  } else {
    // Sin mesa vigente: que la fecha no caiga dentro de un tramo ya cerrado (dos mesas el mismo día).
    const choque: any[] = await tx.$queryRawUnsafe(`
      SELECT DATE_FORMAT(FechaFin, '%Y-%m-%d') AS FechaFin FROM MesaAsignacion
      WHERE Codigo = ? AND FechaFin >= ? ORDER BY FechaFin DESC LIMIT 1`, codigo, fecha);
    if (choque.length) throw new ErrorMesa(400, `Ya tenía mesa hasta el ${choque[0].FechaFin}; la nueva debe empezar después`);
  }

  const lideresReemplazadas: string[] = [];
  if (datos.esLider) {
    const otra: any[] = await tx.$queryRawUnsafe(`
      SELECT Codigo FROM MesaAsignacion WHERE MesaCodigo = ? AND EsLider = 1 AND FechaFin IS NULL AND Codigo <> ? FOR UPDATE`,
      mesa, codigo);
    for (const o of otra) {
      const suya = await vigenteDe(tx, o.Codigo);
      if (!suya) continue;
      if (fecha < suya.FechaInicio)
        throw new ErrorMesa(400, `La líder actual (${o.Codigo}) está desde ${suya.FechaInicio}; la fecha no puede ser anterior`);
      await reemplazarVigente(tx, suya, o.Codigo, mesa, false, fecha, "Cambio de líder", datos.usuario);
      lideresReemplazadas.push(o.Codigo);
    }
  }

  if (actual) await reemplazarVigente(tx, actual, codigo, mesa, datos.esLider, fecha, motivo, datos.usuario);
  else await tx.$executeRawUnsafe(
    `INSERT INTO MesaAsignacion (Codigo, MesaCodigo, EsLider, FechaInicio, Motivo, RegistradoPor) VALUES (?, ?, ?, ?, ?, ?)`,
    codigo, mesa, datos.esLider ? 1 : 0, fecha, motivo, datos.usuario);

  return { lideresReemplazadas };
}

// Saca a una persona de su mesa: `ultimoDia` es el último día que cuenta para esa mesa; desde el
// siguiente, si pesa, cae en Banda temporal.
export async function quitarDeMesa(tx: any, datos: { codigo: string; ultimoDia: string; motivo?: string | null }) {
  const codigo = String(datos.codigo ?? "").trim().toUpperCase();
  const ultimoDia = validarFecha(datos.ultimoDia);
  const actual = await vigenteDe(tx, codigo);
  if (!actual) throw new ErrorMesa(404, "La persona no tiene mesa vigente");
  if (ultimoDia < actual.FechaInicio)
    throw new ErrorMesa(400, `El último día no puede ser anterior a su inicio en la mesa (${actual.FechaInicio}); si fue un error, usa Deshacer`);
  const motivo = datos.motivo?.toString().trim() || "Se quitó de la mesa";
  await tx.$executeRawUnsafe(
    `UPDATE MesaAsignacion SET FechaFin = ?, MotivoCierre = ? WHERE AsignacionId = ?`, ultimoDia, motivo, actual.AsignacionId);
}

// Deshace una asignación capturada por error. Solo la vigente y más reciente de la persona; si al
// crearla se cerró la anterior el día justo antes, esa anterior vuelve a quedar vigente.
export async function deshacerAsignacion(tx: any, asignacionId: number) {
  const rows: any[] = await tx.$queryRawUnsafe(`
    SELECT Codigo, FechaFin, DATE_FORMAT(FechaInicio, '%Y-%m-%d') AS FechaInicio
    FROM MesaAsignacion WHERE AsignacionId = ? FOR UPDATE`, asignacionId);
  if (!rows.length) throw new ErrorMesa(404, "Asignación no encontrada");
  const a = rows[0];
  if (a.FechaFin !== null) throw new ErrorMesa(400, "Solo se puede deshacer la asignación vigente");

  await tx.$executeRawUnsafe(`DELETE FROM MesaAsignacion WHERE AsignacionId = ?`, asignacionId);
  const anterior: any[] = await tx.$queryRawUnsafe(`
    SELECT AsignacionId FROM MesaAsignacion
    WHERE Codigo = ? AND FechaFin = DATE_SUB(?, INTERVAL 1 DAY) ORDER BY FechaInicio DESC LIMIT 1`, a.Codigo, a.FechaInicio);
  if (anterior.length) {
    try {
      await tx.$executeRawUnsafe(`UPDATE MesaAsignacion SET FechaFin = NULL, MotivoCierre = NULL WHERE AsignacionId = ?`, anterior[0].AsignacionId);
    } catch (err: any) {
      if (String(err.message).includes("Duplicate")) throw new ErrorMesa(400, "No se puede reabrir la mesa anterior: esa mesa ya tiene otra líder vigente");
      throw err;
    }
  }
  return { reabrioAnterior: anterior.length > 0 };
}

// Al dar de baja a un empleado se cierra su mesa con la fecha de baja (último día). GREATEST evita
// violar FechaFin >= FechaInicio si la baja se registra con una fecha anterior a la asignación.
export async function cerrarMesaPorBaja(tx: any, codigo: string, fechaBaja: string) {
  await tx.$executeRawUnsafe(
    `UPDATE MesaAsignacion SET FechaFin = GREATEST(FechaInicio, ?), MotivoCierre = 'Baja del empleado'
     WHERE Codigo = ? AND FechaFin IS NULL`, fechaBaja, codigo);
}
