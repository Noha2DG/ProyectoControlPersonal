// Importaciones de materia prima (camarón HLSO de proveedores del extranjero). Diseño del 3 nov 2026,
// a partir de la demo aprobada para gerencia y de la hoja BASE DAtos de «Pedidos Taiwan.xlsx».
// 4 nov 2026: el usuario decidió dejar estas tablas por ahora (después se corregirán o eliminarán las
// que no hagan falta), con una corrección: las tallas salen de la tabla Tallas que ya existe.
//
// Alcance: SOLO las proformas reales. El plan «Por pedir / Por Definir» del Excel (Materia Prima,
// Plan Envíos, Hoja6, Consolidado Proveedores) son criterios de quien lleva ese archivo y quedan fuera.
//
// Siete tablas, todas nuevas y con el prefijo Importacion. No se altera ninguna tabla actual: el script
// es aditivo y se puede correr antes de desplegar el código sin afectar al backend de producción. La
// única llave hacia algo que ya existe es la de Tallas (RESTRICT, igual que DetallePedido, Lotes,
// Tarifas…): una talla usada en una solicitud ya no se puede borrar de Catálogos → Tallas.
//
//   ImportacionProveedor        — quien vende (Santa Priscila, Promarisco, Natluk…). No es Clientes.
//   ImportacionSerie            — correlativo del folio por año (MP-2026-0001), como SerieRemision.
//   ImportacionSolicitud        — una fila por proforma: proveedor, fechas y estados. En el Excel el
//                                 encabezado se repetía en cada línea; acá va una sola vez.
//   ImportacionSolicitudDetalle — una fila por talla: clase, descripción, libras y costo por libra.
//   ImportacionDestinatario     — lista de correos que reciben el reporte de cada solicitud.
//   ImportacionEnvio            — cada envío del reporte: a quién, cuándo y COPIA de lo que se envió.
//   ImportacionParametro        — valores de referencia (días de pago, libras por contenedor, tallas).
//
// Tallas: el detalle guarda el Codigo de la tabla Tallas (Catálogos → Tallas). Como esa tabla tiene dos
// escalas con descripciones repetidas, el parámetro TALLAS fija qué códigos se ofrecen y en qué orden,
// y el pegado desde el Excel ("16-20" → "16/20") solo busca dentro de esa lista. U/15 = 209,
// 21/25 = 217 y 31/35 = 225 son de la escala 2xx porque sus pares 305, 316 y 326 están inactivos
// (igual que en las tarifas de pelado).
//
// Reglas que NO van en la base (las valida el backend, para poder cargar el histórico del Excel tal
// cual viene):
//   · FechaPedido es obligatoria en las solicitudes nuevas; las cargadas del Excel no la tienen
//     (allá la columna copiaba la fecha de salida) y quedan en NULL.
//   · FechaPedido ≤ FechaSalida ≤ FechaLlegada. La proforma 2026-000002 del Excel trae la salida
//     (01/11) después de la llegada (24/10): hay que corregirla antes de cargarla.
//   · FechaPago se SUGIERE como llegada − DIAS_PAGO_ANTES_LLEGADA, pero es la negociada en cada
//     proforma (en el Excel va de 11 días después a 7 días antes de la llegada).
//
// Una solicitud que ya se envió no se borra: se anula (Estado = 'ANULADA'). La llave de
// ImportacionEnvio hacia la solicitud es RESTRICT a propósito, para que la base lo impida.
//
// Reversible: npx tsx backend/scripts/createImportaciones.ts --drop
//             (se niega si ya hay solicitudes; agregar --forzar para borrar de todos modos)
// Uso normal: npx tsx backend/scripts/createImportaciones.ts

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CREADOR = "Carga inicial importaciones";

