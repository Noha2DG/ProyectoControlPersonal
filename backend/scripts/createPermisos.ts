import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

async function main() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS TipoPermiso (
      codigoPermiso VARCHAR(10)  NOT NULL PRIMARY KEY,
      descripcion   VARCHAR(100) NOT NULL,
      Activo        TINYINT(1)  NOT NULL DEFAULT 1,
      CreadoEn      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `;
  console.log("Tabla TipoPermiso creada.");

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS Permisos (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      CodigoEmpleado VARCHAR(50)  NOT NULL,
      codigoPermiso  VARCHAR(10)  NOT NULL,
      Fecha          DATE         NOT NULL,
      Observacion    VARCHAR(255) NULL,
      RegistradoPor  VARCHAR(100) NOT NULL DEFAULT 'Sistema',
      CreadoEn       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_permiso_empleado FOREIGN KEY (CodigoEmpleado) REFERENCES Empleados(Codigo),
      CONSTRAINT fk_permiso_tipo     FOREIGN KEY (codigoPermiso)  REFERENCES TipoPermiso(codigoPermiso)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `;
  console.log("Tabla Permisos creada.");

  await prisma.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
