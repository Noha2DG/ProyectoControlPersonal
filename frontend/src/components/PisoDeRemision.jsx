import { fmtNum } from "../utils/numero.js";

// Lo que una remisión dejó al piso de su área, por lote y talla (viene en GET /api/remisiones/:id,
// campo Piso): cuánto entró, cuánto ya trabajó el área y cuánto queda.
//
// Es para bodega (usuario, 28 oct 2026, con RS-0106): lo que "queda al piso" debería estar en el área.
// Si el área dice que no lo tiene, se quedó en bodega y hay que sacarlo de la remisión —  Devolver
// polín en una confirmada, Quitar polín en un borrador—  para que salga del piso del área.
export default function PisoDeRemision({ piso, borrador }) {
  if (!piso || !piso.Lineas?.length) return null;
  const queda = piso.Lineas.reduce((s, l) => s + l.QuedaKg, 0);
  const hayQueda = queda > 0.004;

  return (
    <div className="mb-4 border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-xs font-semibold text-gray-700">Al piso de {piso.NombreBodega}</span>
        <span className="text-xs text-gray-500">
          {hayQueda
            ? <>queda <b className="text-amber-700">{fmtNum(queda)} kg</b> sin trabajar</>
            : "el área ya trabajó todo lo que entró"}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-gray-500">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Lote</th>
              <th className="px-3 py-1.5 text-left font-medium">Producto</th>
              <th className="px-3 py-1.5 text-right font-medium">Entró</th>
              <th className="px-3 py-1.5 text-right font-medium">Ya trabajado</th>
              <th className="px-3 py-1.5 text-right font-medium">Queda al piso</th>
            </tr>
          </thead>
          <tbody>
            {piso.Lineas.map((l, i) => {
              const conSaldo = l.QuedaKg > 0.004;
              return (
                <tr key={i} className={`border-t border-gray-100 ${conSaldo ? "bg-amber-50/50" : ""}`}>
                  <td className="px-3 py-1.5 font-mono whitespace-nowrap">{l.Lote}</td>
                  <td className="px-3 py-1.5">
                    <span className="font-mono text-gray-500">{l.Clase}</span> {l.DescripcionClase} · {l.DescripcionTalla}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                    {l.EntroMasters ? `${l.EntroMasters} m · ` : ""}{fmtNum(l.EntroKg)} kg
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap text-gray-500">{fmtNum(l.SalioKg)} kg</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums whitespace-nowrap font-semibold ${conSaldo ? "text-amber-700" : "text-gray-400"}`}>
                    {conSaldo ? <>{l.QuedaMasters != null ? `${l.QuedaMasters} m · ` : ""}{fmtNum(l.QuedaKg)} kg</> : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hayQueda && (
        <p className="px-3 py-2 border-t border-gray-100 text-[11px] text-gray-500">
          Lo que queda al piso debería estar en {piso.NombreBodega}. Si se quedó en bodega, sáquelo con{" "}
          <b>{borrador ? "Quitar polín" : "Devolver polín"}</b> y sale del piso del área.
        </p>
      )}
    </div>
  );
}
