// Decisión 9 sep 2026: en una remisión de traslado interno (Destino='Area' en SerieRemision —
// Reetiquetado, Reproceso, Reempaque, Descongelado...) el producto no sale de la planta, se mueve a
// otra área. Faltaba dejar quién lo está RECIBIENDO ahí — mismo dato que ya captura Transferencias
// (empleado que entra al área), y la misma búsqueda que esa pantalla, reusada aquí.
//
// NULLable a nivel BD: solo se exige en el body cuando la serie es de Destino='Area' (ver
// resolverDestino en remisiones.ts); una remisión a Cliente no tiene "quién recibe en planta".
//
// Reversible: npx tsx backend/scripts/alterRemisionesRecibidoPor.ts --drop
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function crear() {
  // VARCHAR(50) para calzar exacto con Empleados.Codigo — la FK lo exige.
  await prisma.$executeRawUnsafe(`ALTER TABLE Remisiones ADD COLUMN RecibidoPor VARCHAR(50) NULL AFTER AreaDestino`);
  await prisma.$executeRawUnsafe(`ALTER TABLE Remisiones ADD CONSTRAINT fk_remision_recibidopor FOREIGN KEY (RecibidoPor) REFERENCES Empleados(Codigo)`);
  console.log("Columna RecibidoPor agregada a Remisiones (FK a Empleados).");
}

async function eliminar() {
  await prisma.$executeRawUnsafe(`ALTER TABLE Remisiones DROP FOREIGN KEY fk_remision_recibidopor`);
  await prisma.$executeRawUnsafe(`ALTER TABLE Remisiones DROP COLUMN RecibidoPor`);
  console.log("Columna RecibidoPor eliminada de Remisiones.");
}

const main = process.argv.includes("--drop") ? eliminar : crear;
main()
  .then(() => prisma.$disconnect())
  .catch(async e => { console.error("ERROR:", e.message); await prisma.$disconnect(); process.exit(1); });
