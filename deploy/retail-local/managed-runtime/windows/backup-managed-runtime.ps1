[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Destination,
  [string]$InstallRoot = (Join-Path $env:ProgramData "BMS\RetailLocal")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$agent = Join-Path $InstallRoot "bootstrap\bms-runtime-agent.exe"
if (-not (Test-Path -LiteralPath $agent -PathType Leaf)) { throw "BMS Runtime Agent was not found" }
$Destination = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $Destination) { throw "Destination file already exists: $Destination" }
$runtimeBackup = "/var/lib/bms-retail-local/backups/backup-$([DateTimeOffset]::UtcNow.ToString('yyyyMMdd-HHmmss')).tar.age"

Write-Host "Set a backup password and store it separately from the shop computer" -ForegroundColor Yellow
& wsl.exe -d BMSRuntime -u root -- bms-localctl backup $runtimeBackup
if ($LASTEXITCODE -ne 0) { throw "Failed to create the encrypted backup" }
try {
  & $agent runtime-read -engine windows-wsl -distro BMSRuntime -source $runtimeBackup -destination $Destination
  if ($LASTEXITCODE -ne 0) { throw "Failed to export the backup to Windows" }
} finally {
  & wsl.exe -d BMSRuntime -u root -- rm -f -- $runtimeBackup
}
Write-Host "Backup created: $Destination" -ForegroundColor Green
