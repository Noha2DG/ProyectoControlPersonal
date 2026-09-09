// Migración del inventario de bodega del sistema anterior (archivo "inventario 08-09 codigo master.xls").
//
//   npx tsx scripts/migrarInventarioInicial.ts <inventario.csv> <posiciones.csv> [--commit]
//
// Sin --commit hace la carga COMPLETA dentro de una transacción y la revierte al final: imprime el
// cuadre real contra producción (masters, polines, kilos por cliente) sin dejar nada escrito. Es la
// única forma de probar esto, porque no hay base de desarrollo.
//
// Los CSV salen de exportar las dos hojas del .xls con Excel (separador ";", codificación ANSI).
// No se versionan: son 3.8 MB de datos operativos, no de código.
//
// ── Qué trae el archivo y por qué la carga es como es ────────────────────────────────────────────
// 20,922 filas = UNA POR MASTER FÍSICO, con su código ya impreso y escaneable en la caja. Por eso NO
// se re-etiqueta nada: el código viejo se guarda en EtiquetaImpresa.Correlativo y a partir de ahí es
// indistinguible de los nuestros (ver alterEtiquetaImpresaCorrelativo.ts y lib/correlativo.ts).
//
// La cadena Pedido→DetallePedido→OrdenEtiquetado→EtiquetaImpresa→Masters→Pallets es obligatoria, así
// que se reconstruye entera hacia arriba a partir de lo que el archivo sí trae:
//
//   · CLIENTE  — el archivo trae razón social de OTRO catálogo, no el código. El mapeo va explícito
//                en CLIENTES: es la parte que ningún algoritmo puede adivinar y que el usuario
//                confirmó a mano. Todo el stock migrado cuelga de un pedido "INI-<cliente>" propio,
//                NO de los pedidos originales: así el avance contra proforma de los pedidos activos
//                sigue midiendo solo producción nueva.
//   · CLASE    — cruza por descripción contra Clase (20,921 de 20,922). El único huérfano es una fila
//                con la "Ñ" mal codificada en el origen.
//   · TALLA    — el archivo trae "21/25", que existe en las DOS escalas (2xx entero / 3xx colas) y no
//                se puede cruzar por descripción (ver project_tallas_dos_escalas). Se desambigua por
//                la familia de la clase; escalaDeClase() es esa regla y es el punto más delicado de
//                todo el script.
//   · EMPAQUE  — las 24 descripciones cruzan exactas, pero TODAS son de tipo Individual: el archivo
//                nunca registró el master. Por eso EmpaqueMaster va 'SM1' (SIN MASTER) en vez de
//                inventar un cartón que no consta.
//   · LOTE     — texto libre del sistema viejo ("G522TM05-E02-7", "G380K123"), que no descompone en
//                Piscina+Ciclo como el nuestro. Se conserva íntegro en OrdenEtiquetado.Lote y la
//                piscina/ciclo van a centinelas de migración: inventar una piscina plausible sería
//                contaminar trazabilidad con un dato que nadie registró.
//   · POSICIÓN — la hoja "posiciones" es la tabla de traducción. El sistema viejo numera al REVÉS
//                dentro de cada nivel (su "001" es nuestro "P8"), y se usa la hoja como fuente, no
//                una fórmula, porque es el dato que el usuario revisó.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";

const prisma = new PrismaClient();
const OPERADOR = "Migración";

