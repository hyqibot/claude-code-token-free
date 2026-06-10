# Regenerate desktop / Tauri icons from docs/images/zerotokenCC.{png,ico}
$ErrorActionPreference = "Stop"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$png = Join-Path $root "docs\images\zerotokenCC.png"
$ico = Join-Path $root "docs\images\zerotokenCC.ico"
if (-not (Test-Path $png)) { throw "Missing $png" }
if (-not (Test-Path $ico)) { throw "Missing $ico" }

Copy-Item -Force $png (Join-Path $root "desktop\public\app-icon.png")
Copy-Item -Force $png (Join-Path $root "docs\images\app-icon.png")
New-Item -ItemType Directory -Force -Path (Join-Path $root "docs\public\images") | Out-Null
Copy-Item -Force $png (Join-Path $root "docs\public\images\app-icon.png")

Push-Location (Join-Path $root "desktop")
try {
  bun run tauri icon $png
  Copy-Item -Force $ico (Join-Path $root "desktop\src-tauri\icons\icon.ico")
  Write-Host "Brand icons synced from zerotokenCC."
} finally {
  Pop-Location
}
