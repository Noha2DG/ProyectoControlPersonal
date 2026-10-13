import { Prisma } from "@prisma/client";

// Reglas de vigencia de tarifas (tablas en backend/scripts/createTarifas.ts). Todas reciben la
// transacción: cada operación cierra/abre varios rangos y tiene que quedar todo o nada.
//
// Rangos [VigenteDesde, VigenteHasta], Hasta NULL = vigente. Las fechas se calculan en SQL
// (DATE_SUB/DATE_ADD) y se devuelven con DATE_FORMAT: nunca `new Date()` sobre un DATE del backend.

type Tx = Prisma.TransactionClient;

export class ErrorTarifa extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function validarFecha(valor: any, campo = "La fecha"): string {
  const s = String(valor ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s))) throw new ErrorTarifa(400, `${campo} no es válida`);
  return s;
}
const fechaOpcional = (valor: any, campo: string) => (valor == null || valor === "" ? null : validarFecha(valor, campo));

function validarRango(desde: string, hasta: string | null) {
  if (hasta && hasta < desde) throw new ErrorTarifa(400, "La fecha final no puede ser antes de la inicial");
}

// ── Versiones de tarifas ─────────────────────────────────────────────

// Solo la tarifa: la meta del día y la Lb/hr se calculan de ella (salario mínimo ÷ tarifa; ÷ horas).
// Talla null = tarifa única del grupo (TIEMPO y POOL).
export interface LineaTarifa { Talla: number | null; Tarifa: number }

// Cómo se paga el grupo (ver backend/scripts/alterTarifasModalidad.ts):
//   OBRA   → una línea por talla; el grupo lo decide la clase de la pesada.
//   TIEMPO → una sola línea sin talla (Q por hora); con BaseMinimo no lleva versiones: la hora vale
//            salario mínimo ÷ horas de jornada.
//   POOL   → una sola línea sin talla (Q por unidad del área: libras empacadas, etc.).
export interface InfoGrupo { Grupo: string; Modalidad: "OBRA" | "TIEMPO" | "POOL"; BaseMinimo: boolean }

async function validarDetalle(tx: Tx, detalle: any, g: InfoGrupo): Promise<LineaTarifa[]> {
  if (g.Modalidad === "TIEMPO" && g.BaseMinimo) {
    throw new ErrorTarifa(400, "Este grupo se paga con el salario mínimo por hora: no lleva versiones de tarifa");
  }
  if (g.Modalidad !== "OBRA") {
    if (!Array.isArray(detalle) || detalle.length !== 1) throw new ErrorTarifa(400, "Este grupo lleva una sola tarifa, sin talla");
    const tarifa = Number(detalle[0].Tarifa);
    if (!(tarifa > 0)) throw new ErrorTarifa(400, "La tarifa debe ser mayor que cero");
    return [{ Talla: null, Tarifa: Math.round(tarifa * 10000) / 10000 }];
  }
  if (!Array.isArray(detalle) || !detalle.length) throw new ErrorTarifa(400, "La versión no tiene tallas");
  const vistas = new Set<number>();
  const lineas = detalle.map((d: any) => {
    const talla = Number(d.Talla), tarifa = Number(d.Tarifa);
    if (!Number.isInteger(talla)) throw new ErrorTarifa(400, "Talla inválida");
    if (vistas.has(talla)) throw new ErrorTarifa(400, `La talla ${talla} está repetida`);
    vistas.add(talla);
    if (!(tarifa > 0)) throw new ErrorTarifa(400, `La tarifa de la talla ${talla} debe ser mayor que cero`);
    return { Talla: talla, Tarifa: Math.round(tarifa * 10000) / 10000 };
  });
  // Solo tallas activas: los códigos anulados (p. ej. 316/326, la otra escala de 21/25 y 31/35) ya no se pesan.
  const activas: any[] = await tx.$queryRaw`
    SELECT Codigo FROM Tallas WHERE Activo = 1 AND Codigo IN (${Prisma.join(lineas.map((l: LineaTarifa) => l.Talla))})`;
  const ok = new Set(activas.map(a => Number(a.Codigo)));
  const malas = lineas.filter(l => !ok.has(l.Talla)).map(l => l.Talla);
  if (malas.length) throw new ErrorTarifa(400, `Tallas inexistentes o inactivas: ${malas.join(", ")}`);
  return lineas;
}

