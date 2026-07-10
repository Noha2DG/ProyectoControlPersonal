// Fase 2 de Etiquetado: impresión física con QR. Ver project_ordenetiquetado_design (memoria):
// - EtiquetaImpresa = una fila por master físico impreso (correlativo único = "E"+EtiquetaId, eso va en el QR).
// - ImpresionLog = cada evento físico de impresión (incluye reimpresiones) — auditoría separada de la etiqueta.
// - Impresión bajo demanda: se crea una EtiquetaImpresa a la vez, nunca en bloque.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS EtiquetaImpresa (
      EtiquetaId    INT AUTO_INCREMENT PRIMARY KEY,
      OrdenId       INT           NOT NULL,
      Estatus       VARCHAR(20)   NOT NULL DEFAULT 'Activa',
      RegistradoPor VARCHAR(100)  NULL,
      CreadoEn      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_etiqueta_orden FOREIGN KEY (OrdenId) REFERENCES OrdenEtiquetado(OrdenId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla EtiquetaImpresa creada.");

  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ImpresionLog (
      LogId       INT AUTO_INCREMENT PRIMARY KEY,
      EtiquetaId  INT           NOT NULL,
      Motivo      VARCHAR(200)  NULL,
      ImpresoPor  VARCHAR(100)  NULL,
      FechaHora   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_log_etiqueta FOREIGN KEY (EtiquetaId) REFERENCES EtiquetaImpresa(EtiquetaId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla ImpresionLog creada.");

  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
