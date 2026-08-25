# Manejador del protocolo oroetiqueta:// — lo invoca Windows cuando la aplicación web abre un
# enlace "oroetiqueta://imprimir?...". Su único trabajo es abrir BarTender Designer con la
# plantilla del cliente y el rango de correlativos ya filtrado, para que el operador complete los
# campos que no vienen de la base y mande a imprimir.
#
# Se lanza con /FPD y no con /P: /P imprimiría de una sin que nadie revise, mientras que /FPD
# fuerza el uso de la base de datos y ADEMÁS muestra el diálogo de impresión, así que la tanda sale
# solo cuando una persona le da Imprimir. El flujo pide esa revisión.
#
# El /FPD no es opcional aunque parezca que abrir el documento bastaría: la ayuda de BarTender dice
# que "setting query prompts only takes effect when /P, /PD, /FP, or /FPD are specified". Sin uno de
# esos, BarTender IGNORA los /?Orden, /?Desde y /?Hasta sin dar ningún error, y la plantilla se abre
# mostrando toda la cola en vez del rango que se pidió.
#
# POR QUÉ EXISTE: el backend corre en kronos (servidor en internet) y no puede lanzar programas en
# la PC del operador; el navegador tampoco, por seguridad. Un protocolo registrado es la vía
# estándar para que una página abra una aplicación local — la misma que usan Zoom o Teams.
#
# SEGURIDAD: la URL viene de una página web, así que se trata como entrada no confiable. Se valida
# que la plantilla esté DENTRO de la carpeta autorizada y que los números sean números, y se lanza
# el proceso con argumentos separados (nunca armando una línea de comandos por concatenación).

param(
  [Parameter(Mandatory = $true)]
  [string]$Url,

  # Para diagnosticar desde una terminal: los errores salen por consola en vez de abrir un cuadro
  # de diálogo que nadie puede cerrar en una sesión automatizada.
  [switch]$SinDialogo,

  # Valida todo y reporta el comando que ejecutaría, pero no abre BarTender. Sirve para verificar
  # una ruta o un rango sin dejar ventanas abiertas.
  [switch]$Simular
)

# ---------------------------------------------------------------------------
# Configuración — ajustar en cada PC si cambia la instalación o la carpeta.
# ---------------------------------------------------------------------------
$BarTendExe   = "C:\Program Files\Seagull\BarTender 12.1\BarTend.exe"
# Las dos opciones de abajo van juntas, y por eso estan las dos apagadas.
#
# /FPD abre el documento MOSTRANDO el dialogo de impresion. Fue obligatorio mientras el rango viajaba
# en solicitudes de consulta (/?Orden, /?Desde, /?Hasta): la ayuda de BarTender dice que esos valores
# "only take effect when /P, /PD, /FP, or /FPD are specified". Con el modelo de reserva ya no hay
# solicitudes que alimentar, asi que abrir el documento a secas alcanza.
#
# /X cierra BarTender al terminar las funciones pedidas por linea de comandos. Solo tiene sentido
# ACOMPANANDO a /FPD: si la impresion es manual, BarTender no sabe cuando terminaste y /X cerraria la
# ventana apenas abre. Ademas cancelar el dialogo cuenta como "terminado", asi que juntas hacen que
# cancelar cierre todo sin dejar ver el Designer.
#
# Para volver al dialogo automatico se encienden LAS DOS. Nunca /XS ni /XA en lugar de /X: esas
# guardan el documento incondicionalmente y escribirian en la plantilla compartida cualquier cambio
# accidental del operador.
# Flujo actual: abrir el documento y nada mas. El operador revisa, va a vista preliminar, imprime y
# CIERRA BARTENDER A MANO. Se probo /X para que cerrara solo y dejo el proceso en un estado raro
# —vivo pero sin ventana ni conexion a la base—, y como BarTender es de instancia unica ese proceso
# colgado se traga los lanzamientos siguientes y parece que "no abre". Que BarTender NO se quede abierto es lo importante, porque es de instancia unica:
# sin cerrarse, cada lanzamiento le apila otro documento al mismo proceso y terminas con ventanas y
# cuadros de dialogo encolados (nos paso: ocho lanzamientos, ocho cuadros pidiendo datos).
#
# Para DISENAR una plantilla no uses el boton de la aplicacion: abre el .btw directamente desde la
# carpeta. Asi tienes el Designer sin dialogo de impresion y sin cierre automatico.
$MostrarDialogoImpresion = $false
$CerrarAlTerminar        = $false
$CarpetaBtw   = "C:\Etiquetas"          # en producción: \\servidor\etiquetas
$Bitacora     = Join-Path $env:LOCALAPPDATA "OroEtiqueta\abrirBartender.log"

# Nombres de los query prompts DENTRO del .btw. Tienen que coincidir EXACTO con los que se
# configuren en BarTender: si no coinciden, BarTender ignora el valor y abre sin filtrar —
# no da error. Es el mismo modo de falla silenciosa que ya conocemos de los orígenes de datos.
$PromptOrden  = "Orden"
$PromptDesde  = "Desde"
$PromptHasta  = "Hasta"
# Token es el permiso de un solo uso con el que el .btw avisa al backend que ya imprimio (evento
# "Print Job Sent" -> accion "Send Web Service Request"). Solo pasa por aca: este script no lo usa
# ni lo valida, unicamente se lo entrega a BarTender como un prompt mas.
$PromptToken  = "Token"

# ---------------------------------------------------------------------------

