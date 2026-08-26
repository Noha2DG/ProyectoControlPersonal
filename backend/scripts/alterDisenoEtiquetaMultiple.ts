// Varios diseños de BarTender por cliente/subcliente (26 ago 2026).
//
// Hasta hoy DisenoEtiquetaCliente tenía PK (CodigoCliente, CodigoSubcliente), o sea EXACTAMENTE un
// .btw por subcliente, y al imprimir el backend lo resolvía solo. Un mismo subcliente puede tener
// varias artes (master de 1 lb, de 4/5 lb, provisional…), así que la fila deja de ser la llave:
//
//   · DisenoId          — PK propia; la asignación pasa a ser una lista, no un valor
//   · Nombre            — lo que lee el operador en el modal de impresión. El nombre de archivo
//                         ("MASTER P&D T OFF -R-1-20.btw") no se lee de un vistazo con la impresora
//                         enfrente, y la ruta menos.
//   · EsPredeterminado  — cuál se usa sin preguntar. Sin esto, los clientes de un solo arte
//                         perderían el automatismo que tienen hoy.
//   · Activo            — retirar un arte sin borrar el historial de quién lo asignó.
//
// La UNIQUE (CodigoCliente, CodigoSubcliente, RutaBtw) impide asignar dos veces el MISMO archivo al
// mismo subcliente, que es lo único que de verdad es un duplicado.
//
// MariaDB no tiene índices únicos parciales, así que "un solo predeterminado por subcliente" no se
// puede exigir en el esquema: lo cuida el backend, desmarcando los demás dentro de la misma
// transacción (ver disenoEtiquetaCliente.ts).
//
// Las filas que ya existían quedan como el predeterminado de su subcliente, con Nombre = el nombre
// del archivo sin extensión. Así lo asignado antes sigue imprimiendo idéntico.
//
// Reversible: npx tsx backend/scripts/alterDisenoEtiquetaMultiple.ts --revertir
// (se niega si algún subcliente ya tiene más de un diseño: restaurar la PK compuesta ahí perdería
// datos, y elegir cuál sobrevive no es decisión de un script).
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const TABLA = "DisenoEtiquetaCliente";

async function columnas(): Promise<string[]> {
  const cols: any[] = await p.$queryRawUnsafe(`SHOW COLUMNS FROM ${TABLA}`);
  return cols.map((c: any) => c.Field);
}

async function indices(): Promise<string[]> {
  const idx: any[] = await p.$queryRawUnsafe(`SHOW INDEX FROM ${TABLA}`);
  return [...new Set(idx.map((i: any) => i.Key_name))] as string[];
}

/** "C:\Etiquetas\GENERAL\etiquetasmaster.btw" → "etiquetasmaster" */
function nombreDeRuta(ruta: string): string {
  const archivo = String(ruta).split(/[\\/]/).pop() || String(ruta);
  return archivo.replace(/\.btw$/i, "").trim() || archivo;
}

