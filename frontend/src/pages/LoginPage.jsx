import { useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import pacificGoldLogo from "../assets/pacific-gold-logo.png";

export default function LoginPage() {
  const { login } = useAuth();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const set = (f) => (e) => setForm(v => ({ ...v, [f]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(form.username, form.password);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0b1830] to-[#132a52] flex items-center justify-center px-4 py-8 sm:py-10">
      <div className="bg-[#fdfaf3] rounded-2xl shadow-2xl w-full max-w-sm sm:max-w-md p-6 sm:p-8">
        {/* Logo / Header */}
        <div className="text-center mb-6 sm:mb-8">
          <img src={pacificGoldLogo} alt="Pacific Gold" className="h-16 sm:h-20 mx-auto mb-4 object-contain" />
          <h1 className="text-xl sm:text-2xl font-bold text-[#0b1830]">
            Bienvenido a <span className="text-[#c99a3c]">ORO</span> BI
          </h1>
          <p className="text-slate-500 text-xs sm:text-sm mt-1">Plataforma de Inteligencia de Negocios</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-[#0b1830] mb-1.5">Usuario</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </span>
              <input
                type="text"
                required
                autoFocus
                value={form.username}
                onChange={set("username")}
                className="w-full border border-slate-200 bg-white rounded-lg pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0b1830]/30"
                placeholder="Ingrese su usuario"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-[#0b1830] mb-1.5">Contraseña</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-12V7a4 4 0 10-8 0v4h8z" />
                </svg>
              </span>
              <input
                type={showPassword ? "text" : "password"}
                required
                value={form.password}
                onChange={set("password")}
                className="w-full border border-slate-200 bg-white rounded-lg pl-10 pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0b1830]/30"
                placeholder="Ingrese su contraseña"
              />
              <button
                type="button"
                onClick={() => setShowPassword(s => !s)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-5 0-9-4-10-7 .428-1.34 1.34-2.756 2.575-3.95m3.336-2.63A10.05 10.05 0 0112 5c5 0 9 4 10 7-.336 1.052-.94 2.153-1.775 3.175M3 3l18 18" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-[#0b1830] text-white font-semibold py-2.5 sm:py-3 rounded-lg transition disabled:opacity-60 text-sm
              hover:bg-[#16264a]
              focus:outline-none focus:ring-2 focus:ring-[#0b1830]/40"
          >
            {loading ? "Verificando..." : (
              <>
                Iniciar sesión
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </>
            )}
          </button>
        </form>

        <div className="flex items-center gap-3 mt-7 mb-4">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-xs font-semibold whitespace-nowrap">
            <span className="text-[#c99a3c]">ORO</span> <span className="text-[#0b1830]">Bi</span>
          </span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        <p className="text-center text-xs text-slate-400 leading-relaxed">
          Business Intelligence
          <br />
          Planta de Proceso OROPSA
        </p>
      </div>
    </div>
  );
}
