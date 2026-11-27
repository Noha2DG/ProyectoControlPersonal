import * as XLSX from "xlsx";
import { diasPermiso } from "./permisos.js";
import { AREAS_DESTAJO, LB_POR_KG } from "./destajo.js";

export function exportarTransferencias(registros, fecha, permisos = []) {
  const detalle = registros.map(r => ({
    "Fecha":          r.Fecha ? r.Fecha.split("-").reverse().join("/") : fecha,
    "Código":         r.Codigo,
    "Nombre":         r.NombreCompleto,
    "Área":           r.CodigoArea,
    "Nombre del Área":r.NombreArea,
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

// Los termos de cola (Descabezado) y los de materia prima bajada de las mesas van en las mismas
// filas, con su destino.
export function exportarReporteTermos(porTermo, desde, hasta, porTermoCola = [], porTermoBajado = []) {
  const termos = porTermo.map(t => ({
    "Termo":          t.NumeroTermo,
    "Lote":           t.Lote,
    "Talla":          t.Talla,
    "Descripción Talla": t.DescripcionTalla,
    "Proceso":        t.DescripcionProceso,
    "Fecha Proceso":  t.FechaProduccion?.slice(0, 10),
    "Destino":        "",
    "Kg Procesados":  +t.Procesado.toFixed(2),
  })).concat(porTermoCola.map(t => ({
    "Termo":          t.NumeroTermo,
    "Lote":           t.Lote,
    "Talla":          t.Talla,
    "Descripción Talla": t.DescripcionTalla,
    "Proceso":        t.DescripcionClaseCola,
    "Fecha Proceso":  t.FechaProduccion?.slice(0, 10),
    "Destino":        t.NombreDestino || "por trasladar",
    "Kg Procesados":  +t.Procesado.toFixed(2),
  }))).concat(porTermoBajado.map(t => ({
    "Termo":          t.NumeroTermo,
    "Lote":           t.Lote,
    "Talla":          t.Talla === 900 ? "" : t.Talla,
    "Descripción Talla": t.Talla === 900 ? "" : t.DescripcionTalla,
    "Proceso":        `MP bajada de mesa${t.Motivo ? ` (${t.Motivo})` : ""}`,
    "Fecha Proceso":  t.FechaProduccion?.slice(0, 10),
    "Destino":        t.NombreDestino || "",
    "Kg Procesados":  +t.Procesado.toFixed(2),
  })));

  const wb = XLSX.utils.book_new();
  const wsTermos = XLSX.utils.json_to_sheet(termos);
  autoWidth(wsTermos, termos);
  XLSX.utils.book_append_sheet(wb, wsTermos, "Por Termo");

  XLSX.writeFile(wb, `ReporteTermos_${desde}_a_${hasta}.xlsx`);
}

// Remisiones → Excel TABULAR de un rango de fechas (GET /api/remisiones/exportar): una hoja con la
// cabecera de cada remisión y otra con una fila por master, con el folio, la fecha y el tipo en cada
// renglón para hacer tablas dinámicas. Mismos criterios que exportarHojasLote: un solo encabezado,
// números como números y la fecha como fecha de Excel (armada local, sin la Z del backend).
export function exportarRemisiones({ cabeceras, lineas }, desde, hasta) {
  const fecha = (iso) => {
    const [a, m, d] = String(iso ?? "").slice(0, 10).split("-").map(Number);
    return a ? new Date(a, m - 1, d) : null;
  };
  const n2 = (v) => (v == null || Number.isNaN(Number(v)) ? null : +Number(v).toFixed(2));
  const destino = (c) => c.NombreCliente
    ? [c.NombreCliente, c.NombreSubcliente].filter(Boolean).join(" / ")
    : c.NombreBodegaDestino || c.NombreAreaDestino || c.NombreTipo;
  const porId = new Map(cabeceras.map(c => [c.RemisionId, c]));
  const totales = new Map();
  for (const l of lineas) {
    const t = totales.get(l.RemisionId) ?? { masters: 0, kg: 0, lb: 0 };
    t.masters += 1; t.kg += l.PesoMasterKG || 0; t.lb += l.PesoMasterLb || 0;
    totales.set(l.RemisionId, t);
  }

  const filasCab = cabeceras.map(c => {
    const t = totales.get(c.RemisionId) ?? { masters: 0, kg: 0, lb: 0 };
    return {
      "Fecha": fecha(c.Fecha), "Folio": c.Folio, "Tipo": c.NombreTipo, "Estatus": c.Estatus,
      "Destino": destino(c), "Cliente": c.NombreCliente ?? null, "Subcliente": c.NombreSubcliente ?? null,
      "Bodega destino": c.NombreBodegaDestino ?? null, "Área destino": c.NombreAreaDestino ?? null,
      "Recibe": c.NombreRecibidoPor || null, "Pedido": c.CodigoPedido ?? null,
      "Contenedor": c.Contenedor ?? null, "Sello": c.Sello ?? null,
      "Masters": t.masters, "Kg": n2(t.kg), "Lb": n2(t.lb),
      "Creada por": c.CreadoPor ?? null, "Creada": c.CreadoEn ?? null,
      "Confirmada por": c.ConfirmadaPor ?? null, "Confirmada": c.ConfirmadaEn ?? null,
      "Anulada por": c.AnuladaPor ?? null, "Anulada": c.AnuladaEn ?? null, "Motivo de anulación": c.MotivoAnulacion ?? null,
      "Observaciones": c.Observaciones ?? null,
    };
  });
  const filasDet = lineas.map(l => {
    const c = porId.get(l.RemisionId) ?? {};
    return {
      "Fecha": fecha(c.Fecha), "Folio": c.Folio, "Tipo": c.NombreTipo, "Estatus": c.Estatus, "Destino": destino(c),
      "Línea contenedor": l.LineaContenedor, "Master": l.Correlativo, "Polín": l.PalletCodigo,
      "Lote": l.Lote, "Fecha de producción": fecha(l.FechaProduccion), "Área de empaque": l.NombreArea ?? null,
      "Pedido del master": l.CodigoPedido, "Cliente del master": l.NombreCliente, "Subcliente del master": l.NombreSubcliente ?? null,
      "Clase": l.Clase, "Proceso": l.DescripcionProceso, "Talla": l.DescripcionTalla,
      "Presentación": l.DescripcionPresentacion, "Kg": n2(l.PesoMasterKG), "Lb": n2(l.PesoMasterLb),
      "Agregado por": l.AgregadoPor ?? null, "Agregado": l.AgregadoEn ?? null,
      "Recibido en área": l.RecibidoEnArea ?? null, "Recibido por": l.RecibidoPorArea ?? null,
    };
  });

  const wb = XLSX.utils.book_new();
  const hoja = (nombre, filas) => {
    const ws = XLSX.utils.json_to_sheet(filas.length ? filas : [{ "Sin datos": "" }], { cellDates: true, dateNF: "dd/mm/yyyy" });
    autoWidth(ws, filas.length ? filas.map(f => ({ ...f, Fecha: "00/00/0000", "Fecha de producción": f["Fecha de producción"] ? "00/00/0000" : "" })) : [{ "Sin datos": "" }]);
    if (filas.length) ws["!autofilter"] = { ref: ws["!ref"] };
    XLSX.utils.book_append_sheet(wb, ws, nombre);
  };
  hoja("Remisiones", filasCab);
  hoja("Detalle", filasDet);
  XLSX.writeFile(wb, `Remisiones_${desde}_a_${hasta}.xlsx`);
}

// Reporte x Lote → Excel TABULAR de todos los lotes del rango (los mismos que imprime el PDF), para
// tablas dinámicas: cada hoja tiene un solo renglón de encabezados, sin celdas combinadas ni
// renglones de total, números como números, y Fecha + Lote + Clase MP en cada renglón para cruzar
// las hojas entre sí. La fecha va como fecha de Excel (se arma local, sin la Z del backend).
//   lotes:    porLote del rango (con Recibido)
//   termosDe: (lote, clase) → termos de pesaje del lote
export function exportarHojasLote(lotes, termosDe, desde, hasta) {
  const fecha = (iso) => {
    const [a, m, d] = String(iso ?? "").slice(0, 10).split("-").map(Number);
    return a ? new Date(a, m - 1, d) : null;
  };
  const n2 = (v) => (v == null || Number.isNaN(Number(v)) ? null : +Number(v).toFixed(2));
  const llave = (l) => ({ "Fecha": fecha(l.Fecha), "Lote": l.Lote, "Clase MP": l.Clase });

  // Dos hojas: Termos y Materia prima. Lotes, Ritmo y Bajado y descarte se quitaron (usuario,
  // 16 nov 2026): lo de Lotes se saca de estas dos con la tabla dinámica.
  const filasTermos = [], filasRecibido = [];
  for (const l of lotes) {
    const k = llave(l);
    const termos = termosDe(l.Lote, l.Clase);
    for (const t of termos) {
      filasTermos.push({
        ...k, "Termo": String(t.NumeroTermo), "Talla": t.DescripcionTalla,
        "Clase PT": t.ClasePT ?? null, "Producto": t.DescripcionClasePT || t.DescripcionProceso,
        "Pesadas": t.Pesadas ?? null, "Kilos": n2(t.Procesado), "Libras": n2(t.Procesado * 2.20462),
      });
    }
    for (const r of l.Recibido ?? []) {
      filasRecibido.push({
        ...k, "Lote origen": r.LoteOrigen, "Talla": r.DescripcionTalla, "Clase": r.Clase,
        "Descripción": r.DescripcionClase, "Enviado por": r.EnviadoPor ?? null, "Termos": r.Termos, "Kilos": n2(r.Kg),
      });
    }
  }

  const wb = XLSX.utils.book_new();
  const hoja = (nombre, filas) => {
    const ws = XLSX.utils.json_to_sheet(filas.length ? filas : [{ "Sin datos": "" }], { cellDates: true, dateNF: "dd/mm/yyyy" });
    autoWidth(ws, filas.length ? filas.map(f => ({ ...f, Fecha: "00/00/0000" })) : [{ "Sin datos": "" }]);
    if (filas.length) ws["!autofilter"] = { ref: ws["!ref"] };
    XLSX.utils.book_append_sheet(wb, ws, nombre);
  };
  hoja("Termos", filasTermos);
  hoja("Materia prima", filasRecibido);
  XLSX.writeFile(wb, `ReporteLotes_${desde}_a_${hasta}.xlsx`);
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

// conMesa: solo quien tiene mesas.reporte recibe la columna (igual que en pantalla).
export function exportarLbHora(filas, desde, hasta, conMesa = false) {
  const datos = filas.map(f => ({
    "Id Empleado":  f.IdEmpleado,
    "Nombre":       f.Nombre,
    ...(conMesa ? { "Mesa": f.Mesa ?? "" } : {}),
    "Área":         f.Area ?? "",
    "Fecha":        f.Fecha ? f.Fecha.split("-").reverse().join("/") : "",
    "Clase":        f.Producto ?? "",
    "Talla":        f.DescripcionTalla ?? "",
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

// areas: las columnas que se ven en pantalla (solo las áreas con libras en el rango).
export function exportarLbPorPersona(filas, desde, hasta, areas = AREAS_DESTAJO) {
  const datos = filas.map(f => ({
    "Puesto":                     f.Puesto,
    "Id Empleado":                f.IdEmpleado,
    "Nombre":                     f.Nombre,
    // Una columna por área de destajo, en el mismo orden que la tabla de la pantalla.
    ...Object.fromEntries(areas.map(a => [`${a.etiqueta} (Lb)`, +f[a.lb].toFixed(2)])),
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
    "Dirección Actual":       e.DireccionActual ?? "",
    "Celular":                e.Celular ?? "",
    "No. de Hijos":           e.NumeroHijos ?? 0,
    "Nivel Académico":        e.NivelAcademico ?? "",
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

// Mismas columnas que se ven en pantalla (Bodega — Existencias), en el mismo orden, con lo que
// quedó filtrado/ordenado — igual criterio que exportarEmpleados: el archivo refleja lo que el
// usuario armó con los filtros, no el listado completo sin filtrar.
export function exportarExistenciaBodega(filas, ubicacionDe) {
  const datos = filas.map(f => ({
    "Pedido":       f.Pedido,
    "Descripción":  f.DescripcionPedido ?? "",
    "Cliente":      f.Cliente,
    "Subcliente":   f.Subcliente ?? "",
    "Lote":         f.Lote,
    "Polín":        f.Polin,
    "Ubicación":    ubicacionDe(f),
    "Posición":     f.PosicionCodigo ?? "",
    "Área (origen)": f.NombreArea ?? "",
    "Cód. Clase":   f.CodigoClase,
    "Clase":        f.Clase,
    "Cód. Talla":   f.CodigoTalla,
    "Talla":        f.Talla,
    "Presentación": f.Presentacion,
    // dd/mm/aaaa como se ve en pantalla — Excel interpreta el ISO (aaaa-mm-dd) como texto suelto
    // y a veces lo autoconvierte a su propio formato de fecha regional, que no es este.
    "Fecha":        f.Fecha ? f.Fecha.split("-").reverse().join("/") : "",
    "Master":       f.Master,
    "Cajas":        f.Cajas,
    "Kilos":        +f.KilosBrutos.toFixed(2),
    "Libras":       +f.Libras.toFixed(2),
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(datos);
  autoWidth(ws, datos);
  XLSX.utils.book_append_sheet(wb, ws, "Existencias");
  const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
  XLSX.writeFile(wb, `ExistenciaBodega_${hoy}.xlsx`);
}

function autoWidth(ws, data) {
  if (!data.length) return;
  const cols = Object.keys(data[0]).map(key => ({
    wch: Math.max(key.length, ...data.map(r => String(r[key] ?? "").length)) + 2,
  }));
  ws["!cols"] = cols;
}

// Básculas → reporte de pesadas (GET /api/balanzas/reporte): una hoja con TODAS las pesadas y todos
// sus datos, y otra resumida por lote / talla / empaque / pedido / carrito. Solo cuentan en el resumen
// las cajas guardadas (dentro del rango) y no anuladas; los intentos fuera de rango van en su columna.
export const TIPO_PESADA_TXT = { PPV: "Pesar PPV", PERSONA: "Producto terminado", PRODUCTO: "Por producto", EMPANIZADO: "Empanizado" };
export const RESULTADO_PESADA_TXT = { OK: "Guardada", BAJO: "Bajo peso (no guardada)", SOBRE: "Sobrepeso (no guardada)" };

export function exportarPesadasBascula(filas, desde, hasta) {
  const fecha = (iso) => {
    const [a, m, d] = String(iso ?? "").slice(0, 10).split("-").map(Number);
    return a ? new Date(a, m - 1, d) : null;
  };
  const detalle = filas.map(r => ({
    "Fecha": fecha(r.Fecha), "Hora": r.Hora, "Báscula": r.BalanzaCodigo,
    "Tipo de pesada": TIPO_PESADA_TXT[r.Tipo] ?? r.Tipo,
    "Resultado": Number(r.Anulada) === 1 ? "Anulada"
      : r.Origen === "PESADA" && r.Resultado !== "OK" ? (r.Resultado === "BAJO" ? "Bajo peso (guardada)" : "Sobrepeso (guardada)")
      : (RESULTADO_PESADA_TXT[r.Resultado] ?? r.Resultado),
    "Unidades (referencia)": r.UnidadesRef ?? "",
    "Área": r.NombreArea ?? r.AreaCodigo, "Operadora": r.Operadora, "Carnet operadora": r.OperadoraCodigo,
    "Lote": r.Lote, "Tipo de producto": r.Clase ?? "", "Producto que sale": r.ClaseSalida ? `${r.ClaseSalida} ${r.ClaseSalidaDesc ?? ""}`.trim() : "",
    "Talla": r.TallaDesc ?? "", "Código talla": r.Talla,
    "Tipo de empaque": r.EmpaqueNombre ?? r.EmpaqueCodigo ?? "", "Deshidratación %": r.DeshidratacionPct ?? "",
    "Pedido": r.CodigoPedido ?? "", "Cliente": r.Cliente ?? "", "Descripción pedido": r.PedidoDesc ?? "",
    "Destino": r.Destino ?? "", "Carrito": r.Carrito ?? "", "Persona (bandeja)": r.Persona ?? "",
    "Peso (g)": r.PesoBrutoG, "Neto (g)": r.PesoNetoG, "Kilos": r.PesoNetoG != null ? +(r.PesoNetoG / 1000).toFixed(3) : null,
    "Mínimo (g)": r.MinG, "Máximo (g)": r.MaxG,
    "Anulada por": r.AnuladaPor ?? "", "Anulada en": r.AnuladaEn ?? "", "Motivo anulación": r.MotivoAnulacion ?? "",
  }));

  const grupos = new Map();
  for (const r of filas) {
    if (Number(r.Anulada) === 1) continue;
    const k = [r.Fecha, r.Tipo, r.Lote, r.Talla, r.EmpaqueCodigo, r.CodigoPedido, r.Carrito].join("|");
    const g = grupos.get(k) ?? { r, cajas: 0, netoG: 0, fuera: 0 };
    // Una Pesada real fuera de rango SÍ es caja (se guardó marcada); un intento PPV fuera de rango no.
    if (r.Origen === "PESADA" || r.Resultado === "OK") { g.cajas += 1; g.netoG += Number(r.PesoNetoG) || 0; }
    if (r.Resultado !== "OK") g.fuera += 1;
    grupos.set(k, g);
  }
  const resumen = [...grupos.values()].map(({ r, cajas, netoG, fuera }) => ({
    "Fecha": fecha(r.Fecha), "Tipo de pesada": TIPO_PESADA_TXT[r.Tipo] ?? r.Tipo, "Lote": r.Lote,
    "Talla": r.TallaDesc ?? r.Talla, "Tipo de empaque": r.EmpaqueNombre ?? r.EmpaqueCodigo ?? "",
    "Pedido": r.CodigoPedido ?? "", "Cliente": r.Cliente ?? "", "Carrito": r.Carrito ?? "",
    "Cajas": cajas, "Kilos": +(netoG / 1000).toFixed(3), "Promedio por caja (g)": cajas ? Math.round(netoG / cajas) : null,
    "Fuera de rango": fuera,
  }));

  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(detalle, { cellDates: true });
  autoWidth(ws1, detalle);
  XLSX.utils.book_append_sheet(wb, ws1, "Pesadas");
  const ws2 = XLSX.utils.json_to_sheet(resumen, { cellDates: true });
  autoWidth(ws2, resumen);
  XLSX.utils.book_append_sheet(wb, ws2, "Resumen por lote");
  XLSX.writeFile(wb, `Pesadas_basculas_${desde}_a_${hasta}.xlsx`);
}

// Empanizado → Producción por persona (20 nov 2026): base del pago de Empanizado, aparte de Pelado.
// Hoja 1 un renglón por persona; hoja 2 el detalle por día, lote, producto y destino.
export function exportarProduccionEmpanizado(porPersona, filas, desde, hasta, titulo = "Empanizado") {
  const fecha = (iso) => {
    const [a, m, d] = String(iso ?? "").slice(0, 10).split("-").map(Number);
    return a ? new Date(a, m - 1, d) : null;
  };
  const destino = (d) => ({ EXPORTACION: "Exportación", LOCAL: "Venta local" }[d] ?? d ?? "");
  const resumen = porPersona.map(p => ({
    "Mesa / banda": p.MesaNombre ?? "sin posición", "Posición": p.Posicion ?? "", "Código": p.Codigo, "Nombre": p.Nombre,
    "Bandejas": p.Bandejas, "Libras": +Number(p.Lb).toFixed(2), "Lb/hora": p.LbHora == null ? "" : +Number(p.LbHora).toFixed(2),
  }));
  const detalle = filas.map(f => ({
    "Fecha": fecha(f.Fecha), "Mesa / banda": f.MesaNombre ?? "sin posición", "Posición": f.Posicion ?? "",
    "Código": f.Codigo, "Nombre": f.Nombre, "Lote": f.Lote, "Talla": f.DescripcionTalla ?? f.Talla,
    "Producto que sale": `${f.ClaseSalida ?? ""} ${f.DescripcionClaseSalida ?? ""}`.trim(), "Destino": destino(f.Destino),
    "Pedido": f.CodigoPedido ?? "", "Unidades (referencia)": f.UnidadesRef ?? "", "Primera": f.Primera, "Última": f.Ultima,
    "Bandejas": f.Bandejas, "Libras": +(Number(f.Kg) * LB_POR_KG).toFixed(2),
  }));
  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(resumen);
  autoWidth(ws1, resumen);
  XLSX.utils.book_append_sheet(wb, ws1, "Por persona");
  const ws2 = XLSX.utils.json_to_sheet(detalle, { cellDates: true });
  autoWidth(ws2, detalle);
  XLSX.utils.book_append_sheet(wb, ws2, "Detalle");
  // Un archivo por destino (Red Lobster / Empanizado venta local): el nombre lo dice.
  XLSX.writeFile(wb, `${titulo.replace(/\s+/g, "_")}_produccion_${desde}_a_${hasta}.xlsx`);
}