// ── Mapeo de clientes, confirmado con el usuario ─────────────────────────────────────────────────
// Las tres variantes de SUMINISTROS son el mismo cliente (se diferencian por la presentación
// empacada, que ya viaja en DetallePedido). "PEDIDO GENERAL" y "PEDIDO GENERAL PESCADO" son producto
// de almacenaje sin cliente, van a SIN CLIENTE. GOLDEN PROFIT y GREAT GARDEN no son clientes propios:
// en este sistema ya se manejan bajo GOLD LAKE e I OCEAN respectivamente (pedidos 015-2026/016-2026).
const CLIENTES: Record<string, number> = {
  "TIENDA ORO DEL PACIFICO": 1,
  "PRODUCTO PARA PELAR": 3,
  "INDUPECASA- INDUPECASA": 45,
  "PEDIDO GENERAL PESCADO": 55,
  "PEDIDO GENERAL": 55,
  "HI-RICH SEAFOOD ENTERPRISE CO.": 226,
  "SUMINISTROS-RETAIL": 52,
  "SUMINISTROS-RE EMPAQUE": 52,
  "SUMINISTROS": 52,
  "YENS NUSTYLE": 10,
  "LAI LAI": 56,
  "GOLDEN PROFIT SEA FOODS CO. LT": 14,
  "GOLDEN PROFIT SEA FOODS": 14,
  "TOP FOODS": 91,
  "WALMART": 51,
  "DAVID JUAREZ": 92,
  "IMPORTADORA Y EXPORTADORA DE M": 70,
  "GL-BELLA": 16,
  "GREAT GARDEN ENTERPRISE CO": 12,
  "RED CHAMBER": 40,
  "RED CHAMBERS 31/35": 40,
  "OFICINAS CENTRALES": 2,
  "FISHERMAN": 93,
  "PEAK ONE INTERNATIONAL CORP.": 227,
  "TAMPA BAY FISHERIES": 228,
};

// Clientes que no existen en el catálogo y hay que crear (los dos últimos del mapa de arriba).
const CLIENTES_NUEVOS = [
  { Codigo: 227, RazonSocial: "PEAK ONE INTERNATIONAL CORP.", Pais: "TW", Tipo: "Exportacion" },
  { Codigo: 228, RazonSocial: "TAMPA BAY FISHERIES", Pais: "US", Tipo: "Exportacion" },
];

// Tallas que el sistema anterior usaba y no existen acá. Van en 9xx a propósito: fuera de las dos
// escalas (2xx entero / 3xx colas) para que nunca se confundan con una talla real de ninguna de las dos.
const TALLAS_NUEVAS = [
  { Codigo: 900, Descripcion: "SIN TALLA" },
  { Codigo: 901, Descripcion: "BROKEN" },
  { Codigo: 902, Descripcion: "200/OVER" },
];

// Presentaciones que el archivo usa y el catálogo no tiene. Solo se crean si NO resuelven ni
// siquiera ignorando espacios: el catálogo se edita a diario (durante esta misma migración
// aparecieron MN y MU, que cubren las dos de 600 gr) y duplicar una presentación es meter dos pesos
// distintos para el mismo producto. PesoKG/PesoLb son POR CAJA, no por master (ver lib/masters.ts).
const PRESENTACIONES_NUEVAS = [
  { Codigo: "Z03", Descripcion: "7/2 KG", Abreviatura: "2 KG", TipoMedida: "Kilos", PesoKG: 2, PesoLb: 4.409, CajasXMaster: 7 },
];

// El archivo escribe esta clase con el "T-ON" al final y el catálogo lo tiene al principio
// ("T-ON CULTIVO PELADO EMPANIZADO Q/JALAPEÑO BF"). Va explícito y no por comparación de palabras
// sueltas: en estas descripciones el orden distingue procesos de verdad (T-ON vs T-OFF), y una regla
// que ignore el orden puede fusionar dos clases distintas sin que nadie se entere.
const CLASES_ALIAS: Record<string, string> = {
  "CULTIVO PELADO EMPANIZADO Q/JALAPEÑO BF T-ON": "E94",
};

const FINCA_MIGRA = "MG001";
const CICLO_MIGRA = "MIGRA";
const CONGELACION_MIGRA = "MIGRACION";
const ORIGEN_MIGRA = "BODEGA";        // ya existe en el catálogo y describe exactamente esto
const BODEGA_VIRTUAL_MIGRA = "MIGRACION";
const ESTATUS_ORDEN_MIGRA = "Migrada"; // la deja fuera del listado diario de Etiquetado

class Revertir extends Error {}

// ── CSV ──────────────────────────────────────────────────────────────────────────────────────────
// Parser propio y no una dependencia nueva: es un CSV de Excel, separador ";", comillas dobles.
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