async function versionPara(tx: Tx, id: number) {
  const r: any[] = await tx.$queryRaw`
    SELECT VersionId, Grupo, Estado, DATE_FORMAT(VigenteDesde, '%Y-%m-%d') AS Desde,
           DATE_FORMAT(VigenteHasta, '%Y-%m-%d') AS Hasta
    FROM TarifaVersion WHERE VersionId = ${id} FOR UPDATE`;
  if (!r.length) throw new ErrorTarifa(404, "La versión no existe");
  return r[0] as { VersionId: number; Grupo: string; Estado: string; Desde: string; Hasta: string | null };
}

async function grupoActivo(tx: Tx, grupo: string): Promise<InfoGrupo> {
  const g: any[] = await tx.$queryRaw`SELECT Grupo, Activo, Modalidad, BaseMinimo FROM TarifaGrupo WHERE Grupo = ${grupo}`;
  if (!g.length) throw new ErrorTarifa(400, "El grupo no existe");
  if (Number(g[0].Activo) !== 1) throw new ErrorTarifa(400, "El grupo está inactivo");
  return { Grupo: g[0].Grupo, Modalidad: g[0].Modalidad, BaseMinimo: Number(g[0].BaseMinimo) === 1 };
}

async function reemplazarDetalle(tx: Tx, id: number, lineas: LineaTarifa[]) {
  await tx.$executeRaw`DELETE FROM Tarifas WHERE VersionId = ${id}`;
  for (const l of lineas) {
    await tx.$executeRaw`INSERT INTO Tarifas (VersionId, Talla, Tarifa) VALUES (${id}, ${l.Talla}, ${l.Tarifa})`;
  }
}

// Crea (sin VersionId) o reescribe un BORRADOR completo: encabezado y todas sus tallas.
export async function guardarBorrador(tx: Tx, body: any, usuario: string): Promise<number> {
  const grupo = String(body.Grupo ?? "").trim();
  const desde = validarFecha(body.VigenteDesde, "La fecha de inicio");
  const hasta = fechaOpcional(body.VigenteHasta, "La fecha final");
  validarRango(desde, hasta);
  const motivo = String(body.Motivo ?? "").trim().slice(0, 255) || null;

  let id = Number(body.VersionId) || 0;
  let lineas: LineaTarifa[];
  if (id) {
    const v = await versionPara(tx, id);
    if (v.Estado !== "BORRADOR") throw new ErrorTarifa(400, "Solo se puede editar una versión en borrador");
    lineas = await validarDetalle(tx, body.detalle, await grupoActivo(tx, v.Grupo));
    await tx.$executeRaw`
      UPDATE TarifaVersion SET VigenteDesde = ${desde}, VigenteHasta = ${hasta}, Motivo = ${motivo}
      WHERE VersionId = ${id}`;
  } else {
    lineas = await validarDetalle(tx, body.detalle, await grupoActivo(tx, grupo));
    await tx.$executeRaw`
      INSERT INTO TarifaVersion (Grupo, VigenteDesde, VigenteHasta, Estado, Motivo, CreadoPor)
      VALUES (${grupo}, ${desde}, ${hasta}, 'BORRADOR', ${motivo}, ${usuario})`;
    const r: any[] = await tx.$queryRaw`SELECT LAST_INSERT_ID() AS id`;
    id = Number(r[0].id);
  }
  await reemplazarDetalle(tx, id, lineas);
  return id;
}

export async function eliminarBorrador(tx: Tx, id: number) {
  const v = await versionPara(tx, id);
  if (v.Estado !== "BORRADOR") throw new ErrorTarifa(400, "Solo se puede eliminar un borrador; una versión aprobada se anula");
  await tx.$executeRaw`DELETE FROM TarifaVersion WHERE VersionId = ${id}`;
}

