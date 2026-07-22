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
