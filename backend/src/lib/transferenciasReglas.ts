// Reglas para que una persona nunca esté en dos áreas a la vez (27 nov 2026).
//
// Antes se cruzaban por tres caminos: dos kioscos marcando casi al mismo tiempo (cerrar la anterior y
// abrir la nueva iban en dos pasos sueltos), el alta manual y, sobre todo, las ediciones: al corregir la
// hora de una transferencia la vecina quedaba igual. En 60 días hubo 295 cruces y 61 de más de una hora:
// horas contadas dos veces en Lb/Hora y en presencia, y el área de una pesada dependía de cuál se abrió
// último. La base ahora tampoco deja dos abiertas por persona (columna AbiertaCodigo + UNIQUE, mismo
// patrón que MesaAsignacion.VigenteCodigo).
import { nowGT } from "./dateGT.ts";
import { registrarBitacora, leerMarcaje } from "./bitacoraMarcaje.ts";

type Db = { $queryRaw: any; $executeRaw: any; $queryRawUnsafe: any; $executeRawUnsafe: any };

const SIN_FIN = "9999-12-31 23:59:59";

export class ErrorTraslape extends Error {
  status = 409;
}

/** Fila del empleado bloqueada hasta el final de la transacción: serializa todo lo que toca sus transferencias. */
export async function bloquearEmpleado(tx: Db, codigo: string) {
  await tx.$queryRaw`SELECT Codigo FROM Empleados WHERE Codigo = ${codigo} FOR UPDATE`;
}

/** ¿El error es la base rechazando una segunda transferencia abierta de la misma persona? */
export function esSegundaAbierta(err: any): boolean {
  return String(err?.message ?? "").includes("uq_trans_abierta");
}

const hhmm = (f: string | null) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)} ${f.slice(11, 16)}` : "sin salida");

/**
 * Antes de guardar la transferencia [fh, fhs) de `codigo` (fhs null = sigue abierta), recorta las demás
 * de esa persona que se cruzan con ella, como hace el kiosco al cambiar de área:
 *   - la que empezó antes y termina adentro → su salida pasa a ser la entrada de esta;
 *   - la que empieza adentro y termina después → su entrada pasa a ser la salida de esta.
 * Si una la contiene entera (habría que partirla) o queda entera adentro (habría que borrarla) no se
 * adivina: se rechaza con el detalle para que la persona la ajuste primero. Cada recorte va a la
 * bitácora. Devuelve lo que se recortó, para avisarlo en pantalla.
 * Va dentro de la transacción y con el empleado ya bloqueado (bloquearEmpleado).
 */
export async function acomodarVecinas(tx: Db, p: { id: number | null; codigo: string; fh: string; fhs: string | null; usuario: string }) {
  const fin = p.fhs ?? SIN_FIN;
  const otras: any[] = await tx.$queryRaw`
    SELECT t.id, t.CodigoArea, a.Nombre AS NombreArea,
           DATE_FORMAT(t.FechaHora, '%Y-%m-%d %H:%i:%s') AS Ini, DATE_FORMAT(t.FechaSalida, '%Y-%m-%d %H:%i:%s') AS Fin
      FROM Transferencias t JOIN Areas a ON a.Codigo = t.CodigoArea
     WHERE t.Codigo = ${p.codigo} AND t.id <> ${p.id ?? 0}
       AND t.FechaHora < ${fin} AND COALESCE(t.FechaSalida, ${SIN_FIN}) > ${p.fh}
       -- Las de duración cero (entrada y salida en el mismo segundo) no suman horas: no estorban.
       AND (t.FechaSalida IS NULL OR t.FechaSalida > t.FechaHora)
     ORDER BY t.FechaHora
     FOR UPDATE`;

  const ajustes: { id: number; area: string; cambio: string }[] = [];
  const cambios: { id: number; campo: "FechaSalida" | "FechaHora"; valor: string }[] = [];
  for (const o of otras) {
    const oFin = o.Fin ?? SIN_FIN;
    const nombre = `${o.NombreArea} (${hhmm(o.Ini)} → ${hhmm(o.Fin)})`;
    if (o.Ini < p.fh && oFin <= fin) {
      cambios.push({ id: Number(o.id), campo: "FechaSalida", valor: p.fh });
      ajustes.push({ id: Number(o.id), area: o.NombreArea, cambio: `${nombre}: la salida pasa a ${hhmm(p.fh)}` });
    } else if (o.Ini >= p.fh && oFin > fin) {
      cambios.push({ id: Number(o.id), campo: "FechaHora", valor: fin });
      ajustes.push({ id: Number(o.id), area: o.NombreArea, cambio: `${nombre}: la entrada pasa a ${hhmm(fin)}` });
    } else if (o.Ini < p.fh) {
      throw new ErrorTraslape(`Se cruza con ${nombre}, que cubre todo este horario. Habría que partirla en dos: ajústala primero en Transferencias.`);
    } else {
      throw new ErrorTraslape(`Dentro de este horario queda ${nombre}. Bórrala o ajústala primero en Transferencias.`);
    }
  }

  for (const c of cambios) {
    const antes = await leerMarcaje(tx, "Transferencias", c.id);
    if (c.campo === "FechaSalida") await tx.$executeRaw`UPDATE Transferencias SET FechaSalida = ${c.valor} WHERE id = ${c.id}`;
    else await tx.$executeRaw`UPDATE Transferencias SET FechaHora = ${c.valor} WHERE id = ${c.id}`;
    const despues = await leerMarcaje(tx, "Transferencias", c.id);
    await registrarBitacora(tx, { tabla: "Transferencias", id: c.id, accion: "EDITAR", antes, despues, usuario: `${p.usuario} (ajuste automático)` });
  }
  return ajustes;
}

/**
 * Al dar de baja a alguien, su área abierta se cierra (la baja automática ya lo hacía; la manual no, y
 * cuatro personas quedaron "dentro" de su área desde septiembre). Se cierra a la hora de su última
 * Salida si la hay después de la entrada al área, si no al final de ese día, y nunca después de ahora.
 */
export async function cerrarTransferenciasPorBaja(db: Db, codigo: string) {
  const ahora = nowGT();
  await db.$executeRaw`
    UPDATE Transferencias t
       SET t.FechaSalida = GREATEST(t.FechaHora, LEAST(${ahora}, COALESCE(
             (SELECT MIN(m.FechaHora) FROM Movimientos m
               WHERE m.Codigo = t.Codigo AND m.Tipo = 'Salida' AND m.FechaHora >= t.FechaHora
                 AND m.FechaHora < DATE(t.FechaHora) + INTERVAL 1 DAY),
             CONCAT(DATE(t.FechaHora), ' 23:59:59'))))
     WHERE t.Codigo = ${codigo} AND t.FechaSalida IS NULL`;
}
