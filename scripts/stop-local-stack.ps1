$ErrorActionPreference = "Stop"

$ports = @(4100, 3000, 8081)
$stopped = New-Object System.Collections.Generic.HashSet[int]

foreach ($port in $ports) {
  $lines = netstat -ano | Select-String ":$port" | Select-String "LISTENING"
  foreach ($line in $lines) {
    $parts = ($line.ToString() -split "\s+") | Where-Object { $_ -ne "" }
    $procIdText = $parts[-1]
    if ($procIdText -match "^\d+$") {
      $procId = [int]$procIdText
      if ($stopped.Contains($procId)) {
        continue
      }

      try {
        Stop-Process -Id $procId -Force -ErrorAction Stop
        $stopped.Add($procId) | Out-Null
        Write-Host "Stopped PID $procId on port $port"
      } catch {
        Write-Host "Could not stop PID $procId on port $port" -ForegroundColor Yellow
      }
    }
  }
}

if ($stopped.Count -eq 0) {
  Write-Host "No stack listeners found on ports 4100/3000/8081."
} else {
  Write-Host "Local stack listeners stopped."
}
