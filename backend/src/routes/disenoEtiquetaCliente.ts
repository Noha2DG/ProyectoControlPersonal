// Qué diseño de BarTender (.btw) le toca a cada cliente/subcliente. Ver el encabezado de
// scripts/createDisenoEtiquetaCliente.ts para por qué la llave incluye al subcliente.
//
// El navegador NO puede entregar la ruta real de un archivo: <input type="file"> la falsea como
// "C:\fakepath\archivo.btw" por seguridad. Por eso el explorador no se abre en el cliente — el
// backend lista una carpeta configurada (BTW_CARPETA) y la pantalla ofrece esos archivos. Así la
// ruta que se guarda siempre existe y siempre es alcanzable.
//
// BTW_CARPETA conviene que sea una ruta UNC (\\servidor\etiquetas) y no una letra de unidad
// mapeada: la PC de BarTender es la que abre el .btw, y una letra mapeada puede apuntar a otro
// lugar (o a nada) en esa máquina.

import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import path from "node:path";
import fs from "node:fs/promises";
import prisma from "../lib/prisma.ts";
import { requireAuth, requirePerm } from "../middleware/auth.ts";

const router = Router();

// Subcarpetas por cliente como las tenía el sistema anterior (INDUPECASA, PEDIDO GENERAL, …), pero
// sin dejar que un árbol accidentalmente enorme cuelgue la pantalla.
const PROFUNDIDAD_MAX = 3;

function getOperador(req: Request): string {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return "Sistema";
    const payload: any = jwt.verify(header.slice(7), process.env.JWT_SECRET!);
    return payload.nombre ?? payload.username ?? "Sistema";
  } catch {
    return "Sistema";
  }
}

// En producción el backend corre en kronos (servidor en internet) y los .btw viven en un recurso
// compartido de la oficina, así que NO puede listarlos: SMB no cruza. En desarrollo sí los ve,
// porque el backend corre en la misma PC. La pantalla se adapta a los dos casos — con carpeta
// legible ofrece la lista, y sin ella deja escribir la ruta a mano. Por eso esto informa el estado
// en vez de reventar.
async function estadoCarpeta(): Promise<{ Carpeta: string | null; Legible: boolean; Motivo?: string }> {
  const carpeta = process.env.BTW_CARPETA || null;
  if (!carpeta) {
    return { Carpeta: null, Legible: false, Motivo: "BTW_CARPETA no está configurada en el servidor." };
  }
  try {
    await fs.access(carpeta);
    return { Carpeta: carpeta, Legible: true };
  } catch {
    return {
      Carpeta: carpeta,
      Legible: false,
      Motivo: `El servidor no alcanza ${carpeta}. Escribe la ruta completa del .btw tal como la ve la PC de BarTender.`,
    };
  }
}

// Cuando no se puede comprobar que el archivo exista, al menos se exige que la ruta tenga forma de
// ruta absoluta de Windows (C:\... o \\servidor\recurso\...) y termine en .btw. Una ruta relativa o
// un nombre suelto no le sirve a BarTender.
function formatoRutaValido(ruta: string): boolean {
  if (!/\.btw$/i.test(ruta.trim())) return false;
  return /^([a-zA-Z]:[\\/]|\\\\[^\\/]+[\\/])/.test(ruta.trim());
}

async function listarBtw(raiz: string, relativo = "", nivel = 0): Promise<{ Ruta: string; Nombre: string; Carpeta: string }[]> {
  if (nivel > PROFUNDIDAD_MAX) return [];
  const dir = path.join(raiz, relativo);
  const entradas = await fs.readdir(dir, { withFileTypes: true });
  const encontrados: { Ruta: string; Nombre: string; Carpeta: string }[] = [];
  for (const entrada of entradas) {
    const rel = path.join(relativo, entrada.name);
    if (entrada.isDirectory()) {
      encontrados.push(...await listarBtw(raiz, rel, nivel + 1));
    } else if (entrada.name.toLowerCase().endsWith(".btw")) {
      encontrados.push({
        Ruta: path.join(raiz, rel),      // ruta completa: es la que consume BarTender
        Nombre: entrada.name,
        Carpeta: relativo || ".",
      });
    }
  }
  return encontrados;
}

// Solo se aceptan rutas que caigan DENTRO de BTW_CARPETA — evita que alguien guarde por API una
// ruta arbitraria del servidor y BarTender termine abriendo un archivo que no le corresponde.
function rutaDentroDeCarpeta(ruta: string, carpeta: string): boolean {
  const raiz = path.resolve(carpeta);
  const destino = path.resolve(ruta);
  return destino === raiz || destino.startsWith(raiz + path.sep);
}

/** Diseño que le toca a un pedido: primero el arte propio del subcliente, y si no tiene, el
 *  diseño por defecto del cliente (fila con CodigoSubcliente = ''). Devuelve null si no hay
 *  ninguno asignado — quien llame decide si eso es un error o solo "todavía no configurado". */
