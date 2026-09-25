[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Backup,
  [string]$InstallRoot = (Join-Path $env:ProgramData "BMS\RetailLocal")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$agent = Join-Path $InstallRoot "bootstrap\bms-runtime-agent.exe"
$Backup = [IO.Path]::GetFullPath($Backup)
if (-not (Test-Path -LiteralPath $agent -PathType Leaf)) { throw "ไม่พบ BMS Runtime Agent" }
if (-not (Test-Path -LiteralPath $Backup -PathType Leaf)) { throw "ไม่พบ backup: $Backup" }
$answer = Read-Host "restore จะเขียนทับฐานข้อมูลและไฟล์ร้านปัจจุบัน พิมพ์ REPLACE-LOCAL-DATA"
if ($answer -cne "REPLACE-LOCAL-DATA") { throw "ยกเลิก restore" }
$runtimeBackup = "/var/lib/bms-retail-local/backups/restore-input-$([Guid]::NewGuid().ToString('N')).age"
try {
  & $agent runtime-write -engine windows-wsl -distro BMSRuntime -source $Backup `
    -destination $runtimeBackup -mode "0600"
  if ($LASTEXITCODE -ne 0) { throw "นำ backup เข้า private runtime ไม่สำเร็จ" }
  Write-Host "กรอกรหัสผ่านของ backup" -ForegroundColor Yellow
  & wsl.exe -d BMSRuntime -u root -- bms-localctl restore $runtimeBackup REPLACE-LOCAL-DATA
  if ($LASTEXITCODE -ne 0) { throw "restore ไม่สำเร็จ; ห้ามลบ backup ต้นฉบับ" }
} finally {
  & wsl.exe -d BMSRuntime -u root -- rm -f -- $runtimeBackup
}
Write-Host "restore สำเร็จ" -ForegroundColor Green
