@echo off
REM Doble clic para apuntar esta PC a la carpeta compartida de disenos (.btw).
REM
REM Existe solo para poder ejecutarlo sin escribir comandos: Windows abre los .ps1 en el Bloc de
REM notas en vez de correrlos. No requiere permisos de administrador.
REM
REM Correrlo con la sesion del operador que imprime: la carpeta autorizada vive en el manejador que
REM se registro para ESE usuario.
REM
REM Este archivo DEBE guardarse con saltos de linea CRLF (ver .gitattributes).

setlocal
cd /d "%~dp0"

echo.
echo  Estacion de etiquetado - cambiar carpeta de disenos
echo.

if not exist "%~dp0cambiarCarpetaDisenos.ps1" (
  echo  ERROR: falta cambiarCarpetaDisenos.ps1 en esta carpeta.
  echo.
  pause
  exit /b 1
)

if %~z0 EQU 0 goto :vacio
for %%F in ("%~dp0cambiarCarpetaDisenos.ps1") do if %%~zF EQU 0 goto :vacio

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem '%~dp0' -Recurse | Unblock-File -ErrorAction SilentlyContinue"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0cambiarCarpetaDisenos.ps1" %*

echo.
pause
endlocal
exit /b 0

:vacio
echo  ERROR: cambiarCarpetaDisenos.ps1 esta VACIO - 0 bytes.
echo.
echo  Se bajo mal. Bajalo asi:
echo     GitHub - boton verde Code - Download ZIP - descomprimir
echo  o abre el archivo en GitHub, boton Raw, y guarda desde ahi.
echo.
pause
exit /b 1
