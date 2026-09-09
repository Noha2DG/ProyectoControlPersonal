// Decisión 9 sep 2026: Devoluciones se fusiona con la creación normal de pallets (ModalNuevoPallet
// en PalletsPage) en vez de tener su propia pantalla — el caso que sí probó funcionar (master que ya
// existe en el sistema) es idéntico a crear un pallet con Origen=DEVOLUCION y escanear. Lo único que
// le faltaba a un pallet normal era el motivo de la devolución, así que se agrega esa columna aquí.
//
// NULLable a nivel BD (igual criterio que Origen/CantidadMaster en alterPalletsOrigenCantidad.ts):
// la obligatoriedad SOLO cuando Origen='DEVOLUCION' la impone POST /api/pallets, no la columna.
//
// El alta manual para códigos que NO existen en el sistema (ApiSofia/sistema anterior) queda
// pospuesta — sin caso real que la necesite todavía. Por eso también se retira routes/devoluciones.ts
// y DevolucionesPage.jsx, pero los catálogos centinela de createDevoluciones.ts NO se tocan: el
// Origen "DEVOLUCION" sigue en uso (aparece en el selector de Origen de cualquier pallet) y el pallet
// DV0002 creado durante las pruebas ya depende de verdad de Area/BodegaVirtual DEVOLUCION — borrarlos
// lo dejaría con una referencia rota. Se desactivan (Activo=0) para que no se ofrezcan en pantallas
// nuevas, no se eliminan.
//
// Reversible: npx tsx backend/scripts/alterPalletsMotivo.ts --drop
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function crear() {
  await prisma.$executeRawUnsafe(`ALTER TABLE Pallets ADD COLUMN Motivo VARCHAR(500) NULL AFTER Origen`);
  console.log("Columna Motivo agregada a Pallets.");

  const areas = await prisma.$executeRawUnsafe(`UPDATE Areas SET Activa = 0 WHERE Codigo = 'DV'`);
  const bv = await prisma.$executeRawUnsafe(`UPDATE BodegaVirtual SET Activo = 0 WHERE Codigo = 'DEVOLUCION'`);
  console.log(`Area DV desactivada (${areas} fila(s)), BodegaVirtual DEVOLUCION desactivada (${bv} fila(s)) — dejan de ofrecerse en pantallas nuevas, sin romper lo ya creado.`);
}

async function eliminar() {
  await prisma.$executeRawUnsafe(`ALTER TABLE Pallets DROP COLUMN Motivo`);
  await prisma.$executeRawUnsafe(`UPDATE Areas SET Activa = 1 WHERE Codigo = 'DV'`);
  await prisma.$executeRawUnsafe(`UPDATE BodegaVirtual SET Activo = 1 WHERE Codigo = 'DEVOLUCION'`);
  console.log("Columna Motivo eliminada de Pallets; Area/BodegaVirtual de Devoluciones reactivadas.");
}

const main = process.argv.includes("--drop") ? eliminar : crear;
main()
  .then(() => prisma.$disconnect())
  .catch(async e => { console.error("ERROR:", e.message); await prisma.$disconnect(); process.exit(1); });
