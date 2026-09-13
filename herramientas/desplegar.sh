#!/usr/bin/env bash
# Despliegue del servidor de planta. Se corre EN el servidor:
#
#   bash herramientas/desplegar.sh
#
# Existe porque frontend/dist está en .gitignore: la carpeta que sirve toda la aplicación web no
# viaja con `git pull`, hay que compilarla aquí. Cuando ese paso se olvidaba, el backend arrancaba
# bien y la app entera respondía 404 sin ningún error visible.
#
# `set -e` corta al primer fallo: más vale no reiniciar y que la versión vieja siga sirviendo, que
# reiniciar sobre una compilación a medias.
set -euo pipefail

cd "$(dirname "$0")/.."
RAIZ="$PWD"

echo "→ Trayendo cambios"
git pull --ff-only

echo "→ Dependencias del backend"
# Sin --omit=dev: el servidor corre con tsx (`tsx src/index.ts`), y tsx está en devDependencies.
# Omitir las de desarrollo aquí deja el proceso sin con qué arrancar.
cd "$RAIZ/backend" && npm ci
# npm ci borra node_modules entero, y con él el cliente de Prisma generado. El postinstall de
# @prisma/client normalmente lo regenera; se hace explícito para no depender de eso.
npx prisma generate

echo "→ Compilando el frontend"
cd "$RAIZ/frontend" && npm ci && npm run build

# Verifica el resultado antes de tocar el proceso que está sirviendo a la planta.
if [ ! -f "$RAIZ/frontend/dist/index.html" ]; then
  echo "✗ La compilación no dejó frontend/dist/index.html — no se reinicia nada." >&2
  exit 1
fi

echo "→ Reiniciando"
cd "$RAIZ"
pm2 reload ecosystem.config.cjs --update-env
# `pm2 save` graba la lista actual: es lo que `pm2 resurrect` levanta después de un reboot. Sin
# esto, el servidor arranca tras un reinicio con la configuración vieja (o con ninguna).
pm2 save

echo "✓ Listo. Revisa: pm2 list  ·  pm2 logs planta-backend --lines 50"
