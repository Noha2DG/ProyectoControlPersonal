// Decisión 14 jul 2026: el pallet se identifica con un código legible (Letra de BodegaVirtual +
// secuencial de 4 dígitos, ej. "T0001"), generado al crear el pallet dentro de la misma transacción
// que incrementa BodegaVirtual.UltimoSecuencial (ver pallets.ts). NULLable a nivel BD: los pallets
// #3 y #19 ya existían (creados por el usuario probando la pantalla) antes de esta decisión — no se
// les inventa un código retroactivo, mismo criterio ya usado con Origen/CantidadMaster.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  await p.$executeRawUnsafe(`ALTER TABLE Pallets ADD COLUMN Codigo VARCHAR(10) NULL AFTER PalletId`);
  await p.$executeRawUnsafe(`ALTER TABLE Pallets ADD COLUMN BodegaVirtualCodigo VARCHAR(30) NULL AFTER CantidadMaster`);
  await p.$executeRawUnsafe(`ALTER TABLE Pallets ADD CONSTRAINT fk_pallet_bodegavirtual FOREIGN KEY (BodegaVirtualCodigo) REFERENCES BodegaVirtual(Codigo)`);
  console.log("Columnas Codigo y BodegaVirtualCodigo agregadas a Pallets.");
  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
