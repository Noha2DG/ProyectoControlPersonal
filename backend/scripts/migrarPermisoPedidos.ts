// Respaldo de permisos para la salida de Pedidos/Clientes/Subcliente de `catalogos` al módulo
// propio `pedidos`.
//
// Por qué hace falta: hasPerm() devuelve false para un módulo que no conoce (App.jsx). Si el código
// sube sin esto, a quien hoy administra pedidos le desaparece el menú sin ningún error visible —
// simplemente deja de existir.
//
// Cubre los dos escenarios, y por eso puede correrse en cualquier base:
//   1. `comercial` → `pedidos`   (el módulo se llamó `comercial` unas horas el 11 ago 2026; producción
//                                 alcanzó a quedar con esa llave y hay que renombrarla)
//   2. `catalogos` → `pedidos`   (base que nunca vio `comercial`: copia lo que la persona ya tenía)
//
// El caso 2 es ADITIVO: no le quita `catalogos` a nadie. Quién deba conservar los catálogos de
// producción es decisión de negocio y se ajusta desde la pantalla de Usuarios.
//
// CORRERLO ANTES DE DESPLEGAR el código nuevo. Idempotente: si ya existe `pedidos`, no lo toca.
//
// Uso:
//   npx tsx scripts/migrarPermisoPedidos.ts               → simulacro
//   npx tsx scripts/migrarPermisoPedidos.ts --confirmar
//
// OJO: backend/.env apunta a PRODUCCIÓN.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CONFIRMAR = process.argv.includes("--confirmar");
const ACCIONES = ["ver", "crear", "editar", "eliminar"] as const;

async function main() {
  console.log(CONFIRMAR ? "MODO REAL\n" : "SIMULACRO — no se guarda nada (agregá --confirmar)\n");

  const usuarios: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, username, permisos FROM Usuarios ORDER BY username`);

  let renombrados = 0, copiados = 0, saltados = 0, noAplican = 0;

  for (const u of usuarios) {
    // permisos NULL = admin heredado, sin lista explícita: requirePerm lo deja pasar por rol, así
    // que no hay nada que migrar (ver middleware/auth.ts).
    if (u.permisos == null) { noAplican++; continue; }

    let permisos: any;
    try {
      permisos = typeof u.permisos === "string" ? JSON.parse(u.permisos) : u.permisos;
    } catch {
      console.log(`  ! ${u.username}: permisos ilegibles, se omite`);
      continue;
    }

    let accion: string | null = null;

    if (permisos.pedidos) {
      // Ya migrado. Si además arrastra `comercial`, se limpia para no dejar basura en el JSON.
      if (permisos.comercial) {
        delete permisos.comercial;
        accion = `ya tenía pedidos — se quita el 'comercial' sobrante`;
      } else {
        saltados++;
        continue;
      }
    } else if (permisos.comercial) {
      permisos.pedidos = permisos.comercial;
      delete permisos.comercial;
      accion = `comercial[${Object.keys(permisos.pedidos).join("/")}] → pedidos`;
      renombrados++;
    } else {
      const cat = permisos.catalogos;
      if (!cat || !ACCIONES.some(a => cat[a])) { noAplican++; continue; }
      const nuevo: Record<string, boolean> = {};
      for (const a of ACCIONES) if (cat[a]) nuevo[a] = true;
      permisos.pedidos = nuevo;
      accion = `catalogos[${Object.keys(nuevo).join("/")}] → pedidos (copia)`;
      copiados++;
    }

    console.log(`  + ${String(u.username).padEnd(14)} ${accion}`);
    if (CONFIRMAR) {
      await prisma.$executeRawUnsafe(
        `UPDATE Usuarios SET permisos = ? WHERE id = ?`, JSON.stringify(permisos), Number(u.id));
    }
  }

  console.log(`\n${renombrados} renombrado(s) desde comercial · ${copiados} copiado(s) desde catalogos` +
              ` · ${saltados} ya estaban · ${noAplican} no aplican`);

  if (CONFIRMAR) {
    const conPedidos: any[] = await prisma.$queryRawUnsafe(
      `SELECT username FROM Usuarios WHERE permisos LIKE '%"pedidos"%' ORDER BY username`);
    const conComercial: any[] = await prisma.$queryRawUnsafe(
      `SELECT username FROM Usuarios WHERE permisos LIKE '%"comercial"%'`);
    console.log(`\nVerificación`);
    console.log(`  con 'pedidos':   ${conPedidos.map(v => v.username).join(", ") || "ninguno"}`);
    console.log(`  con 'comercial': ${conComercial.map(v => v.username).join(", ") || "ninguno (correcto)"}`);
  }

  await prisma.$disconnect();
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
