import prisma from "./prisma.ts";
import { hoyGT, diaSemanaDe } from "./dateGT.ts";
import { cerrarMesaPorBaja } from "./mesaAsignacion.ts";
import { leerMarcaje, registrarBitacora } from "./bitacoraMarcaje.ts";

// Baja automática por abandono (20 nov 2026, regla del usuario, en prueba "esta semana"): quien no
// marca en 3 días hábiles seguidos queda de baja sola, sin esperar a que RRHH la revise.
//
// · Día hábil = lunes a sábado (el sábado cuenta) en que la planta TRABAJÓ: al menos
//   MIN_PERSONAS_DIA personas marcaron en el kiosco. Sin esto un feriado (24/25 dic, Semana Santa)
//   daría de baja a toda la planta; un domingo marca 8–13 personas, un sábado normal 34–300.
// · Solo días YA TERMINADOS (de ayer para atrás): hoy todavía pueden llegar.
// · Marcar = cualquier rastro: kiosco general, cambio de área o pesada de destajo. Lo que pone el
//   sistema solo (corte de medianoche, Operador/RegistradoPor 'Sistema') no cuenta.
// · No se toca a quien ingresó después del primero de esos 3 días, ni a quien tenga un permiso o
//   vacaciones (cualquier tipo) que toque desde ese primer día hasta hoy — traslape, ver
//   project_permisos_rango_fechas.
// · La baja es la misma de la pantalla (y de la baja masiva del 18 nov): Abandono de trabajo,
//   recontratable, FechaBaja = día de su último marcaje, cierre de su mesa de pelado; además cierra
//   su área abierta y su ciclo de kiosco abierto a las 23:59:59 de ese día, como el corte de medianoche.
//   Se reconocen por la observación OBS_PREFIJO, para revisarlas o revertirlas.
// · Corre SOLO con BAJA_AUTOMATICA=1 en el .env: el backend/.env local apunta a producción
//   (project_backend_env_apunta_a_produccion) y un `npm run dev` daría bajas reales.

export const MIN_PERSONAS_DIA = 20;
export const DIAS_SIN_MARCAR = 3;
export const OBS_PREFIJO = "Baja automática: 3 días hábiles sin marcar";
const USUARIO = "Sistema";

const dma = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** Los últimos DIAS_SIN_MARCAR días hábiles terminados, del más reciente al más viejo. */
export async function diasHabilesRevisados(hoy = hoyGT()): Promise<string[]> {
  const filas: any[] = await prisma.$queryRawUnsafe(`
    SELECT DATE_FORMAT(FechaHora, '%Y-%m-%d') AS Dia, COUNT(DISTINCT Codigo) AS Personas
      FROM Movimientos
     WHERE FechaHora >= ? - INTERVAL 30 DAY AND FechaHora < ? AND Operador <> 'Sistema'
     GROUP BY Dia ORDER BY Dia DESC`, hoy, hoy);
  return filas
    .filter(f => diaSemanaDe(f.Dia) !== "Domingo" && Number(f.Personas) >= MIN_PERSONAS_DIA)
    .slice(0, DIAS_SIN_MARCAR)
    .map(f => f.Dia as string);
}

export type CandidatoBaja = { Codigo: string; Nombre: string; Ingreso: string; UltimoMarcaje: string | null; FechaBaja: string };

/** Quiénes cumplen la regla hoy (no modifica nada). */
export async function candidatosBajaAutomatica(hoy = hoyGT()): Promise<{ dias: string[]; candidatos: CandidatoBaja[] }> {
  const dias = await diasHabilesRevisados(hoy);
  if (dias.length < DIAS_SIN_MARCAR) return { dias, candidatos: [] };
  const desde = dias[dias.length - 1]; // el más viejo de los 3
  const filas: any[] = await prisma.$queryRawUnsafe(`
    SELECT e.Codigo, CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido) AS Nombre,
           DATE_FORMAT(e.FechaIngreso, '%Y-%m-%d') AS Ingreso,
           DATE_FORMAT(GREATEST(
             COALESCE((SELECT MAX(FechaHora) FROM Movimientos m WHERE m.Codigo = e.Codigo AND m.Operador <> 'Sistema'), '1970-01-01'),
             COALESCE((SELECT MAX(FechaHora) FROM Transferencias t WHERE t.Codigo = e.Codigo AND t.RegistradoPor <> 'Sistema'), '1970-01-01'),
             COALESCE((SELECT MAX(FechaHora) FROM PesajeDetalle p WHERE p.Codigo = e.Codigo), '1970-01-01')
           ), '%Y-%m-%d %H:%i') AS Ult
      FROM Empleados e
     WHERE e.Estado = 'Activo'
       AND e.FechaIngreso <= ?
       AND NOT EXISTS (SELECT 1 FROM Permisos p WHERE p.CodigoEmpleado = e.Codigo AND p.Fecha <= ? AND p.FechaFin >= ?)`,
    desde, hoy, desde);
  const candidatos = filas
    .map(f => ({ ...f, Ult: f.Ult?.startsWith("1970") ? null : f.Ult }))
    .filter(f => !f.Ult || f.Ult < `${desde} 00:00`)
    .map(f => {
      const ultDia = f.Ult ? f.Ult.slice(0, 10) : null;
      // Nunca antes de su ingreso (un recontratado puede tener marcajes de su contrato anterior).
      const fechaBaja = ultDia && ultDia > f.Ingreso ? ultDia : f.Ingreso;
      return { Codigo: f.Codigo, Nombre: f.Nombre, Ingreso: f.Ingreso, UltimoMarcaje: f.Ult, FechaBaja: fechaBaja };
    });
  return { dias, candidatos };
}

