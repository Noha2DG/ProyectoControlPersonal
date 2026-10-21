import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";
import { componerCodigoLote, piscinaRequiereCiclo } from "../lib/codigoLote.ts";
import { sqlAjustesLote } from "../lib/destajoPiso.ts";

const router = Router();

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

// Formato: <letraAño><díaSemanaISO><semanaISO><primeraParteDePiscina>-<segundaParteDePiscina>-<ciclo>
// ej. piscina "EM07-E01", martes (2) semana 27 de 2026 (G), ciclo 5 → G227EM07-E01-5
//
// La fecha que entra aquí es la de PRODUCCIÓN, no la de ingreso al área: lo que se recibe hoy pudo
// producirse ayer, y el lote debe llamarse por el día en que se produjo. Es la misma fecha con la
// que Etiquetado compone este código (ordenEtiquetado.ts), que es lo que hace que ambos módulos
// generen exactamente el mismo texto para el mismo lote físico.
//
// Un sifón (o una maquila/importación) es un lote universal del día: no lleva ciclo y lo único que lo
// separa es la finca, que ya viene dentro del nombre de la piscina (EM-SIFON vs TM-SIFON). Por eso su
// código termina en la piscina, sin nada más — igual que ya lo genera Etiquetado en ordenEtiquetado.ts,
// que para el mismo sifón y día debe producir exactamente este texto.
//
// El correlativo del día se conserva solo para una piscina de cultivo capturada sin ciclo: ahí el
// número sí distingue capturas que de otro modo chocarían, porque el ciclo es el que las separa.
async function generarCodigoLote(piscinaId: number, fechaProduccion: string, cicloNumero?: number) {
  const piscinas: any[] = await prisma.$queryRaw`SELECT Nombre, CodigoFinca FROM Piscina WHERE PiscinaId = ${piscinaId} LIMIT 1`;
  if (!piscinas.length) return null;
  const { Nombre, CodigoFinca } = piscinas[0];
  let secuencial: string;
  if (cicloNumero) {
    secuencial = String(cicloNumero);
  } else if (!piscinaRequiereCiclo(String(Nombre), String(CodigoFinca))) {
    secuencial = "";
  } else {
    // Se cuenta por FechaProduccion y no por Fecha porque el correlativo lo único que hace es
    // desempatar códigos que comparten el mismo segmento de fecha, y ese segmento sale de la fecha
    // de producción. El COALESCE es por las filas anteriores a la columna (ver
    // scripts/alterLotesFechaProduccion.ts): para ellas Fecha ES la fecha de producción, y dejarlas
    // fuera de la cuenta haría que el correlativo se repitiera contra un lote que ya existe.
    const countRows: any[] = await prisma.$queryRaw`SELECT COUNT(*) AS n FROM Lotes WHERE COALESCE(FechaProduccion, Fecha) = ${fechaProduccion}`;
    secuencial = String(Number(countRows[0].n) + 1);
  }
  return componerCodigoLote(String(Nombre), fechaProduccion, secuencial);
}

// Lo bajado al piso y el descarte ya no están en la mesa: no cuentan como pendiente. Ver
// lib/destajoPiso.ts.
function formatear(rows: any[]) {
  return rows.map(r => ({
    ...r,
    PesoIngreso: Number(r.PesoIngreso),
    Procesado: Number(r.Procesado),
    Bajado: Number(r.Bajado),
    Descarte: Number(r.Descarte),
    Pendiente: Number(r.PesoIngreso) - Number(r.Bajado) - Number(r.Descarte) - Number(r.Procesado),
    Activo: Number(r.Activo) === 1,
  }));
}

