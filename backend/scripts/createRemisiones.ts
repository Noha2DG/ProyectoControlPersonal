// Módulo Bodega PT — fase "salidas" (ver project_bodega_pt_design: "Salida = Remisión").
// Decisiones cerradas con el usuario (ago 2026):
//
// - Tres tipos: VentaLocal, Exportacion, Reempaque. Reempaque NO es una venta — el producto no sale
//   de la empresa, va a un Área interna (REEMPAQUE/REETIQUETADO), así que ahí el destino es
//   AreaDestino y no Cliente. La cabecera es la misma tabla: lo único que cambia es qué campos
//   aplican, no el flujo.
// - Folio con SERIE POR TIPO (VL-0001 / EX-0001 / RE-0001): contador atómico por serie, mismo patrón
//   que BodegaVirtual.UltimoSecuencial (UPDATE ... SET x = x + 1 dentro de la transacción).
// - El detalle es UNA FILA POR MASTER, nunca por caja/kg — coherente con "única unidad de inventario
//   = el Master". Cliente/Pedido/Talla/Peso NO se copian aquí: se resuelven al vuelo por el join
//   Masters→EtiquetaImpresa→OrdenEtiquetado→DetallePedido→Pedidos que ya usa pallets.ts.
// - La remisión NO está atada a un pedido: cada línea trae su propio pedido real, y la cabecera
//   puede ir a un cliente distinto (caso "sobras de otros pedidos, sin cambiar la etiqueta"). La
//   pantalla lo marca visualmente, pero el sistema NO lo bloquea — es un escenario normal de carga.
//
// Sobre RemisionDetalle.Vigente (sutil, a propósito): 1 = línea viva, NULL = línea de una remisión
// anulada. El UNIQUE (MasterId, Vigente) es el candado REAL contra despachar el mismo master dos
// veces — y como en SQL los NULL no chocan entre sí en un índice único, un master puede acumular
// varias líneas anuladas pero solo una vigente. Por eso Vigente es NULLable y no un TINYINT 0/1:
// con 0 el segundo intento fallido de despacho reventaría contra el propio histórico.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

// Los 6 destinos de salida definidos por el usuario (ago 2026). `Destino` es lo que decide si el
// documento pide Cliente o Área — vive como DATO y no como un `if` en la ruta, así que un destino
// nuevo mañana es una fila más aquí, sin tocar backend ni frontend.
//   Cliente = el producto SALE de la planta (aunque no sea una venta: la maquila también sale).
//   Area    = el producto NO sale, se traslada a un área interna y después reingresa con etiqueta nueva.
// PideEmbarque marca los que además llevan Contenedor/Sello en el documento.
// TipoCliente acota QUÉ clientes ofrece el selector (contra Clientes.Tipo, ver alterClienteTipo.ts):
// una venta local no debe poder despacharse a un cliente de exportación ni al revés. NULL = no filtra
// — es el caso de Maquila (el maquilador puede ser local o del exterior) y el de los destinos
// internos, que ni siquiera piden cliente.
// PidePedido: la remisión se arma A PARTIR de un pedido y el cliente/subcliente se HEREDAN de él en
// vez de elegirse a mano (hoy solo Exportación — se exporta contra un pedido concreto).
// PideLinea: cada línea del detalle lleva el número de LÍNEA DENTRO DEL CONTENEDOR donde se estibó.
// Se captura ANTES de escanear y se aplica a todo lo que entre después, hasta cambiarla.
const SERIES = [
  { Tipo: "VentaLocal",   Prefijo: "VL", Nombre: "Venta local",   Destino: "Cliente", Orden: 1, PideEmbarque: 0, PidePedido: 0, PideLinea: 0, TipoCliente: "Local" },
  { Tipo: "Exportacion",  Prefijo: "EX", Nombre: "Exportación",   Destino: "Cliente", Orden: 2, PideEmbarque: 1, PidePedido: 1, PideLinea: 1, TipoCliente: "Exportacion" },
  { Tipo: "Maquila",      Prefijo: "MQ", Nombre: "Maquila",       Destino: "Cliente", Orden: 3, PideEmbarque: 0, PidePedido: 0, PideLinea: 0, TipoCliente: null },
  { Tipo: "Reempaque",    Prefijo: "RP", Nombre: "Reempaque",     Destino: "Area",    Orden: 4, PideEmbarque: 0, PidePedido: 0, PideLinea: 0, TipoCliente: null },
  { Tipo: "Reetiquetado", Prefijo: "RE", Nombre: "Reetiquetado",  Destino: "Area",    Orden: 5, PideEmbarque: 0, PidePedido: 0, PideLinea: 0, TipoCliente: null },
  { Tipo: "Reproceso",    Prefijo: "RS", Nombre: "Reproceso",     Destino: "Area",    Orden: 6, PideEmbarque: 0, PidePedido: 0, PideLinea: 0, TipoCliente: null },
];