// Aprueba un borrador y acomoda las versiones aprobadas del mismo grupo para que no se traslapen:
//   · la que estaba vigente al inicio se cierra el día anterior;
//   · si la nueva tiene fecha final (tarifa de temporada) y la anterior seguía después, se crea
//     una copia aprobada de la anterior desde el día siguiente al final: así al terminar la
//     temporada se regresa sola a las tarifas de antes;
//   · si ya hay una versión aprobada que EMPIEZA dentro del rango nuevo, se rechaza: hay que
//     anularla primero (no se adivina cuál de las dos manda).
// Devuelve las versiones que se tocaron, para avisarlo en pantalla.
export async function aprobarVersion(tx: Tx, id: number, usuario: string): Promise<string[]> {
  const v = await versionPara(tx, id);
  if (v.Estado !== "BORRADOR") throw new ErrorTarifa(400, "Solo se aprueba una versión en borrador");
  const g = await grupoActivo(tx, v.Grupo);
  const det: any[] = await tx.$queryRaw`SELECT Talla, Tarifa FROM Tarifas WHERE VersionId = ${id}`;
  await validarDetalle(tx, det.map(d => ({ Talla: d.Talla == null ? null : Number(d.Talla), Tarifa: Number(d.Tarifa) })), g);

  const fin = v.Hasta ?? "9999-12-31";
  const choques: any[] = await tx.$queryRaw`
    SELECT VersionId, DATE_FORMAT(VigenteDesde, '%Y-%m-%d') AS Desde, DATE_FORMAT(VigenteHasta, '%Y-%m-%d') AS Hasta
    FROM TarifaVersion
    WHERE Grupo = ${v.Grupo} AND Estado = 'APROBADO' AND VersionId <> ${id}
      AND VigenteDesde <= ${fin} AND (VigenteHasta IS NULL OR VigenteHasta >= ${v.Desde})
    ORDER BY VigenteDesde
    FOR UPDATE`;

  const posterior = choques.find(c => c.Desde >= v.Desde);
  if (posterior) {
    throw new ErrorTarifa(400, `La versión #${posterior.VersionId} ya está aprobada desde el ${posterior.Desde}, dentro de este rango. Anúlala primero.`);
  }

  const cambios: string[] = [];
  for (const c of choques) {
    // Empieza antes que la nueva: se corta el día anterior al inicio.
    const sigueDespues = v.Hasta != null && (c.Hasta == null || c.Hasta > v.Hasta);
    await tx.$executeRaw`
      UPDATE TarifaVersion SET VigenteHasta = DATE_SUB(${v.Desde}, INTERVAL 1 DAY) WHERE VersionId = ${c.VersionId}`;
    cambios.push(`La versión #${c.VersionId} quedó vigente hasta el día anterior al ${v.Desde}.`);
    if (sigueDespues) {
      await tx.$executeRaw`
        INSERT INTO TarifaVersion (Grupo, VigenteDesde, VigenteHasta, Estado, Motivo, CreadoPor, AprobadoPor, AprobadoEn)
        VALUES (${v.Grupo}, DATE_ADD(${v.Hasta}, INTERVAL 1 DAY), ${c.Hasta}, 'APROBADO',
                ${`Regreso a la versión #${c.VersionId} al terminar la #${id}`}, ${usuario}, ${usuario}, NOW())`;
      const r: any[] = await tx.$queryRaw`SELECT LAST_INSERT_ID() AS id`;
      const copia = Number(r[0].id);
      await tx.$executeRaw`
        INSERT INTO Tarifas (VersionId, Talla, Tarifa)
        SELECT ${copia}, Talla, Tarifa FROM Tarifas WHERE VersionId = ${c.VersionId}`;
      cambios.push(`Se creó la versión #${copia} con las tarifas de la #${c.VersionId} desde el día siguiente al ${v.Hasta}.`);
    }
  }

  await tx.$executeRaw`
    UPDATE TarifaVersion SET Estado = 'APROBADO', AprobadoPor = ${usuario}, AprobadoEn = NOW() WHERE VersionId = ${id}`;
  return cambios;
}

