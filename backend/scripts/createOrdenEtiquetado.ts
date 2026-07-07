import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

const ORIGENES = [
  { Codigo: "FRESCO", Descripcion: "Fresco" },
];

const CONGELACIONES = [
  { Codigo: "BLASTF1", Descripcion: "BlastF1" },
];

async function main() {
  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Origen (
      Codigo      VARCHAR(10)   NOT NULL PRIMARY KEY,
      Descripcion VARCHAR(100)  NOT NULL,
      Activo      TINYINT(1)    NOT NULL DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla Origen creada.");

  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS UnidadesCongelacion (
      Codigo      VARCHAR(10)   NOT NULL PRIMARY KEY,
      Descripcion VARCHAR(100)  NOT NULL,
      Activo      TINYINT(1)    NOT NULL DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla UnidadesCongelacion creada.");

  // Fase 1 (captura): declara cuántos masters se trabajan ese día para una línea de pedido ya
  // existente. Etiquetado es un área independiente de Destajo (lo que se etiqueta hoy puede ser
  // producción de hasta 3 días atrás) — por eso NO referencia Lotes.Lote: el código de lote se
  // compone aquí mismo a partir de Piscina + Fecha + Ciclo (capturado a mano), con el mismo formato
  // que usa Destajo pero sin exigir que esa fila ya exista en Lotes. Ver componerCodigoLote().
  // La impresión/QR (fase 2) se ata a esto después vía DetalleId->OrdenId, todavía no existe esa tabla.
  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS OrdenEtiquetado (
      OrdenId         INT AUTO_INCREMENT PRIMARY KEY,
      Lote            VARCHAR(30)   NOT NULL,
      PiscinaId       INT           NOT NULL,
      Ciclo           VARCHAR(10)   NOT NULL,
      DetalleId       INT           NOT NULL,
      AreaCodigo      VARCHAR(10)   NULL,
      FechaProduccion DATE          NOT NULL,
      Color           VARCHAR(30)   NULL,
      Origen          VARCHAR(10)   NOT NULL,
      Congelacion     VARCHAR(10)   NOT NULL,
      CantidadMaster  INT           NOT NULL,
      Estatus         VARCHAR(20)   NOT NULL DEFAULT 'Pendiente',
      RegistradoPor   VARCHAR(100)  NULL,
      CreadoEn        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_orden_piscina FOREIGN KEY (PiscinaId) REFERENCES Piscina(PiscinaId),
      CONSTRAINT fk_orden_detalle FOREIGN KEY (DetalleId) REFERENCES DetallePedido(DetalleId),
      CONSTRAINT fk_orden_area FOREIGN KEY (AreaCodigo) REFERENCES Areas(Codigo),
      CONSTRAINT fk_orden_origen FOREIGN KEY (Origen) REFERENCES Origen(Codigo),
      CONSTRAINT fk_orden_congelacion FOREIGN KEY (Congelacion) REFERENCES UnidadesCongelacion(Codigo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla OrdenEtiquetado creada.");

  for (const o of ORIGENES) {
    await p.$executeRawUnsafe(`INSERT IGNORE INTO Origen (Codigo, Descripcion) VALUES (?, ?)`, o.Codigo, o.Descripcion);
  }
  console.log(`${ORIGENES.length} origen(es) insertado(s) (INSERT IGNORE).`);

  for (const c of CONGELACIONES) {
    await p.$executeRawUnsafe(`INSERT IGNORE INTO UnidadesCongelacion (Codigo, Descripcion) VALUES (?, ?)`, c.Codigo, c.Descripcion);
  }
  console.log(`${CONGELACIONES.length} unidad(es) de congelación insertada(s) (INSERT IGNORE).`);

  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
