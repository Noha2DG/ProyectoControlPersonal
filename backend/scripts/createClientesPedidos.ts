import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

const CLIENTES = [
  { Codigo: 1, RazonSocial: "OROPSA", Pais: "GT", Estatus: "Activo" },
  { Codigo: 2, RazonSocial: "OFICINAS CENTRALES", Pais: "GT", Estatus: "Activo" },
  { Codigo: 3, RazonSocial: "PRODUCTO PARA PELADO", Pais: "GT", Estatus: "Activo" },
  { Codigo: 10, RazonSocial: "YENS", Pais: "TW", Estatus: "Activo" },
  { Codigo: 11, RazonSocial: "LEQUALITY", Pais: "TW", Estatus: "Activo" },
  { Codigo: 12, RazonSocial: "I OCEAN", Pais: "TW", Estatus: "Activo" },
  { Codigo: 13, RazonSocial: "PESCADORES", Pais: "TW", Estatus: "Activo" },
  { Codigo: 14, RazonSocial: "GOLD LAKE", Pais: "TW", Estatus: "Activo" },
  { Codigo: 15, RazonSocial: "UNION MARINE", Pais: "TW", Estatus: "Activo" },
  { Codigo: 40, RazonSocial: "RED CHAMBER COMPANY", Pais: "US", Estatus: "Activo" },
  { Codigo: 41, RazonSocial: "PESCANOVA USA", Pais: "US", Estatus: "Activo" },
  { Codigo: 45, RazonSocial: "INDUPECASA", Pais: "US", Estatus: "Activo" },
  { Codigo: 51, RazonSocial: "WALMART", Pais: "GT", Estatus: "Activo" },
  { Codigo: 52, RazonSocial: "SUMINISTROS", Pais: "GT", Estatus: "Activo" },
  { Codigo: 53, RazonSocial: "UNISUPER", Pais: "GT", Estatus: "Activo" },
  { Codigo: 54, RazonSocial: "VENTA LOCAL", Pais: "GT", Estatus: "Activo" },
  { Codigo: 55, RazonSocial: "SIN CLIENTE", Pais: "GT", Estatus: "Activo" },
  { Codigo: 56, RazonSocial: "LAI LAI", Pais: "GT", Estatus: "Activo" },
  { Codigo: 57, RazonSocial: "RINOLI S.A", Pais: "GT", Estatus: "Activo" },
  { Codigo: 70, RazonSocial: "IMPORTADORA Y EXPORTADORA DE MARISCOS DE CENTRO AMERICA Y EL CARIBE S.A DE CV", Pais: "MX", Estatus: "Activo" },
  { Codigo: 80, RazonSocial: "EL HUEVO FRITO S.A.", Pais: "GT", Estatus: "Activo" },
  { Codigo: 90, RazonSocial: "OCEANA", Pais: "GT", Estatus: "Activo" },
  // El pedido "OLA AZUL" usa Cliente 69, que no existe en la hoja Clientes del Excel original.
  // Se agrega como placeholder; hay que completar el nombre real desde Catálogos → Clientes.
  { Codigo: 69, RazonSocial: "(pendiente de definir)", Pais: "GT", Estatus: "Activo" },
];

