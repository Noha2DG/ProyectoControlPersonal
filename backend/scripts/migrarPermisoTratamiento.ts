// Da el permiso nuevo `tratamiento` a quien hoy tiene `descongelado`, con las mismas acciones.
//
// Por qué hace falta: hasPerm() devuelve false para un módulo que no conoce (App.jsx). Sin esto, el
// menú de Tratamiento no le aparece a nadie salvo a los administradores sin lista de permisos. Es
// ADITIVO: no le quita nada a nadie; quién más deba entrar se ajusta desde la pantalla de Usuarios.
//
// CORRERLO ANTES DE DESPLEGAR. Idempotente: si alguien ya tiene `tratamiento`, no lo toca.
//
//   npx tsx scripts/migrarPermisoTratamiento.ts               → simulacro
//   npx tsx scripts/migrarPermisoTratamiento.ts --confirmar
//
// OJO: backend/.env apunta a PRODUCCIÓN.
import "dotenv/config";
import prisma from "../src/lib/prisma.ts";

const CONFIRMAR = process.argv.includes("--confirmar");
const ACCIONES = ["ver", "crear", "editar", "eliminar", "cerrar"] as const;

async function main() {
  console.log(CONFIRMAR ? "MODO REAL\n" : "SIMULACRO — no se guarda nada (agregue --confirmar)\n");
  const usuarios: any[] = await prisma.$queryRawUnsafe(`SELECT id, username, permisos FROM Usuarios ORDER BY username`);
  let dados = 0, ya = 0, noAplican = 0;
  for (const u of usuarios) {
    if (u.permisos == null) { noAplican++; continue; }   // admin heredado: entra por rol
    let permisos: any;
    try { permisos = typeof u.permisos === "string" ? JSON.parse(u.permisos) : u.permisos; }
    catch { console.log(`  ! ${u.username}: permisos ilegibles, se omite`); continue; }
    if (permisos.tratamiento) { ya++; continue; }
    const d = permisos.descongelado;
    if (!d || !ACCIONES.some(a => d[a])) { noAplican++; continue; }
    const nuevo: Record<string, boolean> = {};
    for (const a of ACCIONES) if (d[a]) nuevo[a] = true;
    permisos.tratamiento = nuevo;
    console.log(`  + ${String(u.username).padEnd(14)} descongelado[${Object.keys(nuevo).join("/")}] → tratamiento`);
    dados++;
    if (CONFIRMAR) {
      await prisma.$executeRawUnsafe(`UPDATE Usuarios SET permisos = ? WHERE id = ?`, JSON.stringify(permisos), Number(u.id));
    }
  }
  console.log(`\n${dados} con permiso nuevo · ${ya} ya lo tenían · ${noAplican} no aplican`);
}

main()
  .catch(e => { console.error("ERROR:", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
