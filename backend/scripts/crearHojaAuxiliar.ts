// Decisión 29 oct 2026: Descongelado maneja dos hojas abiertas al mismo tiempo, porque en ciertos
// horarios los dos turnos trabajan juntos. El marcaje dice quién estuvo en el ÁREA, no en qué hoja:
// durante el traslape la misma gente caía en las dos. El usuario escogió que al cerrar cada
// encargado marque quiénes trabajaron en SU hoja. Esta tabla guarda esa lista.
//
// Una hoja cerrada con renglones aquí cuenta solo a esa gente. Las hojas cerradas antes (sin
// renglones) siguen contando a todos los del marcaje en su ventana, como hasta hoy. El código
// anterior no lee la tabla, así que se puede crear antes de desplegar sin afectarlo.
//
//   npx tsx scripts/crearHojaAuxiliar.ts            → crea la tabla (si falta)
//   npx tsx scripts/crearHojaAuxiliar.ts --drop     → la quita
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function existe() {
  const r: any[] = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'HojaAuxiliar'`);
  return r.length > 0;
}

async function crear() {
  if (await existe()) { console.log("HojaAuxiliar ya existía."); return; }
  // Minutos: los que esa persona sumó dentro de la ventana de la hoja al cerrarla, para que la
  // hoja cerrada no cambie si después se corrige un marcaje.
  await prisma.$executeRawUnsafe(`
    CREATE TABLE HojaAuxiliar (
      HojaId  INT(11)     NOT NULL,
      Codigo  VARCHAR(50) NOT NULL,
      Minutos INT         NOT NULL DEFAULT 0,
      PRIMARY KEY (HojaId, Codigo),
      KEY idx_hojaauxiliar_codigo (Codigo),
      CONSTRAINT fk_hojaauxiliar_hoja FOREIGN KEY (HojaId) REFERENCES HojaProceso (HojaId) ON DELETE CASCADE,
      CONSTRAINT fk_hojaauxiliar_empleado FOREIGN KEY (Codigo) REFERENCES Empleados (Codigo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  console.log("HojaAuxiliar creada.");
}

async function eliminar() {
  if (await existe()) await prisma.$executeRawUnsafe(`DROP TABLE HojaAuxiliar`);
  console.log("HojaAuxiliar quitada.");
}

const main = process.argv.includes("--drop") ? eliminar : crear;
main()
  .then(() => prisma.$disconnect())
  .catch(async e => { console.error("ERROR:", e.message); await prisma.$disconnect(); process.exit(1); });
