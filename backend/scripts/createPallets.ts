// Módulo Bodega PT — fase "escanear el QR" (ver project_bodega_pt_design / project_ordenetiquetado_design):
// - Pallets: cabecera mínima, SIN Pedido/Cliente/Área propios — el operador la crea vacía y se va
//   "informando" con lo que traen los masters escaneados (puede terminar mezclando líneas distintas).
// - Masters: una fila por master físico ya confirmado en bodega. EtiquetaId es UNIQUE — evita
//   escanear el mismo master dos veces (el candado real, no solo de UI).
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Pallets (
      PalletId    INT AUTO_INCREMENT PRIMARY KEY,
      Estatus     VARCHAR(20)   NOT NULL DEFAULT 'Abierto',
      CreadoPor   VARCHAR(100)  NULL,
      CreadoEn    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CerradoPor  VARCHAR(100)  NULL,
      CerradoEn   DATETIME      NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla Pallets creada.");

  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Masters (
      MasterId     INT AUTO_INCREMENT PRIMARY KEY,
      PalletId     INT           NOT NULL,
      EtiquetaId   INT           NOT NULL UNIQUE,
      IngresadoPor VARCHAR(100)  NULL,
      FechaIngreso DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_master_pallet FOREIGN KEY (PalletId) REFERENCES Pallets(PalletId),
      CONSTRAINT fk_master_etiqueta FOREIGN KEY (EtiquetaId) REFERENCES EtiquetaImpresa(EtiquetaId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla Masters creada.");

  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