const SELECT_LOTES = `
  SELECT l.Lote, l.CicloId, l.PiscinaId, l.Clase, c.Descripcion AS DescripcionClase,
         l.TallaReferencia, t.Descripcion AS DescripcionTallaReferencia,
         l.Fecha, COALESCE(l.FechaProduccion, l.Fecha) AS FechaProduccion, l.PesoIngreso, l.UM, l.AlmacenCodigo, l.Activo, l.RegistradoPor, l.Notas,
         l.Origen, ${sqlAjustesLote("l")},
         f.Codigo AS CodigoFinca, f.Descripcion AS NombreFinca, p.Nombre AS NombrePiscina,
         ci.Anio, ci.Ciclo,
         COALESCE((SELECT SUM(pd.Peso) FROM PesajeDetalle pd
                   JOIN TransaccionesProduccion tp ON pd.TransaccionId = tp.TransaccionId
                   WHERE tp.Lote = l.Lote AND tp.ClaseOrigen = l.Clase), 0) AS Procesado
  FROM Lotes l
  JOIN Clase c ON l.Clase = c.Clase
  JOIN Piscina p ON l.PiscinaId = p.PiscinaId
  JOIN Finca f ON p.CodigoFinca = f.Codigo
  LEFT JOIN Ciclo ci ON l.CicloId = ci.CicloId
  LEFT JOIN Tallas t ON l.TallaReferencia = t.Codigo
`;

