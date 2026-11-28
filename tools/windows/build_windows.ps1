# GE-155: build GrooveInstaller.exe (GUI) and GrooveInstall.exe (CLI) on Windows, then validate the
# CLI build on a simulated SD. DRAFT. Run from the repository root in PowerShell:
#   powershell -ExecutionPolicy Bypass -File tools\windows\build_windows.ps1
# Needs Python 3.9+ from python.org (with tcl/tk) on PATH (`python` or the `py` launcher). Creates build-out\ (git-ignored).
# The .exe files must NOT be committed or attached to the public repo.
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $root
$venv = Join-Path $root "build-out\venv"
New-Item -ItemType Directory -Force -Path (Join-Path $root "build-out") | Out-Null
if (-not (Test-Path $venv)) {
    if (Get-Command python -ErrorAction SilentlyContinue) { python -m venv $venv } else { py -3 -m venv $venv }
    if ($LASTEXITCODE -ne 0) { throw "could not create the build venv (install Python 3.9+ from python.org)" }
}
$py = Join-Path $venv "Scripts\python.exe"
& $py -m pip install --disable-pip-version-check -q -r tools\windows\requirements-build.txt
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

Write-Host "== unit tests (source) =="
& $py tests\package\run_all.py build-out\test-results.json | Out-Null
if ($LASTEXITCODE -ne 0) { throw "unit tests failed (see build-out\test-results.json)" }

Write-Host "== PyInstaller =="
& $py -m PyInstaller tools\windows\GrooveInstaller.spec --noconfirm --clean `
    --distpath build-out\dist --workpath build-out\work
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }

Write-Host "== simulated SD validation (source + frozen CLI) =="
& $py tools\groove_sd_sim.py --cli build-out\dist\GrooveInstall.exe --report build-out\sd-sim-report.json
if ($LASTEXITCODE -ne 0) { throw "simulated SD validation failed (see build-out\sd-sim-report.json)" }

Get-FileHash build-out\dist\GrooveInstaller.exe, build-out\dist\GrooveInstall.exe -Algorithm SHA256 |
    Format-Table -AutoSize | Out-String | Tee-Object build-out\SHA256SUMS.txt
Write-Host "OK: build-out\dist\GrooveInstaller.exe and GrooveInstall.exe (do not commit them)"
