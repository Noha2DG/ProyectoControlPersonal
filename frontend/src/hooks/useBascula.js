import { useEffect, useRef, useState } from "react";

// Peso en vivo de la báscula del cabezal Android.
//
// La APK "Báscula Puente" (proyecto aparte, Documents/BasculaPuente) lee el puerto serie y
// publica cada trama por WebSocket SOLO dentro del equipo (127.0.0.1). Este hook se conecta,
// se reconecta solo si la APK se reinicia o el puerto se cae, y entrega el último peso.
//
// Mensajes que manda la APK:
//   hola / estado (cada 2 s): { balanza, version, puerto, estadoPuerto, detalle, ... }
//   lectura (~5 por segundo):  { balanza, gramos, kg, estable, trama, hora, epochMs }
//
// "estable" lo decide la APK (4 lecturas seguidas dentro de ±2 g); la báscula no lo marca.
// La hora del cabezal NO es confiable (vimos su zona en −07:00): para registrar, que mande el
// servidor; la de aquí solo sirve para saber si la lectura está fresca.

export const URL_PUENTE = "ws://127.0.0.1:8765";

// Si en este tiempo no llega nada (ni lectura ni latido), se da por caída la conexión.
const SILENCIO_CONEXION_MS = 6000;
// Una lectura más vieja que esto ya no representa lo que hay en el plato.
const LECTURA_VIGENTE_MS = 1500;

const ESTADO_INICIAL = {
  conectado: false,        // hay WebSocket abierto con la APK
  balanza: null,           // código configurado en la APK (ej. BAL-01); null = sin configurar
  configurada: true,       // false si en la APK nadie puso el código de balanza
  version: null,
  estadoPuerto: null,      // LEYENDO | SIN_DATOS | ABRIENDO | ERROR | DETENIDO
  detalle: "",
  gramos: null,
  estable: false,
  trama: null,
  recibidaEn: 0,           // Date.now() del navegador al recibir la última lectura
};

// Comandos remotos (pantalla Básculas → servidor → app del cabezal → aquí):
//   recargar      → recarga la página (p. ej. tras desplegar una versión nueva)
//   cerrar_sesion → llama a `alCerrarSesion`, que la pantalla de pesaje usa para sacar a la operadora
export function useBascula({ url = URL_PUENTE, activo = true, alCerrarSesion } = {}) {
  const [estado, setEstado] = useState(ESTADO_INICIAL);
  const [ahora, setAhora] = useState(() => Date.now());
  const wsRef = useRef(null);
  const alCerrarSesionRef = useRef(alCerrarSesion);
  alCerrarSesionRef.current = alCerrarSesion;

  useEffect(() => {
    if (!activo) return undefined;
    let cerrado = false;
    let reintento = null;
    let espera = 1000;
    let ultimoMensaje = 0;

    const conectar = () => {
      if (cerrado) return;
      let ws;
      try {
        ws = new WebSocket(url);
      } catch {
        programarReintento();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        espera = 1000;
        ultimoMensaje = Date.now();
        setEstado(e => ({ ...e, conectado: true }));
      };

      ws.onmessage = (ev) => {
        ultimoMensaje = Date.now();
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m.tipo === "lectura") {
          setEstado(e => ({
            ...e,
            conectado: true,
            balanza: "balanza" in m ? m.balanza : e.balanza,
            gramos: m.gramos,
            estable: !!m.estable,
            trama: m.trama,
            estadoPuerto: "LEYENDO",
            detalle: "",
            recibidaEn: Date.now(),
          }));
        } else if (m.tipo === "hola" || m.tipo === "estado") {
          setEstado(e => ({
            ...e,
            conectado: true,
            balanza: "balanza" in m ? m.balanza : e.balanza,
            version: m.version ?? e.version,
            configurada: m.configurada ?? e.configurada,
            estadoPuerto: m.estadoPuerto ?? e.estadoPuerto,
            detalle: m.detalle ?? "",
          }));
        } else if (m.tipo === "comando") {
          if (m.accion === "recargar") window.location.reload();
          else if (m.accion === "cerrar_sesion") alCerrarSesionRef.current?.();
        }
      };

      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        setEstado(e => ({ ...e, conectado: false }));
        programarReintento();
      };
      // onerror siempre va seguido de onclose: ahí se reintenta.
      ws.onerror = () => {};
    };

    const programarReintento = () => {
      if (cerrado || reintento) return;
      reintento = setTimeout(() => {
        reintento = null;
        conectar();
      }, espera);
      espera = Math.min(espera * 2, 5000);
    };

    // Vigía: detecta conexiones "colgadas" (abiertas pero sin mensajes) y refresca "ahora"
    // para que la lectura pase a vieja aunque no lleguen mensajes nuevos.
    const vigia = setInterval(() => {
      const t = Date.now();
      setAhora(t);
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN && t - ultimoMensaje > SILENCIO_CONEXION_MS) {
        ws.close();
      }
    }, 500);

    conectar();

    return () => {
      cerrado = true;
      clearInterval(vigia);
      if (reintento) clearTimeout(reintento);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, [url, activo]);

  const vigente = estado.conectado && estado.gramos !== null && ahora - estado.recibidaEn < LECTURA_VIGENTE_MS;

  return {
    ...estado,
    // true solo si el peso mostrado es actual: conexión viva y lectura reciente.
    vigente,
    // listo para registrar: lectura vigente y estable.
    estableVigente: vigente && estado.estable,
  };
}
