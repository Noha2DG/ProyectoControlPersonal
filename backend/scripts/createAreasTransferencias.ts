import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

const AREAS = [
  { Codigo: "AH", Nombre: "ADMINISTRACION COSTOS",         FormaPago: "Paga por Tiempo" },
  { Codigo: "AL", Nombre: "RECURSOS HUMANOS",               FormaPago: "Paga por Tiempo" },
  { Codigo: "AS", Nombre: "CONSULTAS ENFERMERIA",           FormaPago: "No Genera Paga"  },
  { Codigo: "AU", Nombre: "SEGURIDAD PLANTA",               FormaPago: "Paga por Tiempo" },
  { Codigo: "AW", Nombre: "ALINEADO",                       FormaPago: "Paga por Tiempo" },
  { Codigo: "AY", Nombre: "CHEQUEADORES",                   FormaPago: "Paga por Tiempo" },
  { Codigo: "BF", Nombre: "CONTROL DE CALIDAD",             FormaPago: "Paga por Tiempo" },
  { Codigo: "BL", Nombre: "ALMACEN",                        FormaPago: "Paga por Tiempo" },
  { Codigo: "BS", Nombre: "LAVANDERÍA",                     FormaPago: "Paga por Tiempo" },
  { Codigo: "BW", Nombre: "JEFATURAS",                      FormaPago: "Paga por Tiempo" },
  { Codigo: "BY", Nombre: "SUPERVISORES",                   FormaPago: "Paga por Tiempo" },
  { Codigo: "CA", Nombre: "CAPACITACION",                   FormaPago: "No Genera Paga"  },
  { Codigo: "CF", Nombre: "ENCARGADOS",                     FormaPago: "Paga por Tiempo" },
  { Codigo: "CL", Nombre: "MANTTO.",                        FormaPago: "Paga por Tiempo" },
  { Codigo: "CS", Nombre: "SANITIZACION",                   FormaPago: "Paga por Tiempo" },
  { Codigo: "DE", Nombre: "DESCONGELADO",                   FormaPago: null              },
  { Codigo: "DL", Nombre: "CLASIFICADO ENTERO",             FormaPago: null              },
  { Codigo: "DM", Nombre: "CLASIFICADO COLA",               FormaPago: "Paga por Tiempo" },
  { Codigo: "DS", Nombre: "PELADO Y DEVENADO",              FormaPago: "Paga por Obra"   },
  { Codigo: "DT", Nombre: "PINCHADO",                       FormaPago: "Paga por Obra"   },
  { Codigo: "DU", Nombre: "DESCABEZADO",                    FormaPago: "Paga por Obra"   },
  { Codigo: "DW", Nombre: "PESCADO",                        FormaPago: "Paga por Tiempo" },
  { Codigo: "DY", Nombre: "SOPORTE PELADO",                 FormaPago: "Paga por Tiempo" },
  { Codigo: "EB", Nombre: "SOPORTE DE MASTERTIZADO",        FormaPago: "Paga por Tiempo" },
  { Codigo: "EF", Nombre: "TUNEL",                          FormaPago: null              },
  { Codigo: "EL", Nombre: "CARGA Y DESCARGA",               FormaPago: "Paga por Tiempo" },
  { Codigo: "EM", Nombre: "EMPANIZADO",                     FormaPago: "Paga por Obra"   },
  { Codigo: "EP", Nombre: "EMPOLVADO",                      FormaPago: "Paga por Obra"   },
  { Codigo: "EQ", Nombre: "EMPANIZADO QUESO",               FormaPago: "Paga por Tiempo" },
  { Codigo: "ES", Nombre: "MASTERIZADO ENTERO",             FormaPago: null              },
  { Codigo: "EY", Nombre: "REEMPAQUE",                      FormaPago: "Paga por Tiempo" },
  { Codigo: "FF", Nombre: "DESPACHO",                       FormaPago: "Paga por Tiempo" },
  { Codigo: "FG", Nombre: "RECEPCION",                      FormaPago: null              },
  { Codigo: "FL", Nombre: "ETIQUETADO",                     FormaPago: "Paga por Tiempo" },
  { Codigo: "FM", Nombre: "RECEPCION HORA",                 FormaPago: "Paga por Tiempo" },
  { Codigo: "FS", Nombre: "QUIMICO",                        FormaPago: null              },
  { Codigo: "HA", Nombre: "COCINADO",                       FormaPago: null              },
  { Codigo: "HB", Nombre: "TRABAJOS VARIOS",                FormaPago: "Paga por Tiempo" },
  { Codigo: "MV", Nombre: "MASTERIZADO VARIOS",             FormaPago: "Paga por Tiempo" },
  { Codigo: "PH", Nombre: "PLANTA HIELO",                   FormaPago: "Paga por Tiempo" },
  { Codigo: "PS", Nombre: "PESADORAS",                      FormaPago: "Paga por Obra"   },
  { Codigo: "RD", Nombre: "REPROCESO DESCOLADO",            FormaPago: "Paga por Obra"   },
  { Codigo: "RC", Nombre: "REPROCESO CORTE",                FormaPago: "Paga por Obra"   },
  { Codigo: "RE", Nombre: "REETIQUETADO",                   FormaPago: "Paga por Tiempo" },
  { Codigo: "SC", Nombre: "SOPORTE CLASIFICADO",            FormaPago: "Paga por Tiempo" },
  { Codigo: "SD", Nombre: "SOPORTE DESCABEZADO",            FormaPago: "Paga por Tiempo" },
  { Codigo: "SE", Nombre: "SOPORTE EMPANIZADO",             FormaPago: "Paga por Tiempo" },
  { Codigo: "TB", Nombre: "BAÑO",                           FormaPago: "No Genera Paga"  },
  { Codigo: "TC", Nombre: "CAFETERIA",                      FormaPago: "No Genera Paga"  },
  { Codigo: "TE", Nombre: "CAFETERIA REFACCION",            FormaPago: "No Genera Paga"  },
  { Codigo: "TM", Nombre: "SALIDA TEMPORAL",                FormaPago: "No Genera Paga"  },
  { Codigo: "TP", Nombre: "PERMISO ASUNTO PERSONAL",        FormaPago: "No Genera Paga"  },
  { Codigo: "TR", Nombre: "GESTIONES RECURSOS HUMANOS",     FormaPago: "No Genera Paga"  },
  { Codigo: "TT", Nombre: "AREA GENERAL",                   FormaPago: "No Genera Paga"  },
];

async function main() {
  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Areas (
      Codigo      VARCHAR(10)   NOT NULL PRIMARY KEY,
      Nombre      VARCHAR(100)  NOT NULL,
      FormaPago   VARCHAR(50)   NULL,
      Activa      TINYINT(1)    NOT NULL DEFAULT 1,
      CreadoEn    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla Areas creada.");

  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Transferencias (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      Codigo        VARCHAR(50)   NOT NULL,
      CodigoArea    VARCHAR(10)   NOT NULL,
      FechaHora     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      RegistradoPor VARCHAR(100)  NOT NULL DEFAULT 'Kiosco',
      CONSTRAINT fk_trans_empleado FOREIGN KEY (Codigo)     REFERENCES Empleados(Codigo),
      CONSTRAINT fk_trans_area     FOREIGN KEY (CodigoArea) REFERENCES Areas(Codigo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla Transferencias creada.");

  for (const area of AREAS) {
    await p.$executeRawUnsafe(
      `INSERT IGNORE INTO Areas (Codigo, Nombre, FormaPago) VALUES (?, ?, ?)`,
      area.Codigo, area.Nombre, area.FormaPago
    );
  }
  console.log(`${AREAS.length} áreas insertadas (INSERT IGNORE).`);
  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
