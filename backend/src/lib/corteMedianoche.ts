import prisma from "./prisma.ts";
import { nowGT, hoyInicioGT, diaSemanaDe } from "./dateGT.ts";

const OPERADOR_SISTEMA = "Sistema";
const LIMITE_HORAS_JORNADA = 20; // más allá de esto, se asume olvido de marcar salida, no turno real

/**
 * Si la última Entrada del empleado quedó abierta en un día calendario anterior
 * a hoy, inserta el corte de medianoche: Salida a las 23:59:59 de ese día y
 * Entrada a las 00:00:00 del siguiente, arrastrando el área abierta en
 * Transferencias para que no se pierda por el corte administrativo.
 *
 * No corta si la Entrada ya lleva LIMITE_HORAS_JORNADA o más sin Salida real
 * (se deja como jornada incompleta para revisión de un supervisor) ni si el
 * salto es de más de un día (mismo motivo).
 */
export async function aplicarCorteMedianoche(codigo: string): Promise<void> {
  const ultimo: any[] = await prisma.$queryRaw`
    SELECT Tipo, NombreEmpleado,
           DATE_FORMAT(FechaHora, '%Y-%m-%d %H:%i:%s') AS FechaHora,
           DATE_FORMAT(FechaHora, '%Y-%m-%d') AS Fecha
    FROM Movimientos
    WHERE Codigo = ${codigo}
    ORDER BY FechaHora DESC
    LIMIT 1
  `;
  if (!ultimo.length || ultimo[0].Tipo !== "Entrada") return;

  const entrada = ultimo[0];
  const hoy = hoyInicioGT().slice(0, 10);
  if (entrada.Fecha >= hoy) return;

  const diffDias = Math.round((Date.parse(hoy) - Date.parse(entrada.Fecha)) / 86400000);
  if (diffDias > 1) return;

  const horasTranscurridas =
    (Date.parse(nowGT().replace(" ", "T")) - Date.parse(entrada.FechaHora.replace(" ", "T"))) / 3600000;
  if (horasTranscurridas >= LIMITE_HORAS_JORNADA) return;

  const salidaAuto = `${entrada.Fecha} 23:59:59`;
  const entradaAuto = `${hoy} 00:00:00`;

  // Todo el corte (Salida + Entrada + arrastre de Transferencias) se aplica en
  // una sola transacción: si la conexión se cae a medio camino, no debe quedar
  // un empleado con Salida insertada pero sin su Entrada correspondiente.
  await prisma.$transaction(async (tx) => {
    const salidaInsertada = await tx.$executeRaw`
      INSERT IGNORE INTO Movimientos (Codigo, NombreEmpleado, Tipo, FechaHora, DiaSemana, Operador)
      VALUES (${codigo}, ${entrada.NombreEmpleado}, 'Salida', ${salidaAuto}, ${diaSemanaDe(entrada.Fecha)}, ${OPERADOR_SISTEMA})
    `;
    if (salidaInsertada === 0) return; // otra llamada concurrente ya aplicó este corte

    await tx.$executeRaw`
      INSERT IGNORE INTO Movimientos (Codigo, NombreEmpleado, Tipo, FechaHora, DiaSemana, Operador)
      VALUES (${codigo}, ${entrada.NombreEmpleado}, 'Entrada', ${entradaAuto}, ${diaSemanaDe(hoy)}, ${OPERADOR_SISTEMA})
    `;

    const areaAbierta: any[] = await tx.$queryRaw`
      SELECT CodigoArea FROM Transferencias
      WHERE Codigo = ${codigo} AND FechaSalida IS NULL
      ORDER BY FechaHora DESC
      LIMIT 1
    `;
    if (areaAbierta.length) {
      await tx.$executeRaw`
        UPDATE Transferencias SET FechaSalida = ${salidaAuto}
        WHERE Codigo = ${codigo} AND FechaSalida IS NULL
      `;
      await tx.$executeRaw`
        INSERT INTO Transferencias (Codigo, CodigoArea, FechaHora, RegistradoPor)
        VALUES (${codigo}, ${areaAbierta[0].CodigoArea}, ${entradaAuto}, ${OPERADOR_SISTEMA})
      `;
    }
  });
}

/** Aplica el corte a todo empleado cuya última Entrada quedó abierta antes de hoy. */
export async function barridoCorteMedianoche(): Promise<void> {
  const hoy = hoyInicioGT().slice(0, 10);
  const pendientes: any[] = await prisma.$queryRaw`
    SELECT m1.Codigo
    FROM Movimientos m1
    INNER JOIN (
      SELECT Codigo, MAX(FechaHora) AS UltimaFecha FROM Movimientos GROUP BY Codigo
    ) m2 ON m1.Codigo = m2.Codigo AND m1.FechaHora = m2.UltimaFecha
    WHERE m1.Tipo = 'Entrada' AND m1.FechaHora < ${hoy}
  `;
  for (const { Codigo } of pendientes) {
    try {
      await aplicarCorteMedianoche(Codigo);
    } catch (err: any) {
      console.error(`Corte de medianoche falló para ${Codigo}:`, err.message);
    }
  }
}
