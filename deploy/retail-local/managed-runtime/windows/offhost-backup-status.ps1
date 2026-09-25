[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:ProgramData "BMS\RetailLocal")
)

$ErrorActionPreference = "Stop"
$statusPath = Join-Path $InstallRoot "offhost-backup-status.json"
if (-not (Test-Path -LiteralPath $statusPath -PathType Leaf)) {
  Write-Error "ยังไม่มีผล off-host backup"
  exit 1
}
$status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
$status | ConvertTo-Json
if ([string]$status.status -ne "passed") { exit 1 }
$lastSuccess = [DateTimeOffset]::Parse([string]$status.at).ToUniversalTime()
if ([DateTimeOffset]::UtcNow.Subtract($lastSuccess).TotalHours -gt 48) {
  Write-Error "off-host backup ล่าสุดเก่ากว่า 48 ชั่วโมง"
  exit 1
}