const SUBCLIENTES = [
  { CodigoCliente: 1, CodigoSubcliente: "1", RazonSocial: "TIENDA OROPSA" },
  { CodigoCliente: 2, CodigoSubcliente: "OC001", RazonSocial: "ZONA 4" },
  { CodigoCliente: 3, CodigoSubcliente: "1", RazonSocial: "PRODUCTO PARA PELAR" },
  { CodigoCliente: 10, CodigoSubcliente: "S025", RazonSocial: "YENS AND FRIENDS" },
  { CodigoCliente: 10, CodigoSubcliente: "S026", RazonSocial: "BODO FOOD" },
  { CodigoCliente: 10, CodigoSubcliente: "S027", RazonSocial: "NUSTYLE" },
  { CodigoCliente: 10, CodigoSubcliente: "S028", RazonSocial: "TAIWAN LOGISITICS" },
  { CodigoCliente: 10, CodigoSubcliente: "S033", RazonSocial: "PEAK ONE INTERNATIONAL CORP." },
  { CodigoCliente: 12, CodigoSubcliente: "S029", RazonSocial: "JH TRADING Co. LTD" },
  { CodigoCliente: 12, CodigoSubcliente: "S030", RazonSocial: "YUAN SYIN TRADING Co. LTD" },
  { CodigoCliente: 12, CodigoSubcliente: "S031", RazonSocial: "GREAT HUNG ENTERPRISE Co. LTD" },
  { CodigoCliente: 12, CodigoSubcliente: "S035", RazonSocial: "WEN'S FROZEN FOOD CORP." },
  { CodigoCliente: 13, CodigoSubcliente: "S040", RazonSocial: "FUGUO FREEZING CO., LTD." },
  { CodigoCliente: 14, CodigoSubcliente: "S032", RazonSocial: "GOLDEN PROFIT SEA FOODS Co. LTD" },
  { CodigoCliente: 14, CodigoSubcliente: "S033", RazonSocial: "GOLD LAKE SEA FOOD ENTERPRISE CO., LTD" },
  { CodigoCliente: 15, CodigoSubcliente: "S037", RazonSocial: "UNION MARINE FROZEN FOOD Co. LTD" },
  { CodigoCliente: 40, CodigoSubcliente: "S037", RazonSocial: "TRADER JOE'S" },
  { CodigoCliente: 40, CodigoSubcliente: "S038", RazonSocial: "TAMPA BAY FISHERIES" },
  { CodigoCliente: 40, CodigoSubcliente: "S039", RazonSocial: "RED CHAMBER" },
  { CodigoCliente: 45, CodigoSubcliente: "N010", RazonSocial: "LONG JHON SILVER" },
  { CodigoCliente: 45, CodigoSubcliente: "N011", RazonSocial: "GOLD COAST" },
  { CodigoCliente: 45, CodigoSubcliente: "N012", RazonSocial: "CAPTAIN MORGAN" },
  { CodigoCliente: 45, CodigoSubcliente: "N013", RazonSocial: "HIDDEN BAY" },
  { CodigoCliente: 45, CodigoSubcliente: "N015", RazonSocial: "PIER PORT" },
  { CodigoCliente: 45, CodigoSubcliente: "N016", RazonSocial: "EMPIRE'S TREASURE" },
  { CodigoCliente: 45, CodigoSubcliente: "N017", RazonSocial: "TAMPA BAY FISHERIES" },
  { CodigoCliente: 45, CodigoSubcliente: "N018", RazonSocial: "OCEAN CAFE" },
  { CodigoCliente: 45, CodigoSubcliente: "N019", RazonSocial: "INDUPECASA" },
  { CodigoCliente: 51, CodigoSubcliente: "W05", RazonSocial: "WALMART" },
  { CodigoCliente: 52, CodigoSubcliente: "S040", RazonSocial: "SUMINISTROS" },
  { CodigoCliente: 52, CodigoSubcliente: "S041", RazonSocial: "RETAIL" },
  { CodigoCliente: 53, CodigoSubcliente: "S053", RazonSocial: "UNISUPER" },
  { CodigoCliente: 55, CodigoSubcliente: "S036", RazonSocial: "SIN SUBCLIENTE" },
  { CodigoCliente: 56, CodigoSubcliente: "L001", RazonSocial: "LAI LAI" },
  { CodigoCliente: 57, CodigoSubcliente: "C010", RazonSocial: "RINOLI S.A" },
];

