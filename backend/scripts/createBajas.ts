import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Bajas (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      Codigo         VARCHAR(50)   NOT NULL,
      FechaBaja      DATE          NOT NULL,
      Motivo         VARCHAR(50)   NOT NULL,
      Recontratable  TINYINT(1)    NOT NULL DEFAULT 1,
      Observaciones  TEXT          NULL,
      RegistradoPor  VARCHAR(100)  NOT NULL DEFAULT 'Sistema',
      CreadoEn       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_bajas_empleado FOREIGN KEY (Codigo) REFERENCES Empleados(Codigo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla Bajas creada exitosamente.");
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error("ERROR:", e.message); process.exit(1); });
