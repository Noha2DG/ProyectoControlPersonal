import { useState, useEffect, useCallback, useMemo } from "react";
import { authHeader } from "../context/AuthContext.jsx";
import { fmtNum } from "../utils/numero.js";

// Panorama de planta (Gerencia): el recorrido del producto Bodega → Descongelado → Pelado →
// Tratamiento y a dónde sale de cada área, con el día y el acumulado de la semana o del mes. Los
// datos vienen por día de GET /api/gerencia/panorama (lib/panoramaPlanta.ts) y aquí se suman según
// el periodo, así que cambiar Día/Semana/Mes no vuelve a consultar. Tocar un área abre su resumen.

const COLOR = {
  BODEGA: "#8a8a85", DESCONGELADO: "#2a78d6", PELADO: "#eb6834", TRATAMIENTO: "#1baf7a",
  TUNEL: "#eda100", EMPANIZADO: "#e87ba4", OTRAS: "#b5b4ad", GRIS: "#d9d8d2",
};
const NOMBRE = {
  BODEGA: "Bodega", DESCONGELADO: "Descongelado", PELADO: "Pelado", TRATAMIENTO: "Tratamiento",
  TUNEL: "Túnel", EMPANIZADO: "Empanizado", OTRAS: "Otras áreas",
};
const AREAS = ["DESCONGELADO", "PELADO", "TRATAMIENTO"];
// Lo que no sigue adelante desde cada área (entró − salió en el periodo).
// Segundo renglón del gris en el gráfico: qué incluye lo que no siguió.
const NO_SIGUE_DETALLE = { PELADO: "al piso, en mesas o sin cerrar" };
const NO_SIGUE = { DESCONGELADO: "Queda en Descongelado", PELADO: "Queda en Pelado", TRATAMIENTO: "En proceso en Tratamiento" };
// Destinos que se dibujan con nombre propio; el resto se junta en "Otras áreas".
const DESTINOS = { DESCONGELADO: ["PELADO"], PELADO: ["TUNEL", "TRATAMIENTO"], TRATAMIENTO: ["TUNEL", "EMPANIZADO"] };
const PERIODOS = [["dia", "Día"], ["semana", "Semana"], ["mes", "Mes"]];
const kg = v => fmtNum(v, 0);
const pct = v => (v == null ? "—" : `${fmtNum(v, 1)} %`);

// Los números propios de cada área, con las mismas cuentas que sus pantallas (ver
// lib/panoramaPlanta.ts, PorDia). `kg` se suma; `pct` se calcula sobre las sumas del periodo.
// `grafica` es lo que se dibuja día a día.
const METRICAS = {
  DESCONGELADO: {
    grafica: ["Pesado", "Descongelado por día", "kg descongelados"],
    filas: [
      { t: "Recibido", kg: s => s.Recibido },
      { t: "Descongelado (pesado)", kg: s => s.Pesado },
      { t: "Diferencia (pesado − declarado)", kg: s => s.PesadoConPar - s.Declarado, signo: true },
      { t: "Rendimiento (pesado ÷ declarado)", pct: s => (s.Declarado > 0.001 ? s.PesadoConPar / s.Declarado * 100 : null), clave: true },
      { t: "Devuelto a bodega", kg: s => s.Devuelto, soloResumen: true },
      { t: "Merma", kg: s => s.Merma, soloResumen: true },
    ],
  },
  PELADO: {
    grafica: ["Pelado", "Pelado por día", "kg pelados"],
    filas: [
      // Lo mismo que entra a Pelado en el gráfico de flujo: recibido − tomado = lo que queda al piso.
      { t: "Recibido al piso (de Descongelado)", kg: (s, r) => r.entro("PELADO") },
      { t: "MP tomada del piso", kg: s => s.Tomado },
      { t: "Pelado", kg: s => s.Pelado },
      { t: "Bajado de las mesas", kg: s => s.Bajado, soloResumen: true },
      { t: "Ritmo peladoras (lb/hr)", lbh: (s, r) => r.lbHora, clave: true, principal: true },
      { t: "Rendimiento (lotes terminados)", pct: (s, r) => r.rend, clave: true },
      { t: "Lotes terminados / en mesas", txt: (s, r) => `${r.lotesTerminados} / ${r.lotesEnMesas}`, soloResumen: true },
    ],
  },
  TRATAMIENTO: {
    grafica: ["Tratado", "Tratado por día", "kg tratados"],
    filas: [
      { t: "Recibido al piso (de Pelado)", kg: (s, r) => r.entro("TRATAMIENTO"), soloResumen: true },
      { t: "Recibido sin tratar", kg: s => s.Recibido },
      { t: "Tratado", kg: s => s.Tratado },
      { t: "Ganado (tratado − sin tratar)", kg: s => s.Tratado - s.Base, signo: true },
      { t: "Pick-up", pct: s => (s.Base > 0.001 ? (s.Tratado - s.Base) / s.Base * 100 : null), clave: true },
    ],
  },
};
function sumaArea(datos, area, desde, hasta) {
  const s = {};
  for (const d of datos.PorDia[area] ?? []) {
    if (d.Fecha < desde || d.Fecha > hasta) continue;
    for (const [k, v] of Object.entries(d)) if (k !== "Fecha") s[k] = (s[k] ?? 0) + (v || 0);
  }
  return new Proxy(s, { get: (o, k) => o[k] ?? 0 });
}
function valorFila(f, s, r) {
  if (f.kg) { const v = f.kg(s, r); return (f.signo && v > 0 ? "+" : "") + kg(v) + " kg"; }
  if (f.lbh) { const v = f.lbh(s, r); return v === undefined ? "calculando…" : v == null ? "—" : `${fmtNum(v, 1)} lb/hr`; }
  if (f.pct) return pct(f.pct(s, r));
  return f.txt(s, r);
}

