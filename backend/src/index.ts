import "dotenv/config"; // v2
import express from "express";
import cors from "cors";
import compression from "compression";
import path from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import authRouter from "./routes/auth.ts";
import empleadosRouter from "./routes/empleados.ts";
import usuariosRouter from "./routes/usuarios.ts";
import movimientosRouter from "./routes/movimientos.ts";
import fotosRouter from "./routes/fotos.ts";
import areasRouter from "./routes/areas.ts";
import transferenciasRouter from "./routes/transferencias.ts";
import planificacionRouter from "./routes/planificacion.ts";
import tiposPermisoRouter from "./routes/tiposPermiso.ts";
import permisosRouter from "./routes/permisos.ts";
import equipoRouter from "./routes/equipo.ts";
import { familiaRouter, procesosRouter, tallasRouter, empaquesRouter, fincaRouter, almacenesRouter, origenRouter, congelacionRouter } from "./routes/catalogosProduccion.ts";
import claseRouter from "./routes/clase.ts";
import presentacionRouter from "./routes/presentacion.ts";
import piscinaRouter from "./routes/piscina.ts";
import cicloRouter from "./routes/ciclo.ts";
import clientesRouter from "./routes/clientes.ts";
import subclienteRouter from "./routes/subcliente.ts";
import pedidosRouter from "./routes/pedidos.ts";
import detallePedidoRouter from "./routes/detallePedido.ts";
import lotesRouter from "./routes/lotes.ts";
import transaccionesProduccionRouter from "./routes/transaccionesProduccion.ts";
import termosRouter from "./routes/termos.ts";
import pesajeDetalleRouter from "./routes/pesajeDetalle.ts";
import ordenEtiquetadoRouter from "./routes/ordenEtiquetado.ts";
import etiquetaImpresaRouter from "./routes/etiquetaImpresa.ts";
import disenoEtiquetaClienteRouter from "./routes/disenoEtiquetaCliente.ts";
import palletsRouter from "./routes/pallets.ts";
import bodegasRouter from "./routes/bodegas.ts";
import bodegaFisicaRouter from "./routes/bodegaFisica.ts";
import remisionesRouter from "./routes/remisiones.ts";
import reportesRouter from "./routes/reportes.ts";
import descongeladoRouter from "./routes/descongelado.ts";
import { requireAuth } from "./middleware/auth.ts";
import { barridoCorteMedianoche } from "./lib/corteMedianoche.ts";
import { barridoEtiquetasVencidas } from "./lib/etiquetasVencidas.ts";
import { reintentar } from "./lib/retry.ts";

// Las rutas de disco se anclan a la ubicacion de este archivo (backend/src), no a process.cwd():
// pm2 conserva el directorio desde el que se hizo `pm2 start`, asi que tras un reboot con
// `pm2 resurrect` — o un arranque desde otra carpeta — el cwd deja de ser backend/ y el proceso
// queda vivo pero sin encontrar frontend/dist: la API sigue de pie y toda la app responde 404.
const RAIZ_BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Una excepción que escapa de todos los try/catch mata el proceso sin dejar rastro: pm2 lo reinicia,
// pero en los logs no queda ni qué pasó ni cuándo. Estos dos manejadores existen para que ese
// momento quede escrito antes de caer.
//
// uncaughtException sí termina el proceso (seguir vivo después de una excepción no atrapada deja el
// estado a medias, y con pm2 detrás el reinicio limpio tarda un par de segundos). unhandledRejection
// no: una promesa sin .catch() casi siempre es una petición suelta, no el servidor entero, y en una
// planta que está capturando producción vale más quedarse de pie y dejar constancia.
process.on("uncaughtException", (err) => {
  console.error(`[${new Date().toISOString()}] EXCEPCIÓN NO ATRAPADA — el proceso va a reiniciar:`, err);
  process.exit(1);
});
process.on("unhandledRejection", (motivo) => {
  console.error(`[${new Date().toISOString()}] PROMESA RECHAZADA SIN CATCH (el servidor sigue de pie):`, motivo);
});

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(compression());
app.use(express.json());
app.use("/uploads", express.static(path.join(RAIZ_BACKEND, "uploads")));

