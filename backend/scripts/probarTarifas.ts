// Pruebas de las reglas de vigencia de tarifas (backend/src/lib/tarifas.ts) contra la base real,
// dentro de UNA transacción que siempre se revierte. Supone la carga de createTarifas.ts con PD_TON
// sin aprobar. Uso: npx tsx backend/scripts/probarTarifas.ts
import prisma from "../src/lib/prisma";
import * as T from "../src/lib/tarifas";
let fallas = 0;
const ok = (c: boolean, m: string) => { console.log((c ? "OK   " : "FALLA") + " " + m); if (!c) fallas++; };
async function err(f: () => Promise<any>, m: string) { try { await f(); ok(false, m + " (no dio error)"); } catch (e: any) { ok(e instanceof T.ErrorTarifa, m + " → " + e.message); } }
const HOJA = (k: number) => [{ Talla: 311, Tarifa: 0.59 * k }, { Talla: 217, Tarifa: 0.81 * k }];
class Revertir extends Error {}
(async () => {
  const huella = async () => JSON.stringify(await prisma.$queryRaw`SELECT VersionId, Estado, VigenteHasta FROM TarifaVersion ORDER BY VersionId`);
  const antes = await huella();
  try {
    await prisma.$transaction(async tx => {
      const tar = (c: string, t: number, f: string) => T.tarifaAplicable(tx, c, t, f);
      const v1: any[] = await tx.$queryRaw`SELECT VersionId FROM TarifaVersion WHERE Grupo='PD_TON'`;
      const id1 = Number(v1[0].VersionId);
      ok((await tar("E40", 311, "2026-10-08")) === null, "borrador no cobra: E40 sin tarifa");
      await T.aprobarVersion(tx, id1, "prueba");
      ok((await tar("E40", 311, "2026-10-08"))?.Tarifa === 0.59, "aprobada: E40 16/20 = 0.59");
      ok((await tar("E40", 311, "2026-09-30")) === null, "antes del 1 oct: sin tarifa");
      ok((await tar("E41", 311, "2026-10-08")) === null, "E41 es de PD_TOFF (aún borrador): sin tarifa");
      ok((await tar("E40", 371, "2026-10-08")) === null, "talla 130/150 fuera de la hoja: sin tarifa");

      const nov = await T.guardarBorrador(tx, { Grupo: "PD_TON", VigenteDesde: "2026-11-01", detalle: HOJA(2) }, "prueba");
      await T.aprobarVersion(tx, nov, "prueba");
      ok((await tar("E40", 311, "2026-10-31"))?.Tarifa === 0.59, "31 oct sigue la vieja");
      ok((await tar("E40", 311, "2026-11-01"))?.Tarifa === 1.18, "1 nov la nueva (1.18)");
      ok((await tar("E40", 336, "2026-11-01")) === null, "talla que la versión nueva no trae: sin tarifa");

      const dic = await T.guardarBorrador(tx, { Grupo: "PD_TON", VigenteDesde: "2026-12-01", VigenteHasta: "2026-12-31", detalle: HOJA(3) }, "prueba");
      const cambios = await T.aprobarVersion(tx, dic, "prueba");
      ok(cambios.length === 2, "temporada partió la de noviembre: " + cambios.join(" | "));
      ok(Math.abs((await tar("E40", 311, "2026-12-15"))!.Tarifa - 1.77) < 1e-9, "15 dic temporada (1.77)");
      ok((await tar("E40", 311, "2027-01-05"))?.Tarifa === 1.18, "5 ene regresa a la de noviembre");
      ok((await tar("E40", 311, "2026-11-30"))?.Tarifa === 1.18, "30 nov noviembre");

      await err(async () => { const x = await T.guardarBorrador(tx, { Grupo: "PD_TON", VigenteDesde: "2026-10-15", detalle: HOJA(1) }, "prueba"); await T.aprobarVersion(tx, x, "prueba"); },
        "aprobar desde 15 oct con versiones aprobadas después");
      await err(() => T.aprobarVersion(tx, nov, "prueba"), "aprobar algo ya aprobado");
      await err(() => T.eliminarBorrador(tx, nov), "eliminar una aprobada");

      const msg = await T.anularVersion(tx, dic, "prueba");
      ok((await tar("E40", 311, "2026-12-15"))?.Tarifa === 1.18, "anulada la temporada: 15 dic vuelve a noviembre · " + msg[0]);
      ok((await tar("E40", 311, "2027-02-01"))?.Tarifa === 1.18, "febrero sigue cubierto");

      await err(() => T.guardarBorrador(tx, { Grupo: "PD_TON", VigenteDesde: "2027-01-01", detalle: [{ Talla: 316, Tarifa: 1 }] }, "prueba"), "talla 316 anulada");
      await err(() => T.guardarBorrador(tx, { Grupo: "PD_TON", VigenteDesde: "2027-01-01", detalle: [{ Talla: 311, Tarifa: 0 }] }, "prueba"), "tarifa cero");
      await err(() => T.guardarBorrador(tx, { Grupo: "PD_TON", VigenteDesde: "2027-01-01", VigenteHasta: "2026-12-01", detalle: HOJA(1) }, "prueba"), "fecha final antes de la inicial");

      await T.asignarGrupo(tx, "clase", { Clase: "E90", Grupo: "PD_TOFF", VigenteDesde: "2026-11-01" }, "prueba");
      const v2: any[] = await tx.$queryRaw`SELECT VersionId FROM TarifaVersion WHERE Grupo='PD_TOFF'`;
      await T.aprobarVersion(tx, Number(v2[0].VersionId), "prueba");
      ok((await tar("E90", 311, "2026-10-20"))?.Grupo === "PD_TON", "E90 en octubre cobra PD_TON");
      ok((await tar("E90", 311, "2026-11-05"))?.Grupo === "PD_TOFF", "E90 desde 1 nov cobra PD_TOFF");
      await err(() => T.asignarGrupo(tx, "clase", { Clase: "E90", Grupo: "PD_TON", VigenteDesde: "2026-10-15" }, "prueba"), "mover clase con fecha anterior al vigente");
      const gc: any[] = await tx.$queryRaw`SELECT GrupoClaseId FROM TarifaGrupoClase WHERE Clase='E90' AND VigenteHasta IS NULL`;
      await T.deshacerGrupo(tx, "clase", Number(gc[0].GrupoClaseId));
      ok((await tar("E90", 311, "2026-11-05"))?.Grupo === "PD_TON", "deshacer: E90 vuelve a PD_TON");

      // ── POOL: Túnel empaque, tarifa única por libra del área, sin talla ──
      await tx.$executeRaw`INSERT INTO TarifaGrupo (Grupo, Descripcion, Modalidad, UnidadPago, Orden) VALUES ('ZP_TUNEL', 'ZP TUNEL EMPAQUE PRUEBA', 'POOL', 'LB', 90)`;
      await T.asignarGrupo(tx, "area", { AreaCodigo: "EG", Grupo: "ZP_TUNEL", VigenteDesde: "2026-10-01" }, "prueba");
      await err(() => T.guardarBorrador(tx, { Grupo: "ZP_TUNEL", VigenteDesde: "2026-10-01", detalle: HOJA(1) }, "prueba"), "pool con tallas");
      const pool = await T.guardarBorrador(tx, { Grupo: "ZP_TUNEL", VigenteDesde: "2026-10-01", detalle: [{ Tarifa: 0.05 }] }, "prueba");
      ok((await T.tarifaDeArea(tx, "EG", "2026-10-08")) === null, "pool en borrador: EG sin tarifa");
      await T.aprobarVersion(tx, pool, "prueba");
      const eg = await T.tarifaDeArea(tx, "EG", "2026-10-08");
      ok(eg?.Modalidad === "POOL" && eg?.Tarifa === 0.05, "pool aprobado: EG = Q0.05 por libra del área");
      ok((await T.tarifaDeArea(tx, "EJ", "2026-10-08")) === null, "EJ (túnel pesadoras) es otro pool: sin tarifa");
      await err(() => T.asignarGrupo(tx, "clase", { Clase: "E41", Grupo: "ZP_TUNEL", VigenteDesde: "2026-11-01" }, "prueba"), "clase a un grupo pool");
      await err(() => T.asignarGrupo(tx, "area", { AreaCodigo: "DS", Grupo: "PD_TON", VigenteDesde: "2026-11-01" }, "prueba"), "área a un grupo de obra");

      // ── TIEMPO basado en el mínimo: la hora sale de Q106 ÷ 8, sin versiones ──
      await tx.$executeRaw`INSERT INTO TarifaGrupo (Grupo, Descripcion, Modalidad, UnidadPago, BaseMinimo, Orden) VALUES ('ZP_JORNAL', 'ZP JORNAL PRUEBA', 'TIEMPO', 'HORA', 1, 91)`;
      await T.asignarGrupo(tx, "area", { AreaCodigo: "CB", Grupo: "ZP_JORNAL", VigenteDesde: "2026-10-01" }, "prueba");
      const cb = await T.tarifaDeArea(tx, "CB", "2026-10-08");
      ok(cb?.Modalidad === "TIEMPO" && cb?.Tarifa === 13.25 && cb?.BaseMinimo === true, "tiempo por mínimo: CB = Q13.25/hora");
      await err(() => T.guardarBorrador(tx, { Grupo: "ZP_JORNAL", VigenteDesde: "2026-10-01", detalle: [{ Tarifa: 15 }] }, "prueba"), "versión para un grupo basado en el mínimo");
      // Mover el área a otro grupo desde una fecha: antes cobra jornal, después el pool.
      await T.asignarGrupo(tx, "area", { AreaCodigo: "CB", Grupo: "ZP_TUNEL", VigenteDesde: "2026-11-01" }, "prueba");
      ok((await T.tarifaDeArea(tx, "CB", "2026-10-31"))?.Grupo === "ZP_JORNAL", "CB el 31 oct sigue por tiempo");
      ok((await T.tarifaDeArea(tx, "CB", "2026-11-02"))?.Grupo === "ZP_TUNEL", "CB desde 1 nov va al pool");

      await T.agregarSalario(tx, { VigenteDesde: "2027-01-01", ValorDia: 115 }, "prueba");
      const s: any[] = await tx.$queryRaw`SELECT DATE_FORMAT(VigenteHasta,'%Y-%m-%d') h FROM SalarioMinimo WHERE VigenteDesde='2026-01-01'`;
      ok(s[0].h === "2026-12-31", "mínimo 2027 cierra el de 2026 el 31 dic");
      await err(() => T.agregarSalario(tx, { VigenteDesde: "2026-06-01", ValorDia: 100 }, "prueba"), "mínimo con fecha anterior al vigente");
      throw new Revertir();
    }, { maxWait: 10_000, timeout: 60_000 });
  } catch (e) { if (!(e instanceof Revertir)) { console.error(e); fallas++; } }
  ok((await huella()) === antes, "todo revertido: las versiones quedaron igual que antes");
  console.log(fallas ? `${fallas} FALLAS` : "TODAS LAS PRUEBAS PASAN");
  await prisma.$disconnect();
})();
