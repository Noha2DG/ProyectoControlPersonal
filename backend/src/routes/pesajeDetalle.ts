import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";
import { hoyGT } from "../lib/dateGT.ts";

const router = Router();

// Familia (Clase.Familia, FK real a la tabla Familia — no una convención de texto) que le corresponde
// a cada área de destajo: D = CULTIVO COLA (Descabezado), E = CULTIVO PELADO (Pelado y Devenado y
// Pelado y Pinchado). Confirmado contra datos reales: sin este chequeo, ~9.6% de los pesajes en
// Descabezado y ~1.1% en Pelado y Devenado quedaban contra la transacción de la otra área (Producto
// distinto al que físicamente se estaba trabajando).
//
// DT (PELADO Y PINCHADO) se agregó en ago 2026: los pinchos (E63/E64/E65) se empezaron a trabajar sin
// estar en ningún plan y la gente que los pesa se transfiere a DT, no a DS. Comparte Familia E con DS
// porque es el mismo Producto pelado; lo que cambia es el área física, y por eso lleva su propia
// columna en el reporte y su propio ranking (ver AREAS_DESTAJO en frontend/src/utils/destajo.js).
const FAMILIA_ESPERADA_POR_AREA: Record<string, string> = { DS: "E", DU: "D", DT: "E" };

// Las únicas áreas donde se pesa a destajo — se derivan del mapa de arriba para no tener dos listas
// que se puedan desincronizar.
const AREAS_DESTAJO = Object.keys(FAMILIA_ESPERADA_POR_AREA);

function getOperador(req: Request): string {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return "Sistema";
    const payload: any = jwt.verify(header.slice(7), process.env.JWT_SECRET!);
    return payload.nombre ?? payload.username ?? "Sistema";
  } catch {
    return "Sistema";
  }
}

async function resolverTermo(tx: any, transaccionId: number, numeroTermo: string, almacenOrigen: string) {
  let termos: any[] = await tx.$queryRaw`
    SELECT TermoId FROM Termos WHERE TransaccionId = ${transaccionId} AND NumeroTermo = ${numeroTermo} LIMIT 1
  `;
  if (!termos.length) {
    try {
      await tx.$executeRaw`
        INSERT INTO Termos (TransaccionId, NumeroTermo, AlmacenActual, Capacidad) VALUES (${transaccionId}, ${numeroTermo}, ${almacenOrigen}, 150)
      `;
    } catch (err: any) {
      if (!err.message?.includes("Duplicate")) throw err; // creado en paralelo por otra estación justo ahora — se recupera abajo
    }
    termos = await tx.$queryRaw`
      SELECT TermoId FROM Termos WHERE TransaccionId = ${transaccionId} AND NumeroTermo = ${numeroTermo} LIMIT 1
    `;
  }
  return termos[0].TermoId;
}

// Bloquea la fila de la transacción (FOR UPDATE) y revalida su Estado dentro de la transacción de BD —
// esto serializa contra un DELETE concurrente de la misma transacción (ver transaccionesProduccion.ts)
// y evita leer un Estado que cambió justo después de leerlo afuera.
async function bloquearTransaccionAbierta(tx: any, transaccionId: number) {
  const trans: any[] = await tx.$queryRaw`
    SELECT Lote, ClaseOrigen, ClasePT, AlmacenOrigen, Estado FROM TransaccionesProduccion WHERE TransaccionId = ${transaccionId} LIMIT 1 FOR UPDATE
  `;
  if (!trans.length) return { error: "Transacción no encontrada", status: 404 };
  if (trans[0].Estado !== "Abierta") return { error: "La transacción está cerrada", status: 400 };
  return { trans: trans[0] };
}

