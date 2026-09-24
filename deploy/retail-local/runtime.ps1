$ErrorActionPreference = "Stop"

function Get-RetailLocalContext {
  param([string]$ScriptRoot)
  [pscustomobject]@{
    Root = $ScriptRoot
    ComposeFile = Join-Path $ScriptRoot "compose.yml"
    EnvFile = Join-Path $ScriptRoot ".env.local"
    ReleaseFile = Join-Path $ScriptRoot "release.json"
    StorageDirectory = Join-Path $ScriptRoot "data\storage"
  }
}

function Get-RetailLocalEnvValue {
  param(
    [Parameter(Mandatory = $true)][string]$EnvFile,
    [Parameter(Mandatory = $true)][string]$Name
  )
  if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) { return $null }
  $escaped = [Regex]::Escape($Name)
  $line = Get-Content -LiteralPath $EnvFile |
    Where-Object { $_ -match "^${escaped}=" } |
    Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -split "=", 2)[1].Trim()
}

function Set-RetailLocalEnvValue {
  param(
    [Parameter(Mandatory = $true)][string]$EnvFile,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Value
  )
  if ($Name -notmatch '^[A-Z0-9_]+$' -or $Value -match '[\r\n]') { throw "ค่า env ไม่ถูกต้อง" }
  $lines = if (Test-Path -LiteralPath $EnvFile) { @(Get-Content -LiteralPath $EnvFile) } else { @() }
  $prefix = "$Name="
  $found = $false
  $updated = foreach ($line in $lines) {
    if ($line.StartsWith($prefix, [StringComparison]::Ordinal)) {
      $found = $true
      "$prefix$Value"
    } else {
      $line
    }
  }
  if (-not $found) { $updated = @($updated) + "$prefix$Value" }
  Set-Content -LiteralPath $EnvFile -Value $updated -Encoding utf8NoBOM
}

function Assert-RetailLocalDocker {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "ไม่พบ Docker กรุณาติดตั้ง Docker Desktop และเปิดโปรแกรมก่อน"
  }
  & docker info *> $null
  if ($LASTEXITCODE -ne 0) { throw "Docker Engine ยังไม่พร้อม กรุณาเปิด Docker Desktop แล้วลองใหม่" }
  & docker compose version *> $null
  if ($LASTEXITCODE -ne 0) { throw "ไม่พบ Docker Compose v2 กรุณาอัปเดต Docker Desktop" }
}

function Get-RetailLocalRelease {
  param([Parameter(Mandatory = $true)][string]$ReleaseFile)
  if (-not (Test-Path -LiteralPath $ReleaseFile -PathType Leaf)) { return $null }
  $release = Get-Content -LiteralPath $ReleaseFile -Raw | ConvertFrom-Json
  if ($release.formatVersion -ne 1) { throw "release.json เป็นรูปแบบที่ installer รุ่นนี้ไม่รองรับ" }
  if ([string]::IsNullOrWhiteSpace($release.version) -or $release.version -notmatch '^[A-Za-z0-9._-]{1,64}$') {
    throw "version ใน release.json ไม่ถูกต้อง"
  }
  if ([string]::IsNullOrWhiteSpace($release.imageTag) -or $release.imageTag -notmatch '^[A-Za-z0-9._-]{1,64}$') {
    throw "imageTag ใน release.json ไม่ถูกต้อง"
  }
  if ([string]::IsNullOrWhiteSpace($release.imageArchive) -or $release.imageArchive -match '[\\/]' -or $release.imageArchive -notmatch '^[A-Za-z0-9._-]+$') {
    throw "imageArchive ใน release.json ไม่ถูกต้อง"
  }
  if ($release.imageSha256 -notmatch '^[a-fA-F0-9]{64}$') { throw "imageSha256 ใน release.json ไม่ถูกต้อง" }
  return $release
}

function Import-RetailLocalReleaseImages {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)]$Release
  )
  $archive = [IO.Path]::GetFullPath((Join-Path $Root "images\$($Release.imageArchive)"))
  $imagesRoot = [IO.Path]::GetFullPath((Join-Path $Root "images"))
  if (-not $archive.StartsWith($imagesRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "ตำแหน่ง image archive อยู่นอก package"
  }
  if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) { throw "ไม่พบ Docker image archive: $archive" }
  $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne ([string]$Release.imageSha256).ToLowerInvariant()) {
    throw "Docker image archive checksum ไม่ตรง ห้ามติดตั้ง package ที่อาจเสียหายหรือถูกแก้ไข"
  }
  Write-Host "กำลังโหลด Docker images ของ BMS Retail Local $($Release.version)..." -ForegroundColor Cyan
  & docker load --input $archive
  if ($LASTEXITCODE -ne 0) { throw "โหลด Docker images ไม่สำเร็จ" }
}

function Assert-RetailLocalPortAvailable {
  param([Parameter(Mandatory = $true)][int]$Port)
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
  try {
    $listener.Start()
  } catch {
    throw "พอร์ต 127.0.0.1:$Port ถูกใช้งานอยู่ กรุณาปิดโปรแกรมที่ใช้พอร์ตนี้ก่อนติดตั้ง"
  } finally {
    $listener.Stop()
  }
}

function Protect-RetailLocalSecretFile {
  param([Parameter(Mandatory = $true)][string]$Path)
  if ($IsWindows) {
    & icacls $Path /inheritance:r /grant:r "${env:USERNAME}:(R,W)" *> $null
    if ($LASTEXITCODE -ne 0) { throw "จำกัดสิทธิ์ไฟล์ secrets ไม่สำเร็จ" }
  } else {
    & chmod 600 $Path
    if ($LASTEXITCODE -ne 0) { throw "จำกัดสิทธิ์ไฟล์ secrets ไม่สำเร็จ" }
  }
}

function Wait-RetailLocalHealthy {
  param(
    [Parameter(Mandatory = $true)][string[]]$ComposeArgs,
    [int]$TimeoutSeconds = 240
  )
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $webId = (& docker @ComposeArgs ps -q web).Trim()
    $wsId = (& docker @ComposeArgs ps -q ws).Trim()
    $webHealth = if ($webId) { (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $webId).Trim() } else { "missing" }
    $wsHealth = if ($wsId) { (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $wsId).Trim() } else { "missing" }
    if ($webHealth -eq "healthy" -and $wsHealth -eq "healthy") { return }
    if ($webHealth -eq "unhealthy" -or $wsHealth -eq "unhealthy") {
      throw "บริการไม่ healthy (web=$webHealth, ws=$wsHealth) กรุณารัน doctor.ps1"
    }
    Start-Sleep -Seconds 3
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "รอบริการพร้อมใช้งานเกิน $TimeoutSeconds วินาที กรุณารัน doctor.ps1"
}

function Test-RetailLocalHttp {
  param(
    [Parameter(Mandatory = $true)][int]$WebPort,
    [Parameter(Mandatory = $true)][int]$WsPort
  )
  $web = Invoke-WebRequest -Uri "http://127.0.0.1:$WebPort/admin/login" -UseBasicParsing -TimeoutSec 15
  $ws = Invoke-WebRequest -Uri "http://127.0.0.1:$WsPort/readyz" -UseBasicParsing -TimeoutSec 15
  if ($web.StatusCode -ne 200 -or $ws.StatusCode -ne 200) {
    throw "HTTP health check ไม่ผ่าน (web=$($web.StatusCode), ws=$($ws.StatusCode))"
  }
}

function Get-RetailLocalComposeArgs {
  param([Parameter(Mandatory = $true)]$Context)
  return @("compose", "--env-file", $Context.EnvFile, "-f", $Context.ComposeFile)
}
