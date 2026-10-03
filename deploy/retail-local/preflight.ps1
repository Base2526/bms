[CmdletBinding()]
param([switch]$SkipPortCheck)

$ErrorActionPreference = "Stop"
$localRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $localRoot "runtime.ps1")
$ctx = Get-RetailLocalContext -ScriptRoot $localRoot

if (-not $IsWindows) { throw "This BMS Retail Local technical pilot supports Windows only" }
if ($PSVersionTable.PSVersion.Major -lt 7) { throw "PowerShell 7 or later (pwsh) is required" }
if (-not [Environment]::Is64BitOperatingSystem) { throw "64-bit Windows is required" }
if (-not (Test-Path -LiteralPath $ctx.ComposeFile -PathType Leaf)) { throw "Incomplete package: compose.yml was not found" }

Assert-RetailLocalDocker

$drive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($localRoot).Substring(0, 1))
$freeGiB = [Math]::Round($drive.Free / 1GB, 1)
if ($freeGiB -lt 8) { throw "Free disk space: $freeGiB GB - at least 8 GB is required for installation and backups" }
if ($freeGiB -lt 15) { Write-Warning "Free disk space: $freeGiB GB. At least 15 GB is recommended before production use" }

$memoryGiB = [Math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
if ($memoryGiB -lt 8) { Write-Warning "RAM: $memoryGiB GB, below the recommended 8 GB" }

$release = Get-RetailLocalRelease -ReleaseFile $ctx.ReleaseFile
if ($release) {
  $archive = Join-Path $localRoot "images\$($release.imageArchive)"
  if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) { throw "Incomplete package: $archive was not found" }
  Write-Host "Package: BMS Retail Local $($release.version)" -ForegroundColor Cyan
} else {
  $repoDockerfile = [IO.Path]::GetFullPath((Join-Path $localRoot "..\..\apps\web\Dockerfile"))
  if (-not (Test-Path -LiteralPath $repoDockerfile -PathType Leaf)) {
    throw "Neither release.json/images nor a source tree for building was found"
  }
  Write-Host "Mode: source build (development)" -ForegroundColor Yellow
}

if (-not $SkipPortCheck -and -not (Test-Path -LiteralPath $ctx.EnvFile)) {
  Assert-RetailLocalPortAvailable -Port 3100
  Assert-RetailLocalPortAvailable -Port 3101
}

$probe = Join-Path $localRoot ".bms-write-probe-$PID"
try {
  Set-Content -LiteralPath $probe -Value "ok" -Encoding ascii
} finally {
  if (Test-Path -LiteralPath $probe) { Remove-Item -LiteralPath $probe -Force }
}

Write-Host "Preflight passed: Docker ready, disk $freeGiB GB, RAM $memoryGiB GB" -ForegroundColor Green
