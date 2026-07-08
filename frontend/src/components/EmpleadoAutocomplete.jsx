import { useState } from "react";

export default function EmpleadoAutocomplete({ empleados, value, onSelect }) {
  const seleccionado = empleados.find(e => e.Codigo === value);
  const [query, setQuery] = useState(seleccionado ? seleccionado.Codigo : "");
  const [open, setOpen] = useState(false);

  const q = query.trim().toLowerCase();
  const sugerencias = q
    ? empleados.filter(e =>
        e.Codigo.toLowerCase().includes(q) || e.NombreCompleto.toLowerCase().includes(q)
      ).slice(0, 8)
    : [];

  const handleSelect = (emp) => {
    setQuery(emp.Codigo);
    setOpen(false);
    onSelect(emp.Codigo);
  };

  const handleChange = (e) => {
    setQuery(e.target.value);
    setOpen(true);
    if (value) onSelect("");
  };

  return (
    <div className="relative">
      <input
        type="text"
        required
        value={query}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Escribe el código del empleado"
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      {open && sugerencias.length > 0 && (
        <ul className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {sugerencias.map(e => (
            <li key={e.Codigo} onMouseDown={() => handleSelect(e)}
              className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer">
              <span className="font-mono font-bold text-gray-700">{e.Codigo}</span>
              <span className="text-gray-600"> — {e.NombreCompleto}</span>
            </li>
          ))}
        </ul>
      )}
      {value && seleccionado && (
        <p className="text-xs text-gray-500 mt-1">{seleccionado.NombreCompleto}</p>
      )}
    </div>
  );
}