function Escribir-Bitacora([string]$texto) {
  try {
    $dir = Split-Path $Bitacora -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Add-Content -Path $Bitacora -Value ("{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $texto) -Encoding utf8
  } catch { }
}

function Terminar-Con-Error([string]$mensaje) {
  Escribir-Bitacora "ERROR: $mensaje"
  # Un manejador de protocolo que falla en silencio es imposible de diagnosticar desde planta,
  # así que el error se muestra en pantalla además de quedar en la bitácora.
  if ($SinDialogo) {
    Write-Output "ERROR: $mensaje"
  } else {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
      "$mensaje`n`nDetalle en: $Bitacora",
      "No se pudo abrir BarTender", "OK", "Error") | Out-Null
  }
  exit 1
}

# El token es una credencial de corta vida: queda fuera de la bitacora para no dejarlo escrito en
# un archivo que sobrevive al turno.
Escribir-Bitacora ("Invocado con: " + ($Url -replace '(?i)(token=)[^&]*', '$1<oculto>'))

# --- Parsear la URL ---------------------------------------------------------
try {
  $uri = [System.Uri]$Url
} catch {
  Terminar-Con-Error "La dirección recibida no es válida."
}

if ($uri.Scheme -ne "oroetiqueta") { Terminar-Con-Error "Protocolo inesperado: $($uri.Scheme)" }
if ($uri.Host -ne "imprimir")      { Terminar-Con-Error "Acción no reconocida: $($uri.Host)" }

$parametros = @{}
foreach ($par in $uri.Query.TrimStart('?').Split('&')) {
  if (-not $par) { continue }
  $partes = $par.Split('=', 2)
  if ($partes.Count -eq 2) {
    $parametros[$partes[0]] = [System.Uri]::UnescapeDataString($partes[1])
  }
}

$btw   = $parametros["btw"]
$orden = $parametros["orden"]
$desde = $parametros["desde"]
$hasta = $parametros["hasta"]
$token = $parametros["token"]

# --- Validar ----------------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($btw)) { Terminar-Con-Error "No se indicó la plantilla a abrir." }

foreach ($n in @(@("orden", $orden), @("desde", $desde), @("hasta", $hasta))) {
  if ($n[1] -notmatch '^\d+$') { Terminar-Con-Error "El parámetro '$($n[0])' debe ser un número entero." }
}

if ($btw -notmatch '\.btw$') { Terminar-Con-Error "La plantilla debe ser un archivo .btw." }

# Un backend viejo todavia manda la URL sin token: en ese caso se abre igual, solo que la plantilla
# no va a poder confirmar la impresion. Si viene, tiene que tener forma de JWT — asi un valor con
# comillas o espacios no llega nunca a la linea de comandos de BarTender.
if ($token -and $token -notmatch '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$') {
  Terminar-Con-Error "El permiso de impresion recibido no tiene el formato esperado."
}

# La plantilla tiene que estar dentro de la carpeta autorizada. Sin esto, una página cualquiera
# podría pedirle a BarTender que abra un archivo arbitrario del disco.
$raizNormalizada = [System.IO.Path]::GetFullPath($CarpetaBtw).TrimEnd('\') + '\'
try {
  $btwNormalizado = [System.IO.Path]::GetFullPath($btw)
} catch {
  Terminar-Con-Error "La ruta de la plantilla no es válida:`n$btw"
}
if (-not $btwNormalizado.StartsWith($raizNormalizada, [System.StringComparison]::OrdinalIgnoreCase)) {
  Terminar-Con-Error "La plantilla está fuera de la carpeta autorizada.`n`nPlantilla: $btwNormalizado`nCarpeta:   $raizNormalizada"
}

if (-not (Test-Path $BarTendExe))   { Terminar-Con-Error "No se encontró BarTender en:`n$BarTendExe" }
if (-not (Test-Path $btwNormalizado)) { Terminar-Con-Error "No se encontró la plantilla:`n$btwNormalizado" }

# --- Lanzar -----------------------------------------------------------------
# Los valores van entre comillas porque así los documenta BarTender (/?<nombre>="<valor>"); hoy son
# números y un JWT, sin espacios, pero no cuesta nada dejarlo a prueba de un prompt que mañana lleve
# texto libre.
$argumentos = @(
  "/F=`"$btwNormalizado`""
  "/?$PromptOrden=`"$orden`""
  "/?$PromptDesde=`"$desde`""
  "/?$PromptHasta=`"$hasta`""
)
if ($token) { $argumentos += "/?$PromptToken=`"$token`"" }
if ($MostrarDialogoImpresion) { $argumentos += "/FPD" }
if ($CerrarAlTerminar)         { $argumentos += "/X" }

$argumentosVisibles = ($argumentos | ForEach-Object { $_ -replace "(?i)(/\?$PromptToken=).*", '$1<oculto>' }) -join ' '
Escribir-Bitacora "Ejecutando: $BarTendExe $argumentosVisibles"

if ($Simular) {
  Write-Output "OK (simulacion, no se abrio BarTender)"
  Write-Output "  exe        : $BarTendExe"
  Write-Output "  argumentos : $argumentosVisibles"
  exit 0
}

try {
  Start-Process -FilePath $BarTendExe -ArgumentList $argumentos -ErrorAction Stop
  Escribir-Bitacora "BarTender abierto correctamente."
} catch {
  Terminar-Con-Error "BarTender no pudo iniciarse:`n$($_.Exception.Message)"
}