// Bloquea la fila del lote (FOR UPDATE) y calcula cuánta materia prima sigue disponible — al estar dentro
// de la misma transacción de BD que el INSERT/UPDATE de PesajeDetalle, dos pesadas concurrentes contra el
// mismo lote ya no pueden leer el mismo "disponible" y juntas exceder el 100% del peso de ingreso.
// `lote` (texto) puede repetirse entre Clases del mismo Piscina+Ciclo+Fecha — `claseOrigen` es obligatorio
// para identificar la fila real de Lotes (llave compuesta Lote+Clase).
async function verificarDisponibilidad(tx: any, lote: string, claseOrigen: string, pesoNuevo: number, excluirPesajeId?: number) {
  const lotes: any[] = await tx.$queryRaw`SELECT PesoIngreso, UM FROM Lotes WHERE Lote = ${lote} AND Clase = ${claseOrigen} LIMIT 1 FOR UPDATE`;
  if (!lotes.length) return { ok: false, error: "Lote no encontrado", status: 404 };
  const { PesoIngreso, UM } = lotes[0];
  const procesado: any[] = await tx.$queryRaw`
    SELECT COALESCE(SUM(pd.Peso), 0) AS Procesado
    FROM PesajeDetalle pd
    JOIN TransaccionesProduccion tp ON pd.TransaccionId = tp.TransaccionId
    WHERE tp.Lote = ${lote} AND tp.ClaseOrigen = ${claseOrigen} ${excluirPesajeId ? Prisma.sql`AND pd.PesajeId != ${excluirPesajeId}` : Prisma.empty}
  `;
  const procesadoActual = Number(procesado[0].Procesado);
  const disponible = Number(PesoIngreso) - procesadoActual;
  if (pesoNuevo > disponible) {
    return {
      ok: false, status: 400,
      error: `No hay suficiente materia prima en el lote. Disponible: ${disponible.toFixed(2)} ${UM}, intentando agregar ${pesoNuevo.toFixed(2)} ${UM}`,
    };
  }
  return { ok: true, disponible, pesoIngreso: Number(PesoIngreso), procesadoActual, UM };
}

function formatear(rows: any[]) {
  return rows.map(r => ({ ...r, PesajeId: Number(r.PesajeId), TransaccionId: Number(r.TransaccionId), TermoId: Number(r.TermoId), Peso: Number(r.Peso) }));
}

const SELECT_PESAJE = `
  SELECT pd.PesajeId, pd.TransaccionId, pd.TermoId, t.NumeroTermo, pd.Codigo,
         CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido) AS NombreCompleto,
         pd.Peso, pd.UM, pd.FechaHora, pd.RegistradoPor
  FROM PesajeDetalle pd
  JOIN Empleados e ON pd.Codigo = e.Codigo
  JOIN Termos t ON pd.TermoId = t.TermoId
`;

