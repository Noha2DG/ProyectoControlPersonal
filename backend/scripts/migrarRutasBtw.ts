// Mueve las rutas de los diseños de BarTender a la carpeta compartida de la oficina.
//
//   npx tsx backend/scripts/migrarRutasBtw.ts "\\servidor\etiquetas" [--commit] [--forzar]
//
// Por qué un script y no trece ediciones a mano: la ruta guardada tiene que caer DENTRO de la
// carpeta que autoriza el manejador de cada PC (`$CarpetaBtw` en abrirBartender.ps1). Si una sola
// queda mal, ese cliente deja de imprimir y se descubre con el operador parado frente a la
// impresora. Acá se ve el antes/después completo y —lo importante— se COMPRUEBA que cada .btw
// exista de verdad en el destino antes de escribir nada.
//
// Sin --commit solo muestra el plan. Si algún archivo no aparece en la carpeta nueva, se niega a
// aplicar; --forzar salta esa negativa (úsalo solo si sabes que el archivo cambió de nombre a
// propósito y lo vas a reasignar después a mano).
//
// El prefijo viejo no se asume: se corta todo lo que haya ANTES de "\Etiquetas\" y se conserva la
// subcarpeta. Así da igual que la ruta vieja sea C:\Etiquetas\… o E:\Etiquetas\… — las dos formas
// existen hoy en la tabla.
//
// Después de correr esto hay que dejar iguales las otras dos puntas, o no imprime nada:
//   1. `$CarpetaBtw` en abrirBartender.ps1 de CADA estación.
//   2. `BTW_CARPETA` en backend/.env.

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const TABLA = "DisenoEtiquetaCliente";

class Revertir extends Error {}

/** Devuelve la parte de la ruta a partir de la carpeta "Etiquetas" (sin incluirla). */
function subrutaDesdeEtiquetas(ruta: string): string | null {
  const m = /[\\/]Etiquetas[\\/](.+)$/i.exec(String(ruta ?? ""));
  return m ? m[1] : null;
}

async function main() {
  const COMMIT = process.argv.includes("--commit");
  const FORZAR = process.argv.includes("--forzar");
  const crudo = String(process.argv[2] ?? "").trim().replace(/[\\/]+$/, "");
  if (!crudo || crudo.startsWith("--")) {
    console.error('Uso: npx tsx backend/scripts/migrarRutasBtw.ts "//servidor/etiquetas" [--commit] [--forzar]');
    process.exit(1);
  }
  // Se acepta con barras normales ("//servidor/etiquetas") y se normaliza a la forma de Windows.
  // Las barras invertidas se comen fácil en la línea de comandos —el primer intento de esto llegó
  // como "\SERVIDOR\etiquetas", con UNA sola barra— y escribir esa ruta en las 13 filas dejaría a
  // todos sin imprimir. Por eso se valida la FORMA antes de tocar nada: UNC de dos barras o unidad
  // local con letra. Cualquier otra cosa se rechaza.
  const raizNueva = crudo.replace(/\//g, "\\");
  const esUNC = /^\\\\[^\\]+\\[^\\]+/.test(raizNueva);
  const esLocal = /^[A-Za-z]:\\/.test(raizNueva);
  if (!esUNC && !esLocal) {
    console.error(`Ruta inválida: ${raizNueva}`);
    console.error('Se espera "//servidor/etiquetas" (o \\\\servidor\\etiquetas) o una unidad local "C:/Etiquetas".');
    console.error("Si escribiste barras invertidas y llegó con una sola, usa barras normales.");
    process.exit(1);
  }
  console.log(`Carpeta destino: ${raizNueva}\n`);

  const filas: any[] = await p.$queryRawUnsafe(`
    SELECT d.DisenoId, d.Nombre, d.RutaBtw, d.CodigoSubcliente, c.RazonSocial
      FROM ${TABLA} d LEFT JOIN Clientes c ON c.Codigo = d.CodigoCliente
     ORDER BY c.RazonSocial, d.CodigoSubcliente, d.DisenoId`);

  const plan: { id: number; cliente: string; nombre: string; vieja: string; nueva: string; existe: boolean }[] = [];
  const raros: any[] = [];

  for (const f of filas) {
    const sub = subrutaDesdeEtiquetas(f.RutaBtw);
    if (!sub) { raros.push(f); continue; }
    const nueva = `${raizNueva}\\${sub.replace(/\//g, "\\")}`;
    let existe = false;
    try { await fs.access(nueva); existe = true; } catch { existe = false; }
    plan.push({
      id: Number(f.DisenoId), cliente: `${f.RazonSocial ?? "?"}${f.CodigoSubcliente ? "/" + f.CodigoSubcliente : ""}`,
      nombre: f.Nombre ?? path.basename(String(f.RutaBtw)), vieja: f.RutaBtw, nueva, existe,
    });
  }

  console.log(`${plan.length} diseño(s) a mover:\n`);
  for (const x of plan) {
    console.log(`  ${x.existe ? "✔" : "✘"} ${x.cliente} — ${x.nombre}`);
    console.log(`      de : ${x.vieja}`);
    console.log(`      a  : ${x.nueva}`);
  }
  if (raros.length) {
    console.log(`\nAVISO: ${raros.length} ruta(s) no contienen una carpeta "Etiquetas" y NO se tocan:`);
    for (const r of raros) console.log(`  ${r.RazonSocial}: ${r.RutaBtw}`);
  }

  const faltantes = plan.filter(x => !x.existe);
  if (faltantes.length) {
    console.log(`\n⚠  ${faltantes.length} archivo(s) NO se encuentran en la carpeta nueva:`);
    for (const x of faltantes) console.log(`   ${x.nueva}`);
    console.log("   (o falta copiarlos, o esta PC no alcanza el recurso compartido)");
    if (!FORZAR) {
      console.log("\nNo se aplica nada. Copia lo que falte y vuelve a correr, o usa --forzar si sabes lo que haces.");
      await p.$disconnect();
      return;
    }
    console.log("\n--forzar activo: se aplica igual.");
  }

  try {
    await p.$transaction(async (tx) => {
      for (const x of plan) {
        await tx.$executeRawUnsafe(`UPDATE ${TABLA} SET RutaBtw = ? WHERE DisenoId = ?`, x.nueva, x.id);
      }
      console.log(`\n${plan.length} ruta(s) actualizadas.`);
      if (!COMMIT) throw new Revertir();
    }, { timeout: 60_000 });
  } catch (e) {
    if (!(e instanceof Revertir)) throw e;
  }

  const quedan: any[] = await p.$queryRawUnsafe(
    `SELECT COUNT(*) AS n FROM ${TABLA} WHERE RutaBtw LIKE ?`, `${raizNueva}%`);
  console.log(`\nEstado real → ${Number(quedan[0].n)} de ${filas.length} apuntan ya a la carpeta nueva.`);
  console.log(COMMIT
    ? "GUARDADO. Falta: $CarpetaBtw en cada estación y BTW_CARPETA en backend/.env."
    : "SIMULACIÓN — revertido, no se escribió nada. Repetir con --commit.");
  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
