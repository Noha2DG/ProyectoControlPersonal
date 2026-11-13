import { useState, useEffect, useCallback } from "react";
import { authHeader } from "../context/AuthContext.jsx";

// Dibujo de cómo se va llenando el contenedor de una remisión de exportación, fila por fila.
//
// La fila es la "línea del contenedor" que bodega marca al escanear (RemisionDetalle.LineaContenedor):
// la 1 es el fondo, junto al equipo de frío, y se carga hacia la puerta. Dentro de la fila el sistema
// no guarda la posición de cada caja, así que se acomodan en el orden en que se escanearon.
//
// Lo que falta sale del avance de la proforma (GET /detalle-pedido/avance) y con eso se estiman las
// filas que quedan y cuánto espacio sobra en la puerta. Se vuelve a pedir solo cada REFRESCO_MS para
// que una pantalla en la oficina siga la carga sin que nadie toque nada.
//
// PROVISIONAL (13 nov 2026): las medidas de caja y los masters por fila salen del modelo de estiba de
// Peak One (020-2026) y van aquí fijos hasta que el menú de Exportaciones los tenga en catálogo. Una
// presentación que no esté en CAJAS se dibuja con la caja de 10/720 y 25/360.

const CONTENEDOR = { nombre: "Reefer 40' HC", largo: 1158, ancho: 229, alto: 255 };   // cm interiores
const POR_CAMA = 7;   // cajas a lo ancho del contenedor
const CAJA_DEFECTO = { porFila: 82, fondo: 52, ancho: 31, alto: 19 };
const CAJAS = {
  AF: { porFila: 46, fondo: 42, ancho: 30, alto: 34 },   // 5/3 kg: 7 a lo ancho × 6 camas + 4 encima
};
const cajaDe = (presentacion) => CAJAS[presentacion] ?? CAJA_DEFECTO;
const REFRESCO_MS = 15_000;

const PALETA = [
  { top: "#EDBE7C", front: "#D9994C", right: "#B9782F", st: "#8A5A22", sol: "#B45309" },
  { top: "#8AD0A6", front: "#52AD78", right: "#3B8A5C", st: "#2C6B46", sol: "#15803D" },
  { top: "#8CC0EC", front: "#5398D4", right: "#3A78B0", st: "#2A5C8A", sol: "#1D4ED8" },
  { top: "#C3B0EE", front: "#9A80DA", right: "#7A60BC", st: "#5B4596", sol: "#6D28D9" },
  { top: "#F0A9BC", front: "#DB7690", right: "#BB5670", st: "#8E3A52", sol: "#BE123C" },
  { top: "#86D3CC", front: "#45ACA2", right: "#2F8A81", st: "#226860", sol: "#0F766E" },
];
const FANTASMA = { front: "rgba(148,163,184,.10)", top: "rgba(148,163,184,.16)", right: "rgba(148,163,184,.07)", st: "#94a3b8" };

const num = (v, d = 0) => Number(v).toLocaleString("es-GT", { minimumFractionDigits: d, maximumFractionDigits: d });
// "25/360 gr (9 kg)" → "25/360 gr": el peso entre paréntesis ya está en los kg de la carga.
const corta = (txt) => String(txt ?? "").replace(/\s*\(.*\)\s*$/, "");

// Proyección oblicua: x = largo (fondo → puerta), y = ancho (hacia adentro), z = alto.
const K = 0.845, OX = 34, OY = 318;
const P = (x, y, z) => [OX + K * (x * 0.955 + y * 0.34), OY + K * (x * 0.13 - y * 0.30 - z)];
const pts = (lista) => lista.map(p => P(...p).map(v => v.toFixed(1)).join(",")).join(" ");

function Caja({ b: [x0, y0, z0, x1, y1, z1], c, punteada }) {
  const extra = punteada ? { strokeWidth: 0.8, strokeDasharray: "4 3" } : { strokeWidth: 0.5 };
  return (
    <>
      <polygon points={pts([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]])} fill={c.front} stroke={c.st} {...extra} />
      <polygon points={pts([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]])} fill={c.top} stroke={c.st} {...extra} />
      <polygon points={pts([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]])} fill={c.right} stroke={c.st} {...extra} />
    </>
  );
}

