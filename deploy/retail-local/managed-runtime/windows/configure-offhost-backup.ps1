[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Recipient,
  [Parameter(Mandatory = $true)][string]$Destination,
  [ValidateRange(7, 365)][int]$RetentionDays = 35,
  [string]$InstallRoot = (Join-Path $env:ProgramData "BMS\RetailLocal")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-OffHostDestination([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    throw "ไม่พบ destination directory: $Path"
  }
  if ((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw "destination ห้ามเป็น symbolic link/junction"
  }
  if ($Path.StartsWith("\\", [StringComparison]::Ordinal)) { return }
  $root = [IO.Path]::GetPathRoot($Path)
  if ([string]::IsNullOrWhiteSpace($root)) { throw "destination ต้องเป็น absolute path" }
  $driveName = $root.Substring(0, 1)
  $psDrive = Get-PSDrive -Name $driveName -PSProvider FileSystem -ErrorAction Stop
  if (-not [string]::IsNullOrWhiteSpace([string]$psDrive.DisplayRoot)) { return }
  $drive = [IO.DriveInfo]::new($root)
  if ($drive.DriveType -in @([IO.DriveType]::Network, [IO.DriveType]::Removable)) { return }
  if ($drive.DriveType -ne [IO.DriveType]::Fixed) {
    throw "destination ต้องเป็น network/removable/separate physical drive"
  }
  $systemLetter = ([IO.Path]::GetPathRoot($env:SystemRoot)).Substring(0, 1)
  $targetPartition = Get-Partition -DriveLetter $driveName -ErrorAction Stop
  $systemPartition = Get-Partition -DriveLetter $systemLetter -ErrorAction Stop
  if ($targetPartition.DiskNumber -eq $systemPartition.DiskNumber) {
    throw "destination อยู่บน physical disk เดียวกับ Windows จึงไม่ใช่ off-host backup"
  }
}

if ($Recipient -notmatch '^age1[0-9a-z]{58}$') { throw "AGE_RECIPIENT ไม่ถูกต้อง" }
$Destination = [IO.Path]::GetFullPath($Destination)
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
if ($Destination -eq [IO.Path]::GetPathRoot($Destination)) {
  throw "กรุณาสร้าง directory เฉพาะสำหรับ BMS backup แทนการใช้ root ของ drive"
}
if (-not (Test-Administrator)) {
  $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Recipient `"$Recipient`" " +
    "-Destination `"$Destination`" -RetentionDays $RetentionDays -InstallRoot `"$InstallRoot`""
  $process = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -ArgumentList $arguments -Verb RunAs -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "ตั้ง off-host backup ไม่สำเร็จ" }
  exit 0
}
Assert-OffHostDestination $Destination

$bootstrapRoot = Join-Path $InstallRoot "bootstrap"
$runner = Join-Path $bootstrapRoot "run-offhost-backup.ps1"
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) { throw "ไม่พบ BMS off-host backup runner" }
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
$configPath = Join-Path $InstallRoot "offhost-backup.json"
$temporary = "$configPath.tmp"
[ordered]@{
  formatVersion = 1
  recipient = $Recipient
  destination = $Destination
  retentionDays = $RetentionDays
} | ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding UTF8
Move-Item -LiteralPath $temporary -Destination $configPath -Force
$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls $configPath /inheritance:r /grant:r "Administrators:F" "SYSTEM:F" "${userId}:F" *> $null
if ($LASTEXITCODE -ne 0) { throw "จำกัดสิทธิ์ backup configuration ไม่สำเร็จ" }

$powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$action = New-ScheduledTaskAction -Execute $powershell `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -InstallRoot `"$InstallRoot`""
$trigger = New-ScheduledTaskTrigger -Daily -At 2am
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
  -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName "BMS Retail Local Off-host Backup" -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName "BMS Retail Local Off-host Backup"
Write-Host "ตั้ง encrypted off-host backup สำเร็จ: $Destination (เก็บ $RetentionDays วัน)" -ForegroundColor Green
