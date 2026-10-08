import { useState, useRef, useEffect } from "react";
import { fmtNum } from "../utils/numero.js";

// Gráfica de la parte de abajo de la vista de mesa (QR y Destajo → Por Mesa): HOY hora por hora
// (serieHorasMesa en utils/mesas.js; cada pesada va a la franja de su hora en punto). Dos franjas
// que comparten las horas del eje de abajo, las dos ACUMULADAS hasta esa hora:
//   arriba  — libras pesadas en el día hasta esa hora
//   abajo   — ritmo en Lb/hr del día hasta esa hora (libra válida / hora válida, reglas del Reporte)
// La columna verde marca la hora en curso, que sigue sumando hasta que se acabe.
// Van en franjas separadas y no en un solo cuadro con dos ejes: libras (cientos) y Lb/hr (decenas)
// tienen escalas distintas, y con dos ejes en el mismo cuadro los cruces de las líneas no significan
// nada. Cada punto lleva su valor escrito (pedido del usuario: fijos, sin tener que tocar).
//
// SVG a mano (sin librería: en el celular no se descarga nada más). Naranja / verde validados con
// la guía de visualización sobre blanco (todas las pruebas pasan).
// El texto nunca va del color de la serie: los colores solo marcan líneas y puntos.
const COLOR = {
  lb: "#eb6834",
  // Mismo verde del tema "verde estero" pero más vivo: el #0F766E del texto, como línea, se lee
  // gris (falla el piso de saturación del validador); #0d9488 pasa todo junto al naranja.
  ritmo: "#0d9488",
  grid: "#e1e0d9",
  eje: "#c3c2b7",
  tinta: "#0b0b0b",
  tinta2: "#52514e",
  apagado: "#898781",
  fondo: "#ffffff",
  // Fondo de la columna de la hora en curso: verde muy suave, solo la resalta (no es un estado).
  hoy: "#0F766E",
};

const M = { izq: 56, der: 24, arr: 20, aba: 24 };
const ALTO_FRANJA = 110, SEPARACION = 30;

// Máximo "redondo" (1, 2, 2.5, 5 × 10^n) para que las marcas del eje sean números limpios.
function maximoRedondo(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const f of [1, 2, 2.5, 5, 10]) if (f * p >= v) return f * p;
  return 10 * p;
}

function segmentos(puntos) {
  const segs = [];
  let actual = [];
  for (const p of puntos) {
    if (p.y == null) { if (actual.length) segs.push(actual); actual = []; }
    else actual.push(p);
  }
  if (actual.length) segs.push(actual);
  return segs;
}
const ruta = seg => seg.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