// GET /api/lotes?activo=1&fecha=YYYY-MM-DD
router.get("/", requireAuth, requirePerm("destajo", "ver"), async (req: Request, res: Response) => {
  try {
    const soloActivos = req.query.activo === "1";
    const fecha = req.query.fecha as string | undefined;
    const condiciones = [
      ...(soloActivos ? ["l.Activo = 1"] : []),
      ...(fecha ? ["l.Fecha = ?"] : []),
    ];
    const args = fecha ? [fecha] : [];
    const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
    const rows: any[] = await prisma.$queryRawUnsafe(
      `${SELECT_LOTES} ${where} ORDER BY l.Fecha DESC, l.Lote DESC LIMIT 500`, ...args
    );
    res.json(formatear(rows));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/lotes  { PiscinaId, CicloNumero?, Clase, TallaReferencia?, Fecha, FechaProduccion, PesoIngreso, UM }
// El código de Lote se genera automáticamente: AñoLetra+DíaSemana+Semana - Piscina - ciclo
// (sin el último segmento cuando la piscina no lleva ciclo — sifón, maquila, importación).
// CicloNumero es el número de ciclo (ej. 6). Si no existe para esa piscina+año, se crea automáticamente.
//
// Son dos fechas distintas y cada una tiene su trabajo: Fecha es el día en que el área recibe la
// materia prima (la que fija la pantalla, siempre hoy) y FechaProduccion es el día en que se produjo,
// que es el que entra al código del lote. Se aceptan pedidos sin FechaProduccion tratándola como
// igual a Fecha para no romper llamadas viejas a la API, que es exactamente lo que hacían antes.
router.post("/", requireAuth, requirePerm("destajo", "crear"), async (req: Request, res: Response) => {
  try {
    const { PiscinaId, CicloNumero, Clase, TallaReferencia, Fecha, FechaProduccion, PesoIngreso, UM } = req.body;
    if (!PiscinaId || !Clase || !Fecha || !PesoIngreso) {
      res.status(400).json({ error: "Piscina, Clase, Fecha y Peso de ingreso son requeridos" });
      return;
    }
    const fechaProduccion = FechaProduccion || Fecha;
    if (fechaProduccion > Fecha) {
      res.status(400).json({ error: "La fecha de producción no puede ser posterior a la fecha de ingreso" });
      return;
    }

    // Los sifones, piscinas genéricas ("00-E00") y fincas proveedoras externas (Importación, Maquila,
    // Proveedores de Pescado) no son piscinas de cultivo real — nunca deben llevar ciclo, sin importar
    // lo que llegue en CicloNumero. Ver piscinaRequiereCiclo en lib/codigoLote.ts.
    const piscinaRows: any[] = await prisma.$queryRaw`SELECT Nombre, CodigoFinca FROM Piscina WHERE PiscinaId = ${Number(PiscinaId)} LIMIT 1`;
    if (!piscinaRows.length) { res.status(404).json({ error: "Piscina no encontrada" }); return; }
    const requiereCiclo = piscinaRequiereCiclo(String(piscinaRows[0].Nombre), String(piscinaRows[0].CodigoFinca));

    const cicloNum = (requiereCiclo && CicloNumero) ? Number(CicloNumero) : undefined;
    const lote = await generarCodigoLote(Number(PiscinaId), fechaProduccion, cicloNum);
    if (!lote) { res.status(404).json({ error: "Piscina no encontrada" }); return; }

    let resolvedCicloId: number | null = null;
    if (cicloNum) {
      // El año del ciclo sale de la fecha de producción, igual que la letra de año del código: un
      // lote producido el 31 de diciembre e ingresado el 1 de enero pertenece al ciclo del año viejo.
      const anio = Number(fechaProduccion.split("-")[0]);
      await prisma.$executeRaw`
        INSERT IGNORE INTO Ciclo (PiscinaId, Anio, Ciclo)
        VALUES (${Number(PiscinaId)}, ${anio}, ${cicloNum})
      `;
      const rows: any[] = await prisma.$queryRaw`
        SELECT CicloId FROM Ciclo
        WHERE PiscinaId = ${Number(PiscinaId)} AND Anio = ${anio} AND Ciclo = ${cicloNum}
        LIMIT 1
      `;
      resolvedCicloId = rows[0]?.CicloId ? Number(rows[0].CicloId) : null;
    }

    const operador = getOperador(req);
    await prisma.$executeRaw`
      INSERT INTO Lotes (Lote, CicloId, PiscinaId, Clase, TallaReferencia, Fecha, FechaProduccion, PesoIngreso, UM, RegistradoPor)
      VALUES (${lote}, ${resolvedCicloId}, ${Number(PiscinaId)}, ${Clase}, ${TallaReferencia ? Number(TallaReferencia) : null}, ${Fecha}, ${fechaProduccion}, ${Number(PesoIngreso)}, ${UM || "KG"}, ${operador})
    `;
    res.status(201).json({ ok: true, Lote: lote });
  } catch (err: any) {
    // Con la fecha de producción dentro del código, el mismo lote recibido en dos días distintos cae
    // aquí: el código no cambia porque es el mismo lote físico. Lo correcto es sumarle el peso a la
    // fila que ya existe, no crear una segunda.
    if (err.message?.includes("Duplicate")) res.status(400).json({ error: "Ya existe este lote para esa clase — edítalo para sumarle el peso de ingreso que está recibiendo" });
    else if (err.message?.includes("foreign key")) res.status(400).json({ error: "Piscina, Clase o Talla no válidos" });
    else res.status(500).json({ error: err.message });
  }
});

// PUT /api/lotes/:lote/:clase  { PesoIngreso, Fecha, FechaProduccion?, TallaReferencia?, Activo, CicloNumero? }
// El texto de Lote puede repetirse entre Clases del mismo Piscina+Ciclo+Fecha (ver
// project_destajo_lote_clase_en_codigo) — la fila real siempre se identifica por Lote+Clase juntos.
router.put("/:lote/:clase", requireAuth, requirePerm("destajo", "editar"), async (req: Request, res: Response) => {
  try {
    const { PesoIngreso, Fecha, FechaProduccion, TallaReferencia, Activo, CicloNumero } = req.body;
    const lote = req.params.lote;
    const clase = req.params.clase;

    // No se puede dejar el peso de ingreso por debajo de lo que ese lote ya tiene procesado, bajado
    // al piso o descartado — si no, el lote queda con Pendiente negativo y bloquea cualquier pesaje
    // futuro sin explicación.
    const [cuadre]: any[] = await prisma.$queryRawUnsafe(`
      SELECT l.PesoIngreso, l.Origen,
             COALESCE((SELECT SUM(pd.Peso) FROM PesajeDetalle pd JOIN TransaccionesProduccion tp ON pd.TransaccionId = tp.TransaccionId
                        WHERE tp.Lote = l.Lote AND tp.ClaseOrigen = l.Clase), 0) AS Procesado,
             ${sqlAjustesLote("l")}
        FROM Lotes l WHERE l.Lote = ? AND l.Clase = ? LIMIT 1`, lote, clase);
    if (!cuadre) { res.status(404).json({ error: "Lote no encontrado" }); return; }
    // El peso de un lote tomado del piso es el de la báscula de Descongelado: no se teclea. Para
    // corregirlo se deshace la toma en Materia Prima y se vuelve a tomar.
    if (String(cuadre.Origen) !== "MANUAL" && Math.abs(Number(PesoIngreso) - Number(cuadre.PesoIngreso)) > 0.001) {
      res.status(400).json({ error: "El peso de un lote tomado del piso no se edita: deshaga la toma y vuelva a tomarlo" });
      return;
    }
    const comprometido = Number(cuadre.Procesado) + Number(cuadre.Bajado) + Number(cuadre.Descarte);
    if (Number(PesoIngreso) < comprometido - 0.001) {
      res.status(400).json({ error: `El peso de ingreso no puede ser menor a lo ya procesado, bajado o descartado en este lote (${comprometido.toFixed(2)})` });
      return;
    }

    // Corrección de ciclo o de fecha de producción mal capturados (ej. dejaron el ciclo en blanco, o
    // marcaron producción de hoy lo que se produjo ayer): el texto de Lote lleva el ciclo al final y
    // la fecha de producción al principio (ver componerCodigoLote), así que corregir cualquiera de
    // los dos implica regenerar el código y mover la llave primaria de Lotes. Eso solo es seguro si todavía no existe
    // ninguna TransaccionesProduccion apuntando a este Lote+Clase (misma condición que ya usa el
    // DELETE) — si ya hay transacciones, la FK compuesta (Lote,ClaseOrigen)->Lotes(Lote,Clase) impediría
    // el cambio y de todas formas ya no sería una simple corrección de captura.
    let loteFinal = lote;
    let cicloIdFinal: number | null | undefined = undefined;
    const actual: any[] = await prisma.$queryRaw`
      SELECT l.PiscinaId, l.CicloId, COALESCE(l.FechaProduccion, l.Fecha) AS FechaProduccion, p.Nombre AS NombrePiscina, p.CodigoFinca
      FROM Lotes l JOIN Piscina p ON l.PiscinaId = p.PiscinaId
      WHERE l.Lote = ${lote} AND l.Clase = ${clase} LIMIT 1
    `;
    if (!actual.length) { res.status(404).json({ error: "Lote no encontrado" }); return; }
    const piscinaId = Number(actual[0].PiscinaId);
    const requiereCiclo = piscinaRequiereCiclo(String(actual[0].NombrePiscina), String(actual[0].CodigoFinca));

    // La FechaProduccion guardada llega como DATE a medianoche UTC; se lee con toISOString (igual que
    // el resto del backend) y se compara en texto "YYYY-MM-DD" con la que manda la pantalla. Con
    // toLocaleDateString saldría el día anterior, porque Guatemala está detrás de UTC.
    // Viene por COALESCE, así que nunca es null aunque la fila sea anterior a la columna.
    const fechaProduccionActual = new Date(actual[0].FechaProduccion).toISOString().slice(0, 10);
    const fechaProduccion = FechaProduccion || fechaProduccionActual;
    if (fechaProduccion > Fecha) {
      res.status(400).json({ error: "La fecha de producción no puede ser posterior a la fecha de ingreso" });
      return;
    }

    const cicloActualRows: any[] = actual[0].CicloId
      ? await prisma.$queryRaw`SELECT Ciclo FROM Ciclo WHERE CicloId = ${actual[0].CicloId} LIMIT 1`
      : [];
    const cicloActual = cicloActualRows[0]?.Ciclo ?? null;
    const cambiaCiclo = requiereCiclo && !!CicloNumero && Number(CicloNumero) !== Number(cicloActual);
    const cambiaFechaProduccion = fechaProduccion !== fechaProduccionActual;

    if (cambiaCiclo || cambiaFechaProduccion) {
      const trans: any[] = await prisma.$queryRaw`SELECT COUNT(*) AS n FROM TransaccionesProduccion WHERE Lote = ${lote} AND ClaseOrigen = ${clase}`;
      if (Number(trans[0].n) > 0) {
        const que = cambiaCiclo && cambiaFechaProduccion ? "el ciclo ni la fecha de producción"
          : cambiaCiclo ? "el ciclo" : "la fecha de producción";
        res.status(400).json({ error: `No se puede corregir ${que}: este lote ya tiene transacciones de producción registradas` });
        return;
      }
      const cicloEfectivo = cambiaCiclo ? Number(CicloNumero) : (cicloActual ? Number(cicloActual) : undefined);
      const nuevoLote = await generarCodigoLote(piscinaId, fechaProduccion, cicloEfectivo);
      if (!nuevoLote) { res.status(404).json({ error: "Piscina no encontrada" }); return; }
      loteFinal = nuevoLote;
      if (cicloEfectivo) {
        const anio = Number(fechaProduccion.split("-")[0]);
        await prisma.$executeRaw`
          INSERT IGNORE INTO Ciclo (PiscinaId, Anio, Ciclo)
          VALUES (${piscinaId}, ${anio}, ${cicloEfectivo})
        `;
        const nuevoCicloRows: any[] = await prisma.$queryRaw`
          SELECT CicloId FROM Ciclo WHERE PiscinaId = ${piscinaId} AND Anio = ${anio} AND Ciclo = ${cicloEfectivo} LIMIT 1
        `;
        cicloIdFinal = nuevoCicloRows[0]?.CicloId ? Number(nuevoCicloRows[0].CicloId) : null;
      } else {
        cicloIdFinal = null;
      }
    }

    const activo = Activo === false || Activo === 0 ? 0 : 1;
    if (cicloIdFinal !== undefined) {
      await prisma.$executeRaw`
        UPDATE Lotes SET Lote = ${loteFinal}, CicloId = ${cicloIdFinal}, PesoIngreso = ${Number(PesoIngreso)}, Fecha = ${Fecha}, FechaProduccion = ${fechaProduccion}, TallaReferencia = ${TallaReferencia ? Number(TallaReferencia) : null}, Activo = ${activo}
        WHERE Lote = ${lote} AND Clase = ${clase}
      `;
    } else {
      await prisma.$executeRaw`
        UPDATE Lotes SET PesoIngreso = ${Number(PesoIngreso)}, Fecha = ${Fecha}, FechaProduccion = ${fechaProduccion}, TallaReferencia = ${TallaReferencia ? Number(TallaReferencia) : null}, Activo = ${activo}
        WHERE Lote = ${lote} AND Clase = ${clase}
      `;
    }
    res.json({ ok: true, Lote: loteFinal });
  } catch (err: any) {
    if (err.message?.includes("Duplicate")) res.status(400).json({ error: "Ya existe este lote para esa clase — edítalo para ajustar el peso de ingreso" });
    else res.status(500).json({ error: err.message });
  }
});

// Las notas del lote ya no se escriben: lo que se anotaba ahí (bajados, descartes, rojo) lo lleva el
// control de Materia Prima (lib/destajoPiso.ts). La columna Lotes.Notas se queda para el historial
// y la Hoja de Lote la muestra solo para leer.

// DELETE /api/lotes/:lote/:clase  (solo si no tiene transacciones de producción registradas — corrección de error de captura)
router.delete("/:lote/:clase", requireAuth, requirePerm("destajo", "eliminar"), async (req: Request, res: Response) => {
  try {
    const lote = req.params.lote;
    const clase = req.params.clase;
    const trans: any[] = await prisma.$queryRaw`SELECT COUNT(*) AS n FROM TransaccionesProduccion WHERE Lote = ${lote} AND ClaseOrigen = ${clase}`;
    if (Number(trans[0].n) > 0) {
      res.status(400).json({ error: "No se puede eliminar: este lote ya tiene transacciones de producción registradas" });
      return;
    }
    // Un lote tomado del piso tiene su producto enlazado en el kardex: borrarlo a secas lo dejaría
    // fuera del piso y fuera de Destajo. Se deshacen sus movimientos y el lote se va solo.
    const piso: any[] = await prisma.$queryRaw`SELECT COUNT(*) AS n FROM MovimientoPiso WHERE LoteProceso = ${lote} AND ClaseProceso = ${clase}`;
    if (Number(piso[0].n) > 0) {
      res.status(400).json({ error: "Este lote se tomó del piso: no se elimina, se devuelve al piso" });
      return;
    }
    await prisma.$executeRaw`DELETE FROM Lotes WHERE Lote = ${lote} AND Clase = ${clase}`;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
