# Deja lista una PC de etiquetado y DIAGNOSTICA lo que falte, en una sola pasada.
#
# Correr una vez por usuario de Windows en cada estacion:
#   powershell -ExecutionPolicy Bypass -File instalarEstacion.ps1
#
# No requiere administrador: el protocolo se registra en HKCU. Es seguro repetirlo.
#
# Cada revision explica QUE se rompe si falla, porque todas estas fallas son silenciosas: el boton
# de la aplicacion simplemente "no hace nada" y no hay forma de adivinar cual de las seis es.

param(
  # Raiz de las plantillas .btw. Si no se indica, se busca en los lugares habituales.
  # OJO: debe coincidir con las rutas guardadas en Clientes y Subclientes de la aplicacion, porque
  # esa ruta es UNA SOLA para todas las estaciones.
  [string]$CarpetaBtw = "",
  # Servidor de la base que consulta BarTender por ODBC.
  [string]$ServidorBD = "kronos.esteromar.app",
  [int]$PuertoBD = 3306
)

$ErrorActionPreference = "Continue"
$fallas = @()
function Bien($t) { Write-Host "  OK    $t" -ForegroundColor Green }
function Mal($t, $comoSeArregla) {
  Write-Host "  FALTA $t" -ForegroundColor Red
  Write-Host "        -> $comoSeArregla" -ForegroundColor Yellow
  $script:fallas += $t
}

Write-Host "`n=== Estacion de etiquetado: instalacion y diagnostico ===`n"

# --- 1. BarTender -----------------------------------------------------------
$exe = @("$env:ProgramFiles\Seagull", "${env:ProgramFiles(x86)}\Seagull") |
  Where-Object { Test-Path $_ } |
  ForEach-Object { Get-ChildItem $_ -Directory -ErrorAction SilentlyContinue } |
  ForEach-Object { Join-Path $_.FullName "BarTend.exe" } |
  Where-Object { Test-Path $_ } | Sort-Object -Descending | Select-Object -First 1
if ($exe) { Bien "BarTender instalado: $exe" }
else { Mal "BarTender no esta instalado" "Instalalo antes de seguir; sin el no hay nada que configurar." }

# --- 2. El protocolo --------------------------------------------------------
# Es lo que traduce el clic del navegador en un comando local. Se registra por USUARIO: si en esta
# PC entran dos operadores con cuentas distintas, hay que correr esto con cada uno.
$manejador = Join-Path $PSScriptRoot "abrirBartender.ps1"
if (-not (Test-Path $manejador)) {
  Mal "no se encontro abrirBartender.ps1 junto a este script" "Copia la carpeta herramientas\bartender\ completa."
} else {
  $clave = "HKCU:\Software\Classes\oroetiqueta"
  $comando = '"{0}" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{1}" "%1"' -f `
    (Join-Path $PSHOME "powershell.exe"), $manejador
  New-Item -Path $clave -Force | Out-Null
  Set-ItemProperty -Path $clave -Name "(Default)"    -Value "URL:Oro Etiqueta"
  Set-ItemProperty -Path $clave -Name "URL Protocol" -Value ""
  New-Item -Path "$clave\shell\open\command" -Force | Out-Null
  Set-ItemProperty -Path "$clave\shell\open\command" -Name "(Default)" -Value $comando
  Bien "protocolo oroetiqueta:// registrado para $env:USERNAME"

  # El registro guarda la RUTA del script. Si la carpeta se mueve despues, el protocolo apunta al
  # vacio y el boton deja de funcionar sin avisar.
  $temporales = @("Downloads","Descargas","Desktop","Escritorio","Temp","OneDrive")
  $enTemporal = $temporales | Where-Object { $PSScriptRoot.Split([char]92) -contains $_ }
  if ($enTemporal) {
    Mal "la carpeta esta en una ubicacion temporal: $PSScriptRoot" `
        "Copiala a algo estable (C:\OroEtiqueta) y vuelve a correr este script desde ahi."
  } else { Bien "la carpeta esta en una ubicacion estable: $PSScriptRoot" }
}

# --- 3. Las plantillas ------------------------------------------------------
# Si no se indico carpeta, se busca. El escritorio se incluye porque es donde suelen quedar, pero
# mas abajo se advierte: una ruta dentro del perfil del usuario NO sirve para mas de una estacion.
if (-not $CarpetaBtw) {
  $candidatas = @(
    "C:\Etiquetas",
    (Join-Path $env:USERPROFILE "Desktopartender"),
    (Join-Path $env:USERPROFILE "Escritorioartender"),
    (Join-Path $env:USERPROFILE "OneDrive\Desktopartender"),
    (Join-Path $env:USERPROFILE "OneDrive\Escritorioartender")
  )
  $CarpetaBtw = $candidatas | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $CarpetaBtw) { $CarpetaBtw = "C:\Etiquetas" }
}

