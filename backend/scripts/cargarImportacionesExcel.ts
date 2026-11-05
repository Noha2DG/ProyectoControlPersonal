// Carga inicial de Importaciones: las proformas REALES de la hoja BASE DAtos de «Pedidos Taiwan.xlsx»
// (Estado = Recibido o Confirmados; lo "Por pedir" queda fuera). Decidido el 4 nov 2026.
//
// Entrada: un JSON con una entrada por proforma, ya agrupada desde el Excel:
//   [{ Proveedor, Proforma, FechaSalida, FechaLlegada, FechaPago, Estado, EstadoFlujo,
//      lineas: [{ fila, Clase, Descripcion, Talla: "16-20", Libras, CostoLb, TotalExcel }] }]
//
// Cómo se traduce:
//   · Origen = 'EXCEL' y FechaPedido = NULL: en el Excel esa columna copiaba la fecha de salida.
//   · FechaPago = Fecha Flujo (la negociada en cada proforma).
//   · Recibido → RECIBIDA con RecibidaEn = fecha de llegada; Pagado → PAGADA con PagadaEn = Fecha Flujo.
//     El Excel no guarda cuándo pasó de verdad: son la mejor aproximación.
//   · 2026-000002 trae la salida (01/11/2026) DESPUÉS de la llegada (24/10/2026): el usuario decidió
//     cargarla sin salida y con una nota.
//   · Folios MP-2026-NNNN en orden de llegada.
//
// Uso:  npx tsx scripts/cargarImportacionesExcel.ts <proformas.json>            (prueba: revierte)
//       npx tsx scripts/cargarImportacionesExcel.ts <proformas.json> --aplicar  (guarda)
// Se niega si alguna de esas proformas ya está cargada.

import "dotenv/config";
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CREADOR = "Carga Excel (Pedidos Taiwan.xlsx)";
const SALIDA_IMPOSIBLE: Record<string, string> = {
  "2026-000002": "En el Excel la salida venía 01/11/2026, posterior a la llegada (24/10/2026); se cargó sin fecha de salida.",
};

class Revertir extends Error {}
const norm = (s: string) => s.toUpperCase().replace(/\s/g, "").replace(/-/g, "/");

