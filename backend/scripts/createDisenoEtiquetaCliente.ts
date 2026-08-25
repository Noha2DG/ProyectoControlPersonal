// Asignación del diseño de BarTender (.btw) que le corresponde a cada cliente/subcliente.
//
// Por qué la llave es (Cliente, Subcliente) y no solo Cliente: el arte impreso pertenece al
// SUBCLIENTE, no a quien compra. Caso real verificado contra la etiqueta física — pedido 2026-016,
// Cliente = "I OCEAN", Subcliente = "GREAT GARDEN ENTERPRISE CO., LTD", y el encabezado impreso en
// la etiqueta dice GREAT GARDEN. Si se asignara solo por cliente, todos los subclientes de I OCEAN
// compartirían el mismo arte.
//
// CodigoSubcliente = '' (cadena vacía, NO NULL) significa "diseño por defecto de este cliente", que
// se usa cuando el pedido no trae subcliente o cuando ese subcliente no tiene arte propio. Es ''
// y no NULL a propósito: MariaDB considera cada NULL distinto de los demás dentro de una llave, así
// que con NULL se podrían colar varias filas "por defecto" para el mismo cliente y la PK no lo
// impediría.
//
// Reversible: npx tsx backend/scripts/createDisenoEtiquetaCliente.ts --drop

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TABLA = "DisenoEtiquetaCliente";

async function crear() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${TABLA} (
      CodigoCliente     INT           NOT NULL,
      CodigoSubcliente  VARCHAR(10)   NOT NULL DEFAULT '',
      RutaBtw           VARCHAR(500)  NOT NULL,
      ActualizadoPor    VARCHAR(100)  NULL,
      ActualizadoEn     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (CodigoCliente, CodigoSubcliente),
      CONSTRAINT fk_disenoetiquetacliente_cliente
        FOREIGN KEY (CodigoCliente) REFERENCES Clientes(Codigo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log(`Tabla ${TABLA} creada (o ya existía).`);

  const cols: any[] = await prisma.$queryRawUnsafe(`SHOW COLUMNS FROM ${TABLA}`);
  console.table(cols.map((c: any) => ({ Campo: c.Field, Tipo: c.Type, Nulo: c.Null, Llave: c.Key })));

  const n: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM ${TABLA}`);
  console.log(`Asignaciones existentes: ${Number(n[0].n)}`);
}

async function eliminar() {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${TABLA}`);
  console.log(`Tabla ${TABLA} eliminada.`);
}

const main = process.argv.includes("--drop") ? eliminar : crear;

main()
  .then(() => process.exit(0))
  .catch(e => { console.error("ERROR:", e.message); process.exit(1); });
