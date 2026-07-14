// Corrige TAMANOS_ETIQUETA["3x1"] (Ancho/Alto invertidos — ver comentario en zpl.ts) y por lo tanto
// invalida las posiciones que el usuario ya había guardado a mano para ese tamaño (estaban pensadas
// para un lienzo ancho-y-bajo de 639x240, el real es angosto-y-alto de 240x639). Se reemplazan por
// defaults recalculados con escalarPosicionesDefecto sobre las dimensiones ya corregidas — el usuario
// las reacomoda de nuevo arrastrando en "Editar diseño" la próxima vez que use este tamaño.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { escalarPosicionesDefecto, TAMANOS_ETIQUETA } from "../src/lib/zpl.ts";
const p = new PrismaClient();

async function main() {
  const posiciones = escalarPosicionesDefecto("3x1");
  await p.$executeRawUnsafe(`DELETE FROM DisenoEtiqueta WHERE Tamano = '3x1'`);
  for (const [campo, { X, Y, Visible }] of Object.entries(posiciones)) {
    await p.$executeRawUnsafe(
      `INSERT INTO DisenoEtiqueta (Campo, Tamano, X, Y, Visible) VALUES (?, '3x1', ?, ?, ?)`,
      campo, X, Y, Visible ? 1 : 0,
    );
  }
  const { AnchoPuntos, AltoPuntos } = TAMANOS_ETIQUETA["3x1"];
  console.log(`Posiciones de "3x1" recalculadas para el lienzo corregido (${AnchoPuntos}x${AltoPuntos}):`, posiciones);
  await p.$disconnect();
}
main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
