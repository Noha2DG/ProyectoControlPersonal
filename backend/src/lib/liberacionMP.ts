// Liberar materia prima: lo importado no sale de bodega hasta que alguien con el permiso `liberar_mp`
// libere el contenedor COMPLETO (decisión 11 nov 2026, ver scripts/createLiberacionMateriaPrima.ts).
// No se usa la palabra "calidad": es otra rama del proceso.
//
// Contenedor = piscina Qnnn de la finca de importación. OrdenEtiquetado.PiscinaId dice de qué
// contenedor es cada master, sin leer el texto del lote (el "Q013" también aparece en el producto
// terminado hecho con él). Un contenedor sin fila en LiberacionMateriaPrima está libre: así los de
// antes del 11 nov no se tocan.
//
// Lo que bloquea: cualquier SALIDA de bodega (escanear en remisión, confirmarla). Lo que no: recibirlo,
// ubicarlo y moverlo dentro de bodega, siempre en polines de materia prima (MP). La única salida que
// se permite estando pendiente es la remisión "Muestra para análisis" (Destino = 'Muestra').

export const FINCA_IMPORTACION = "IM001";
export const DESTINO_MUESTRA = "Muestra";
export const ESTADOS_LIBERACION = ["PENDIENTE", "LIBERADO", "RECHAZADO"] as const;
export const TIPOS_PRODUCTO = ["PT", "MP", "PE"] as const;

type SinLiberar = { Contenedor: string; Estado: string; Masters: number };

const enLista = (n: number) => Array(n).fill("?").join(",");

/** Los contenedores sin liberar entre estos masters, con cuántos masters trae cada uno. */
export async function contenedoresSinLiberar(client: any, masterIds: number[]): Promise<SinLiberar[]> {
  if (!masterIds.length) return [];
  const rows: any[] = await client.$queryRawUnsafe(`
    SELECT pi.Nombre AS Contenedor, lmp.Estado, COUNT(*) AS Masters
      FROM Masters m
      JOIN EtiquetaImpresa ei ON ei.EtiquetaId = m.EtiquetaId
      JOIN OrdenEtiquetado oe ON oe.OrdenId = ei.OrdenId
      JOIN LiberacionMateriaPrima lmp ON lmp.PiscinaId = oe.PiscinaId AND lmp.Estado <> 'LIBERADO'
      JOIN Piscina pi ON pi.PiscinaId = oe.PiscinaId
     WHERE m.MasterId IN (${enLista(masterIds.length)})
     GROUP BY pi.Nombre, lmp.Estado
     ORDER BY pi.Nombre`, ...masterIds);
  return rows.map(r => ({ Contenedor: String(r.Contenedor), Estado: String(r.Estado), Masters: Number(r.Masters) }));
}

const estadoTexto = (e: string) => (e === "RECHAZADO" ? "rechazado" : "pendiente de liberar");

/**
 * El mensaje de rechazo si alguno de estos masters no puede salir de bodega, o null si todos pueden.
 * Una remisión de muestra (Destino 'Muestra') sí puede llevarse lo pendiente: es para el análisis.
 */
export async function bloqueoDeSalida(client: any, masterIds: number[], destinoSerie: string | null): Promise<string | null> {
  if (destinoSerie === DESTINO_MUESTRA) return null;
  const lista = await contenedoresSinLiberar(client, masterIds);
  if (!lista.length) return null;
  const detalle = lista.map(c => `${c.Contenedor} ${estadoTexto(c.Estado)} (${c.Masters} master${c.Masters !== 1 ? "s" : ""})`).join(", ");
  return `Contenedor ${detalle}: no puede salir de bodega hasta que se libere en "Liberar materia prima".`;
}

/** El contenedor sin liberar de una orden de etiquetado (lo que se está escaneando), o null. */
export async function contenedorSinLiberarDeOrden(client: any, ordenId: number): Promise<{ Contenedor: string; Estado: string } | null> {
  const rows: any[] = await client.$queryRawUnsafe(`
    SELECT pi.Nombre AS Contenedor, lmp.Estado
      FROM OrdenEtiquetado oe
      JOIN LiberacionMateriaPrima lmp ON lmp.PiscinaId = oe.PiscinaId AND lmp.Estado <> 'LIBERADO'
      JOIN Piscina pi ON pi.PiscinaId = oe.PiscinaId
     WHERE oe.OrdenId = ? LIMIT 1`, ordenId);
  return rows.length ? { Contenedor: String(rows[0].Contenedor), Estado: String(rows[0].Estado) } : null;
}

/** Mensaje al escanear un master de contenedor sin liberar en un polín que no es de materia prima. */
export function mensajeSoloPolinMP(c: { Contenedor: string; Estado: string }, codigoPolin: string) {
  return `Este master es del contenedor ${c.Contenedor}, ${estadoTexto(c.Estado)}: solo puede ir a un polín de materia prima (MP), y el polín ${codigoPolin} no lo es.`;
}