// Anula una versión aprobada. La versión que terminaba justo el día anterior a su inicio se
// extiende para cubrir el hueco (hasta la misma fecha final, o vigente si la anulada no tenía).
// Cuando exista el módulo de planillas, aquí irá el candado: no se anula lo que ya se pagó.
export async function anularVersion(tx: Tx, id: number, usuario: string): Promise<string[]> {
  const v = await versionPara(tx, id);
  if (v.Estado !== "APROBADO") throw new ErrorTarifa(400, "Solo se anula una versión aprobada");
  await tx.$executeRaw`
    UPDATE TarifaVersion SET Estado = 'ANULADO', AnuladoPor = ${usuario}, AnuladoEn = NOW() WHERE VersionId = ${id}`;
  const previa: any[] = await tx.$queryRaw`
    SELECT VersionId FROM TarifaVersion
    WHERE Grupo = ${v.Grupo} AND Estado = 'APROBADO' AND VigenteHasta = DATE_SUB(${v.Desde}, INTERVAL 1 DAY)
    FOR UPDATE`;
  if (!previa.length) return [`Del ${v.Desde} en adelante el grupo queda sin tarifa aprobada hasta que se apruebe otra.`];
  await tx.$executeRaw`UPDATE TarifaVersion SET VigenteHasta = ${v.Hasta} WHERE VersionId = ${previa[0].VersionId}`;
  return [`La versión #${previa[0].VersionId} vuelve a cubrir ${v.Hasta ? `hasta el ${v.Hasta}` : "en adelante"}.`];
}

// ── Clases por grupo ─────────────────────────────────────────────────

// Las dos formas de decidir el grupo de un pago, con las mismas reglas de vigencia:
//   clase → TarifaGrupoClase, solo grupos OBRA (la clase de la pesada elige T-ON o T-OFF);
//   área  → TarifaGrupoArea, solo grupos TIEMPO y POOL (estar en el área es lo que se paga).
// Los nombres de tabla/campo salen de esta lista fija, nunca de la petición.
const ASIGNACION = {
  clase: { tabla: "TarifaGrupoClase", campo: "Clase", id: "GrupoClaseId", que: "La clase", modalidades: ["OBRA"] },
  area: { tabla: "TarifaGrupoArea", campo: "AreaCodigo", id: "GrupoAreaId", que: "El área", modalidades: ["TIEMPO", "POOL"] },
} as const;
export type TipoAsignacion = keyof typeof ASIGNACION;

// Pone una clase (o un área) en un grupo desde una fecha. Si ya tenía grupo vigente, ese se cierra el
// día anterior; si empezaba ese mismo día es una corrección y se cambia en su lugar.
export async function asignarGrupo(tx: Tx, tipo: TipoAsignacion, body: any, usuario: string) {
  const cfg = ASIGNACION[tipo];
  const valor = String(body[cfg.campo] ?? "").trim().toUpperCase();
  const grupo = String(body.Grupo ?? "").trim();
  const desde = validarFecha(body.VigenteDesde, "La fecha de inicio");
  const existe: any[] = tipo === "clase"
    ? await tx.$queryRaw`SELECT 1 FROM Clase WHERE Clase = ${valor}`
    : await tx.$queryRaw`SELECT 1 FROM Areas WHERE Codigo = ${valor}`;
  if (!existe.length) throw new ErrorTarifa(400, `${cfg.que} no existe`);
  const g = await grupoActivo(tx, grupo);
  if (!(cfg.modalidades as readonly string[]).includes(g.Modalidad)) {
    throw new ErrorTarifa(400, tipo === "clase"
      ? "Por clase solo se asignan grupos de obra (destajo por talla)"
      : "Por área solo se asignan grupos de tiempo o pool");
  }

  const actual: any[] = await tx.$queryRawUnsafe(
    `SELECT ${cfg.id} AS Id, Grupo, DATE_FORMAT(VigenteDesde, '%Y-%m-%d') AS Desde
     FROM ${cfg.tabla} WHERE ${cfg.campo} = ? AND VigenteHasta IS NULL FOR UPDATE`, valor);
  const a = actual[0];
  if (a) {
    if (a.Grupo === grupo) throw new ErrorTarifa(400, `${cfg.que} ${valor} ya está en ese grupo`);
    if (a.Desde > desde) throw new ErrorTarifa(400, `${cfg.que} ${valor} está en ${a.Grupo} desde el ${a.Desde}; la fecha nueva no puede ser anterior`);
    if (a.Desde === desde) {
      await tx.$executeRawUnsafe(`UPDATE ${cfg.tabla} SET Grupo = ?, CreadoPor = ? WHERE ${cfg.id} = ?`, grupo, usuario, a.Id);
      return;
    }
    await tx.$executeRawUnsafe(
      `UPDATE ${cfg.tabla} SET VigenteHasta = DATE_SUB(?, INTERVAL 1 DAY) WHERE ${cfg.id} = ?`, desde, a.Id);
  } else {
    // Sin grupo vigente: que no se encime con un rango ya cerrado.
    const encima: any[] = await tx.$queryRawUnsafe(
      `SELECT 1 FROM ${cfg.tabla} WHERE ${cfg.campo} = ? AND VigenteHasta >= ? LIMIT 1`, valor, desde);
    if (encima.length) throw new ErrorTarifa(400, `${cfg.que} ${valor} ya tenía grupo en esa fecha`);
  }
  await tx.$executeRawUnsafe(
    `INSERT INTO ${cfg.tabla} (${cfg.campo}, Grupo, VigenteDesde, CreadoPor) VALUES (?, ?, ?, ?)`, valor, grupo, desde, usuario);
}