// Proveedores que aparecen en la hoja BASE DAtos (con proformas) y en Hoja6 (con cotizaciones).
// [Nombre, NombreCorto, Pais]
const PROVEEDORES: [string, string, string][] = [
  ["Santa Priscila, S. A.", "Santa Priscila", "EC"],
  ["Promarisco, S. A.", "Promarisco", "EC"],
  ["Natluk, S. A. / CEAEXPORT", "Natluk", "EC"],
  ["Exportquilsa", "Exportquilsa", "EC"],
  ["Omarsa", "Omarsa", "EC"],
  ["Bilbosa", "Bilbosa", "EC"],
];

// Códigos de la tabla Tallas para los conteos HLSO de las proformas, de grande a pequeño:
// U/15, 16/20, 21/25, 26/30, 31/35, 36/40, 41/50, 51/60, 61/70, 71/90, 91/110.
const TALLAS = [209, 311, 217, 321, 225, 336, 341, 346, 351, 356, 361];

const PARAMETROS: [string, string, string][] = [
  ["DIAS_PAGO_ANTES_LLEGADA", "5", "Días antes de la llegada para sugerir la fecha de pago al crear una solicitud"],
  ["LB_CONTENEDOR", "44000", "Libras que carga un contenedor; sirve para contar contenedores en reportes"],
  ["TALLAS", JSON.stringify(TALLAS), "Códigos de la tabla Tallas que se ofrecen en las solicitudes, en el orden en que se muestran"],
];

