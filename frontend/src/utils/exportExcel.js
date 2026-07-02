import * as XLSX from "xlsx";

export function exportarTransferencias(registros, fecha) {
  const detalle = registros.map(r => ({
    "Fecha":          r.Fecha ? r.Fecha.split("-").reverse().join("/") : fecha,
    "Código":         r.Codigo,
    "Nombre":         r.NombreCompleto,
    "Área":           r.CodigoArea,
    "Nombre del Área":r.NombreArea,
    "Forma de Pago":  r.FormaPago ?? "",
    "H. Entrada":     r.HoraEntrada ?? "",
    "H. Salida":      r.HoraSalida  ?? (r.Minutos != null ? "En curso" : ""),
    "Minutos":        r.Minutos ?? "",
    "Horas":          r.Minutos != null ? +(r.Minutos / 60).toFixed(2) : "",
    "Horas (HH:MM)":  r.Minutos != null
      ? `${Math.floor(r.Minutos / 60)}:${String(r.Minutos % 60).padStart(2, "0")}`
      : "",
  }));

  // Resumen por empleado: suma de minutos por área
  const mapaResumen = {};
  registros.forEach(r => {
    const key = r.Codigo;
    if (!mapaResumen[key]) {
      mapaResumen[key] = { codigo: r.Codigo, nombre: r.NombreCompleto, totalMin: 0, areasMap: {} };
    }
    const emp = mapaResumen[key];
    const minutos = r.Minutos ?? 0;
    emp.totalMin += minutos;
    if (!emp.areasMap[r.CodigoArea]) {
      emp.areasMap[r.CodigoArea] = { nombre: r.NombreArea, minutos: 0 };
    }
    emp.areasMap[r.CodigoArea].minutos += minutos;
  });

  const resumen = Object.values(mapaResumen).map(emp => {
    const areasDetalle = Object.entries(emp.areasMap)
      .map(([cod, info]) => `${cod} (${Math.floor(info.minutos/60)}h${info.minutos%60>0?info.minutos%60+"m":""})`)
      .join(", ");
    return {
      "Desde":            fecha,
      "Código":           emp.codigo,
      "Nombre":           emp.nombre,
      "Total Horas":      +(emp.totalMin / 60).toFixed(2),
      "Total (HH:MM)":    `${Math.floor(emp.totalMin/60)}:${String(emp.totalMin%60).padStart(2,"0")}`,
      "Detalle por Área": areasDetalle,
    };
  });

  const wb = XLSX.utils.book_new();

  const wsDetalle = XLSX.utils.json_to_sheet(detalle);
  autoWidth(wsDetalle, detalle);
  XLSX.utils.book_append_sheet(wb, wsDetalle, "Transferencias");

  const wsResumen = XLSX.utils.json_to_sheet(resumen);
  autoWidth(wsResumen, resumen);
  XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen por Empleado");

  XLSX.writeFile(wb, `Transferencias_desde_${fecha}.xlsx`);
}

export function exportarMovimientos(registros, fecha) {
  const filas = registros.map(r => ({
    "Fecha":    fecha,
    "Código":   r.Codigo,
    "Nombre":   r.NombreEmpleado,
    "Tipo":     r.Tipo,
    "Hora":     r.Hora,
    "Día":      r.DiaSemana,
    "Operador": r.Operador ?? "",
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(filas);
  autoWidth(ws, filas);
  XLSX.utils.book_append_sheet(wb, ws, "Entradas-Salidas");
  XLSX.writeFile(wb, `MovimientosPersonal_${fecha}.xlsx`);
}

export function exportarReporteProduccion(porTermo, desde, hasta) {
  const termos = porTermo.map(t => ({
    "Termo":          t.NumeroTermo,
    "Lote":           t.Lote,
    "Talla":          t.Talla,
    "Descripción Talla": t.DescripcionTalla,
    "Proceso":        t.DescripcionProceso,
    "Fecha Proceso":  t.FechaProduccion?.slice(0, 10),
    "Kg Procesados":  +t.Procesado.toFixed(2),
  }));

  const wb = XLSX.utils.book_new();
  const wsTermos = XLSX.utils.json_to_sheet(termos);
  autoWidth(wsTermos, termos);
  XLSX.utils.book_append_sheet(wb, wsTermos, "Por Termo");

  XLSX.writeFile(wb, `ReporteProduccion_${desde}_a_${hasta}.xlsx`);
}

export function exportarPesajesPorPersona(porPersona, desde, hasta) {
  const personas = porPersona.map(p => ({
    "Id Empleado":  p.IdEmpleado,
    "Nombre":       p.Nombre,
    "Área":         p.Area ?? "",
    "Fecha":        p.FechaHora?.slice(0, 10),
    "Hora":         p.FechaHora?.slice(11, 16),
    "Producto":     p.Producto,
    "Talla":        p.Talla,
    "Descripción Talla": p.DescripcionTalla,
    "Kilos":        +p.Kilos.toFixed(2),
  }));

  const wb = XLSX.utils.book_new();
  const wsPersonas = XLSX.utils.json_to_sheet(personas);
  autoWidth(wsPersonas, personas);
  XLSX.utils.book_append_sheet(wb, wsPersonas, "Pesajes por Persona");

  XLSX.writeFile(wb, `PesajesPorPersona_${desde}_a_${hasta}.xlsx`);
}

function autoWidth(ws, data) {
  if (!data.length) return;
  const cols = Object.keys(data[0]).map(key => ({
    wch: Math.max(key.length, ...data.map(r => String(r[key] ?? "").length)) + 2,
  }));
  ws["!cols"] = cols;
}