function hoy() { return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" }); }
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
function etiquetaDia(iso, corta) {
  const [a, m, d] = iso.split("-").map(Number);
  const f = new Date(a, m - 1, d);
  return corta ? String(d) : `${DIAS[f.getDay()]} ${d}`;
}
function diasEntre(desde, hasta) {
  const out = []; const [a, m, d] = desde.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  for (;;) { const iso = f.toISOString().slice(0, 10); if (iso > hasta) break; out.push(iso); f.setUTCDate(f.getUTCDate() + 1); }
  return out;
}

// ── Cálculo por periodo ──────────────────────────────────────────────────────────────────────────
function resumirPeriodo(datos, per) {
  const { desde, hasta } = datos.Rangos[per];
  const flujo = {};       // "ORIGEN|DESTINO" → kg
  for (const x of datos.Diario) {
    if (x.Fecha < desde || x.Fecha > hasta) continue;
    flujo[`${x.Origen}|${x.Destino}`] = (flujo[`${x.Origen}|${x.Destino}`] ?? 0) + x.Kg;
  }
  const entro = a => Object.entries(flujo).filter(([k]) => k.endsWith(`|${a}`)).reduce((s, [, v]) => s + v, 0);
  const salio = a => Object.entries(flujo).filter(([k]) => k.startsWith(`${a}|`) && !k.endsWith("|MERMA")).reduce((s, [, v]) => s + v, 0);
  const merma = a => flujo[`${a}|MERMA`] ?? 0;
  const lotes = datos.Lotes.filter(l => l.Fecha >= desde && l.Fecha <= hasta);
  const term = lotes.filter(l => l.Terminado);
  const mpTerm = term.reduce((s, l) => s + l.Tomado - l.Bajado, 0);
  const pelTerm = term.reduce((s, l) => s + l.Pelado, 0);
  const area = Object.fromEntries(AREAS.map(a => [a, sumaArea(datos, a, desde, hasta)]));
  return {
    desde, hasta, flujo, entro, salio, merma, area,
    rend: mpTerm > 0 ? pelTerm / mpTerm * 100 : null,
    lotesTerminados: term.length, lotesEnMesas: lotes.length - term.length,
    lbHora: (() => {
      if (datos.Ritmo == null) return undefined;   // todavía calculando
      const dias = datos.Ritmo.filter(x => x.Fecha >= desde && x.Fecha <= hasta);
      const lb = dias.reduce((t, x) => t + x.Lb, 0), h = dias.reduce((t, x) => t + x.Horas, 0);
      return h > 0 ? lb / h : null;
    })(),
  };
}

// ── Gráfico de flujo ─────────────────────────────────────────────────────────────────────────────
function Flujo({ r, onAbrir }) {
  // Enlaces: origen → destino con nombre, o → OTRAS, y lo que no siguió → gris.
  const L = [];
  const bd = r.flujo["BODEGA|DESCONGELADO"] ?? 0;
  if (bd) L.push(["BODEGA", "DESCONGELADO", bd]);
  const otras = {};
  for (const a of AREAS) {
    for (const [k, v] of Object.entries(r.flujo)) {
      const [o, d] = k.split("|");
      if (o !== a || d === "MERMA" || !v) continue;
      if (DESTINOS[a].includes(d)) L.push([a, d, v]);
      else otras[a] = (otras[a] ?? 0) + v;
    }
    if (otras[a]) L.push([a, "OTRAS", otras[a]]);
    const resto = r.entro(a) - r.salio(a);
    if (resto > 0.5) L.push([a, `GRIS_${a}`, resto]);
  }
  // Orden de apilado: los destinos principales arriba, el gris al final.
  const orden = ["DESCONGELADO", "PELADO", "TUNEL", "TRATAMIENTO", "EMPANIZADO", "OTRAS"];
  L.sort((x, y) => (x[0] === y[0] ? (x[1].startsWith("GRIS") ? 1 : y[1].startsWith("GRIS") ? -1 : orden.indexOf(x[1]) - orden.indexOf(y[1])) : 0));

  const kgIn = {}, kgOut = {};
  for (const [a, b, v] of L) { kgOut[a] = (kgOut[a] ?? 0) + v; kgIn[b] = (kgIn[b] ?? 0) + v; }
  const kgN = id => Math.max(kgIn[id] ?? 0, kgOut[id] ?? 0);
  const maxN = Math.max(...["BODEGA", ...AREAS].map(kgN), 1);
  const k = 300 / maxN, Wn = 18;
  const H = id => (kgN(id) ? Math.max(kgN(id) * k, 3) : 0);
  const f = (a, b) => (L.find(x => x[0] === a && x[1] === b)?.[2] ?? 0) * k;

  const X = { BODEGA: 20, DESCONGELADO: 320, PELADO: 620, TRATAMIENTO: 900, TUNEL: 1180, EMPANIZADO: 1180, OTRAS: 1180,
              GRIS_DESCONGELADO: 620, GRIS_PELADO: 900, GRIS_TRATAMIENTO: 1180 };
  const Y = { BODEGA: 50, DESCONGELADO: 50, PELADO: 50, TUNEL: 50 };
  Y.TRATAMIENTO = 50 + f("PELADO", "TUNEL") + 56;
  Y.EMPANIZADO = Y.TUNEL + H("TUNEL") + 34;
  Y.GRIS_TRATAMIENTO = Y.EMPANIZADO + H("EMPANIZADO") + 34;
  Y.OTRAS = Y.GRIS_TRATAMIENTO + H("GRIS_TRATAMIENTO") + 34;
  Y.GRIS_PELADO = Y.TRATAMIENTO + H("TRATAMIENTO") + 46;
  Y.GRIS_DESCONGELADO = Y.PELADO + H("PELADO") + 34;
  const alto = Math.max(420, ...Object.keys(Y).map(id => Y[id] + H(id) + 40));

  const so = {}, si = {};
  const bandas = L.map(([a, b, v]) => {
    const h = v * k, y0 = Y[a] + (so[a] ?? 0), y1 = Y[b] + (si[b] ?? 0);
    so[a] = (so[a] ?? 0) + h; si[b] = (si[b] ?? 0) + h;
    const x0 = X[a] + Wn, x1 = X[b], mx = (x0 + x1) / 2;
    return { a, b, v, h, y0, y1, x0, x1, mx, gris: b.startsWith("GRIS") };
  });
  const abre = id => (AREAS.includes(id) ? id : null);

  if (!L.length) return <div className="py-16 text-center text-gray-400 text-sm">Sin movimientos entre áreas en este periodo</div>;
  return (
    <svg viewBox={`0 0 1440 ${alto}`} className="w-full">
      {bandas.map((s, i) => {
        const area = abre(s.a) ?? abre(s.b);
        return (
          <g key={i} onClick={area ? () => onAbrir(area) : undefined} style={{ cursor: area ? "pointer" : "default" }}>
            <path d={`M${s.x0},${s.y0} C${s.mx},${s.y0} ${s.mx},${s.y1} ${s.x1},${s.y1} L${s.x1},${s.y1 + s.h} C${s.mx},${s.y1 + s.h} ${s.mx},${s.y0 + s.h} ${s.x0},${s.y0 + s.h} Z`}
              fill={s.gris ? COLOR.GRIS : COLOR[s.a]} fillOpacity={s.gris ? 0.55 : 0.3} className="transition-[fill-opacity] hover:fill-opacity-50">
              <title>{`${NOMBRE[s.a]} → ${s.gris ? NO_SIGUE[s.a] : NOMBRE[s.b]}: ${kg(s.v)} kg`}</title>
            </path>
            {s.h > 14 && !s.gris && (
              <text x={s.mx} y={(s.y0 + s.y1) / 2 + s.h / 2 + 4} textAnchor="middle" fontSize="12" fontWeight="600" fill="#52514e" pointerEvents="none">{kg(s.v)} kg</text>
            )}
          </g>
        );
      })}
      {Object.keys(X).filter(id => kgN(id) > 0).map(id => {
        const gris = id.startsWith("GRIS"), area = abre(id), arriba = id === "TRATAMIENTO";
        const tx = arriba ? X[id] - 2 : X[id] + Wn + 8, ty = arriba ? Y[id] - 58 : Y[id] + 4;
        return (
          <g key={id} onClick={area ? () => onAbrir(area) : undefined} style={{ cursor: area ? "pointer" : "default" }}
            tabIndex={area ? 0 : undefined} role={area ? "button" : undefined} aria-label={area ? `Resumen de ${NOMBRE[id]}` : undefined}
            onKeyDown={area ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAbrir(area); } } : undefined}>
            <rect x={X[id]} y={Y[id]} width={Wn} height={H(id)} rx="3" fill={gris ? COLOR.GRIS : COLOR[id]} />
            <text x={tx} y={ty + (gris ? 10 : 16)} fontSize={gris ? 12 : 14} fontWeight={gris ? 500 : 700} fill={gris ? "#8b8a85" : "#0b0b0b"}>
              {gris ? NO_SIGUE[id.slice(5)] : NOMBRE[id]}
              {gris && NO_SIGUE_DETALLE[id.slice(5)] && <tspan x={tx} dy="15" fontSize="11" fill="#8b8a85">{NO_SIGUE_DETALLE[id.slice(5)]}</tspan>}
              <tspan x={tx} dy="17" fontSize="12" fontWeight="600" fill="#52514e">
                {kg(kgN(id))} kg{["TUNEL", "EMPANIZADO", "OTRAS"].includes(id) ? " · destino" : ""}
              </tspan>
              {area && <tspan x={tx} dy="16" fontSize="11" fontWeight="600" fill="#0E3A53">Ver resumen ›</tspan>}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Línea de lb/hr por día (Pelado). Una sola escala: va en su propio gráfico, no encima de las barras.
function LineaLbHora({ dias, etiquetas, ritmo, alto = 110 }) {
  if (ritmo == null) return (
    <div className="flex items-center justify-center gap-2 text-xs text-gray-400" style={{ height: alto }}>
      <span className="w-3 h-3 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />Calculando el ritmo…
    </div>
  );
  const W = 400, base = alto - 20, top = 16;
  const v = dias.map(d => { const x = ritmo.find(r => r.Fecha === d); return x && x.Horas > 0 ? x.Lb / x.Horas : null; });
  const vals = v.filter(x => x != null);
  if (!vals.length) return <div className="text-xs text-gray-400 py-6 text-center">Sin pesadas con tiempo medible</div>;
  const min = Math.floor(Math.min(...vals) - 1), max = Math.ceil(Math.max(...vals) + 1);
  const paso = (W - 40) / Math.max(dias.length, 1);
  const X = i => 36 + i * paso + Math.min(34, paso - 4) / 2, Y = x => base - (x - min) / (max - min) * (base - top);
  const pts = v.map((x, i) => (x == null ? null : [X(i), Y(x), x, i])).filter(Boolean);
  return (
    <svg viewBox={`0 0 ${W} ${alto}`} className="w-full">
      {[min, (min + max) / 2, max].map(g => (
        <g key={g}><line x1="30" x2={W} y1={Y(g)} y2={Y(g)} stroke="#efeee9" />
          <text x="26" y={Y(g) + 4} textAnchor="end" fontSize="10" fill="#8b8a85">{fmtNum(g, 0)}</text></g>
      ))}
      <path d={"M" + pts.map(p => `${p[0]},${p[1]}`).join(" L")} fill="none" stroke={COLOR.PELADO} strokeWidth="2" />
      {pts.map(([x, y, val, i]) => (
        <g key={i}>
          <circle cx={x} cy={y} r="4" fill={COLOR.PELADO} stroke="#fff" strokeWidth="2"><title>{`${etiquetas[i]}: ${fmtNum(val, 1)} lb/hr`}</title></circle>
          {(dias.length <= 8 || i === dias.length - 1) && <text x={x} y={y - 8} textAnchor="middle" fontSize="10.5" fontWeight="600" fill="#52514e">{fmtNum(val, 1)}</text>}
        </g>
      ))}
      {etiquetas.map((e, i) => (dias.length <= 8 || i % 3 === 0 || i === dias.length - 1) && (
        <text key={i} x={X(i)} y={alto - 4} textAnchor="middle" fontSize="10.5" fill={i === dias.length - 1 ? "#0b0b0b" : "#8b8a85"} fontWeight={i === dias.length - 1 ? 700 : 400}>{e}</text>
      ))}
    </svg>
  );
}

// ── Barras de un área por día ────────────────────────────────────────────────────────────────────
function Barras({ valores, etiquetas, color, alto = 120 }) {
  const n = valores.length, W = 400, base = alto - 20, max = Math.max(...valores, 1) * 1.15;
  const paso = (W - 40) / Math.max(n, 1), bw = Math.min(34, paso - 4);
  return (
    <svg viewBox={`0 0 ${W} ${alto}`} className="w-full">
      {[0, 0.5, 1].map(f => {
        const y = base - f * (base - 14);
        return (<g key={f}><line x1="30" x2={W} y1={y} y2={y} stroke="#efeee9" />
          <text x="26" y={y + 4} textAnchor="end" fontSize="10" fill="#8b8a85">{f ? `${Math.round(max * f / 100) / 10}k` : 0}</text></g>);
      })}
      {valores.map((v, i) => {
        const x = 36 + i * paso, h = v / max * (base - 14), ult = i === n - 1;
        return (
          <g key={i}>
            {v > 0 && <rect x={x} y={base - h} width={bw} height={h} rx="3" fill={color} fillOpacity={ult ? 0.5 : 1}><title>{`${etiquetas[i]}: ${kg(v)} kg`}</title></rect>}
            {ult && v > 0 && <text x={x + bw / 2} y={base - h - 4} textAnchor="middle" fontSize="10.5" fontWeight="600" fill="#52514e">{kg(v)}</text>}
            {(n <= 8 || i % 3 === 0 || ult) && <text x={x + bw / 2} y={alto - 4} textAnchor="middle" fontSize="10.5" fill={ult ? "#0b0b0b" : "#8b8a85"} fontWeight={ult ? 700 : 400}>{etiquetas[i]}</text>}
          </g>
        );
      })}
    </svg>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────────────────────────
export default function ReportesPage() {
  const [fecha, setFecha] = useState(hoy());
  const [per, setPer] = useState("dia");
  const [base, setBase] = useState(null);
  // El ritmo (lb/hr) viene de su propia ruta y llega después: null = todavía calculando.
  const [ritmo, setRitmo] = useState(null);
  const [error, setError] = useState("");
  const [abierta, setAbierta] = useState(null);

  const cargar = useCallback(async () => {
    // El ritmo se pide en paralelo pero no detiene la pantalla: el flujo y las tarjetas se muestran
    // en cuanto llega el panorama, y las lb/hr se completan cuando llegan.
    fetch(`/api/gerencia/panorama/ritmo?fecha=${fecha}`, { headers: authHeader() })
      .then(r => (r.ok ? r.json() : null)).then(d => { if (d?.Fecha === fecha) setRitmo(d.Ritmo); }).catch(() => {});
    try {
      const res = await fetch(`/api/gerencia/panorama?fecha=${fecha}`, { headers: authHeader() });
      const d = await res.json();
      if (res.ok) { setBase(d); setError(""); } else setError(d.error || "No se pudo cargar");
    } catch { setError("No se pudo conectar con el servidor"); }
  }, [fecha]);
  // Al cambiar de fecha, lo de la fecha anterior no vale: se muestra calculando hasta que llegue.
  const [fechaVista, setFechaVista] = useState(fecha);
  if (fechaVista !== fecha) { setFechaVista(fecha); setRitmo(null); }
  const datos = useMemo(() => (base && base.Fecha === fecha ? { ...base, Ritmo: ritmo } : null), [base, ritmo, fecha]);
  useEffect(() => { cargar(); }, [cargar]);
  // En vivo: con la fecha de hoy se refresca cada 2 min (el servidor guarda 1 min).
  useEffect(() => {
    if (fecha !== hoy()) return undefined;
    const t = setInterval(cargar, 120_000);
    return () => clearInterval(t);
  }, [fecha, cargar]);
  useEffect(() => {
    const esc = e => { if (e.key === "Escape") setAbierta(null); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  const R = useMemo(() => (datos ? Object.fromEntries(PERIODOS.map(([p]) => [p, resumirPeriodo(datos, p)])) : null), [datos]);
  const acum = per === "mes" ? "mes" : "semana";

  // Día a día: Día y Semana muestran la semana; Mes, el mes.
  const serie = useMemo(() => {
    if (!datos) return null;
    const rango = datos.Rangos[per === "mes" ? "mes" : "semana"];
    const dias = diasEntre(rango.desde, rango.hasta);
    const por = {};
    for (const a of AREAS) for (const x of datos.PorDia[a] ?? []) por[`${a}|${x.Fecha}`] = x[METRICAS[a].grafica[0]] ?? 0;
    return { dias, etiquetas: dias.map(d => etiquetaDia(d, per === "mes")), valor: (a, d) => por[`${a}|${d}`] ?? 0 };
  }, [datos, per]);

  if (error && !datos) return <div className="p-6 text-red-600">{error}</div>;
  if (!datos || !R) return <div className="flex justify-center py-24"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>;
  const r = R[per], d = R.dia, ac = R[acum];

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-[11px] tracking-wider uppercase text-gray-400 font-semibold">Reportes · Producción</div>
          <h1 className="text-2xl font-bold text-gray-900">Panorama de planta</h1>
        </div>
        <div className="flex items-center gap-3">
          <input type="date" value={fecha} max={hoy()} onChange={e => e.target.value && setFecha(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
          <div className="flex rounded-lg border border-gray-300 bg-white overflow-hidden">
            {PERIODOS.map(([p, t]) => (
              <button key={p} onClick={() => setPer(p)}
                className={`px-3.5 py-1.5 text-sm ${per === p ? "bg-[#0E3A53] text-white font-semibold" : "text-gray-600 hover:bg-gray-50"}`}>{t}</button>
            ))}
          </div>
          <span className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className={`w-2 h-2 rounded-full ${fecha === hoy() ? "bg-emerald-500 animate-pulse" : "bg-gray-300"}`} />
            {fecha === hoy() ? `Actualizado ${datos.Actualizado}` : "Día cerrado"}
          </span>
        </div>
      </div>

      {/* Recorrido */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
          <div>
            <h2 className="text-base font-bold">Recorrido del producto · <span className="font-semibold text-gray-600">
              {per === "dia" ? etiquetaDia(r.desde) : `${etiquetaDia(r.desde)} al ${etiquetaDia(r.hasta)}`}</span></h2>
            <div className="text-xs text-gray-500">El ancho de cada banda son los kilos que pasaron de un área a la otra. Toque un área para ver su resumen.</div>
          </div>
          <span className="flex items-center gap-1.5 text-xs text-gray-500"><span className="w-3 h-3 rounded-sm" style={{ background: COLOR.GRIS }} />No sigue: en mesas o al piso</span>
        </div>
        <Flujo r={r} onAbrir={setAbierta} />
      </div>

      {/* Tarjetas: los números propios del área, del día y el acumulado */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {AREAS.map(a => {
          const M = METRICAS[a], kgs = M.filas.filter(f => f.kg && !f.soloResumen).slice(0, 3), claves = M.filas.filter(f => f.clave);
          return (
            <button key={a} onClick={() => setAbierta(a)} className="text-left bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md hover:-translate-y-px transition"
              style={{ borderTop: `4px solid ${COLOR[a]}` }}>
              <div className="flex items-center gap-2.5 mb-3">
                <span className="font-bold text-lg">{NOMBRE[a]}</span>
                <span className="ml-auto text-[11px] font-semibold text-[#0E3A53]">Ver resumen ›</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {kgs.map(f => (
                  <div key={f.t}>
                    <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold leading-tight h-7">{f.t.replace(/ \(.*\)/, "")}</div>
                    <div className="text-xl font-bold tabular-nums">{valorFila(f, d.area[a], d).replace(" kg", "")}</div>
                    <div className="text-[11px] text-gray-400 tabular-nums">{acum} {valorFila(f, ac.area[a], ac).replace(" kg", "")}</div>
                  </div>
                ))}
              </div>
              <div className={`mt-3 pt-2 border-t border-gray-100 grid gap-2 text-xs ${claves.length > 1 ? "grid-cols-3" : "grid-cols-2"}`}>
                {claves.map(clave => (
                  <div key={clave.t} className={clave.principal ? "rounded-lg px-2 py-1 -my-1 bg-orange-50" : ""}>
                    <span className={clave.principal ? "font-semibold text-[#b4471d]" : "text-gray-500"}>{clave.t.replace(/ \(.*\)/, "")}</span>
                    <div><b className={`${clave.principal ? "text-xl" : "text-base"} tabular-nums`}>{valorFila(clave, d.area[a], d)}</b></div>
                    <div className="text-gray-400 tabular-nums">{acum} {valorFila(clave, ac.area[a], ac)}</div>
                  </div>
                ))}
                <div className="text-right"><span className="text-gray-500">Al piso</span>
                  <div><b className="text-base tabular-nums">{kg(datos.AlPiso[a].Kg)}</b> <span className="text-gray-400">kg</span></div></div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Día a día */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-base font-bold">Día a día</h2>
        <div className="text-xs text-gray-500 mb-2">Lo que trabajó cada área por día · {per === "mes" ? "el mes" : "la semana"}</div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {AREAS.map(a => {
            const v = serie.dias.map(dd => serie.valor(a, dd));
            return (
              <button key={a} onClick={() => setAbierta(a)} className="text-left rounded-lg -m-2 p-2 hover:bg-gray-50">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-semibold flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLOR[a] }} />{NOMBRE[a]}<span className="font-normal text-gray-400">· {METRICAS[a].grafica[2]}</span></span>
                  <span className="text-xs text-gray-500 tabular-nums">{acum} <b>{kg(v.reduce((s, x) => s + x, 0))}</b> kg</span>
                </div>
                <Barras valores={v} etiquetas={serie.etiquetas} color={COLOR[a]} />
                {a === "PELADO" && (<>
                  <div className="flex items-baseline justify-between mt-2">
                    <span className="text-sm font-semibold">Ritmo peladoras <span className="font-normal text-gray-400">· lb/hr</span></span>
                    <span className="text-xs text-gray-500 tabular-nums">{acum} <b>{R[acum].lbHora === undefined ? "…" : R[acum].lbHora == null ? "—" : fmtNum(R[acum].lbHora, 1)}</b> lb/hr</span>
                  </div>
                  <LineaLbHora dias={serie.dias} etiquetas={serie.etiquetas} ritmo={datos.Ritmo} />
                </>)}
              </button>
            );
          })}
        </div>
      </div>

      {abierta && <ResumenArea area={abierta} R={R} per={per} datos={datos} serie={serie} onCerrar={() => setAbierta(null)} />}
    </div>
  );
}

// ── Resumen del área (panel lateral) ─────────────────────────────────────────────────────────────
function ResumenArea({ area, R, per, datos, serie, onCerrar }) {
  const r = R[per];
  const filas = METRICAS[area].filas.map(f => [f.t, p => valorFila(f, R[p].area[area], R[p])]);
  const destinos = Object.entries(r.flujo).filter(([k, v]) => k.startsWith(`${area}|`) && !k.endsWith("|MERMA") && v > 0)
    .map(([k, v]) => [k.split("|")[1], v]).sort((x, y) => y[1] - x[1]);
  const maxD = Math.max(...destinos.map(x => x[1]), 1);
  const piso = datos.AlPiso[area];
  return (
    <>
      <div className="fixed inset-0 bg-black/25 z-40" onClick={onCerrar} />
      <aside className="fixed top-0 right-0 h-full w-[560px] max-w-full bg-white shadow-2xl z-50 overflow-y-auto" role="dialog" aria-modal="true">
        <div className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[11px] tracking-wider uppercase text-gray-400 font-semibold">Resumen del área</div>
              <h2 className="text-2xl font-bold flex items-center gap-2.5"><span className="w-3 h-7 rounded-sm" style={{ background: COLOR[area] }} />{NOMBRE[area]}</h2>
              <div className="text-sm text-gray-500">{etiquetaDia(datos.Fecha)} · {datos.HojasAbiertas[area] ? `${datos.HojasAbiertas[area]} hoja(s) abierta(s)` : "sin hojas abiertas"}</div>
            </div>
            <button onClick={onCerrar} className="text-2xl leading-none text-gray-400 hover:text-gray-800 px-2" aria-label="Cerrar">×</button>
          </div>

          <table className="w-full text-sm mt-5">
            <thead><tr className="text-[11px] uppercase tracking-wide text-gray-400">
              <th className="text-left font-semibold py-1" /><th className="text-right font-semibold">Día</th>
              <th className="text-right font-semibold">Semana</th><th className="text-right font-semibold">Mes</th></tr></thead>
            <tbody>
              {filas.map(([t, fn]) => (
                <tr key={t} className="border-t border-gray-100">
                  <td className="py-2 text-gray-600">{t}</td>
                  {["dia", "semana", "mes"].map(p => <td key={p} className={`text-right tabular-nums ${p === "dia" ? "font-bold" : ""}`}>{fn(p)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>

          <h3 className="text-sm font-bold mt-6 mb-1">{METRICAS[area].grafica[1]} · {per === "mes" ? "mes" : "semana"}</h3>
          <Barras valores={serie.dias.map(dd => serie.valor(area, dd))} etiquetas={serie.etiquetas} color={COLOR[area]} alto={130} />
          {area === "PELADO" && (<>
            <h3 className="text-sm font-bold mt-4 mb-1">Ritmo de las peladoras · lb/hr</h3>
            <LineaLbHora dias={serie.dias} etiquetas={serie.etiquetas} ritmo={datos.Ritmo} alto={130} />
          </>)}

          <h3 className="text-sm font-bold mt-5 mb-2">A dónde se fue · {PERIODOS.find(p => p[0] === per)[1].toLowerCase()}</h3>
          {destinos.length === 0 ? <p className="text-sm text-gray-400">Nada salió en este periodo</p> : (
            <div className="space-y-1.5">
              {destinos.map(([dst, v]) => (
                <div key={dst} className="grid grid-cols-[120px_1fr_80px] items-center gap-2 text-sm">
                  <span className="text-gray-600 truncate">{NOMBRE[dst] ?? dst.charAt(0) + dst.slice(1).toLowerCase()}</span>
                  <div className="h-3 rounded" style={{ width: `${v / maxD * 100}%`, background: COLOR[dst] ?? COLOR.OTRAS }} />
                  <span className="text-right tabular-nums font-semibold">{kg(v)}</span>
                </div>
              ))}
            </div>
          )}

          <h3 className="text-sm font-bold mt-6 mb-2">Al piso · {kg(piso.Kg)} kg</h3>
          {piso.Lineas.length === 0 ? <p className="text-sm text-gray-400">Nada esperando al piso</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-[11px] uppercase tracking-wide text-gray-400">
                <th className="text-left font-semibold py-1">Lote</th><th className="text-left font-semibold">Talla</th>
                <th className="text-right font-semibold">Kg</th><th className="text-right font-semibold">Días al piso</th></tr></thead>
              <tbody>
                {piso.Lineas.slice(0, 12).map((p, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="py-1.5 font-mono font-semibold">{p.Lote} <span className="font-sans font-normal text-gray-400">{p.Clase}</span></td>
                    <td>{p.Talla}</td><td className="text-right tabular-nums">{fmtNum(p.Kg)}</td>
                    <td className={`text-right tabular-nums ${p.Dias >= 3 ? "font-bold text-amber-700" : ""}`}>{p.Dias >= 3 ? "⚠ " : ""}{p.Dias}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {piso.Lineas.length > 12 && <p className="text-xs text-gray-400 mt-1">y {piso.Lineas.length - 12} renglones más</p>}
        </div>
      </aside>
    </>
  );
}
