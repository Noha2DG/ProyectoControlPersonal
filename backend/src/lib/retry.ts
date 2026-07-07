/**
 * Reintenta una operación async con espera creciente. Pensado para llamadas a
 * la base de datos remota que pueden fallar por un hipo de red pasajero
 * (ej. el barrido de corte de medianoche justo al arrancar el servidor).
 */
export async function reintentar<T>(fn: () => Promise<T>, intentos = 3, esperaMs = 2000): Promise<T> {
  let ultimoError: unknown;
  for (let intento = 1; intento <= intentos; intento++) {
    try {
      return await fn();
    } catch (err) {
      ultimoError = err;
      if (intento < intentos) await new Promise((r) => setTimeout(r, esperaMs * intento));
    }
  }
  throw ultimoError;
}
