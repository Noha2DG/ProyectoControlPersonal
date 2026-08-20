import * as XLSX from "xlsx";
import { diasPermiso } from "./permisos.js";
import { AREAS_DESTAJO } from "./destajo.js";

export function exportarTransferencias(registros, fecha, permisos = []) {
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

  const filasPermisos = permisos.map(p => ({
    "Desde":            p.Fecha,
    "Hasta":            p.FechaFin ?? p.Fecha,
    "Días":             diasPermiso(p.Fecha, p.FechaFin ?? p.Fecha),
    "Código":           p.CodigoEmpleado,
    "Nombre":           p.NombreCompleto,
    "Tipo de Permiso":  p.descripcion,
    "Observación":      p.Observacion ?? "",
    "Registrado por":   p.RegistradoPor ?? "",
  }));
  const wsPermisos = XLSX.utils.json_to_sheet(filasPermisos);
  autoWidth(wsPermisos, filasPermisos);
  XLSX.utils.book_append_sheet(wb, wsPermisos, "Permisos");

  XLSX.writeFile(wb, `Transferencias_desde_${fecha}.xlsx`);
}

export function exportarMovimientos(registros, fecha) {
  const filas = registros.map(r => ({
    // La fecha de CADA fila, no la del filtro. El filtro es un "desde": trae de esa fecha en
    // adelante, así que sellar todas las filas con la fecha inicial hacía ver el archivo como si
    // solo tuviera ese día — los registros de los días siguientes sí estaban, con la fecha mal.
    // Mismo criterio que exportarTransferencias, y mismo formato dd/mm/aaaa que se ve en pantalla.
    "Fecha":    r.Fecha ? r.Fecha.split("-").reverse().join("/") : fecha,
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
  // "desde" en el nombre para que el archivo no se lea como si fuera de un solo día.
  XLSX.writeFile(wb, `MovimientosPersonal_desde_${fecha}.xlsx`);
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
    // Una columna por área de destajo, en el mismo orden que la tabla de la pantalla.
    ...Object.fromEntries(AREAS_DESTAJO.map(a => [`${a.etiqueta} (Lb)`, +f[a.lb].toFixed(2)])),
    "Total (Lb)":                 +f.LbTotal.toFixed(2),
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(datos);
  autoWidth(ws, datos);
  XLSX.utils.book_append_sheet(wb, ws, "Lb-Persona");

  XLSX.writeFile(wb, `LbPorPersona_${desde}_a_${hasta}.xlsx`);
}

// El Excel lleva la ficha COMPLETA, no las ocho columnas que se ven en pantalla: la tabla está
// recortada para que quepa, pero /api/empleados ya devuelve todos los campos y es justo lo que
// hace falta cuando alguien se baja el listado (planilla, IGSS, expedientes). Se exporta lo que
// quedó filtrado en pantalla, así el filtro Activo/Baja/Todos y la búsqueda mandan sobre el archivo.
export function exportarEmpleados(empleados, filtroEstado) {
  const filas = empleados.map(e => ({
    "Código":                 e.Codigo,
    "Nombre Completo":        e.NombreCompleto,
    "Estado":                 e.Estado,
    "F. Ingreso":             e.FechaIngreso ?? "",
    // Solo para quien está de baja. 82 de los 183 activos arrastran FechaBaja = 1970-01-01 (el
    // centinela de época que deja una fecha vacía al convertirse), y algunos reactivados conservan
    // la fecha de su baja anterior: en ambos casos es una fecha que no significa nada para alguien
    // que sigue trabajando. No se filtra el 1970 en general porque hay fechas de NACIMIENTO reales
    // de ese año, y el historial de bajas verdadero vive en la tabla Bajas.
    "F. Baja":                e.Estado === "Activo" ? "" : (e.FechaBaja ?? ""),
    "Primer Nombre":          e.PrimerNombre ?? "",
    "Segundo Nombre":         e.SegundoNombre ?? "",
    "Tercer Nombre":          e.TercerNombre ?? "",
    "Primer Apellido":        e.PrimerApellido ?? "",
    "Segundo Apellido":       e.SegundoApellido ?? "",
    "Apellido de Casada":     e.ApellidoCasada ?? "",
    "Sexo":                   e.Sexo ?? "",
    "Estado Civil":           e.EstadoCivil ?? "",
    // DPI y Etalent van como texto: son identificadores, no cantidades. Como número, Excel le come
    // los ceros a la izquierda y a los DPI de 13 dígitos les mete notación científica.
    "DPI":                    e.DPI > 0 ? String(e.DPI) : "",
    "Etalent":                e.CodigoEtalent ? String(e.CodigoEtalent) : "",
    "NIT":                    e.NIT ?? "",
    "Seguro Social":          e.SeguroSocial ?? "",
    "F. Nacimiento":          e.FechaNacimiento ?? "",
    "País Nacimiento":        e.PaisNacimiento ?? "",
    "Depto. Nacimiento":      e.DepartamentoNacimiento ?? "",
    "Municipio Nacimiento":   e.MunicipioNacimiento ?? "",
    "Etnia":                  e.Etnia ?? "",
    "Nacionalidad":           e.Nacionalidad ?? "",
    "País DPI":               e.PaisDPI ?? "",
    "Depto. DPI":             e.DepartamentoDPI ?? "",
    "Municipio DPI":          e.MunicipioDPI ?? "",
    "Vencimiento DPI":        e.VencimientoDPI ?? "",
    "Celular":                e.Celular ?? "",
    "Teléfono":               e.Telefono ?? "",
    "Permiso de Trabajo":     e.PermisoTrabajo ?? "",
    "Título Personal":        e.TituloPersonal ?? "",
    "No. de Hijos":           e.NumeroHijos ?? 0,
    "Nivel Académico":        e.NivelAcademico ?? "",
    "Tipo de Sangre":         e.TipoSangre ?? "",
    "Beneficiario":           e.Beneficiario ?? "",
    "Profesión":              e.Profesion ?? "",
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(filas);
  autoWidth(ws, filas);
  XLSX.utils.book_append_sheet(wb, ws, "Empleados");
  const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
  XLSX.writeFile(wb, `Empleados_${filtroEstado}_${hoy}.xlsx`);
}

export function exportarPermisos(registros, fecha, hasta) {
  const filas = registros.map(r => ({
    "Desde":            r.Fecha,
    "Hasta":            r.FechaFin ?? r.Fecha,
    "Días":             diasPermiso(r.Fecha, r.FechaFin ?? r.Fecha),
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
