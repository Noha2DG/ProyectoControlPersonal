// Módulo Bodega PT — fase "bodega física" (ver project_bodega_fisica_analisis): posiciones en racks
// para pallets Cerrados. Decisiones cerradas jul 2026:
// - 20 racks idénticos de 4 niveles × 8 posiciones (640 posiciones), pero la geometría vive en el
//   catálogo Racks (no hardcodeada) por si algún rack cambia o la bodega crece.
// - Ocupación = Pallets.PosicionId (FK NULLable) con UNIQUE: el candado real contra dos pallets en
//   la misma posición es el constraint, no la validación de UI (mismo criterio que Masters.EtiquetaId).
//   "Almacenado" se deriva de PosicionId — no se agrega un Estatus nuevo al pallet.
// - MovimientosBodega = kardex inmutable (fuente de verdad de la trazabilidad; la FK es solo la
//   foto actual). Al salir por remisión se libera la posición pero NUNCA se borran registros.
// - El único estado almacenado de una posición es Bloqueada (+motivo/quién/cuándo); Disponible y
//   Ocupada se derivan. Reservada queda para una fase futura.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

const RACKS = 20, NIVELES = 4, POSICIONES = 8;

async function main() {
  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Racks (
      RackId             INT           PRIMARY KEY,
      Nombre             VARCHAR(50)   NOT NULL,
      Niveles            INT           NOT NULL,
      PosicionesPorNivel INT           NOT NULL,
      Orden              INT           NOT NULL,
      Activo             TINYINT(1)    NOT NULL DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla Racks creada.");

  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Posiciones (
      PosicionId    INT           AUTO_INCREMENT PRIMARY KEY,
      RackId        INT           NOT NULL,
      Nivel         INT           NOT NULL,
      Posicion      INT           NOT NULL,
      Codigo        VARCHAR(20)   NOT NULL UNIQUE,
      Bloqueada     TINYINT(1)    NOT NULL DEFAULT 0,
      MotivoBloqueo VARCHAR(200)  NULL,
      BloqueadaPor  VARCHAR(100)  NULL,
      BloqueadaEn   DATETIME      NULL,
      UNIQUE KEY uq_posicion_fisica (RackId, Nivel, Posicion),
      CONSTRAINT fk_posicion_rack FOREIGN KEY (RackId) REFERENCES Racks(RackId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla Posiciones creada.");

  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS MovimientosBodega (
      MovimientoId      INT           AUTO_INCREMENT PRIMARY KEY,
      PalletId          INT           NOT NULL,
      Tipo              VARCHAR(20)   NOT NULL,
      PosicionOrigenId  INT           NULL,
      PosicionDestinoId INT           NULL,
      Usuario           VARCHAR(100)  NULL,
      Fecha             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      Motivo            VARCHAR(200)  NULL,
      KEY idx_movbodega_pallet (PalletId),
      CONSTRAINT fk_movbodega_pallet FOREIGN KEY (PalletId) REFERENCES Pallets(PalletId),
      CONSTRAINT fk_movbodega_origen FOREIGN KEY (PosicionOrigenId) REFERENCES Posiciones(PosicionId),
      CONSTRAINT fk_movbodega_destino FOREIGN KEY (PosicionDestinoId) REFERENCES Posiciones(PosicionId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla MovimientosBodega creada.");

  // Columna en Pallets — guardada con chequeo previo para que el script completo sea re-ejecutable
  // (las CREATE ya lo son vía IF NOT EXISTS; un ALTER repetido reventaría).
  const col: any[] = await p.$queryRawUnsafe(`
    SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Pallets' AND COLUMN_NAME = 'PosicionId'
  `);
  if (Number(col[0].n) === 0) {
    await p.$executeRawUnsafe(`ALTER TABLE Pallets ADD COLUMN PosicionId INT NULL`);
    await p.$executeRawUnsafe(`ALTER TABLE Pallets ADD UNIQUE KEY uq_pallet_posicion (PosicionId)`);
    await p.$executeRawUnsafe(`ALTER TABLE Pallets ADD CONSTRAINT fk_pallet_posicion FOREIGN KEY (PosicionId) REFERENCES Posiciones(PosicionId)`);
    console.log("Columna Pallets.PosicionId agregada (UNIQUE + FK).");
  } else {
    console.log("Columna Pallets.PosicionId ya existía, sin cambios.");
  }

  // Siembra: 20 racks idénticos y sus 640 posiciones. INSERT IGNORE apoyado en los UNIQUE — correr
  // el script dos veces no duplica nada.
  for (let r = 1; r <= RACKS; r++) {
    await p.$executeRawUnsafe(
      `INSERT IGNORE INTO Racks (RackId, Nombre, Niveles, PosicionesPorNivel, Orden) VALUES (?, ?, ?, ?, ?)`,
      r, `Rack ${r}`, NIVELES, POSICIONES, r
    );
  }
  console.log(`Sembrados ${RACKS} racks.`);

  let sembradas = 0;
  for (let r = 1; r <= RACKS; r++) {
    const valores: string[] = [];
    const params: any[] = [];
    for (let n = 1; n <= NIVELES; n++) {
      for (let pos = 1; pos <= POSICIONES; pos++) {
        valores.push("(?, ?, ?, ?)");
        params.push(r, n, pos, `R${String(r).padStart(2, "0")}-N${n}-P${pos}`);
      }
    }
    const result = await p.$executeRawUnsafe(
      `INSERT IGNORE INTO Posiciones (RackId, Nivel, Posicion, Codigo) VALUES ${valores.join(", ")}`,
      ...params
    );
    sembradas += Number(result);
  }
  console.log(`Sembradas ${sembradas} posiciones nuevas (${RACKS * NIVELES * POSICIONES} totales esperadas).`);

  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
