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

export function exportarReporteGeneral(porLote, porTalla, desde, hasta) {
  const lotes = porLote.map(l => ({
    "Lote":            l.Lote,
    "Finca":           l.NombreFinca,
    "Clase MP":        l.Clase,
    "Descripción MP":  l.DescripcionClase,
    "Fecha Ingreso":   l.Fecha?.slice(0, 10),
    "Peso Ingreso":    l.PesoIngreso,
    "UM":              l.UM,
    "Procesado":       +l.Procesado.toFixed(2),
    "Pendiente":       +l.Pendiente.toFixed(2),
    "Rendimiento %":   +l.Rendimiento.toFixed(1),
    "Transacciones":   l.NumTransacciones,
  }));

  const tallas = porTalla.map(t => ({
    "Talla":         t.Talla,
    "Descripción":   t.DescripcionTalla,
    "Procesado":     +t.Procesado.toFixed(2),
    "Pesajes":       t.NumPesajes,
  }));

  const wb = XLSX.utils.book_new();
  const wsLotes = XLSX.utils.json_to_sheet(lotes);
  autoWidth(wsLotes, lotes);
  XLSX.utils.book_append_sheet(wb, wsLotes, "Por Lote");

  const wsTallas = XLSX.utils.json_to_sheet(tallas);
  autoWidth(wsTallas, tallas);
  XLSX.utils.book_append_sheet(wb, wsTallas, "Por Talla");

  XLSX.writeFile(wb, `ReporteGeneral_${desde}_a_${hasta}.xlsx`);
}

export function exportarReporteTermos(porTermo, desde, hasta) {
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

  XLSX.writeFile(wb, `ReporteTermos_${desde}_a_${hasta}.xlsx`);
}

export function exportarEficiencias(porPersona, desde, hasta) {
  const personas = porPersona.map(p => ({
    "Id Empleado":  p.IdEmpleado,
    "Nombre":       p.Nombre,
    "Área":         p.Area ?? "",
    "Fecha":        p.FechaHora?.slice(0, 10),
    "Hora":         p.FechaHora?.slice(11, 16),
    "Lote":         p.Lote,
    "Producto":     p.Producto,
    "Talla":        p.Talla,
    "Descripción Talla": p.DescripcionTalla,
    "Kilos":        +p.Kilos.toFixed(2),
  }));

  const wb = XLSX.utils.book_new();
  const wsPersonas = XLSX.utils.json_to_sheet(personas);
  autoWidth(wsPersonas, personas);
  XLSX.utils.book_append_sheet(wb, wsPersonas, "Eficiencias");

  XLSX.writeFile(wb, `Eficiencias_${desde}_a_${hasta}.xlsx`);
}

export function exportarLbHora(filas, desde, hasta) {
  const datos = filas.map(f => ({
    "Id Empleado":  f.IdEmpleado,
    "Nombre":       f.Nombre,
    "Área":         f.Area ?? "",
    "Lb":           +f.Lb.toFixed(2),
    "Horas":        +f.Horas.toFixed(2),
    "Lb/Hora":      f.LbPorHora != null ? +f.LbPorHora.toFixed(1) : "",
    "# Pesadas":    f.NumPesadas,
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(datos);
  autoWidth(ws, datos);
  XLSX.utils.book_append_sheet(wb, ws, "Lb-Hora");

  XLSX.writeFile(wb, `LbHora_${desde}_a_${hasta}.xlsx`);
}

export function exportarLbHoraPorTalla(filas, desde, hasta) {
  const datos = filas.map(f => ({
    "Id Empleado":  f.IdEmpleado,
    "Nombre":       f.Nombre,
    "Producto":     f.Producto,
    "Talla":        f.Talla,
    "Descripción Talla": f.DescripcionTalla,
    "Lb":           +f.Lb.toFixed(2),
    "Horas":        +f.Horas.toFixed(2),
    "Lb/Hora":      f.LbPorHora != null ? +f.LbPorHora.toFixed(1) : "",
    "# Pesadas":    f.NumPesadas,
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(datos);
  autoWidth(ws, datos);
  XLSX.utils.book_append_sheet(wb, ws, "Por Talla");

  XLSX.writeFile(wb, `LbHoraPorTalla_${desde}_a_${hasta}.xlsx`);
}

export function exportarLbPorPersona(filas, desde, hasta) {
  const datos = filas.map(f => ({
    "Puesto":                     f.Puesto,
    "Id Empleado":                f.IdEmpleado,
    "Nombre":                     f.Nombre,
    "Descabezado (Lb)":           +f.LbDescabezado.toFixed(2),
    "Pelado y Devenado (Lb)":     +f.LbPelado.toFixed(2),
    "Total (Lb)":                 +f.LbTotal.toFixed(2),
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(datos);
  autoWidth(ws, datos);
  XLSX.utils.book_append_sheet(wb, ws, "Lb-Persona");

  XLSX.writeFile(wb, `LbPorPersona_${desde}_a_${hasta}.xlsx`);
}

export function exportarPermisos(registros, fecha, hasta) {
  const filas = registros.map(r => ({
    "Fecha":            r.Fecha,
    "Código":           r.CodigoEmpleado,
    "Nombre":           r.NombreCompleto,
    "Etalent":          r.CodigoEtalent ?? "",
    "Tipo de Permiso":  r.descripcion,
    "Observación":      r.Observacion ?? "",
    "Registrado por":   r.RegistradoPor ?? "",
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(filas);
  autoWidth(ws, filas);
  XLSX.utils.book_append_sheet(wb, ws, "Permisos");
  XLSX.writeFile(wb, hasta ? `Permisos_${fecha}_a_${hasta}.xlsx` : `Permisos_desde_${fecha}.xlsx`);
}

function autoWidth(ws, data) {
  if (!data.length) return;
  const cols = Object.keys(data[0]).map(key => ({
    wch: Math.max(key.length, ...data.map(r => String(r[key] ?? "").length)) + 2,
  }));
  ws["!cols"] = cols;
}
