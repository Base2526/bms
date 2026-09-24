[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$BackupDirectory,
  [switch]$ConfirmRestore
)

$ErrorActionPreference = "Stop"
if (-not $ConfirmRestore) { throw "Restore จะเขียนทับข้อมูลปัจจุบัน กรุณารันใหม่พร้อม -ConfirmRestore" }
$localRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $localRoot "runtime.ps1")
$ctx = Get-RetailLocalContext -ScriptRoot $localRoot
$backupPath = [IO.Path]::GetFullPath($BackupDirectory)
$dumpFile = Join-Path $backupPath "database.dump"
$secretsFile = Join-Path $backupPath "secrets.env"
$storageZip = Join-Path $backupPath "storage.zip"
$checksumFile = Join-Path $backupPath "SHA256SUMS.txt"
foreach ($requiredFile in @($dumpFile, $secretsFile, $checksumFile)) {
  if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) { throw "Backup ไม่ครบ: ไม่พบ $requiredFile" }
}

foreach ($line in Get-Content -LiteralPath $checksumFile) {
  if ($line -notmatch '^([a-fA-F0-9]{64})  ([A-Za-z0-9._-]+)$') { throw "SHA256SUMS.txt ผิดรูปแบบ" }
  $expected = $Matches[1].ToLowerInvariant()
  $name = $Matches[2]
  $artifact = Join-Path $backupPath $name
  if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) { throw "Backup ไม่ครบ: ไม่พบ $name" }
  $actual = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw "Backup เสียหายหรือถูกแก้ไข: $name checksum ไม่ตรง" }
}

$envFile = $ctx.EnvFile
$composeFile = $ctx.ComposeFile
Copy-Item -LiteralPath $secretsFile -Destination $envFile -Force
Protect-RetailLocalSecretFile -Path $envFile
$databaseName = Get-RetailLocalEnvValue -EnvFile $envFile -Name "POSTGRES_DB"
if ($databaseName -notmatch '^[A-Za-z0-9_-]+$') { throw "POSTGRES_DB ใน secrets.env ไม่ถูกต้อง" }
& docker compose --env-file $envFile -f $composeFile up -d postgres redis
if ($LASTEXITCODE -ne 0) { throw "เริ่มฐานข้อมูลเพื่อ restore ไม่สำเร็จ" }
& docker compose --env-file $envFile -f $composeFile stop web ws *> $null
$containerId = (& docker compose --env-file $envFile -f $composeFile ps -q postgres).Trim()
if (-not $containerId) { throw "ไม่พบ PostgreSQL container" }
$insideDump = "/tmp/bms-retail-local-restore.dump"
& docker cp $dumpFile "${containerId}:${insideDump}"
if ($LASTEXITCODE -ne 0) { throw "คัดลอก backup เข้า PostgreSQL ไม่สำเร็จ" }
try {
  & docker exec $containerId pg_restore -U app -d $databaseName --clean --if-exists --no-owner --no-privileges $insideDump
  if ($LASTEXITCODE -ne 0) { throw "Restore ฐานข้อมูลไม่สำเร็จ" }
} finally {
  & docker exec $containerId rm -f $insideDump *> $null
}

if (Test-Path -LiteralPath $storageZip -PathType Leaf) {
  $storageDir = Join-Path $localRoot "data\storage"
  $replacedStorage = Join-Path $localRoot "data\storage-before-restore-$((Get-Date).ToString('yyyyMMdd-HHmmss'))"
  if (Test-Path -LiteralPath $storageDir) { Move-Item -LiteralPath $storageDir -Destination $replacedStorage }
  Expand-Archive -LiteralPath $storageZip -DestinationPath (Join-Path $localRoot "data") -Force
}
$installationBackup = Join-Path $backupPath "installation.json"
if (Test-Path -LiteralPath $installationBackup -PathType Leaf) {
  Copy-Item -LiteralPath $installationBackup -Destination (Join-Path $localRoot "installation.json") -Force
}

& (Join-Path $localRoot "start.ps1")
if ($LASTEXITCODE -ne 0) { throw "Restore ข้อมูลสำเร็จ แต่ระบบเปิดกลับไม่สำเร็จ กรุณารัน doctor.ps1" }
Write-Host "Restore สำเร็จจาก $backupPath" -ForegroundColor Green

