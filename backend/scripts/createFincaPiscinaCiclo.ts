import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

const FINCAS = [
  { Codigo: "E0001", Descripcion: "ESTEROMAR", Grupo: "ORO DEL PACIFICO", Abreviatura: "E" },
  { Codigo: "IM001", Descripcion: "IMPORTACION", Grupo: "IMPORTACION", Abreviatura: "IM" },
  { Codigo: "L0001", Descripcion: "LABORATORIO", Grupo: "ORO DEL PACIFICO", Abreviatura: "LAB" },
  { Codigo: "MA001", Descripcion: "MAQUILA", Grupo: "MAQUILA", Abreviatura: "MA" },
  { Codigo: "P0001", Descripcion: "PROVEEDORES DE PESCADO", Grupo: "PROVEEDORES DE PESCADO", Abreviatura: "P" },
  { Codigo: "T0001", Descripcion: "TECOJATE", Grupo: "ORO DEL PACIFICO", Abreviatura: "T" },
];

const PISCINAS = [
  { CodigoFinca: "E0001", Nombre: "EM-SIFON" }, { CodigoFinca: "E0001", Nombre: "EM00-E00" },
  { CodigoFinca: "E0001", Nombre: "EM00-P01" }, { CodigoFinca: "E0001", Nombre: "EM00-P02" },
  { CodigoFinca: "E0001", Nombre: "EM00-P03" }, { CodigoFinca: "E0001", Nombre: "EM00-P04" },
  { CodigoFinca: "E0001", Nombre: "EM01-E01" }, { CodigoFinca: "E0001", Nombre: "EM01-E02" },
  { CodigoFinca: "E0001", Nombre: "EM01-E03" }, { CodigoFinca: "E0001", Nombre: "EM01-E04" },
  { CodigoFinca: "E0001", Nombre: "EM01-P01" }, { CodigoFinca: "E0001", Nombre: "EM01-P02" },
  { CodigoFinca: "E0001", Nombre: "EM01-P03" }, { CodigoFinca: "E0001", Nombre: "EM02-E01" },
  { CodigoFinca: "E0001", Nombre: "EM02-E02" }, { CodigoFinca: "E0001", Nombre: "EM02-E03" },
  { CodigoFinca: "E0001", Nombre: "EM02-E04" }, { CodigoFinca: "E0001", Nombre: "EM02-P01" },
  { CodigoFinca: "E0001", Nombre: "EM02-P02" }, { CodigoFinca: "E0001", Nombre: "EM02-P03" },
  { CodigoFinca: "E0001", Nombre: "EM03-E01" }, { CodigoFinca: "E0001", Nombre: "EM03-E02" },
  { CodigoFinca: "E0001", Nombre: "EM03-E03" }, { CodigoFinca: "E0001", Nombre: "EM03-E04" },
  { CodigoFinca: "E0001", Nombre: "EM03-E05" }, { CodigoFinca: "E0001", Nombre: "EM03-P01" },
  { CodigoFinca: "E0001", Nombre: "EM03-P02" }, { CodigoFinca: "E0001", Nombre: "EM03-P03" },
  { CodigoFinca: "E0001", Nombre: "EM03-P04" }, { CodigoFinca: "E0001", Nombre: "EM04-E01" },
  { CodigoFinca: "E0001", Nombre: "EM04-E02" }, { CodigoFinca: "E0001", Nombre: "EM04-E03" },
  { CodigoFinca: "E0001", Nombre: "EM04-E04" }, { CodigoFinca: "E0001", Nombre: "EM04-E05" },
  { CodigoFinca: "E0001", Nombre: "EM04-E06" }, { CodigoFinca: "E0001", Nombre: "EM04-E07" },
  { CodigoFinca: "E0001", Nombre: "EM04-E08" }, { CodigoFinca: "E0001", Nombre: "EM04-P01" },
  { CodigoFinca: "E0001", Nombre: "EM04-P02" }, { CodigoFinca: "E0001", Nombre: "EM04-P03" },
  { CodigoFinca: "E0001", Nombre: "EM04-P04" }, { CodigoFinca: "E0001", Nombre: "EM05-E01" },
  { CodigoFinca: "E0001", Nombre: "EM05-E02" }, { CodigoFinca: "E0001", Nombre: "EM05-E03" },
  { CodigoFinca: "E0001", Nombre: "EM05-E04" }, { CodigoFinca: "E0001", Nombre: "EM05-P01" },
  { CodigoFinca: "E0001", Nombre: "EM05-P02" }, { CodigoFinca: "E0001", Nombre: "EM06-E01" },
  { CodigoFinca: "E0001", Nombre: "EM06-E02" }, { CodigoFinca: "E0001", Nombre: "EM07-E01" },
  { CodigoFinca: "E0001", Nombre: "EM07-E02" }, { CodigoFinca: "E0001", Nombre: "EM07-E03" },
  { CodigoFinca: "E0001", Nombre: "EM07-E04" }, { CodigoFinca: "E0001", Nombre: "EM08-E03" },
  { CodigoFinca: "E0001", Nombre: "EM08-E04" },
  { CodigoFinca: "IM001", Nombre: "1" }, { CodigoFinca: "IM001", Nombre: "2" }, { CodigoFinca: "IM001", Nombre: "3" },
  { CodigoFinca: "L0001", Nombre: "LABT-MA" }, { CodigoFinca: "L0001", Nombre: "LABT-MB" },
  { CodigoFinca: "MA001", Nombre: "K001" }, { CodigoFinca: "MA001", Nombre: "K002" },
  { CodigoFinca: "MA001", Nombre: "K003" }, { CodigoFinca: "MA001", Nombre: "K004" },
  { CodigoFinca: "MA001", Nombre: "K005" }, { CodigoFinca: "MA001", Nombre: "K006" },
  { CodigoFinca: "MA001", Nombre: "K007" }, { CodigoFinca: "MA001", Nombre: "K008" },
  { CodigoFinca: "MA001", Nombre: "K009" }, { CodigoFinca: "MA001", Nombre: "K010" },
  { CodigoFinca: "MA001", Nombre: "K011" }, { CodigoFinca: "MA001", Nombre: "K012" },
  { CodigoFinca: "MA001", Nombre: "K013" }, { CodigoFinca: "MA001", Nombre: "K014" },
  { CodigoFinca: "MA001", Nombre: "K015" }, { CodigoFinca: "MA001", Nombre: "K016" },
  { CodigoFinca: "MA001", Nombre: "K017" }, { CodigoFinca: "MA001", Nombre: "K018" },
  { CodigoFinca: "MA001", Nombre: "K019" },
  { CodigoFinca: "P0001", Nombre: "CAPS001" },
  { CodigoFinca: "T0001", Nombre: "TM-SIFON" }, { CodigoFinca: "T0001", Nombre: "TM00-E00" },
  { CodigoFinca: "T0001", Nombre: "TM00-P0A" }, { CodigoFinca: "T0001", Nombre: "TM00-P0B" },
  { CodigoFinca: "T0001", Nombre: "TM01-E01" }, { CodigoFinca: "T0001", Nombre: "TM01-E02" },
  { CodigoFinca: "T0001", Nombre: "TM01-E03" }, { CodigoFinca: "T0001", Nombre: "TM01-E04" },
  { CodigoFinca: "T0001", Nombre: "TM01-P01" }, { CodigoFinca: "T0001", Nombre: "TM01-P02" },
  { CodigoFinca: "T0001", Nombre: "TM01-P03" }, { CodigoFinca: "T0001", Nombre: "TM02-E01" },
  { CodigoFinca: "T0001", Nombre: "TM02-E02" }, { CodigoFinca: "T0001", Nombre: "TM02-E03" },
  { CodigoFinca: "T0001", Nombre: "TM02-E04" }, { CodigoFinca: "T0001", Nombre: "TM02-E05" },
  { CodigoFinca: "T0001", Nombre: "TM02-P01" }, { CodigoFinca: "T0001", Nombre: "TM02-P02" },
  { CodigoFinca: "T0001", Nombre: "TM02-P03" }, { CodigoFinca: "T0001", Nombre: "TM02-P04" },
  { CodigoFinca: "T0001", Nombre: "TM03-E01" }, { CodigoFinca: "T0001", Nombre: "TM03-E02" },
  { CodigoFinca: "T0001", Nombre: "TM03-E03" }, { CodigoFinca: "T0001", Nombre: "TM03-E04" },
  { CodigoFinca: "T0001", Nombre: "TM03-P01" }, { CodigoFinca: "T0001", Nombre: "TM04-E01" },
  { CodigoFinca: "T0001", Nombre: "TM04-E02" }, { CodigoFinca: "T0001", Nombre: "TM04-E03" },
  { CodigoFinca: "T0001", Nombre: "TM04-E04" }, { CodigoFinca: "T0001", Nombre: "TM04-E05" },
  { CodigoFinca: "T0001", Nombre: "TM04-E06" }, { CodigoFinca: "T0001", Nombre: "TM04-P01" },
  { CodigoFinca: "T0001", Nombre: "TM04-P02" }, { CodigoFinca: "T0001", Nombre: "TM04-P03" },
  { CodigoFinca: "T0001", Nombre: "TM05-E01" }, { CodigoFinca: "T0001", Nombre: "TM05-E02" },
  { CodigoFinca: "T0001", Nombre: "TM05-E03" }, { CodigoFinca: "T0001", Nombre: "TM05-E04" },
  { CodigoFinca: "T0001", Nombre: "TM05-E05" }, { CodigoFinca: "T0001", Nombre: "TM05-E06" },
  { CodigoFinca: "T0001", Nombre: "TM05-P01" }, { CodigoFinca: "T0001", Nombre: "TM05-P02" },
  { CodigoFinca: "T0001", Nombre: "TM05-P03" }, { CodigoFinca: "T0001", Nombre: "TM06-E01" },
  { CodigoFinca: "T0001", Nombre: "TM06-E02" }, { CodigoFinca: "T0001", Nombre: "TM06-E03" },
  { CodigoFinca: "T0001", Nombre: "TM06-E04" }, { CodigoFinca: "T0001", Nombre: "TM06-E05" },
  { CodigoFinca: "T0001", Nombre: "TM06-E06" }, { CodigoFinca: "T0001", Nombre: "TM07-E01" },
  { CodigoFinca: "T0001", Nombre: "TM07-E02" }, { CodigoFinca: "T0001", Nombre: "TM07-E03" },
  { CodigoFinca: "T0001", Nombre: "TM07-E04" }, { CodigoFinca: "T0001", Nombre: "TM07-E05" },
];

