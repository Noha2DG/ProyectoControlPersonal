import "dotenv/config";
import express from "express";
import cors from "cors";
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
import { requireAuth } from "./middleware/auth.ts";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
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

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
