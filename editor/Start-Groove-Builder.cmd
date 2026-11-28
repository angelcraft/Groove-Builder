@echo off
setlocal
cd /d "%~dp0"
where npm.cmd >nul 2>nul || (echo Install Node.js with npm first. & exit /b 1)
call npm ci --ignore-scripts || exit /b 1
call npm run build || exit /b 1
echo Open http://localhost:4173 in your browser.
call npm run preview