function Rotulo({ x, y, texto, ancla = "middle" }) {
  const w = texto.length * 6.3 + 14;
  const rx = ancla === "middle" ? x - w / 2 : ancla === "end" ? x - w : x;
  return (
    <g>
      <rect x={rx} y={y - 14} width={w} height={20} rx={5} fill="#fff" stroke="#cbd5e1" />
      <text x={rx + w / 2} y={y} textAnchor="middle" fontSize="11.5" fontWeight="600" fill="#0f172a">{texto}</text>
    </g>
  );
}

/** Arma las filas (cargadas + estimadas) a partir de las líneas de la remisión y del avance. */
function armarEstiba(lineas = [], avance = []) {
  const conFila = lineas.filter(l => l.LineaContenedor != null && l.LineaContenedor > 0);

  // Color estable por presentación: el orden alfabético del código no cambia con cada escaneo.
  const presentaciones = [...new Set([...conFila.map(l => l.Presentacion), ...avance.map(a => a.Presentacion)].filter(Boolean))].sort();
  const color = Object.fromEntries(presentaciones.map((p, i) => [p, PALETA[i % PALETA.length]]));
  const nombrePres = {};
  for (const a of avance) if (a.Presentacion) nombrePres[a.Presentacion] = corta(a.DescripcionPresentacion ?? a.Presentacion);
  for (const l of conFila) nombrePres[l.Presentacion] = corta(l.DescripcionPresentacion);

  const porFila = new Map();
  for (const l of conFila) {
    const n = Number(l.LineaContenedor);
    if (!porFila.has(n)) porFila.set(n, []);
    porFila.get(n).push(l);   // ya vienen en orden de escaneo (ORDER BY LineaContenedor, DetalleId)
  }
  const ultima = porFila.size ? Math.max(...porFila.keys()) : 0;

  const filas = [];
  for (let n = 1; n <= ultima; n++) {
    const items = porFila.get(n) ?? [];
    const cuenta = {};
    for (const it of items) cuenta[it.Presentacion] = (cuenta[it.Presentacion] ?? 0) + 1;
    const dominante = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const caja = cajaDe(dominante);
    filas.push({ n, items, caja, plan: Math.max(caja.porFila, items.length), estimada: false });
  }

  // Lo que falta, por línea de la proforma. El Despachado del avance ya incluye esta remisión.
  const faltan = avance
    .filter(a => !a.Anulada && a.Objetivo != null)
    .map(a => ({ ...a, Falta: Math.max(0, a.Objetivo - a.Despachado) }))
    .filter(a => a.Falta > 0);
  const faltaTotal = faltan.reduce((s, a) => s + a.Falta, 0);

  // Filas que faltan: primero se completa la última fila empezada; lo demás se reparte en filas
  // nuevas según cuántas caben de cada presentación (las sueltas van encima, como las muestras).
  const ult = filas[filas.length - 1];
  let hueco = ult ? Math.max(0, ult.plan - ult.items.length) : 0;
  const resto = {};
  for (const a of faltan) resto[a.Presentacion] = (resto[a.Presentacion] ?? 0) + a.Falta;
  const presUlt = ult?.items.length ? ult.items[ult.items.length - 1].Presentacion : null;
  for (const p of [presUlt, ...Object.keys(resto).sort((a, b) => resto[b] - resto[a])]) {
    if (!p || !resto[p] || hueco <= 0) continue;
    const usa = Math.min(hueco, resto[p]);
    resto[p] -= usa; hueco -= usa;
  }
  const pendientes = Object.values(resto).reduce((s, v) => s + v, 0);
  if (pendientes > 0) {
    const filasNuevas = Math.ceil(Object.entries(resto).reduce((s, [p, v]) => s + v / cajaDe(p).porFila, 0) - 1e-9);
    const mayor = Object.keys(resto).sort((a, b) => resto[b] - resto[a])[0];
    const caja = cajaDe(mayor);
    let quedan = pendientes;
    for (let i = 0; i < filasNuevas; i++) {
      const plan = i === filasNuevas - 1 ? quedan : Math.min(caja.porFila, quedan);
      filas.push({ n: ultima + i + 1, items: [], caja, plan, estimada: true });
      quedan -= plan;
    }
  }

  let x = 0;
  for (const f of filas) { f.x0 = x; x += f.caja.fondo; }

  return {
    filas, color, nombrePres, faltan, faltaTotal, sinFila: lineas.length - conFila.length,
    cargados: conFila.length, kg: lineas.reduce((s, l) => s + (l.PesoMasterKG ?? 0), 0),
    largoUsado: x, filasConCarga: filas.filter(f => f.items.length).length,
  };
}

