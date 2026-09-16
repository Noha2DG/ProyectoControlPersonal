// Auditoría SOLO LECTURA: compara cada master del CSV de la migración contra lo que quedó en la base.
//   npx tsx scripts/auditarMigracionInventario.ts <inventario.csv>
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";

const prisma = new PrismaClient();

function leerCsv(ruta: string): string[][] {
  const txt = fs.readFileSync(ruta, "latin1");
  const filas: string[][] = [];
  let campo = "", fila: string[] = [], enComillas = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (enComillas) {
      if (c === '"') { if (txt[i + 1] === '"') { campo += '"'; i++; } else enComillas = false; }
      else campo += c;
    } else if (c === '"') enComillas = true;
    else if (c === ";") { fila.push(campo); campo = ""; }
    else if (c === "\n") { fila.push(campo); filas.push(fila); fila = []; campo = ""; }
    else if (c !== "\r") campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}
const N = (s: any) => String(s ?? "").toUpperCase().replace(/\s+/g, " ").trim().replace(/\s*\*\s*/g, "*");
const sinEspacios = (s: any) => N(s).replace(/ /g, "");

async function main() {
  const filas = leerCsv(process.argv[2]).slice(1).filter(f => f[0]?.trim());
  const db: any[] = await prisma.$queryRawUnsafe(`
    SELECT ei.Correlativo, dp.Clase, c.Descripcion AS ClaseDesc, dp.Proceso, t.Descripcion AS TallaDesc,
           pr.Descripcion AS PresDesc, e.Descripcion AS EmpDesc, oe.Lote,
           DATE_FORMAT(oe.FechaProduccion, '%Y-%m-%d') AS Fecha, pal.Codigo AS Pallet, dp.DetalleId
    FROM EtiquetaImpresa ei
    JOIN OrdenEtiquetado oe ON ei.OrdenId = oe.OrdenId
    JOIN DetallePedido dp ON oe.DetalleId = dp.DetalleId
    LEFT JOIN Clase c ON c.Clase = dp.Clase
    LEFT JOIN Tallas t ON t.Codigo = dp.Talla
    LEFT JOIN Presentacion pr ON pr.Codigo = dp.Presentacion
    LEFT JOIN Empaques e ON e.Codigo = dp.EmpaqueAccesorio
    LEFT JOIN Masters m ON m.EtiquetaId = ei.EtiquetaId
    LEFT JOIN Pallets pal ON pal.PalletId = m.PalletId
    WHERE ei.RegistradoPor = 'Migración'`);
  const porCodigo = new Map(db.map(r => [String(r.Correlativo), r]));
  console.log(`CSV ${filas.length} filas, base ${db.length} etiquetas migradas.`);

  const difs = new Map<string, { n: number; ej: string; detalles: Set<number> }>();
  const anotar = (campo: string, csv: string, base: string, master: string, det: number) => {
    const k = `${campo}: archivo "${csv}" -> base "${base}"`;
    const e = difs.get(k) ?? { n: 0, ej: master, detalles: new Set() };
    e.n++; e.detalles.add(det); difs.set(k, e);
  };
  let faltan = 0, malos = new Set<string>();
  for (const f of filas) {
    const m = f[0].trim(), r = porCodigo.get(m);
    if (!r) { faltan++; continue; }
    const fecha = f[8].trim().split("/").reverse().map((x, i) => i ? x.padStart(2, "0") : x).join("-");
    const chk = (campo: string, a: string, b: string, cmp = (x: string, y: string) => N(x) === N(y)) => {
      if (!cmp(a, b ?? "")) { anotar(campo, a, b, m, Number(r.DetalleId)); malos.add(m); }
    };
    chk("Clase", f[4], r.ClaseDesc);
    chk("Talla", f[5], r.TallaDesc);
    chk("Presentación", f[7], r.PresDesc, (x, y) => sinEspacios(x) === sinEspacios(y));
    chk("Empaque", f[6], r.EmpDesc);
    chk("Lote", f[9].trim().slice(0, 30), r.Lote);
    chk("Fecha", fecha, r.Fecha);
    chk("Pallet", f[3], r.Pallet);
  }
  console.log(`No encontrados en base: ${faltan}.  Masters con alguna diferencia: ${malos.size}.`);
  for (const [k, v] of [...difs].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`${String(v.n).padStart(6)}  ${k}   (ej. ${v.ej}; líneas ${[...v.detalles].join(",")})`);
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
