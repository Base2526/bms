[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:ProgramData "BMS\RetailLocal")
)

$ErrorActionPreference = "Stop"
$statusPath = Join-Path $InstallRoot "offhost-backup-status.json"
if (-not (Test-Path -LiteralPath $statusPath -PathType Leaf)) {
  Write-Error "No off-host backup result is available"
  exit 1
}
$status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
$status | ConvertTo-Json
if ([string]$status.status -ne "passed") { exit 1 }
$lastSuccess = [DateTimeOffset]::Parse([string]$status.at).ToUniversalTime()
if ([DateTimeOffset]::UtcNow.Subtract($lastSuccess).TotalHours -gt 48) {
  Write-Error "The latest off-host backup is older than 48 hours"
  exit 1
}
