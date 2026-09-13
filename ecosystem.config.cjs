// Configuración de pm2 para el servidor de planta.
//
// Existe porque pm2 estaba configurado a mano: el directorio de trabajo correcto vivía solo en el
// `pm2 start` original, y cualquier reinicio hecho desde otra carpeta (o un `pm2 resurrect` tras
// reboot) dejaba el proceso vivo pero sin encontrar los archivos. Aquí `cwd` es explícito y se
// resuelve contra la ubicación de este archivo, así que `pm2 start ecosystem.config.cjs` hace lo
// mismo sin importar desde dónde se ejecute.
//
// Uso en el servidor:
//   pm2 start ecosystem.config.cjs     (o `pm2 reload ecosystem.config.cjs` para recargar)
//   pm2 save                           ← imprescindible: es lo que `pm2 resurrect` lee tras un reboot
const path = require("path");

module.exports = {
  apps: [{
    name: "planta-backend",
    cwd: path.join(__dirname, "backend"),
    // tsx directamente y no `npm start`: así pm2 supervisa el proceso de node de verdad. Con npm
    // de por medio, pm2 vigila el envoltorio y las señales de reinicio no siempre llegan al hijo.
    script: "node_modules/tsx/dist/cli.mjs",
    args: "src/index.ts",
    env: { NODE_ENV: "production" },

    autorestart: true,
    // El problema de fondo: por defecto pm2 se rinde tras 15 caídas seguidas y deja la app en
    // `errored` para siempre — nadie sirve nada hasta que alguien entra a mano. Con backoff
    // exponencial pm2 espacia los reintentos (1s, 2s, 4s… hasta 15s) y nunca se da por vencido,
    // que es lo que se necesita cuando la causa es temporal (la base de datos tardando en volver).
    exp_backoff_restart_delay: 1000,
    // Un arranque que no llega al minuto cuenta como caída; pasado ese minuto el contador se
    // reinicia, para que un fallo aislado de madrugada no se sume a otro de la tarde.
    min_uptime: "60s",

    // Red de seguridad contra una fuga de memoria: reinicia antes de que el kernel elija a quién
    // matar (en este droplet node convive con MariaDB, y el OOM killer podría llevarse la base).
    // Ajusta el número si el droplet cambia de tamaño.
    max_memory_restart: "1G",

    // Cada línea de log con su hora: sin esto, reconstruir a qué hora se cayó es adivinar.
    time: true,
  }],
};
