[CmdletBinding()]
param(
  [switch]$EraseData,
  [string]$ConfirmationText
)

$ErrorActionPreference = "Stop"
$localRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $localRoot "runtime.ps1")
$ctx = Get-RetailLocalContext -ScriptRoot $localRoot
if (-not (Test-Path -LiteralPath $ctx.EnvFile)) { throw "ไม่พบ .env.local — installation นี้ไม่มีข้อมูลให้ถอน" }
Assert-RetailLocalDocker
$composeArgs = Get-RetailLocalComposeArgs -Context $ctx

if ($EraseData) {
  if ($ConfirmationText -cne "ERASE-BMS-LOCAL") {
    throw "การลบข้อมูลถาวรต้องระบุ -ConfirmationText ERASE-BMS-LOCAL"
  }
  Write-Warning "กำลังลบ PostgreSQL/Redis volumes ของ BMS Retail Local แบบกู้จากเครื่องนี้ไม่ได้"
  & docker @composeArgs down -v --remove-orphans
} else {
  & docker @composeArgs down --remove-orphans
}
if ($LASTEXITCODE -ne 0) { throw "ถอน containers ไม่สำเร็จ" }

if ($EraseData) {
  Add-Type -AssemblyName Microsoft.VisualBasic
  foreach ($directory in @((Join-Path $localRoot "data"))) {
    $resolved = [IO.Path]::GetFullPath($directory)
    if (-not $resolved.StartsWith([IO.Path]::GetFullPath($localRoot) + [IO.Path]::DirectorySeparatorChar,
        [StringComparison]::OrdinalIgnoreCase)) { throw "ปฏิเสธ path ที่อยู่นอก installation" }
    if (Test-Path -LiteralPath $resolved) {
      [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($resolved, "OnlyErrorDialogs", "SendToRecycleBin")
    }
  }
  foreach ($file in @($ctx.EnvFile, (Join-Path $localRoot "installation.json"))) {
    if (Test-Path -LiteralPath $file -PathType Leaf) {
      [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($file, "OnlyErrorDialogs", "SendToRecycleBin")
    }
  }
  Write-Host "ลบ database volumes แล้ว; env/storage/receipt ถูกย้ายไป Windows Recycle Bin ส่วน backups ยังอยู่" -ForegroundColor Yellow
} else {
  Write-Host "ถอน containers แล้ว แต่เก็บ database volumes, storage, secrets และ backups ไว้" -ForegroundColor Green
}
