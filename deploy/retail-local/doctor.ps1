[CmdletBinding()]
param([switch]$Json)

$ErrorActionPreference = "Stop"
$localRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $localRoot "runtime.ps1")
$ctx = Get-RetailLocalContext -ScriptRoot $localRoot
$results = [Collections.Generic.List[object]]::new()

function Invoke-DoctorCheck {
  param([string]$Name, [scriptblock]$Check)
  try {
    $detail = & $Check
    $script:results.Add([pscustomobject]@{ name = $Name; ok = $true; detail = [string]$detail })
  } catch {
    $script:results.Add([pscustomobject]@{ name = $Name; ok = $false; detail = $_.Exception.Message })
  }
}

Invoke-DoctorCheck "secret-file" {
  if (-not (Test-Path -LiteralPath $ctx.EnvFile -PathType Leaf)) { throw "ไม่พบ .env.local — ยังไม่ได้ติดตั้ง" }
  foreach ($name in @("POSTGRES_DB", "POSTGRES_PASSWORD", "REDIS_PASSWORD", "JWT_SECRET", "BMS_SECRET_KEY",
      "BMS_CHECKOUT_SECRET", "BMS_CRON_SECRET", "BMS_JOB_TOKEN", "BMS_LOCAL_IMAGE_TAG")) {
    if ([string]::IsNullOrWhiteSpace((Get-RetailLocalEnvValue -EnvFile $ctx.EnvFile -Name $name))) { throw "ขาด $name" }
  }
  "required values present (values hidden)"
}

Invoke-DoctorCheck "docker" { Assert-RetailLocalDocker; "engine and compose ready" }

$composeArgs = if (Test-Path -LiteralPath $ctx.EnvFile) { Get-RetailLocalComposeArgs -Context $ctx } else { $null }
Invoke-DoctorCheck "compose-config" {
  if (-not $composeArgs) { throw "ยังไม่มี env สำหรับอ่าน compose" }
  & docker @composeArgs config --quiet
  if ($LASTEXITCODE -ne 0) { throw "compose config ไม่ผ่าน" }
  "valid"
}

foreach ($service in @("postgres", "redis", "ws", "web")) {
  Invoke-DoctorCheck "service-$service" {
    if (-not $composeArgs) { throw "ยังไม่มี env" }
    $id = (& docker @composeArgs ps -q $service).Trim()
    if (-not $id) { throw "container ไม่ทำงาน" }
    $state = (& docker inspect --format '{{.State.Status}}' $id).Trim()
    $health = (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $id).Trim()
    if ($state -ne "running") { throw "state=$state" }
    if ($health -notin @("healthy", "none")) { throw "health=$health" }
    "state=$state health=$health"
  }
}

Invoke-DoctorCheck "http" {
  $webPort = [int](Get-RetailLocalEnvValue -EnvFile $ctx.EnvFile -Name "BMS_LOCAL_WEB_PORT")
  $wsPort = [int](Get-RetailLocalEnvValue -EnvFile $ctx.EnvFile -Name "BMS_LOCAL_WS_PORT")
  if ($webPort -lt 1 -or $wsPort -lt 1) { throw "ค่า port ไม่ถูกต้อง" }
  Test-RetailLocalHttp -WebPort $webPort -WsPort $wsPort
  "web=200 ws=200"
}

Invoke-DoctorCheck "database" {
  if (-not $composeArgs) { throw "ยังไม่มี env" }
  $postgresId = (& docker @composeArgs ps -q postgres).Trim()
  if (-not $postgresId) { throw "PostgreSQL ไม่ทำงาน" }
  $databaseName = Get-RetailLocalEnvValue -EnvFile $ctx.EnvFile -Name "POSTGRES_DB"
  if ($databaseName -notmatch '^[A-Za-z0-9_-]+$') { throw "POSTGRES_DB ไม่ถูกต้อง" }
  $summary = (& docker exec $postgresId psql -U app -d $databaseName -At -v ON_ERROR_STOP=1 -c `
    "SELECT (SELECT count(*) FROM bms_local_installation), (SELECT count(*) FROM bms_local_schema_migrations), (SELECT count(*) FROM bms_local_schema_migrations WHERE name = '10.15__bms_retail_local_installation.sql');" 2>&1)
  if ($LASTEXITCODE -ne 0) { throw ($summary -join " ") }
  $parts = ([string]($summary | Select-Object -Last 1)).Trim().Split('|')
  if ($parts.Count -ne 3 -or $parts[0] -ne "1") { throw "installation singleton ไม่ถูกต้อง" }
  if ($parts[2] -ne "1") { throw "migration 10.15 ยังไม่ถูก apply" }
  "installation=1 migrations=$($parts[1]) retailLocalMigration=applied"
}

Invoke-DoctorCheck "storage" {
  if (-not (Test-Path -LiteralPath $ctx.StorageDirectory)) { throw "ไม่พบ data/storage" }
  $probe = Join-Path $ctx.StorageDirectory ".doctor-write-$PID"
  try {
    Set-Content -LiteralPath $probe -Value "ok" -Encoding ascii
  } finally {
    if (Test-Path -LiteralPath $probe) { Remove-Item -LiteralPath $probe -Force }
  }
  "writable"
}

$failed = @($results | Where-Object { -not $_.ok })
if ($Json) {
  [pscustomobject]@{ ok = $failed.Count -eq 0; checkedAt = [DateTimeOffset]::Now.ToString("o"); checks = $results } |
    ConvertTo-Json -Depth 5
} else {
  foreach ($result in $results) {
    $mark = if ($result.ok) { "PASS" } else { "FAIL" }
    $color = if ($result.ok) { "Green" } else { "Red" }
    Write-Host "[$mark] $($result.name): $($result.detail)" -ForegroundColor $color
  }
}
if ($failed.Count -gt 0) { exit 1 }
