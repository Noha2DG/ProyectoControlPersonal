// Liberar materia prima (decisión 11 nov 2026): lo importado no sale de bodega hasta que alguien con
// el permiso `liberar_mp` libere el contenedor COMPLETO. No se usa la palabra "calidad": es otra rama
// del proceso y se confundiría.
//
// Contenedor = piscina Qnnn de la finca de importación IM001: cada contenedor entra con su piscina
// nueva y OrdenEtiquetado.PiscinaId dice exactamente de cuál es cada master. Q012 y anteriores quedan
// libres (Q012 ya salió el 11 nov); de Q013 en adelante nacen PENDIENTE.
//
// Todo lo que agrega es nuevo y el código anterior no lo lee, así que se puede correr antes de
// desplegar sin afectar a nadie:
//   - Tabla LiberacionMateriaPrima: una fila por contenedor bajo control. Sin fila = libre.
//   - Pallets.TipoProducto (PT / MP / PE), NULL en los polines que ya existen (usuario: sin tipo).
//   - Serie "Muestra para análisis" (MA), INACTIVA: el código anterior la trataría como venta a cliente.
//
//   npx tsx scripts/createLiberacionMateriaPrima.ts            → crea lo que falte y marca Q013+ pendientes
//   npx tsx scripts/createLiberacionMateriaPrima.ts --activar  → además activa la serie MA (AL DESPLEGAR)
//   npx tsx scripts/createLiberacionMateriaPrima.ts --drop     → quita todo (solo si la serie no se usó)
//
// Al desplegar se vuelve a correr con --activar: si Q013 se dio de alta en el catálogo antes del
// despliegue (con el código viejo no nace pendiente), aquí queda marcado.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const PRIMER_CONTENEDOR = 13;   // Q013

async function existeColumna(tabla: string, columna: string) {
  const r: any[] = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    tabla, columna);
  return r.length > 0;
}

async function crear(activar: boolean) {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS LiberacionMateriaPrima (
      PiscinaId    INT          NOT NULL PRIMARY KEY,
      Estado       VARCHAR(12)  NOT NULL DEFAULT 'PENDIENTE',   -- PENDIENTE / LIBERADO / RECHAZADO
      CreadoEn     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CreadoPor    VARCHAR(100) NULL,
      ResueltoPor  VARCHAR(100) NULL,
      ResueltoEn   DATETIME     NULL,
      Observacion  VARCHAR(500) NULL,
      KEY idx_liberacion_estado (Estado),
      CONSTRAINT fk_liberacion_piscina FOREIGN KEY (PiscinaId) REFERENCES Piscina (PiscinaId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  console.log("Tabla LiberacionMateriaPrima lista.");

  if (!(await existeColumna("Pallets", "TipoProducto"))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE Pallets ADD COLUMN TipoProducto VARCHAR(2) NULL AFTER Origen`);
    console.log("Pallets.TipoProducto agregada (NULL en los polines existentes).");
  } else console.log("Pallets.TipoProducto ya existía.");

  const n = Number(await prisma.$executeRawUnsafe(`
    INSERT IGNORE INTO SerieRemision (Tipo, Prefijo, Nombre, Destino, TipoCliente, Orden, PideEmbarque, PidePedido, PideLinea, UltimoSecuencial, Activo)
    VALUES ('MuestraAnalisis', 'MA', 'Muestra para análisis', 'Muestra', NULL, 8, 0, 0, 0, 0, 0)`));
  console.log(n ? "Serie MA (Muestra para análisis) creada, inactiva." : "Serie MA ya existía.");
  if (activar) {
    await prisma.$executeRawUnsafe(`UPDATE SerieRemision SET Activo = 1 WHERE Tipo = 'MuestraAnalisis'`);
    console.log("Serie MA activada.");
  }

  const marcadas = Number(await prisma.$executeRawUnsafe(`
    INSERT IGNORE INTO LiberacionMateriaPrima (PiscinaId, Estado, CreadoPor)
    SELECT PiscinaId, 'PENDIENTE', 'sistema' FROM Piscina
     WHERE CodigoFinca = 'IM001' AND Nombre REGEXP '^Q[0-9]+$' AND CAST(SUBSTRING(Nombre, 2) AS UNSIGNED) >= ?`,
    PRIMER_CONTENEDOR));
  console.log(`Contenedores marcados pendientes ahora: ${marcadas}.`);

  const estado: any[] = await prisma.$queryRawUnsafe(`
    SELECT p.Nombre, l.Estado FROM LiberacionMateriaPrima l JOIN Piscina p ON p.PiscinaId = l.PiscinaId ORDER BY p.Nombre`);
  console.log("Bajo control:", estado.length ? estado.map(e => `${e.Nombre} ${e.Estado}`).join(", ") : "(ninguno todavía)");
}

async function quitar() {
  const usadas: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM Remisiones WHERE Tipo = 'MuestraAnalisis'`);
  if (Number(usadas[0].n) > 0) throw new Error(`Hay ${usadas[0].n} remisiones de muestra: no se quita la serie.`);
  await prisma.$executeRawUnsafe(`DELETE FROM SerieRemision WHERE Tipo = 'MuestraAnalisis'`);
  if (await existeColumna("Pallets", "TipoProducto")) await prisma.$executeRawUnsafe(`ALTER TABLE Pallets DROP COLUMN TipoProducto`);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS LiberacionMateriaPrima`);
  console.log("Quitado: serie MA, Pallets.TipoProducto y LiberacionMateriaPrima.");
}

const args = process.argv.slice(2);
(args.includes("--drop") ? quitar() : crear(args.includes("--activar")))
  .catch(e => { console.error(e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
