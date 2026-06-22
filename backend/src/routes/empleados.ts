import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.ts";
import { requirePerm } from "../middleware/auth.ts";

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

const router = Router();

// Convierte fechas MySQL (incluyendo 0000-00-00) a string legible o null
function safeDate(val: any): string | null {
  if (!val) return null;
  const s = String(val);
  if (s.startsWith("0000") || s === "Invalid Date") return null;
  return s.split("T")[0];
}

const DETALLE_CAMPOS = [
  "PrimerNombre", "SegundoNombre", "TercerNombre", "PrimerApellido", "SegundoApellido", "ApellidoCasada",
  "PaisNacimiento", "FechaNacimiento", "DepartamentoNacimiento", "MunicipioNacimiento", "Etnia",
  "Nacionalidad", "PaisDPI", "DepartamentoDPI", "MunicipioDPI", "VencimientoDPI",
  "NIT", "SeguroSocial", "Celular", "Telefono", "PermisoTrabajo",
  "TituloPersonal", "NumeroHijos", "NivelAcademico", "TipoSangre", "Beneficiario", "Profesion",
] as const;

const SELECT_CAMPOS = `
  Codigo,
  CONCAT_WS(' ', PrimerNombre, SegundoNombre, PrimerApellido, SegundoApellido) AS NombreCompleto,
  CAST(FechaIngreso AS CHAR) AS FechaIngreso,
  CAST(FechaBaja AS CHAR) AS FechaBaja,
  Sexo, EstadoCivil, Estado, CodigoEtalent, DPI,
  PrimerNombre, SegundoNombre, TercerNombre, PrimerApellido, SegundoApellido, ApellidoCasada,
  PaisNacimiento, CAST(FechaNacimiento AS CHAR) AS FechaNacimiento,
  DepartamentoNacimiento, MunicipioNacimiento, Etnia,
  Nacionalidad, PaisDPI, DepartamentoDPI, MunicipioDPI, CAST(VencimientoDPI AS CHAR) AS VencimientoDPI,
  NIT, SeguroSocial, Celular, Telefono, PermisoTrabajo,
  TituloPersonal, NumeroHijos, NivelAcademico, TipoSangre, Beneficiario, Profesion
`;

function mapRow(row: any) {
  return {
    ...row,
    FechaIngreso: safeDate(row.FechaIngreso),
    FechaBaja: safeDate(row.FechaBaja),
    FechaNacimiento: safeDate(row.FechaNacimiento),
    VencimientoDPI: safeDate(row.VencimientoDPI),
    DPI: row.DPI !== null && row.DPI !== undefined ? Number(row.DPI) : 0,
    NumeroHijos: row.NumeroHijos !== null && row.NumeroHijos !== undefined ? Number(row.NumeroHijos) : 0,
  };
}

