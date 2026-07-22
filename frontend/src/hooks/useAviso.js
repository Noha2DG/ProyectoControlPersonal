import { useState } from "react";

// Reemplazo de alert()/confirm() nativos por un modal propio con color según el tipo — los diálogos
// nativos del navegador no se pueden estilizar y son fáciles de perder de vista en pantalla. Ambas
// funciones devuelven una Promise (igual que un await fetch) a propósito: la mayoría de los handlers
// que llaman esto ya son async, así que "if (!confirm(...)) return;" pasa a ser
// "if (!(await pedirConfirmacion(...))) return;" sin reestructurar el resto del flujo.
export function useAviso() {
  const [aviso, setAviso] = useState(null);

  const mostrarAlerta = (mensaje, tipo = "error") =>
    new Promise(resolve => setAviso({ tipo, mensaje, confirmar: false, resolve }));

  const pedirConfirmacion = (mensaje, opciones = {}) =>
    new Promise(resolve => setAviso({ tipo: "advertencia", mensaje, confirmar: true, resolve, ...opciones }));

  const cerrar = (valor) => { aviso?.resolve(valor); setAviso(null); };

  return { aviso, mostrarAlerta, pedirConfirmacion, cerrar };
}