function DibujoContenedor({ estiba }) {
  const { filas, color } = estiba;
  const { largo: L, ancho: W, alto: H } = CONTENEDOR;
  const usado = estiba.largoUsado;
  const piezas = [];

  for (const f of filas) {
    const off = (W - POR_CAMA * f.caja.ancho) / 2;
    if (f.items.length < f.plan) {
      // Lo que falta de la fila (o la fila completa si todavía no empieza), en punteado.
      const alto = Math.ceil(Math.min(f.plan, 12 * POR_CAMA) / POR_CAMA) * f.caja.alto;
      piezas.push(<Caja key={`g${f.n}`} b={[f.x0, off, 0, f.x0 + f.caja.fondo, off + POR_CAMA * f.caja.ancho, alto]} c={FANTASMA} punteada />);
    }
    const cajas = f.items.map((it, i) => {
      const cama = Math.floor(i / POR_CAMA), col = POR_CAMA - 1 - (i % POR_CAMA);
      return { b: [f.x0, off + col * f.caja.ancho, cama * f.caja.alto, f.x0 + f.caja.fondo, off + (col + 1) * f.caja.ancho, (cama + 1) * f.caja.alto], c: color[it.Presentacion] ?? PALETA[0] };
    });
    // Pintor: primero lo del fondo y lo de abajo, para que lo de enfrente lo tape.
    cajas.sort((a, b) => b.b[1] - a.b[1] || a.b[2] - b.b[2])
      .forEach((c, i) => piezas.push(<Caja key={`${f.n}-${i}`} b={c.b} c={c.c} />));
  }

  const a = P(0, 0, 0), b = P(Math.min(usado, L + 60), 0, 0), c = P(L, 0, 0);
  const [fx1, fy1] = P(360, W, H + 30), [fx2, fy2] = P(760, W, H + 30);
  const libre = L - usado;

  return (
    <svg viewBox="0 0 1080 530" className="w-full h-auto" fontFamily="inherit" role="img"
      aria-label={`Contenedor con ${estiba.cargados} masters cargados en ${estiba.filasConCarga} filas`}>
      <defs>
        <marker id="estiba-punta" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#64748b" /></marker>
      </defs>
      {/* Piso, pared del fondo del dibujo y pared del equipo de frío */}
      <polygon points={pts([[0, 0, 0], [L, 0, 0], [L, W, 0], [0, W, 0]])} fill="#e2e8f0" stroke="#94a3b8" />
      {Array.from({ length: 11 }, (_, i) => {
        const [x1, y1] = P((i + 1) * 100, 0, 0), [x2, y2] = P((i + 1) * 100, W, 0);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#cbd5e1" strokeWidth="0.6" />;
      })}
      <polygon points={pts([[0, W, 0], [L, W, 0], [L, W, H], [0, W, H]])} fill="#f8fafc" stroke="#cbd5e1" />
      <polygon points={pts([[0, 0, 0], [0, W, 0], [0, W, H], [0, 0, H]])} fill="#cbd5e1" stroke="#94a3b8" />
      <polygon points={pts([[0, 40, 60], [0, W - 40, 60], [0, W - 40, H - 40], [0, 40, H - 40]])} fill="#b6c2d1" stroke="#94a3b8" />

      {piezas}

      {/* Marco de la puerta y borde del piso */}
      <polygon points={pts([[L, 0, 0], [L, W, 0], [L, W, H], [L, 0, H]])} fill="none" stroke="#475569" strokeWidth="2.5" />
      <line x1={a[0]} y1={a[1]} x2={c[0]} y2={c[1]} stroke="#475569" strokeWidth="2.5" />

      {/* Número de fila */}
      {filas.map(f => {
        const [cx, cy] = P(f.x0 + f.caja.fondo / 2, 0, 0);
        const col = f.items.length ? (color[f.items[0].Presentacion] ?? PALETA[0]).sol : "#94a3b8";
        const llena = f.items.length > 0;
        return (
          <g key={`n${f.n}`}>
            <title>{`Fila ${f.n}: ${f.items.length} de ${f.plan}${f.estimada ? " (estimada)" : ""}`}</title>
            <circle cx={cx} cy={cy + 20} r={10.5} fill={llena ? col : "#fff"} stroke={col} strokeWidth="1.6" />
            <text x={cx} y={cy + 24} textAnchor="middle" fontSize="11" fontWeight="700" fill={llena ? "#fff" : col}>{f.n}</text>
          </g>
        );
      })}

      {/* Cota del largo y espacio libre en la puerta */}
      <line x1={a[0]} y1={a[1] + 44} x2={b[0]} y2={b[1] + 44} stroke="#64748b" strokeWidth="1.2" />
      <line x1={a[0]} y1={a[1] + 38} x2={a[0]} y2={a[1] + 50} stroke="#64748b" />
      <line x1={b[0]} y1={b[1] + 38} x2={b[0]} y2={b[1] + 50} stroke="#64748b" />
      {libre > 0 && (
        <>
          <line x1={b[0]} y1={b[1] + 44} x2={c[0]} y2={c[1] + 44} stroke="#dc2626" strokeWidth="1.2" strokeDasharray="3 2" />
          <line x1={c[0]} y1={c[1] + 38} x2={c[0]} y2={c[1] + 50} stroke="#dc2626" />
          <Rotulo x={c[0] + 6} y={c[1] + 70} texto={`${num(libre)} cm libres`} ancla="end" />
        </>
      )}
      <Rotulo x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2 + 66}
        texto={`${filas.length} filas = ${num(usado / 100, 2)} m de ${num(L / 100, 2)} m`} />
      <Rotulo x={P(0, W, H)[0] - 4} y={P(0, W, H)[1] - 10} texto="FONDO · equipo de frío · aquí empieza la fila 1" ancla="start" />
      <Rotulo x={P(L, W, H)[0] + 4} y={P(L, W, H)[1] - 10} texto="PUERTAS" ancla="end" />
      <line x1={fx1} y1={fy1} x2={fx2} y2={fy2} stroke="#64748b" strokeWidth="1.6" markerEnd="url(#estiba-punta)" />
      <text x={(fx1 + fx2) / 2} y={(fy1 + fy2) / 2 - 12} textAnchor="middle" fontSize="11.5" fill="#475569">se carga del fondo hacia la puerta</text>
    </svg>
  );
}

