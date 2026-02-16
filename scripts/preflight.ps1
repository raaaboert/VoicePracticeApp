$ErrorActionPreference = "Stop"

function Test-CommandAvailable {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

$checks = @(
  @{ Name = "git"; Required = $true },
  @{ Name = "node"; Required = $true },
  @{ Name = "npm"; Required = $true }
)

$missing = @()
foreach ($check in $checks) {
  if (-not (Test-CommandAvailable -Name $check.Name)) {
    $missing += $check.Name
  }
}

if ($missing.Count -gt 0) {
  Write-Host "Missing required commands: $($missing -join ', ')" -ForegroundColor Red
} else {
  Write-Host "Core toolchain commands found (git, node, npm)." -ForegroundColor Green
}

$envFiles = @(
  "api\.env",
  "admin-web\.env",
  "mobile\.env"
)

foreach ($envFile in $envFiles) {
  if (Test-Path $envFile) {
    Write-Host "[ok] $envFile"
  } else {
    Write-Host "[missing] $envFile" -ForegroundColor Yellow
  }
}

if (Test-Path ".git") {
  Write-Host "[ok] .git directory found"
} else {
  Write-Host "[missing] .git directory not found in this workspace" -ForegroundColor Yellow
}

if ($missing.Count -gt 0) {
  exit 1
}