// GET /api/pesaje?transaccion=ID
router.get("/", requireAuth, requirePerm("destajo", "ver"), async (req: Request, res: Response) => {
  try {
    const transaccionId = req.query.transaccion ? Number(req.query.transaccion) : undefined;
    if (!transaccionId) { res.status(400).json({ error: "transaccion es requerido" }); return; }
    const rows: any[] = await prisma.$queryRawUnsafe(
      `${SELECT_PESAJE} WHERE pd.TransaccionId = ? ORDER BY pd.PesajeId DESC`, transaccionId
    );
    res.json(formatear(rows));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pesaje/mi-dia/:codigo — consulta de la pantalla de planta: lo que UNA persona lleva
// procesado HOY. Es la misma consulta `porPersona` del reporte (routes/reportes.ts) acotada a un
// empleado y al día de Guatemala, con los mismos dos subselects contra Transferencias para resolver
// el Área y la hora de entrada al área vigentes al momento de cada pesada.
//
// Devuelve las pesadas crudas: las libras y el Lb/Hora los calcula el frontend con utils/destajo.js,
// el mismo módulo que usa el Reporte de Producción — así el número que ve el operario en la pantalla
// y el que ve administración en el reporte no pueden separarse.
//
// La hora viaja ya formateada como texto (DATE_FORMAT) porque las columnas DATETIME guardan hora
// local de Guatemala y Prisma las devuelve como Date en UTC: formatearlas en el navegador correría
// la hora 6 horas. FechaHora sí va cruda, pero solo se usa para restas entre pesadas, donde el
// corrimiento se cancela.
router.get("/mi-dia/:codigo", requireAuth, requirePerm("kiosco_destajo", "ver"), async (req: Request, res: Response) => {
  try {
    const codigo = String(req.params.codigo || "").trim().toUpperCase();
    if (!codigo) { res.status(400).json({ error: "Código requerido" }); return; }
    const hoy = hoyGT();

    const empleados: any[] = await prisma.$queryRaw`
      SELECT Codigo, CONCAT_WS(' ', PrimerNombre, SegundoNombre, PrimerApellido, SegundoApellido) AS Nombre, Estado
      FROM Empleados WHERE Codigo = ${codigo} LIMIT 1
    `;
    if (!empleados.length) { res.status(404).json({ error: "Carnet no reconocido" }); return; }
    if (empleados[0].Estado !== "Activo") { res.status(400).json({ error: "El empleado no está activo" }); return; }

    // Área donde está parada la persona ahora mismo (su transferencia abierta). Sirve para el
    // encabezado y para distinguir "todavía no has pesado hoy" de "tu área no trabaja por destajo".
    const areaActual: any[] = await prisma.$queryRaw`
      SELECT t.CodigoArea, a.Nombre AS NombreArea, a.FormaPago,
             DATE_FORMAT(t.FechaHora, '%H:%i') AS HoraEntradaArea,
             DATE(t.FechaHora) = ${hoy} AS EntradaEsDeHoy
      FROM Transferencias t
      JOIN Areas a ON t.CodigoArea = a.Codigo
      WHERE t.Codigo = ${codigo} AND t.FechaSalida IS NULL
      ORDER BY t.FechaHora DESC LIMIT 1
    `;

    const pesadas: any[] = await prisma.$queryRaw`
      SELECT pd.FechaHora, DATE_FORMAT(pd.FechaHora, '%H:%i') AS Hora,
             t.NumeroTermo, tp.Lote, tp.ClasePT, cl.Descripcion AS Producto,
             tp.Talla, ta.Descripcion AS DescripcionTalla, pd.Peso AS Kilos,
             (SELECT a.Nombre FROM Transferencias tr
              JOIN Areas a ON tr.CodigoArea = a.Codigo
              WHERE tr.Codigo = pd.Codigo
                AND tr.FechaHora <= pd.FechaHora
                AND (tr.FechaSalida IS NULL OR tr.FechaSalida >= pd.FechaHora)
              ORDER BY tr.FechaHora DESC LIMIT 1) AS Area,
             (SELECT tr.FechaHora FROM Transferencias tr
              WHERE tr.Codigo = pd.Codigo
                AND tr.FechaHora <= pd.FechaHora
                AND (tr.FechaSalida IS NULL OR tr.FechaSalida >= pd.FechaHora)
              ORDER BY tr.FechaHora DESC LIMIT 1) AS EntradaArea
      FROM PesajeDetalle pd
      JOIN Termos t ON pd.TermoId = t.TermoId
      JOIN TransaccionesProduccion tp ON pd.TransaccionId = tp.TransaccionId
      JOIN Clase cl ON tp.ClasePT = cl.Clase
      JOIN Tallas ta ON tp.Talla = ta.Codigo
      WHERE pd.Codigo = ${codigo}
        AND pd.FechaHora >= ${hoy} AND pd.FechaHora < DATE_ADD(${hoy}, INTERVAL 1 DAY)
      ORDER BY pd.FechaHora ASC
    `;

    // Puesto del día. Se resuelve aquí y no en el navegador a propósito: la pantalla está en planta
    // y solo debe recibir la posición de quien escaneó, nunca la tabla con la producción de los demás.
    // Basta con sumar Peso sin filtrar por área — solo se puede pesar estando en DS o DU (ver el POST).
    const ranking: any[] = await prisma.$queryRaw`
      SELECT Codigo, SUM(Peso) AS Kilos FROM PesajeDetalle
      WHERE FechaHora >= ${hoy} AND FechaHora < DATE_ADD(${hoy}, INTERVAL 1 DAY)
      GROUP BY Codigo ORDER BY Kilos DESC
    `;
    const indice = ranking.findIndex(r => r.Codigo === codigo);

    const ayer: any[] = await prisma.$queryRaw`
      SELECT COALESCE(SUM(Peso), 0) AS Kilos FROM PesajeDetalle
      WHERE Codigo = ${codigo}
        AND FechaHora >= DATE_SUB(${hoy}, INTERVAL 1 DAY) AND FechaHora < ${hoy}
    `;

    const area = areaActual[0];
    res.json({
      fecha: hoy,
      empleado: {
        Codigo: empleados[0].Codigo,
        Nombre: empleados[0].Nombre,
        Area: area?.NombreArea ?? null,
        CodigoArea: area?.CodigoArea ?? null,
        EsAreaDestajo: area ? AREAS_DESTAJO.includes(area.CodigoArea) : false,
        // La entrada al área solo se muestra si es de hoy: Transferencias puede quedar abierta varios
        // días y una hora de anteayer confundiría más de lo que informa (mismo criterio que Lb/Hora).
        // La comparación se hace en SQL a propósito — DATE() vuelve como Date de JS y compararla
        // contra el texto "YYYY-MM-DD" en Node exige un formateo que es fácil equivocar.
        HoraEntradaArea: area && Number(area.EntradaEsDeHoy) === 1 ? area.HoraEntradaArea : null,
      },
      // IdEmpleado/Nombre en cada fila porque utils/destajo.js agrupa por persona (viene del reporte,
      // donde las filas son de muchas personas a la vez).
      pesadas: pesadas.map(p => ({
        ...p,
        IdEmpleado: empleados[0].Codigo,
        Nombre: empleados[0].Nombre,
        Talla: Number(p.Talla),
        Kilos: Number(p.Kilos),
      })),
      puesto: indice >= 0 ? { Puesto: indice + 1, DeCuantos: ranking.length } : null,
      ayer: { Kilos: Number(ayer[0].Kilos) },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pesaje  { TransaccionId, NumeroTermo, Codigo, Peso }
// El termo no se elige de una lista generada por el sistema: el operador escribe el número de termo
// que tiene físicamente enfrente. Si ese número no existe aún para esta transacción, se crea solo.
router.post("/", requireAuth, requirePerm("destajo", "crear"), async (req: Request, res: Response) => {
  try {
    const { TransaccionId, NumeroTermo, Codigo, Peso } = req.body;
    if (!TransaccionId || !NumeroTermo || !Codigo || Peso == null) {
      res.status(400).json({ error: "Transacción, Número de Termo, Código de empleado y Peso son requeridos" });
      return;
    }

    const empleados: any[] = await prisma.$queryRaw`
      SELECT Codigo, CONCAT_WS(' ', PrimerNombre, SegundoNombre, PrimerApellido, SegundoApellido) AS NombreCompleto, Estado
      FROM Empleados WHERE Codigo = ${Codigo} LIMIT 1
    `;
    if (!empleados.length) { res.status(404).json({ error: "Empleado no encontrado" }); return; }
    if (empleados[0].Estado !== "Activo") { res.status(400).json({ error: "Empleado no está activo" }); return; }

    // Solo puede pesar si su transferencia abierta más reciente lo ubica en un área de destajo
    const areaActual: any[] = await prisma.$queryRaw`
      SELECT t.CodigoArea, a.Nombre AS NombreArea FROM Transferencias t
      JOIN Areas a ON t.CodigoArea = a.Codigo
      WHERE t.Codigo = ${Codigo} AND t.FechaSalida IS NULL
      ORDER BY t.FechaHora DESC LIMIT 1
    `;
    if (!areaActual.length || !AREAS_DESTAJO.includes(areaActual[0].CodigoArea)) {
      res.status(400).json({
        error: `Debe darse transferencia en un área de destajo (${AREAS_DESTAJO.join(", ")})`,
        areaActual: areaActual.length ? { Codigo: areaActual[0].CodigoArea, Nombre: areaActual[0].NombreArea } : null,
      });
      return;
    }

    const operador = getOperador(req);

    const resultado = await prisma.$transaction(async (tx) => {
      const bloqueo = await bloquearTransaccionAbierta(tx, Number(TransaccionId));
      if ("error" in bloqueo) return bloqueo;

      // La transacción debe ser del Producto que corresponde al área donde está físicamente la persona
      // (Descabezado no puede pesar Pelado y viceversa, aunque ambas sean áreas de destajo válidas).
      const familiaEsperada = FAMILIA_ESPERADA_POR_AREA[areaActual[0].CodigoArea];
      if (familiaEsperada) {
        const clase: any[] = await tx.$queryRaw`SELECT Familia, Descripcion FROM Clase WHERE Clase = ${bloqueo.trans.ClasePT} LIMIT 1`;
        if (clase.length && clase[0].Familia !== familiaEsperada) {
          return {
            error: `Esta transacción es de ${clase[0].Descripcion} — no corresponde al área ${areaActual[0].NombreArea}`,
            status: 400,
          };
        }
      }

      const disponibilidad = await verificarDisponibilidad(tx, bloqueo.trans.Lote, bloqueo.trans.ClaseOrigen, Number(Peso));
      if (!disponibilidad.ok) return disponibilidad;

      const termoId = await resolverTermo(tx, Number(TransaccionId), String(NumeroTermo).trim(), bloqueo.trans.AlmacenOrigen);

      await tx.$executeRaw`
        INSERT INTO PesajeDetalle (TransaccionId, TermoId, Codigo, Peso, RegistradoPor)
        VALUES (${Number(TransaccionId)}, ${Number(termoId)}, ${Codigo}, ${Number(Peso)}, ${operador})
      `;
      return { ok: true };
    });

    if (!("ok" in resultado) || !resultado.ok) {
      res.status((resultado as any).status || 400).json({ error: (resultado as any).error });
      return;
    }
    res.status(201).json({ ok: true, empleado: { Codigo: empleados[0].Codigo, NombreCompleto: empleados[0].NombreCompleto } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/pesaje/:id  { Peso, NumeroTermo }  (corrección de captura — solo peso y número de termo)
router.put("/:id", requireAuth, requirePerm("destajo", "editar"), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { Peso, NumeroTermo } = req.body;
    if (!NumeroTermo || Peso == null) { res.status(400).json({ error: "Número de Termo y Peso son requeridos" }); return; }

    const actual: any[] = await prisma.$queryRaw`SELECT TransaccionId FROM PesajeDetalle WHERE PesajeId = ${id} LIMIT 1`;
    if (!actual.length) { res.status(404).json({ error: "Pesaje no encontrado" }); return; }
    const transaccionId = Number(actual[0].TransaccionId);

    const resultado = await prisma.$transaction(async (tx) => {
      const bloqueo = await bloquearTransaccionAbierta(tx, transaccionId);
      if ("error" in bloqueo) return bloqueo;

      const disponibilidad = await verificarDisponibilidad(tx, bloqueo.trans.Lote, bloqueo.trans.ClaseOrigen, Number(Peso), id);
      if (!disponibilidad.ok) return disponibilidad;

      const termoId = await resolverTermo(tx, transaccionId, String(NumeroTermo).trim(), bloqueo.trans.AlmacenOrigen);

      await tx.$executeRaw`UPDATE PesajeDetalle SET TermoId = ${Number(termoId)}, Peso = ${Number(Peso)} WHERE PesajeId = ${id}`;
      return { ok: true };
    });

    if (!("ok" in resultado) || !resultado.ok) {
      res.status((resultado as any).status || 400).json({ error: (resultado as any).error });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/pesaje/:id  (corrección de captura)
router.delete("/:id", requireAuth, requirePerm("destajo", "eliminar"), async (req: Request, res: Response) => {
  try {
    await prisma.$executeRaw`DELETE FROM PesajeDetalle WHERE PesajeId = ${Number(req.params.id)}`;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
