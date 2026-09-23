// Inventario al piso — el kardex del producto a granel entre Recepción y Túnel.
//
// Crea dos tablas y no toca ninguna existente, así que se puede correr con la planta trabajando.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// MovimientoPiso — el kardex. Cada fila es un efecto sobre el saldo de un área.
//
// El saldo de un área NO se guarda: se suma. "Inventario final = inicial del día siguiente" es un
// artefacto de hoja de cálculo (en Excel hay que arrastrar el número porque cada día es una hoja
// nueva); acá no se arrastra nada — si nadie sacó el producto del área, el saldo sigue ahí solo.
// Un saldo que se pasa cada noche es un proceso que puede fallar, correrse dos veces o a medias.
//
// UN TRASLADO ES UNA SOLA FILA con origen y destino, leída dos veces: negativa para el origen,
// positiva para el destino. Si cada área captura su lado, nunca cuadran. Es el mismo criterio de
// PosicionOrigenId/PosicionDestinoId en MovimientosBodega.
//
// LA INVARIANTE: toda fila es un traspaso entre DOS EXTREMOS, y cada extremo es un área, una hoja
// de proceso, o nada (fuera del piso). Por eso hay dos pares de columnas simétricas —
// AreaOrigen/AreaDestino y HojaOrigenId/HojaDestinoId — y el saldo se calcula igual para todas las
// filas, sin mirar el Tipo.
//
// La hoja ES un lugar, no un evento: el producto sale del área HACIA la hoja (CONSUMO) y de la hoja
// sale hacia el área siguiente (TRASLADO), a bodega (DEVOLUCION) o a ninguna parte (MERMA). Sin eso
// el saldo se descuenta dos veces — el consumo y el traslado son el mismo producto, y una prueba
// contra datos reales dejó a Descongelado en −1,295.60 kg justamente por ahí.
//
// Que el saldo NO dependa del Tipo es la propiedad que importa: agregar un tipo nuevo más adelante
// no puede corromper el inventario en silencio.
//
// POR QUÉ Lote NO LLEVA FOREIGN KEY: el texto de lote vive en dos universos que no comparten tabla.
// Los de materia prima están en Lotes (llave compuesta Lote+Clase), pero los que vienen congelados
// de bodega salen de OrdenEtiquetado.Lote y nunca se dieron de alta en Lotes. Y hay casos que hoy
// ninguna de las dos puede representar: la hoja de Descongelado del 21-sep trae "sobrantes", que no
// es una piscina. Con FK, ese renglón no se podría registrar; sin FK, entra y el saldo cuadra.
// Clase, Talla y las áreas sí llevan FK — esos catálogos son completos.
//
// TALLA: 900 = SIN TALLA (ya existe en Tallas). Aguas arriba de Clasificado Cola el producto no
// tiene talla todavía, así que 900 es el valor normal y no una excepción — por eso NOT NULL con
// default en vez de nullable, que dejaría el GROUP BY con dos formas de decir lo mismo.
//
// LA MERMA SE ESCRIBE AL CERRAR. Es el residuo del cuadre (entrada − salida − devuelto), pero tiene
// que quedar como fila propia: si no, el saldo del área nunca baja por lo que se perdió y el kardex
// queda inflado para siempre.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// HojaProceso — el encabezado, equivalente a la hoja de papel (FR-7.13-13 en Descongelado).
//
// Abre, acumula renglones durante el turno y cierra. El balance se valida AL CERRAR, no al escribir
// cada renglón: la transformación no es un evento instantáneo, dura el turno, y el consumo total
// solo se conoce al final. Lleva AreaCodigo en vez de llamarse HojaDescongelado porque Descabezado
// y Clasificado Cola tienen exactamente la misma forma (fecha, horas, encargado, personas, cierre)
// y no tiene sentido una tabla por área.
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS HojaProceso (
      HojaId          INT AUTO_INCREMENT PRIMARY KEY,
      AreaCodigo      VARCHAR(10)   NOT NULL,
      -- La jornada. Se asigna al capturar y NO se deriva de la hora del reloj: el turno cruza la
      -- medianoche (hay hojas que arrancan 03:30) y además el papel va adelante del sistema — el
      -- 21-sep se descongelaba desde las 03:30 y la remisión se confirmó hasta las 09:13.
      FechaProduccion DATE          NOT NULL,
      HoraInicio      DATETIME      NULL,
      HoraFin         DATETIME      NULL,
      -- "UNA HOJA POR PROPIEDAD" dice el formulario: el producto propio y el de maquila no se
      -- mezclan en la misma hoja.
      Propiedad       VARCHAR(10)   NOT NULL DEFAULT 'OROPSA',
      Encargado       VARCHAR(50)   NULL,
      Personas        INT           NULL,
      MetabisulfitoKg DECIMAL(8,2)  NULL,
      Estatus         VARCHAR(20)   NOT NULL DEFAULT 'Abierta',
      Observaciones   VARCHAR(500)  NULL,
      CreadoPor       VARCHAR(100)  NULL,
      CreadoEn        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CerradaPor      VARCHAR(100)  NULL,
      CerradaEn       DATETIME      NULL,
      CONSTRAINT fk_hojaproceso_area      FOREIGN KEY (AreaCodigo) REFERENCES Areas(Codigo),
      CONSTRAINT fk_hojaproceso_encargado FOREIGN KEY (Encargado)  REFERENCES Empleados(Codigo),
      INDEX idx_hojaproceso_area_fecha (AreaCodigo, FechaProduccion),
      INDEX idx_hojaproceso_estatus (Estatus)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla HojaProceso creada.");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS MovimientoPiso (
      MovimientoId    INT AUTO_INCREMENT PRIMARY KEY,
      -- INGRESO | CONSUMO | TRASLADO | DEVOLUCION | MERMA | AJUSTE
      Tipo            VARCHAR(20)   NOT NULL,
      FechaProduccion DATE          NOT NULL,
      FechaHora       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

      -- Los dos extremos, cada uno un área o una hoja (o nada, si el producto entra de bodega o
      -- se pierde). Exactamente uno de Area*/Hoja* va lleno por lado:
      --   INGRESO     —                    → AreaDestino    (de bodega al piso del área)
      --   CONSUMO     AreaOrigen           → HojaDestinoId  (el área entrega a la hoja)
      --   TRASLADO    HojaOrigenId         → AreaDestino    (la hoja entrega al área siguiente)
      --   DEVOLUCION  HojaOrigenId         →                (regresa a bodega)
      --   MERMA       HojaOrigenId         →                (se perdió)
      --   AJUSTE      AreaOrigen o AreaDestino, según el signo del conteo físico
      AreaOrigen      VARCHAR(10)   NULL,
      AreaDestino     VARCHAR(10)   NULL,

      Lote            VARCHAR(30)   NOT NULL,
      Clase           VARCHAR(10)   NOT NULL,
      Talla           INT           NOT NULL DEFAULT 900,

      -- El día en que se produjo el lote, copiado de OrdenEtiquetado al entrar. NO se puede deducir
      -- del texto del lote: el código lleva día-de-semana + semana, así que ordenarlo como texto no
      -- tiene nada que ver con la antigüedad —  probado contra el despacho del 22-sep, los 16 lotes
      -- quedaron en posición distinta (G131 es de julio y G519 de mayo, pero "G131" ordena primero).
      -- Sin esta columna no hay forma de sacar el PEPS, que es justo lo que Descongelado necesita
      -- para decidir qué bajar primero: ese día convivía producto de 46 y de 137 días.
      FechaLote       DATE          NULL,

      -- Peso/UM como se capturó; PesoKg es el normalizado con que se suma. Destajo registra KG y
      -- bodega cuenta libras: sin una columna normalizada cada reporte convierte por su cuenta y
      -- salen tres totales distintos del mismo dato.
      Peso            DECIMAL(10,2) NOT NULL,
      UM              VARCHAR(10)   NOT NULL DEFAULT 'KG',
      PesoKg          DECIMAL(10,2) NOT NULL,

      -- Solo en lo que viene de bodega por remisión (sección 1 de la hoja). El peso declarado es
      -- Masters x KgPorMaster; se guardan los dos para poder rehacer la cuenta, porque el kg por
      -- master del catálogo Presentacion no es único (un master de 40 lb está guardado como 18.10,
      -- 18.14 y 18.16 según el código) y el papel usa su propio valor verificado.
      Masters         INT           NULL,
      KgPorMaster     DECIMAL(8,3)  NULL,

      HojaOrigenId    INT           NULL,
      HojaDestinoId   INT           NULL,
      RemisionId      INT           NULL,

      -- El termo ES su renglón de llenado: los números están pintados en el recipiente y se reúsan
      -- el mismo día, así que NumeroTermo no identifica nada por sí solo. Los movimientos
      -- posteriores del mismo termo apuntan al renglón que lo llenó. Mismo patrón que
      -- MovimientosBodega.PalletOrigenId.
      NumeroTermo     VARCHAR(20)   NULL,
      TermoOrigenId   INT           NULL,

      Motivo          VARCHAR(200)  NULL,
      RegistradoPor   VARCHAR(100)  NULL,

      CONSTRAINT fk_movpiso_areaorigen  FOREIGN KEY (AreaOrigen)    REFERENCES Areas(Codigo),
      CONSTRAINT fk_movpiso_areadestino FOREIGN KEY (AreaDestino)   REFERENCES Areas(Codigo),
      CONSTRAINT fk_movpiso_clase       FOREIGN KEY (Clase)         REFERENCES Clase(Clase),
      CONSTRAINT fk_movpiso_talla       FOREIGN KEY (Talla)         REFERENCES Tallas(Codigo),
      CONSTRAINT fk_movpiso_hojaorigen  FOREIGN KEY (HojaOrigenId)  REFERENCES HojaProceso(HojaId),
      CONSTRAINT fk_movpiso_hojadestino FOREIGN KEY (HojaDestinoId) REFERENCES HojaProceso(HojaId),
      CONSTRAINT fk_movpiso_remision    FOREIGN KEY (RemisionId)    REFERENCES Remisiones(RemisionId),
      CONSTRAINT fk_movpiso_termo       FOREIGN KEY (TermoOrigenId) REFERENCES MovimientoPiso(MovimientoId),

      -- Las dos ramas del saldo. La consulta suma por separado lo que entra (AreaDestino) y lo que
      -- sale (AreaOrigen) y las une con UNION ALL: MariaDB 10.5 no tiene LATERAL, y una vista con
      -- UNION ALL se materializa en tabla temporal y pierde el índice. Van con FechaProduccion
      -- adentro porque todo filtro de saldo es "hasta el día D" o "del día D".
      INDEX idx_movpiso_destino     (AreaDestino, FechaProduccion),
      INDEX idx_movpiso_origen      (AreaOrigen,  FechaProduccion),
      INDEX idx_movpiso_lote        (Lote, Clase),
      INDEX idx_movpiso_hojaorigen  (HojaOrigenId),
      INDEX idx_movpiso_hojadestino (HojaDestinoId),
      INDEX idx_movpiso_fecha       (FechaProduccion)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla MovimientoPiso creada.");

  // Idempotente: en una base que ya tenía la tabla sin esta columna, la agrega; en una recién
  // creada no hace nada. Al final y NULL, así que es ALGORITHM=INSTANT y no reconstruye la tabla.
  await prisma.$executeRawUnsafe(
    `ALTER TABLE MovimientoPiso ADD COLUMN IF NOT EXISTS FechaLote DATE NULL`);
  await prisma.$executeRawUnsafe(
    `ALTER TABLE MovimientoPiso ADD INDEX IF NOT EXISTS idx_movpiso_fechalote (FechaLote)`);
  console.log("Columna FechaLote verificada.");

  for (const tabla of ["HojaProceso", "MovimientoPiso"]) {
    const cols: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, tabla
    );
    const fks: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(DISTINCT CONSTRAINT_NAME) AS n FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`, tabla
    );
    const filas: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM ${tabla}`);
    console.log(`OK - ${tabla}: ${cols[0].n} columnas, ${fks[0].n} foreign keys, ${filas[0].n} filas.`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
