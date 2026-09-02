import prisma from "./prisma.ts";

const OPERADOR_SISTEMA = "Sistema";

// Una etiqueta impresa que a las 48 horas no se escaneó en bodega no va a escanearse nunca: la caja
// se dañó, se reprocesó, se reimprimió con otro correlativo o simplemente el papel se perdió. Mientras
// siga 'Activa' cuenta como impresa en los reportes y sigue siendo escaneable, así que un correlativo
// de hace semanas puede entrar a inventario de golpe y descuadrar el conteo del día.
//
// Anularlas cierra las dos puntas: dejan de poder escanearse y dejan de sumar en "Generadas", que es
// lo que se cuadra a diario contra lo que de verdad entró a bodega.
//
// No es irreversible: si la caja aparece, se reactiva desde Impresión de Etiquetas (PUT
// /api/etiqueta-impresa/:id/reactivar) y vuelve a ser escaneable. Por eso el barrido puede ser
// automático sin riesgo de perder producto real.
export const HORAS_VIGENCIA_ETIQUETA = 48;

export const MOTIVO_VENCIMIENTO =
  `Anulada automáticamente: ${HORAS_VIGENCIA_ETIQUETA} h impresa sin escanearse en bodega`;

/**
 * Anula las etiquetas que llevan más de HORAS_VIGENCIA_ETIQUETA impresas sin master en bodega.
 * Devuelve cuántas anuló.
 *
 * Los tres filtros importan:
 *   - Estatus 'Activa'        → no re-anula lo ya anulado (y no pisa el motivo de una anulación manual).
 *   - sin master              → si ya entró a bodega, la etiqueta cumplió su propósito y no se toca,
 *                               sin importar la antigüedad.
 *   - captura no Cancelada    → esas ya están fuera de todo conteo; anularlas solo sería ruido.
 */
export async function anularEtiquetasVencidas(): Promise<number> {
  const n = await prisma.$executeRaw`
    UPDATE EtiquetaImpresa ei
      JOIN OrdenEtiquetado oe ON oe.OrdenId = ei.OrdenId
      LEFT JOIN Masters m ON m.EtiquetaId = ei.EtiquetaId
       SET ei.Estatus = 'Anulada',
           ei.AnuladoPor = ${OPERADOR_SISTEMA},
           ei.AnuladoEn = NOW(),
           ei.MotivoAnulacion = ${MOTIVO_VENCIMIENTO}
     WHERE ei.Estatus = 'Activa'
       AND m.MasterId IS NULL
       AND oe.Estatus <> 'Cancelada'
       AND ei.CreadoEn < (NOW() - INTERVAL ${HORAS_VIGENCIA_ETIQUETA} HOUR)
  `;
  return Number(n);
}

/** Barrido periódico: anula las vencidas y deja constancia en el log solo cuando hubo algo que anular. */
export async function barridoEtiquetasVencidas(): Promise<void> {
  const n = await anularEtiquetasVencidas();
  if (n > 0) {
    console.log(`Etiquetas vencidas anuladas (${HORAS_VIGENCIA_ETIQUETA} h sin escanear): ${n}`);
  }
}
