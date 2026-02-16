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

Write-Host "Launching local stack in separate terminals..." -ForegroundColor Cyan

Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "Set-Location '$root'; npm.cmd run start:api"
)

Start-Sleep -Seconds 2

Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "Set-Location '$root'; npm.cmd run start:admin"
)

Start-Sleep -Seconds 2

Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "Set-Location '$root'; npm.cmd run start:mobile"
)

Write-Host "API + Admin + Mobile launch commands started." -ForegroundColor Green
Write-Host "Admin URL: http://localhost:3000/login"
Write-Host "API URL: http://localhost:4100/health"
