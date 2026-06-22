import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Altas (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      Codigo         VARCHAR(50)   NOT NULL,
      FechaAlta      DATE          NOT NULL,
      Tipo           VARCHAR(20)   NOT NULL DEFAULT 'Nuevo',
      RegistradoPor  VARCHAR(100)  NOT NULL DEFAULT 'Sistema',
      CreadoEn       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_altas_empleado FOREIGN KEY (Codigo) REFERENCES Empleados(Codigo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla Altas creada exitosamente.");
  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
