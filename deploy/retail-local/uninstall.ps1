[CmdletBinding()]
param(
  [switch]$EraseData,
  [string]$ConfirmationText
)

$ErrorActionPreference = "Stop"
$localRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $localRoot "runtime.ps1")
$ctx = Get-RetailLocalContext -ScriptRoot $localRoot
if (-not (Test-Path -LiteralPath $ctx.EnvFile)) { throw "Missing .env.local - this installation has no data to uninstall" }
Assert-RetailLocalDocker
$composeArgs = Get-RetailLocalComposeArgs -Context $ctx

if ($EraseData) {
  if ($ConfirmationText -cne "ERASE-BMS-LOCAL") {
    throw "Permanent data deletion requires -ConfirmationText ERASE-BMS-LOCAL"
  }
  Write-Warning "Permanently deleting BMS Retail Local PostgreSQL/Redis volumes; they cannot be recovered from this computer"
  & docker @composeArgs down -v --remove-orphans
} else {
  & docker @composeArgs down --remove-orphans
}
if ($LASTEXITCODE -ne 0) { throw "Failed to remove containers" }

if ($EraseData) {
  Add-Type -AssemblyName Microsoft.VisualBasic
  foreach ($directory in @((Join-Path $localRoot "data"))) {
    $resolved = [IO.Path]::GetFullPath($directory)
    if (-not $resolved.StartsWith([IO.Path]::GetFullPath($localRoot) + [IO.Path]::DirectorySeparatorChar,
        [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing a path outside the installation" }
    if (Test-Path -LiteralPath $resolved) {
      [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($resolved, "OnlyErrorDialogs", "SendToRecycleBin")
    }
  }
  foreach ($file in @($ctx.EnvFile, (Join-Path $localRoot "installation.json"))) {
    if (Test-Path -LiteralPath $file -PathType Leaf) {
      [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($file, "OnlyErrorDialogs", "SendToRecycleBin")
    }
  }
  Write-Host "Database volumes deleted; env/storage/receipt moved to the Windows Recycle Bin. Backups are retained" -ForegroundColor Yellow
} else {
  Write-Host "Containers removed. Database volumes, storage, secrets, and backups are retained" -ForegroundColor Green
}
