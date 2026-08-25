@echo off
REM Doble clic para dejar lista esta PC de etiquetado.
REM
REM Existe solo para poder ejecutarlo sin escribir comandos: Windows abre los .ps1 en el Bloc de
REM notas en vez de correrlos, asi que este .bat los lanza. No requiere instalar nada — PowerShell
REM viene con Windows — ni permisos de administrador.
REM
REM Correrlo con la sesion del operador que va a usar la estacion: el protocolo se registra por
REM usuario de Windows, no por equipo.

cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalarEstacion.ps1" %*

echo.
pause