export default function GraficaMesa({ serie }) {
  // El dibujo mide lo mismo que su contenedor (1 unidad = 1 px): las letras salen igual en el celular
  // y en la pantalla grande.
  const contRef = useRef(null);
  const [ancho, setAncho] = useState(320);
  useEffect(() => {
    const el = contRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setAncho(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (!serie.length) return null;

  const W = ancho;
  const top1 = M.arr, top2 = M.arr + ALTO_FRANJA + SEPARACION;
  const H = top2 + ALTO_FRANJA + M.aba;
  // Los puntos se alejan de los bordes para que su valor no se encime con los números del eje.
  const MARGEN_PUNTOS = 16;
  const anchoPlot = W - M.izq - M.der;
  const paso = serie.length > 1 ? (anchoPlot - 2 * MARGEN_PUNTOS) / (serie.length - 1) : 0;
  const x = i => M.izq + (serie.length > 1 ? MARGEN_PUNTOS + i * paso : anchoPlot / 2);
  // Un día completo son 10-12 horas: en el celular no caben "13:00" ni valores de 11 px en cada
  // punto. Con poco espacio la hora va sin ":00" y los valores un punto más chicos.
  const angosto = paso > 0 && paso < 36;
  const letraValor = paso > 0 && paso < 28 ? 10 : 11;

  const franjas = [
    { campo: "Lb", color: COLOR.lb, titulo: "Lb acumuladas", top: top1, dec: 0,
      max: maximoRedondo(Math.max(...serie.map(s => s.Lb ?? 0))) },
    { campo: "LbHora", color: COLOR.ritmo, titulo: "Lb por hora", top: top2, dec: 1,
      max: maximoRedondo(Math.max(...serie.map(s => s.LbHora ?? 0))) },
  ].map(f => ({
    ...f,
    y: v => (v == null ? null : f.top + ALTO_FRANJA * (1 - v / f.max)),
    pts: serie.map((d, i) => ({ x: x(i), d, i, y: d[f.campo] == null ? null : f.top + ALTO_FRANJA * (1 - d[f.campo] / f.max) })),
  }));

  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
      <p className="text-sm font-semibold text-gray-900">Hoy, hora por hora</p>
      <p className="text-xs text-gray-500">Acumulado del día hasta cada hora (7:00 = hasta las 7:59) · se actualiza cada 2 minutos</p>

      <div ref={contRef} className="w-full mt-2">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block select-none" role="img"
          aria-label={`Libras y Lb por hora: ${serie.map(s => `${s.etiqueta} ${Math.round(s.Lb)} lb, ${s.LbHora == null ? "—" : s.LbHora.toFixed(1)} lb/hr`).join("; ")}`}>
          {/* Columna de la hora en curso con fondo verde, de arriba abajo en las dos franjas */}
          {serie.map((s, i) => s.esActual && (() => {
            const ancho = Math.min(Math.max(paso * 0.8, 24), 64);
            return <rect key="actual" x={x(i) - ancho / 2} y={2} width={ancho} height={H - 2} rx={8} fill={COLOR.hoy} opacity={0.1} />;
          })())}

          {franjas.map(f => {
            const segs = segmentos(f.pts);
            const actual = f.pts.find(p => p.d.esActual);
            return (
              <g key={f.campo}>
                {/* Título del eje, vertical */}
                <text x={12} y={f.top + ALTO_FRANJA / 2} transform={`rotate(-90 12 ${f.top + ALTO_FRANJA / 2})`}
                  textAnchor="middle" fontSize="11" fontWeight="600" fill={COLOR.tinta2}>{f.titulo}</text>
                {[0, f.max / 2, f.max].map(t => (
                  <g key={t}>
                    <line x1={M.izq} x2={W - M.der} y1={f.y(t)} y2={f.y(t)} stroke={t === 0 ? COLOR.eje : COLOR.grid} strokeWidth={1} />
                    <text x={M.izq - 6} y={f.y(t) + 4} textAnchor="end" fontSize="11" fill={COLOR.apagado}
                      style={{ fontVariantNumeric: "tabular-nums" }}>{fmtNum(t, t % 1 ? 1 : 0)}</text>
                  </g>
                ))}
                {f.campo === "Lb" && segs.filter(s => s.length > 1).map((s, k) => (
                  <path key={`a${k}`} d={`${ruta(s)} L${s[s.length - 1].x},${f.y(0)} L${s[0].x},${f.y(0)} Z`} fill={f.color} opacity={0.1} />
                ))}
                {segs.map((s, k) => s.length > 1 && (
                  <path key={k} d={ruta(s)} fill="none" stroke={f.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                ))}
                {actual?.y != null && <circle cx={actual.x} cy={actual.y} r={10} fill={f.color} opacity={0.18} />}
                {f.pts.map(p => p.y != null && (
                  <circle key={p.i} cx={p.x} cy={p.y} r={p.d.esActual ? 5 : 4}
                    fill={f.campo === "LbHora" && p.d.pocoDato ? COLOR.fondo : f.color}
                    stroke={f.campo === "LbHora" && p.d.pocoDato ? f.color : COLOR.fondo} strokeWidth={2} />
                ))}
                {/* Valor fijo sobre cada punto; la hora en curso en negrita */}
                {f.pts.map(p => p.y != null && (
                  <text key={`v${p.i}`} x={p.x} y={p.y - (p.d.esActual ? 15 : 9)} textAnchor="middle" fontSize={letraValor}
                    fontWeight={p.d.esActual ? 700 : 500} fill={p.d.esActual ? COLOR.tinta : COLOR.tinta2}
                    style={{ fontVariantNumeric: "tabular-nums" }}>{fmtNum(p.d[f.campo], f.dec)}</text>
                ))}
              </g>
            );
          })}

          {serie.map((s, i) => (
            <text key={s.hora} x={x(i)} y={H - 6} textAnchor="middle" fontSize={angosto ? 11 : 12}
              fontWeight={s.esActual ? 700 : 400} fill={s.esActual ? COLOR.tinta : COLOR.tinta2}
              style={{ fontVariantNumeric: "tabular-nums" }}>{angosto ? s.hora : s.etiqueta}</text>
          ))}

        </svg>

      </div>
    </div>
  );
}