const TABLAS: [string, string][] = [
  ["ImportacionProveedor", `
    CREATE TABLE IF NOT EXISTS ImportacionProveedor (
      ProveedorId  INT AUTO_INCREMENT PRIMARY KEY,
      Nombre       VARCHAR(150) NOT NULL,
      NombreCorto  VARCHAR(40)  NOT NULL,
      Pais         VARCHAR(5)   NULL,
      Contacto     VARCHAR(100) NULL,
      Correo       VARCHAR(255) NULL,
      Activo       TINYINT(1)   NOT NULL DEFAULT 1,
      CreadoPor    VARCHAR(100) NOT NULL,
      CreadoEn     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_impprov_nombre (Nombre)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`],

  ["ImportacionSerie", `
    CREATE TABLE IF NOT EXISTS ImportacionSerie (
      Anio              SMALLINT NOT NULL PRIMARY KEY,
      UltimoSecuencial  INT      NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`],

  ["ImportacionSolicitud", `
    CREATE TABLE IF NOT EXISTS ImportacionSolicitud (
      SolicitudId      INT AUTO_INCREMENT PRIMARY KEY,
      Folio            VARCHAR(20)  NOT NULL,
      ProveedorId      INT          NOT NULL,
      Proforma         VARCHAR(40)  NOT NULL,
      FechaPedido      DATE         NULL,
      FechaSalida      DATE         NULL,
      FechaLlegada     DATE         NOT NULL,
      FechaPago        DATE         NOT NULL,
      Estado           VARCHAR(12)  NOT NULL DEFAULT 'CONFIRMADA',
      RecibidaEn       DATE         NULL,
      RecibidaPor      VARCHAR(100) NULL,
      EstadoPago       VARCHAR(10)  NOT NULL DEFAULT 'PENDIENTE',
      PagadaEn         DATE         NULL,
      PagadaPor        VARCHAR(100) NULL,
      MotivoAnulacion  VARCHAR(300) NULL,
      Notas            VARCHAR(500) NULL,
      Origen           VARCHAR(10)  NOT NULL DEFAULT 'SISTEMA',
      CreadoPor        VARCHAR(100) NOT NULL,
      CreadoEn         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ModificadoPor    VARCHAR(100) NULL,
      ModificadoEn     DATETIME     NULL,
      UNIQUE KEY uq_impsol_folio (Folio),
      UNIQUE KEY uq_impsol_proforma (ProveedorId, Proforma),
      KEY idx_impsol_llegada (FechaLlegada),
      KEY idx_impsol_pago (FechaPago),
      CONSTRAINT fk_impsol_proveedor FOREIGN KEY (ProveedorId) REFERENCES ImportacionProveedor (ProveedorId),
      CONSTRAINT chk_impsol_estado CHECK (Estado IN ('CONFIRMADA', 'RECIBIDA', 'ANULADA')),
      CONSTRAINT chk_impsol_pago CHECK (EstadoPago IN ('PENDIENTE', 'PAGADA')),
      CONSTRAINT chk_impsol_origen CHECK (Origen IN ('SISTEMA', 'EXCEL')),
      CONSTRAINT chk_impsol_recibida CHECK (Estado <> 'RECIBIDA' OR RecibidaEn IS NOT NULL),
      CONSTRAINT chk_impsol_pagada CHECK (EstadoPago <> 'PAGADA' OR PagadaEn IS NOT NULL),
      CONSTRAINT chk_impsol_anulada CHECK (Estado <> 'ANULADA' OR MotivoAnulacion IS NOT NULL)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`],

  // Clase es la calidad que vende el proveedor (A/B/C). NO es la tabla Clase de producción (E40…).
  // Total es columna generada: los reportes suman dólares sin recalcular libras × costo.
  ["ImportacionSolicitudDetalle", `
    CREATE TABLE IF NOT EXISTS ImportacionSolicitudDetalle (
      DetalleId    INT AUTO_INCREMENT PRIMARY KEY,
      SolicitudId  INT           NOT NULL,
      Linea        SMALLINT      NOT NULL,
      Clase        CHAR(1)       NOT NULL,
      Descripcion  VARCHAR(100)  NULL,
      Talla        INT           NOT NULL,
      Libras       DECIMAL(12,2) NOT NULL,
      CostoLb      DECIMAL(10,4) NOT NULL,
      Total        DECIMAL(14,2) AS (ROUND(Libras * CostoLb, 2)) PERSISTENT,
      UNIQUE KEY uq_impdet_linea (SolicitudId, Linea),
      KEY idx_impdet_talla (Talla),
      CONSTRAINT fk_impdet_solicitud FOREIGN KEY (SolicitudId) REFERENCES ImportacionSolicitud (SolicitudId) ON DELETE CASCADE,
      CONSTRAINT fk_impdet_talla FOREIGN KEY (Talla) REFERENCES Tallas (Codigo),
      CONSTRAINT chk_impdet_clase CHECK (Clase IN ('A', 'B', 'C')),
      CONSTRAINT chk_impdet_libras CHECK (Libras > 0),
      CONSTRAINT chk_impdet_costo CHECK (CostoLb > 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`],

  // El contacto del proveedor no va aquí: sale de ImportacionProveedor.Correo de cada solicitud.
  ["ImportacionDestinatario", `
    CREATE TABLE IF NOT EXISTS ImportacionDestinatario (
      DestinatarioId    INT AUTO_INCREMENT PRIMARY KEY,
      Nombre            VARCHAR(100) NOT NULL,
      Area              VARCHAR(60)  NULL,
      Correo            VARCHAR(150) NOT NULL,
      RecibePorDefecto  TINYINT(1)   NOT NULL DEFAULT 1,
      Activo            TINYINT(1)   NOT NULL DEFAULT 1,
      Orden             INT          NOT NULL DEFAULT 0,
      CreadoPor         VARCHAR(100) NOT NULL,
      CreadoEn          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_impdest_correo (Correo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`],

  // Para y Contenido son JSON. Contenido es la solicitud con sus líneas TAL COMO SE ENVIÓ: si después
  // se corrige, el historial sigue mostrando lo que recibió cada persona.
  ["ImportacionEnvio", `
    CREATE TABLE IF NOT EXISTS ImportacionEnvio (
      EnvioId      INT AUTO_INCREMENT PRIMARY KEY,
      SolicitudId  INT          NOT NULL,
      Asunto       VARCHAR(250) NOT NULL,
      Para         TEXT         NOT NULL,
      Contenido    LONGTEXT     NOT NULL,
      Estado       VARCHAR(10)  NOT NULL DEFAULT 'ENVIADO',
      Error        VARCHAR(500) NULL,
      EnviadoPor   VARCHAR(100) NOT NULL,
      EnviadoEn    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_impenv_solicitud (SolicitudId, EnviadoEn),
      CONSTRAINT fk_impenv_solicitud FOREIGN KEY (SolicitudId) REFERENCES ImportacionSolicitud (SolicitudId),
      CONSTRAINT chk_impenv_estado CHECK (Estado IN ('ENVIADO', 'ERROR')),
      CONSTRAINT chk_impenv_para CHECK (JSON_VALID(Para)),
      CONSTRAINT chk_impenv_contenido CHECK (JSON_VALID(Contenido))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`],

  ["ImportacionParametro", `
    CREATE TABLE IF NOT EXISTS ImportacionParametro (
      Clave          VARCHAR(40)  NOT NULL PRIMARY KEY,
      Valor          VARCHAR(200) NOT NULL,
      Descripcion    VARCHAR(200) NULL,
      ModificadoPor  VARCHAR(100) NULL,
      ModificadoEn   DATETIME     NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`],
];

