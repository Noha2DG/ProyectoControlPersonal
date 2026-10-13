// Lo que Descongelado despacha a Pelado/Descabezado entra solo a Destajo (Materia Prima).
//
// Hasta hoy el TRASLADO a PELADO_DESCABEZADO quedaba en el piso sin que nadie lo tomara, y el
// encargado de Pelado volvía a crear el lote a mano tecleando un peso que ya existía (el de báscula de
// Descongelado). Con esto el TRASLADO apunta al lote de Destajo que alimenta y el lote sabe de dónde
// salió su peso — ver lib/destajoDesdePiso.ts.
//
//   · MovimientoPiso.LoteProceso/ClaseProceso → Lotes(Lote, Clase): el lote de proceso del día
//     (G240Q005) que ese TRASLADO alimenta. ON UPDATE CASCADE porque el código de un lote se puede
//     regenerar (corrección de ciclo en PUT /api/lotes).
//   · MovimientoPiso.Recibido*/KgRecibido/NotaRecepcion: Pelado corrobora lo que le llegó. No cambia
//     el peso —  es constancia de quién contó qué.
//   · MovimientoPiso.DestajoPendiente = 1: el sistema intentó llevar ese TRASLADO a Destajo y no
//     reconoció la piscina en el código del lote; queda en "Por asignar" hasta que el encargado la
//     escoja. Marcarlo explícito evita que los TRASLADO de antes de esta función aparezcan ahí.
//   · Lotes.Origen: MANUAL (fresco, formulario de siempre) | PISO (nació de un TRASLADO) | MIXTO
//     (tenía peso manual y además le entró del piso: el encargado debe revisarlo).
//   · Areas DT (PELADO Y PINCHADO) pasa a la bodega PELADO_DESCABEZADO: es la misma área física.
//
// Todo es aditivo (columnas NULL o con DEFAULT, al final de la tabla): el código que ya corre en
// producción no nombra estas columnas y sigue funcionando igual antes del despliegue.
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

async function existeConstraint(tabla: string, nombre: string) {
  const [r]: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`, tabla, nombre);
  return Number(r.n) > 0;
}

async function main() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE MovimientoPiso
      ADD COLUMN IF NOT EXISTS LoteProceso   VARCHAR(30)   NULL,
      ADD COLUMN IF NOT EXISTS ClaseProceso  VARCHAR(10)   NULL,
      ADD COLUMN IF NOT EXISTS RecibidoPor   VARCHAR(100)  NULL,
      ADD COLUMN IF NOT EXISTS RecibidoEn    DATETIME      NULL,
      ADD COLUMN IF NOT EXISTS KgRecibido    DECIMAL(10,2) NULL,
      ADD COLUMN IF NOT EXISTS NotaRecepcion VARCHAR(200)  NULL,
      ADD COLUMN IF NOT EXISTS DestajoPendiente TINYINT(1) NULL`);
  console.log("Columnas de MovimientoPiso verificadas.");

  await prisma.$executeRawUnsafe(
    `ALTER TABLE MovimientoPiso ADD INDEX IF NOT EXISTS idx_movpiso_loteproceso (LoteProceso, ClaseProceso)`);
  // ADD CONSTRAINT no acepta IF NOT EXISTS en MariaDB 10.5: se pregunta antes.
  if (!(await existeConstraint("MovimientoPiso", "fk_movpiso_loteproceso"))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE MovimientoPiso ADD CONSTRAINT fk_movpiso_loteproceso
        FOREIGN KEY (LoteProceso, ClaseProceso) REFERENCES Lotes(Lote, Clase) ON UPDATE CASCADE`);
    console.log("Llave fk_movpiso_loteproceso creada.");
  } else {
    console.log("Llave fk_movpiso_loteproceso ya estaba.");
  }

  await prisma.$executeRawUnsafe(
    `ALTER TABLE Lotes ADD COLUMN IF NOT EXISTS Origen VARCHAR(10) NOT NULL DEFAULT 'MANUAL'`);
  console.log("Columna Lotes.Origen verificada.");

  // Solo si sigue sin bodega: si alguien ya la asignó a mano desde Áreas, se respeta.
  const n = await prisma.$executeRawUnsafe(
    `UPDATE Areas SET BodegaVirtualCodigo = 'PELADO_DESCABEZADO' WHERE Codigo = 'DT' AND BodegaVirtualCodigo IS NULL`);
  const [dt]: any[] = await prisma.$queryRawUnsafe(`SELECT BodegaVirtualCodigo AS b FROM Areas WHERE Codigo = 'DT'`);
  console.log(`Área DT → ${dt?.b ?? "(no existe)"}${n ? " (asignada ahora)" : ""}.`);

  const [r]: any[] = await prisma.$queryRawUnsafe(
    `SELECT (SELECT COUNT(*) FROM Lotes WHERE Origen = 'MANUAL') AS manuales,
            (SELECT COUNT(*) FROM Lotes) AS lotes`);
  console.log(`OK - Lotes: ${r.lotes} filas, ${r.manuales} MANUAL.`);
  await prisma.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
