// Tratamiento (químico) — el esquema de la hoja "TRATAMIENTO DE CAMARON".
//
// Todo es ADITIVO y se puede correr con la planta trabajando: una columna nula en HojaProceso y tres
// tablas nuevas que nadie más lee. El código desplegado hoy no las conoce, así que no le cambia nada.
//
// LA HOJA es HojaProceso con BodegaCodigo = 'TRATAMIENTO', la misma tabla de Descongelado: el kardex
// del piso (MovimientoPiso.HojaOrigenId/HojaDestinoId) ya apunta ahí, y el encargado, el cierre y la
// gente del marcaje ya están resueltos. Lo único que le falta es el CLIENTE PREVISTO.
//   El cliente es una REFERENCIA (decisión del usuario, 22 oct 2026): el papel dice "una hoja por
//   cliente" porque se trata pensando en él, pero al escanear el master en Empaque el destino cambia
//   según tallas y prioridades. Por eso vive en la hoja y NO viaja en el kardex: el producto tratado
//   no se separa por cliente en el piso siguiente.
//
// EL TERMO (cada renglón del papel) son movimientos del kardex más una fila de TratamientoTermo:
//   CONSUMO   piso de Tratamiento → hoja   kg sin tratar (lote, clase, talla y fecha del lote del piso)
//   TRASLADO  hoja → piso del destino      kg tratadas
//   GANANCIA  nada → hoja                  lo que ganó  (tratadas − sin tratar)
//   MERMA     hoja → nada                  lo que perdió, si salió pesando menos (es una ALERTA)
// Los tres últimos apuntan al consumo con ConsumoId, igual que el par de Descongelado. Cada termo
// cuadra solo: lo que entra a la hoja (consumo + ganancia) es lo que sale (traslado + merma). Sin la
// GANANCIA, la hoja entregaría más de lo que recibió, que es justo lo que el cierre de Descongelado
// rechaza como error de captura —  en Tratamiento es lo normal: el producto gana peso a propósito.
//
// TratamientoTermo guarda solo lo que el kardex no tiene: horas, conteos y químico. Los pesos viven
// en MovimientoPiso y en ningún otro lado, para que no haya dos números del mismo kilo.
//
// LOS INSUMOS (hielo, Carnal, Alteza, sal): por ahora SOLO el consumo de cada hoja —  el usuario
// decidió dejar fuera lo solicitado a almacén y el inventario al piso hasta definirlo con Producción,
// y el agua porque no se usa. Catálogo aparte y no columnas en la hoja: un químico nuevo es una fila.
// EsQuimico marca los que aparecen en la columna "TIPO DE QUÍMICO" de cada termo.
//
// Uso:
//   npx tsx scripts/createTratamiento.ts          → crea (idempotente)
//   npx tsx scripts/createTratamiento.ts --drop   → deshace todo (solo si no hay termos capturados)
//
// OJO: backend/.env apunta a PRODUCCIÓN.
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

const INSUMOS: [string, string, string, number, number][] = [
  // Codigo,  Nombre,   UM,   EsQuimico, Orden — el orden de las columnas del papel
  ["HIELO",  "Hielo",  "KG", 0, 1],
  ["CARNAL", "Carnal", "KG", 1, 2],
  ["ALTEZA", "Alteza", "KG", 1, 3],
  ["SAL",    "Sal",    "KG", 0, 4],
];

async function existeFK(tabla: string, nombre: string) {
  const r: any[] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`, tabla, nombre);
  return Number(r[0].n) > 0;
}

async function crear() {
  await prisma.$executeRawUnsafe(`ALTER TABLE HojaProceso ADD COLUMN IF NOT EXISTS ClienteCodigo INT NULL`);
  if (!(await existeFK("HojaProceso", "fk_hojaproceso_cliente"))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE HojaProceso ADD CONSTRAINT fk_hojaproceso_cliente
        FOREIGN KEY (ClienteCodigo) REFERENCES Clientes(Codigo)`);
  }
  console.log("HojaProceso.ClienteCodigo verificada.");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Insumo (
      Codigo    VARCHAR(20)  NOT NULL PRIMARY KEY,
      Nombre    VARCHAR(60)  NOT NULL,
      UM        VARCHAR(10)  NOT NULL DEFAULT 'KG',
      EsQuimico TINYINT(1)   NOT NULL DEFAULT 0,
      Orden     INT          NOT NULL DEFAULT 0,
      Activo    TINYINT(1)   NOT NULL DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  for (const [codigo, nombre, um, quimico, orden] of INSUMOS) {
    await prisma.$executeRawUnsafe(
      `INSERT IGNORE INTO Insumo (Codigo, Nombre, UM, EsQuimico, Orden) VALUES (?, ?, ?, ?, ?)`,
      codigo, nombre, um, quimico, orden);
  }
  console.log("Tabla Insumo verificada.");

  // ConsumoId ES el termo: el renglón del kardex que lo llenó. NumeroTermo no identifica nada —  los
  // números están pintados en el recipiente y se repiten el mismo día (el 35 dos veces el 17-oct).
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS TratamientoTermo (
      ConsumoId     INT          NOT NULL PRIMARY KEY,
      HoraInicio    DATETIME     NOT NULL,
      HoraSalida    DATETIME     NULL,
      ConteoInicial INT          NULL,
      ConteoFinal   INT          NULL,
      QuimicoCodigo VARCHAR(20)  NULL,
      CONSTRAINT fk_tratermo_consumo FOREIGN KEY (ConsumoId)     REFERENCES MovimientoPiso(MovimientoId),
      CONSTRAINT fk_tratermo_quimico FOREIGN KEY (QuimicoCodigo) REFERENCES Insumo(Codigo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  console.log("Tabla TratamientoTermo verificada.");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS HojaInsumo (
      HojaId        INT           NOT NULL,
      InsumoCodigo  VARCHAR(20)   NOT NULL,
      Cantidad      DECIMAL(10,2) NOT NULL,
      RegistradoPor VARCHAR(100)  NULL,
      RegistradoEn  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (HojaId, InsumoCodigo),
      CONSTRAINT fk_hojainsumo_hoja   FOREIGN KEY (HojaId)       REFERENCES HojaProceso(HojaId),
      CONSTRAINT fk_hojainsumo_insumo FOREIGN KEY (InsumoCodigo) REFERENCES Insumo(Codigo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  console.log("Tabla HojaInsumo verificada.");
}

async function deshacer() {
  const [t]: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TratamientoTermo'`);
  if (Number(t.n) > 0) {
    const [c]: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM TratamientoTermo`);
    if (Number(c.n) > 0) throw new Error(`Hay ${c.n} termos capturados: no se deshace (se perderían).`);
  }
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS HojaInsumo`);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS TratamientoTermo`);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS Insumo`);
  if (await existeFK("HojaProceso", "fk_hojaproceso_cliente")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE HojaProceso DROP FOREIGN KEY fk_hojaproceso_cliente`);
  }
  await prisma.$executeRawUnsafe(`ALTER TABLE HojaProceso DROP COLUMN IF EXISTS ClienteCodigo`);
  console.log("Esquema de Tratamiento deshecho.");
}

(process.argv.includes("--drop") ? deshacer() : crear())
  .catch(e => { console.error("ERROR:", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
