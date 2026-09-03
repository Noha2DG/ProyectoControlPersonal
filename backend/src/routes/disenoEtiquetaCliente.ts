// Qué diseños de BarTender (.btw) le tocan a cada cliente/subcliente. Ver el encabezado de
// scripts/createDisenoEtiquetaCliente.ts para por qué la llave incluye al subcliente, y el de
// scripts/alterDisenoEtiquetaMultiple.ts para por qué desde el 26 ago 2026 son VARIOS por
// subcliente y no uno solo.
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
// path.win32 y NO el `path` del sistema: estas rutas son SIEMPRE de Windows —las abre BarTender en
// una PC— pero el backend corre en Linux, donde `\` no es separador. Ahi path.resolve convertia
// "\\servidor\Etiquetas\arte.btw" en UN solo nombre de archivo colgado del directorio actual, asi que
// NINGUNA ruta real caia dentro de la carpeta y se rechazaban todas, la valida incluida. La variante
// win32 entiende UNC y unidades igual en los dos sistemas, y conserva el colapso de ".." que impide
// salirse de la carpeta autorizada. En Windows `path` YA es path.win32, asi que en desarrollo no cambia nada.
function rutaDentroDeCarpeta(ruta: string, carpeta: string): boolean {
  const raiz = path.win32.resolve(carpeta);
  const destino = path.win32.resolve(ruta);
  return destino === raiz || destino.startsWith(raiz + path.win32.sep);
}

/** Nombre legible por omisión de un .btw: "C:\Etiquetas\GENERAL\master.btw" → "master". */
export function nombreDeRuta(ruta: string): string {
  const archivo = String(ruta).split(/[\\/]/).pop() || String(ruta);
  return archivo.replace(/\.btw$/i, "").trim() || archivo;
}

/** Diseños que le tocan a un pedido, ya ordenados como deben ofrecerse (el predeterminado primero).
 *
 *  La herencia es la de siempre, solo que ahora devuelve lista: si el SUBCLIENTE tiene arte propio
 *  se usa ESE conjunto y el del cliente no aplica; solo cuando el subcliente no tiene nada se cae a
 *  las filas con CodigoSubcliente = ''. Mezclar los dos le ofrecería al operador artes que no son
 *  de ese subcliente, que es justo lo que la llave con subcliente vino a evitar.
 *
 *  Lista vacía = todavía no configurado; quien llame decide si eso es un error. */
export async function resolverDisenos(codigoCliente: number, codigoSubcliente?: string | null) {
  const rows: any[] = await prisma.$queryRaw`
    SELECT DisenoId, Nombre, RutaBtw, EsPredeterminado, CodigoSubcliente
    FROM DisenoEtiquetaCliente
    WHERE CodigoCliente = ${Number(codigoCliente)} AND Activo = 1
      AND CodigoSubcliente IN (${codigoSubcliente ?? ""}, '')
    ORDER BY EsPredeterminado DESC, Nombre ASC
  `;
  const propios = rows.filter(r => String(r.CodigoSubcliente) !== "");
  const aplican = propios.length ? propios : rows;
  return aplican.map(r => ({
    DisenoId: Number(r.DisenoId),
    Nombre: r.Nombre,
    RutaBtw: r.RutaBtw,
    Archivo: nombreDeRuta(r.RutaBtw),
    EsPredeterminado: Number(r.EsPredeterminado) === 1,
    Heredado: String(r.CodigoSubcliente) === "" && String(codigoSubcliente ?? "") !== "",
  }));
}

/** El diseño con el que se va a imprimir.
 *
 *  Con disenoId se exige que sea uno de los que le tocan a ese cliente/subcliente: la pantalla
 *  manda el ID y NUNCA la ruta, porque una ruta que venga del navegador haría que BarTender abra
 *  el archivo que quiera cualquiera con sesión. Sin disenoId se usa el predeterminado, que es el
 *  camino de siempre cuando hay uno solo. */
