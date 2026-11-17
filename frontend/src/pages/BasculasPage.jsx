import { useState, useEffect, useCallback } from "react";
import { authHeader } from "../context/AuthContext.jsx";

// Básculas de empaque: qué cabezales están en línea y comandos remotos.
//
// Cada cabezal (app Báscula Puente 1.1+) avisa al servidor cada 30 s con el estado de su puerto, y en
// la respuesta recoge los comandos que se dejan aquí. Por eso un comando no se ejecuta al instante:
// tarda hasta el siguiente aviso (≤ 30 s). Si el cabezal no avisa en 15 min, el comando vence.
// Las horas vienen calculadas por la base (SegSinContacto): la del cabezal no es confiable.

const REFRESCO_MS = 10_000;

const COMANDOS = {
  REINICIAR_LECTOR: "Reiniciar lector",
  REINICIAR_SERVICIO: "Reiniciar servicio",
  VER_TRAMAS: "Ver tramas",
  BITACORA: "Pedir bitácora",
  PARAMETROS: "Parámetros",
  PRUEBA_PESO: "Prueba con pesa patrón",
  RECARGAR_PAGINA: "Recargar pantalla",
  CERRAR_SESION: "Cerrar sesión",
};

const ESTADO_CMD = {
  PENDIENTE: { t: "esperando aviso", c: "text-slate-500" },
  ENTREGADO: { t: "entregado", c: "text-blue-600" },
  OK: { t: "✓ hecho", c: "text-emerald-600" },
  ERROR: { t: "✗ error", c: "text-red-600" },
  VENCIDO: { t: "vencido", c: "text-slate-400" },
};

