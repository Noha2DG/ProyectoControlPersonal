import { crearCatalogoRouter } from "../lib/catalogoRouter.ts";

export const familiaRouter = crearCatalogoRouter({ tabla: "Familia", pk: "Codigo" });
export const procesosRouter = crearCatalogoRouter({ tabla: "Procesos", pk: "Proceso", pkEsNumero: true, orderBy: "Proceso" });
export const tallasRouter = crearCatalogoRouter({ tabla: "Tallas", pk: "Codigo", pkEsNumero: true, orderBy: "Codigo" });
export const empaquesRouter = crearCatalogoRouter({
  tabla: "Empaques",
  pk: "Codigo",
  camposExtra: [{ columna: "TipoEmpaque", requerido: true }],
});
export const fincaRouter = crearCatalogoRouter({
  tabla: "Finca",
  pk: "Codigo",
  camposExtra: [{ columna: "Grupo" }, { columna: "Abreviatura", requerido: true }],
});
