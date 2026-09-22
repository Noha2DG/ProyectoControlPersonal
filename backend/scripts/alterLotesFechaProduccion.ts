// Agrega Lotes.FechaProduccion — el día en que se produjo/cosechó la materia prima, que es el que
// va dentro del texto del Lote (ver componerCodigoLote en src/lib/codigoLote.ts).
//
// Hasta ahora Lotes.Fecha hacía las dos cosas: era el día en que el área recibe la materia prima Y
// el día con el que se armaba el código. Cuando lo que entra hoy se produjo ayer, el código salía
// con el día equivocado y no coincidía con el que Etiquetado compone para ese mismo lote
// (ordenEtiquetado.ts ya usa FechaProduccion para lo mismo). Ahora Fecha queda solo como fecha de
// ingreso al área y FechaProduccion es la que manda en el código.
//
// SE CORRE CON LA PLANTA TRABAJANDO, ANTES DE DESPLEGAR EL CÓDIGO NUEVO. Por eso la columna queda
// NULL y sin AFTER:
//
//   - NULL y no NOT NULL: el backend que está corriendo en ese momento no menciona FechaProduccion
//     en su INSERT. Con NOT NULL y sin default, sql_mode trae STRICT_TRANS_TABLES y MariaDB rechaza
//     ese INSERT con "Field 'FechaProduccion' doesn't have a default value" — o sea, nadie podría
//     crear un lote entre esta migración y el despliegue. Con NULL, el código viejo sigue insertando
//     igual que siempre y la fila nueva queda con FechaProduccion NULL.
//   - Sin AFTER: agregar una columna al final es ALGORITHM=INSTANT en MariaDB 10.5 (no copia la
//     tabla, no la bloquea). Un AFTER obliga a reconstruirla. Con 354 filas la copia sería
//     instantánea de todos modos, pero no hay razón para pagarla.
//
// Las filas que queden en NULL las resuelve el código leyendo COALESCE(FechaProduccion, Fecha): así
// se generaron sus códigos, así que esa ES su fecha de producción según el propio texto del lote.
// El relleno de abajo hace permanente ese mismo criterio.
//
// Es idempotente — correrlo de nuevo sobre una base que ya la tiene no hace nada.
import prisma from "../src/lib/prisma.ts";

await prisma.$executeRawUnsafe(
  "ALTER TABLE Lotes ADD COLUMN IF NOT EXISTS FechaProduccion DATE NULL"
);

// Relleno de las filas históricas. Toca solo lo que está en NULL, así que es seguro correrlo en
// cualquier momento y cuantas veces haga falta: una vez desplegado el código nuevo, ninguna fila
// nueva nace en NULL, y volver a correr esto no encuentra nada que cambiar.
const afectadas = await prisma.$executeRawUnsafe(
  "UPDATE Lotes SET FechaProduccion = Fecha WHERE FechaProduccion IS NULL"
);
console.log(`Filas con FechaProduccion rellenada desde Fecha: ${afectadas}`);

// El NOT NULL queda pendiente A PROPÓSITO: ponerlo aquí es lo que rompería al backend viejo. Cuando
// el código nuevo ya esté desplegado y estable, se puede cerrar con:
//   ALTER TABLE Lotes MODIFY COLUMN FechaProduccion DATE NOT NULL
// Mientras tanto el COALESCE del backend cubre cualquier fila que llegue sin ella.

const [col]: any[] = await prisma.$queryRawUnsafe(
  `SELECT COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Lotes' AND COLUMN_NAME = 'FechaProduccion'`
);
console.log(col ? `OK - Lotes.FechaProduccion ${col.COLUMN_TYPE} (nullable: ${col.IS_NULLABLE})` : "ERROR - la columna no quedó creada");

const [pend]: any[] = await prisma.$queryRawUnsafe(
  "SELECT COUNT(*) AS n FROM Lotes WHERE FechaProduccion IS NULL"
);
console.log(`Filas todavía sin FechaProduccion: ${pend.n}`);

await prisma.$disconnect();
