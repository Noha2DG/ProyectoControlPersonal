// Plantilla ZPL de la etiqueta de master. Layout base confirmado jul 2026 contra una etiqueta física
// real del cliente (foto): Pedido, Cliente-Subcliente, Lote, Proceso+Talla+Presentación y el QR (con
// su correlativo repetido como texto legible debajo). Color/Origen/Congelación/Área/Fecha Producción
// existen como campos opcionales — ocultos por defecto, se activan y se reposicionan arrastrando en
// la vista previa cuando algún pedido los necesita (ver DisenoEtiqueta / project_ordenetiquetado_design).
// La etiqueta de ingredientes/registro sanitario es un documento aparte, no la maneja este módulo.

// Tamaños de etiqueta confirmados jul 2026 contra el driver ZDesigner ZT411-203dpi ("Config. de
// página" → medidas reales del rollo, no el nominal redondeado a pulgada exacta). El operador elige
// a mano cuál está usando según el rollo físico cargado en la impresora — no hay forma de detectarlo
// automáticamente desde el software (Browser Print no expone esa info).
// 1 pulgada = 203 puntos a 203dpi → puntos = mm * (203/25.4), redondeado al entero más cercano.
// "3x1" es horizontal (más ancha que alta, como dice su nombre: 3 de ancho, 1 de alto) — confirmado
// directamente por el usuario jul 2026. Hubo un intento previo de invertir Ancho/Alto pensando que el
// rollo se alimentaba con el lado angosto por delante (basado solo en cómo se veía una foto de un
// primer intento de impresión, sin poder probarlo contra la impresora real) — resultó equivocado y
// se revirtió: la forma real es horizontal, no vertical.
// Medida de "3x1" ajustada jul 2026 con metro sobre la etiqueta física real (orilla a orilla):
// 78 x 27mm, no 80 x 30mm nominal — los otros 3 tamaños siguen en su medida nominal hasta que se
// midan también con metro.
export const TAMANOS_ETIQUETA = {
  "4x2": { label: "4 x 2 pulg (104 x 50.8mm)", AnchoPuntos: 831, AltoPuntos: 406 },
  "4x4": { label: "4 x 4 pulg (104 x 104mm)", AnchoPuntos: 831, AltoPuntos: 831 },
  "3x1": { label: "3 x 1 pulg (78 x 27mm)", AnchoPuntos: 623, AltoPuntos: 216 },
  "4x6": { label: "4 x 6 pulg (104 x 148mm)", AnchoPuntos: 831, AltoPuntos: 1183 },
} as const;
export type TamanoId = keyof typeof TAMANOS_ETIQUETA;
export const TAMANO_DEFECTO: TamanoId = "4x2";

// Campos que se pueden mostrar/ocultar y reposicionar arrastrando en la vista previa (tabla
// DisenoEtiqueta) — el tamaño de letra por ahora queda fijo en el código.
export const CAMPOS_DISENO = [
  "pedido", "clienteSubcliente", "lote", "procesoTallaPresentacion",
  "color", "origen", "congelacion", "area", "fechaProduccion",
  "qr", "correlativoTexto",
] as const;
export type CampoDiseno = typeof CAMPOS_DISENO[number];
export type Posiciones = Record<CampoDiseno, { X: number; Y: number; Visible: boolean }>;

export const ETIQUETA_CAMPO_LABEL: Record<CampoDiseno, string> = {
  pedido: "Pedido",
  clienteSubcliente: "Cliente-Subcliente",
  lote: "Lote",
  procesoTallaPresentacion: "Proceso + Talla + Presentación",
  color: "Color",
  origen: "Origen",
  congelacion: "Congelación",
  area: "Área",
  fechaProduccion: "Fecha Producción",
  qr: "Código QR",
  correlativoTexto: "Correlativo (texto)",
};

// Posiciones por defecto para el tamaño 4x2 (el único usado hasta jul 2026, ya personalizado por el
// usuario arrastrando en la vista previa) — sirven de base para derivar por escala las de los otros
// 3 tamaños (ver escalarPosicionesDefecto) cuando un tamaño todavía no tiene diseño propio guardado.
export const POSICIONES_DEFECTO: Posiciones = {
  pedido: { X: 30, Y: 20, Visible: true },
  clienteSubcliente: { X: 30, Y: 64, Visible: true },
  lote: { X: 30, Y: 98, Visible: true },
  procesoTallaPresentacion: { X: 30, Y: 136, Visible: true },
  color: { X: 260, Y: 212, Visible: false },
  origen: { X: 260, Y: 244, Visible: false },
  congelacion: { X: 450, Y: 244, Visible: false },
  area: { X: 260, Y: 276, Visible: false },
  fechaProduccion: { X: 450, Y: 276, Visible: false },
  qr: { X: 30, Y: 190, Visible: true },
  correlativoTexto: { X: 30, Y: 376, Visible: true },
};

