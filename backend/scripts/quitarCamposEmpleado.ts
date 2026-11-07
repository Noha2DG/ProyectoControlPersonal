import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import prisma from "../src/lib/prisma.ts";

// 7 nov 2026: se quitaron del modal de empleado 11 campos que ya no se usan.
//   (sin flag)  muestra cuántos empleados tienen dato en cada campo
//   --vaciar    respalda Codigo + los 11 campos a Documents/respaldos y los pone en NULL
//   --drop      quita las columnas (SOLO después de desplegar el código que ya no las lee)
const CAMPOS = ["Etnia", "Nacionalidad", "PaisDPI", "DepartamentoDPI", "MunicipioDPI", "VencimientoDPI",
  "Telefono", "PermisoTrabajo", "TituloPersonal", "TipoSangre", "Beneficiario"];

const existentes = async () => {
  const r: any[] = await prisma.$queryRawUnsafe(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Empleados'
     AND COLUMN_NAME IN (${CAMPOS.map(() => "?").join(",")})`, ...CAMPOS);
  return CAMPOS.filter(c => r.some(x => x.COLUMN_NAME === c));
};

const cols = await existentes();
if (!cols.length) { console.log("Las columnas ya no existen."); process.exit(0); }
const conDato = cols.map(c => `(${c} IS NOT NULL AND TRIM(${c}) <> '')`).join(" OR ");

if (process.argv.includes("--vaciar")) {
  const filas: any[] = await prisma.$queryRawUnsafe(
    `SELECT Codigo, ${cols.map(c => `CAST(${c} AS CHAR) AS ${c}`).join(", ")} FROM Empleados WHERE ${conDato}`);
  const dir = path.join(os.homedir(), "Documents", "respaldos");
  fs.mkdirSync(dir, { recursive: true });
  const archivo = path.join(dir, `empleados_campos_quitados_${Date.now()}.json`);
  fs.writeFileSync(archivo, JSON.stringify(filas, null, 2));
  console.log(`Respaldo: ${archivo} (${filas.length} empleados)`);
  const n = await prisma.$executeRawUnsafe(`UPDATE Empleados SET ${cols.map(c => `${c} = NULL`).join(", ")} WHERE ${conDato}`);
  console.log(`Vaciados ${n} empleados.`);
} else if (process.argv.includes("--drop")) {
  await prisma.$executeRawUnsafe(`ALTER TABLE Empleados ${cols.map(c => `DROP COLUMN ${c}`).join(", ")}`);
  console.log(`Columnas quitadas: ${cols.join(", ")}`);
} else {
  const r: any[] = await prisma.$queryRawUnsafe(
    `SELECT ${cols.map(c => `SUM(${c} IS NOT NULL AND TRIM(${c}) <> '') AS ${c}`).join(", ")} FROM Empleados`);
  console.log(Object.fromEntries(Object.entries(r[0]).map(([k, v]) => [k, Number(v)])));
}
await prisma.$disconnect();
