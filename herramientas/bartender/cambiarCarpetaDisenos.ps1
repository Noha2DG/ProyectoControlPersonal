# Apunta esta estacion a la carpeta compartida de disenos (.btw).
#
# Por que existe: la carpeta autorizada vive DENTRO de abrirBartender.ps1, en cada PC. Si la
# estacion sigue autorizando "C:\Etiquetas" y la aplicacion ya guarda rutas del recurso compartido,
# BarTender rechaza cada impresion con "La plantilla esta fuera de la carpeta autorizada" — el
# cuadro rojo que aparece con el operador ya parado frente a la impresora.
#
# Correrlo UNA VEZ por PC, con la sesion del operador que imprime (el protocolo se registra por
# usuario de Windows, no por equipo).
#
#   Aplicar:  powershell -ExecutionPolicy Bypass -File cambiarCarpetaDisenos.ps1
#   Revertir: powershell -ExecutionPolicy Bypass -File cambiarCarpetaDisenos.ps1 -Revertir
#
# Para otra carpeta:  ... -Carpeta "\\otro-servidor\etiquetas"

param(
  [string]$Carpeta = "\\192.168.10.5\planta_proceso\Etiquetas",
  [switch]$Revertir
)

$ErrorActionPreference = "Stop"

function Fallar($mensaje) {
  Write-Host ""
  Write-Host "  ERROR: $mensaje" -ForegroundColor Red
  Write-Host ""
  exit 1
}

# El manejador se busca en el REGISTRO y no junto a este script: cada PC pudo haber copiado la
# carpeta a un lugar distinto, y el registro es el unico que sabe cual es el que Windows ejecuta.
$clave = "HKCU:\Software\Classes\oroetiqueta\shell\open\command"
if (-not (Test-Path $clave)) {
  Fallar "El protocolo oroetiqueta:// no esta registrado en este usuario. Corre primero 'Instalar estacion.bat'."
}
$comando = (Get-ItemProperty $clave)."(default)"
if ($comando -notmatch '-File "([^"]+abrirBartender\.ps1)"') {
  Fallar "No se pudo leer la ruta de abrirBartender.ps1 desde el registro.`n  Comando registrado: $comando"
}
$manejador = $Matches[1]
if (-not (Test-Path $manejador)) { Fallar "El registro apunta a un archivo que ya no existe:`n  $manejador" }

$respaldo = "$manejador.bak"

Write-Host ""
Write-Host "  Estacion de etiquetado - carpeta de disenos" -ForegroundColor Cyan
Write-Host "  Usuario   : $env:USERNAME"
Write-Host "  Manejador : $manejador"
Write-Host ""

if ($Revertir) {
  if (-not (Test-Path $respaldo)) { Fallar "No hay respaldo que restaurar ($respaldo)." }
  Copy-Item $respaldo $manejador -Force
  $linea = (Select-String -Path $manejador -Pattern '^\$CarpetaBtw').Line
  Write-Host "  Restaurado desde el respaldo." -ForegroundColor Yellow
  Write-Host "  $linea"
  Write-Host ""
  exit 0
}

$actual = (Select-String -Path $manejador -Pattern '^\$CarpetaBtw').Line
if (-not $actual) { Fallar "No se encontro la linea `$CarpetaBtw en $manejador." }
Write-Host "  Antes  : $actual"

# Se avisa ANTES de tocar nada: sin acceso al recurso, cambiar la carpeta cambia un error por otro
# ("no se encontro la plantilla"). No se aborta — puede ser un permiso que se arregla despues — pero
# el operador tiene que saberlo.
$alcanza = Test-Path $Carpeta
if (-not $alcanza) {
  Write-Host ""
  Write-Host "  AVISO: esta PC no alcanza $Carpeta" -ForegroundColor Yellow
  Write-Host "  Revisa que el usuario $env:USERNAME tenga acceso al recurso compartido."
  Write-Host "  Se aplica el cambio igual, pero BarTender no va a poder abrir las plantillas."
}

Copy-Item $manejador $respaldo -Force
(Get-Content $manejador -Raw) -replace '(?m)^\$CarpetaBtw\s*=\s*".*?".*$', ('$$CarpetaBtw   = "' + $Carpeta + '"') |
  Set-Content $manejador -Encoding UTF8

$nueva = (Select-String -Path $manejador -Pattern '^\$CarpetaBtw').Line
Write-Host "  Despues: $nueva"

if ($nueva -notlike "*$Carpeta*") {
  Copy-Item $respaldo $manejador -Force
  Fallar "El cambio no quedo aplicado; se restauro el archivo original."
}

Write-Host ""
Write-Host "  Listo. Respaldo en: $respaldo" -ForegroundColor Green
if ($alcanza) {
  $cuantos = (Get-ChildItem $Carpeta -Recurse -Filter *.btw -ErrorAction SilentlyContinue).Count
  Write-Host "  La carpeta responde: $cuantos plantilla(s) .btw visibles desde esta PC."
}
Write-Host "  Prueba una impresion desde la aplicacion. Si falla, el detalle queda en:"
Write-Host "  $env:LOCALAPPDATA\OroEtiqueta\abrirBartender.log"
Write-Host ""
