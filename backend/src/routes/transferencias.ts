import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.ts";
import { nowGT, hoyInicioGT } from "../lib/dateGT.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";
import { aplicarCorteMedianoche } from "../lib/corteMedianoche.ts";
import { leerMarcaje, registrarBitacora, listarBitacora } from "../lib/bitacoraMarcaje.ts";
import { bloquearEmpleado, acomodarVecinas, esSegundaAbierta, ErrorTraslape } from "../lib/transferenciasReglas.ts";

const router = Router();

function getOperador(req: Request): string {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return "Kiosco";
    const payload: any = jwt.verify(header.slice(7), process.env.JWT_SECRET!);
    return payload.nombre ?? payload.username ?? "Kiosco";
  } catch {
    return "Kiosco";
  }
}

// POST /api/transferencias  { Codigo, CodigoArea }  (terminal de kiosco — sin sesión, dispositivo físico fijo)
router.post("/", async (req: Request, res: Response) => {
  const { Codigo, CodigoArea } = req.body;
  if (!Codigo || !CodigoArea) {
    res.status(400).json({ error: "Código y CodigoArea son requeridos" }); return;
  }
  try {
    // Igual que en movimientos.ts: si la Entrada quedó abierta desde un día
    // calendario anterior, se cierra y reabre hoy antes de validar "tieneEntrada/tieneSalida hoy".
    await aplicarCorteMedianoche(Codigo);

    const hoyInicio = hoyInicioGT();
    const hoyFecha = hoyInicio.slice(0, 10);
    // Área General (TT) está exenta de planificación — siempre libre
    const AREAS_LIBRES = ["TT"];
    const necesitaPlan = !AREAS_LIBRES.includes(CodigoArea);

    // Las siguientes 6 lecturas son independientes entre sí (ninguna depende del resultado de otra),
    // así que se piden en paralelo en vez de una por una — contra una base remota cada round-trip
    // pesa ~100ms, y antes esto eran hasta 6 viajes secuenciales solo para validar.
    const [areas, empleados, prevTransf, movHoy, plan, ocupRows] = await Promise.all([
      prisma.$queryRaw`SELECT Codigo, Nombre FROM Areas WHERE Codigo = ${CodigoArea} AND Activa = 1 LIMIT 1`,
      prisma.$queryRaw`
        SELECT Codigo, CONCAT_WS(' ', PrimerNombre, SegundoNombre, PrimerApellido, SegundoApellido) AS NombreCompleto
        FROM Empleados WHERE Codigo = ${Codigo} AND Estado = 'Activo' LIMIT 1
      `,
      prisma.$queryRaw`
        SELECT t.CodigoArea, a.Nombre AS NombreArea
        FROM Transferencias t
        JOIN Areas a ON t.CodigoArea = a.Codigo
        WHERE t.Codigo = ${Codigo} AND t.FechaSalida IS NULL
        ORDER BY t.FechaHora DESC
        LIMIT 1
      `,
      prisma.$queryRaw`
        SELECT Tipo FROM Movimientos
        WHERE Codigo = ${Codigo} AND FechaHora >= ${hoyInicio}
        ORDER BY FechaHora ASC
      `,
      necesitaPlan
        ? prisma.$queryRaw`SELECT Cantidad FROM PlanificacionAreas WHERE Fecha = ${hoyFecha} AND CodigoArea = ${CodigoArea} LIMIT 1`
        : Promise.resolve([]),
      necesitaPlan
        ? prisma.$queryRaw`
            SELECT COUNT(*) AS cnt FROM Transferencias
            WHERE CodigoArea = ${CodigoArea} AND FechaHora >= ${hoyFecha} AND FechaHora < ${hoyFecha} + INTERVAL 1 DAY
              AND FechaSalida IS NULL
          `
        : Promise.resolve([]),
    ]) as any[][];

    if (!areas.length) { res.status(404).json({ error: "Área no encontrada o inactiva" }); return; }
    if (!empleados.length) { res.status(404).json({ error: "Empleado no encontrado o inactivo" }); return; }

    const ultimaArea = prevTransf.length
      ? { Codigo: prevTransf[0].CodigoArea, Nombre: prevTransf[0].NombreArea }
      : null;

    // Se evalúa el ÚLTIMO movimiento del día (no "existe algún Entrada/Salida"): en
    // turno nocturno un empleado puede tener Salida de madrugada y luego Entrada esa
    // misma noche para su siguiente turno, y ese Entrada posterior debe habilitarlo.
    const ultimoTipoHoy = movHoy.length ? movHoy[movHoy.length - 1].Tipo : null;

    if (ultimoTipoHoy !== "Entrada") {
      const error = ultimoTipoHoy === "Salida"
        ? "Ya marcó salida general, no puede registrar transferencia"
        : "No tiene entrada general registrada hoy";
      res.status(400).json({ error });
      return;
    }

    if (necesitaPlan) {
      if (!plan.length || Number(plan[0].Cantidad) === 0) {
        res.status(400).json({ error: "Área no programada para hoy" }); return;
      }
      const ocupacion = Number(ocupRows[0].cnt);
      if (ocupacion >= Number(plan[0].Cantidad)) {
        res.status(400).json({ error: `Área llena (${ocupacion}/${Number(plan[0].Cantidad)} personas)` }); return;
      }
    }

    const operador = getOperador(req);

    // Cerrar el área anterior y abrir la nueva en una sola transacción, con la persona bloqueada: en dos
    // pasos sueltos, dos kioscos (o un doble escaneo) a la vez no cerraban nada los dos y dejaban dos
    // áreas abiertas (27 nov 2026).
    await prisma.$transaction(async tx => {
      await bloquearEmpleado(tx, Codigo);
      const ahora = nowGT();
      await tx.$executeRaw`
        UPDATE Transferencias SET FechaSalida = ${ahora}
        WHERE Codigo = ${Codigo} AND FechaSalida IS NULL
      `;
      await tx.$executeRaw`
        INSERT INTO Transferencias (Codigo, CodigoArea, FechaHora, RegistradoPor)
        VALUES (${Codigo}, ${CodigoArea}, ${ahora}, ${operador})
      `;
    }, { timeout: 15_000, maxWait: 5_000 });

    res.json({ ok: true, area: areas[0], empleado: empleados[0], ultimaArea });
  } catch (err: any) {
    if (esSegundaAbierta(err)) { res.status(409).json({ error: "Ya tiene otra área abierta en este momento. Intenta de nuevo." }); return; }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/transferencias/manual  { Codigo, CodigoArea, FechaHora, FechaSalida? }
// Alta manual de admin — corrección por falta de gafete, sin las validaciones de cupo/turno del
// flujo de kiosco (POST /). Desde el 27 nov 2026 sí acomoda las demás transferencias de la persona que
// se cruzan con esta (ver acomodarVecinas): antes quedaban dos áreas abiertas a la vez.
router.post("/manual", requireAuth, requirePerm("transferencias", "editar"), async (req: Request, res: Response) => {
  try {
    const { Codigo, CodigoArea, FechaHora, FechaSalida } = req.body;
    if (!Codigo || !CodigoArea || !FechaHora) {
      res.status(400).json({ error: "Código, Área y Fecha/Hora de entrada son requeridos" }); return;
    }

    const [empleados, areas] = await Promise.all([
      prisma.$queryRaw`
        SELECT Codigo, CONCAT_WS(' ', PrimerNombre, SegundoNombre, PrimerApellido, SegundoApellido) AS NombreCompleto
        FROM Empleados WHERE Codigo = ${Codigo} LIMIT 1
      `,
      prisma.$queryRaw`SELECT Codigo FROM Areas WHERE Codigo = ${CodigoArea} LIMIT 1`,
    ]) as any[][];
    if (!empleados.length) { res.status(404).json({ error: "Empleado no encontrado" }); return; }
    if (!areas.length) { res.status(404).json({ error: "Área no encontrada" }); return; }

    const fh  = FechaHora.replace("T", " ") + (FechaHora.length === 16 ? ":00" : "");
    const fhs = FechaSalida
      ? FechaSalida.replace("T", " ") + (FechaSalida.length === 16 ? ":00" : "")
      : null;
    if (fhs && fhs < fh) { res.status(400).json({ error: "La hora de salida no puede ser anterior a la de entrada" }); return; }

    const operador = getOperador(req);
    const ajustes = await prisma.$transaction(async tx => {
      await bloquearEmpleado(tx, Codigo);
      const ajustes = await acomodarVecinas(tx, { id: null, codigo: Codigo, fh, fhs, usuario: operador });
      await tx.$executeRaw`
        INSERT INTO Transferencias (Codigo, CodigoArea, FechaHora, FechaSalida, RegistradoPor)
        VALUES (${Codigo}, ${CodigoArea}, ${fh}, ${fhs}, ${operador})
      `;
      const [{ id }]: any[] = await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`);
      await registrarBitacora(tx, { tabla: "Transferencias", id: Number(id), accion: "CREAR", antes: null,
        despues: await leerMarcaje(tx, "Transferencias", Number(id)), usuario: operador });
      return ajustes;
    }, { timeout: 15_000, maxWait: 5_000 });
    res.status(201).json({ ok: true, Ajustes: ajustes.map(a => a.cambio) });
  } catch (err: any) {
    if (err instanceof ErrorTraslape) { res.status(err.status).json({ error: err.message }); return; }
    if (esSegundaAbierta(err)) { res.status(409).json({ error: "La persona ya tiene otra área abierta." }); return; }
    res.status(500).json({ error: err.message });
  }
});

// GET /api/transferencias/hoy?area=CODIGO  (terminal de kiosco — requiere sesión)
// Sin "area": últimas 15 transferencias del día (actividad general).
// Con "area": últimas 20 personas que se dieron transferencia específicamente a esa área.
router.get("/hoy", requireAuth, async (req: Request, res: Response) => {
  try {
    const hoyInicio = hoyInicioGT();
    const area = req.query.area as string | undefined;
    const filtroArea = area ? "AND t.CodigoArea = ?" : "";
    const limite = area ? 20 : 15;
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        t.id, t.Codigo,
        CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido) AS NombreCompleto,
        t.CodigoArea,
        a.Nombre   AS NombreArea,
        DATE_FORMAT(t.FechaHora,   '%H:%i:%s') AS HoraEntrada,
        DATE_FORMAT(t.FechaSalida, '%H:%i:%s') AS HoraSalida,
        TIMESTAMPDIFF(MINUTE, t.FechaHora, COALESCE(t.FechaSalida, NOW())) AS Minutos,
        t.RegistradoPor
      FROM Transferencias t
      JOIN Empleados e ON t.Codigo     = e.Codigo
      JOIN Areas     a ON t.CodigoArea = a.Codigo
      WHERE t.FechaHora >= ? ${filtroArea}
      ORDER BY t.FechaHora DESC
      LIMIT ${limite}
    `, hoyInicio, ...(area ? [area] : []));
    res.json(rows.map(r => ({ ...r, Minutos: Number(r.Minutos) })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/transferencias?fecha=YYYY-MM-DD → registros desde esa fecha en adelante
router.get("/", requireAuth, requirePerm("transferencias", "ver"), async (req: Request, res: Response) => {
  try {
    const fecha = (req.query.fecha as string) ||
      new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
    const inicio = `${fecha} 00:00:00`;
    const rows: any[] = await prisma.$queryRaw`
      SELECT
        t.id, t.Codigo,
        CONCAT_WS(' ', e.PrimerNombre, e.SegundoNombre, e.PrimerApellido, e.SegundoApellido) AS NombreCompleto,
        t.CodigoArea,
        a.Nombre   AS NombreArea,
        DATE_FORMAT(t.FechaHora,   '%Y-%m-%d')       AS Fecha,
        DATE_FORMAT(t.FechaHora,   '%Y-%m-%dT%H:%i') AS FechaHoraInput,
        DATE_FORMAT(t.FechaSalida, '%Y-%m-%dT%H:%i') AS FechaSalidaInput,
        DATE_FORMAT(t.FechaHora,   '%H:%i:%s')        AS HoraEntrada,
        DATE_FORMAT(t.FechaSalida, '%H:%i:%s')        AS HoraSalida,
        TIMESTAMPDIFF(MINUTE, t.FechaHora, COALESCE(t.FechaSalida, NOW())) AS Minutos,
        t.RegistradoPor
      FROM Transferencias t
      JOIN Empleados e ON t.Codigo     = e.Codigo
      JOIN Areas     a ON t.CodigoArea = a.Codigo
      WHERE t.FechaHora >= ${inicio}
      ORDER BY t.FechaHora ASC
    `;
    res.json(rows.map(r => ({ ...r, Minutos: Number(r.Minutos) })));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/transferencias/bitacora?codigo= — quién creó a mano, corrigió o borró transferencias.
router.get("/bitacora", requireAuth, requirePerm("transferencias", "ver"), async (req: Request, res: Response) => {
  try {
    const codigo = req.query.codigo ? String(req.query.codigo).trim().toUpperCase() : undefined;
    res.json(await listarBitacora(prisma, "Transferencias", codigo));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /api/transferencias/:id  { Codigo, CodigoArea, FechaHora, FechaSalida }
router.put("/:id", requireAuth, requirePerm("transferencias", "editar"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { Codigo, CodigoArea, FechaHora, FechaSalida } = req.body;
    if (!Codigo || !CodigoArea || !FechaHora) {
      res.status(400).json({ error: "Código, Área y Fecha/Hora de entrada son requeridos" }); return;
    }

    const [empleados, areas] = await Promise.all([
      prisma.$queryRaw`SELECT Codigo FROM Empleados WHERE Codigo = ${Codigo} LIMIT 1`,
      prisma.$queryRaw`SELECT Codigo FROM Areas WHERE Codigo = ${CodigoArea} LIMIT 1`,
    ]) as any[][];
    if (!empleados.length) { res.status(404).json({ error: "Empleado no encontrado" }); return; }
    if (!areas.length) { res.status(404).json({ error: "Área no encontrada" }); return; }

    const fh  = FechaHora.replace("T", " ") + (FechaHora.length === 16 ? ":00" : "");
    const fhs = FechaSalida
      ? FechaSalida.replace("T", " ") + (FechaSalida.length === 16 ? ":00" : "")
      : null;
    if (fhs && fhs < fh) { res.status(400).json({ error: "La hora de salida no puede ser anterior a la de entrada" }); return; }

    // Quién corrigió y lo que había antes van a la bitácora, en la misma transacción. Las vecinas que
    // se cruzan con el nuevo horario se acomodan primero (ver acomodarVecinas): 125 de las 146
    // correcciones que dejaron cruces hasta nov 2026 eran una vecina que quedaba igual.
    const usuario = getOperador(req);
    const resultado = await prisma.$transaction(async tx => {
      const [actual]: any[] = await tx.$queryRaw`SELECT Codigo FROM Transferencias WHERE id = ${id}`;
      if (!actual) return null;
      // Primero las personas (en orden fijo) y después la fila: el mismo orden que el kiosco.
      for (const c of [...new Set([String(actual.Codigo), String(Codigo)])].sort()) await bloquearEmpleado(tx, c);
      const antes = await leerMarcaje(tx, "Transferencias", id);
      if (!antes) return null;
      const ajustes = await acomodarVecinas(tx, { id, codigo: Codigo, fh, fhs, usuario });
      await tx.$executeRaw`
        UPDATE Transferencias SET Codigo = ${Codigo}, CodigoArea = ${CodigoArea}, FechaHora = ${fh}, FechaSalida = ${fhs} WHERE id = ${id}
      `;
      const despues = await leerMarcaje(tx, "Transferencias", id);
      if (JSON.stringify(antes) !== JSON.stringify(despues))
        await registrarBitacora(tx, { tabla: "Transferencias", id, accion: "EDITAR", antes, despues, usuario });
      return ajustes;
    }, { timeout: 15_000, maxWait: 5_000 });
    if (!resultado) { res.status(404).json({ error: "La transferencia ya no existe" }); return; }
    res.json({ ok: true, Ajustes: resultado.map(a => a.cambio) });
  } catch (err: any) {
    if (err instanceof ErrorTraslape) { res.status(err.status).json({ error: err.message }); return; }
    if (esSegundaAbierta(err)) { res.status(409).json({ error: "La persona ya tiene otra área abierta." }); return; }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/transferencias/:id
router.delete("/:id", requireAuth, requirePerm("transferencias", "eliminar"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.$transaction(async tx => {
      const antes = await leerMarcaje(tx, "Transferencias", id);
      if (!antes) return;
      await tx.$executeRaw`DELETE FROM Transferencias WHERE id = ${id}`;
      await registrarBitacora(tx, { tabla: "Transferencias", id, accion: "BORRAR", antes, despues: null, usuario: getOperador(req) });
    });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
