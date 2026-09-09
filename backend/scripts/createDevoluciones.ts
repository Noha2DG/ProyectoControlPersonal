// Catálogos centinela para el módulo Devoluciones (ver project_devoluciones_design en memoria).
//
// El caso que este módulo resuelve es el master que NO existe en nuestro Masters (código del
// sistema anterior/ApiSofia que nunca se registró aquí, o un master que salió antes de que
// existiera trazabilidad). El alta manual asistida reconstruye la cadena Pedido→DetallePedido→
// OrdenEtiquetado→EtiquetaImpresa→Masters→Pallets igual que migrarInventarioInicial.ts, así que
// necesita los mismos centinelas que esa migración: una Piscina/Finca inactivas (fuera de los
// desplegables de Destajo/Etiquetado) y una Congelación descriptiva.
//
// A diferencia de la bodega virtual de migración (MIGRACION, Activo=0 — nunca crea pallets
// nuevos), la de Devoluciones SÍ tiene que estar Activa: el alta manual crea un pallet nuevo por
// cada devolución a través del POST /api/pallets normal, que exige BodegaVirtual.Activo = 1 y un
// Area activa de la que resolverlo.
//
// Reversible: npx tsx backend/scripts/createDevoluciones.ts --drop
// Uso normal:  npx tsx backend/scripts/createDevoluciones.ts

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ORIGEN_DEV = "DEVOLUCION";
const AREA_DEV = "DV";
const BODEGA_VIRTUAL_DEV = "DEVOLUCION";
const FINCA_DEV = "DV001";
const PISCINA_DEV_NOMBRE = "DEVOLUCIONES";
const CONGELACION_DEV = "DEVOLUCION";

async function crear() {
  await prisma.$executeRawUnsafe(
    `INSERT IGNORE INTO Origen (Codigo, Descripcion) VALUES (?, ?)`, ORIGEN_DEV, "Devolución de cliente");

  await prisma.$executeRawUnsafe(
    `INSERT IGNORE INTO Areas (Codigo, Nombre) VALUES (?, ?)`, AREA_DEV, "DEVOLUCIONES");

  await prisma.$executeRawUnsafe(
    `INSERT IGNORE INTO BodegaVirtual (Codigo, Nombre, Letra, AreaCodigo, UltimoSecuencial, Activo) VALUES (?, ?, ?, ?, 0, 1)`,
    BODEGA_VIRTUAL_DEV, "Devoluciones", "DV", AREA_DEV);

  await prisma.$executeRawUnsafe(
    `INSERT IGNORE INTO Finca (Codigo, Descripcion, Grupo, Abreviatura, Activo) VALUES (?, ?, ?, ?, 0)`,
    FINCA_DEV, "DEVOLUCIONES DE CLIENTE", "DEVOLUCIONES", "DV");

  await prisma.$executeRawUnsafe(
    `INSERT IGNORE INTO Piscina (CodigoFinca, Nombre, Activo) VALUES (?, ?, 0)`,
    FINCA_DEV, PISCINA_DEV_NOMBRE);

  await prisma.$executeRawUnsafe(
    `INSERT IGNORE INTO UnidadesCongelacion (Codigo, Descripcion, Activo) VALUES (?, ?, 1)`,
    CONGELACION_DEV, "Devolución (sin dato de congelación original)");

  const piscina: any[] = await prisma.$queryRawUnsafe(
    `SELECT PiscinaId FROM Piscina WHERE CodigoFinca = ? AND Nombre = ? LIMIT 1`, FINCA_DEV, PISCINA_DEV_NOMBRE);

  console.log("Catálogos de Devoluciones creados (o ya existían):");
  console.log(`   Origen              ${ORIGEN_DEV}`);
  console.log(`   Area                ${AREA_DEV}`);
  console.log(`   BodegaVirtual       ${BODEGA_VIRTUAL_DEV} (letra DV, activa)`);
  console.log(`   Finca/Piscina       ${FINCA_DEV} / PiscinaId ${Number(piscina[0]?.PiscinaId)}`);
  console.log(`   UnidadesCongelacion ${CONGELACION_DEV}`);
}

async function eliminar() {
  await prisma.$executeRawUnsafe(`DELETE FROM Piscina WHERE CodigoFinca = ? AND Nombre = ?`, FINCA_DEV, PISCINA_DEV_NOMBRE);
  await prisma.$executeRawUnsafe(`DELETE FROM Finca WHERE Codigo = ?`, FINCA_DEV);
  await prisma.$executeRawUnsafe(`DELETE FROM UnidadesCongelacion WHERE Codigo = ?`, CONGELACION_DEV);
  await prisma.$executeRawUnsafe(`DELETE FROM BodegaVirtual WHERE Codigo = ?`, BODEGA_VIRTUAL_DEV);
  await prisma.$executeRawUnsafe(`DELETE FROM Areas WHERE Codigo = ?`, AREA_DEV);
  await prisma.$executeRawUnsafe(`DELETE FROM Origen WHERE Codigo = ?`, ORIGEN_DEV);
  console.log("Catálogos de Devoluciones eliminados.");
}

const main = process.argv.includes("--drop") ? eliminar : crear;

main()
  .then(() => prisma.$disconnect())
  .catch(async e => { console.error("ERROR:", e.message); await prisma.$disconnect(); process.exit(1); });