// Mayúsculas y espacios colapsados, y sin espacio alrededor del "*": el catálogo tiene
// "CULTIVO CABEZA ENTERO IQF *" y el archivo trae "CULTIVO CABEZA ENTERO IQF*" — es la misma clase
// (P28), y sin esta normalización se pierden 289 masters por un espacio.
const N = (s: any) => String(s ?? "").toUpperCase().replace(/\s+/g, " ").trim().replace(/\s*\*\s*/g, "*");
const sinEspacios = (s: any) => N(s).replace(/ /g, "");

// dd/mm/yyyy -> yyyy-mm-dd
function fechaIso(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s).trim());
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

// La regla que desambigua las tallas repetidas entre escalas. Vive sola y con nombre para que se
// pueda discutir: es una INFERENCIA sobre la familia del producto, no un dato del archivo.
function escalaDeClase(descripcionClase: string): "ENTERO" | "COLAS" | null {
  const d = N(descripcionClase);
  if (d.includes("CABEZA")) return "ENTERO";
  if (d.includes("COLA") || d.includes("PELADO")) return "COLAS";
  return null;
}

async function ejecutar(tx: any, sql: string, params: any[] = []) {
  return tx.$executeRawUnsafe(sql, ...params);
}

// Inserta en bloques: 20,920 INSERTs de una fila sobre una base remota no termina nunca.
async function insertarEnBloques(tx: any, tabla: string, columnas: string[], filas: any[][], porBloque = 400) {
  const marca = `(${columnas.map(() => "?").join(", ")})`;
  for (let i = 0; i < filas.length; i += porBloque) {
    const bloque = filas.slice(i, i + porBloque);
    await ejecutar(tx,
      `INSERT INTO ${tabla} (${columnas.join(", ")}) VALUES ${bloque.map(() => marca).join(", ")}`,
      bloque.flat());
  }
}

