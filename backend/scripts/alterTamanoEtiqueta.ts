// Soporte de múltiples tamaños de etiqueta (4x2, 4x4, 3x1, 4x6) confirmados jul 2026 contra el
// driver ZDesigner ZT411-203dpi — el operador elige a mano cuál está imprimiendo según el rollo
// físico cargado. Ver TAMANOS_ETIQUETA en zpl.ts y project_ordenetiquetado_design.
//
// DisenoEtiqueta pasa de PK(Campo) a PK(Campo, Tamano): las 11 filas ya existentes (posiciones que
// el usuario ya había personalizado) se re-etiquetan como '4x2' sin tocar sus X/Y, y se agregan las
// filas de los otros 3 tamaños con posiciones escaladas proporcionalmente desde 4x2 (ver
// escalarPosicionesDefecto) como punto de partida editable.
//
// EtiquetaImpresa gana columna Tamano (queda fijo el tamaño usado al momento de imprimir esa etiqueta,
// para que una reimpresión respete el mismo tamaño sin depender de qué esté seleccionado en pantalla
// en ese momento) — las etiquetas ya impresas se asumen '4x2' porque es el único tamaño usado hasta hoy.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { TAMANOS_ETIQUETA, TAMANO_DEFECTO, escalarPosicionesDefecto } from "../src/lib/zpl.ts";
const p = new PrismaClient();

async function main() {
  const colsEtiqueta: any[] = await p.$queryRawUnsafe("SHOW COLUMNS FROM EtiquetaImpresa LIKE 'Tamano'");
  if (!colsEtiqueta.length) {
    await p.$executeRawUnsafe(`ALTER TABLE EtiquetaImpresa ADD COLUMN Tamano VARCHAR(10) NOT NULL DEFAULT '${TAMANO_DEFECTO}' AFTER OrdenId`);
    console.log("Columna Tamano agregada a EtiquetaImpresa (filas existentes quedan en '4x2').");
  } else {
    console.log("EtiquetaImpresa.Tamano ya existe — se omite ese paso.");
  }

  const colsDiseno: any[] = await p.$queryRawUnsafe("SHOW COLUMNS FROM DisenoEtiqueta LIKE 'Tamano'");
  if (!colsDiseno.length) {
    await p.$executeRawUnsafe(`ALTER TABLE DisenoEtiqueta ADD COLUMN Tamano VARCHAR(10) NOT NULL DEFAULT '${TAMANO_DEFECTO}' AFTER Campo`);
    await p.$executeRawUnsafe("ALTER TABLE DisenoEtiqueta DROP PRIMARY KEY, ADD PRIMARY KEY (Campo, Tamano)");
    console.log("Columna Tamano agregada a DisenoEtiqueta y PK cambiada a (Campo, Tamano) — filas existentes quedan en '4x2'.");
  } else {
    console.log("DisenoEtiqueta.Tamano ya existe — se omite ese paso.");
  }

  for (const tamano of Object.keys(TAMANOS_ETIQUETA)) {
    if (tamano === TAMANO_DEFECTO) continue; // ya existen (re-etiquetadas arriba)
    const posiciones = escalarPosicionesDefecto(tamano as any);
    for (const [campo, { X, Y, Visible }] of Object.entries(posiciones)) {
      await p.$executeRawUnsafe(
        `INSERT IGNORE INTO DisenoEtiqueta (Campo, Tamano, X, Y, Visible) VALUES (?, ?, ?, ?, ?)`,
        campo, tamano, X, Y, Visible ? 1 : 0,
      );
    }
    console.log(`Posiciones por defecto insertadas para tamaño ${tamano} (escaladas desde 4x2).`);
  }

  await p.$disconnect();
}
main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