async function migrar() {
  const cols = await columnas();

  // Paso 1 — las columnas nuevas. Van antes que el cambio de llave para poder rellenarlas.
  if (!cols.includes("Nombre")) {
    await p.$executeRawUnsafe(`
      ALTER TABLE ${TABLA}
        ADD COLUMN Nombre           VARCHAR(100) NOT NULL DEFAULT '' AFTER CodigoSubcliente,
        ADD COLUMN EsPredeterminado TINYINT(1)   NOT NULL DEFAULT 0  AFTER RutaBtw,
        ADD COLUMN Activo           TINYINT(1)   NOT NULL DEFAULT 1  AFTER EsPredeterminado
    `);
    console.log("Columnas Nombre / EsPredeterminado / Activo agregadas.");
  } else {
    console.log("Columnas nuevas: ya estaban.");
  }

  // Paso 2 — la UNIQUE nueva ANTES de soltar la PK: la llave foránea a Clientes necesita un índice
  // que empiece por CodigoCliente, y si se quita la PK sin dejar otro, MariaDB rechaza el DROP.
  if (!(await indices()).includes("uq_diseno_ruta")) {
    await p.$executeRawUnsafe(`
      ALTER TABLE ${TABLA}
        ADD UNIQUE KEY uq_diseno_ruta (CodigoCliente, CodigoSubcliente, RutaBtw)
    `);
    console.log("UNIQUE uq_diseno_ruta agregada.");
  } else {
    console.log("UNIQUE uq_diseno_ruta: ya estaba.");
  }

  // Paso 3 — la llave propia. AUTO_INCREMENT obliga a que la columna sea llave en el mismo ALTER.
  if (!(await columnas()).includes("DisenoId")) {
    await p.$executeRawUnsafe(`
      ALTER TABLE ${TABLA}
        DROP PRIMARY KEY,
        ADD COLUMN DisenoId INT NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST
    `);
    console.log("DisenoId agregada como PK (PK compuesta anterior eliminada).");
  } else {
    console.log("DisenoId: ya estaba.");
  }

  // Paso 4 — relleno. Lo que ya estaba asignado es, por definición, el predeterminado de su
  // subcliente: era el único que había.
  //
  // El relleno se hace por GRUPO y solo donde falta, no fila por fila: si este script se vuelve a
  // correr cuando ya existan varios diseños, marcar todos como predeterminados sería peor que no
  // hacer nada. Un grupo que ya tiene su predeterminado se deja intacto.
  const filas: any[] = await p.$queryRawUnsafe(
    `SELECT DisenoId, CodigoCliente, CodigoSubcliente, RutaBtw, Nombre, EsPredeterminado
     FROM ${TABLA} ORDER BY DisenoId`
  );

  let nombrados = 0;
  for (const f of filas) {
    if (String(f.Nombre ?? "").trim()) continue;
    await p.$executeRawUnsafe(
      `UPDATE ${TABLA} SET Nombre = ? WHERE DisenoId = ?`,
      nombreDeRuta(f.RutaBtw), Number(f.DisenoId)
    );
    nombrados++;
  }

  const grupos = new Map<string, any[]>();
  for (const f of filas) {
    const clave = `${Number(f.CodigoCliente)}|${f.CodigoSubcliente}`;
    grupos.set(clave, [...(grupos.get(clave) ?? []), f]);
  }
  let predeterminados = 0;
  for (const [, delGrupo] of grupos) {
    if (delGrupo.some(f => Number(f.EsPredeterminado) === 1)) continue;
    await p.$executeRawUnsafe(
      `UPDATE ${TABLA} SET EsPredeterminado = 1 WHERE DisenoId = ?`,
      Number(delGrupo[0].DisenoId)
    );
    predeterminados++;
  }
  console.log(`${nombrados} nombre(s) rellenados, ${predeterminados} predeterminado(s) marcados.`);

  await mostrar();
}

async function revertir() {
  const dobles: any[] = await p.$queryRawUnsafe(`
    SELECT CodigoCliente, CodigoSubcliente, COUNT(*) AS n
    FROM ${TABLA} GROUP BY CodigoCliente, CodigoSubcliente HAVING n > 1
  `);
  if (dobles.length) {
    console.error("No se puede revertir: estos subclientes ya tienen más de un diseño y la PK");
    console.error("compuesta no los admite. Deja uno solo en cada caso y vuelve a intentarlo.");
    console.table(dobles.map((d: any) => ({ Cliente: Number(d.CodigoCliente), Subcliente: d.CodigoSubcliente, Disenos: Number(d.n) })));
    process.exit(1);
  }

  if ((await columnas()).includes("DisenoId")) {
    await p.$executeRawUnsafe(`
      ALTER TABLE ${TABLA}
        DROP PRIMARY KEY,
        DROP COLUMN DisenoId,
        ADD PRIMARY KEY (CodigoCliente, CodigoSubcliente)
    `);
  }
  if ((await indices()).includes("uq_diseno_ruta")) {
    await p.$executeRawUnsafe(`ALTER TABLE ${TABLA} DROP INDEX uq_diseno_ruta`);
  }
  if ((await columnas()).includes("Nombre")) {
    await p.$executeRawUnsafe(`
      ALTER TABLE ${TABLA}
        DROP COLUMN Nombre, DROP COLUMN EsPredeterminado, DROP COLUMN Activo
    `);
  }
  console.log("Revertido: DisenoEtiquetaCliente vuelve a un diseño por (Cliente, Subcliente).");
  await mostrar();
}

async function mostrar() {
  const cols: any[] = await p.$queryRawUnsafe(`SHOW COLUMNS FROM ${TABLA}`);
  console.table(cols.map((c: any) => ({ Campo: c.Field, Tipo: c.Type, Nulo: c.Null, Llave: c.Key, Extra: c.Extra })));
  const filas: any[] = await p.$queryRawUnsafe(`
    SELECT CodigoCliente, CodigoSubcliente, Nombre, EsPredeterminado, Activo
    FROM ${TABLA} ORDER BY CodigoCliente, CodigoSubcliente
  `);
  console.table(filas.map((f: any) => ({
    Cliente: Number(f.CodigoCliente), Subcliente: f.CodigoSubcliente,
    Nombre: f.Nombre, Predet: Number(f.EsPredeterminado), Activo: Number(f.Activo),
  })));
}

const main = process.argv.includes("--revertir") ? revertir : migrar;

main()
  .then(() => process.exit(0))
  .catch(e => { console.error("ERROR:", e.message); process.exit(1); })
  .finally(() => p.$disconnect());
