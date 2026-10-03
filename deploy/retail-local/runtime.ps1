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
  if ($Name -notmatch '^[A-Z0-9_]+$' -or $Value -match '[\r\n]') { throw "Invalid environment setting" }
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
    throw "Docker was not found. Install and open Docker Desktop first"
  }
  & docker info *> $null
  if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not ready. Open Docker Desktop and try again" }
  & docker compose version *> $null
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose v2 was not found. Update Docker Desktop" }
}

function Get-RetailLocalRelease {
  param([Parameter(Mandatory = $true)][string]$ReleaseFile)
  if (-not (Test-Path -LiteralPath $ReleaseFile -PathType Leaf)) { return $null }
  $release = Get-Content -LiteralPath $ReleaseFile -Raw | ConvertFrom-Json
  if ($release.formatVersion -ne 1) { throw "This installer does not support the release.json format" }
  if ([string]::IsNullOrWhiteSpace($release.version) -or $release.version -notmatch '^[A-Za-z0-9._-]{1,64}$') {
    throw "Invalid version in release.json"
  }
  if ([string]::IsNullOrWhiteSpace($release.imageTag) -or $release.imageTag -notmatch '^[A-Za-z0-9._-]{1,64}$') {
    throw "Invalid imageTag in release.json"
  }
  if ([string]::IsNullOrWhiteSpace($release.imageArchive) -or $release.imageArchive -match '[\\/]' -or $release.imageArchive -notmatch '^[A-Za-z0-9._-]+$') {
    throw "Invalid imageArchive in release.json"
  }
  if ($release.imageSha256 -notmatch '^[a-fA-F0-9]{64}$') { throw "Invalid imageSha256 in release.json" }
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
    throw "Image archive path is outside the package"
  }
  if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) { throw "Docker image archive not found: $archive" }
  $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne ([string]$Release.imageSha256).ToLowerInvariant()) {
    throw "Docker image archive checksum mismatch. Do not install a potentially damaged or modified package"
  }
  Write-Host "Loading Docker images for BMS Retail Local $($Release.version)..." -ForegroundColor Cyan
  & docker load --input $archive
  if ($LASTEXITCODE -ne 0) { throw "Failed to load Docker images" }
}

function Assert-RetailLocalPortAvailable {
  param([Parameter(Mandatory = $true)][int]$Port)
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
  try {
    $listener.Start()
  } catch {
    throw "Port 127.0.0.1:$Port is in use. Close the program using this port before installing"
  } finally {
    $listener.Stop()
  }
}

function Protect-RetailLocalSecretFile {
  param([Parameter(Mandatory = $true)][string]$Path)
  if ($IsWindows) {
    & icacls $Path /inheritance:r /grant:r "${env:USERNAME}:(R,W)" *> $null
    if ($LASTEXITCODE -ne 0) { throw "Failed to restrict secret file permissions" }
  } else {
    & chmod 600 $Path
    if ($LASTEXITCODE -ne 0) { throw "Failed to restrict secret file permissions" }
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
      throw "Services are not healthy (web=$webHealth, ws=$wsHealth). Run doctor.ps1"
    }
    Start-Sleep -Seconds 3
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Services did not become ready within $TimeoutSeconds seconds. Run doctor.ps1"
}

function Test-RetailLocalHttp {
  param(
    [Parameter(Mandatory = $true)][int]$WebPort,
    [Parameter(Mandatory = $true)][int]$WsPort
  )
  $web = Invoke-WebRequest -Uri "http://127.0.0.1:$WebPort/admin/login" -UseBasicParsing -TimeoutSec 15
  $ws = Invoke-WebRequest -Uri "http://127.0.0.1:$WsPort/readyz" -UseBasicParsing -TimeoutSec 15
  if ($web.StatusCode -ne 200 -or $ws.StatusCode -ne 200) {
    throw "HTTP health check failed (web=$($web.StatusCode), ws=$($ws.StatusCode))"
  }
}

function Get-RetailLocalComposeArgs {
  param([Parameter(Mandatory = $true)]$Context)
  return @("compose", "--env-file", $Context.EnvFile, "-f", $Context.ComposeFile)
}
