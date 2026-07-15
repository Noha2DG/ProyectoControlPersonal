// Plantilla ZPL de la etiqueta de master. Layout base confirmado jul 2026 contra una etiqueta física
// real del cliente (foto): Pedido, Cliente-Subcliente, Lote, Proceso+Talla+Presentación y el QR (con
// su correlativo repetido como texto legible debajo). Color/Origen/Congelación/Área/Fecha Producción
// existen como campos opcionales — ocultos por defecto, se activan y se reposicionan arrastrando en
// la vista previa cuando algún pedido los necesita (ver DisenoEtiqueta / project_ordenetiquetado_design).
// La etiqueta de ingredientes/registro sanitario es un documento aparte, no la maneja este módulo.

// Tamaño de etiqueta: decisión del 14 jul 2026 — se arranca con UNA SOLA medida, la "3x1", que es
// la única verificada contra impresiones físicas reales; las otras 3 (4x2/4x4/4x6, medidas nominales
// del driver nunca confirmadas con metro) se eliminaron del catálogo y de DisenoEtiqueta (script
// soloTamano3x1.ts). Cuando planta incorpore otro rollo, se agrega aquí su medida REAL (con metro
// sobre la etiqueta física) y el resto del sistema lo toma solo: el selector "Rollo cargado" del
// frontend y DisenoEtiqueta ya están preparados para más de un tamaño.
// 1 pulgada = 203 puntos a 203dpi → puntos = mm * (203/25.4), redondeado al entero más cercano.
// "3x1" es horizontal (más ancha que alta, como dice su nombre: 3 de ancho, 1 de alto) — confirmado
// directamente por el usuario jul 2026. Medida ajustada con metro sobre la etiqueta física real
// (orilla a orilla): 78 x 27mm, no 80 x 30mm nominal.
export const TAMANOS_ETIQUETA = {
  "3x1": { label: "3 x 1 pulg (78 x 27mm)", AnchoPuntos: 623, AltoPuntos: 216 },
} as const;
export type TamanoId = keyof typeof TAMANOS_ETIQUETA;
export const TAMANO_DEFECTO: TamanoId = "3x1";

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

// Posiciones por defecto del "3x1", verificadas contra una impresión física real (jul 2026) — el
// usuario las ajustó a mano en "Editar diseño"/"Guardar diseño" sobre el lienzo horizontal (623x216)
// y confirmó que así "se ve bien la impresión física". Se copian aquí (además de quedar guardadas en
// DisenoEtiqueta) para no depender solo del dato mutable en la BD — si esas filas se borraran o se
// tuviera que recrear la base desde cero, este es el respaldo de la posición que ya funciona.
export const POSICIONES_DEFECTO: Posiciones = {
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
