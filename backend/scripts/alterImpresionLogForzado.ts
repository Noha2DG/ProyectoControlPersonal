// Decisión 20 jul 2026: reimprimir la etiqueta de un master que YA está escaneado en bodega
// (existe en Masters) ya no pasa inadvertido — etiquetaImpresa.ts avisa dónde quedó ese master y,
// si de todas formas se fuerza la reimpresión, ahora exige el permiso etiquetado.editar además de
// imprimir (no solo un motivo de texto libre). Esta columna audita cuándo pasó eso realmente, para
// poder distinguir después una reimpresión normal (etiqueta dañada antes de llegar a bodega) de una
// forzada sobre un master que ya viajó — útil para detectar problemas antes de que la duplicidad
// aparezca recién al escanear en la bodega física real.
// NULLable no aplica aquí (a diferencia de otras columnas agregadas antes): no hay ambigüedad
// retroactiva que preservar, todo el historial previo de ImpresionLog es, por definición, de
// reimpresiones no forzadas (la validación no existía), así que DEFAULT 0 es correcto también para
// las filas ya existentes.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  await p.$executeRawUnsafe(`ALTER TABLE ImpresionLog ADD COLUMN ReimpresionForzada TINYINT(1) NOT NULL DEFAULT 0 AFTER Motivo`);
  console.log("Columna ReimpresionForzada agregada a ImpresionLog.");
  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
