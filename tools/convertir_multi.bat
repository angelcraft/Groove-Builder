@echo off
rem Arrastra un remix .rhref con varios juegos encima: crea multi.gtl al lado (escenario REMIX_21).
if "%~1"=="" (
  echo Arrastra un remix .rhref encima de convertir_multi.bat
  pause
  exit /b 1
)
python "%~dp0groove_rhre.py" rhre2gtlm "%~1" -o "%~dp1multi.gtl"
pause
