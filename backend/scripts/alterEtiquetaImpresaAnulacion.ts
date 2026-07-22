// Punto 3 del análisis de control de etiquetas (21 jul 2026): cierra el hueco del estatus 'Anulada'
// que existía en el schema desde el inicio pero al que nunca se podía llegar (se validaba en
// reimprimir/escanear, pero no había ninguna ruta que lo estableciera). Estas columnas guardan la
// anulación VIGENTE (se limpian al reactivar, mismo criterio que Pallets.CerradoPor/CerradoEn se
// limpian al reabrir) — no es un historial de múltiples ciclos, es una corrección administrativa
// puntual y poco frecuente.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  await p.$executeRawUnsafe(`ALTER TABLE EtiquetaImpresa ADD COLUMN AnuladoPor VARCHAR(100) NULL AFTER Estatus`);
  await p.$executeRawUnsafe(`ALTER TABLE EtiquetaImpresa ADD COLUMN AnuladoEn DATETIME NULL AFTER AnuladoPor`);
  await p.$executeRawUnsafe(`ALTER TABLE EtiquetaImpresa ADD COLUMN MotivoAnulacion VARCHAR(200) NULL AFTER AnuladoEn`);
  console.log("Columnas AnuladoPor/AnuladoEn/MotivoAnulacion agregadas a EtiquetaImpresa.");
  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
