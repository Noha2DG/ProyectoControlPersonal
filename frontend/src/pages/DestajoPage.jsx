import { useState, useEffect } from "react";
import MateriaPrimaPage from "./MateriaPrimaPage.jsx";
import PesajePage from "./PesajePage.jsx";
import ReporteProduccionPage from "./ReporteProduccionPage.jsx";

const TABS = [
  { key: "materiaPrima", label: "Materia Prima" },
  { key: "pesaje", label: "Pesaje por Persona" },
  { key: "reporte", label: "Reporte" },
];

const DIAS  = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

function fechaLarga() {
  const d = new Date();
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

export default function DestajoPage() {
  const [tab, setTab] = useState(TABS[0].key);
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
            {TABS.map(t => (
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

      {tab === "materiaPrima" && <MateriaPrimaPage />}
      {tab === "pesaje" && <PesajePage />}
      {tab === "reporte" && <ReporteProduccionPage />}
    </div>
  );
}
