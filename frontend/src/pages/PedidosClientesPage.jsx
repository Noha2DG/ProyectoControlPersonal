import { useState } from "react";
import PedidosPage from "./PedidosPage.jsx";
import ClientesPage from "./ClientesPage.jsx";

// Pedidos y Clientes vivían dentro de Catálogos. Se separaron porque los usa una misma persona —la
// que captura y corrige proformas— y ese trabajo es diario, mientras que el resto de los catálogos
// casi no se toca. Con `catalogos` esa persona recibía además Presentaciones, donde CajasXMaster
// define el objetivo de todos los pedidos; ver el permiso `pedidos` en middleware/auth.ts.
//
// El archivo se llama distinto de PedidosPage.jsx a propósito: esto es el cascarón con pestañas de la
// sección, y PedidosPage es la pantalla de proformas que vive dentro.
//
// Clientes va junto a Pedidos y no aparte porque son inseparables al capturar: dar de alta al
// cliente, marcarle el Tipo (Local/Exportación, que decide si aparece o no al exportar) y recién
// entonces armarle el pedido.
const TABS = [
  { key: "pedidos", label: "Proformas" },
  { key: "clientes", label: "Clientes y Subclientes" },
];

export default function PedidosClientesPage() {
  const [tab, setTab] = useState(TABS[0].key);

  return (
    <div>
      <div className="flex gap-1 bg-gray-200 rounded-lg p-1 mb-5 w-fit overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition ${
              tab === t.key ? "bg-white shadow text-blue-700" : "text-gray-600 hover:text-gray-800"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "pedidos" && <PedidosPage />}
      {tab === "clientes" && <ClientesPage />}
    </div>
  );
}
