@echo off
rem Arrastra un .rhref (o .rhre3) encima de este archivo: crea el .gtl al lado.
if "%~1"=="" (
  echo Arrastra un remix .rhref encima de convertir.bat
  pause
  exit /b 1
)
if exist "%~dp0plantilla_ht3.gtl" (
  python "%~dp0groove_rhre.py" rhre2gtl "%~1" -o "%~dpn1.gtl" --template "%~dp0plantilla_ht3.gtl"
) else (
  python "%~dp0groove_rhre.py" rhre2gtl "%~1" -o "%~dpn1.gtl"
)
pause