// Nota: el pedido "2025019" aparece DOS VECES en el Excel original con descripciones distintas
// (PEAK ONE INTERNATIONAL CORP. / PEAK ONE INT. 019), mismo cliente. Es un duplicado real de la
// fuente — solo se conserva el primero (INSERT IGNORE); hay que decidir con el usuario cuál es
// el correcto o si son dos pedidos que deben tener códigos distintos.
const PEDIDOS = [
  { Codigo: "001-2026", CodigoCliente: 14, Descripcion: "GOLDEN PROFIT SEA FOODS Co. LT", Estatus: "Terminado" },
  { Codigo: "002-2026", CodigoCliente: 14, Descripcion: "GOLDEN PROFIT SEA FOODS Co. LT", Estatus: "Terminado" },
  { Codigo: "003-2026", CodigoCliente: 14, Descripcion: "GOLDEN PROFIT SEA FOODS Co. LT", Estatus: "Terminado" },
  { Codigo: "004-2026", CodigoCliente: 70, Descripcion: "IMPORTADORA Y EXPORTADORA DE M", Estatus: "Terminado" },
  { Codigo: "2025019", CodigoCliente: 10, Descripcion: "PEAK ONE INTERNATIONAL CORP.", Estatus: "Terminado" },
  { Codigo: "029-2025", CodigoCliente: 14, Descripcion: "GOLDEN PROFIT SEA FOODS Co. LT", Estatus: "Terminado" },
  { Codigo: "1", CodigoCliente: 3, Descripcion: "PRODUCTO PARA PELAR", Estatus: "Proceso" },
  { Codigo: "12025021", CodigoCliente: 14, Descripcion: "GOLDEN PROFIT PROVISIONAL", Estatus: "Terminado" },
  { Codigo: "12025040", CodigoCliente: 13, Descripcion: "FUGUO FREEZING PROVISIONAL", Estatus: "Terminado" },
  { Codigo: "12025048", CodigoCliente: 14, Descripcion: "GOLD LAKE SEA FOOD PROVISIONAL", Estatus: "Terminado" },
  { Codigo: "12025069", CodigoCliente: 69, Descripcion: "OLA AZUL", Estatus: "Terminado" },
  { Codigo: "12025070", CodigoCliente: 1, Descripcion: "TIENDA ORO DEL PACIFICO", Estatus: "Proceso" },
  { Codigo: "2025000", CodigoCliente: 55, Descripcion: "PEDIDO GENERAL", Estatus: "Terminado" },
  { Codigo: "2025001", CodigoCliente: 70, Descripcion: "pedido real PL 032 a mexico", Estatus: "Terminado" },
  { Codigo: "2025002", CodigoCliente: 54, Descripcion: "PEDIDO GENERAL PESCADO", Estatus: "Proceso" },
  { Codigo: "2025004", CodigoCliente: 55, Descripcion: "PEDIDO GENERAL PELADOS", Estatus: "Proceso" },
  { Codigo: "2025009", CodigoCliente: 53, Descripcion: "UNISUPER", Estatus: "Terminado" },
  { Codigo: "2025010", CodigoCliente: 51, Descripcion: "WALMART", Estatus: "Proceso" },
  { Codigo: "2025011", CodigoCliente: 56, Descripcion: "LAI LAI", Estatus: "Proceso" },
  { Codigo: "2025012", CodigoCliente: 52, Descripcion: "SUMINISTROS", Estatus: "Proceso" },
  { Codigo: "2025015", CodigoCliente: 57, Descripcion: "RINOLI S.A", Estatus: "Terminado" },
  { Codigo: "2025016", CodigoCliente: 12, Descripcion: "GREAT HUNG ENTERPRISE", Estatus: "Terminado" },
  { Codigo: "2025017", CodigoCliente: 12, Descripcion: "WENS FROZEN", Estatus: "Terminado" },
  { Codigo: "2025021", CodigoCliente: 14, Descripcion: "GOLDEN PROFIT SEA FOODS", Estatus: "Terminado" },
  { Codigo: "2025022", CodigoCliente: 14, Descripcion: "GOLDEN PROFIT SEA FOODS", Estatus: "Terminado" },
  { Codigo: "2025023", CodigoCliente: 70, Descripcion: "IMPORTADORA Y EXPORTADORA DE M", Estatus: "Terminado" },
  { Codigo: "2025024", CodigoCliente: 40, Descripcion: "RED CHAMBER", Estatus: "Terminado" },
  { Codigo: "2025025", CodigoCliente: 70, Descripcion: "IMPORTADORA Y EXPORTADORA DE M", Estatus: "Terminado" },
  { Codigo: "2025026", CodigoCliente: 70, Descripcion: "IMPORTADORA Y EXPORTADORA DE M", Estatus: "Terminado" },
  { Codigo: "2025027", CodigoCliente: 40, Descripcion: "Red Chambers 31/35", Estatus: "Terminado" },
  { Codigo: "2025029", CodigoCliente: 14, Descripcion: "GOLDEN PROFIT SEA FOODS", Estatus: "Terminado" },
  { Codigo: "2025030", CodigoCliente: 52, Descripcion: "PEDIDO SUMINISTROS Y ALIMENTOS", Estatus: "Terminado" },
  { Codigo: "2025031", CodigoCliente: 80, Descripcion: "PEDIDO HUEVO FRITO", Estatus: "Terminado" },
  { Codigo: "2025032", CodigoCliente: 70, Descripcion: "IMPORTADORA Y EXPORTADORA DE M", Estatus: "Terminado" },
  { Codigo: "2025033", CodigoCliente: 52, Descripcion: "PEDIDO SUMINISTROS Y ALIMENTOS", Estatus: "Terminado" },
  { Codigo: "2025035", CodigoCliente: 14, Descripcion: "GOLD LAKE 16/20", Estatus: "Terminado" },
  { Codigo: "2025036", CodigoCliente: 52, Descripcion: "Suministros y alimentos", Estatus: "Terminado" },
  { Codigo: "2025037", CodigoCliente: 51, Descripcion: "Walmart 2do pedido", Estatus: "Terminado" },
  { Codigo: "2025038", CodigoCliente: 70, Descripcion: "IMPORTADORA Y EXPORTADORA DE M", Estatus: "Terminado" },
  { Codigo: "2025040", CodigoCliente: 13, Descripcion: "FUGUO FREEZING CO., LTD.", Estatus: "Terminado" },
  { Codigo: "2025043", CodigoCliente: 70, Descripcion: "Mexico IMPORTADORA Y EXPORTADO", Estatus: "Terminado" },
  { Codigo: "2025045", CodigoCliente: 70, Descripcion: "Mexico 2025045", Estatus: "Terminado" },
  { Codigo: "2025047", CodigoCliente: 70, Descripcion: "IMPORTADORA Y EXPORTADORA DE M", Estatus: "Terminado" },
  { Codigo: "2025048", CodigoCliente: 14, Descripcion: "GOLD LAKE SEA FOOD ENTERPRISE", Estatus: "Terminado" },
  { Codigo: "2025055", CodigoCliente: 15, Descripcion: "UNION MARINE FROZEN FOOD", Estatus: "Terminado" },
  { Codigo: "2025057", CodigoCliente: 15, Descripcion: "UNION MARINE FROZEN FOOD", Estatus: "Terminado" },
  { Codigo: "2025058", CodigoCliente: 10, Descripcion: "NUSTYLE PROVISIONAL", Estatus: "Terminado" },
  { Codigo: "2025059", CodigoCliente: 40, Descripcion: "TAMPA BAY FISHERIES", Estatus: "Terminado" },
  { Codigo: "2025060", CodigoCliente: 40, Descripcion: "TAMPA BAY FISHERIES", Estatus: "Terminado" },
  { Codigo: "2025062", CodigoCliente: 12, Descripcion: "Great Hung Enterprise Co., Ltd", Estatus: "Terminado" },
  { Codigo: "2025065", CodigoCliente: 45, Descripcion: "INDUPECASA - LONG JHON SILVER", Estatus: "Terminado" },
  { Codigo: "2025066", CodigoCliente: 45, Descripcion: "INDUPECASA - GOLD COAST", Estatus: "Terminado" },
  { Codigo: "2025067", CodigoCliente: 45, Descripcion: "INDUPECASA - HIDDEN BAY", Estatus: "Terminado" },
  { Codigo: "2025068", CodigoCliente: 45, Descripcion: "INDUPECASA - CAPTAIN MORGAN", Estatus: "Terminado" },
  { Codigo: "2026003", CodigoCliente: 45, Descripcion: "INDUPECASA-TAMPA BAY", Estatus: "Terminado" },
  { Codigo: "2026004", CodigoCliente: 2, Descripcion: "OFICINAS CENTRALES", Estatus: "Proceso" },
  { Codigo: "2026005", CodigoCliente: 45, Descripcion: "INDUPECASA-OCEAN CAFE", Estatus: "Terminado" },
  { Codigo: "2026006", CodigoCliente: 45, Descripcion: "INDUPECASA- INDUPECASA", Estatus: "Terminado" },
  { Codigo: "2026007", CodigoCliente: 52, Descripcion: "SUMINISTROS-RETAIL", Estatus: "Proceso" },
  { Codigo: "202601", CodigoCliente: 45, Descripcion: "INDUPECASA - PIER PORT", Estatus: "Terminado" },
  { Codigo: "202602", CodigoCliente: 45, Descripcion: "INDUPECASA - EMPIRE'S TREASURE", Estatus: "Terminado" },
  { Codigo: "RS001", CodigoCliente: 52, Descripcion: "SUMINISTROS-RE EMPAQUE", Estatus: "Terminado" },
];

