// Resolución del código que trae el QR de un master. Vive acá porque antes estaba triplicado
// —idéntico— en pallets.ts, remisiones.ts y etiquetaImpresa.ts, y desde que existen correlativos
// migrados (ver alterEtiquetaImpresaCorrelativo.ts) tenerlo por triplicado significa que arreglar el
// escaneo y olvidar la remisión deja media aplicación sin reconocer media bodega.
//
// Dos formas conviven y son indistinguibles para todo el sistema:
//   · las nuestras   -> "E47"           (EtiquetaImpresa.Correlativo = "E" + EtiquetaId)
//   · las migradas   -> "290526007511"  (código del sistema anterior, ya impreso en la caja)

// Lo que devuelve el lector, listo para comparar contra la columna. Se respeta tal cual salvo
// espacios y mayúsculas: cualquier otra "limpieza" corre el riesgo de convertir un código migrado
// válido en otro código migrado válido.
export function normalizarCorrelativo(valor: any): string | null {
  const s = String(valor ?? "").trim().toUpperCase();
  return s.length > 0 && s.length <= 20 ? s : null;
}

// Resuelve un correlativo a su EtiquetaId. Devuelve null si no existe.
// `client` acepta tanto el PrismaClient global como una tx de prisma.$transaction.
export async function resolverEtiqueta(client: any, valor: any): Promise<{ EtiquetaId: number; Correlativo: string } | null> {
  const codigo = normalizarCorrelativo(valor);
  if (!codigo) return null;
  const rows: any[] = await client.$queryRaw`
    SELECT EtiquetaId, Correlativo FROM EtiquetaImpresa WHERE Correlativo = ${codigo} LIMIT 1
  `;
  if (!rows.length) return null;
  return { EtiquetaId: Number(rows[0].EtiquetaId), Correlativo: String(rows[0].Correlativo) };
}

// Solo para operaciones POR RANGO (anulación en bloque, aviso de impresión de BarTender): un rango
// "de E100 a E140" presupone correlativos consecutivos, cosa que únicamente cumplen los nuestros.
// Un código migrado es numérico pero no pertenece a ninguna secuencia — nunca debe entrar acá.
export function parseCorrelativoSecuencial(valor: any): number | null {
  const s = String(valor ?? "").trim();
  if (!/^[eE]?\d{1,9}$/.test(s)) return null;
  const n = Number(s.replace(/^[eE]/, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
}
