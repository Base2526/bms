[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:ProgramData "BMS\RetailLocal")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$runtimeBackup = $null
$destinationPartial = $null

function Write-BackupStatus([string]$Status, [string]$Message, [string]$Output = "") {
  $value = [ordered]@{
    formatVersion = 1
    status = $Status
    at = [DateTimeOffset]::UtcNow.ToString("o")
    message = $Message
  }
  if (-not [string]::IsNullOrWhiteSpace($Output)) { $value["output"] = $Output }
  $statusPath = Join-Path $InstallRoot "offhost-backup-status.json"
  $temporary = "$statusPath.tmp"
  $value | ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding UTF8
  Move-Item -LiteralPath $temporary -Destination $statusPath -Force
}

function Assert-OffHostDestination([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw "off-host destination ใช้งานไม่ได้" }
  if ((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw "off-host destination ห้ามเป็น symbolic link/junction"
  }
  if ($Path.StartsWith("\\", [StringComparison]::Ordinal)) { return }
  $root = [IO.Path]::GetPathRoot($Path)
  $driveName = $root.Substring(0, 1)
  $psDrive = Get-PSDrive -Name $driveName -PSProvider FileSystem -ErrorAction Stop
  if (-not [string]::IsNullOrWhiteSpace([string]$psDrive.DisplayRoot)) { return }
  $drive = [IO.DriveInfo]::new($root)
  if ($drive.DriveType -in @([IO.DriveType]::Network, [IO.DriveType]::Removable)) { return }
  if ($drive.DriveType -ne [IO.DriveType]::Fixed) { throw "off-host destination ไม่ใช่ supported storage" }
  $systemLetter = ([IO.Path]::GetPathRoot($env:SystemRoot)).Substring(0, 1)
  if ((Get-Partition -DriveLetter $driveName -ErrorAction Stop).DiskNumber -eq
      (Get-Partition -DriveLetter $systemLetter -ErrorAction Stop).DiskNumber) {
    throw "off-host destination อยู่บน physical disk เดียวกับ Windows"
  }
}

try {
  $configPath = Join-Path $InstallRoot "offhost-backup.json"
  if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { throw "ยังไม่ได้ configure off-host backup" }
  $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  $recipient = [string]$config.recipient
  $destination = [IO.Path]::GetFullPath([string]$config.destination)
  $retentionDays = [int]$config.retentionDays
  if ($recipient -notmatch '^age1[0-9a-z]{58}$') { throw "AGE_RECIPIENT ไม่ถูกต้อง" }
  if ($retentionDays -lt 7 -or $retentionDays -gt 365) { throw "retention ไม่ถูกต้อง" }
  Assert-OffHostDestination $destination

  $agent = Join-Path $InstallRoot "bootstrap\bms-runtime-agent.exe"
  if (-not (Test-Path -LiteralPath $agent -PathType Leaf)) { throw "ไม่พบ BMS Runtime Agent" }
  & wsl.exe -d BMSRuntime -u root -- sh -c `
    'install -d -m 0700 /var/lib/bms-retail-local/backups; find /var/lib/bms-retail-local/backups -maxdepth 1 -type f -name "scheduled-*.age" -mmin +60 -delete' *> $null
  if ($LASTEXITCODE -ne 0) { throw "ตรวจ cleanup ของ temporary backup ไม่สำเร็จ" }
  Get-ChildItem -LiteralPath $destination -File -Filter ".bms-retail-local-*.partial.*" |
    Where-Object LastWriteTimeUtc -lt ([DateTime]::UtcNow.AddHours(-1)) |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
  $stamp = [DateTimeOffset]::UtcNow.ToString("yyyyMMddTHHmmssZ")
  $name = "bms-retail-local-$stamp.age"
  $runtimeBackup = "/var/lib/bms-retail-local/backups/scheduled-$stamp.age"
  $destinationPartial = Join-Path $destination ".$name.partial.$PID"
  $finalPath = Join-Path $destination $name
  if (Test-Path -LiteralPath $finalPath) { throw "backup ปลายทางซ้ำ: $finalPath" }

  & wsl.exe -d BMSRuntime -u root -- bms-localctl backup $runtimeBackup --recipient $recipient *> $null
  if ($LASTEXITCODE -ne 0) { throw "สร้าง encrypted backup ไม่สำเร็จ" }
  & $agent runtime-read -engine windows-wsl -distro BMSRuntime -source $runtimeBackup -destination $destinationPartial
  if ($LASTEXITCODE -ne 0) { throw "ส่งออก backup ไป off-host destination ไม่สำเร็จ" }
  Move-Item -LiteralPath $destinationPartial -Destination $finalPath
  $destinationPartial = $null

  $hash = (Get-FileHash -LiteralPath $finalPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $checksumPath = "$finalPath.sha256"
  "$hash  $name`n" | Set-Content -LiteralPath "$checksumPath.tmp" -Encoding ASCII -NoNewline
  Move-Item -LiteralPath "$checksumPath.tmp" -Destination $checksumPath
  Get-ChildItem -LiteralPath $destination -File -Filter "bms-retail-local-*.age" |
    Where-Object LastWriteTimeUtc -lt ([DateTime]::UtcNow.AddDays(-$retentionDays)) |
    ForEach-Object {
      Remove-Item -LiteralPath $_.FullName -Force
      Remove-Item -LiteralPath "$($_.FullName).sha256" -Force -ErrorAction SilentlyContinue
    }
  Write-BackupStatus "passed" "off-host backup สำเร็จ" $finalPath
  Write-Host $finalPath
} catch {
  Write-BackupStatus "failed" "off-host backup ไม่สำเร็จ; เปิด Task Scheduler history หรือติดต่อ support"
  throw
} finally {
  if ($runtimeBackup) { & wsl.exe -d BMSRuntime -u root -- rm -f -- $runtimeBackup *> $null }
  if ($destinationPartial -and (Test-Path -LiteralPath $destinationPartial)) {
    Remove-Item -LiteralPath $destinationPartial -Force
  }
}