export async function resolverDiseno(
  codigoCliente: number, codigoSubcliente: string | null | undefined, disenoId?: number | null,
) {
  const disenos = await resolverDisenos(codigoCliente, codigoSubcliente);
  if (!disenos.length) return null;
  if (disenoId) return disenos.find(d => d.DisenoId === Number(disenoId)) ?? null;
  return disenos.find(d => d.EsPredeterminado) ?? disenos[0];
}

/** Deja UN solo predeterminado por (cliente, subcliente). MariaDB no tiene índices únicos
 *  parciales, así que la regla no se puede exigir en el esquema: se cuida aquí, siempre dentro de
 *  la misma transacción que la escritura que la provocó. */
async function marcarPredeterminado(tx: any, disenoId: number, cliente: number, sub: string) {
  await tx.$executeRaw`
    UPDATE DisenoEtiquetaCliente SET EsPredeterminado = 0
    WHERE CodigoCliente = ${cliente} AND CodigoSubcliente = ${sub} AND DisenoId <> ${disenoId}
  `;
  await tx.$executeRaw`
    UPDATE DisenoEtiquetaCliente SET EsPredeterminado = 1 WHERE DisenoId = ${disenoId}
  `;
}

/** Con carpeta legible se valida de verdad (que la ruta caiga dentro y que el archivo exista); sin
 *  ella —producción, donde el servidor no alcanza el recurso de la oficina— solo se puede validar
 *  la forma. Devuelve el mensaje de error, o null si la ruta sirve. */
async function validarRuta(RutaBtw: string): Promise<string | null> {
  const estado = await estadoCarpeta();
  if (estado.Legible) {
    if (!rutaDentroDeCarpeta(RutaBtw, estado.Carpeta!)) {
      return "La ruta no pertenece a la carpeta de diseños configurada";
    }
    try {
      await fs.access(RutaBtw);
    } catch {
      return "Ese archivo .btw ya no existe en la carpeta — actualiza la lista";
    }
    return null;
  }
  if (!formatoRutaValido(RutaBtw)) {
    return "La ruta debe ser absoluta y terminar en .btw — por ejemplo \\\\servidor\\etiquetas\\arte.btw";
  }
  // Aunque el servidor no ALCANCE la carpeta, si sabe cuál es exige que la ruta caiga dentro. Antes
  // aquí solo se validaba la forma, y por ahí entró un "E:\Etiquetas\..." que ninguna estación podía
  // abrir: el error salía recién al imprimir, con el operador esperando frente a la impresora. No
  // poder comprobar que el archivo existe no es motivo para no comprobar el prefijo.
  if (estado.Carpeta && !rutaDentroDeCarpeta(RutaBtw, estado.Carpeta)) {
    return `La ruta debe estar dentro de ${estado.Carpeta} — es la única carpeta que las estaciones tienen autorizada.`;
  }
  return null;
}