app.use("/api/auth", authRouter);
app.use("/api/empleados", requireAuth, empleadosRouter);
app.use("/api/usuarios", usuariosRouter);
app.use("/api/movimientos", movimientosRouter);
app.use("/api/fotos", fotosRouter);
app.use("/api/areas", areasRouter);
app.use("/api/transferencias", transferenciasRouter);
app.use("/api/planificacion", planificacionRouter);
app.use("/api/tipos-permiso", tiposPermisoRouter);
app.use("/api/permisos", permisosRouter);
app.use("/api/equipo", equipoRouter);
app.use("/api/familia", familiaRouter);
app.use("/api/procesos", procesosRouter);
app.use("/api/tallas", tallasRouter);
app.use("/api/empaques", empaquesRouter);
app.use("/api/clase", claseRouter);
app.use("/api/presentacion", presentacionRouter);
app.use("/api/finca", fincaRouter);
app.use("/api/piscina", piscinaRouter);
app.use("/api/ciclo", cicloRouter);
app.use("/api/clientes", clientesRouter);
app.use("/api/subcliente", subclienteRouter);
app.use("/api/pedidos", pedidosRouter);
app.use("/api/detalle-pedido", detallePedidoRouter);
app.use("/api/almacenes", almacenesRouter);
app.use("/api/lotes", lotesRouter);
app.use("/api/transacciones-produccion", transaccionesProduccionRouter);
app.use("/api/termos", termosRouter);
app.use("/api/pesaje", pesajeDetalleRouter);
app.use("/api/origen", origenRouter);
app.use("/api/unidades-congelacion", congelacionRouter);
app.use("/api/orden-etiquetado", ordenEtiquetadoRouter);
app.use("/api/etiqueta-impresa", etiquetaImpresaRouter);
app.use("/api/diseno-etiqueta-cliente", disenoEtiquetaClienteRouter);
app.use("/api/pallets", palletsRouter);
app.use("/api/bodegas", bodegasRouter);
// Alias del nombre viejo: una pestaña abierta desde antes del despliegue sigue pidiendo esta ruta.
// Se puede quitar cuando ya nadie tenga la pantalla de polines cargada de la versión anterior.
app.use("/api/bodega-virtual", bodegasRouter);
app.use("/api/bodega-fisica", bodegaFisicaRouter);
app.use("/api/remisiones", remisionesRouter);
app.use("/api/reportes", reportesRouter);
app.use("/api/descongelado", descongeladoRouter);

// Sirve el frontend ya compilado (frontend/dist) desde este mismo proceso: así el despliegue es un
// solo servicio, sin un servidor web aparte para los archivos estáticos.
// Si esa carpeta no existe (ej. en desarrollo local con `vite`), simplemente no hace nada.
const frontendDist = path.join(RAIZ_BACKEND, "..", "frontend", "dist");
// frontend/dist está en .gitignore: no viaja con `git pull`, hay que compilarlo en el servidor
// (herramientas/desplegar.sh lo hace). Si falta, antes esto fallaba callado — la API respondía bien
// y la app entera daba 404, con pm2 reportando "online". Ahora queda dicho al arrancar.
if (!existsSync(path.join(frontendDist, "index.html"))) {
  console.error(`ATENCIÓN: no existe ${path.join(frontendDist, "index.html")} — la API responde, pero la aplicación web va a dar 404. Compila el frontend (npm run build) antes de servir.`);
}
app.use(express.static(frontendDist));

// Una ruta que termina en extensión (.js, .css, .png…) es un archivo, no una pantalla de la app.
// Si express.static no lo encontró, es que no existe: casi siempre un asset de una compilación
// anterior que un navegador con la página vieja en caché sigue pidiendo (Vite les pone un hash en
// el nombre y cada `npm run build` borra los del build anterior).
const PARECE_ARCHIVO = /\.[a-z0-9]+$/i;

app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api") || req.path.startsWith("/uploads")) { next(); return; }

  // Devolver index.html para esos archivos es lo que rompía la aplicación entera: el navegador pedía
  // /assets/index-<hash viejo>.js, recibía 200 con el HTML dentro, intentaba leer HTML como
  // JavaScript y se quedaba en blanco. Peor aún, al responder 200 el fallo no aparecía como error en
  // ningún log. Un 404 de verdad hace que el navegador recargue y que el problema sea visible.
  if (PARECE_ARCHIVO.test(req.path)) { next(); return; }

  // index.html nunca se cachea: es el que dice qué assets pedir, y servir una copia vieja es
  // exactamente lo que deja al navegador pidiendo archivos que ya no existen.
  res.set("Cache-Control", "no-cache");
  res.sendFile(path.join(frontendDist, "index.html"), (err) => { if (err) next(); });
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);

  // Reabre en el día de hoy a quien se quedó con una Entrada abierta de un día
  // anterior (turno que cruzó medianoche), aunque nadie vuelva a marcar todavía
  // — así los reportes de la mañana ya salen correctos.
  const INTERVALO_BARRIDO_MS = 15 * 60 * 1000;
  // Reintenta 3 veces (2s, 4s) antes de darse por vencido: al arrancar es común
  // que la base de datos remota tarde un momento en responder (DNS, red).
  const ejecutarBarrido = () =>
    reintentar(() => barridoCorteMedianoche(), 3, 2000).catch(err =>
      console.error("Barrido corte medianoche falló:", err.message)
    );
  ejecutarBarrido();
  setInterval(ejecutarBarrido, INTERVALO_BARRIDO_MS);

  // Anula las etiquetas impresas que llevan 48 h sin escanearse: dejan de poder entrar a bodega y
  // dejan de contar como impresas, que es lo que se cuadra a diario. Mismo intervalo y mismos
  // reintentos que el corte de medianoche — es un UPDATE idempotente, repetirlo no cuesta nada.
  const ejecutarVencidas = () =>
    reintentar(() => barridoEtiquetasVencidas(), 3, 2000).catch(err =>
      console.error("Barrido de etiquetas vencidas falló:", err.message)
    );
  ejecutarVencidas();
  setInterval(ejecutarVencidas, INTERVALO_BARRIDO_MS);
});