export async function resolverRutaBtw(codigoCliente: number, codigoSubcliente?: string | null): Promise<string | null> {
  const rows: any[] = await prisma.$queryRaw`
    SELECT RutaBtw, CodigoSubcliente FROM DisenoEtiquetaCliente
    WHERE CodigoCliente = ${Number(codigoCliente)}
      AND CodigoSubcliente IN (${codigoSubcliente ?? ""}, '')
    ORDER BY CodigoSubcliente DESC
    LIMIT 1
  `;
  return rows[0]?.RutaBtw ?? null;
}

// GET /api/diseno-etiqueta-cliente/archivos — .btw disponibles en la carpeta configurada
router.get("/archivos", requireAuth, requirePerm("etiquetado", "imprimir"), async (_req: Request, res: Response) => {
  try {
    const estado = await estadoCarpeta();
    if (!estado.Legible) { res.json({ ...estado, Archivos: [] }); return; }
    const archivos = await listarBtw(estado.Carpeta!);
    archivos.sort((a, b) => a.Carpeta.localeCompare(b.Carpeta) || a.Nombre.localeCompare(b.Nombre));
    res.json({ ...estado, Archivos: archivos });
  } catch (err: any) {
    // La carpeta existía al comprobarla pero falló al recorrerla (permisos, red que se cayó a
    // media lectura). Se responde como "no legible" para que la pantalla ofrezca escribir la ruta
    // en vez de dejar al usuario sin salida.
    res.json({
      Carpeta: process.env.BTW_CARPETA || null,
      Legible: false,
      Motivo: `No se pudo leer la carpeta: ${err.message}`,
      Archivos: [],
    });
  }
});

// GET /api/diseno-etiqueta-cliente?cliente=10 — asignaciones de un cliente (o todas si no se pasa)
router.get("/", requireAuth, requirePerm("etiquetado", "imprimir"), async (req: Request, res: Response) => {
  try {
    const cliente = req.query.cliente ? Number(req.query.cliente) : undefined;
    const rows: any[] = cliente
      ? await prisma.$queryRaw`
          SELECT CodigoCliente, CodigoSubcliente, RutaBtw, ActualizadoPor, ActualizadoEn
          FROM DisenoEtiquetaCliente WHERE CodigoCliente = ${cliente} ORDER BY CodigoSubcliente ASC`
      : await prisma.$queryRaw`
          SELECT CodigoCliente, CodigoSubcliente, RutaBtw, ActualizadoPor, ActualizadoEn
          FROM DisenoEtiquetaCliente ORDER BY CodigoCliente ASC, CodigoSubcliente ASC`;
    res.json(rows.map(r => ({ ...r, CodigoCliente: Number(r.CodigoCliente) })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/diseno-etiqueta-cliente  { CodigoCliente, CodigoSubcliente?, RutaBtw }
router.put("/", requireAuth, requirePerm("etiquetado", "editar"), async (req: Request, res: Response) => {
  try {
    const { CodigoCliente, CodigoSubcliente, RutaBtw } = req.body;
    if (!CodigoCliente || !RutaBtw) {
      res.status(400).json({ error: "CodigoCliente y RutaBtw son requeridos" });
      return;
    }
    // Con carpeta legible se valida de verdad (que caiga dentro y que el archivo exista). Sin
    // ella —producción, donde el servidor no alcanza el recurso de la oficina— solo se puede
    // validar la forma: quien escribe la ruta es responsable de que sea la correcta.
    const estado = await estadoCarpeta();
    if (estado.Legible) {
      if (!rutaDentroDeCarpeta(RutaBtw, estado.Carpeta!)) {
        res.status(400).json({ error: "La ruta no pertenece a la carpeta de diseños configurada" });
        return;
      }
      try {
        await fs.access(RutaBtw);
      } catch {
        res.status(400).json({ error: "Ese archivo .btw ya no existe en la carpeta — actualiza la lista" });
        return;
      }
    } else if (!formatoRutaValido(RutaBtw)) {
      res.status(400).json({
        error: "La ruta debe ser absoluta y terminar en .btw — por ejemplo \\\\servidor\\etiquetas\\arte.btw",
      });
      return;
    }
    const sub = String(CodigoSubcliente ?? "");
    const operador = getOperador(req);
    await prisma.$executeRaw`
      INSERT INTO DisenoEtiquetaCliente (CodigoCliente, CodigoSubcliente, RutaBtw, ActualizadoPor)
      VALUES (${Number(CodigoCliente)}, ${sub}, ${String(RutaBtw)}, ${operador})
      ON DUPLICATE KEY UPDATE RutaBtw = VALUES(RutaBtw), ActualizadoPor = VALUES(ActualizadoPor)
    `;
    res.json({ ok: true });
  } catch (err: any) {
    if (err.message?.includes("foreign key")) { res.status(400).json({ error: "El cliente no existe" }); return; }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/diseno-etiqueta-cliente/:cliente/:subcliente — quitar la asignación
// El subcliente vacío (diseño por defecto del cliente) se borra con :subcliente = "-"
router.delete("/:cliente/:subcliente", requireAuth, requirePerm("etiquetado", "editar"), async (req: Request, res: Response) => {
  try {
    const sub = req.params.subcliente === "-" ? "" : req.params.subcliente;
    await prisma.$executeRaw`
      DELETE FROM DisenoEtiquetaCliente
      WHERE CodigoCliente = ${Number(req.params.cliente)} AND CodigoSubcliente = ${sub}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
