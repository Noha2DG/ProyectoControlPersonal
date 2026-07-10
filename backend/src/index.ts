import "dotenv/config"; // v2
import express from "express";
import cors from "cors";
import compression from "compression";
import path from "path";
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
import disenoEtiquetaRouter from "./routes/disenoEtiqueta.ts";
import reportesRouter from "./routes/reportes.ts";
import { requireAuth } from "./middleware/auth.ts";
import { barridoCorteMedianoche } from "./lib/corteMedianoche.ts";
import { reintentar } from "./lib/retry.ts";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(compression());
app.use(express.json());
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

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
app.use("/api/diseno-etiqueta", disenoEtiquetaRouter);
app.use("/api/reportes", reportesRouter);

// Sirve el frontend ya compilado (frontend/dist) para no necesitar un segundo servicio en Railway.
// Si esa carpeta no existe (ej. en desarrollo local con `vite`), simplemente no hace nada.
const frontendDist = path.join(process.cwd(), "..", "frontend", "dist");
app.use(express.static(frontendDist));
app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api") || req.path.startsWith("/uploads")) { next(); return; }
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
});