// Saca una clase (o área) de su grupo: su último día pagado con ese grupo es `hasta`.
export async function cerrarGrupo(tx: Tx, tipo: TipoAsignacion, id: number, hastaValor: any) {
  const cfg = ASIGNACION[tipo];
  const hasta = validarFecha(hastaValor, "El último día");
  const r: any[] = await tx.$queryRawUnsafe(
    `SELECT DATE_FORMAT(VigenteDesde, '%Y-%m-%d') AS Desde, VigenteHasta FROM ${cfg.tabla} WHERE ${cfg.id} = ? FOR UPDATE`, id);
  if (!r.length) throw new ErrorTarifa(404, "El registro no existe");
  if (r[0].VigenteHasta != null) throw new ErrorTarifa(400, "Ese registro ya está cerrado");
  validarRango(r[0].Desde, hasta);
  await tx.$executeRawUnsafe(`UPDATE ${cfg.tabla} SET VigenteHasta = ? WHERE ${cfg.id} = ?`, hasta, id);
}

// Deshace el registro VIGENTE (un error de captura) y reabre el anterior si terminaba justo el día antes.
export async function deshacerGrupo(tx: Tx, tipo: TipoAsignacion, id: number) {
  const cfg = ASIGNACION[tipo];
  const r: any[] = await tx.$queryRawUnsafe(
    `SELECT ${cfg.campo} AS Valor, DATE_FORMAT(VigenteDesde, '%Y-%m-%d') AS Desde, VigenteHasta
     FROM ${cfg.tabla} WHERE ${cfg.id} = ? FOR UPDATE`, id);
  if (!r.length) throw new ErrorTarifa(404, "El registro no existe");
  if (r[0].VigenteHasta != null) throw new ErrorTarifa(400, "Solo se deshace el registro vigente");
  await tx.$executeRawUnsafe(`DELETE FROM ${cfg.tabla} WHERE ${cfg.id} = ?`, id);
  await tx.$executeRawUnsafe(
    `UPDATE ${cfg.tabla} SET VigenteHasta = NULL WHERE ${cfg.campo} = ? AND VigenteHasta = DATE_SUB(?, INTERVAL 1 DAY)`,
    r[0].Valor, r[0].Desde);
}

// ── Salario mínimo ───────────────────────────────────────────────────

