// Bitácora de correcciones de marcajes (tabla BitacoraMarcaje, scripts/createBitacoraMarcaje.ts).
// Cada alta manual, corrección o borrado de Movimientos/Transferencias se guarda con quién lo hizo y
// los campos antes y después. Se escribe en la MISMA transacción que el cambio: o quedan los dos o
// ninguno, así no hay corrección sin rastro.
import { nowGT } from "./dateGT.ts";

export type TablaMarcaje = "Movimientos" | "Transferencias";
type Db = { $queryRawUnsafe: (q: string, ...v: any[]) => Promise<any>; $executeRawUnsafe: (q: string, ...v: any[]) => Promise<any> };

// Los campos que importan de cada tabla, con las fechas como texto de Guatemala (sin pasar por Date).
const CAMPOS: Record<TablaMarcaje, string> = {
  Movimientos: `Codigo, Tipo, DATE_FORMAT(FechaHora, '%Y-%m-%d %H:%i:%s') AS FechaHora, Operador`,
  Transferencias: `Codigo, CodigoArea, DATE_FORMAT(FechaHora, '%Y-%m-%d %H:%i:%s') AS FechaHora,
                   DATE_FORMAT(FechaSalida, '%Y-%m-%d %H:%i:%s') AS FechaSalida, RegistradoPor`,
};

/** Lee un registro tal como está (bloqueado hasta terminar la transacción). null si no existe. */
export async function leerMarcaje(db: Db, tabla: TablaMarcaje, id: number): Promise<Record<string, any> | null> {
  const rows: any[] = await db.$queryRawUnsafe(`SELECT ${CAMPOS[tabla]} FROM ${tabla} WHERE id = ? FOR UPDATE`, id);
  return rows[0] ?? null;
}

export async function registrarBitacora(db: Db, datos: {
  tabla: TablaMarcaje; id: number; accion: "CREAR" | "EDITAR" | "BORRAR";
  antes: Record<string, any> | null; despues: Record<string, any> | null; usuario: string;
}) {
  const codigo = String(datos.despues?.Codigo ?? datos.antes?.Codigo ?? "");
  await db.$executeRawUnsafe(
    `INSERT INTO BitacoraMarcaje (Tabla, RegistroId, Codigo, Accion, Antes, Despues, Usuario, Fecha) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    datos.tabla, datos.id, codigo, datos.accion,
    datos.antes ? JSON.stringify(datos.antes) : null, datos.despues ? JSON.stringify(datos.despues) : null,
    datos.usuario, nowGT());
}

/** Últimas 300 correcciones de una tabla, opcionalmente de un empleado. */
export async function listarBitacora(db: Db, tabla: TablaMarcaje, codigo?: string) {
  const rows: any[] = await db.$queryRawUnsafe(`
    SELECT b.Id, b.RegistroId, b.Codigo, b.Accion, b.Antes, b.Despues, b.Usuario,
           DATE_FORMAT(b.Fecha, '%Y-%m-%d %H:%i') AS Fecha,
           CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido) AS NombreEmpleado
      FROM BitacoraMarcaje b LEFT JOIN Empleados e ON e.Codigo = b.Codigo
     WHERE b.Tabla = ? ${codigo ? "AND b.Codigo = ?" : ""}
     ORDER BY b.Fecha DESC, b.Id DESC LIMIT 300`, tabla, ...(codigo ? [codigo] : []));
  const leer = (s: any) => { try { return s ? JSON.parse(String(s)) : null; } catch { return null; } };
  return rows.map(r => ({ ...r, Id: Number(r.Id), RegistroId: Number(r.RegistroId), Antes: leer(r.Antes), Despues: leer(r.Despues) }));
}
