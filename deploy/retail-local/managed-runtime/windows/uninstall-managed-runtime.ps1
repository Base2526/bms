[CmdletBinding()]
param(
  [switch]$EraseData,
  [string]$InstallRoot = (Join-Path $env:ProgramData "BMS\RetailLocal")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "ต้องเปิดด้วยสิทธิ์ Administrator"
}
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
if ($InstallRoot -eq [IO.Path]::GetPathRoot($InstallRoot)) { throw "InstallRoot ไม่ปลอดภัย" }

$installedAgent = Join-Path $InstallRoot "bootstrap\bms-runtime-agent.exe"
if (Test-Path -LiteralPath $installedAgent -PathType Leaf) {
  # Evidence is administrative and must never make uninstall or shop recovery fail.
  try { & $installedAgent license-pulse -root $InstallRoot -event INSTALLATION_DEACTIVATED *> $null } catch {}
}
& wsl.exe -d BMSRuntime -u root -- bms-localctl stop 2>$null
& wsl.exe --terminate BMSRuntime 2>$null
Unregister-ScheduledTask -TaskName "BMS Retail Local Runtime" -Confirm:$false -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName "BMS Retail Local Setup Resume" -Confirm:$false -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName "BMS Retail Local License Evidence" -Confirm:$false -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName "BMS Retail Local Off-host Backup" -Confirm:$false -ErrorAction SilentlyContinue

if (-not $EraseData) {
  Write-Host "หยุดและถอด startup แล้ว ข้อมูลร้าน, secrets และ BMSRuntime ยังอยู่เพื่อ recovery" -ForegroundColor Green
  Write-Host "ใช้ backup ก่อน และรันสคริปต์นี้ด้วย -EraseData เฉพาะเมื่อต้องการลบถาวร"
  exit 0
}

$answer = Read-Host "การลบถาวรกู้คืนไม่ได้ พิมพ์ ERASE-BMS-RETAIL-LOCAL"
if ($answer -cne "ERASE-BMS-RETAIL-LOCAL") { throw "ยกเลิกการลบข้อมูล" }
& wsl.exe --unregister BMSRuntime
if ($LASTEXITCODE -ne 0) { throw "ลบ BMSRuntime ไม่สำเร็จ; ยังไม่ลบไฟล์ host" }
if (Test-Path -LiteralPath $InstallRoot) { Remove-Item -LiteralPath $InstallRoot -Recurse -Force }
Write-Host "ลบ BMS Retail Local และข้อมูลในเครื่องแล้ว" -ForegroundColor Yellow