function esDuplicado(err: any): boolean {
  const mensaje = String(err?.meta?.message ?? err?.message ?? "");
  return /uq_diseno_ruta/i.test(mensaje) || /duplicate entry/i.test(mensaje);
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

// GET /api/diseno-etiqueta-cliente?cliente=10 — diseños de un cliente (o todos si no se pasa)
router.get("/", requireAuth, requirePerm("etiquetado", "imprimir"), async (req: Request, res: Response) => {
  try {
    const cliente = req.query.cliente ? Number(req.query.cliente) : undefined;
    const rows: any[] = cliente
      ? await prisma.$queryRaw`
          SELECT DisenoId, CodigoCliente, CodigoSubcliente, Nombre, RutaBtw, EsPredeterminado, Activo,
                 ActualizadoPor, ActualizadoEn
          FROM DisenoEtiquetaCliente WHERE CodigoCliente = ${cliente}
          ORDER BY CodigoSubcliente ASC, EsPredeterminado DESC, Nombre ASC`
      : await prisma.$queryRaw`
          SELECT DisenoId, CodigoCliente, CodigoSubcliente, Nombre, RutaBtw, EsPredeterminado, Activo,
                 ActualizadoPor, ActualizadoEn
          FROM DisenoEtiquetaCliente
          ORDER BY CodigoCliente ASC, CodigoSubcliente ASC, EsPredeterminado DESC, Nombre ASC`;
    res.json(rows.map(r => ({
      ...r,
      DisenoId: Number(r.DisenoId),
      CodigoCliente: Number(r.CodigoCliente),
      EsPredeterminado: Number(r.EsPredeterminado) === 1,
      Activo: Number(r.Activo) === 1,
      Archivo: nombreDeRuta(r.RutaBtw),
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/diseno-etiqueta-cliente  { CodigoCliente, CodigoSubcliente?, Nombre?, RutaBtw, EsPredeterminado? }
// Agrega un diseño más a la lista de ese cliente/subcliente.
router.post("/", requireAuth, requirePerm("etiquetado", "editar"), async (req: Request, res: Response) => {
  try {
    const { CodigoCliente, CodigoSubcliente, Nombre, RutaBtw, EsPredeterminado } = req.body;
    if (!CodigoCliente || !RutaBtw) {
      res.status(400).json({ error: "CodigoCliente y RutaBtw son requeridos" });
      return;
    }
    const error = await validarRuta(String(RutaBtw));
    if (error) { res.status(400).json({ error }); return; }

    const cliente = Number(CodigoCliente);
    const sub = String(CodigoSubcliente ?? "");
    const nombre = String(Nombre ?? "").trim() || nombreDeRuta(String(RutaBtw));
    const operador = getOperador(req);

    const disenoId = await prisma.$transaction(async tx => {
      await tx.$executeRaw`
        INSERT INTO DisenoEtiquetaCliente (CodigoCliente, CodigoSubcliente, Nombre, RutaBtw, ActualizadoPor)
        VALUES (${cliente}, ${sub}, ${nombre}, ${String(RutaBtw)}, ${operador})
      `;
      const filas: any[] = await tx.$queryRaw`SELECT LAST_INSERT_ID() AS id`;
      const id = Number(filas[0].id);

      // El primero de su grupo queda como predeterminado lo pida o no quien lo crea: un grupo sin
      // predeterminado dejaría a la impresión sin cuál abrir cuando hay uno solo, que es el caso
      // de casi todos los clientes.
      const cuantos: any[] = await tx.$queryRaw`
        SELECT COUNT(*) AS n FROM DisenoEtiquetaCliente
        WHERE CodigoCliente = ${cliente} AND CodigoSubcliente = ${sub}
      `;
      if (EsPredeterminado === true || Number(cuantos[0].n) === 1) {
        await marcarPredeterminado(tx, id, cliente, sub);
      }
      return id;
    }, { timeout: 30_000 });

    res.status(201).json({ ok: true, DisenoId: disenoId });
  } catch (err: any) {
    if (esDuplicado(err)) { res.status(400).json({ error: "Ese mismo archivo ya está asignado aquí" }); return; }
    if (err.message?.includes("foreign key")) { res.status(400).json({ error: "El cliente no existe" }); return; }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/diseno-etiqueta-cliente/:id  { Nombre?, RutaBtw?, Activo? }
router.put("/:id", requireAuth, requirePerm("etiquetado", "editar"), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const actual: any[] = await prisma.$queryRaw`
      SELECT DisenoId, CodigoCliente, CodigoSubcliente, Nombre, RutaBtw, EsPredeterminado
      FROM DisenoEtiquetaCliente WHERE DisenoId = ${id} LIMIT 1
    `;
    if (!actual.length) { res.status(404).json({ error: "Diseño no encontrado" }); return; }

    const ruta = req.body.RutaBtw != null ? String(req.body.RutaBtw) : String(actual[0].RutaBtw);
    if (ruta !== actual[0].RutaBtw) {
      const error = await validarRuta(ruta);
      if (error) { res.status(400).json({ error }); return; }
    }
    const nombre = String(req.body.Nombre ?? actual[0].Nombre).trim() || nombreDeRuta(ruta);
    const activo = req.body.Activo === false || req.body.Activo === 0 ? 0 : 1;
    const cliente = Number(actual[0].CodigoCliente);
    const sub = String(actual[0].CodigoSubcliente);

    await prisma.$transaction(async tx => {
      await tx.$executeRaw`
        UPDATE DisenoEtiquetaCliente
           SET Nombre = ${nombre}, RutaBtw = ${ruta}, Activo = ${activo}, ActualizadoPor = ${getOperador(req)}
         WHERE DisenoId = ${id}
      `;
      // Retirar el predeterminado dejaría al grupo sin cuál usar: el mando pasa al primero que siga
      // activo antes de apagarlo.
      if (activo === 0 && Number(actual[0].EsPredeterminado) === 1) {
        await tx.$executeRaw`UPDATE DisenoEtiquetaCliente SET EsPredeterminado = 0 WHERE DisenoId = ${id}`;
        const otro: any[] = await tx.$queryRaw`
          SELECT DisenoId FROM DisenoEtiquetaCliente
          WHERE CodigoCliente = ${cliente} AND CodigoSubcliente = ${sub} AND Activo = 1 AND DisenoId <> ${id}
          ORDER BY DisenoId ASC LIMIT 1
        `;
        if (otro.length) await marcarPredeterminado(tx, Number(otro[0].DisenoId), cliente, sub);
      }
    }, { timeout: 30_000 });

    res.json({ ok: true });
  } catch (err: any) {
    if (esDuplicado(err)) { res.status(400).json({ error: "Ese mismo archivo ya está asignado aquí" }); return; }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/diseno-etiqueta-cliente/:id/predeterminado — cuál se usa sin preguntar
router.put("/:id/predeterminado", requireAuth, requirePerm("etiquetado", "editar"), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const actual: any[] = await prisma.$queryRaw`
      SELECT CodigoCliente, CodigoSubcliente, Activo FROM DisenoEtiquetaCliente WHERE DisenoId = ${id} LIMIT 1
    `;
    if (!actual.length) { res.status(404).json({ error: "Diseño no encontrado" }); return; }
    if (Number(actual[0].Activo) !== 1) {
      res.status(400).json({ error: "Un diseño retirado no puede ser el predeterminado" });
      return;
    }

    await prisma.$transaction(async tx => {
      await marcarPredeterminado(tx, id, Number(actual[0].CodigoCliente), String(actual[0].CodigoSubcliente));
    }, { timeout: 30_000 });

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/diseno-etiqueta-cliente/:id — quitar un diseño de la lista
router.delete("/:id", requireAuth, requirePerm("etiquetado", "editar"), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const actual: any[] = await prisma.$queryRaw`
      SELECT CodigoCliente, CodigoSubcliente, EsPredeterminado FROM DisenoEtiquetaCliente WHERE DisenoId = ${id} LIMIT 1
    `;
    if (!actual.length) { res.json({ ok: true }); return; }
    const cliente = Number(actual[0].CodigoCliente);
    const sub = String(actual[0].CodigoSubcliente);

    await prisma.$transaction(async tx => {
      await tx.$executeRaw`DELETE FROM DisenoEtiquetaCliente WHERE DisenoId = ${id}`;
      // Si el que se fue era el predeterminado, el mando pasa al primero que quede: si no, el grupo
      // se quedaría con varios diseños y ninguno elegido por omisión.
      if (Number(actual[0].EsPredeterminado) === 1) {
        const otro: any[] = await tx.$queryRaw`
          SELECT DisenoId FROM DisenoEtiquetaCliente
          WHERE CodigoCliente = ${cliente} AND CodigoSubcliente = ${sub} AND Activo = 1
          ORDER BY DisenoId ASC LIMIT 1
        `;
        if (otro.length) await marcarPredeterminado(tx, Number(otro[0].DisenoId), cliente, sub);
      }
    }, { timeout: 30_000 });

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
