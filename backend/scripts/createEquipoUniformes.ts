import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

const TIPOS_EQUIPO = [
  { Codigo: "PAN", Nombre: "Pantalón" },
  { Codigo: "GOR", Nombre: "Gorro" },
  { Codigo: "SUD", Nombre: "Sudadero" },
  { Codigo: "CHU", Nombre: "Chumpa" },
  { Codigo: "OVE", Nombre: "Overol" },
  { Codigo: "FIL", Nombre: "Filipina" },
  { Codigo: "PLA", Nombre: "Playera" },
];

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS TiposEquipo (
      Codigo   VARCHAR(10)  NOT NULL PRIMARY KEY,
      Nombre   VARCHAR(50)  NOT NULL,
      Activo   TINYINT(1)   NOT NULL DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla TiposEquipo creada.");

  for (const t of TIPOS_EQUIPO) {
    await prisma.$executeRawUnsafe(
      `INSERT IGNORE INTO TiposEquipo (Codigo, Nombre) VALUES (?, ?)`,
      t.Codigo, t.Nombre
    );
  }
  console.log(`${TIPOS_EQUIPO.length} tipos de equipo insertados (INSERT IGNORE).`);

  // Una entrega de equipo por empleado por día
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS EntregaEquipo (
      id                       INT AUTO_INCREMENT PRIMARY KEY,
      Codigo                   VARCHAR(50)  NOT NULL,
      Fecha                    DATE         NOT NULL,
      FechaHoraEntrega         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      RegistradoPorEntrega     VARCHAR(100) NOT NULL DEFAULT 'Kiosco',
      FechaHoraDevolucion      DATETIME     NULL,
      RegistradoPorDevolucion  VARCHAR(100) NULL,
      Estado                   ENUM('Pendiente','Completo','Incompleto') NOT NULL DEFAULT 'Pendiente',
      UNIQUE KEY uniq_codigo_fecha (Codigo, Fecha),
      CONSTRAINT fk_entrega_empleado FOREIGN KEY (Codigo) REFERENCES Empleados(Codigo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla EntregaEquipo creada.");

  // Detalle de cada prenda incluida en una entrega
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS EntregaEquipoDetalle (
      id                   INT AUTO_INCREMENT PRIMARY KEY,
      EntregaId            INT          NOT NULL,
      CodigoTipoEquipo     VARCHAR(10)  NOT NULL,
      Devuelto             TINYINT(1)   NOT NULL DEFAULT 0,
      FechaHoraDevolucion  DATETIME     NULL,
      CONSTRAINT fk_detalle_entrega FOREIGN KEY (EntregaId)        REFERENCES EntregaEquipo(id) ON DELETE CASCADE,
      CONSTRAINT fk_detalle_tipo    FOREIGN KEY (CodigoTipoEquipo) REFERENCES TiposEquipo(Codigo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla EntregaEquipoDetalle creada.");

  await prisma.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
