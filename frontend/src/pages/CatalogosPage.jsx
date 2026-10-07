import { useState } from "react";
import CatalogoSimpleTable from "../components/CatalogoSimpleTable.jsx";
import ClasePage from "./ClasePage.jsx";
import PresentacionPage from "./PresentacionPage.jsx";
import PiscinaCicloPage from "./PiscinaCicloPage.jsx";
import MesasPage from "./MesasPage.jsx";
import { usePuede } from "../context/AuthContext.jsx";

// Catálogos de producción agrupados en una sola pantalla con sub-navegación,
// para no llenar el menú principal de items sueltos a medida que se agreguen más.
// Pedidos, Clientes y Subclientes se movieron a la sección Pedidos (PedidosClientesPage): los usa
// a diario quien
// captura proformas, y no debía costarle acceso de escritura a Presentaciones ni a Clase.
const TABS = [
  { key: "familia", label: "Familia" },
  { key: "procesos", label: "Procesos" },
  { key: "tallas", label: "Tallas" },
  { key: "empaques", label: "Empaques" },
  { key: "clase", label: "Clase" },
  { key: "presentacion", label: "Presentaciones" },
  { key: "finca", label: "Fincas" },
  { key: "almacenes", label: "Almacenes" },
  { key: "piscina", label: "Piscinas y Ciclos" },
  { key: "origen", label: "Origen" },
  { key: "congelacion", label: "Congelación" },
  // Mesas de pelado: permiso propio `mesas`, no `catalogos` — solo la supervisora de pelado la ve.
  // Quien tenga solo `mesas` entra a Catálogos y ve únicamente esta pestaña.
  { key: "mesas", label: "Mesas de Pelado", perm: "mesas" },
];

export default function CatalogosPage() {
  const verCatalogos = usePuede("catalogos", "ver");
  const verMesas = usePuede("mesas", "ver");
  const tabs = TABS.filter(t => (t.perm === "mesas" ? verMesas : verCatalogos));
  const [tab, setTab] = useState(tabs[0]?.key);

  return (
    <div>
      <div className="flex gap-1 bg-gray-200 rounded-lg p-1 mb-5 w-fit overflow-x-auto">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition ${
              tab === t.key ? "bg-white shadow text-blue-700" : "text-gray-600 hover:text-gray-800"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "familia" && (
        <CatalogoSimpleTable api="/api/familia" pk="Codigo" pkLabel="Código" nuevoLabel="+ Nueva Familia" />
      )}
      {tab === "procesos" && (
        <CatalogoSimpleTable api="/api/procesos" pk="Proceso" pkLabel="Proceso" pkType="number" nuevoLabel="+ Nuevo Proceso" />
      )}
      {tab === "tallas" && (
        <CatalogoSimpleTable api="/api/tallas" pk="Codigo" pkLabel="Código" pkType="number" nuevoLabel="+ Nueva Talla" />
      )}
      {tab === "empaques" && (
        <CatalogoSimpleTable api="/api/empaques" pk="Codigo" pkLabel="Código" nuevoLabel="+ Nuevo Empaque"
          camposExtra={[{ campo: "TipoEmpaque", label: "Tipo de Empaque", opciones: ["Individual", "Master"] }]} />
      )}
      {tab === "clase" && <ClasePage />}
      {tab === "presentacion" && <PresentacionPage />}
      {tab === "finca" && (
        <CatalogoSimpleTable api="/api/finca" pk="Codigo" pkLabel="Código" nuevoLabel="+ Nueva Finca"
          camposExtra={[{ campo: "Grupo", label: "Grupo", requerido: false }, { campo: "Abreviatura", label: "Abreviatura" }]} />
      )}
      {tab === "almacenes" && (
        <CatalogoSimpleTable api="/api/almacenes" pk="Codigo" pkLabel="Código" nuevoLabel="+ Nuevo Almacén" />
      )}
      {tab === "piscina" && <PiscinaCicloPage />}
      {tab === "origen" && (
        <CatalogoSimpleTable api="/api/origen" pk="Codigo" pkLabel="Código" nuevoLabel="+ Nuevo Origen" />
      )}
      {tab === "congelacion" && (
        <CatalogoSimpleTable api="/api/unidades-congelacion" pk="Codigo" pkLabel="Código" nuevoLabel="+ Nueva Unidad de Congelación" />
      )}
      {tab === "mesas" && verMesas && <MesasPage />}
    </div>
  );
}
