// Decisión 14 jul 2026: el pallet lleva un código legible con letra de la bodega virtual donde se
// llena (ej. "T0001" para Túnel) + secuencial de 4 dígitos que nunca se reinicia. Este catálogo es
// aparte del `Almacenes` que ya usa Destajo para materia prima (Bodega de Conservación/Piso) —
// conceptos distintos, no se mezclan. UltimoSecuencial es el contador atómico de cada bodega
// virtual (se incrementa dentro de una transacción al crear un pallet, ver pallets.ts).
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS BodegaVirtual (
      Codigo           VARCHAR(30)   PRIMARY KEY,
      Nombre           VARCHAR(100)  NOT NULL,
      Letra            VARCHAR(4)    NOT NULL,
      AreaCodigo       VARCHAR(10)   NULL,
      UltimoSecuencial INT           NOT NULL DEFAULT 0,
      Activo           TINYINT(1)    NOT NULL DEFAULT 1,
      CONSTRAINT fk_bodegavirtual_area FOREIGN KEY (AreaCodigo) REFERENCES Areas(Codigo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla BodegaVirtual creada.");

  // Letras propuestas por el usuario (Túnel=T, Bodega=B) + las derivadas para evitar choque entre
  // Masterizado Entero/Varios y Reempaque/Reetiquetado — ajustable después, es solo el punto de partida.
  const filas: [string, string, string, string][] = [
    ["TUNEL", "Túnel", "T", "EF"],
    ["MASTERIZADO_ENTERO", "Masterizado Entero", "ME", "ES"],
    ["MASTERIZADO_VARIOS", "Masterizado Varios", "MV", "MV"],
    ["REEMPAQUE", "Reempaque", "RP", "EY"],
    ["REETIQUETADO", "Reetiquetado", "RE", "RE"],
    ["BODEGA", "Bodega", "B", "BL"],
  ];
  for (const [codigo, nombre, letra, areaCodigo] of filas) {
    await p.$executeRawUnsafe(
      `INSERT IGNORE INTO BodegaVirtual (Codigo, Nombre, Letra, AreaCodigo) VALUES (?, ?, ?, ?)`,
      codigo, nombre, letra, areaCodigo
    );
  }
  console.log("Sembradas", filas.length, "bodegas virtuales.");

  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
