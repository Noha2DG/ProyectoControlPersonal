// Carga de prueba del reporte de Tratamiento: una jornada con varios clientes y cantidades
// aleatorias, armada con la lógica real (entrada, salida, insumos y cierre de lib/tratamiento.ts)
// dentro de una transacción que SIEMPRE se revierte —  no queda nada escrito.
//
// Sirve para ver cómo se comporta el reporte del día con carga: cuánto tarda en armarse y cómo se
// ve impreso con muchas filas. Guarda el reporte (y el detalle de la hoja más grande) en un JSON
// para dibujarlo aparte.
//
//   npx tsx scripts/simularReporteTratamiento.ts [salida.json] [clientes=7] [semilla=42]
import "dotenv/config";
import { writeFileSync } from "node:fs";
import prisma from "../src/lib/prisma.ts";
import * as T from "../src/lib/tratamiento.ts";

const OP = "simulacion-tratamiento";
const HOY = "2030-01-07";
const SALIDA = process.argv[2] || "reporte-tratamiento.json";
const N_CLIENTES = Number(process.argv[3] || 7);
let semilla = Number(process.argv[4] || 42);
// Aleatorio con semilla: la misma corrida da los mismos números, así se puede comparar un cambio.
const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648);
const entre = (a: number, b: number) => a + azar() * (b - a);
const uno = <X>(xs: X[]) => xs[Math.floor(azar() * xs.length)];
const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(Math.floor(min % 60)).padStart(2, "0")}`;
class Revertir extends Error {}

const CLASES = ["E41", "E43", "E50", "E40"];
const TALLAS = [336, 341, 346, 351, 356, 366];   // 36/40 … 110/130, escala de colas

(async () => {
  let reporte: any = null, hojaGrande: any = null, ms = 0, termos = 0;
  try {
    await prisma.$transaction(async (tx) => {
      // El piso: 14 lotes de prueba con kilos de sobra para que ningún termo se quede sin producto.
      const lineas = Array.from({ length: 14 }, (_, i) => ({
        RemisionId: null, Lote: `ZZ${(i % 5) + 1}42EM0${(i % 9) + 1}-E0${(i % 4) + 1}-7`, Clase: uno(CLASES),
        Talla: uno(TALLAS), FechaLote: "2030-01-06",
      }));
      const unicas = [...new Map(lineas.map(l => [T.claveDe(l), l])).values()];
      for (const l of unicas) {
        await tx.$executeRawUnsafe(`
          INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaDestino, Lote, Clase, Talla, FechaLote, Peso, UM, PesoKg, RegistradoPor)
          VALUES ('PROCESADO', ?, 'TRATAMIENTO', ?, ?, ?, ?, 3000, 'KG', 3000, ?)`, HOY, l.Lote, l.Clase, l.Talla, l.FechaLote, OP);
      }
      const clientes: any[] = await tx.$queryRawUnsafe(
        `SELECT Codigo FROM Clientes WHERE Estatus = 'Activo' ORDER BY Codigo LIMIT ${N_CLIENTES}`);
      const destinos = (await T.destinos(tx)).map(d => d.Codigo);
      const preferidos = ["TUNEL", "TUNEL", "TUNEL", "EMPANIZADO", "EMPINCHADO", "BLAST1"].filter(d => destinos.includes(d));

      let reloj = 5 * 60;   // la jornada arranca a las 05:00
      for (const [k, c] of clientes.entries()) {
        const { HojaId } = await T.crearHoja(tx, { fecha: HOY, cliente: Number(c.Codigo), horaInicio: hhmm(reloj), operador: OP });
        const n = Math.round(entre(3, 14));
        const abierta = k >= clientes.length - 2;   // las dos últimas quedan abiertas, con termos en termo
        for (let i = 0; i < n; i++) {
          const l = uno(unicas);
          const sin = Number(entre(2, 170).toFixed(2));
          const ini = reloj + i * 5;
          const { TermoId } = await T.registrarEntrada(tx, HojaId, {
            ...l, NumeroTermo: String(Math.round(entre(1, 400))), HoraInicio: hhmm(ini),
            ConteoInicial: Math.round(entre(36, 120)), Quimico: azar() < 0.85 ? "CARNAL" : "ALTEZA", KgSinTratar: sin,
          }, OP);
          termos++;
          if (abierta && i >= n - 2) continue;   // en termo
          // Casi todos ganan entre 5 y 15 %; algunos pierden o se pasan del 20 %, para que haya alertas.
          const r = azar();
          const p = r < 0.08 ? entre(-10, -1) : r < 0.14 ? entre(21, 35) : entre(5, 15);
          await T.registrarSalida(tx, TermoId, {
            HoraSalida: hhmm(ini + Math.round(entre(100, 130))), ConteoFinal: Math.round(entre(32, 110)),
            KgTratadas: Number((sin * (1 + p / 100)).toFixed(2)), BodegaDestino: uno(preferidos),
          }, OP);
        }
        await T.guardarInsumos(tx, HojaId, [
          { Codigo: "HIELO", Cantidad: Number(entre(20, 200).toFixed(2)) }, { Codigo: "CARNAL", Cantidad: Number(entre(5, 60).toFixed(2)) },
          { Codigo: "ALTEZA", Cantidad: azar() < 0.3 ? Number(entre(1, 15).toFixed(2)) : "" }, { Codigo: "SAL", Cantidad: Number(entre(5, 40).toFixed(2)) },
        ], OP);
        if (!abierta) {
          // Algunas hojas terminan un lote chico y dejan su residuo de báscula como diferencia, como
          // en la planta: Pelado mandó 100 kg y aquí se pesaron entre 97 y 99.5.
          const terminar: string[] = [];
          if (azar() < 0.5) {
            const chico = { RemisionId: null, Lote: `ZZ9${k}0EM00-E00`, Clase: "E41", Talla: uno(TALLAS), FechaLote: "2030-01-06" };
            await tx.$executeRawUnsafe(`
              INSERT INTO MovimientoPiso (Tipo, FechaProduccion, BodegaDestino, Lote, Clase, Talla, FechaLote, Peso, UM, PesoKg, RegistradoPor)
              VALUES ('PROCESADO', ?, 'TRATAMIENTO', ?, ?, ?, ?, 100, 'KG', 100, ?)`, HOY, chico.Lote, chico.Clase, chico.Talla, chico.FechaLote, OP);
            const sin = Number(entre(97, 99.5).toFixed(2));
            const { TermoId } = await T.registrarEntrada(tx, HojaId, {
              ...chico, NumeroTermo: String(Math.round(entre(1, 400))), HoraInicio: hhmm(reloj + n * 5),
              ConteoInicial: 60, Quimico: "CARNAL", KgSinTratar: sin }, OP);
            await T.registrarSalida(tx, TermoId, { HoraSalida: hhmm(reloj + n * 5 + 120), ConteoFinal: 55,
              KgTratadas: Number((sin * 1.1).toFixed(2)), BodegaDestino: "TUNEL" }, OP);
            termos++;
            terminar.push(T.claveDe(chico));
          }
          await T.cerrarHoja(tx, HojaId, { terminar, personas: null, operador: OP });
        }
        reloj += 75;
      }

      const t0 = performance.now();
      reporte = await T.reporteDia(tx, HOY);
      ms = performance.now() - t0;
      const mayor = reporte.Hojas.reduce((a: any, b: any) => (b.Totales.Termos > a.Totales.Termos ? b : a));
      hojaGrande = await T.detalleHoja(tx, mayor.HojaId);
      throw new Revertir();
    }, { timeout: 300000, maxWait: 15000 });
  } catch (e) {
    if (!(e instanceof Revertir)) { console.error("ERROR", (e as any).message); process.exitCode = 1; await prisma.$disconnect(); return; }
  }

  const [q]: any[] = await prisma.$queryRawUnsafe(
    `SELECT (SELECT COUNT(*) FROM MovimientoPiso WHERE RegistradoPor = ?) AS m, (SELECT COUNT(*) FROM HojaProceso WHERE CreadoPor = ?) AS h`, OP, OP);
  writeFileSync(SALIDA, JSON.stringify({ reporte, hojaGrande }, null, 1));
  const C = reporte.Cuadre;
  console.log(`${reporte.Hojas.length} hojas · ${termos} termos · ${reporte.PorLote.length} líneas por lote · ${reporte.Recibido.length} recibidos · ${reporte.AlPiso.length} al piso`);
  console.log(`Totales: ${reporte.Totales.KgRecibidos} kg recibidos, ${reporte.Totales.KgTratados} tratados, ${reporte.Totales.Pickup} % · ${reporte.Totales.Alertas} alertas · ${reporte.Totales.EnTermo} en termo`);
  console.log(`Cuadre: ${C.InicioKg} + ${C.RecibidoKg} − ${C.TomadoTermosKg} − ${C.DiferenciasKg} − ${C.OtrasSalidasKg} = ${C.AlPisoKg}`);
  console.log(`reporteDia tardó ${ms.toFixed(0)} ms (dentro de la transacción, desde esta máquina)`);
  console.log(`Revertido: ${Number(q.m)} movimientos y ${Number(q.h)} hojas de la simulación quedan en la base`);
  console.log(`JSON: ${SALIDA}`);
  await prisma.$disconnect();
})();
