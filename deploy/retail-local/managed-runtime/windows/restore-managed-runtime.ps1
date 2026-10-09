[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Backup,
  [string]$InstallRoot = (Join-Path $env:ProgramData "BMS\RetailLocal")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$agent = Join-Path $InstallRoot "bootstrap\bms-runtime-agent.exe"
$Backup = [IO.Path]::GetFullPath($Backup)
if (-not (Test-Path -LiteralPath $agent -PathType Leaf)) { throw "BMS Runtime Agent was not found" }
if (-not (Test-Path -LiteralPath $Backup -PathType Leaf)) { throw "Backup was not found: $Backup" }
$answer = Read-Host "Restore will overwrite the current shop database and files. Type REPLACE-LOCAL-DATA"
if ($answer -cne "REPLACE-LOCAL-DATA") { throw "Restore cancelled" }
$runtimeBackup = "/var/lib/bms-retail-local/backups/restore-input-$([Guid]::NewGuid().ToString('N')).age"
try {
  & $agent runtime-write -engine windows-wsl -distro BMSRuntime -source $Backup `
    -destination $runtimeBackup -mode "0600"
  if ($LASTEXITCODE -ne 0) { throw "Failed to copy the backup into the private runtime" }
  Write-Host "Enter the backup password" -ForegroundColor Yellow
  & wsl.exe -d BMSRuntime -u root -- bms-localctl restore $runtimeBackup REPLACE-LOCAL-DATA
  if ($LASTEXITCODE -ne 0) { throw "Restore failed; do not delete the original backup" }
} finally {
  & wsl.exe -d BMSRuntime -u root -- rm -f -- $runtimeBackup
}
Write-Host "Restore completed" -ForegroundColor Green
