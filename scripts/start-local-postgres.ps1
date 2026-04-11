$ErrorActionPreference = 'Stop'

$pgRoot = 'E:\PostgreSQL\16'
$binDir = Join-Path $pgRoot 'app\pgsql\bin'
$dataDir = Join-Path $pgRoot 'data'
$logFile = Join-Path $pgRoot 'postgres.log'

$pgIsReady = Join-Path $binDir 'pg_isready.exe'
$pgCtl = Join-Path $binDir 'pg_ctl.exe'

if (-not (Test-Path $pgCtl)) {
  throw "PostgreSQL binaries not found at $binDir"
}

& $pgIsReady -h localhost -p 5432 | Out-Null
if ($LASTEXITCODE -eq 0) {
  Write-Output 'PostgreSQL is already running on localhost:5432'
  exit 0
}

& $pgCtl -D $dataDir -l $logFile -o "-p 5432" start
Start-Sleep -Seconds 3
& $pgIsReady -h localhost -p 5432

