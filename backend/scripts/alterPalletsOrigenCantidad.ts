// Decisión 14 jul 2026: al crear un Pallet se debe establecer su Origen (mismo catálogo que ya usa
// Etiquetado) y la cantidad de masters que se planea que lleve ("cantidad de masters que llevará el
// polín"). Origen es solo informativo (no filtra qué se puede escanear ahí — un pallet normalmente
// es de un solo Origen, pero el sistema no lo obliga, mismo criterio que ya se usó para la línea de
// pedido). CantidadMaster es una meta de referencia (no bloquea el escaneo), se compara contra lo
// realmente escaneado para mostrar Completo/Incompleto/Sobrante — igual patrón que el cierre de
// captura ya usado en Etiquetado.
// NULLable a nivel BD: el Pallet #3 ya existía con datos reales (creado por el usuario probando la
// pantalla) antes de esta decisión — no se le inventa un Origen/objetivo con el que no se creó; la
// obligatoriedad para pallets NUEVOS la impone la app (POST /api/pallets rechaza sin ambos), no la
// columna. Mismo criterio ya usado con AreaCodigo en OrdenEtiquetado.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  await p.$executeRawUnsafe(`ALTER TABLE Pallets ADD COLUMN Origen VARCHAR(10) NULL AFTER Estatus`);
  await p.$executeRawUnsafe(`ALTER TABLE Pallets ADD CONSTRAINT fk_pallet_origen FOREIGN KEY (Origen) REFERENCES Origen(Codigo)`);
  await p.$executeRawUnsafe(`ALTER TABLE Pallets ADD COLUMN CantidadMaster INT NULL AFTER Origen`);
  console.log("Columnas Origen y CantidadMaster agregadas a Pallets.");
  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