export default function EstibaContenedor({ remisionId, onCerrar }) {
  const [remision, setRemision] = useState(null);
  const [avance, setAvance] = useState([]);
  const [error, setError] = useState("");
  const [actualizado, setActualizado] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/remisiones/${remisionId}`, { headers: authHeader() });
      if (!res.ok) throw new Error("No se pudo leer la remisión");
      const r = await res.json();
      let av = [];
      if (r.CodigoPedido) {
        const ra = await fetch(`/api/detalle-pedido/avance?pedido=${encodeURIComponent(r.CodigoPedido)}`, { headers: authHeader() });
        if (ra.ok) av = await ra.json();
      }
      setRemision(r);
      setAvance(Array.isArray(av) ? av : []);
      setError("");
      setActualizado(new Date());
    } catch (e) {
      // Se queda con el último dibujo bueno: un tropiezo de red no debe dejar la pantalla en blanco.
      setError(e.message || "Sin conexión");
    }
  }, [remisionId]);

  useEffect(() => {
    cargar();
    const t = setInterval(() => { if (!document.hidden) cargar(); }, REFRESCO_MS);
    return () => clearInterval(t);
  }, [cargar]);

  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onCerrar]);

  const estiba = remision ? armarEstiba(remision.Lineas, avance) : null;
  const total = estiba ? estiba.cargados + estiba.faltaTotal : 0;
  const pct = total ? Math.round((estiba.cargados / total) * 100) : 0;
  const filasEst = estiba?.filas.length ?? 0;
  const libre = estiba ? CONTENEDOR.largo - estiba.largoUsado : 0;
  const enCurso = estiba?.filas.filter(f => f.items.length).slice(-1)[0];
  const uniq = (a) => [...new Set(a)];

  const kpis = estiba ? [
    { l: "Masters cargados", v: num(estiba.cargados), s: total ? `de ${num(total)} · ${pct} %` : "", p: total ? pct : null },
    { l: "Filas con carga", v: num(estiba.filasConCarga), s: `de ${filasEst}${estiba.filas.some(f => f.estimada) ? " (estimado)" : ""}`, p: filasEst ? (estiba.filasConCarga / filasEst) * 100 : null },
    { l: "Kg neto cargado", v: num(estiba.kg), s: "kg" },
    { l: "Faltan", v: num(estiba.faltaTotal), s: "masters según la proforma" },
    { l: "Libre en la puerta al terminar", v: libre >= 0 ? `${num(libre)} cm` : "No cabe", s: libre >= 0 ? "estimado" : `faltan ${num(-libre)} cm`, alerta: libre < 0 },
  ] : [];

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-2 sm:p-4" onClick={onCerrar}>
      <div className="bg-slate-50 rounded-xl shadow-xl w-full min-w-0 max-w-7xl max-h-full flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-3 sm:px-5 py-3 border-b border-gray-200 bg-white rounded-t-xl shrink-0">
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold text-gray-800">Estiba · {remision?.Folio ?? `#${remisionId}`}</h3>
            <p className="text-xs text-gray-500">
              Cada fila es la línea que se marca al escanear · fila 1 = fondo del contenedor ·{" "}
              {actualizado ? `actualizado ${actualizado.toLocaleTimeString("es-GT", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}, se actualiza solo` : "cargando…"}
              {error && <span className="ml-1 text-red-600 font-medium">· {error}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {enCurso && estiba.faltaTotal > 0 && (
              <span className="hidden sm:inline text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200">En carga · fila {enCurso.n}</span>
            )}
            {estiba && estiba.faltaTotal === 0 && estiba.cargados > 0 && (
              <span className="hidden sm:inline text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-800 border border-green-200">Proforma completa</span>
            )}
            <button onClick={cargar} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 transition">Actualizar</button>
            <button onClick={onCerrar} className="text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg p-2 text-xl leading-none transition">&times;</button>
          </div>
        </div>

        <div className="overflow-y-auto overflow-x-hidden p-3 sm:p-4">
          {!estiba ? <p className="text-sm text-gray-400 p-6 text-center">{error || "Cargando…"}</p> : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-3">
                {kpis.map(k => (
                  <div key={k.l} className="bg-white border border-gray-200 rounded-lg px-3 py-2 min-w-0">
                    <p className="text-xs text-gray-500 truncate">{k.l}</p>
                    <p className={`text-xl font-bold tabular-nums ${k.alerta ? "text-red-600" : "text-gray-900"}`}>{k.v}</p>
                    <p className="text-xs text-gray-500 truncate" title={k.s}>{k.s || " "}</p>
                    {k.p != null && <div className="mt-1 h-1.5 rounded bg-gray-100 overflow-hidden"><div className="h-full bg-teal-600" style={{ width: `${Math.min(100, k.p)}%` }} /></div>}
                  </div>
                ))}
              </div>

              <div className="grid gap-3 mt-3 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px]">
                <div className="bg-white border border-gray-200 rounded-lg min-w-0">
                  <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-200">
                    <p className="text-sm font-semibold text-gray-800">{CONTENEDOR.nombre} · carga directa al piso</p>
                    <p className="text-xs text-gray-500 hidden sm:block">fondo a la izquierda, puertas a la derecha</p>
                  </div>
                  <DibujoContenedor estiba={estiba} />
                  <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 border-t border-gray-200 text-xs text-gray-700">
                    {Object.entries(estiba.color).map(([p, c]) => (
                      <span key={p}><i className="inline-block w-3 h-3 rounded-sm mr-1 align-[-2px]" style={{ background: c.front }} />{estiba.nombrePres[p] ?? p}</span>
                    ))}
                    <span><i className="inline-block w-3 h-3 rounded-sm mr-1 align-[-2px] border border-dashed border-slate-400" />Pendiente (estimado)</span>
                  </div>
                  {estiba.faltan.length > 0 && (
                    <div className="px-3 py-2 border-t border-gray-200">
                      <p className="text-xs font-semibold text-gray-700 mb-1.5">Falta por cargar, según la proforma</p>
                      <div className="flex flex-wrap gap-1.5">
                        {estiba.faltan.map(a => (
                          <span key={a.DetalleId} className="text-xs px-2.5 py-1 rounded-full border border-gray-200 bg-slate-50">
                            <i className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5 align-[-1px]" style={{ background: (estiba.color[a.Presentacion] ?? PALETA[0]).front }} />
                            {a.DescripcionTalla ?? a.Talla} · {estiba.nombrePres[a.Presentacion] ?? a.Presentacion} · <b>{num(a.Falta)}</b>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="px-3 pb-2 text-[11px] text-gray-400">
                    Medidas de caja y masters por fila provisionales: 5/3 kg 42 × 30 × 34 cm (46 por fila); las demás 52 × 31 × 19 cm (82 por fila).
                    {estiba.sinFila > 0 && ` · ${estiba.sinFila} master(s) sin línea de contenedor no se dibujan.`}
                  </p>
                </div>

                <div className="bg-white border border-gray-200 rounded-lg min-w-0">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
                    <p className="text-sm font-semibold text-gray-800">Por fila</p>
                    <p className="text-xs text-gray-500">cargado / cabe</p>
                  </div>
                  <table className="w-full text-xs table-fixed">
                    <colgroup><col className="w-10" /><col className="w-[110px]" /><col /><col className="w-[92px]" /></colgroup>
                    <thead className="text-gray-500">
                      <tr className="border-b border-gray-200">
                        <th className="px-2 py-1.5 text-left font-semibold">Fila</th>
                        <th className="px-2 py-1.5 text-left font-semibold">Producto</th>
                        <th className="px-2 py-1.5 text-left font-semibold">Lotes</th>
                        <th className="px-2 py-1.5 text-right font-semibold">Masters</th>
                      </tr>
                    </thead>
                    <tbody>
                      {estiba.filas.map(f => {
                        const pres = uniq(f.items.map(i => i.Presentacion));
                        const lotes = uniq(f.items.map(i => i.Lote));
                        const col = f.items.length ? (estiba.color[f.items[0].Presentacion] ?? PALETA[0]).sol : "#cbd5e1";
                        const curso = f === enCurso && f.items.length < f.plan;
                        return (
                          <tr key={f.n} className={`border-b border-gray-100 ${f.items.length ? "" : "text-gray-400"} ${curso ? "bg-amber-50" : ""}`}>
                            <td className="px-2 py-1">
                              <span className="inline-block w-5 h-5 leading-5 text-center rounded-full text-white font-bold text-[11px]" style={{ background: col }}>{f.n}</span>
                            </td>
                            <td className="px-2 py-1 truncate" title={pres.map(p => estiba.nombrePres[p] ?? p).join(" + ")}>
                              {f.items.length ? pres.map(p => estiba.nombrePres[p] ?? p).join(" + ") : (f.estimada ? "estimada" : "—")}
                            </td>
                            <td className="px-2 py-1 truncate font-mono" title={lotes.join(", ")}>{lotes.join(", ") || "—"}</td>
                            <td className="px-2 py-1 text-right tabular-nums">
                              {f.items.length ? <b className="text-gray-900">{f.items.length}</b> : "0"} / {f.plan}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-300 font-bold">
                        <td className="px-2 py-1.5" colSpan={3}>Total</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{num(estiba.cargados)} / {num(total)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
