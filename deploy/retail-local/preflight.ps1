[CmdletBinding()]
param([switch]$SkipPortCheck)

$ErrorActionPreference = "Stop"
$localRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $localRoot "runtime.ps1")
$ctx = Get-RetailLocalContext -ScriptRoot $localRoot

if (-not $IsWindows) { throw "BMS Retail Local technical pilot รองรับ Windows เท่านั้น" }
if ($PSVersionTable.PSVersion.Major -lt 7) { throw "ต้องใช้ PowerShell 7 ขึ้นไป (pwsh)" }
if (-not [Environment]::Is64BitOperatingSystem) { throw "ต้องใช้ Windows 64-bit" }
if (-not (Test-Path -LiteralPath $ctx.ComposeFile -PathType Leaf)) { throw "package ไม่ครบ: ไม่พบ compose.yml" }

Assert-RetailLocalDocker

$drive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($localRoot).Substring(0, 1))
$freeGiB = [Math]::Round($drive.Free / 1GB, 1)
if ($freeGiB -lt 8) { throw "พื้นที่ว่างเหลือ $freeGiB GB — ต้องมีอย่างน้อย 8 GB สำหรับติดตั้งและ backup" }
if ($freeGiB -lt 15) { Write-Warning "พื้นที่ว่างเหลือ $freeGiB GB ควรเพิ่มเป็นอย่างน้อย 15 GB ก่อนใช้งานจริง" }

$memoryGiB = [Math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
if ($memoryGiB -lt 8) { Write-Warning "RAM $memoryGiB GB ต่ำกว่าค่าที่แนะนำ 8 GB" }

$release = Get-RetailLocalRelease -ReleaseFile $ctx.ReleaseFile
if ($release) {
  $archive = Join-Path $localRoot "images\$($release.imageArchive)"
  if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) { throw "package ไม่ครบ: ไม่พบ $archive" }
  Write-Host "Package: BMS Retail Local $($release.version)" -ForegroundColor Cyan
} else {
  $repoDockerfile = [IO.Path]::GetFullPath((Join-Path $localRoot "..\..\apps\web\Dockerfile"))
  if (-not (Test-Path -LiteralPath $repoDockerfile -PathType Leaf)) {
    throw "ไม่พบ release.json/images และไม่พบ source tree สำหรับ build"
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

Write-Host "Preflight ผ่าน: Docker พร้อม, disk $freeGiB GB, RAM $memoryGiB GB" -ForegroundColor Green