// Registra el mínimo nuevo (cada año); el vigente de la misma categoría se cierra el día anterior.
export async function agregarSalario(tx: Tx, body: any, usuario: string) {
  const categoria = String(body.Categoria ?? "PLANTA").trim().toUpperCase() || "PLANTA";
  const desde = validarFecha(body.VigenteDesde, "La fecha de inicio");
  const valor = Number(body.ValorDia), horas = Number(body.HorasJornada ?? 8);
  if (!(valor > 0)) throw new ErrorTarifa(400, "El valor del día debe ser mayor que cero");
  if (!(horas > 0 && horas <= 24)) throw new ErrorTarifa(400, "Las horas de la jornada no son válidas");
  const acuerdo = String(body.Acuerdo ?? "").trim().slice(0, 150) || null;

  const actual: any[] = await tx.$queryRaw`
    SELECT SalarioMinimoId, DATE_FORMAT(VigenteDesde, '%Y-%m-%d') AS Desde
    FROM SalarioMinimo WHERE Categoria = ${categoria} AND VigenteHasta IS NULL FOR UPDATE`;
  if (actual[0]) {
    if (actual[0].Desde >= desde) throw new ErrorTarifa(400, `El mínimo vigente empieza el ${actual[0].Desde}; el nuevo debe empezar después`);
    await tx.$executeRaw`
      UPDATE SalarioMinimo SET VigenteHasta = DATE_SUB(${desde}, INTERVAL 1 DAY) WHERE SalarioMinimoId = ${actual[0].SalarioMinimoId}`;
  }
  await tx.$executeRaw`
    INSERT INTO SalarioMinimo (Categoria, VigenteDesde, ValorDia, HorasJornada, Acuerdo, CreadoPor)
    VALUES (${categoria}, ${desde}, ${valor}, ${horas}, ${acuerdo}, ${usuario})`;
}

// Deshace el mínimo VIGENTE (error de captura) y reabre el anterior.
export async function deshacerSalario(tx: Tx, id: number) {
  const r: any[] = await tx.$queryRaw`
    SELECT Categoria, DATE_FORMAT(VigenteDesde, '%Y-%m-%d') AS Desde, VigenteHasta FROM SalarioMinimo WHERE SalarioMinimoId = ${id} FOR UPDATE`;
  if (!r.length) throw new ErrorTarifa(404, "El registro no existe");
  if (r[0].VigenteHasta != null) throw new ErrorTarifa(400, "Solo se deshace el mínimo vigente");
  await tx.$executeRaw`DELETE FROM SalarioMinimo WHERE SalarioMinimoId = ${id}`;
  await tx.$executeRaw`
    UPDATE SalarioMinimo SET VigenteHasta = NULL
    WHERE Categoria = ${r[0].Categoria} AND VigenteHasta = DATE_SUB(${r[0].Desde}, INTERVAL 1 DAY)`;
}

// ── Consulta: qué tarifa aplica ──────────────────────────────────────
// Son las reglas que usará la planilla. null = "sin tarifa" (nunca Q0).

// OBRA: clase + talla + día del pesaje → grupo vigente de la clase → versión APROBADA vigente del
// grupo → tarifa de la talla.
export async function tarifaAplicable(tx: Tx, clase: string, talla: number, fecha: string) {
  const r: any[] = await tx.$queryRaw`
    SELECT gc.Grupo, g.UnidadPago, v.VersionId, t.Tarifa
    FROM TarifaGrupoClase gc
    JOIN TarifaGrupo g ON g.Grupo = gc.Grupo
    JOIN TarifaVersion v ON v.Grupo = gc.Grupo AND v.Estado = 'APROBADO'
         AND v.VigenteDesde <= ${fecha} AND (v.VigenteHasta IS NULL OR v.VigenteHasta >= ${fecha})
    JOIN Tarifas t ON t.VersionId = v.VersionId AND t.Talla = ${talla}
    WHERE gc.Clase = ${clase} AND gc.VigenteDesde <= ${fecha} AND (gc.VigenteHasta IS NULL OR gc.VigenteHasta >= ${fecha})
    LIMIT 1`;
  if (!r.length) return null;
  return { Grupo: r[0].Grupo, UnidadPago: r[0].UnidadPago, VersionId: Number(r[0].VersionId), Tarifa: Number(r[0].Tarifa) };
}

