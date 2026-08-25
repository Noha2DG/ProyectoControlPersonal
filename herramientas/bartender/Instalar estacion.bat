@echo off
REM Doble clic para dejar lista esta PC de etiquetado.
REM
REM Existe solo para poder ejecutarlo sin escribir comandos: Windows abre los .ps1 en el Bloc de
REM notas en vez de correrlos. No requiere instalar nada (PowerShell viene con Windows) ni permisos
REM de administrador.
REM
REM Correrlo con la sesion del operador que va a usar la estacion: el protocolo se registra por
REM usuario de Windows, no por equipo.
REM
REM Este archivo DEBE guardarse con saltos de linea CRLF. Con LF, cmd.exe no lo procesa y la
REM ventana se cierra sin mostrar nada (ver .gitattributes).

setlocal
cd /d "%~dp0"

echo.
echo  Estacion de etiquetado - instalacion
echo  Carpeta: %~dp0
echo.

if not exist "%~dp0instalarEstacion.ps1" (
  echo  ERROR: falta instalarEstacion.ps1 en esta carpeta.
  echo.
  echo  Los tres archivos tienen que estar JUNTOS:
  echo     Instalar estacion.bat
  echo     instalarEstacion.ps1
  echo     abrirBartender.ps1
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0abrirBartender.ps1" (
  echo  ERROR: falta abrirBartender.ps1 en esta carpeta.
  echo  Es el que abre BarTender; sin el, el boton de la aplicacion no va a funcionar.
  echo.
  pause
  exit /b 1
)

REM Un .ps1 de 0 bytes no da error: corre, no hace nada, y parece que el instalador "no muestra
REM nada". Pasa al guardar desde la vista normal de GitHub en vez del contenido crudo.
for %%F in ("%~dp0instalarEstacion.ps1" "%~dp0abrirBartender.ps1") do (
  if %%~zF EQU 0 (
    echo  ERROR: %%~nxF esta VACIO - 0 bytes.
    echo.
    echo  Se bajo mal. Bajalo asi:
    echo     GitHub - boton verde Code - Download ZIP - descomprimir
    echo  o abre el archivo en GitHub, boton Raw, y guarda desde ahi.
    echo.
    pause
    exit /b 1
  )
)

REM Windows marca los archivos bajados de internet y eso bloquea su ejecucion. Se desmarcan.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem '%~dp0' -Recurse | Unblock-File -ErrorAction SilentlyContinue"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalarEstacion.ps1" %*

echo.
pause
endlocal