// Nota: la fila original T0001/TM06-E02/2025-09-01 traía Año=1 (error de captura);
// se corrigió a 2025 porque las fechas de inicio/cierre son inequívocamente de ese año.
const CICLOS = [
  { CodigoFinca: "E0001", Piscina: "EM01-E01", Anio: 2025, Ciclo: 5, FechaInicio: "2025-07-14", FechaCierre: "2025-09-13" },
  { CodigoFinca: "E0001", Piscina: "EM01-E02", Anio: 2025, Ciclo: 5, FechaInicio: "2025-07-14", FechaCierre: "2025-09-14" },
  { CodigoFinca: "E0001", Piscina: "EM01-E04", Anio: 2025, Ciclo: 6, FechaInicio: "2025-07-15", FechaCierre: "2025-09-14" },
  { CodigoFinca: "E0001", Piscina: "EM02-E01", Anio: 2025, Ciclo: 5, FechaInicio: "2025-03-20", FechaCierre: "2025-04-25" },
  { CodigoFinca: "E0001", Piscina: "EM02-E01", Anio: 2025, Ciclo: 6, FechaInicio: "2025-07-11", FechaCierre: "2025-09-16" },
  { CodigoFinca: "E0001", Piscina: "EM02-E03", Anio: 2025, Ciclo: 8, FechaInicio: "2025-07-12", FechaCierre: "2025-09-16" },
  { CodigoFinca: "E0001", Piscina: "EM02-E04", Anio: 2025, Ciclo: 6, FechaInicio: "2025-07-12", FechaCierre: "2025-09-17" },
  { CodigoFinca: "E0001", Piscina: "EM03-E01", Anio: 2025, Ciclo: 5, FechaInicio: "2025-07-15", FechaCierre: "2025-08-06" },
  { CodigoFinca: "E0001", Piscina: "EM03-E02", Anio: 2025, Ciclo: 6, FechaInicio: "2025-06-11", FechaCierre: "2025-08-05" },
  { CodigoFinca: "E0001", Piscina: "EM03-E02", Anio: 2026, Ciclo: 7, FechaInicio: "2026-05-05", FechaCierre: "2026-07-31" },
  { CodigoFinca: "E0001", Piscina: "EM03-E03", Anio: 2025, Ciclo: 5, FechaInicio: "2025-06-11", FechaCierre: "2025-08-04" },
  { CodigoFinca: "E0001", Piscina: "EM03-E03", Anio: 2026, Ciclo: 6, FechaInicio: "2026-05-05", FechaCierre: "2026-07-31" },
  { CodigoFinca: "E0001", Piscina: "EM03-E04", Anio: 2025, Ciclo: 4, FechaInicio: "2025-06-12", FechaCierre: "2025-08-04" },
  { CodigoFinca: "E0001", Piscina: "EM03-E04", Anio: 2026, Ciclo: 5, FechaInicio: "2026-05-05", FechaCierre: "2026-07-31" },
  { CodigoFinca: "E0001", Piscina: "EM03-E05", Anio: 2025, Ciclo: 6, FechaInicio: "2025-06-27", FechaCierre: "2025-08-06" },
  { CodigoFinca: "E0001", Piscina: "EM03-P02", Anio: 2026, Ciclo: 11, FechaInicio: "2026-05-07", FechaCierre: "2026-05-16" },
  { CodigoFinca: "E0001", Piscina: "EM04-E01", Anio: 2025, Ciclo: 4, FechaInicio: "2025-05-17", FechaCierre: "2025-07-04" },
  { CodigoFinca: "E0001", Piscina: "EM04-E01", Anio: 2025, Ciclo: 5, FechaInicio: "2025-07-11", FechaCierre: "2025-09-04" },
  { CodigoFinca: "E0001", Piscina: "EM04-E01", Anio: 2025, Ciclo: 6, FechaInicio: "2025-09-09", FechaCierre: "2025-10-08" },
  { CodigoFinca: "E0001", Piscina: "EM04-E02", Anio: 2025, Ciclo: 5, FechaInicio: "2025-06-27", FechaCierre: "2025-08-08" },
  { CodigoFinca: "E0001", Piscina: "EM04-E02", Anio: 2025, Ciclo: 6, FechaInicio: "2025-09-05", FechaCierre: "2025-10-07" },
  { CodigoFinca: "E0001", Piscina: "EM04-E03", Anio: 2025, Ciclo: 6, FechaInicio: "2025-06-27", FechaCierre: "2025-08-22" },
  { CodigoFinca: "E0001", Piscina: "EM04-E03", Anio: 2025, Ciclo: 7, FechaInicio: "2025-09-06", FechaCierre: "2025-10-07" },
  { CodigoFinca: "E0001", Piscina: "EM04-E04", Anio: 2025, Ciclo: 4, FechaInicio: "2025-05-14", FechaCierre: "2025-06-11" },
  { CodigoFinca: "E0001", Piscina: "EM04-E04", Anio: 2025, Ciclo: 5, FechaInicio: "2025-07-03", FechaCierre: "2025-09-01" },
  { CodigoFinca: "E0001", Piscina: "EM04-E04", Anio: 2025, Ciclo: 6, FechaInicio: "2025-09-25", FechaCierre: "2025-10-10" },
  { CodigoFinca: "E0001", Piscina: "EM04-E04", Anio: 2026, Ciclo: 7, FechaInicio: "2026-05-05", FechaCierre: "2026-07-31" },
  { CodigoFinca: "E0001", Piscina: "EM04-E05", Anio: 2025, Ciclo: 6, FechaInicio: "2025-05-14", FechaCierre: "2025-07-03" },
  { CodigoFinca: "E0001", Piscina: "EM04-E05", Anio: 2025, Ciclo: 7, FechaInicio: "2025-07-09", FechaCierre: "2025-09-01" },
  { CodigoFinca: "E0001", Piscina: "EM04-E05", Anio: 2025, Ciclo: 8, FechaInicio: "2025-09-13", FechaCierre: "2025-10-10" },
  { CodigoFinca: "E0001", Piscina: "EM04-E06", Anio: 2025, Ciclo: 5, FechaInicio: "2025-05-15", FechaCierre: "2025-07-05" },
  { CodigoFinca: "E0001", Piscina: "EM04-E06", Anio: 2025, Ciclo: 6, FechaInicio: "2025-07-09", FechaCierre: "2025-09-04" },
  { CodigoFinca: "E0001", Piscina: "EM04-E06", Anio: 2025, Ciclo: 7, FechaInicio: "2025-09-11", FechaCierre: "2025-09-27" },
  { CodigoFinca: "E0001", Piscina: "EM04-E07", Anio: 2025, Ciclo: 6, FechaInicio: "2025-05-03", FechaCierre: "2025-06-27" },
  { CodigoFinca: "E0001", Piscina: "EM04-E07", Anio: 2025, Ciclo: 7, FechaInicio: "2025-07-03", FechaCierre: "2025-10-08" },
  { CodigoFinca: "E0001", Piscina: "EM04-E08", Anio: 2025, Ciclo: 5, FechaInicio: "2025-05-16", FechaCierre: "2025-06-27" },
  { CodigoFinca: "E0001", Piscina: "EM04-E08", Anio: 2025, Ciclo: 6, FechaInicio: "2025-07-05", FechaCierre: "2025-09-27" },
  { CodigoFinca: "E0001", Piscina: "EM04-P01", Anio: 2025, Ciclo: 11, FechaInicio: "2025-05-03", FechaCierre: "2025-08-11" },
  { CodigoFinca: "E0001", Piscina: "EM04-P02", Anio: 2025, Ciclo: 11, FechaInicio: "2025-05-03", FechaCierre: "2025-08-11" },
  { CodigoFinca: "E0001", Piscina: "EM04-P03", Anio: 2025, Ciclo: 11, FechaInicio: "2025-05-03", FechaCierre: "2025-08-11" },
  { CodigoFinca: "E0001", Piscina: "EM04-P04", Anio: 2025, Ciclo: 9, FechaInicio: "2025-05-05", FechaCierre: "2025-08-13" },
  { CodigoFinca: "E0001", Piscina: "EM05-E01", Anio: 2025, Ciclo: 7, FechaInicio: "2025-06-03", FechaCierre: "2025-08-22" },
  { CodigoFinca: "E0001", Piscina: "EM05-E02", Anio: 2025, Ciclo: 8, FechaInicio: "2025-06-03", FechaCierre: "2025-09-02" },
  { CodigoFinca: "E0001", Piscina: "EM05-E03", Anio: 2025, Ciclo: 6, FechaInicio: "2025-04-11", FechaCierre: "2025-05-21" },
  { CodigoFinca: "E0001", Piscina: "EM05-E03", Anio: 2025, Ciclo: 7, FechaInicio: "2025-06-09", FechaCierre: "2025-08-21" },
  { CodigoFinca: "E0001", Piscina: "EM05-E03", Anio: 2026, Ciclo: 8, FechaInicio: "2026-05-05", FechaCierre: "2026-07-31" },
  { CodigoFinca: "E0001", Piscina: "EM05-E04", Anio: 2025, Ciclo: 7, FechaInicio: "2025-06-10", FechaCierre: "2025-08-07" },
  { CodigoFinca: "E0001", Piscina: "EM05-E04", Anio: 2026, Ciclo: 8, FechaInicio: "2026-05-05", FechaCierre: "2026-07-31" },
  { CodigoFinca: "E0001", Piscina: "EM05-P01", Anio: 2025, Ciclo: 9, FechaInicio: "2025-05-02", FechaCierre: "2025-08-10" },
  { CodigoFinca: "E0001", Piscina: "EM05-P02", Anio: 2025, Ciclo: 9, FechaInicio: "2025-05-02", FechaCierre: "2025-08-10" },
  { CodigoFinca: "E0001", Piscina: "EM06-E01", Anio: 2025, Ciclo: 2, FechaInicio: "2025-04-10", FechaCierre: "2025-07-10" },
  { CodigoFinca: "E0001", Piscina: "EM06-E01", Anio: 2025, Ciclo: 3, FechaInicio: "2025-08-06", FechaCierre: "2025-09-26" },
  { CodigoFinca: "E0001", Piscina: "EM06-E02", Anio: 2025, Ciclo: 3, FechaInicio: "2025-05-20", FechaCierre: "2025-07-11" },
  { CodigoFinca: "E0001", Piscina: "EM07-E01", Anio: 2025, Ciclo: 1, FechaInicio: "2025-07-08", FechaCierre: "2025-09-09" },
  { CodigoFinca: "E0001", Piscina: "EM07-E02", Anio: 2025, Ciclo: 1, FechaInicio: "2025-07-08", FechaCierre: "2025-08-27" },
  { CodigoFinca: "E0001", Piscina: "EM07-E03", Anio: 2025, Ciclo: 1, FechaInicio: "2025-07-04", FechaCierre: "2025-08-28" },
  { CodigoFinca: "E0001", Piscina: "EM07-E04", Anio: 2025, Ciclo: 1, FechaInicio: "2025-06-30", FechaCierre: "2025-09-10" },
  { CodigoFinca: "E0001", Piscina: "EM08-E03", Anio: 2025, Ciclo: 1, FechaInicio: "2025-07-20", FechaCierre: "2025-08-11" },
  { CodigoFinca: "E0001", Piscina: "EM08-E04", Anio: 2025, Ciclo: 1, FechaInicio: "2025-07-20", FechaCierre: "2025-09-11" },
  { CodigoFinca: "T0001", Piscina: "TM01-E01", Anio: 2025, Ciclo: 7, FechaInicio: "2025-04-25", FechaCierre: "2025-08-14" },
  { CodigoFinca: "T0001", Piscina: "TM01-E01", Anio: 2025, Ciclo: 8, FechaInicio: "2025-08-26", FechaCierre: "2025-08-30" },
  { CodigoFinca: "T0001", Piscina: "TM01-E02", Anio: 2025, Ciclo: 6, FechaInicio: "2025-04-10", FechaCierre: "2025-08-07" },
  { CodigoFinca: "T0001", Piscina: "TM01-E02", Anio: 2025, Ciclo: 7, FechaInicio: "2025-08-20", FechaCierre: "2025-09-06" },
  { CodigoFinca: "T0001", Piscina: "TM01-E03", Anio: 2024, Ciclo: 4, FechaInicio: "2024-05-02", FechaCierre: "2024-09-16" },
  { CodigoFinca: "T0001", Piscina: "TM01-E03", Anio: 2024, Ciclo: 5, FechaInicio: "2024-09-22", FechaCierre: "2025-01-17" },
  { CodigoFinca: "T0001", Piscina: "TM01-E03", Anio: 2025, Ciclo: 6, FechaInicio: "2025-04-05", FechaCierre: "2025-08-13" },
  { CodigoFinca: "T0001", Piscina: "TM01-E03", Anio: 2025, Ciclo: 7, FechaInicio: "2025-08-22", FechaCierre: "2025-09-08" },
  { CodigoFinca: "T0001", Piscina: "TM01-E04", Anio: 2025, Ciclo: 6, FechaInicio: "2025-04-17", FechaCierre: "2025-08-08" },
  { CodigoFinca: "T0001", Piscina: "TM01-E04", Anio: 2025, Ciclo: 7, FechaInicio: "2025-12-10", FechaCierre: "2026-05-30" },
  { CodigoFinca: "T0001", Piscina: "TM02-E01", Anio: 2025, Ciclo: 6, FechaInicio: "2025-04-09", FechaCierre: "2025-08-12" },
  { CodigoFinca: "T0001", Piscina: "TM02-E01", Anio: 2025, Ciclo: 7, FechaInicio: "2025-08-28", FechaCierre: "2025-09-16" },
  { CodigoFinca: "T0001", Piscina: "TM02-E01", Anio: 2026, Ciclo: 9, FechaInicio: "2026-01-19", FechaCierre: "2026-07-31" },
  { CodigoFinca: "T0001", Piscina: "TM02-E02", Anio: 2025, Ciclo: 6, FechaInicio: "2025-04-14", FechaCierre: "2025-08-02" },
  { CodigoFinca: "T0001", Piscina: "TM02-E02", Anio: 2025, Ciclo: 7, FechaInicio: "2025-08-15", FechaCierre: "2025-09-22" },
  { CodigoFinca: "T0001", Piscina: "TM02-E02", Anio: 2026, Ciclo: 8, FechaInicio: "2026-05-05", FechaCierre: "2026-07-31" },
  { CodigoFinca: "T0001", Piscina: "TM02-E03", Anio: 2025, Ciclo: 6, FechaInicio: "2025-04-22", FechaCierre: "2025-08-01" },
  { CodigoFinca: "T0001", Piscina: "TM02-E03", Anio: 2025, Ciclo: 7, FechaInicio: "2025-08-16", FechaCierre: "2025-09-12" },
  { CodigoFinca: "T0001", Piscina: "TM02-E03", Anio: 2026, Ciclo: 8, FechaInicio: "2026-05-05", FechaCierre: "2026-07-31" },
  { CodigoFinca: "T0001", Piscina: "TM02-E04", Anio: 2025, Ciclo: 7, FechaInicio: "2025-04-16", FechaCierre: "2025-08-11" },
  { CodigoFinca: "T0001", Piscina: "TM02-E04", Anio: 2025, Ciclo: 8, FechaInicio: "2025-08-21", FechaCierre: "2025-09-19" },
  { CodigoFinca: "T0001", Piscina: "TM02-E05", Anio: 2025, Ciclo: 5, FechaInicio: "2025-04-16", FechaCierre: "2025-08-06" },
  { CodigoFinca: "T0001", Piscina: "TM02-E05", Anio: 2025, Ciclo: 6, FechaInicio: "2025-08-18", FechaCierre: "2025-09-13" },
  { CodigoFinca: "T0001", Piscina: "TM02-E05", Anio: 2026, Ciclo: 7, FechaInicio: "2026-01-06", FechaCierre: "2026-07-31" },
  { CodigoFinca: "T0001", Piscina: "TM02-P01", Anio: 2025, Ciclo: 11, FechaInicio: "2025-05-18", FechaCierre: "2025-08-26" },
  { CodigoFinca: "T0001", Piscina: "TM02-P02", Anio: 2025, Ciclo: 11, FechaInicio: "2025-05-18", FechaCierre: "2025-08-26" },
  { CodigoFinca: "T0001", Piscina: "TM02-P03", Anio: 2025, Ciclo: 10, FechaInicio: "2025-05-23", FechaCierre: "2025-08-31" },
  { CodigoFinca: "T0001", Piscina: "TM03-E01", Anio: 2025, Ciclo: 8, FechaInicio: "2025-04-07", FechaCierre: "2025-07-31" },
  { CodigoFinca: "T0001", Piscina: "TM03-E01", Anio: 2025, Ciclo: 9, FechaInicio: "2025-08-06", FechaCierre: "2025-09-26" },
  { CodigoFinca: "T0001", Piscina: "TM03-E02", Anio: 2025, Ciclo: 6, FechaInicio: "2025-04-06", FechaCierre: "2025-07-22" },
  { CodigoFinca: "T0001", Piscina: "TM03-E02", Anio: 2025, Ciclo: 7, FechaInicio: "2025-08-04", FechaCierre: "2025-09-25" },
  { CodigoFinca: "T0001", Piscina: "TM03-E03", Anio: 2025, Ciclo: 5, FechaInicio: "2025-04-03", FechaCierre: "2025-07-12" },
  { CodigoFinca: "T0001", Piscina: "TM03-E03", Anio: 2025, Ciclo: 6, FechaInicio: "2025-08-11", FechaCierre: "2025-09-11" },
  { CodigoFinca: "T0001", Piscina: "TM03-E04", Anio: 2025, Ciclo: 9, FechaInicio: "2025-08-01", FechaCierre: "2025-08-22" },
  { CodigoFinca: "T0001", Piscina: "TM04-E01", Anio: 2025, Ciclo: 5, FechaInicio: "2025-03-29", FechaCierre: "2025-06-30" },
  { CodigoFinca: "T0001", Piscina: "TM04-E01", Anio: 2025, Ciclo: 6, FechaInicio: "2025-07-23", FechaCierre: "2025-10-30" },
  { CodigoFinca: "T0001", Piscina: "TM04-E01", Anio: 2026, Ciclo: 7, FechaInicio: "2026-01-07", FechaCierre: "2026-07-31" },
  { CodigoFinca: "T0001", Piscina: "TM04-E02", Anio: 2025, Ciclo: 5, FechaInicio: "2025-04-02", FechaCierre: "2025-07-04" },
  { CodigoFinca: "T0001", Piscina: "TM04-E02", Anio: 2025, Ciclo: 6, FechaInicio: "2025-07-25", FechaCierre: "2025-10-30" },
  { CodigoFinca: "T0001", Piscina: "TM04-E02", Anio: 2026, Ciclo: 7, FechaInicio: "2026-01-16", FechaCierre: "2026-07-31" },
  { CodigoFinca: "T0001", Piscina: "TM04-E03", Anio: 2025, Ciclo: 6, FechaInicio: "2025-04-28", FechaCierre: "2025-07-09" },
  { CodigoFinca: "T0001", Piscina: "TM04-E03", Anio: 2025, Ciclo: 7, FechaInicio: "2025-07-29", FechaCierre: "2025-09-25" },
  { CodigoFinca: "T0001", Piscina: "TM04-E03", Anio: 2025, Ciclo: 8, FechaInicio: "2025-09-28", FechaCierre: "2025-11-30" },
  { CodigoFinca: "T0001", Piscina: "TM04-E03", Anio: 2026, Ciclo: 9, FechaInicio: "2026-01-20", FechaCierre: "2026-07-31" },
  { CodigoFinca: "T0001", Piscina: "TM04-E04", Anio: 2025, Ciclo: 4, FechaInicio: "2025-04-04", FechaCierre: "2025-07-02" },
  { CodigoFinca: "T0001", Piscina: "TM04-E04", Anio: 2025, Ciclo: 5, FechaInicio: "2025-09-10", FechaCierre: "2025-11-30" },
  { CodigoFinca: "T0001", Piscina: "TM04-E05", Anio: 2025, Ciclo: 5, FechaInicio: "2025-05-13", FechaCierre: "2025-07-10" },
  { CodigoFinca: "T0001", Piscina: "TM04-E05", Anio: 2025, Ciclo: 6, FechaInicio: "2025-07-31", FechaCierre: "2025-11-30" },
  { CodigoFinca: "T0001", Piscina: "TM04-E06", Anio: 2025, Ciclo: 4, FechaInicio: "2025-03-31", FechaCierre: "2025-06-28" },
  { CodigoFinca: "T0001", Piscina: "TM04-E06", Anio: 2025, Ciclo: 5, FechaInicio: "2025-08-02", FechaCierre: "2025-10-30" },
  { CodigoFinca: "T0001", Piscina: "TM05-E01", Anio: 2025, Ciclo: 4, FechaInicio: "2025-04-08", FechaCierre: "2025-07-01" },
  { CodigoFinca: "T0001", Piscina: "TM05-E01", Anio: 2025, Ciclo: 5, FechaInicio: "2025-08-12", FechaCierre: "2025-11-30" },
  { CodigoFinca: "T0001", Piscina: "TM05-E02", Anio: 2025, Ciclo: 4, FechaInicio: "2025-04-05", FechaCierre: "2025-06-23" },
  { CodigoFinca: "T0001", Piscina: "TM05-E02", Anio: 2025, Ciclo: 5, FechaInicio: "2025-07-02", FechaCierre: "2025-07-16" },
  { CodigoFinca: "T0001", Piscina: "TM05-E02", Anio: 2025, Ciclo: 6, FechaInicio: "2025-09-06", FechaCierre: "2025-11-30" },
  { CodigoFinca: "T0001", Piscina: "TM05-E03", Anio: 2025, Ciclo: 4, FechaInicio: "2025-04-01", FechaCierre: "2025-06-19" },
  { CodigoFinca: "T0001", Piscina: "TM05-E03", Anio: 2025, Ciclo: 5, FechaInicio: "2025-06-26", FechaCierre: "2025-08-20" },
  { CodigoFinca: "T0001", Piscina: "TM05-E03", Anio: 2025, Ciclo: 6, FechaInicio: "2025-09-19", FechaCierre: "2025-12-30" },
  { CodigoFinca: "T0001", Piscina: "TM05-E04", Anio: 2025, Ciclo: 4, FechaInicio: "2025-06-19", FechaCierre: "2025-07-11" },
  { CodigoFinca: "T0001", Piscina: "TM05-E04", Anio: 2025, Ciclo: 5, FechaInicio: "2025-07-15", FechaCierre: "2025-08-25" },
  { CodigoFinca: "T0001", Piscina: "TM05-E04", Anio: 2025, Ciclo: 6, FechaInicio: "2025-09-22", FechaCierre: "2025-12-30" },
  { CodigoFinca: "T0001", Piscina: "TM05-E05", Anio: 2025, Ciclo: 5, FechaInicio: "2025-05-01", FechaCierre: "2025-07-03" },
  { CodigoFinca: "T0001", Piscina: "TM05-E05", Anio: 2025, Ciclo: 6, FechaInicio: "2025-08-18", FechaCierre: "2025-12-30" },
  { CodigoFinca: "T0001", Piscina: "TM05-E05", Anio: 2026, Ciclo: 7, FechaInicio: "2026-01-06", FechaCierre: "2026-08-10" },
  { CodigoFinca: "T0001", Piscina: "TM05-E06", Anio: 2025, Ciclo: 4, FechaInicio: "2025-04-17", FechaCierre: "2025-07-07" },
  { CodigoFinca: "T0001", Piscina: "TM05-E06", Anio: 2025, Ciclo: 5, FechaInicio: "2025-08-08", FechaCierre: "2025-12-30" },
  { CodigoFinca: "T0001", Piscina: "TM05-P01", Anio: 2025, Ciclo: 11, FechaInicio: "2025-05-23", FechaCierre: "2025-08-31" },
  { CodigoFinca: "T0001", Piscina: "TM05-P02", Anio: 2025, Ciclo: 11, FechaInicio: "2025-05-24", FechaCierre: "2025-09-01" },
  { CodigoFinca: "T0001", Piscina: "TM05-P03", Anio: 2025, Ciclo: 11, FechaInicio: "2025-05-26", FechaCierre: "2025-09-03" },
  { CodigoFinca: "T0001", Piscina: "TM06-E01", Anio: 2025, Ciclo: 1, FechaInicio: "2025-04-12", FechaCierre: "2025-07-09" },
  { CodigoFinca: "T0001", Piscina: "TM06-E01", Anio: 2025, Ciclo: 2, FechaInicio: "2025-09-16", FechaCierre: "2025-12-30" },
  { CodigoFinca: "T0001", Piscina: "TM06-E02", Anio: 2025, Ciclo: 2, FechaInicio: "2025-09-01", FechaCierre: "2025-10-15" },
  { CodigoFinca: "T0001", Piscina: "TM06-E02", Anio: 2025, Ciclo: 1, FechaInicio: "2025-04-28", FechaCierre: "2025-07-18" },
  { CodigoFinca: "T0001", Piscina: "TM06-E02", Anio: 2026, Ciclo: 3, FechaInicio: "2026-02-13", FechaCierre: "2026-07-31" },
  { CodigoFinca: "T0001", Piscina: "TM06-E03", Anio: 2025, Ciclo: 1, FechaInicio: "2025-05-08", FechaCierre: "2025-07-28" },
  { CodigoFinca: "T0001", Piscina: "TM06-E03", Anio: 2025, Ciclo: 2, FechaInicio: "2025-10-04", FechaCierre: "2025-10-30" },
  { CodigoFinca: "T0001", Piscina: "TM06-E03", Anio: 2026, Ciclo: 3, FechaInicio: "2026-05-05", FechaCierre: "2026-07-31" },
  { CodigoFinca: "T0001", Piscina: "TM06-E04", Anio: 2025, Ciclo: 1, FechaInicio: "2025-05-16", FechaCierre: "2025-07-16" },
  { CodigoFinca: "T0001", Piscina: "TM06-E04", Anio: 2026, Ciclo: 2, FechaInicio: "2026-05-05", FechaCierre: "2026-07-31" },
  { CodigoFinca: "T0001", Piscina: "TM06-E05", Anio: 2025, Ciclo: 1, FechaInicio: "2025-05-22", FechaCierre: "2025-07-30" },
  { CodigoFinca: "T0001", Piscina: "TM06-E06", Anio: 2025, Ciclo: 1, FechaInicio: "2025-04-16", FechaCierre: "2025-07-29" },
  { CodigoFinca: "T0001", Piscina: "TM06-E06", Anio: 2025, Ciclo: 2, FechaInicio: "2025-09-23", FechaCierre: "2025-12-30" },
  { CodigoFinca: "T0001", Piscina: "TM07-E01", Anio: 2025, Ciclo: 1, FechaInicio: "2025-07-10", FechaCierre: "2025-09-29" },
  { CodigoFinca: "T0001", Piscina: "TM07-E02", Anio: 2025, Ciclo: 1, FechaInicio: "2025-07-10", FechaCierre: "2025-10-02" },
  { CodigoFinca: "T0001", Piscina: "TM07-E03", Anio: 2025, Ciclo: 1, FechaInicio: "2025-07-18", FechaCierre: "2025-10-04" },
  { CodigoFinca: "T0001", Piscina: "TM07-E04", Anio: 2025, Ciclo: 1, FechaInicio: "2025-07-10", FechaCierre: "2025-08-22" },
  { CodigoFinca: "T0001", Piscina: "TM07-E05", Anio: 2025, Ciclo: 1, FechaInicio: "2025-07-18", FechaCierre: "2025-08-25" },
];