// TIEMPO y POOL: área + día → grupo vigente del área → tarifa única de la versión APROBADA vigente.
// TIEMPO basado en el mínimo: la hora = salario mínimo vigente ÷ horas de jornada (sin versión).
// En POOL la tarifa es por unidad del área (p. ej. Q por libra empacada); repartir entre quienes
// trabajaron según sus horas es trabajo de la planilla.
export async function tarifaDeArea(tx: Tx, area: string, fecha: string) {
  const g: any[] = await tx.$queryRaw`
    SELECT ga.Grupo, g.Modalidad, g.UnidadPago, g.BaseMinimo
    FROM TarifaGrupoArea ga JOIN TarifaGrupo g ON g.Grupo = ga.Grupo
    WHERE ga.AreaCodigo = ${area} AND ga.VigenteDesde <= ${fecha} AND (ga.VigenteHasta IS NULL OR ga.VigenteHasta >= ${fecha})
    LIMIT 1`;
  if (!g.length) return null;
  const base = { Grupo: g[0].Grupo, Modalidad: g[0].Modalidad, UnidadPago: g[0].UnidadPago };
  if (Number(g[0].BaseMinimo) === 1) {
    const s: any[] = await tx.$queryRaw`
      SELECT ValorDia, HorasJornada FROM SalarioMinimo
      WHERE VigenteDesde <= ${fecha} AND (VigenteHasta IS NULL OR VigenteHasta >= ${fecha})
      ORDER BY Categoria = 'PLANTA' DESC LIMIT 1`;
    if (!s.length) return null;
    return { ...base, VersionId: null, Tarifa: Number(s[0].ValorDia) / Number(s[0].HorasJornada), BaseMinimo: true };
  }
  const t: any[] = await tx.$queryRaw`
    SELECT v.VersionId, t.Tarifa
    FROM TarifaVersion v JOIN Tarifas t ON t.VersionId = v.VersionId AND t.Talla IS NULL
    WHERE v.Grupo = ${base.Grupo} AND v.Estado = 'APROBADO'
      AND v.VigenteDesde <= ${fecha} AND (v.VigenteHasta IS NULL OR v.VigenteHasta >= ${fecha})
    LIMIT 1`;
  if (!t.length) return null;
  return { ...base, VersionId: Number(t[0].VersionId), Tarifa: Number(t[0].Tarifa), BaseMinimo: false };
}

// Metas de OBRA de un día, para las vistas en vivo (mesas): una por clase + talla con tarifa
// vigente. Mismas reglas que tarifaAplicable, pero de un golpe para todas las combinaciones.
// La meta no se guarda: Lb/hr = salario mínimo del día ÷ tarifa de la talla ÷ horas de jornada
// (lo que hay que pelar para ganar el mínimo). Una clase o talla sin tarifa no sale = "sin meta".
export async function metasObraDelDia(tx: Tx, fecha: string) {
  const s: any[] = await tx.$queryRaw`
    SELECT ValorDia, HorasJornada FROM SalarioMinimo
    WHERE VigenteDesde <= ${fecha} AND (VigenteHasta IS NULL OR VigenteHasta >= ${fecha})
    ORDER BY Categoria = 'PLANTA' DESC LIMIT 1`;
  if (!s.length) return [];
  const porHora = Number(s[0].ValorDia) / Number(s[0].HorasJornada);
  const r: any[] = await tx.$queryRaw`
    SELECT gc.Clase, t.Talla, t.Tarifa
    FROM TarifaGrupoClase gc
    JOIN TarifaGrupo g ON g.Grupo = gc.Grupo AND g.Modalidad = 'OBRA'
    JOIN TarifaVersion v ON v.Grupo = gc.Grupo AND v.Estado = 'APROBADO'
         AND v.VigenteDesde <= ${fecha} AND (v.VigenteHasta IS NULL OR v.VigenteHasta >= ${fecha})
    JOIN Tarifas t ON t.VersionId = v.VersionId AND t.Talla IS NOT NULL
    WHERE gc.VigenteDesde <= ${fecha} AND (gc.VigenteHasta IS NULL OR gc.VigenteHasta >= ${fecha})`;
  return r.map(x => ({ Clase: x.Clase as string, Talla: Number(x.Talla), MetaLbHora: porHora / Number(x.Tarifa) }));
}
