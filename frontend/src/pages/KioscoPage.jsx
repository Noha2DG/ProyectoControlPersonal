import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "../context/AuthContext.jsx";

const DIAS = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

function reloj() {
  const ahora = new Date();
  return ahora.toLocaleTimeString("es-GT", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
}

function fechaLarga() {
  const d = new Date();
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

export default function KioscoPage() {
  const { logout } = useAuth();
  const [hora, setHora] = useState(reloj());
  const [fecha, setFecha] = useState(fechaLarga());
  const [input, setInput] = useState("");
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState("");
  const [procesando, setProcesando] = useState(false);
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef(null);

  // Salida oculta: 5 toques rápidos en la esquina cierran la sesión del kiosco
  const handleSecretTap = (e) => {
    e.stopPropagation();
    tapCountRef.current += 1;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    if (tapCountRef.current >= 5) {
      tapCountRef.current = 0;
      logout();
      window.location.hash = "";
      return;
    }
    tapTimerRef.current = setTimeout(() => { tapCountRef.current = 0; }, 2000);
  };

  useEffect(() => () => { if (tapTimerRef.current) clearTimeout(tapTimerRef.current); }, []);

  useEffect(() => {
    const id = setInterval(() => { setHora(reloj()); setFecha(fechaLarga()); }, 1000);
    return () => clearInterval(id);
  }, []);

  const limpiar = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setResultado(null);
      setError("");
      setInput("");
      inputRef.current?.focus();
    }, 2000);
  }, []);

  const registrar = async (codigo) => {
    if (!codigo.trim() || procesando) return;
    setProcesando(true);
    setError("");
    setResultado(null);
    try {
      const token = localStorage.getItem("cp_token");
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch("/api/movimientos/registrar", {
        method: "POST",
        headers,
        body: JSON.stringify({ Codigo: codigo.trim().toUpperCase() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Error al registrar");
      } else {
        // data.hora ya viene en hora local Guatemala "YYYY-MM-DD HH:MM:SS"
        const horaLocal = data.hora.split(" ")[1] || data.hora;
        setResultado({ ...data, horaLocal });

        // Auto-asignar a Área General (TT) en cada Entrada
        if (data.tipo === "Entrada") {
          fetch("/api/transferencias", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ Codigo: codigo.trim().toUpperCase(), CodigoArea: "TT" }),
          }).catch(() => {});
        }
      }
    } catch {
      setError("No se pudo conectar con el servidor");
    } finally {
      setProcesando(false);
      limpiar();
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      registrar(input);
      setInput("");
    }
  };

  const esEntrada = resultado?.tipo === "Entrada";

  const fotoBorde = resultado
    ? esEntrada
      ? "border-green-500 shadow-[0_0_0_4px_rgba(34,197,94,0.25)]"
      : "border-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.25)]"
    : "border-gray-200";

  // Mantener el foco siempre en el input al hacer clic en cualquier parte
  const handlePageClick = () => inputRef.current?.focus();

  return (
    <div
      className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 select-none"
      onClick={handlePageClick}
    >

      <div onClick={handleSecretTap} className="fixed top-0 right-0 w-16 h-16 z-50" aria-hidden="true" />

      <div className="w-full max-w-md mb-5 text-center">
        <h1 className="text-white text-2xl font-bold tracking-wide">Entrada / Salida General</h1>
        <p className="text-gray-400 text-sm mt-1">{fecha}</p>
      </div>

      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">

        <div className="bg-blue-800 text-white text-center py-2 px-4">
          <span className="font-semibold text-sm tracking-wider">ENTRADA / SALIDA GENERAL</span>
        </div>

        <div className="p-6 flex flex-col items-center gap-5">

          {/* Foto */}
          <div className={`w-44 h-52 rounded-xl overflow-hidden border-4 transition-all duration-300 bg-gray-100 flex items-center justify-center ${fotoBorde}`}>
            {resultado ? (
              <>
                <img
                  src={`/uploads/fotos/${resultado.empleado.Codigo}.jpg`}
                  alt={resultado.empleado.NombreCompleto}
                  className="w-full h-full object-cover"
                  onError={e => {
                    e.currentTarget.style.display = "none";
                    e.currentTarget.nextSibling.style.display = "flex";
                  }}
                />
                <div className="hidden w-full h-full items-center justify-center bg-gray-200">
                  <svg className="w-20 h-20 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center text-gray-300 gap-2">
                <svg className="w-16 h-16 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span className="text-xs text-gray-400">Esperando...</span>
              </div>
            )}
          </div>

          {/* Info empleado o reloj */}
          {resultado ? (
            <div className="w-full text-center space-y-1">
              <p className="text-gray-400 text-xs font-mono">{resultado.empleado.Codigo}</p>
              <p className="text-gray-900 font-bold text-lg leading-tight">{resultado.empleado.NombreCompleto}</p>
              <p className="text-3xl font-mono font-bold text-gray-800 mt-1">{resultado.horaLocal}</p>
              <p className="text-gray-400 text-sm">{resultado.diaSemana}</p>
            </div>
          ) : error ? (
            <div className="w-full text-center">
              <p className="text-red-500 font-semibold">{error}</p>
              <p className="text-gray-400 text-xs mt-1">Limpiando pantalla...</p>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-4xl font-mono font-bold text-gray-800">{hora}</p>
              <p className="text-gray-400 text-sm mt-1">Pasa tu tarjeta por el lector</p>
            </div>
          )}

          {/* Badge Entrada / Salida */}
          {resultado && (
            <div className={`w-full py-3 rounded-xl text-white text-center font-bold text-xl tracking-wide transition-colors ${
              esEntrada ? "bg-green-500" : "bg-red-600"
            }`}>
              {esEntrada ? "✓  ENTRADA" : "✗  SALIDA"} — {resultado.diaSemana}
            </div>
          )}

          {/* Input de código */}
          <div className="w-full">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value.toUpperCase())}
                onKeyDown={handleKey}
                onBlur={() => setTimeout(() => inputRef.current?.focus(), 50)}
                placeholder=""
                autoFocus
                autoComplete="off"
                className="flex-1 border-2 border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-center tracking-widest focus:outline-none focus:border-blue-500 uppercase"
              />
              <button
                onClick={() => { registrar(input); setInput(""); }}
                disabled={!input.trim() || procesando}
                className="bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-800 transition disabled:opacity-40"
              >
                {procesando ? "..." : "OK"}
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