// Posiciones de "3x1" ya verificadas contra una impresión física real (jul 2026) — el usuario las
// ajustó a mano en "Editar diseño"/"Guardar diseño" sobre el lienzo horizontal ya corregido (623x216)
// y confirmó que así "se ve bien la impresión física". Se copian aquí (además de quedar guardadas en
// DisenoEtiqueta) para no depender solo del dato mutable en la BD — si esas filas se borraran o se
// tuviera que recrear la base desde cero, este es el respaldo de la posición que ya funciona, en vez
// de recalcular una adivinanza proporcional desde 4x2 que habría que volver a ajustar a mano.
export const POSICIONES_3X1: Posiciones = {
  pedido: { X: 49, Y: 30, Visible: true },
  clienteSubcliente: { X: 49, Y: 70, Visible: true },
  lote: { X: 46, Y: 109, Visible: true },
  procesoTallaPresentacion: { X: 45, Y: 149, Visible: true },
  color: { X: 195, Y: 113, Visible: false },
  origen: { X: 195, Y: 130, Visible: false },
  congelacion: { X: 337, Y: 130, Visible: false },
  area: { X: 195, Y: 147, Visible: false },
  fechaProduccion: { X: 337, Y: 147, Visible: false },
  qr: { X: 453, Y: 22, Visible: true },
  correlativoTexto: { X: 459, Y: 163, Visible: true },
};

// Deriva posiciones por defecto para un tamaño que todavía no tiene diseño propio guardado en
// DisenoEtiqueta. "3x1" ya tiene un diseño confirmado (POSICIONES_3X1, ver arriba) — para los demás
// tamaños sin confirmar (4x4/4x6) se sigue escalando proporcionalmente desde 4x2 como punto de
// partida editable, que el operador termina de ajustar arrastrando en "Editar diseño".
export function escalarPosicionesDefecto(tamano: TamanoId): Posiciones {
  if (tamano === TAMANO_DEFECTO) return POSICIONES_DEFECTO;
  if (tamano === "3x1") return POSICIONES_3X1;
  const base = TAMANOS_ETIQUETA[TAMANO_DEFECTO];
  const destino = TAMANOS_ETIQUETA[tamano];
  const escalaX = destino.AnchoPuntos / base.AnchoPuntos;
  const escalaY = destino.AltoPuntos / base.AltoPuntos;
  const resultado = {} as Posiciones;
  for (const campo of CAMPOS_DISENO) {
    const pos = POSICIONES_DEFECTO[campo];
    resultado[campo] = { X: Math.round(pos.X * escalaX), Y: Math.round(pos.Y * escalaY), Visible: pos.Visible };
  }
  return resultado;
}

export interface DatosEtiqueta {
  correlativo: string;       // contenido del QR — únicamente el ID de referencia (ej. "E123")
  codigoPedido: string;
  cliente: string;
  subcliente?: string | null;
  proceso: string;           // Descripción del Proceso (Clase.Proceso -> Procesos.Descripcion), sin la Familia
  talla: string;
  presentacion: string;
  lote: string;
  color?: string | null;
  origen?: string | null;
  congelacion?: string | null;
  area?: string | null;
  fechaProduccion?: string | null; // YYYY-MM-DD
}

function escaparZPL(texto: string) {
  // ^ y ~ son caracteres de control ZPL — se reemplazan si aparecieran en texto libre.
  return String(texto ?? "").replace(/\^/g, "").replace(/~/g, "");
}

export function construirZPL(
  d: DatosEtiqueta,
  pos: Posiciones = POSICIONES_DEFECTO,
  tamano: TamanoId = TAMANO_DEFECTO,
): string {
  const { AnchoPuntos, AltoPuntos } = TAMANOS_ETIQUETA[tamano];
  const l = (t: string) => escaparZPL(t);
  const clienteSubcliente = d.subcliente ? `${l(d.cliente)}-${l(d.subcliente)}` : l(d.cliente);
  const anchoTexto = AnchoPuntos - 60;
  const fo = (campo: CampoDiseno) => `^FO${pos[campo].X},${pos[campo].Y}`;
  const siVisible = (campo: CampoDiseno, zpl: string) => (pos[campo].Visible ? zpl : null);

  return [
    "^XA",
    "^CI28",
    `^PW${AnchoPuntos}`,
    `^LL${AltoPuntos}`,
    siVisible("pedido", `${fo("pedido")}^A0N,36,36^FD${l(d.codigoPedido)}^FS`),
    siVisible("clienteSubcliente", `${fo("clienteSubcliente")}^A0N,26,26^FB${anchoTexto},1,0,L^FD${clienteSubcliente}^FS`),
    siVisible("lote", `${fo("lote")}^A0N,28,28^FD${l(d.lote)}^FS`),
    siVisible("procesoTallaPresentacion", `${fo("procesoTallaPresentacion")}^A0N,24,24^FB${anchoTexto},2,0,L^FD${l(d.proceso)} ${l(d.talla)}  ${l(d.presentacion)}^FS`),
    siVisible("color", `${fo("color")}^A0N,22,22^FD${l(d.color || "-")}^FS`),
    siVisible("origen", `${fo("origen")}^A0N,22,22^FD${l(d.origen || "-")}^FS`),
    siVisible("congelacion", `${fo("congelacion")}^A0N,22,22^FD${l(d.congelacion || "-")}^FS`),
    siVisible("area", `${fo("area")}^A0N,22,22^FD${l(d.area || "-")}^FS`),
    siVisible("fechaProduccion", `${fo("fechaProduccion")}^A0N,22,22^FD${l(d.fechaProduccion || "-")}^FS`),
    siVisible("qr", `${fo("qr")}^BQN,2,6^FDQA,${l(d.correlativo)}^FS`),
    siVisible("correlativoTexto", `${fo("correlativoTexto")}^A0N,22,22^FD${l(d.correlativo)}^FS`),
    "^XZ",
  ].filter(Boolean).join("\n");
}
