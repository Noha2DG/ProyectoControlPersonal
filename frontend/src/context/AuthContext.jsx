import { createContext, useContext, useState, useEffect } from "react";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("cp_token");
    const stored = localStorage.getItem("cp_user");
    if (token && stored) {
      setUser(JSON.parse(stored));
    }
    setLoading(false);
  }, []);

  const login = async (username, password) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al iniciar sesión");
    localStorage.setItem("cp_token", data.token);
    localStorage.setItem("cp_user", JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem("cp_token");
    localStorage.removeItem("cp_user");
    setUser(null);
  };

  // Reemite el token con el rol/permisos actuales de la BD — necesario tras editar la
  // propia cuenta, porque rol/permisos viajan embebidos en el JWT de la sesión activa.
  const refreshUser = async () => {
    const token = localStorage.getItem("cp_token");
    if (!token) return;
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    localStorage.setItem("cp_token", data.token);
    localStorage.setItem("cp_user", JSON.stringify(data.user));
    setUser(data.user);
  };

  // Renovación silenciosa para las terminales de kiosco (Entrada/Salida, Transferencias, Uniformes,
  // Mi Producción y la pantalla de Ranking). Son dispositivos que quedan encendidos sin nadie que
  // los atienda.
  //
  // Ya NO es lo que los mantiene vivos: desde sep 2026 el token de kiosco se emite sin vencimiento
  // (ver firmarToken en backend/src/routes/auth.ts), justamente porque esta renovación solo protege
  // mientras el equipo siga encendido y con red — una PC apagada un mes largo llegaba igual al login.
  //
  // Sigue aquí por dos razones que no cubre el token eterno: (1) rol y permisos viajan DENTRO del
  // JWT, así que sin renovar, un cambio de permisos no llega nunca a una pantalla que jamás vuelve a
  // iniciar sesión; (2) migra sola a los equipos que todavía cargan un token viejo de 30 días —a la
  // primera renovación reciben uno sin vencimiento—, sin que nadie tenga que ir a re-loguearlos.
  //
  // Se renueva a los 60 s de arrancar (no de inmediato: si la pantalla se abrió justo al reiniciar
  // el equipo, la red puede no estar lista) y de ahí en adelante cada 12 h. Si falla, se reintenta
  // en la siguiente vuelta: con el token ya sin vencimiento, fallar no rompe nada.
  useEffect(() => {
    if (user?.rol !== "kiosco") return;
    const renovar = () => { refreshUser(); };
    const inicial = setTimeout(renovar, 60_000);
    const periodico = setInterval(renovar, 12 * 60 * 60 * 1000);
    return () => { clearTimeout(inicial); clearInterval(periodico); };
  }, [user?.rol]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

// Misma regla que tienePermiso() en el backend (middleware/auth.ts) — se repite aquí
// porque el frontend no puede llamar directo a esa función. Debe existir un mirror en
// ambos lados: el backend es quien realmente bloquea, esto solo oculta la UI para que
// un usuario "solo Ver" no vea botones que el servidor le va a rechazar igual.
export function usePuede(mod, accion) {
  const { user } = useAuth();
  if (!user) return false;
  if (user.rol === "admin" && !user.permisos) return true;
  return !!user.permisos?.[mod]?.[accion];
}

export function authHeader() {
  const token = localStorage.getItem("cp_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}
