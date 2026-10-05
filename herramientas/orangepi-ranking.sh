#!/bin/bash
# Configura una Orange Pi (Debian) para mostrar el ranking de producción a pantalla completa.
# Uso:  sudo bash orangepi-ranking.sh "http://SERVIDOR/#/ranking-produccion" [usuario] [ancho x alto]
# Ejemplo: sudo bash orangepi-ranking.sh "http://192.168.1.50/#/ranking-produccion" orangepi 1920x1080
set -e

URL="$1"
USUARIO="${2:-orangepi}"
RESOLUCION="${3:-1920x1080}"

if [ "$(id -u)" -ne 0 ]; then echo "Ejecútalo con sudo."; exit 1; fi
if [ -z "$URL" ]; then echo "Falta la URL del ranking."; exit 1; fi
if ! id "$USUARIO" >/dev/null 2>&1; then echo "El usuario '$USUARIO' no existe."; exit 1; fi
HOME_U=$(getent passwd "$USUARIO" | cut -d: -f6)

echo "== 1/6 Instalando paquetes =="
apt-get update
apt-get install -y xserver-xorg xserver-xorg-legacy xinit x11-xserver-utils openbox unclutter
# Chromium se llama distinto según la imagen
if ! command -v chromium >/dev/null && ! command -v chromium-browser >/dev/null; then
  apt-get install -y chromium || apt-get install -y chromium-browser
fi
NAV=$(command -v chromium || command -v chromium-browser)

echo "== 2/6 Permitiendo que el usuario inicie X =="
cat > /etc/X11/Xwrapper.config <<EOF
allowed_users=anybody
needs_root_rights=yes
EOF
usermod -aG video,input,tty "$USUARIO"

echo "== 3/6 Resolución en el arranque ($RESOLUCION) =="
# Se deja la resolución del arranque en automático: la fija .xinitrc según cada pantalla.
for f in /boot/orangepiEnv.txt; do
  if [ -f "$f" ]; then
    sed -i '/^disp_mode=/d' "$f"
    echo "Quitado disp_mode de $f (la resolución la decide .xinitrc)."
  fi
done

echo "== 4/6 Creando .xinitrc =="
cat > "$HOME_U/.xinitrc" <<EOF
#!/bin/sh
# Sin protector de pantalla ni ahorro de energía
xset s off
xset -dpms
xset s noblank

# Para cada pantalla conectada: usa $RESOLUCION si la soporta; si no, la resolución preferida
for SALIDA in \$(xrandr | awk '/ connected/{print \$1}'); do
  xrandr --output "\$SALIDA" --mode $RESOLUCION 2>/dev/null || xrandr --output "\$SALIDA" --auto
done

unclutter -idle 1 -root &
openbox &
sleep 2

# Perfil propio y NO incógnito: la sesión del kiosco vive en el localStorage del navegador, y en
# incógnito se borraba con cada reinicio de Chromium o corte de luz — la pantalla quedaba en el login
# y alguien tenía que conectar un teclado. El token del kiosco no vence, así que basta entrar una vez.
# Las versiones nuevas del sistema las toma la propia página: se recarga sola tras cada despliegue.
# Si el navegador se cierra o falla, se vuelve a abrir
while true; do
  $NAV --kiosk --user-data-dir="$HOME_U/.config/ranking-pantalla" --noerrdialogs --disable-infobars --disable-session-crashed-bubble \\
    --force-device-scale-factor=1 --overscroll-history-navigation=0 --check-for-update-interval=31536000 \\
    "$URL"
  sleep 3
done
EOF
chown "$USUARIO":"$USUARIO" "$HOME_U/.xinitrc"
chmod +x "$HOME_U/.xinitrc"

echo "== 5/6 Servicio que arranca el ranking al encender =="
# Se desactiva el escritorio completo si lo hubiera, para que no choque con el servicio
for dm in lightdm gdm3 sddm; do
  systemctl disable "$dm" 2>/dev/null || true
done
systemctl disable getty@tty1 2>/dev/null || true

cat > /etc/systemd/system/ranking-pantalla.service <<EOF
[Unit]
Description=Ranking de produccion a pantalla completa
After=systemd-user-sessions.service network-online.target
Wants=network-online.target
Conflicts=getty@tty1.service

[Service]
User=$USUARIO
PAMName=login
TTYPath=/dev/tty1
StandardInput=tty
StandardOutput=journal
Environment=HOME=$HOME_U
ExecStart=/usr/bin/startx $HOME_U/.xinitrc -- :0 vt1 -nocursor
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl set-default multi-user.target
systemctl enable ranking-pantalla.service

echo "== 6/6 Listo =="
echo "Reinicia con:  sudo reboot"
echo "La primera vez hay que iniciar sesión con el usuario del kiosco (con un teclado conectado);"
echo "después la sesión se conserva entre reinicios."
echo "Ver el estado:  systemctl status ranking-pantalla"
echo "Ver errores:    journalctl -u ranking-pantalla -b --no-pager | tail -50"
