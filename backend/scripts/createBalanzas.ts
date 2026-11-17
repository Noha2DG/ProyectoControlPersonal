// Básculas de empaque propias (adiós Sofia): el catálogo de equipos y la cola de comandos remotos.
//
// Cada cabezal Android corre la app "Báscula Puente" (repo Noha2DG/Apk-puente). Desde la 1.1 la app
// avisa al servidor cada 30 s (POST /api/balanzas/latido) con el estado del puerto, el último peso y
// su versión; en la respuesta recoge los comandos que alguien dejó en BalanzaComando (reiniciar el
// lector, cambiar parámetros, ver tramas…). Así se sabe qué básculas están en línea sin abrir puertos
// hacia la planta: el que inicia la conversación siempre es el cabezal.
//
// El token de cada báscula se guarda como SHA-256, nunca en claro: se muestra una sola vez al
// registrarla o regenerarlo. A diferencia del token de kiosco (sin vencimiento e imposible de revocar
// sin cambiar JWT_SECRET), éste se revoca regenerándolo o desactivando la báscula.
//
// Tablas nuevas y vacías: crearlas no toca nada existente. Idempotente (IF NOT EXISTS).
// Uso: npx tsx scripts/createBalanzas.ts            — crea las tablas
//      npx tsx scripts/createBalanzas.ts --drop     — las borra (solo si siguen sin uso real)
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

async function main() {
  if (process.argv.includes("--drop")) {
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS BalanzaComando`);
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS Balanza`);
    console.log("Tablas Balanza y BalanzaComando borradas.");
    await prisma.$disconnect();
    return;
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Balanza (
      Codigo              VARCHAR(20)  NOT NULL PRIMARY KEY,
      Nombre              VARCHAR(100) NOT NULL DEFAULT '',
      BodegaVirtualCodigo VARCHAR(30)  NULL,
      Modo                VARCHAR(10)  NOT NULL DEFAULT 'PRODUCTO',
      TokenHash           CHAR(64)     NULL,
      Activa              TINYINT(1)   NOT NULL DEFAULT 1,
      UltimoContacto      DATETIME     NULL,
      EstadoPuerto        VARCHAR(20)  NULL,
      DetallePuerto       VARCHAR(255) NULL,
      UltimoPesoG         INT          NULL,
      Estable             TINYINT(1)   NULL,
      PaginasConectadas   INT          NULL,
      VersionApp          VARCHAR(20)  NULL,
      IpLocal             VARCHAR(45)  NULL,
      Equipo              VARCHAR(100) NULL,
      EncendidoSeg        INT          NULL,
      Parametros          VARCHAR(255) NULL,
      CreadoEn            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      RegistradoPor       VARCHAR(100) NULL,
      CONSTRAINT fk_balanza_bodega FOREIGN KEY (BodegaVirtualCodigo) REFERENCES BodegaVirtual(Codigo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);
  console.log("Tabla Balanza verificada.");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS BalanzaComando (
      ComandoId     INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
      BalanzaCodigo VARCHAR(20)  NOT NULL,
      Tipo          VARCHAR(30)  NOT NULL,
      Datos         TEXT         NULL,
      Estado        VARCHAR(12)  NOT NULL DEFAULT 'PENDIENTE',
      Resultado     MEDIUMTEXT   NULL,
      CreadoPor     VARCHAR(100) NOT NULL,
      CreadoEn      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      EntregadoEn   DATETIME     NULL,
      TerminadoEn   DATETIME     NULL,
      KEY ix_comando_balanza_estado (BalanzaCodigo, Estado),
      CONSTRAINT fk_comando_balanza FOREIGN KEY (BalanzaCodigo) REFERENCES Balanza(Codigo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);
  console.log("Tabla BalanzaComando verificada.");

  const [n]: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM Balanza`);
  console.log(`Básculas registradas: ${Number(n.n)}`);
  await prisma.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
