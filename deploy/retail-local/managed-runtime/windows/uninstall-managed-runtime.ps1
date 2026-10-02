[CmdletBinding()]
param(
  [switch]$EraseData,
  [string]$InstallRoot = (Join-Path $env:ProgramData "BMS\RetailLocal"),
  [string]$LogFile = (Join-Path $env:ProgramData "BMS\RetailLocal-uninstall.log")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$utf8 = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$global:OutputEncoding = $utf8
try { & "$env:SystemRoot\System32\chcp.com" 65001 *> $null } catch {}

function Write-UninstallStep([int]$Step, [int]$Total, [string]$Message) {
  Write-Host "[BMS Uninstall $Step/$Total] $Message" -ForegroundColor Cyan
}

function Stop-AndRemoveScheduledTask([string]$TaskName) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
}

function Invoke-BoundedProcess(
  [string]$FilePath,
  [string]$ArgumentLine,
  [int]$TimeoutSeconds
) {
  $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentLine `
    -WindowStyle Hidden -PassThru
  try {
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      try { $process.Kill() } catch {}
      [void]$process.WaitForExit(2000)
      return [pscustomobject]@{ ExitCode = $null; TimedOut = $true }
    }
    return [pscustomobject]@{ ExitCode = $process.ExitCode; TimedOut = $false }
  } finally {
    $process.Dispose()
  }
}

$transcriptStarted = $false
try {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogFile) | Out-Null
  Start-Transcript -Path $LogFile -Append | Out-Null
  $transcriptStarted = $true
} catch {}

try {
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "ต้องเปิดด้วยสิทธิ์ Administrator"
}
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
if ($InstallRoot -eq [IO.Path]::GetPathRoot($InstallRoot)) { throw "InstallRoot ไม่ปลอดภัย" }

$taskNames = @(
  "BMS Retail Local Runtime",
  "BMS Retail Local Setup Resume",
  "BMS Retail Local License Evidence",
  "BMS Retail Local License UI",
  "BMS Retail Local Off-host Backup",
  "BMS Retail Local POS Pairing"
)
Write-UninstallStep 1 4 "หยุดและยกเลิกรายการเปิดอัตโนมัติ"
foreach ($taskName in $taskNames) { Stop-AndRemoveScheduledTask $taskName }

$installedAgent = Join-Path $InstallRoot "bootstrap\bms-runtime-agent.exe"
Write-UninstallStep 2 4 "บันทึกสถานะการถอนการติดตั้ง"
if (Test-Path -LiteralPath $installedAgent -PathType Leaf) {
  # Evidence is administrative and must never make uninstall or shop recovery fail.
  try {
    $evidence = Invoke-BoundedProcess $installedAgent `
      "license-pulse -root `"$InstallRoot`" -event INSTALLATION_DEACTIVATED" 3
    if ($evidence.TimedOut) { Write-Warning "ข้ามการส่งสถานะ licensing เพราะเกิน 3 วินาที" }
  } catch {
    Write-Warning "ข้ามการส่งสถานะ licensing; การถอนการติดตั้งยังทำต่อได้"
  }
  try {
    $receiptPath = Join-Path $InstallRoot "installation.json"
    $resumePath = Join-Path $InstallRoot "bootstrap\resume.json"
    if ((Test-Path -LiteralPath $receiptPath -PathType Leaf) -and (Test-Path -LiteralPath $resumePath -PathType Leaf)) {
      $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
      $resume = Get-Content -LiteralPath $resumePath -Raw | ConvertFrom-Json
      if (-not [string]::IsNullOrWhiteSpace([string]$resume.activationUri)) {
        $packageType = if ($receipt.PSObject.Properties.Name -contains 'packageType') { [string]$receipt.packageType } else { 'server-pos' }
        $arguments = "installation-report -root `"$InstallRoot`" -control-uri `"$([string]$resume.activationUri)`" " +
          "-event UNINSTALLED -package-type `"$packageType`" -target `"$([string]$receipt.platformTarget)`" " +
          "-release-version `"$([string]$receipt.version)`" -tenant-reference `"$([string]$receipt.tenantId)`" " +
          "-license-reference `"$([string]$receipt.licenseCode)`" -force"
        $registry = Invoke-BoundedProcess $installedAgent $arguments 5
        if ($registry.TimedOut) { Write-Warning "ข้ามการส่งสถานะ installation registry เพราะเกิน 5 วินาที" }
      }
    }
  } catch { Write-Warning "ข้ามการส่งสถานะ installation registry; การถอนการติดตั้งยังทำต่อได้" }
}

Write-UninstallStep 3 4 "หยุด private WSL runtime"
$wsl = Join-Path $env:SystemRoot "System32\wsl.exe"
try {
  $termination = Invoke-BoundedProcess $wsl "--terminate BMSRuntime" 10
  if ($termination.TimedOut) { Write-Warning "หยุด BMSRuntime เกิน 10 วินาที; ถอน startup แล้วและดำเนินการต่อ" }
} catch {
  Write-Warning "หยุด BMSRuntime ไม่สำเร็จ; ถอน startup แล้วและดำเนินการต่อ"
}

if (-not $EraseData) {
  Write-UninstallStep 4 4 "เก็บข้อมูลร้านและ secrets ไว้สำหรับ recovery"
  Write-Host "หยุดและถอด startup แล้ว ข้อมูลร้าน, secrets และ BMSRuntime ยังอยู่เพื่อ recovery" -ForegroundColor Green
  Write-Host "ใช้ backup ก่อน และรันสคริปต์นี้ด้วย -EraseData เฉพาะเมื่อต้องการลบถาวร"
  return
}

$answer = Read-Host "การลบถาวรกู้คืนไม่ได้ พิมพ์ ERASE-BMS-RETAIL-LOCAL"
if ($answer -cne "ERASE-BMS-RETAIL-LOCAL") { throw "ยกเลิกการลบข้อมูล" }
$unregister = Invoke-BoundedProcess $wsl "--unregister BMSRuntime" 90
if ($unregister.TimedOut -or $unregister.ExitCode -ne 0) {
  throw "ลบ BMSRuntime ไม่สำเร็จ; ยังไม่ลบไฟล์ host"
}
if (Test-Path -LiteralPath $InstallRoot) { Remove-Item -LiteralPath $InstallRoot -Recurse -Force }
Write-Host "ลบ BMS Retail Local และข้อมูลในเครื่องแล้ว" -ForegroundColor Yellow
} finally {
  if ($transcriptStarted) { try { Stop-Transcript | Out-Null } catch {} }
}
