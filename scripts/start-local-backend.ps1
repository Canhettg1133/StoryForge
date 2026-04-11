$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$startDbScript = Join-Path $PSScriptRoot 'start-local-postgres.ps1'

if (-not (Test-Path $startDbScript)) {
  throw "Missing script: $startDbScript"
}

& $startDbScript

if (-not $env:DATABASE_URL) {
  $env:DATABASE_URL = 'postgres://postgres:StoryForgePg2026!@localhost:5432/storyforge'
}

if (-not $env:PGSSLMODE) {
  $env:PGSSLMODE = 'disable'
}

Set-Location $repoRoot
node src/services/jobs/server.js

