[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Destination,
  [string]$InstallRoot = (Join-Path $env:ProgramData "BMS\RetailLocal")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$agent = Join-Path $InstallRoot "bootstrap\bms-runtime-agent.exe"
if (-not (Test-Path -LiteralPath $agent -PathType Leaf)) { throw "ไม่พบ BMS Runtime Agent" }
$Destination = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $Destination) { throw "ไฟล์ปลายทางมีอยู่แล้ว: $Destination" }
$runtimeBackup = "/var/lib/bms-retail-local/backups/backup-$([DateTimeOffset]::UtcNow.ToString('yyyyMMdd-HHmmss')).tar.age"

Write-Host "กรุณาตั้งรหัสผ่าน backup ที่จดเก็บแยกจากเครื่องร้าน" -ForegroundColor Yellow
& wsl.exe -d BMSRuntime -u root -- bms-localctl backup $runtimeBackup
if ($LASTEXITCODE -ne 0) { throw "สร้าง encrypted backup ไม่สำเร็จ" }
try {
  & $agent runtime-read -engine windows-wsl -distro BMSRuntime -source $runtimeBackup -destination $Destination
  if ($LASTEXITCODE -ne 0) { throw "ส่งออก backup มายัง Windows ไม่สำเร็จ" }
} finally {
  & wsl.exe -d BMSRuntime -u root -- rm -f -- $runtimeBackup
}
Write-Host "สร้าง backup สำเร็จ: $Destination" -ForegroundColor Green