# CarpetaBtw tiene que ser la raiz de las rutas guardadas en la aplicacion, o el manejador rechaza
# la plantilla por estar "fuera de la carpeta autorizada".
if (Test-Path $CarpetaBtw) {
  $btw = @(Get-ChildItem $CarpetaBtw -Recurse -Filter *.btw -ErrorAction SilentlyContinue)
  if ($btw.Count -gt 0) {
    Bien "plantillas alcanzables en ${CarpetaBtw}: $($btw.Count) archivo(s)"
    # La ruta del .btw se guarda UNA VEZ en la base, para todas las estaciones. Si vive dentro del
    # perfil de un usuario, ninguna otra PC la va a encontrar con esa misma ruta.
    if ($CarpetaBtw.StartsWith($env:USERPROFILE, [StringComparison]::OrdinalIgnoreCase)) {
      Mal "las plantillas estan dentro del perfil del usuario: $CarpetaBtw" `
          "Muevelas a C:\Etiquetas o a un recurso compartido. La aplicacion guarda UNA ruta para todas las estaciones, y esta solo existe en esta PC."
    }
  }
  else { Mal "$CarpetaBtw existe pero no tiene ningun .btw" "Verifica que sea la carpeta correcta." }
} else {
  Mal "no se alcanza $CarpetaBtw" "Monta el recurso compartido, o corre este script con -CarpetaBtw <ruta>."
}

# --- 4. La impresora --------------------------------------------------------
# Una cola en Error o con un trabajo atascado cuelga a BarTender por minutos, y el mensaje que sale
# no apunta a la impresora. Ya nos costo una tarde.
$rotas = @(Get-Printer -ErrorAction SilentlyContinue | Where-Object { $_.PrinterStatus -ne 'Normal' })
if ($rotas.Count -eq 0) { Bien "todas las impresoras en estado Normal" }
else { $rotas | ForEach-Object { Mal "impresora '$($_.Name)' en estado $($_.PrinterStatus)" "Quitala o reparala: una cola rota cuelga a BarTender." } }

$atascados = @(Get-Printer -ErrorAction SilentlyContinue | ForEach-Object {
  Get-PrintJob -PrinterName $_.Name -ErrorAction SilentlyContinue })
if ($atascados.Count -eq 0) { Bien "no hay trabajos atascados en ninguna cola" }
else { Mal "$($atascados.Count) trabajo(s) atascado(s) en la cola de impresion" "Cancelalos desde Dispositivos e impresoras." }

# --- 5. La base de datos ----------------------------------------------------
# BarTender lee la cola de etiquetas DIRECTO por ODBC, no a traves de la aplicacion. Si el
# cortafuegos de la planta bloquea la salida al 3306, la plantilla abre vacia.
$tcp = Test-NetConnection -ComputerName $ServidorBD -Port $PuertoBD -WarningAction SilentlyContinue
if ($tcp.TcpTestSucceeded) { Bien "hay salida a ${ServidorBD}:${PuertoBD}" }
else { Mal "no se alcanza ${ServidorBD}:${PuertoBD}" "Pide que abran la salida al 3306; sin eso BarTender no ve las etiquetas." }

$odbc = @(Get-OdbcDriver -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'MariaDB|MySQL' })
if ($odbc.Count -gt 0) { Bien "driver ODBC disponible: $($odbc[0].Name)" }
else { Mal "no hay driver ODBC de MariaDB/MySQL" "Instala 'MariaDB ODBC 3.1 Driver' de 64 bits." }

# --- 6. Instancias colgadas -------------------------------------------------
# BarTender es de instancia unica: un proceso vivo sin ventana se traga los lanzamientos siguientes
# y el sintoma es exactamente "no abre".
$vivos = @(Get-Process BarTend -ErrorAction SilentlyContinue)
if ($vivos.Count -eq 0) { Bien "no hay instancias de BarTender colgadas" }
else { Mal "$($vivos.Count) proceso(s) BarTend.exe abiertos (PID $($vivos.Id -join ', '))" `
           "Cierralos. Si no se dejan, usa el Administrador de tareas COMO ADMINISTRADOR." }

# --- Resumen ----------------------------------------------------------------
Write-Host ""
if ($fallas.Count -eq 0) {
  Write-Host "Todo listo. Prueba desde la aplicacion: generar una captura y presionar BarTender." -ForegroundColor Green
} else {
  Write-Host "$($fallas.Count) cosa(s) por resolver antes de imprimir:" -ForegroundColor Red
  $fallas | ForEach-Object { Write-Host "  - $_" }
}
Write-Host "`nBitacora de cada apertura: $env:LOCALAPPDATA\OroEtiqueta\abrirBartender.log`n"
