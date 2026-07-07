// Migración puntual: OrdenEtiquetado nació referenciando Lotes.Lote (Destajo), pero Etiquetado es
// un área independiente (lo que se etiqueta hoy puede ser producción de hasta 3 días atrás, sin que
// exista ya esa fila en Lotes). Se reemplaza por Finca/Piscina + Ciclo capturado a mano; el código de
// Lote se compone en la propia ruta (ver componerCodigoLote en lib/codigoLote.ts).
// La tabla estaba vacía (0 filas, solo probada con inserts de prueba ya limpiados) — se recrea directo.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const count: any[] = await p.$queryRawUnsafe("SELECT COUNT(*) AS n FROM OrdenEtiquetado");
  if (Number(count[0].n) > 0) {
    console.log(`OrdenEtiquetado tiene ${count[0].n} fila(s) — migración abortada, revisar a mano.`);
    await p.$disconnect();
    return;
  }

  await p.$executeRawUnsafe("DROP TABLE OrdenEtiquetado");
  console.log("Tabla OrdenEtiquetado anterior eliminada (estaba vacía).");

  await p.$executeRawUnsafe(`
    CREATE TABLE OrdenEtiquetado (
      OrdenId         INT AUTO_INCREMENT PRIMARY KEY,
      Lote            VARCHAR(30)   NOT NULL,
      PiscinaId       INT           NOT NULL,
      Ciclo           VARCHAR(10)   NOT NULL,
      DetalleId       INT           NOT NULL,
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
      CONSTRAINT fk_orden_origen FOREIGN KEY (Origen) REFERENCES Origen(Codigo),
      CONSTRAINT fk_orden_congelacion FOREIGN KEY (Congelacion) REFERENCES UnidadesCongelacion(Codigo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla OrdenEtiquetado recreada con Piscina/Ciclo.");

  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
