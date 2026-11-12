// Color de la cinta de cada hoja de la jornada (Tratamiento y Descongelado): cada hoja lleva el suyo
// en la cinta y en su pestaña, para no confundirlas al cambiar de una a otra. Va por el orden de la
// hoja en el día; con más de ocho hojas se repiten.
const CINTAS = [
  { cinta: "bg-gray-800",    punto: "bg-gray-700" },
  { cinta: "bg-blue-800",    punto: "bg-blue-600" },
  { cinta: "bg-purple-800",  punto: "bg-purple-600" },
  { cinta: "bg-rose-800",    punto: "bg-rose-600" },
  { cinta: "bg-cyan-800",    punto: "bg-cyan-600" },
  { cinta: "bg-orange-800",  punto: "bg-orange-600" },
  { cinta: "bg-indigo-800",  punto: "bg-indigo-600" },
  { cinta: "bg-fuchsia-800", punto: "bg-fuchsia-600" },
];
export const cintaDe = (hojas, hojaId) => CINTAS[Math.max(0, hojas.findIndex(h => h.HojaId === hojaId)) % CINTAS.length];