async function main() {
  const [rutaInv, rutaPos] = process.argv.slice(2).filter(a => !a.startsWith("--"));
  const COMMIT = process.argv.includes("--commit");
  if (!rutaInv || !rutaPos) {
    throw new Error("Uso: migrarInventarioInicial.ts <inventario.csv> <posiciones.csv> [--commit]");
  }

  // ── 1. Leer el archivo ─────────────────────────────────────────────────────────────────────────
  const crudo = leerCsv(rutaInv).slice(1).filter(f => f.some(c => c.trim()));
  const filas = crudo.map(f => ({
    Master: f[0]?.trim() ?? "", PedidoViejo: f[1]?.trim() ?? "", Cliente: f[2]?.trim() ?? "",
    Pallet: f[3]?.trim() ?? "", Clase: f[4]?.trim() ?? "", Talla: f[5]?.trim() ?? "",
    Empaque: f[6]?.trim() ?? "", Presentacion: f[7]?.trim() ?? "", Fecha: f[8]?.trim() ?? "",
    Lote: f[9]?.trim() ?? "", Ubicacion: f[10]?.trim() ?? "",
  })).filter(r => r.Master);
  console.log(`Archivo: ${filas.length} masters.`);

  // Traducción de posiciones: el sistema viejo numera al revés dentro del nivel.
  const posViejaANuestra = new Map<string, string>();
  for (const p of leerCsv(rutaPos).slice(1)) {
    if (!p[0]?.trim()) continue;
    posViejaANuestra.set(p[0].trim().toUpperCase(), `${p[1].trim()}-${p[2].trim()}-P${Number(p[3])}`);
  }
  console.log(`Traducción de posiciones: ${posViejaANuestra.size} entradas.`);

  const resumen: string[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      // ── 2. Catálogos que faltan ──────────────────────────────────────────────────────────────
      for (const t of TALLAS_NUEVAS) {
        await ejecutar(tx, `INSERT IGNORE INTO Tallas (Codigo, Descripcion, Activo) VALUES (?, ?, 1)`, [t.Codigo, t.Descripcion]);
      }
      const presExistentes: any[] = await tx.$queryRawUnsafe(`SELECT Descripcion FROM Presentacion`);
      const presLaxoExistente = new Set(presExistentes.map((r: any) => sinEspacios(r.Descripcion)));
      for (const p of PRESENTACIONES_NUEVAS) {
        if (presLaxoExistente.has(sinEspacios(p.Descripcion))) {
          console.log(`   presentación "${p.Descripcion}" ya está en el catálogo — no se crea.`);
          continue;
        }
        await ejecutar(tx,
          `INSERT IGNORE INTO Presentacion (Codigo, Descripcion, Abreviatura, TipoMedida, PesoKG, PesoLb, CajasXMaster, Activo)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
          [p.Codigo, p.Descripcion, p.Abreviatura, p.TipoMedida, p.PesoKG, p.PesoLb, p.CajasXMaster]);
      }
      for (const c of CLIENTES_NUEVOS) {
        await ejecutar(tx, `INSERT IGNORE INTO Clientes (Codigo, RazonSocial, Pais, Tipo, Estatus) VALUES (?, ?, ?, ?, 'Activo')`,
          [c.Codigo, c.RazonSocial, c.Pais, c.Tipo]);
      }
      // Finca y piscina centinela: inactivas, para no aparecer en los desplegables de Destajo. El
      // listado de capturas no filtra por Activo, así que el stock migrado se sigue viendo.
      await ejecutar(tx, `INSERT IGNORE INTO Finca (Codigo, Descripcion, Grupo, Abreviatura, Activo) VALUES (?, ?, ?, ?, 0)`,
        [FINCA_MIGRA, "MIGRACION SISTEMA ANTERIOR", "MIGRACION", "MG"]);
      await ejecutar(tx, `INSERT IGNORE INTO Piscina (CodigoFinca, Nombre, Activo) VALUES (?, ?, 0)`,
        [FINCA_MIGRA, "MIGRACION"]);
      const piscinaRows: any[] = await tx.$queryRawUnsafe(
        `SELECT PiscinaId FROM Piscina WHERE CodigoFinca = ? AND Nombre = ? LIMIT 1`, FINCA_MIGRA, "MIGRACION");
      const PISCINA_ID = Number(piscinaRows[0].PiscinaId);

      await ejecutar(tx, `INSERT IGNORE INTO UnidadesCongelacion (Codigo, Descripcion, Activo) VALUES (?, ?, 1)`,
        [CONGELACION_MIGRA, "Migración (sin dato de origen)"]);
      await ejecutar(tx, `INSERT IGNORE INTO BodegaVirtual (Codigo, Nombre, Letra, UltimoSecuencial, Activo) VALUES (?, ?, ?, 0, 0)`,
        [BODEGA_VIRTUAL_MIGRA, "Inventario inicial (migración)", "PA"]);

      // ── 3. Catálogos en memoria ──────────────────────────────────────────────────────────────
      const q = (s: string, ...a: any[]) => tx.$queryRawUnsafe(s, ...a) as Promise<any[]>;
      const clasePorDesc = new Map<string, { Clase: string; Proceso: number; Desc: string }>();
      for (const c of await q(`SELECT Clase, Proceso, Descripcion FROM Clase`)) {
        clasePorDesc.set(N(c.Descripcion), { Clase: c.Clase, Proceso: Number(c.Proceso), Desc: c.Descripcion });
      }
      const tallaPorDesc = new Map<string, number[]>();
      for (const t of await q(`SELECT Codigo, Descripcion FROM Tallas`)) {
        const k = N(t.Descripcion);
        tallaPorDesc.set(k, [...(tallaPorDesc.get(k) ?? []), Number(t.Codigo)]);
      }
      // Dos índices: exacto y "sin espacios". El archivo escribe "1/12kg (12 kg)" donde el catálogo
      // tiene "1/12 kg (12 kg)" (FP) — 1,117 masters se perderían por un espacio. El laxo solo se
      // consulta si el exacto falla, y si devuelve más de un candidato se rechaza la fila en vez de
      // adivinar: dos presentaciones que solo difieren en espacios son pesos distintos.
      const presPorDesc = new Map<string, string>();
      const presLaxa = new Map<string, string[]>();
      for (const p of await q(`SELECT Codigo, Descripcion FROM Presentacion`)) {
        presPorDesc.set(N(p.Descripcion), p.Codigo);
        const k = sinEspacios(p.Descripcion);
        presLaxa.set(k, [...(presLaxa.get(k) ?? []), p.Codigo]);
      }
      const empPorDesc = new Map<string, string>();
      for (const e of await q(`SELECT Codigo, Descripcion FROM Empaques`)) empPorDesc.set(N(e.Descripcion), e.Codigo);
      const cliPorCodigo = new Map<number, string>();
      for (const c of await q(`SELECT Codigo, RazonSocial FROM Clientes`)) cliPorCodigo.set(Number(c.Codigo), c.RazonSocial);
      const posPorCodigo = new Map<string, number>();
      for (const p of await q(`SELECT PosicionId, Codigo FROM Posiciones`)) posPorCodigo.set(p.Codigo, Number(p.PosicionId));

      // ── 4. Resolver cada fila ────────────────────────────────────────────────────────────────
      type Res = {
        Master: string; Cliente: number; Clase: string; Proceso: number; Talla: number;
        Presentacion: string; Empaque: string; Lote: string; Fecha: string; Pallet: string; Posicion: string | null;
      };
      const resueltas: Res[] = [];
      const rechazos = new Map<string, number>();
      const rechazar = (m: string) => rechazos.set(m, (rechazos.get(m) ?? 0) + 1);

      for (const f of filas) {
        const alias = CLASES_ALIAS[N(f.Clase)];
        const cl = alias
          ? [...clasePorDesc.values()].find(c => c.Clase === alias)
          : clasePorDesc.get(N(f.Clase));
        if (!cl) { rechazar(`clase no existe: ${f.Clase}`); continue; }
        const cliente = CLIENTES[N(f.Cliente)];
        if (cliente == null) { rechazar(`cliente sin mapeo: ${f.Cliente}`); continue; }
        const cands = tallaPorDesc.get(N(f.Talla));
        if (!cands?.length) { rechazar(`talla no existe: ${f.Talla}`); continue; }
        let talla: number | null = cands.length === 1 ? cands[0] : null;
        if (talla == null) {
          const esc = escalaDeClase(cl.Desc);
          if (!esc) { rechazar(`talla ambigua y clase sin familia: ${f.Talla} / ${cl.Desc}`); continue; }
          const filtro = cands.filter(c => (c >= 200 && c < 300) === (esc === "ENTERO"));
          if (filtro.length !== 1) { rechazar(`talla ambigua no resuelta: ${f.Talla} / ${cl.Desc}`); continue; }
          talla = filtro[0];
        }
        let pres = presPorDesc.get(N(f.Presentacion));
        if (!pres) {
          const cands = presLaxa.get(sinEspacios(f.Presentacion)) ?? [];
          if (cands.length > 1) { rechazar(`presentación ambigua ignorando espacios: ${f.Presentacion} -> ${cands.join("/")}`); continue; }
          pres = cands[0];
        }
        if (!pres) { rechazar(`presentación no existe: ${f.Presentacion}`); continue; }
        const emp = empPorDesc.get(N(f.Empaque));
        if (!emp) { rechazar(`empaque no existe: ${f.Empaque}`); continue; }
        const fecha = fechaIso(f.Fecha);
        if (!fecha) { rechazar(`fecha ilegible: ${f.Fecha}`); continue; }
        if (!f.Pallet) { rechazar("sin código de polín"); continue; }

        let posicion: string | null = null;
        if (f.Ubicacion) {
          const nuestra = posViejaANuestra.get(f.Ubicacion.toUpperCase());
          if (!nuestra) { rechazar(`ubicación sin traducción: ${f.Ubicacion}`); continue; }
          posicion = nuestra;
          if (!posPorCodigo.has(nuestra)) { rechazar(`posición inexistente: ${nuestra}`); continue; }
        }
        resueltas.push({
          Master: f.Master, Cliente: cliente, Clase: cl.Clase, Proceso: cl.Proceso, Talla: talla,
          Presentacion: pres, Empaque: emp, Lote: f.Lote, Fecha: fecha, Pallet: f.Pallet, Posicion: posicion,
        });
      }

      console.log(`\nResueltas ${resueltas.length} de ${filas.length}.`);
      if (rechazos.size) {
        console.log("Filas NO migradas:");
        for (const [m, n] of [...rechazos].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(6)}  ${m}`);
      }
      if (!resueltas.length) throw new Error("No hay nada que migrar.");

      // ── 5. Pedidos de inventario inicial, uno por cliente ────────────────────────────────────
      const clientes = [...new Set(resueltas.map(r => r.Cliente))].sort((a, b) => a - b);
      for (const c of clientes) {
        const fechaMin = resueltas.filter(r => r.Cliente === c).map(r => r.Fecha).sort()[0];
        await ejecutar(tx,
          `INSERT INTO Pedidos (CodigoPedido, CodigoCliente, CodigoSubcliente, Descripcion, FechaInicio, Estatus, EsGeneral)
           VALUES (?, ?, NULL, ?, ?, 'Proceso', 1)`,
          [`INI-${c}`, c, `Inventario inicial — ${cliPorCodigo.get(c) ?? c}`, fechaMin]);
      }
      resumen.push(`${clientes.length} pedidos de inventario inicial`);

      // ── 6. DetallePedido ─────────────────────────────────────────────────────────────────────
      // La llave única es (CodigoPedido, Proceso, Talla, Presentacion) — Clase NO entra, va
      // denormalizada. Se verificó contra el archivo que ninguna combinación choca.
      const pesos = new Map<string, { kg: number; lb: number }>();
      for (const p of await q(`SELECT Codigo, PesoKG, PesoLb FROM Presentacion`)) {
        pesos.set(p.Codigo, { kg: Number(p.PesoKG), lb: Number(p.PesoLb) });
      }
      const lineas = new Map<string, Res>();
      for (const r of resueltas) lineas.set(`INI-${r.Cliente}|${r.Proceso}|${r.Talla}|${r.Presentacion}`, r);
      await insertarEnBloques(tx, "DetallePedido",
        ["CodigoPedido", "Clase", "Proceso", "Talla", "Presentacion", "EmpaqueMaster", "EmpaqueAccesorio", "CantidadCajas", "KgPedido", "LibrasPedido", "EsGranel", "Activo"],
        [...lineas.values()].map(r => {
          const p = pesos.get(r.Presentacion)!;
          // Centinela de 1 caja: en un pedido general las cantidades no se planifican (ver
          // project_pedido_general_design). EmpaqueMaster 'SM1' porque el archivo solo registró el
          // empaque individual — el master no consta.
          return [`INI-${r.Cliente}`, r.Clase, r.Proceso, r.Talla, r.Presentacion, "SM1", r.Empaque, 1, p.kg, p.lb, 0, 1];
        }));
      const detalleId = new Map<string, number>();
      for (const d of await q(`SELECT DetalleId, CodigoPedido, Proceso, Talla, Presentacion FROM DetallePedido WHERE CodigoPedido LIKE 'INI-%'`)) {
        detalleId.set(`${d.CodigoPedido}|${Number(d.Proceso)}|${Number(d.Talla)}|${d.Presentacion}`, Number(d.DetalleId));
      }
      resumen.push(`${lineas.size} líneas de pedido`);

      // Historial: deja estas líneas indistinguibles de las capturadas a mano en Pedidos.
      await insertarEnBloques(tx, "DetallePedidoHistorial",
        ["DetalleId", "CodigoPedido", "Accion", "Clase", "Proceso", "Talla", "Presentacion", "EmpaqueMaster", "EmpaqueAccesorio", "CantidadCajas", "KgPedido", "LibrasPedido", "EsGranel", "RegistradoPor"],
        [...lineas.values()].map(r => {
          const p = pesos.get(r.Presentacion)!;
          const k = `INI-${r.Cliente}|${r.Proceso}|${r.Talla}|${r.Presentacion}`;
          return [detalleId.get(k), `INI-${r.Cliente}`, "Alta", r.Clase, r.Proceso, r.Talla, r.Presentacion, "SM1", r.Empaque, 1, p.kg, p.lb, 0, OPERADOR];
        }));

      // ── 7. OrdenEtiquetado: una por (línea, lote, fecha) ─────────────────────────────────────
      const ordenes = new Map<string, { det: number; lote: string; fecha: string; n: number }>();
      for (const r of resueltas) {
        const det = detalleId.get(`INI-${r.Cliente}|${r.Proceso}|${r.Talla}|${r.Presentacion}`)!;
        const k = `${det}|${r.Lote}|${r.Fecha}`;
        const e = ordenes.get(k);
        if (e) e.n++;
        else ordenes.set(k, { det, lote: r.Lote, fecha: r.Fecha, n: 1 });
      }
      await insertarEnBloques(tx, "OrdenEtiquetado",
        ["Lote", "PiscinaId", "Ciclo", "DetalleId", "AreaCodigo", "FechaProduccion", "Origen", "Congelacion", "CantidadMaster", "Estatus", "RegistradoPor"],
        [...ordenes.values()].map(o =>
          [o.lote.slice(0, 30), PISCINA_ID, CICLO_MIGRA, o.det, null, o.fecha, ORIGEN_MIGRA, CONGELACION_MIGRA, o.n, ESTATUS_ORDEN_MIGRA, OPERADOR]));
      const ordenId = new Map<string, number>();
      for (const o of await q(`SELECT OrdenId, DetalleId, Lote, FechaProduccion FROM OrdenEtiquetado WHERE Estatus = ?`, ESTATUS_ORDEN_MIGRA)) {
        const f = new Date(o.FechaProduccion).toISOString().slice(0, 10);
        ordenId.set(`${Number(o.DetalleId)}|${o.Lote}|${f}`, Number(o.OrdenId));
      }
      resumen.push(`${ordenes.size} órdenes de etiquetado`);

      // ── 8. EtiquetaImpresa: el correlativo ES el código impreso en la caja ───────────────────
      await insertarEnBloques(tx, "EtiquetaImpresa", ["OrdenId", "Correlativo", "Estatus", "RegistradoPor"],
        resueltas.map(r => {
          const det = detalleId.get(`INI-${r.Cliente}|${r.Proceso}|${r.Talla}|${r.Presentacion}`)!;
          return [ordenId.get(`${det}|${r.Lote.slice(0, 30)}|${r.Fecha}`), r.Master, "Activa", OPERADOR];
        }));
      const etiquetaId = new Map<string, number>();
      for (const e of await q(`SELECT EtiquetaId, Correlativo FROM EtiquetaImpresa WHERE RegistradoPor = ?`, OPERADOR)) {
        etiquetaId.set(String(e.Correlativo), Number(e.EtiquetaId));
      }
      resumen.push(`${resueltas.length} etiquetas (correlativo = código del sistema anterior)`);

      // ── 9. Pallets ──────────────────────────────────────────────────────────────────────────
      // Un polín viejo puede tener varias ubicaciones declaradas en el archivo: el sistema anterior
      // permitía dos polines por posición y el nuestro no (Pallets.PosicionId es UNIQUE). Se le da
      // la posición al polín con más cajas y el otro queda pendiente de ubicar, que es un estado
      // nativo — el operador lo resuelve en piso viendo lo que hay.
      const pallets = new Map<string, { n: number; pos: string | null; fecha: string }>();
      for (const r of resueltas) {
        const e = pallets.get(r.Pallet);
        if (e) { e.n++; if (!e.pos && r.Posicion) e.pos = r.Posicion; }
        else pallets.set(r.Pallet, { n: 1, pos: r.Posicion, fecha: r.Fecha });
      }
      const dueñoDePosicion = new Map<string, string>();
      const desalojados: string[] = [];
      for (const [cod, p] of [...pallets].sort((a, b) => b[1].n - a[1].n)) {
        if (!p.pos) continue;
        if (dueñoDePosicion.has(p.pos)) { desalojados.push(`${cod} (posición ${p.pos} ocupada por ${dueñoDePosicion.get(p.pos)})`); p.pos = null; }
        else dueñoDePosicion.set(p.pos, cod);
      }
      await insertarEnBloques(tx, "Pallets",
        ["Codigo", "Estatus", "Origen", "CantidadMaster", "BodegaVirtualCodigo", "CreadoPor", "CreadoEn", "CerradoPor", "CerradoEn", "PosicionId"],
        [...pallets].map(([cod, p]) => {
          const t = `${p.fecha} 00:00:00`;
          return [cod, "Cerrado", ORIGEN_MIGRA, p.n, BODEGA_VIRTUAL_MIGRA, OPERADOR, t, OPERADOR, t, p.pos ? posPorCodigo.get(p.pos) : null];
        }));
      const palletId = new Map<string, number>();
      for (const p of await q(`SELECT PalletId, Codigo FROM Pallets WHERE BodegaVirtualCodigo = ?`, BODEGA_VIRTUAL_MIGRA)) {
        palletId.set(String(p.Codigo), Number(p.PalletId));
      }
      resumen.push(`${pallets.size} polines (${dueñoDePosicion.size} ubicados, ${pallets.size - dueñoDePosicion.size} pendientes de ubicar)`);

      // ── 10. Masters ─────────────────────────────────────────────────────────────────────────
      await insertarEnBloques(tx, "Masters", ["PalletId", "EtiquetaId", "Estatus", "IngresadoPor", "FechaIngreso"],
        resueltas.map(r => [palletId.get(r.Pallet), etiquetaId.get(r.Master), "EnBodega", OPERADOR, `${r.Fecha} 00:00:00`]));
      resumen.push(`${resueltas.length} masters en bodega`);

      // ── 11. Kardex de ubicación ─────────────────────────────────────────────────────────────
      await insertarEnBloques(tx, "MovimientosBodega",
        ["PalletId", "Tipo", "PosicionOrigenId", "PosicionDestinoId", "Usuario", "Motivo"],
        [...dueñoDePosicion].map(([pos, cod]) =>
          [palletId.get(cod), "INGRESO", null, posPorCodigo.get(pos), OPERADOR, "Migración del inventario del sistema anterior"]));

      // ── 12. Cuadre contra el archivo ────────────────────────────────────────────────────────
      console.log("\n── Cuadre por cliente (contra la base, ya cargado) ──");
      const cuadre = await q(`
        SELECT cli.RazonSocial, COUNT(*) AS Masters,
               ROUND(SUM(pr.PesoKG * pr.CajasXMaster), 2) AS Kilos,
               COUNT(DISTINCT pal.PalletId) AS Polines
        FROM Masters m
        JOIN Pallets pal ON m.PalletId = pal.PalletId
        JOIN EtiquetaImpresa ei ON m.EtiquetaId = ei.EtiquetaId
        JOIN OrdenEtiquetado oe ON ei.OrdenId = oe.OrdenId
        JOIN DetallePedido dp ON oe.DetalleId = dp.DetalleId
        JOIN Presentacion pr ON dp.Presentacion = pr.Codigo
        JOIN Pedidos ped ON dp.CodigoPedido = ped.CodigoPedido
        JOIN Clientes cli ON ped.CodigoCliente = cli.Codigo
        WHERE pal.BodegaVirtualCodigo = ?
        GROUP BY cli.RazonSocial ORDER BY Masters DESC`, BODEGA_VIRTUAL_MIGRA);
      const espera = new Map<number, number>();
      for (const r of resueltas) espera.set(r.Cliente, (espera.get(r.Cliente) ?? 0) + 1);
      let totalM = 0, totalK = 0;
      for (const c of cuadre) {
        totalM += Number(c.Masters); totalK += Number(c.Kilos);
        console.log(`   ${String(c.Masters).padStart(6)} masters  ${String(c.Polines).padStart(4)} pol  ${String(Number(c.Kilos).toFixed(2)).padStart(12)} kg   ${c.RazonSocial}`);
      }
      console.log(`   ${String(totalM).padStart(6)} masters  ${String(pallets.size).padStart(4)} pol  ${totalK.toFixed(2).padStart(12)} kg   TOTAL`);
      if (totalM !== resueltas.length) throw new Error(`CUADRE ROTO: la base tiene ${totalM} masters y se resolvieron ${resueltas.length}`);

      if (desalojados.length) {
        console.log(`\n${desalojados.length} polín(es) quedaron sin posición por choque (el sistema viejo permitía dos por posición):`);
        for (const d of desalojados) console.log(`   ${d}`);
      }

      console.log("\n" + resumen.map(r => "   · " + r).join("\n"));
      if (!COMMIT) throw new Revertir();
    }, { timeout: 1_800_000, maxWait: 120_000 });

    console.log("\nMIGRACIÓN COMPROMETIDA.");
  } catch (e) {
    if (e instanceof Revertir) {
      console.log("\nENSAYO: todo lo anterior se revirtió, la base quedó igual. Corre con --commit para escribir.");
    } else throw e;
  }
  await prisma.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