async function main() {
  const [archivo, ...banderas] = process.argv.slice(2);
  if (!archivo) throw new Error("Falta el JSON de proformas");
  const aplicar = banderas.includes("--aplicar");
  const proformas: any[] = JSON.parse(readFileSync(archivo, "utf8"));

  const provs: any[] = await prisma.$queryRaw`SELECT ProveedorId, Nombre FROM ImportacionProveedor`;
  const par: any[] = await prisma.$queryRaw`SELECT Valor FROM ImportacionParametro WHERE Clave = 'TALLAS'`;
  const codigos: number[] = JSON.parse(par[0].Valor);
  const tallas: any[] = await prisma.$queryRawUnsafe(`SELECT Codigo, Descripcion FROM Tallas WHERE Codigo IN (${codigos.join(",")})`);
  const porTalla = new Map(tallas.map(t => [norm(String(t.Descripcion)), Number(t.Codigo)]));
  const proveedor = (nombre: string) => {
    const k = nombre.split(/[ ,]/)[0].toLowerCase();
    const p = provs.find(x => String(x.Nombre).toLowerCase().startsWith(k));
    if (!p) throw new Error(`Proveedor sin equivalente: ${nombre}`);
    return Number(p.ProveedorId);
  };

  const orden = [...proformas].sort((a, b) =>
    a.FechaLlegada.localeCompare(b.FechaLlegada) || String(a.FechaSalida ?? "").localeCompare(String(b.FechaSalida ?? "")) || a.Proforma.localeCompare(b.Proforma));
  const avisos: string[] = [];

  try {
    await prisma.$transaction(async tx => {
      for (const p of orden) {
        const provId = proveedor(p.Proveedor);
        const ya: any[] = await tx.$queryRaw`SELECT Folio FROM ImportacionSolicitud WHERE ProveedorId = ${provId} AND Proforma = ${p.Proforma}`;
        if (ya.length) throw new Error(`La proforma ${p.Proforma} ya está cargada como ${ya[0].Folio}. No se cargó nada.`);
        if (!["Recibido", "Confirmados"].includes(p.Estado)) throw new Error(`Estado inesperado en ${p.Proforma}: ${p.Estado}`);
        if (!["Pagado", "Pendiente"].includes(p.EstadoFlujo)) throw new Error(`Estado de flujo inesperado en ${p.Proforma}: ${p.EstadoFlujo}`);

        const nota = SALIDA_IMPOSIBLE[p.Proforma] ?? null;
        const salida = nota ? null : p.FechaSalida;
        if (salida && salida > p.FechaLlegada) throw new Error(`${p.Proforma}: salida después de la llegada y sin decisión tomada`);
        const recibida = p.Estado === "Recibido", pagada = p.EstadoFlujo === "Pagado";

        await tx.$executeRaw`INSERT INTO ImportacionSerie (Anio, UltimoSecuencial) VALUES (2026, 1) ON DUPLICATE KEY UPDATE UltimoSecuencial = UltimoSecuencial + 1`;
        const sec: any[] = await tx.$queryRaw`SELECT UltimoSecuencial FROM ImportacionSerie WHERE Anio = 2026`;
        const folio = `MP-2026-${String(Number(sec[0].UltimoSecuencial)).padStart(4, "0")}`;
        await tx.$executeRaw`
          INSERT INTO ImportacionSolicitud (Folio, ProveedorId, Proforma, FechaPedido, FechaSalida, FechaLlegada, FechaPago,
                 Estado, RecibidaEn, RecibidaPor, EstadoPago, PagadaEn, PagadaPor, Notas, Origen, CreadoPor)
          VALUES (${folio}, ${provId}, ${p.Proforma}, NULL, ${salida}, ${p.FechaLlegada}, ${p.FechaPago},
                 ${recibida ? "RECIBIDA" : "CONFIRMADA"}, ${recibida ? p.FechaLlegada : null}, ${recibida ? CREADOR : null},
                 ${pagada ? "PAGADA" : "PENDIENTE"}, ${pagada ? p.FechaPago : null}, ${pagada ? CREADOR : null},
                 ${nota}, 'EXCEL', ${CREADOR})`;
        const id: any[] = await tx.$queryRaw`SELECT SolicitudId FROM ImportacionSolicitud WHERE Folio = ${folio}`;

        for (const [i, l] of p.lineas.entries()) {
          const talla = porTalla.get(norm(l.Talla));
          if (!talla) throw new Error(`${p.Proforma}, fila ${l.fila}: talla ${l.Talla} fuera del parámetro TALLAS`);
          await tx.$executeRaw`
            INSERT INTO ImportacionSolicitudDetalle (SolicitudId, Linea, Clase, Descripcion, Talla, Libras, CostoLb)
            VALUES (${Number(id[0].SolicitudId)}, ${i + 1}, ${l.Clase}, ${l.Descripcion || null}, ${talla}, ${l.Libras}, ${l.CostoLb})`;
        }
        const t: any[] = await tx.$queryRaw`SELECT SUM(Libras) lb, SUM(Total) usd FROM ImportacionSolicitudDetalle WHERE SolicitudId = ${Number(id[0].SolicitudId)}`;
        const excelUsd = p.lineas.reduce((a: number, l: any) => a + l.TotalExcel, 0);
        const dif = Number(t[0].usd) - excelUsd;
        if (Math.abs(dif) >= 0.05) avisos.push(`${p.Proforma}: total $${Number(t[0].usd)} vs Excel $${excelUsd.toFixed(2)}`);
        console.log(`  ${folio}  ${p.Proforma.padEnd(13)} ${String(p.Proveedor).slice(0, 16).padEnd(16)} llega ${p.FechaLlegada}  ${recibida ? "RECIBIDA  " : "CONFIRMADA"} ${pagada ? "PAGADA   " : "PENDIENTE"} ${String(p.lineas.length).padStart(2)} lín ${Number(t[0].lb).toLocaleString("en-US").padStart(7)} lb  $${Number(t[0].usd).toLocaleString("en-US", { minimumFractionDigits: 2 })}${nota ? "  (sin salida, con nota)" : ""}`);
      }
      const tot: any[] = await tx.$queryRaw`
        SELECT COUNT(DISTINCT s.SolicitudId) n, COUNT(*) lineas, SUM(d.Libras) lb, SUM(d.Total) usd
        FROM ImportacionSolicitud s JOIN ImportacionSolicitudDetalle d ON d.SolicitudId = s.SolicitudId WHERE s.Origen = 'EXCEL'`;
      console.log(`  Total: ${Number(tot[0].n)} solicitudes, ${Number(tot[0].lineas)} líneas, ${Number(tot[0].lb).toLocaleString("en-US")} lb, $${Number(tot[0].usd).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
      for (const a of avisos) console.log("  AVISO", a);
      if (!aplicar) throw new Revertir();
    }, { timeout: 60_000 });
    console.log("  GUARDADO.");
  } catch (e) {
    if (e instanceof Revertir) console.log("  Prueba: no se guardó nada (agrega --aplicar para guardar).");
    else throw e;
  }
}

main().catch(e => { console.error(e.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