async function main() {
  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Clientes (
      Codigo      INT           NOT NULL PRIMARY KEY,
      RazonSocial VARCHAR(150)  NOT NULL,
      Pais        VARCHAR(5)    NOT NULL,
      Estatus     VARCHAR(20)   NOT NULL DEFAULT 'Activo'
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla Clientes creada.");

  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Subcliente (
      CodigoCliente    INT           NOT NULL,
      CodigoSubcliente VARCHAR(10)   NOT NULL,
      RazonSocial      VARCHAR(150)  NOT NULL,
      Estatus          VARCHAR(20)   NOT NULL DEFAULT 'Activo',
      PRIMARY KEY (CodigoCliente, CodigoSubcliente),
      CONSTRAINT fk_subcliente_cliente FOREIGN KEY (CodigoCliente) REFERENCES Clientes(Codigo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla Subcliente creada.");

  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Pedidos (
      CodigoPedido     VARCHAR(20)   NOT NULL PRIMARY KEY,
      CodigoCliente    INT           NOT NULL,
      CodigoSubcliente VARCHAR(10)   NULL,
      Descripcion      VARCHAR(150)  NOT NULL,
      FechaInicio      DATE          NULL,
      Estatus          VARCHAR(20)   NOT NULL DEFAULT 'Proceso',
      CONSTRAINT fk_pedido_cliente FOREIGN KEY (CodigoCliente) REFERENCES Clientes(Codigo),
      CONSTRAINT fk_pedido_subcliente FOREIGN KEY (CodigoCliente, CodigoSubcliente) REFERENCES Subcliente(CodigoCliente, CodigoSubcliente)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla Pedidos creada.");

  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS DetallePedido (
      DetalleId        INT AUTO_INCREMENT PRIMARY KEY,
      CodigoPedido     VARCHAR(20)   NOT NULL,
      Clase            VARCHAR(10)   NOT NULL,
      Talla            INT           NOT NULL,
      Presentacion     VARCHAR(5)    NOT NULL,
      EmpaqueMaster    VARCHAR(10)   NOT NULL,
      EmpaqueAccesorio VARCHAR(10)   NULL,
      CantidadCajas    INT           NOT NULL,
      KgPedido         DECIMAL(10,3) NOT NULL,
      LibrasPedido     DECIMAL(10,3) NOT NULL,
      CONSTRAINT fk_detalle_pedido FOREIGN KEY (CodigoPedido) REFERENCES Pedidos(CodigoPedido),
      CONSTRAINT fk_detalle_clase FOREIGN KEY (Clase) REFERENCES Clase(Clase),
      CONSTRAINT fk_detalle_talla FOREIGN KEY (Talla) REFERENCES Tallas(Codigo),
      CONSTRAINT fk_detalle_presentacion FOREIGN KEY (Presentacion) REFERENCES Presentacion(Codigo),
      CONSTRAINT fk_detalle_empmaster FOREIGN KEY (EmpaqueMaster) REFERENCES Empaques(Codigo),
      CONSTRAINT fk_detalle_empaccesorio FOREIGN KEY (EmpaqueAccesorio) REFERENCES Empaques(Codigo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla DetallePedido creada.");

  for (const c of CLIENTES) {
    await p.$executeRawUnsafe(
      `INSERT IGNORE INTO Clientes (Codigo, RazonSocial, Pais, Estatus) VALUES (?, ?, ?, ?)`,
      c.Codigo, c.RazonSocial, c.Pais, c.Estatus
    );
  }
  console.log(`${CLIENTES.length} clientes insertados (INSERT IGNORE).`);

  for (const s of SUBCLIENTES) {
    await p.$executeRawUnsafe(
      `INSERT IGNORE INTO Subcliente (CodigoCliente, CodigoSubcliente, RazonSocial) VALUES (?, ?, ?)`,
      s.CodigoCliente, s.CodigoSubcliente, s.RazonSocial
    );
  }
  console.log(`${SUBCLIENTES.length} subclientes insertados (INSERT IGNORE).`);

  for (const ped of PEDIDOS) {
    await p.$executeRawUnsafe(
      `INSERT IGNORE INTO Pedidos (CodigoPedido, CodigoCliente, Descripcion, Estatus) VALUES (?, ?, ?, ?)`,
      ped.Codigo, ped.CodigoCliente, ped.Descripcion, ped.Estatus
    );
  }
  console.log(`${PEDIDOS.length} pedidos insertados (INSERT IGNORE; el duplicado 2025019 solo conserva el primero).`);

  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
