// Cola de impresión de la etiqueta de CLIENTE (la de arte complejo que va a la Epson por BarTender).
// Reemplaza a VistaEtiquetaBartender como origen de datos del .btw.
//
// POR QUÉ UNA TABLA Y NO LA VISTA: para cerrar el ciclo hace falta que BarTender marque lo que
// realmente imprimió, y MariaDB no deja actualizar una vista construida sobre diez tablas unidas.
// BarTender escribe sobre lo mismo que leyó, así que necesita una tabla real.
//
// Efecto secundario deseable: los valores quedan CONGELADOS al momento de generar los correlativos.
// Si después alguien edita el pedido, la fila conserva lo que de verdad se imprimió — que es lo que
// uno quiere de un registro de trazabilidad, no un reflejo de cómo está el pedido hoy.
//
// ImpresoEn NULL = todavía no sale en papel. Es la columna que BarTender actualiza al terminar, y
// sirve además como filtro natural ("imprimir solo lo pendiente") sin depender del rango.
//
// Reversible: npx tsx backend/scripts/createColaEtiquetaBartender.ts --drop

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TABLA = "ColaEtiquetaBartender";

async function crear() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${TABLA} (
      EtiquetaId       INT           NOT NULL,
      OrdenId          INT           NOT NULL,
      Correlativo      VARCHAR(20)   NOT NULL,
      CodigoPedido     VARCHAR(50)   NULL,
      Cliente          VARCHAR(200)  NULL,
      Subcliente       VARCHAR(200)  NULL,
      Proceso          VARCHAR(200)  NULL,
      Talla            VARCHAR(100)  NULL,
      Presentacion     VARCHAR(200)  NULL,
      Lote             VARCHAR(100)  NULL,
      Color            VARCHAR(100)  NULL,
      Origen           VARCHAR(100)  NULL,
      Congelacion      VARCHAR(100)  NULL,
      Area             VARCHAR(100)  NULL,
      FechaProduccion  DATE          NULL,
      RutaBtw          VARCHAR(500)  NULL,
      ImpresoEn        DATETIME      NULL,
      CreadoEn         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (EtiquetaId),
      KEY idx_cola_orden (OrdenId),
      KEY idx_cola_pendiente (OrdenId, ImpresoEn),
      CONSTRAINT fk_cola_etiqueta FOREIGN KEY (EtiquetaId)
        REFERENCES EtiquetaImpresa(EtiquetaId) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log(`Tabla ${TABLA} creada (o ya existía).`);

  // Relleno de las etiquetas activas que ya existían antes de esta tabla — sin esto, lo impreso
  // hasta hoy quedaría invisible para BarTender. Se ignoran las que ya estén (INSERT IGNORE).
  const antes: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM ${TABLA}`);
  await prisma.$executeRawUnsafe(`
    INSERT IGNORE INTO ${TABLA}
      (EtiquetaId, OrdenId, Correlativo, CodigoPedido, Cliente, Subcliente, Proceso, Talla,
       Presentacion, Lote, Color, Origen, Congelacion, Area, FechaProduccion)
    SELECT ei.EtiquetaId, ei.OrdenId, CONCAT('E', ei.EtiquetaId),
           dp.CodigoPedido, cli.RazonSocial, sub.RazonSocial, pc.Descripcion, ta.Descripcion,
           pr.Descripcion, oe.Lote, oe.Color, org.Descripcion, cong.Descripcion, ar.Nombre,
           oe.FechaProduccion
    FROM EtiquetaImpresa ei
    JOIN OrdenEtiquetado oe        ON ei.OrdenId = oe.OrdenId
    JOIN DetallePedido dp          ON oe.DetalleId = dp.DetalleId
    JOIN Clase cl                  ON dp.Clase = cl.Clase
    JOIN Procesos pc               ON cl.Proceso = pc.Proceso
    JOIN Tallas ta                 ON dp.Talla = ta.Codigo
    JOIN Presentacion pr           ON dp.Presentacion = pr.Codigo
    JOIN Pedidos ped               ON dp.CodigoPedido = ped.CodigoPedido
    JOIN Clientes cli              ON ped.CodigoCliente = cli.Codigo
    LEFT JOIN Subcliente sub       ON ped.CodigoCliente = sub.CodigoCliente
                                  AND ped.CodigoSubcliente = sub.CodigoSubcliente
    JOIN Origen org                ON oe.Origen = org.Codigo
    JOIN UnidadesCongelacion cong  ON oe.Congelacion = cong.Codigo
    LEFT JOIN Areas ar             ON oe.AreaCodigo = ar.Codigo
    WHERE ei.Estatus = 'Activa'
  `);
  const despues: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM ${TABLA}`);
  console.log(`Relleno: ${Number(despues[0].n) - Number(antes[0].n)} fila(s) agregada(s), ${Number(despues[0].n)} en total.\n`);

  const muestra: any[] = await prisma.$queryRawUnsafe(`
    SELECT Correlativo, CodigoPedido, Cliente, Subcliente, Lote, ImpresoEn
    FROM ${TABLA} ORDER BY EtiquetaId DESC LIMIT 5`);
  if (muestra.length) {
    console.table(muestra.map(m => ({ ...m, ImpresoEn: m.ImpresoEn ?? "(pendiente)" })));
  }
}

async function eliminar() {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${TABLA}`);
  console.log(`Tabla ${TABLA} eliminada.`);
}

const main = process.argv.includes("--drop") ? eliminar : crear;

main()
  .then(() => process.exit(0))
  .catch(e => { console.error("ERROR:", e.message); process.exit(1); });