async function existeColumna(tabla: string, columna: string): Promise<boolean> {
  const rows: any[] = await p.$queryRawUnsafe(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    tabla, columna
  );
  return rows.length > 0;
}

async function main() {
  // ---- 1. Catálogo de series (una por tipo) ----------------------------------------------------
  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS SerieRemision (
      Tipo             VARCHAR(20)  NOT NULL PRIMARY KEY,
      Prefijo          VARCHAR(5)   NOT NULL UNIQUE,
      Nombre           VARCHAR(50)  NOT NULL,
      Destino          VARCHAR(10)  NOT NULL DEFAULT 'Cliente',
      TipoCliente      VARCHAR(20)  NULL,
      Orden            INT          NOT NULL DEFAULT 0,
      PideEmbarque     TINYINT(1)   NOT NULL DEFAULT 0,
      PidePedido       TINYINT(1)   NOT NULL DEFAULT 0,
      PideLinea        TINYINT(1)   NOT NULL DEFAULT 0,
      UltimoSecuencial INT          NOT NULL DEFAULT 0,
      Activo           TINYINT(1)   NOT NULL DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // Columnas agregadas después de la primera versión (que solo tenía 3 tipos y decidía el destino
  // con un `if` en la ruta). En una base nueva ya vienen en el CREATE de arriba.
  for (const [col, ddl] of [
    ["Destino", "VARCHAR(10) NOT NULL DEFAULT 'Cliente' AFTER Nombre"],
    ["TipoCliente", "VARCHAR(20) NULL AFTER Destino"],
    ["Orden", "INT NOT NULL DEFAULT 0 AFTER TipoCliente"],
    ["PideEmbarque", "TINYINT(1) NOT NULL DEFAULT 0 AFTER Orden"],
    ["PidePedido", "TINYINT(1) NOT NULL DEFAULT 0 AFTER PideEmbarque"],
    ["PideLinea", "TINYINT(1) NOT NULL DEFAULT 0 AFTER PidePedido"],
  ] as [string, string][]) {
    if (!(await existeColumna("SerieRemision", col))) {
      await p.$executeRawUnsafe(`ALTER TABLE SerieRemision ADD COLUMN ${col} ${ddl}`);
      console.log(`    Columna SerieRemision.${col} agregada.`);
    }
  }
  console.log("1/6 Tabla SerieRemision creada.");

  // El prefijo RE lo tenía Reempaque en la primera versión; ahora es de Reetiquetado. Hay que
  // liberarlo ANTES de sembrar, o el INSERT de Reetiquetado choca contra el UNIQUE de Prefijo.
  // (Se sigue el mismo criterio de letras que ya usa BodegaVirtual: Reempaque=RP, Reetiquetado=RE.)
  const movidas = await p.$executeRawUnsafe(`UPDATE SerieRemision SET Prefijo = 'RP' WHERE Tipo = 'Reempaque' AND Prefijo = 'RE'`);
  if (movidas) console.log("    Prefijo de Reempaque movido de RE a RP (RE queda para Reetiquetado).");

  for (const s of SERIES) {
    await p.$executeRawUnsafe(
      `INSERT INTO SerieRemision (Tipo, Prefijo, Nombre, Destino, TipoCliente, Orden, PideEmbarque, PidePedido, PideLinea)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE Prefijo = VALUES(Prefijo), Nombre = VALUES(Nombre), Destino = VALUES(Destino),
                               TipoCliente = VALUES(TipoCliente), Orden = VALUES(Orden),
                               PideEmbarque = VALUES(PideEmbarque), PidePedido = VALUES(PidePedido),
                               PideLinea = VALUES(PideLinea)`,
      s.Tipo, s.Prefijo, s.Nombre, s.Destino, s.TipoCliente, s.Orden, s.PideEmbarque, s.PidePedido, s.PideLinea
    );
  }
  // ON DUPLICATE KEY sobre el PK (Tipo): actualiza la definición sin tocar UltimoSecuencial, así
  // re-correr la migración nunca reinicia una numeración de folios ya en uso.
  console.log(`    ${SERIES.length} series sembradas/actualizadas (los contadores de folio no se tocan).`);

  // ---- 2. Cabecera ----------------------------------------------------------------------------
  // CodigoCliente/CodigoSubcliente y AreaDestino son ambos NULLables porque son excluyentes según el
  // Tipo; la obligatoriedad la impone la ruta (POST/PUT rechazan la combinación incorrecta), no la
  // columna — mismo criterio ya usado con OrdenEtiquetado.AreaCodigo y Pallets.Origen.
  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Remisiones (
      RemisionId       INT AUTO_INCREMENT PRIMARY KEY,
      Folio            VARCHAR(20)  NOT NULL UNIQUE,
      Tipo             VARCHAR(20)  NOT NULL,
      Estatus          VARCHAR(20)  NOT NULL DEFAULT 'Borrador',
      Fecha            DATE         NOT NULL,
      CodigoCliente    INT          NULL,
      CodigoSubcliente VARCHAR(10)  NULL,
      AreaDestino      VARCHAR(10)  NULL,
      CodigoPedido     VARCHAR(20)  NULL,
      EsMixta          TINYINT(1)   NOT NULL DEFAULT 0,
      Contenedor       VARCHAR(50)  NULL,
      Sello            VARCHAR(50)  NULL,
      Observaciones    VARCHAR(500) NULL,
      CreadoPor        VARCHAR(100) NULL,
      CreadoEn         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ConfirmadaPor    VARCHAR(100) NULL,
      ConfirmadaEn     DATETIME     NULL,
      AnuladaPor       VARCHAR(100) NULL,
      AnuladaEn        DATETIME     NULL,
      MotivoAnulacion  VARCHAR(200) NULL,
      KEY idx_remision_estatus (Estatus),
      KEY idx_remision_fecha (Fecha),
      CONSTRAINT fk_remision_serie FOREIGN KEY (Tipo) REFERENCES SerieRemision(Tipo),
      CONSTRAINT fk_remision_cliente FOREIGN KEY (CodigoCliente) REFERENCES Clientes(Codigo),
      CONSTRAINT fk_remision_subcliente FOREIGN KEY (CodigoCliente, CodigoSubcliente) REFERENCES Subcliente(CodigoCliente, CodigoSubcliente),
      CONSTRAINT fk_remision_area FOREIGN KEY (AreaDestino) REFERENCES Areas(Codigo),
      CONSTRAINT fk_remision_pedido FOREIGN KEY (CodigoPedido) REFERENCES Pedidos(CodigoPedido)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("2/6 Tabla Remisiones creada.");

  // Historia de esta columna, porque el nombre cambió y la semántica también:
  // v1 traía `PedidoReferencia` — opcional, "solo informativo", y en pantalla era un INPUT DE TEXTO
  //    LIBRE contra una FK: escribir un código inexistente reventaba con un error de llave foránea.
  //    Se eliminó el mismo día.
  // v2 (esta) es `CodigoPedido`: ya no es una nota al margen sino el ORIGEN del documento para las
  //    series con PidePedido=1 (Exportación). De ahí se heredan cliente y subcliente — por eso en la
  //    pantalla es un desplegable, nunca texto libre.
  if (await existeColumna("Remisiones", "PedidoReferencia")) {
    const fk: any[] = await p.$queryRawUnsafe(`
      SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Remisiones'
        AND COLUMN_NAME = 'PedidoReferencia' AND REFERENCED_TABLE_NAME IS NOT NULL
    `);
    for (const f of fk) await p.$executeRawUnsafe(`ALTER TABLE Remisiones DROP FOREIGN KEY ${f.CONSTRAINT_NAME}`);
    await p.$executeRawUnsafe(`ALTER TABLE Remisiones DROP COLUMN PedidoReferencia`);
    console.log("    Columna Remisiones.PedidoReferencia (v1) eliminada.");
  }
  if (!(await existeColumna("Remisiones", "CodigoPedido"))) {
    await p.$executeRawUnsafe(`ALTER TABLE Remisiones ADD COLUMN CodigoPedido VARCHAR(20) NULL AFTER AreaDestino`);
    await p.$executeRawUnsafe(`
      ALTER TABLE Remisiones ADD CONSTRAINT fk_remision_pedido FOREIGN KEY (CodigoPedido) REFERENCES Pedidos(CodigoPedido)
    `);
    console.log("    Columna Remisiones.CodigoPedido agregada (con FK a Pedidos).");
  }

  // EsMixta — la excepción al amarre con la proforma. Por defecto (0) TODAS las líneas deben ser del
  // pedido de la cabecera: es la regla normal, "la remisión va contra la proforma cargada". En 1 se
  // admite producto de otras proformas, que es como se juntan los sobrantes de varios pedidos para
  // exportárselos a un mismo cliente. Default 0 a propósito: lo excepcional se pide explícito.
  if (!(await existeColumna("Remisiones", "EsMixta"))) {
    await p.$executeRawUnsafe(`ALTER TABLE Remisiones ADD COLUMN EsMixta TINYINT(1) NOT NULL DEFAULT 0 AFTER CodigoPedido`);
    console.log("    Columna Remisiones.EsMixta agregada (0 = amarrada a su proforma).");
  }

  // ---- 3. Detalle (una fila por master) --------------------------------------------------------
  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS RemisionDetalle (
      DetalleId   INT AUTO_INCREMENT PRIMARY KEY,
      RemisionId  INT          NOT NULL,
      MasterId    INT          NOT NULL,
      LineaContenedor INT      NULL,
      Vigente     TINYINT(1)   NULL DEFAULT 1,
      AgregadoPor VARCHAR(100) NULL,
      AgregadoEn  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_detalle_master_vigente (MasterId, Vigente),
      KEY idx_remisiondet_remision (RemisionId),
      CONSTRAINT fk_remisiondet_remision FOREIGN KEY (RemisionId) REFERENCES Remisiones(RemisionId),
      CONSTRAINT fk_remisiondet_master FOREIGN KEY (MasterId) REFERENCES Masters(MasterId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // NULLable a nivel de BD porque solo aplica a las series con PideLinea = 1 (Exportación): en una
  // venta local o un traslado interno no hay contenedor que estibar. La obligatoriedad la impone la
  // ruta según la serie, no la columna — mismo criterio que Origen/AreaCodigo en el resto del módulo.
  if (!(await existeColumna("RemisionDetalle", "LineaContenedor"))) {
    await p.$executeRawUnsafe(`ALTER TABLE RemisionDetalle ADD COLUMN LineaContenedor INT NULL AFTER MasterId`);
    console.log("    Columna RemisionDetalle.LineaContenedor agregada.");
  }
  console.log("3/6 Tabla RemisionDetalle creada.");

  // ---- 4. Masters.Estatus ----------------------------------------------------------------------
  // Cierra el hueco señalado en project_pedido_general_design: hasta hoy "existir en Masters" ERA
  // estar en inventario, así que un master reempacado que reingresara se contaba dos veces.
  //   EnBodega = dentro de su pallet · Suelto = su pallet se desarmó, disponible individualmente
  //   Salido   = ya se despachó en una remisión confirmada (deja de ser inventario)
  if (await existeColumna("Masters", "Estatus")) {
    console.log("4/6 Masters.Estatus ya existe — omitido.");
  } else {
    await p.$executeRawUnsafe(`
      ALTER TABLE Masters ADD COLUMN Estatus VARCHAR(20) NOT NULL DEFAULT 'EnBodega' AFTER EtiquetaId
    `);
    await p.$executeRawUnsafe(`ALTER TABLE Masters ADD KEY idx_master_estatus (Estatus)`);
    console.log("4/6 Columna Masters.Estatus agregada (todo lo existente queda 'EnBodega').");
  }

  // ---- 5. Kardex: granularidad de master y referencia a la remisión ----------------------------
  // MovimientosBodega nació como kardex a nivel de PALLET (PalletId NOT NULL). Una salida parcial es
  // por master, así que se agregan MasterId/RemisionId NULLables: los movimientos de pallet
  // (INGRESO, DESUBICACION, DESARME) los dejan en NULL, los de master (SALIDA, REVERSA_SALIDA) los
  // llenan — y PalletId sigue teniendo valor porque el master conserva el pallet donde nació
  // (nunca se le borra, es su trazabilidad de origen).
  if (await existeColumna("MovimientosBodega", "MasterId")) {
    console.log("5/6 MovimientosBodega.MasterId/RemisionId ya existen — omitido.");
  } else {
    await p.$executeRawUnsafe(`ALTER TABLE MovimientosBodega ADD COLUMN MasterId INT NULL AFTER PalletId`);
    await p.$executeRawUnsafe(`ALTER TABLE MovimientosBodega ADD COLUMN RemisionId INT NULL AFTER MasterId`);
    await p.$executeRawUnsafe(`
      ALTER TABLE MovimientosBodega
        ADD CONSTRAINT fk_movbodega_master FOREIGN KEY (MasterId) REFERENCES Masters(MasterId)
    `);
    await p.$executeRawUnsafe(`
      ALTER TABLE MovimientosBodega
        ADD CONSTRAINT fk_movbodega_remision FOREIGN KEY (RemisionId) REFERENCES Remisiones(RemisionId)
    `);
    await p.$executeRawUnsafe(`ALTER TABLE MovimientosBodega ADD KEY idx_movbodega_remision (RemisionId)`);
    console.log("5/6 Columnas MovimientosBodega.MasterId y .RemisionId agregadas (con FK).");
  }

  // PalletOrigenId — de dónde vino la caja en un TRASLADO (consolidación de sobrantes). `PalletId`
  // guarda el DESTINO, así que sin esta columna el origen solo vivía como texto dentro del Motivo:
  // imposible de consultar y, sobre todo, imposible de usar para deshacer el traslado.
  if (!(await existeColumna("MovimientosBodega", "PalletOrigenId"))) {
    await p.$executeRawUnsafe(`ALTER TABLE MovimientosBodega ADD COLUMN PalletOrigenId INT NULL AFTER PalletId`);
    await p.$executeRawUnsafe(`
      ALTER TABLE MovimientosBodega
        ADD CONSTRAINT fk_movbodega_palletorigen FOREIGN KEY (PalletOrigenId) REFERENCES Pallets(PalletId)
    `);
    console.log("    Columna MovimientosBodega.PalletOrigenId agregada (origen de los traslados).");
  }

  // Los traslados hechos ANTES de que existiera la columna solo guardaron el origen dentro del texto
  // del Motivo ("Consolidado desde el polín T0012"). Se rellenan desde ahí: sin esto, deshacer uno de
  // esos traslados no sabría a dónde devolver la caja e intentaría borrarla, reventando contra la FK.
  const huerfanos = await p.$executeRawUnsafe(`
    UPDATE MovimientosBodega mb
    JOIN Pallets pal ON mb.Motivo LIKE CONCAT('%polín ', pal.Codigo)
    SET mb.PalletOrigenId = pal.PalletId
    WHERE mb.Tipo = 'TRASLADO' AND mb.PalletOrigenId IS NULL
  `);
  if (huerfanos) console.log(`    ${huerfanos} traslado(s) previo(s) con su origen recuperado del Motivo.`);

  // ---- 6. Verificación --------------------------------------------------------------------------
  const series: any[] = await p.$queryRawUnsafe(`SELECT Tipo, Prefijo, Destino, UltimoSecuencial FROM SerieRemision ORDER BY Orden`);
  console.log("6/6 Series activas:", JSON.stringify(series, (_k, v) => (typeof v === "bigint" ? Number(v) : v)));
  console.log("Migración de Remisiones completada.");

  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
