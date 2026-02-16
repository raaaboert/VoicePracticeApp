$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue

if (-not $npmCmd -or -not $nodeCmd) {
  $wingetNodeRoot = Join-Path $env:LOCALAPPDATA "Microsoft\\WinGet\\Packages"
  if (Test-Path $wingetNodeRoot) {
    $nodeCandidates = Get-ChildItem -Path $wingetNodeRoot -Directory -Filter "OpenJS.NodeJS.LTS_*" -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending

    foreach ($candidate in $nodeCandidates) {
      $nodeDir = Get-ChildItem -Path $candidate.FullName -Directory -Filter "node-v*-win-x64" -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if (-not $nodeDir) {
        continue
      }

      $candidateNode = Join-Path $nodeDir.FullName "node.exe"
      $candidateNpm = Join-Path $nodeDir.FullName "npm.cmd"

      if ((Test-Path $candidateNode) -and (Test-Path $candidateNpm)) {
        $env:Path = "$($nodeDir.FullName);$env:Path"
        $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
        $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
        break
      }
    }
  }
}

if (-not $nodeCmd -or -not $npmCmd) {
  Write-Host "node/npm not found on PATH. Run scripts\\preflight.ps1 first." -ForegroundColor Red
  exit 1
}

Write-Host "Preparing review stack..." -ForegroundColor Cyan
Write-Host "Stopping existing listeners on 4100/3000/8081..." -ForegroundColor Cyan
& (Join-Path $PSScriptRoot "stop-local-stack.ps1")

Write-Host "Building shared, API, and admin-web..." -ForegroundColor Cyan
Set-Location $root
& npm.cmd run build --workspace shared
& npm.cmd run build --workspace api
& npm.cmd run build --workspace admin-web

Write-Host "Launching review stack in separate terminals..." -ForegroundColor Cyan

Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "Set-Location '$root'; npm.cmd run start --workspace api"
)

Start-Sleep -Seconds 2

Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "Set-Location '$root'; npm.cmd run start --workspace admin-web"
)

Start-Sleep -Seconds 2

Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "Set-Location '$root'; npm.cmd run start:mobile"
)

Write-Host "Review stack launch commands started." -ForegroundColor Green
Write-Host "Admin URL: http://localhost:3000/login"
Write-Host "API URL: http://localhost:4100/health"
Write-Host "Metro URL: http://localhost:8081"
Write-Host "Admin password: use ADMIN_BOOTSTRAP_PASSWORD from api/.env (default: admin)"