async function api(url, opciones = {}) {
  const res = await fetch(url, {
    ...opciones,
    headers: { "Content-Type": "application/json", ...authHeader(), ...(opciones.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function hace(seg) {
  if (seg === null || seg === undefined) return "nunca";
  if (seg < 60) return `hace ${seg} s`;
  if (seg < 3600) return `hace ${Math.floor(seg / 60)} min`;
  if (seg < 86400) return `hace ${Math.floor(seg / 3600)} h`;
  return `hace ${Math.floor(seg / 86400)} d`;
}

function duracion(seg) {
  if (!seg && seg !== 0) return "—";
  const d = Math.floor(seg / 86400), h = Math.floor((seg % 86400) / 3600), m = Math.floor((seg % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}

/** Estado combinado para la lista: conexión con el servidor + puerto de la báscula. */
function estadoDe(b) {
  if (!b.Activa) return { t: "Desactivada", punto: "bg-slate-300", c: "text-slate-400" };
  if (b.SegSinContacto === null) return { t: "Nunca se ha conectado", punto: "bg-slate-300", c: "text-slate-500" };
  if (!b.EnLinea) return { t: "Fuera de línea", punto: "bg-red-500", c: "text-red-600" };
  if (b.EstadoPuerto === "LEYENDO") return { t: "Leyendo", punto: "bg-emerald-500", c: "text-emerald-700" };
  if (b.EstadoPuerto === "ERROR") return { t: "Error de puerto", punto: "bg-red-500", c: "text-red-600" };
  return { t: "En línea, sin datos de báscula", punto: "bg-amber-500", c: "text-amber-600" };
}

/** "Empanizado · producto terminado · Ana Pérez", o "sin sesión". */
function dondeEsta(b) {
  if (!b.SesionId) return "sin sesión";
  return [b.SesionBodega ?? b.SesionArea, b.SesionModo === "PERSONA" ? "producto terminado" : "por producto", b.SesionOperadora]
    .filter(Boolean).join(" · ");
}

const inputCls ="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";

function ModalToken({ datos, onCerrar }) {
  const comando = `.\\instalar-bascula.ps1 -Ip <IP del cabezal> -Balanza ${datos.Codigo} -Token ${datos.Token} -Pin <PIN>`;
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    try { await navigator.clipboard.writeText(comando); setCopiado(true); } catch { setCopiado(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 space-y-4">
        <h3 className="text-lg font-bold">Token de {datos.Codigo}</h3>
        <p className="text-sm text-slate-600">
          Se muestra <b>una sola vez</b>. Úselo en el instalador de la app en el cabezal (carpeta BasculaPuente).
          Si se pierde, genere uno nuevo: el anterior deja de servir.
        </p>
        <pre className="bg-slate-900 text-emerald-200 rounded-lg p-3 text-xs whitespace-pre-wrap break-all">{comando}</pre>
        <div className="flex justify-end gap-2">
          <button onClick={copiar} className="px-4 py-2 rounded-lg border text-sm">{copiado ? "Copiado ✓" : "Copiar comando"}</button>
          <button onClick={onCerrar} className="px-4 py-2 rounded-lg bg-blue-700 text-white text-sm font-semibold">Listo</button>
        </div>
      </div>
    </div>
  );
}

function ModalRegistrar({ bodegas, onCerrar, onRegistrada }) {
  const [f, setF] = useState({ Codigo: "", Nombre: "" });
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const guardar = async (e) => {
    e.preventDefault();
    setEnviando(true); setError("");
    try {
      const r = await api("/api/balanzas", { method: "POST", body: JSON.stringify(f) });
      onRegistrada(r);
    } catch (err) { setError(err.message); setEnviando(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCerrar}>
      <form onSubmit={guardar} onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-3">
        <h3 className="text-lg font-bold">Registrar báscula</h3>
        <label className="block text-sm text-slate-600">Código
          <input required value={f.Codigo} onChange={e => setF({ ...f, Codigo: e.target.value.toUpperCase() })}
            placeholder="BAL-02" className={inputCls + " font-mono mt-1"} />
        </label>
        <label className="block text-sm text-slate-600">Nombre (opcional)
          <input value={f.Nombre} onChange={e => setF({ ...f, Nombre: e.target.value })} placeholder="Línea 1, junto a la banda" className={inputCls + " mt-1"} />
        </label>
        <p className="text-xs text-slate-500">
          La bodega y el modo no se fijan aquí: las básculas se mueven por la planta. Salen del área en que
          entró hoy la pesadora que inicia sesión (Básculas → "Áreas que pesan").
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCerrar} className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100">Cancelar</button>
          <button disabled={enviando} className="px-4 py-2 rounded-lg bg-blue-700 text-white text-sm font-semibold disabled:opacity-50">
            {enviando ? "Registrando…" : "Registrar y ver token"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ResultadoComando({ c }) {
  const [abierto, setAbierto] = useState(false);
  if (!c.Resultado) return null;
  let cuerpo = c.Resultado;
  try {
    const j = JSON.parse(c.Resultado);
    if (Array.isArray(j?.lineas)) cuerpo = j.lineas.join("\n");
    else if (typeof j === "string") cuerpo = j;
    else cuerpo = JSON.stringify(j, null, 2);
  } catch { /* texto plano */ }
  const corto = cuerpo.length < 80 && !cuerpo.includes("\n");
  if (corto) return <p className="text-xs text-slate-600 mt-0.5 break-words">{cuerpo}</p>;
  return (
    <div className="mt-1">
      <button onClick={() => setAbierto(!abierto)} className="text-xs text-blue-600 hover:underline">{abierto ? "ocultar" : "ver resultado"}</button>
      {abierto && <pre className="mt-1 max-h-64 overflow-auto bg-slate-900 text-slate-100 rounded p-2 text-[11px] whitespace-pre-wrap">{cuerpo}</pre>}
    </div>
  );
}

function Panel({ b, bodegas, puedeConfigurar, puedeComandos, onCambio, onToken }) {
  const [f, setF] = useState(null);
  const [param, setParam] = useState({ muestras: "", tolerancia: "" });
  const [patron, setPatron] = useState("1000");
  const [comandos, setComandos] = useState([]);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setF({ Nombre: b.Nombre, Activa: b.Activa });
    setParam({ muestras: String(b.Parametros?.muestras ?? 4), tolerancia: String(b.Parametros?.tolerancia ?? 2) });
    setMsg(""); setError("");
    // Solo al cambiar de báscula: no se pisa lo que el usuario está escribiendo en cada refresco.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.Codigo]);

  const cargarComandos = useCallback(async () => {
    try { setComandos(await api(`/api/balanzas/${encodeURIComponent(b.Codigo)}/comandos`)); } catch { /* siguiente vuelta */ }
  }, [b.Codigo]);
  useEffect(() => {
    cargarComandos();
    const id = setInterval(cargarComandos, 5000);
    return () => clearInterval(id);
  }, [cargarComandos]);

  const enviar = async (Tipo, Datos) => {
    setMsg(""); setError("");
    try {
      await api(`/api/balanzas/${encodeURIComponent(b.Codigo)}/comandos`, { method: "POST", body: JSON.stringify({ Tipo, Datos }) });
      setMsg(`${COMANDOS[Tipo]}: se entrega en el próximo aviso del cabezal (≤ 30 s).`);
      cargarComandos();
    } catch (e) { setError(e.message); }
  };

  const guardar = async () => {
    setMsg(""); setError("");
    try {
      await api(`/api/balanzas/${encodeURIComponent(b.Codigo)}`, { method: "PUT", body: JSON.stringify(f) });
      setMsg("Guardado."); onCambio();
    } catch (e) { setError(e.message); }
  };

  const regenerar = async () => {
    if (!window.confirm(`¿Generar un token nuevo para ${b.Codigo}? El cabezal deja de conectarse hasta reinstalar la app con el token nuevo.`)) return;
    try { onToken(await api(`/api/balanzas/${encodeURIComponent(b.Codigo)}/token`, { method: "POST" })); } catch (e) { setError(e.message); }
  };

  const est = estadoDe(b);
  const sinComandos = !puedeComandos || !b.Activa;
  if (!f) return null;

  return (
    <aside className="w-full lg:w-[420px] shrink-0 bg-white rounded-xl border flex flex-col">
      <div className="px-5 py-4 border-b">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono font-bold text-xl">{b.Codigo}</span>
          <span className={`w-2.5 h-2.5 rounded-full ${est.punto}`} />
          <span className={`text-sm ${est.c}`}>{est.t}{b.EnLinea && b.UltimoPesoG !== null ? ` · ${b.UltimoPesoG.toLocaleString("es")} g` : ""}</span>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Último aviso {hace(b.SegSinContacto)}
          {b.IpLocal && ` · IP ${b.IpLocal}`}{b.VersionApp && ` · app ${b.VersionApp}`}
          {b.Equipo && ` · ${b.Equipo}`}{b.EncendidoSeg ? ` · encendido hace ${duracion(b.EncendidoSeg)}` : ""}
        </p>
        {b.DetallePuerto && <p className="text-xs text-amber-700 mt-1">{b.DetallePuerto}</p>}
        <p className="text-xs text-slate-500 mt-1">Pantallas de pesaje conectadas: {b.PaginasConectadas ?? "—"}</p>
      </div>

      <div className="px-5 py-4 border-b space-y-3 text-sm">
        <h3 className="font-semibold">Equipo</h3>
        <label className="block text-slate-500 text-xs">Nombre
          <input disabled={!puedeConfigurar} value={f.Nombre} onChange={e => setF({ ...f, Nombre: e.target.value })} className={inputCls + " mt-1"} />
        </label>
        <p className="text-xs text-slate-500">
          Dónde está ahora: <b>{dondeEsta(b)}</b>. La bodega y el modo los trae la pesadora al pasar su carnet
          (según el área en que entró hoy).
        </p>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" disabled={!puedeConfigurar} checked={f.Activa} onChange={e => setF({ ...f, Activa: e.target.checked })} />
          Activa (desactivada, el cabezal deja de ser aceptado)
        </label>
        {puedeConfigurar && (
          <div className="flex gap-2">
            <button onClick={guardar} className="flex-1 py-2 rounded-lg bg-blue-700 text-white font-medium">Guardar</button>
            <button onClick={regenerar} className="px-3 py-2 rounded-lg border text-xs">Token nuevo</button>
          </div>
        )}
      </div>

      {puedeComandos && (
        <div className="px-5 py-4 border-b space-y-3 text-sm">
          <h3 className="font-semibold">Parámetros del lector</h3>
          <div className="grid grid-cols-3 gap-2 items-end">
            <label className="text-slate-500 text-xs">Lecturas p/ estable
              <input value={param.muestras} onChange={e => setParam({ ...param, muestras: e.target.value })} className={inputCls + " mt-1"} />
            </label>
            <label className="text-slate-500 text-xs">Tolerancia (± g)
              <input value={param.tolerancia} onChange={e => setParam({ ...param, tolerancia: e.target.value })} className={inputCls + " mt-1"} />
            </label>
            <button disabled={sinComandos} onClick={() => enviar("PARAMETROS", { muestras: Number(param.muestras), tolerancia: Number(param.tolerancia) })}
              className="py-2 rounded-lg bg-blue-700 text-white font-medium disabled:opacity-40">Enviar</button>
          </div>
          <h3 className="font-semibold pt-1">Comandos</h3>
          <div className="grid grid-cols-2 gap-2">
            {["REINICIAR_LECTOR", "REINICIAR_SERVICIO", "VER_TRAMAS", "BITACORA", "RECARGAR_PAGINA", "CERRAR_SESION"].map(t => (
              <button key={t} disabled={sinComandos} onClick={() => enviar(t)}
                className={`py-2 rounded-lg border disabled:opacity-40 ${t === "CERRAR_SESION" ? "text-red-600 border-red-200" : ""}`}>{COMANDOS[t]}</button>
            ))}
          </div>
          <div className="flex gap-2 items-end">
            <label className="flex-1 text-slate-500 text-xs">Pesa patrón (g)
              <input value={patron} onChange={e => setPatron(e.target.value)} className={inputCls + " mt-1"} />
            </label>
            <button disabled={sinComandos} onClick={() => enviar("PRUEBA_PESO", { patronG: Number(patron) })}
              className="px-3 py-2 rounded-lg border disabled:opacity-40">Probar peso</button>
          </div>
        </div>
      )}

      {(msg || error) && (
        <p className={`px-5 py-2 text-xs ${error ? "text-red-600" : "text-emerald-700"}`}>{error || msg}</p>
      )}

      <div className="px-5 py-4 flex-1">
        <h3 className="font-semibold text-sm mb-2">Historial de comandos</h3>
        {comandos.length === 0 ? <p className="text-xs text-slate-400">Sin comandos todavía.</p> : (
          <ul className="space-y-2">
            {comandos.map(c => {
              const e = ESTADO_CMD[c.Estado] ?? { t: c.Estado, c: "" };
              const sinRespuesta = c.Estado === "ENTREGADO" && c.SegDesdeEntrega > 120;
              return (
                <li key={c.ComandoId} className="text-xs border-b border-slate-100 pb-2">
                  <div className="flex gap-2">
                    <span className="text-slate-400 w-16 shrink-0">{c.CreadoEn?.slice(11, 16)}</span>
                    <span className="flex-1">
                      {COMANDOS[c.Tipo] ?? c.Tipo}
                      {c.Datos && <span className="text-slate-400"> {JSON.stringify(c.Datos)}</span>}
                      <span className="text-slate-400"> · {c.CreadoPor}</span>
                    </span>
                    <span className={sinRespuesta ? "text-amber-600" : e.c}>{sinRespuesta ? "sin respuesta" : e.t}</span>
                  </div>
                  <div className="pl-[4.5rem]"><ResultadoComando c={c} /></div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

function Equipos({ puedeConfigurar, puedeComandos }) {
  const [datos, setDatos] = useState({ balanzas: [], segEnLinea: 120 });
  const [bodegas, setBodegas] = useState([]);
  const [sel, setSel] = useState(null);
  const [error, setError] = useState("");
  const [registrar, setRegistrar] = useState(false);
  const [token, setToken] = useState(null);

  const cargar = useCallback(async () => {
    try { setDatos(await api("/api/balanzas")); setError(""); } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => {
    cargar();
    const id = setInterval(cargar, REFRESCO_MS);
    return () => clearInterval(id);
  }, [cargar]);

  useEffect(() => {
    api("/api/bodegas").then(r => setBodegas(r.filter(b => b.Activo))).catch(() => {});
  }, []);

  const lista = datos.balanzas;
  const activas = lista.filter(b => b.Activa);
  const leyendo = activas.filter(b => b.EnLinea && b.EstadoPuerto === "LEYENDO").length;
  const sinDatos = activas.filter(b => b.EnLinea && b.EstadoPuerto !== "LEYENDO").length;
  const fuera = activas.filter(b => !b.EnLinea).length;
  const elegida = lista.find(b => b.Codigo === sel);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border p-4"><p className="text-xs text-slate-500">En línea y leyendo</p><p className="text-3xl font-bold text-emerald-600">{leyendo}</p></div>
        <div className="bg-white rounded-xl border p-4"><p className="text-xs text-slate-500">En línea, báscula sin datos</p><p className="text-3xl font-bold text-amber-500">{sinDatos}</p></div>
        <div className="bg-white rounded-xl border p-4"><p className="text-xs text-slate-500">Fuera de línea (&gt; {Math.round(datos.segEnLinea / 60)} min sin aviso)</p><p className="text-3xl font-bold text-red-600">{fuera}</p></div>
        <div className="bg-white rounded-xl border p-4"><p className="text-xs text-slate-500">Registradas</p><p className="text-3xl font-bold text-slate-800">{lista.length}</p></div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <div className="flex-1 min-w-0 bg-white rounded-xl border overflow-hidden w-full">
          <div className="px-4 py-3 border-b flex items-center gap-3 flex-wrap">
            <h2 className="font-semibold">Equipos</h2>
            <span className="text-xs text-slate-500">el cabezal avisa cada 30 s · esta lista se actualiza sola</span>
            {puedeConfigurar && (
              <button onClick={() => setRegistrar(true)} className="ml-auto px-3 py-1.5 text-sm rounded-lg bg-blue-700 text-white">+ Registrar báscula</button>
            )}
          </div>
          {lista.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">Todavía no hay básculas registradas.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm table-fixed min-w-[880px]">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-2 w-24">Código</th>
                    <th className="text-left px-2 w-56">Dónde está ahora</th>
                    <th className="text-left px-2 w-48">Estado</th>
                    <th className="text-left px-2 w-24">Aviso</th>
                    <th className="text-left px-2 w-32" title="La reporta el cabezal en cada aviso: si el DHCP la cambia, aquí se ve la nueva">IP</th>
                    <th className="text-right px-2 w-20">Peso</th>
                    <th className="text-left px-4 w-20">Versión</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {lista.map(b => {
                    const est = estadoDe(b);
                    return (
                      <tr key={b.Codigo} onClick={() => setSel(b.Codigo)}
                        className={`cursor-pointer hover:bg-slate-50 ${sel === b.Codigo ? "bg-blue-50" : ""} ${b.Activa ? "" : "opacity-60"}`}>
                        <td className="px-4 py-2.5 font-mono font-semibold truncate">{b.Codigo}</td>
                        {/* Se llenará con la sesión de la pesadora (bodega · modo · nombre). */}
                        <td className={`px-2 truncate ${b.SesionId ? "text-slate-800" : "text-slate-400"}`} title={b.Nombre}>{dondeEsta(b)}</td>
                        <td className="px-2 truncate"><span className={`inline-flex items-center gap-1.5 ${est.c}`}><span className={`w-2 h-2 rounded-full shrink-0 ${est.punto}`} />{est.t}</span></td>
                        <td className={`px-2 truncate ${b.Activa && !b.EnLinea ? "text-red-600" : "text-slate-500"}`}>{hace(b.SegSinContacto)}</td>
                        <td className="px-2 font-mono text-slate-600 truncate" title={b.EnLinea ? "IP actual" : "Última IP conocida"}>{b.IpLocal ?? "—"}{b.IpLocal && !b.EnLinea ? " ?" : ""}</td>
                        <td className="px-2 text-right font-mono">{b.EnLinea && b.UltimoPesoG !== null ? `${b.UltimoPesoG.toLocaleString("es")} g` : "—"}</td>
                        <td className="px-4 text-slate-500 truncate">{b.VersionApp ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {elegida && (
          <Panel b={elegida} bodegas={bodegas} puedeConfigurar={puedeConfigurar} puedeComandos={puedeComandos}
            onCambio={cargar} onToken={setToken} />
        )}
      </div>

      {registrar && (
        <ModalRegistrar bodegas={bodegas} onCerrar={() => setRegistrar(false)}
          onRegistrada={(r) => { setRegistrar(false); setToken(r); setSel(r.Codigo); cargar(); }} />
      )}
      {token && <ModalToken datos={token} onCerrar={() => setToken(null)} />}
    </div>
  );
}

// ─── Áreas que pesan ─────────────────────────────────────────────────────────────────────────
// Las básculas se mueven por la planta: la bodega y el modo no son del equipo sino del área en que
// entró hoy la pesadora. Aquí se marca qué áreas usan básculas y con qué modo; la bodega es la que
// el área ya tiene (Catálogos → Áreas).
function AreasPesaje({ puedeConfigurar }) {
  const [areas, setAreas] = useState([]);
  const [soloPesadoras, setSoloPesadoras] = useState(true);
  const [buscar, setBuscar] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(null);

  const cargar = useCallback(async () => {
    try { setAreas(await api("/api/balanzas/areas")); setError(""); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const guardar = async (a, cambios) => {
    const nuevo = { ...a, ...cambios };
    setGuardando(a.Codigo); setError("");
    setAreas(l => l.map(x => (x.Codigo === a.Codigo ? nuevo : x)));
    try {
      await api(`/api/balanzas/areas/${encodeURIComponent(a.Codigo)}`, {
        method: "PUT", body: JSON.stringify({ EsPesadora: nuevo.EsPesadora, ModoPesaje: nuevo.ModoPesaje || null, PideCarrito: nuevo.PideCarrito }),
      });
    } catch (e) { setError(`${a.Codigo}: ${e.message}`); cargar(); }
    finally { setGuardando(null); }
  };

  const q = buscar.trim().toLowerCase();
  const lista = areas.filter(a =>
    (!soloPesadoras || a.EsPesadora) &&
    (!q || a.Codigo.toLowerCase().includes(q) || a.Nombre.toLowerCase().includes(q) || (a.Grupo ?? "").toLowerCase().includes(q)));

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center gap-3 flex-wrap">
        <h2 className="font-semibold">Áreas que pesan</h2>
        <span className="text-xs text-slate-500">quien entra hoy a estas áreas puede iniciar sesión en cualquier báscula</span>
        <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={soloPesadoras} onChange={e => setSoloPesadoras(e.target.checked)} />
          Solo las que usan básculas
        </label>
        <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar área…"
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-48" />
      </div>
      {error && <p className="px-4 py-2 text-sm text-red-600">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm table-fixed min-w-[760px]">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2 w-20">Código</th>
              <th className="text-left px-2">Área</th>
              <th className="text-left px-2 w-48">Bodega (de las pesadas)</th>
              <th className="text-center px-2 w-32">Usa básculas</th>
              <th className="text-left px-4 w-64">Modo de pesaje</th>
              <th className="text-center px-2 w-32" title="Obligatorio escribir el número de carrito en cada pesada (como el termo en Pelado)">Pide carrito</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {lista.map(a => (
              <tr key={a.Codigo} className={guardando === a.Codigo ? "opacity-60" : ""}>
                <td className="px-4 py-2.5 font-mono font-semibold">{a.Codigo}</td>
                <td className="px-2 truncate" title={a.Grupo ?? ""}>{a.Nombre}</td>
                <td className="px-2 truncate">
                  {a.BodegaNombre ?? <span className="text-amber-600">sin bodega: la pesadora la elige</span>}
                </td>
                <td className="px-2 text-center">
                  <input type="checkbox" disabled={!puedeConfigurar} checked={a.EsPesadora}
                    onChange={e => guardar(a, { EsPesadora: e.target.checked, ModoPesaje: e.target.checked ? a.ModoPesaje : null, PideCarrito: e.target.checked ? a.PideCarrito : false })} />
                </td>
                <td className="px-4">
                  {a.EsPesadora ? (
                    <select disabled={!puedeConfigurar} value={a.ModoPesaje ?? ""} onChange={e => guardar(a, { ModoPesaje: e.target.value || null })}
                      className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
                      <option value="">Lo elige la pesadora al entrar</option>
                      <option value="PERSONA">Producto terminado (carnet por bandeja)</option>
                      <option value="PRODUCTO">Por producto</option>
                    </select>
                  ) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-2 text-center">
                  {a.EsPesadora ? (
                    <input type="checkbox" disabled={!puedeConfigurar} checked={a.PideCarrito} onChange={e => guardar(a, { PideCarrito: e.target.checked })} />
                  ) : <span className="text-slate-300">—</span>}
                </td>
              </tr>
            ))}
            {lista.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-sm text-slate-500">
                {soloPesadoras ? "Ninguna área usa básculas todavía. Quita el filtro para marcarlas." : "Sin resultados."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Tipos de empaque ────────────────────────────────────────────────────────────────────────
// Bruto = neto + tara + deshidratación (neto × %); rango = [bruto − margen−, bruto + margen+]. El
// cálculo lo hace el servidor (lib/empaquePesaje.ts) y aquí solo se muestra: un solo lugar con la
// fórmula. Cambiar un tipo no altera lo ya pesado: cada pesada guarda su rango.
const EMPAQUE_VACIO = { Codigo: "", Nombre: "", Unidad: "g", PesoNetoG: "", TaraG: "0", DeshidratacionPct: "0", MargenPosG: "0", MargenNegG: "0", ConRango: true, Activo: true };

function FormEmpaque({ inicial, nuevo, puedeConfigurar, onGuardado, onCancelar }) {
  const [f, setF] = useState(inicial);
  const [calc, setCalc] = useState(null);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }));

  useEffect(() => { setF(inicial); setError(""); }, [inicial]);
  useEffect(() => {
    const id = setTimeout(async () => {
      if (f.PesoNetoG === "") { setCalc(null); return; }
      try { setCalc(await api("/api/balanzas/empaques/calcular", { method: "POST", body: JSON.stringify(f) })); setError(""); }
      catch (e) { setCalc(null); setError(e.message); }
    }, 250);
    return () => clearTimeout(id);
  }, [f]);

  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true); setError("");
    try {
      if (nuevo) await api("/api/balanzas/empaques", { method: "POST", body: JSON.stringify(f) });
      else await api(`/api/balanzas/empaques/${encodeURIComponent(f.Codigo)}`, { method: "PUT", body: JSON.stringify(f) });
      onGuardado(f.Codigo.toUpperCase());
    } catch (err) { setError(err.message); }
    finally { setGuardando(false); }
  };

  const num = (k, etiqueta, sufijo) => (
    <label className="text-slate-500 text-xs">{etiqueta}
      <div className="mt-1 flex">
        <input disabled={!puedeConfigurar} value={f[k]} onChange={set(k)} inputMode="decimal"
          className="w-full border border-slate-300 rounded-l-lg px-3 py-2 text-sm text-right" />
        <span className="border border-l-0 border-slate-300 rounded-r-lg px-2 py-2 bg-slate-50 text-sm">{sufijo}</span>
      </div>
    </label>
  );

  // Barra: de (mín − 5 %) a (máx + 5 %).
  const barra = calc && (() => {
    const lo = calc.MinG * 0.97, hi = calc.MaxG * 1.03, w = hi - lo || 1;
    return { bajo: ((calc.MinG - lo) / w) * 100, ok: ((calc.MaxG - calc.MinG) / w) * 100 };
  })();

  return (
    <form onSubmit={guardar} className="flex-1 bg-white rounded-xl border p-5 space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold">{nuevo ? "Nuevo tipo de empaque" : f.Nombre || f.Codigo}</h2>
        {!nuevo && <span className={`text-xs rounded px-2 py-0.5 ${f.Activo ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{f.Activo ? "Activo" : "Inactivo"}</span>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <label className="text-slate-500 text-xs">Código
          <input required disabled={!nuevo || !puedeConfigurar} value={f.Codigo} onChange={e => setF(p => ({ ...p, Codigo: e.target.value.toUpperCase() }))}
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 font-mono text-sm disabled:bg-slate-50" placeholder="YEN650" />
        </label>
        <label className="text-slate-500 text-xs md:col-span-2">Nombre
          <input required disabled={!puedeConfigurar} value={f.Nombre} onChange={set("Nombre")}
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="YENS 650 g" />
        </label>
        <label className="text-slate-500 text-xs">Mostrar en
          <select disabled={!puedeConfigurar} value={f.Unidad} onChange={set("Unidad")} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="g">gramos (g)</option><option value="kg">kilos (kg)</option><option value="lb">libras (lb)</option>
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {num("PesoNetoG", "Peso neto", "g")}
        {num("TaraG", "Tara material", "g")}
        {num("DeshidratacionPct", "Deshidratación", "%")}
        {f.ConRango && num("MargenPosG", "Margen +", "g")}
        {f.ConRango && num("MargenNegG", "Margen −", "g")}
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" disabled={!puedeConfigurar} checked={f.ConRango} onChange={e => setF(p => ({ ...p, ConRango: e.target.checked }))} />
        Con rango (si se desmarca, el peso es libre: se guarda cualquier peso estable)
      </label>

      <div className="rounded-xl bg-slate-50 border p-4">
        {calc ? (
          <>
            <div className="flex flex-wrap items-end gap-8">
              <div><p className="text-xs text-slate-500">Deshidratación</p><p className="text-2xl font-bold">{calc.DeshidratacionG} g</p></div>
              <div><p className="text-xs text-slate-500">Peso bruto (objetivo)</p><p className="text-3xl font-bold">{calc.PesoBrutoG.toLocaleString("es")} g</p>
                <p className="text-xs text-slate-500">{calc.PesoNetoG} neto + {calc.TaraG} tara + {calc.DeshidratacionG} deshidratación</p></div>
              <div><p className="text-xs text-slate-500">Rango que se guarda</p>{calc.ConRango
                ? <p className="text-3xl font-bold text-emerald-600">{calc.MinG.toLocaleString("es")} – {calc.MaxG.toLocaleString("es")} g</p>
                : <p className="text-3xl font-bold text-slate-600">Peso libre</p>}</div>
            </div>
            {calc.ConRango && <div className="mt-4 h-9 rounded-lg overflow-hidden flex text-xs font-semibold text-white">
              <div style={{ width: `${barra.bajo}%` }} className="bg-amber-400 text-amber-950 flex items-center justify-center">BAJO</div>
              <div style={{ width: `${barra.ok}%` }} className="bg-emerald-500 flex items-center justify-center min-w-[80px]">GUARDA</div>
              <div className="flex-1 bg-red-500 flex items-center justify-center">SOBREPESO</div>
            </div>}
          </>
        ) : <p className="text-sm text-slate-500">Escriba el peso neto para ver el rango.</p>}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {puedeConfigurar && (
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={guardando} className="px-5 py-2 rounded-lg bg-blue-700 text-white font-medium disabled:opacity-50">{guardando ? "Guardando…" : "Guardar"}</button>
          {!nuevo && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={f.Activo} onChange={e => setF(p => ({ ...p, Activo: e.target.checked }))} /> Activo (aparece en la pantalla de pesaje)
            </label>
          )}
          <button type="button" onClick={onCancelar} className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100">Cancelar</button>
          <p className="text-xs text-slate-500 w-full">Cambiar el rango no toca lo ya pesado: cada pesada guarda el rango con que se pesó.</p>
        </div>
      )}
    </form>
  );
}

function TiposEmpaque({ puedeConfigurar }) {
  const [lista, setLista] = useState([]);
  const [sel, setSel] = useState(null); // código, o "__nuevo"
  const [buscar, setBuscar] = useState("");
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    try { setLista(await api("/api/balanzas/empaques")); setError(""); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const q = buscar.trim().toLowerCase();
  const filtrada = lista.filter(e => !q || e.Codigo.toLowerCase().includes(q) || e.Nombre.toLowerCase().includes(q));
  const elegido = lista.find(e => e.Codigo === sel);
  const inicial = sel === "__nuevo" ? EMPAQUE_VACIO
    : elegido ? { ...elegido, PesoNetoG: String(elegido.PesoNetoG), TaraG: String(elegido.TaraG), DeshidratacionPct: String(elegido.DeshidratacionPct),
                  MargenPosG: String(elegido.MargenPosG), MargenNegG: String(elegido.MargenNegG) } : null;

  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start">
      <div className="w-full lg:w-[460px] shrink-0 bg-white rounded-xl border overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar código o nombre…" className="flex-1 border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
          {puedeConfigurar && <button onClick={() => setSel("__nuevo")} className="px-3 py-1.5 text-sm rounded-lg bg-blue-700 text-white">+ Nuevo</button>}
        </div>
        {error && <p className="px-4 py-2 text-sm text-red-600">{error}</p>}
        {lista.length === 0 ? <p className="p-5 text-sm text-slate-500">Todavía no hay tipos de empaque.</p> : (
          <table className="w-full text-sm table-fixed">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr><th className="text-left px-4 py-2 w-24">Código</th><th className="text-left px-2">Nombre</th><th className="text-right px-2 w-20">Neto</th><th className="text-right px-4 w-28">Rango</th></tr>
            </thead>
            <tbody className="divide-y">
              {filtrada.map(e => (
                <tr key={e.Codigo} onClick={() => setSel(e.Codigo)} className={`cursor-pointer hover:bg-slate-50 ${sel === e.Codigo ? "bg-blue-50" : ""} ${e.Activo ? "" : "opacity-50"}`}>
                  <td className="px-4 py-2.5 font-mono truncate">{e.Codigo}</td>
                  <td className="px-2 truncate" title={e.Nombre}>{e.Nombre}</td>
                  <td className="px-2 text-right">{e.PesoNetoG.toLocaleString("es")} g</td>
                  <td className="px-4 text-right font-mono">{e.ConRango ? `${e.MinG}–${e.MaxG}` : "libre"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {inicial ? (
        <FormEmpaque inicial={inicial} nuevo={sel === "__nuevo"} puedeConfigurar={puedeConfigurar}
          onGuardado={(c) => { cargar(); setSel(c); }} onCancelar={() => setSel(null)} />
      ) : (
        <p className="text-sm text-slate-500 p-4">Elija un tipo de empaque o cree uno nuevo.</p>
      )}
    </div>
  );
}

const PESTANAS = [["equipos", "Equipos"], ["empaques", "Tipos de empaque"], ["areas", "Áreas que pesan"]];

export default function BasculasPage({ puedeConfigurar, puedeComandos }) {
  const [pestana, setPestana] = useState("equipos");
  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-slate-200">
        {PESTANAS.map(([k, t]) => (
          <button key={k} onClick={() => setPestana(k)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${pestana === k ? "border-blue-700 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {t}
          </button>
        ))}
      </div>
      {pestana === "equipos" && <Equipos puedeConfigurar={puedeConfigurar} puedeComandos={puedeComandos} />}
      {pestana === "empaques" && <TiposEmpaque puedeConfigurar={puedeConfigurar} />}
      {pestana === "areas" && <AreasPesaje puedeConfigurar={puedeConfigurar} />}
    </div>
  );
}
