import { useEffect, useRef, useState } from "react";
import { useBascula } from "../hooks/useBascula.js";

// Pantalla de prueba del puente con la báscula: peso en vivo y registro de cajas como lo hace
// Sofia (la caja se registra AL RETIRARLA, con el último peso estable que tuvo en el plato).
// No guarda nada en el servidor todavía: la lista vive solo en esta pantalla.

// Por debajo de esto el plato se considera vacío (ruido, tara, restos de hielo).
const UMBRAL_VACIO_G = 20;

const ESTADOS_PUERTO = {
  LEYENDO:   { texto: "Leyendo",               cls: "bg-emerald-100 text-emerald-800" },
  SIN_DATOS: { texto: "Puerto sin datos",      cls: "bg-amber-100 text-amber-800" },
  ABRIENDO:  { texto: "Abriendo puerto",       cls: "bg-sky-100 text-sky-800" },
  ERROR:     { texto: "Error de puerto",       cls: "bg-red-100 text-red-800" },
  DETENIDO:  { texto: "Lector detenido",       cls: "bg-gray-200 text-gray-700" },
};

function formatoGramos(g) {
  return g === null || g === undefined ? "—" : g.toLocaleString("es");
}

function horaCorta(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function BasculaPruebaPage() {
  const b = useBascula();
  const [cajas, setCajas] = useState([]);
  // Último peso estable mientras hay algo en el plato; se registra cuando el plato queda vacío.
  const candidatoRef = useRef(null);

  useEffect(() => {
    if (!b.vigente) return;
    if (b.gramos >= UMBRAL_VACIO_G) {
      if (b.estable) candidatoRef.current = b.gramos;
    } else if (candidatoRef.current !== null) {
      const gramos = candidatoRef.current;
      candidatoRef.current = null;
      setCajas(c => [{ n: c.length + 1, gramos, en: Date.now() }, ...c].slice(0, 50));
    }
  }, [b.vigente, b.gramos, b.estable]);

  const totalG = cajas.reduce((s, c) => s + c.gramos, 0);
  const puerto = ESTADOS_PUERTO[b.estadoPuerto] ?? { texto: "—", cls: "bg-gray-200 text-gray-700" };

  let aviso = null;
  if (!b.conectado) {
    aviso = "No hay conexión con la app Báscula Puente. Revisa que esté instalada y abierta en este equipo.";
  } else if (!b.configurada) {
    aviso = "Esta báscula no tiene código de balanza configurado. Avisa al técnico antes de pesar.";
  } else if (b.estadoPuerto && b.estadoPuerto !== "LEYENDO") {
    aviso = b.detalle || "La app está abierta, pero la báscula no está mandando datos.";
  }

  let indicador;
  if (!b.vigente) indicador = { texto: "SIN LECTURA", cls: "bg-gray-400" };
  else if (b.gramos < UMBRAL_VACIO_G) indicador = { texto: "PLATO VACÍO", cls: "bg-slate-500" };
  else if (b.estable) indicador = { texto: "ESTABLE", cls: "bg-emerald-600" };
  else indicador = { texto: "MOVIENDO", cls: "bg-amber-500" };

  return (
    <div className="min-h-screen bg-slate-100 p-4 flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold text-slate-900 mr-auto">Báscula — prueba</h1>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${b.conectado ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
          {b.conectado ? "Conectado" : "Sin conexión"}
        </span>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${puerto.cls}`}>{puerto.texto}</span>
        {b.balanza && (
          <span className="rounded-full bg-white px-3 py-1 text-sm font-medium text-slate-700 border border-slate-200">
            {b.balanza}{b.version ? ` · v${b.version}` : ""}
          </span>
        )}
      </header>

      {aviso && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">{aviso}</div>
      )}

      <section className="rounded-2xl bg-white shadow-sm border border-slate-200 p-6 flex flex-col items-center gap-4">
        <div className={`font-mono font-bold tabular-nums leading-none text-7xl sm:text-8xl ${b.vigente ? "text-slate-900" : "text-slate-300"}`}>
          {formatoGramos(b.gramos)}
          <span className="ml-2 text-3xl sm:text-4xl font-semibold text-slate-400">g</span>
        </div>
        <div className={`w-full max-w-md rounded-lg py-2 text-center text-lg font-bold tracking-wide text-white ${indicador.cls}`}>
          {indicador.texto}
        </div>
        <p className="font-mono text-xs text-slate-400">{b.trama ?? "—"}</p>
      </section>

      <section className="rounded-2xl bg-white shadow-sm border border-slate-200 p-4 flex flex-col gap-3 flex-1 min-h-0">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <h2 className="text-base font-semibold text-slate-900 mr-auto">Cajas registradas al retirarlas</h2>
          <span className="text-sm text-slate-600">
            {cajas.length} cajas · {(totalG / 1000).toLocaleString("es", { maximumFractionDigits: 3 })} kg
          </span>
          <button
            type="button"
            onClick={() => { setCajas([]); candidatoRef.current = null; }}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
          >
            Limpiar
          </button>
        </div>
        {cajas.length === 0 ? (
          <p className="text-sm text-slate-500">
            Pon una caja en la báscula, espera a que diga ESTABLE y retírala: se anota aquí con su peso.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-y-auto">
            {cajas.map(c => (
              <li key={c.en} className="flex items-center gap-4 py-2">
                <span className="w-10 text-right text-sm text-slate-400">#{c.n}</span>
                <span className="font-mono text-lg font-semibold tabular-nums text-slate-900">{formatoGramos(c.gramos)} g</span>
                <span className="ml-auto text-sm text-slate-500">{horaCorta(c.en)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-slate-400">
        Prueba local: nada de esto se guarda en el servidor. Vacío = menos de {UMBRAL_VACIO_G} g.
      </p>
    </div>
  );
}