/** Da de baja a cada candidato, cada uno en su propia transacción (uno que falle no frena a los demás). */
export async function aplicarBajaAutomatica(hoy = hoyGT()) {
  const { dias, candidatos } = await candidatosBajaAutomatica(hoy);
  const obs = `${OBS_PREFIJO} (${[...dias].reverse().map(dma).join(", ")})`;
  const hechas: string[] = [], fallidas: string[] = [];
  for (const c of candidatos) {
    try {
      await prisma.$transaction(async tx => {
        const [e]: any[] = await tx.$queryRawUnsafe(`SELECT Estado FROM Empleados WHERE Codigo = ? FOR UPDATE`, c.Codigo);
        if (!e || e.Estado !== "Activo") return;
        // Revisión final con el renglón bloqueado: si marcó mientras tanto, no va.
        const [r]: any[] = await tx.$queryRawUnsafe(`
          SELECT EXISTS(SELECT 1 FROM Movimientos WHERE Codigo = ? AND Operador <> 'Sistema' AND FechaHora >= ?)
              OR EXISTS(SELECT 1 FROM Transferencias WHERE Codigo = ? AND RegistradoPor <> 'Sistema' AND FechaHora >= ?)
              OR EXISTS(SELECT 1 FROM PesajeDetalle WHERE Codigo = ? AND FechaHora >= ?) AS Marco`,
          c.Codigo, dias[dias.length - 1], c.Codigo, dias[dias.length - 1], c.Codigo, dias[dias.length - 1]);
        if (Number(r.Marco)) return;

        // Ciclo de kiosco abierto: Salida a las 23:59:59 del día de su Entrada.
        const [m]: any[] = await tx.$queryRawUnsafe(`
          SELECT Tipo, NombreEmpleado, DATE_FORMAT(FechaHora, '%Y-%m-%d') AS Dia
            FROM Movimientos WHERE Codigo = ? ORDER BY FechaHora DESC LIMIT 1`, c.Codigo);
        if (m?.Tipo === "Entrada") {
          await tx.$executeRawUnsafe(
            `INSERT INTO Movimientos (Codigo, NombreEmpleado, Tipo, FechaHora, DiaSemana, Operador) VALUES (?, ?, 'Salida', ?, ?, ?)`,
            c.Codigo, m.NombreEmpleado, `${m.Dia} 23:59:59`, diaSemanaDe(m.Dia), USUARIO);
          const [{ id }]: any[] = await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`);
          await registrarBitacora(tx as any, { tabla: "Movimientos", id: Number(id), accion: "CREAR", antes: null,
            despues: await leerMarcaje(tx as any, "Movimientos", Number(id)), usuario: USUARIO });
        }
        // Áreas abiertas: cerradas a las 23:59:59 del día en que empezaron.
        await tx.$executeRawUnsafe(`
          UPDATE Transferencias SET FechaSalida = CONCAT(DATE(FechaHora), ' 23:59:59')
           WHERE Codigo = ? AND FechaSalida IS NULL`, c.Codigo);

        await tx.$executeRawUnsafe(`UPDATE Empleados SET Estado = 'Baja', FechaBaja = ? WHERE Codigo = ?`, c.FechaBaja, c.Codigo);
        await tx.$executeRawUnsafe(
          `INSERT INTO Bajas (Codigo, FechaBaja, Motivo, Recontratable, Observaciones, RegistradoPor) VALUES (?, ?, 'Abandono de trabajo', 1, ?, ?)`,
          c.Codigo, c.FechaBaja, obs, USUARIO);
        await cerrarMesaPorBaja(tx, c.Codigo, c.FechaBaja);
        hechas.push(c.Codigo);
      }, { timeout: 30_000 });
    } catch (err: any) {
      fallidas.push(`${c.Codigo}: ${err.message}`);
    }
  }
  return { dias, hechas, fallidas };
}

// Una vez al día, desde las HORA_BARRIDO (hora de Guatemala). El intervalo de 15 min del servidor
// solo pregunta; si ya corrió hoy no hace nada. Tras un reinicio vuelve a correr ese día, y no pasa
// nada: quien ya quedó de baja deja de estar Activo.
const HORA_BARRIDO = 4;
let ultimoDia: string | null = null;

export async function barridoBajaAutomatica() {
  if (process.env.BAJA_AUTOMATICA !== "1") return;
  const hoy = hoyGT();
  const hora = Number(new Date().toLocaleString("en-US", { timeZone: "America/Guatemala", hour: "numeric", hour12: false }));
  if (ultimoDia === hoy || hora < HORA_BARRIDO) return;
  const r = await aplicarBajaAutomatica(hoy);
  ultimoDia = hoy;
  console.log(`Baja automática (${r.dias.join(", ")}): ${r.hechas.length} baja(s)${r.hechas.length ? ` — ${r.hechas.join(", ")}` : ""}` +
    (r.fallidas.length ? ` · FALLARON: ${r.fallidas.join(" | ")}` : ""));
}
