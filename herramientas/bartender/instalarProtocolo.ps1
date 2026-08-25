# Registra el protocolo oroetiqueta:// en esta PC para que el botón "Abrir en BarTender" de la
# aplicación web pueda lanzar BarTender Designer con la plantilla y los correlativos ya filtrados.
#
# Se registra en HKCU (el usuario actual), NO en HKLM: así no hace falta ser administrador y cada
# operador queda configurado con su propia sesión. Correr una vez por usuario en cada PC que
# imprima etiquetas de cliente.
#
#   Instalar:    powershell -ExecutionPolicy Bypass -File instalarProtocolo.ps1
#   Desinstalar: powershell -ExecutionPolicy Bypass -File instalarProtocolo.ps1 -Desinstalar

param([switch]$Desinstalar)

$Protocolo = "oroetiqueta"
$Clave     = "HKCU:\Software\Classes\$Protocolo"
$Manejador = Join-Path $PSScriptRoot "abrirBartender.ps1"

if ($Desinstalar) {
  if (Test-Path $Clave) {
    Remove-Item $Clave -Recurse -Force
    Write-Output "Protocolo ${Protocolo}:// eliminado."
  } else {
    Write-Output "El protocolo ${Protocolo}:// no estaba registrado."
  }
  return
}

if (-not (Test-Path $Manejador)) {
  Write-Error "No se encontró abrirBartender.ps1 junto a este script. Copia la carpeta completa."
  exit 1
}

# -WindowStyle Hidden para que no parpadee una consola negra cada vez que se abre una etiqueta.
# El %1 lo reemplaza Windows por la URL completa que invocó el navegador.
$comando = '"{0}" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{1}" "%1"' -f `
  (Join-Path $PSHOME "powershell.exe"), $Manejador

New-Item -Path $Clave -Force | Out-Null
Set-ItemProperty -Path $Clave -Name "(Default)"   -Value "URL:Oro Etiqueta"
Set-ItemProperty -Path $Clave -Name "URL Protocol" -Value ""

New-Item -Path "$Clave\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$Clave\shell\open\command" -Name "(Default)" -Value $comando

Write-Output "Protocolo ${Protocolo}:// registrado para el usuario $env:USERNAME."
Write-Output ""
Write-Output "Manejador : $Manejador"
Write-Output "Comando   : $comando"
Write-Output ""
Write-Output "Revisa que en abrirBartender.ps1 esten correctas estas dos rutas:"
Write-Output "  - BarTendExe (donde esta instalado BarTender)"
Write-Output "  - CarpetaBtw (donde viven los .btw; en produccion la ruta UNC de la oficina)"
