import { useState, useEffect } from "react";
import MateriaPrimaPage from "./MateriaPrimaPage.jsx";
import PesajePage from "./PesajePage.jsx";
import ReporteProduccionPage from "./ReporteProduccionPage.jsx";
import MesasHoyPage from "./MesasHoyPage.jsx";
import { usePuede } from "../context/AuthContext.jsx";

// "Por Mesa" pide `mesas.reporte`, no `destajo.ver`: la consultan supervisores que no necesariamente
// capturan materia prima ni pesaje. Quien tiene solo uno de los dos permisos ve solo sus pestañas.
const TABS = [
  { key: "materiaPrima", label: "Materia Prima" },
  { key: "pesaje", label: "Pesaje por Persona" },
  { key: "reporte", label: "Reporte" },
  { key: "porMesa", label: "Por Mesa", perm: ["mesas", "reporte"] },
];

const DIAS  = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

function fechaLarga() {
  const d = new Date();
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

export default function DestajoPage() {
  const verDestajo = usePuede("destajo", "ver");
  const verMesas = usePuede("mesas", "reporte");
  const tabs = TABS.filter(t => (t.perm ? verMesas : verDestajo));
  const [tab, setTab] = useState(tabs[0]?.key);
  const [fecha, setFecha] = useState(fechaLarga());

  useEffect(() => {
    const id = setInterval(() => setFecha(fechaLarga()), 60000);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-5">
        <h2 className="text-xl font-bold text-gray-800">Destajo — Materia Prima y Pesaje</h2>
        <div className="flex items-center gap-4">
          <div className="flex gap-1 bg-gray-200 rounded-lg p-1 w-fit">
            {tabs.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition ${
                  tab === t.key ? "bg-white shadow text-blue-700" : "text-gray-600 hover:text-gray-800"
                }`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="bg-white border border-gray-300 rounded-lg px-4 py-1.5 text-sm font-semibold text-gray-700 capitalize whitespace-nowrap">
            {fecha}
          </div>
        </div>
      </div>

      {tab === "materiaPrima" && verDestajo && <MateriaPrimaPage />}
      {tab === "pesaje" && verDestajo && <PesajePage />}
      {tab === "reporte" && verDestajo && <ReporteProduccionPage />}
      {tab === "porMesa" && verMesas && <MesasHoyPage />}
    </div>
  );
}