// GET /api/empleados
router.get("/", async (_req: Request, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT ${SELECT_CAMPOS} FROM Empleados ORDER BY NombreCompleto ASC
    `);
    res.json(rows.map(mapRow));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/empleados/siguiente-codigo?apellido=XXX
// Sugiere código = 3 primeras letras del apellido + correlativo de 4 dígitos sin repetir
router.get("/siguiente-codigo", requirePerm("empleados", "crear"), async (req: Request, res: Response) => {
  try {
    const apellido = String(req.query.apellido || "").trim().toUpperCase();
    if (!apellido) { res.status(400).json({ error: "Apellido requerido" }); return; }
    const prefijo = apellido.slice(0, 3);
    const rows: any[] = await prisma.$queryRaw`
      SELECT Codigo FROM Empleados WHERE Codigo LIKE ${prefijo + "%"}
    `;
    const re = new RegExp(`^${prefijo}(\\d+)$`, "i");
    let max = 0;
    for (const r of rows) {
      const m = re.exec(r.Codigo);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    const codigo = `${prefijo}${String(max + 1).padStart(4, "0")}`;
    res.json({ codigo });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/empleados
router.post("/", requirePerm("empleados", "crear"), async (req: Request, res: Response) => {
  try {
    const { Codigo, FechaIngreso, Sexo, EstadoCivil, CodigoEtalent, DPI } = req.body;
    const body = req.body as Record<string, any>;
    const fi = FechaIngreso || new Date().toISOString().split("T")[0];
    const operador = getOperador(req);
    const cols = ["Codigo", "FechaIngreso", "FechaBaja", "Sexo", "EstadoCivil", "Estado", "CodigoEtalent", "DPI", ...DETALLE_CAMPOS];
    const vals = [Codigo, fi, "1970-01-01", Sexo || "", EstadoCivil || "", "Activo", CodigoEtalent || null, Number(DPI) || 0,
      ...DETALLE_CAMPOS.map(c => body[c] === "" || body[c] === undefined ? null : body[c])];
    await prisma.$executeRawUnsafe(
      `INSERT INTO Empleados (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      ...vals
    );
    await prisma.$executeRaw`
      INSERT INTO Altas (Codigo, FechaAlta, Tipo, RegistradoPor)
      VALUES (${Codigo}, ${fi}, 'Nuevo', ${operador})
    `;
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT ${SELECT_CAMPOS} FROM Empleados WHERE Codigo = ?
    `, Codigo);
    res.status(201).json(mapRow(rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/empleados/:codigo
// Si body incluye Estado='Activo' → recontratación; si no → edición normal
router.put("/:codigo", requirePerm("empleados", "editar"), async (req: Request, res: Response) => {
  try {
    const codigo = req.params.codigo;
    const { FechaIngreso, Sexo, EstadoCivil, CodigoEtalent, DPI, Estado } = req.body;
    const body = req.body as Record<string, any>;

    if (Estado === "Activo") {
      const ultimaBaja: any[] = await prisma.$queryRaw`
        SELECT Recontratable FROM Bajas WHERE Codigo = ${codigo} ORDER BY FechaBaja DESC, id DESC LIMIT 1
      `;
      if (ultimaBaja.length && Number(ultimaBaja[0].Recontratable) === 0) {
        res.status(403).json({ error: "Empleado marcado como no recontratable, no se puede reactivar" });
        return;
      }

      const hoy = new Date().toISOString().split("T")[0];
      const fechaReset = "1970-01-01";
      const operador = getOperador(req);
      // Solo actualizar Estado y FechaBaja — FechaIngreso original se preserva
      await prisma.$executeRaw`
        UPDATE Empleados
        SET Estado = 'Activo', FechaBaja = ${fechaReset}
        WHERE Codigo = ${codigo}
      `;
      await prisma.$executeRaw`
        INSERT INTO Altas (Codigo, FechaAlta, Tipo, RegistradoPor)
        VALUES (${codigo}, ${hoy}, 'Reingreso', ${operador})
      `;
    } else {
      const fi = FechaIngreso || "1970-01-01";
      const setSql = ["FechaIngreso = ?", "Sexo = ?", "EstadoCivil = ?", "CodigoEtalent = ?", "DPI = ?",
        ...DETALLE_CAMPOS.map(c => `${c} = ?`)].join(", ");
      const vals = [fi, Sexo || "", EstadoCivil || "", CodigoEtalent || null, Number(DPI) || 0,
        ...DETALLE_CAMPOS.map(c => body[c] === "" || body[c] === undefined ? null : body[c])];
      await prisma.$executeRawUnsafe(
        `UPDATE Empleados SET ${setSql} WHERE Codigo = ?`,
        ...vals, codigo
      );
    }

    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT ${SELECT_CAMPOS} FROM Empleados WHERE Codigo = ?
    `, codigo);
    res.json(mapRow(rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/empleados/:codigo → baja lógica + registro en tabla Bajas
router.delete("/:codigo", requirePerm("empleados", "baja"), async (req: Request, res: Response) => {
  try {
    const codigo = req.params.codigo;
    const { Motivo, Recontratable, Observaciones, FechaBaja } = req.body;
    const fechaBaja = FechaBaja || new Date().toISOString().split("T")[0];
    const operador = getOperador(req);
    const recontratable = Recontratable === false || Recontratable === 0 ? 0 : 1;

    await prisma.$executeRaw`
      UPDATE Empleados
      SET Estado = 'Baja', FechaBaja = ${fechaBaja}
      WHERE Codigo = ${codigo}
    `;
    await prisma.$executeRaw`
      INSERT INTO Bajas (Codigo, FechaBaja, Motivo, Recontratable, Observaciones, RegistradoPor)
      VALUES (${codigo}, ${fechaBaja}, ${Motivo || "Sin especificar"}, ${recontratable}, ${Observaciones || null}, ${operador})
    `;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/empleados/:codigo/bajas → historial de bajas
router.get("/:codigo/bajas", async (req: Request, res: Response) => {
  try {
    const codigo = req.params.codigo;
    const rows: any[] = await prisma.$queryRaw`
      SELECT id, Codigo, DATE_FORMAT(FechaBaja, '%Y-%m-%d') AS FechaBaja,
             Motivo, Recontratable, Observaciones, RegistradoPor,
             DATE_FORMAT(CreadoEn, '%Y-%m-%d %H:%i') AS CreadoEn
      FROM Bajas WHERE Codigo = ${codigo}
      ORDER BY CreadoEn DESC
    `;
    res.json(rows.map(r => ({ ...r, Recontratable: Number(r.Recontratable) === 1 })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


export default router;
