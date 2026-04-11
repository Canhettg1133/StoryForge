$ErrorActionPreference = 'Stop'

$pgRoot = 'E:\PostgreSQL\16'
$binDir = Join-Path $pgRoot 'app\pgsql\bin'
$dataDir = Join-Path $pgRoot 'data'
$pgCtl = Join-Path $binDir 'pg_ctl.exe'

if (-not (Test-Path $pgCtl)) {
  throw "PostgreSQL binaries not found at $binDir"
}

& $pgCtl -D $dataDir stop