async function existeTabla(nombre: string): Promise<boolean> {
  const r: any[] = await prisma.$queryRaw`
    SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${nombre}`;
  return r.length > 0;
}

async function crear() {
  // Antes de crear nada: las tallas del parámetro deben existir y estar activas en Tallas.
  const activas: any[] = await prisma.$queryRawUnsafe(
    `SELECT Codigo FROM Tallas WHERE Activo = 1 AND Codigo IN (${TALLAS.map(() => "?").join(",")})`, ...TALLAS);
  const faltan = TALLAS.filter((c) => !activas.some((r) => Number(r.Codigo) === c));
  if (faltan.length) throw new Error(`Tallas que no existen o están inactivas: ${faltan.join(", ")}. No se creó nada.`);

  for (const [nombre, ddl] of TABLAS) {
    const existia = await existeTabla(nombre);
    await prisma.$executeRawUnsafe(ddl);
    console.log(`  ${existia ? "Ya existía" : "Creada   "}  ${nombre}`);
  }

  // Datos iniciales: INSERT IGNORE para que correr el script dos veces no duplique ni pise cambios.
  for (const [nombre, corto, pais] of PROVEEDORES) {
    await prisma.$executeRaw`
      INSERT IGNORE INTO ImportacionProveedor (Nombre, NombreCorto, Pais, CreadoPor)
      VALUES (${nombre}, ${corto}, ${pais}, ${CREADOR})`;
  }
  for (const [clave, valor, desc] of PARAMETROS) {
    await prisma.$executeRaw`
      INSERT IGNORE INTO ImportacionParametro (Clave, Valor, Descripcion) VALUES (${clave}, ${valor}, ${desc})`;
  }
  console.log(`  Datos iniciales: ${PROVEEDORES.length} proveedores y ${PARAMETROS.length} parámetros (tallas: ${TALLAS.length} códigos de Tallas).`);
}

async function borrar(forzar: boolean) {
  if (await existeTabla("ImportacionSolicitud")) {
    const r: any[] = await prisma.$queryRaw`SELECT COUNT(*) AS n FROM ImportacionSolicitud`;
    const n = Number(r[0].n);
    if (n > 0 && !forzar) {
      console.log(`  Hay ${n} solicitudes registradas. No se borra nada; usa --drop --forzar si de verdad hay que quitarlas.`);
      return;
    }
  }
  // Hijas antes que padres por las llaves foráneas.
  for (const nombre of ["ImportacionEnvio", "ImportacionSolicitudDetalle", "ImportacionSolicitud", "ImportacionDestinatario",
    "ImportacionProveedor", "ImportacionSerie", "ImportacionParametro"]) {
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${nombre}`);
    console.log(`  Borrada  ${nombre}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--drop")) await borrar(args.includes("--forzar"));
  else await crear();
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