async function main() {
  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Finca (
      Codigo      VARCHAR(10)   NOT NULL PRIMARY KEY,
      Descripcion VARCHAR(100)  NOT NULL,
      Grupo       VARCHAR(100)  NULL,
      Abreviatura VARCHAR(10)   NOT NULL,
      Activo      TINYINT(1)    NOT NULL DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla Finca creada.");

  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Piscina (
      PiscinaId   INT AUTO_INCREMENT PRIMARY KEY,
      CodigoFinca VARCHAR(10)  NOT NULL,
      Nombre      VARCHAR(20)  NOT NULL,
      Activo      TINYINT(1)   NOT NULL DEFAULT 1,
      CONSTRAINT fk_piscina_finca FOREIGN KEY (CodigoFinca) REFERENCES Finca(Codigo),
      UNIQUE KEY uq_piscina (CodigoFinca, Nombre)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla Piscina creada.");

  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Ciclo (
      CicloId     INT AUTO_INCREMENT PRIMARY KEY,
      PiscinaId   INT          NOT NULL,
      Anio        INT          NOT NULL,
      Ciclo       INT          NOT NULL,
      FechaInicio DATE         NULL,
      FechaCierre DATE         NULL,
      Activo      TINYINT(1)   NOT NULL DEFAULT 1,
      CONSTRAINT fk_ciclo_piscina FOREIGN KEY (PiscinaId) REFERENCES Piscina(PiscinaId),
      UNIQUE KEY uq_ciclo (PiscinaId, Anio, Ciclo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("Tabla Ciclo creada.");

  for (const f of FINCAS) {
    await p.$executeRawUnsafe(
      `INSERT IGNORE INTO Finca (Codigo, Descripcion, Grupo, Abreviatura) VALUES (?, ?, ?, ?)`,
      f.Codigo, f.Descripcion, f.Grupo, f.Abreviatura
    );
  }
  console.log(`${FINCAS.length} fincas insertadas (INSERT IGNORE).`);

  for (const ps of PISCINAS) {
    await p.$executeRawUnsafe(
      `INSERT IGNORE INTO Piscina (CodigoFinca, Nombre) VALUES (?, ?)`,
      ps.CodigoFinca, ps.Nombre
    );
  }
  console.log(`${PISCINAS.length} piscinas insertadas (INSERT IGNORE).`);

  let insertados = 0;
  for (const c of CICLOS) {
    const rows: any[] = await p.$queryRawUnsafe(
      `SELECT PiscinaId FROM Piscina WHERE CodigoFinca = ? AND Nombre = ? LIMIT 1`,
      c.CodigoFinca, c.Piscina
    );
    if (!rows.length) {
      console.warn(`Sin piscina para ${c.CodigoFinca}/${c.Piscina}, se omite ciclo.`);
      continue;
    }
    await p.$executeRawUnsafe(
      `INSERT IGNORE INTO Ciclo (PiscinaId, Anio, Ciclo, FechaInicio, FechaCierre) VALUES (?, ?, ?, ?, ?)`,
      rows[0].PiscinaId, c.Anio, c.Ciclo, c.FechaInicio, c.FechaCierre
    );
    insertados++;
  }
  console.log(`${insertados} ciclos insertados (INSERT IGNORE).`);

  await p.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
