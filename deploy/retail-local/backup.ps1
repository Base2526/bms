[CmdletBinding()]
param([string]$Destination)

$ErrorActionPreference = "Stop"
$localRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $localRoot "runtime.ps1")
$ctx = Get-RetailLocalContext -ScriptRoot $localRoot
$envFile = $ctx.EnvFile
$composeFile = $ctx.ComposeFile
if (-not (Test-Path -LiteralPath $envFile)) { throw "ยังไม่ได้ติดตั้ง กรุณารัน install.ps1 ก่อน" }
$databaseName = Get-RetailLocalEnvValue -EnvFile $envFile -Name "POSTGRES_DB"
if ($databaseName -notmatch '^[A-Za-z0-9_-]+$') { throw "POSTGRES_DB ใน .env.local ไม่ถูกต้อง" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
if (-not $Destination) { $Destination = Join-Path $localRoot "backups\$stamp" }
$destinationPath = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Force -Path $destinationPath | Out-Null

$containerId = (& docker compose --env-file $envFile -f $composeFile ps -q postgres).Trim()
if (-not $containerId) { throw "PostgreSQL ยังไม่ทำงาน กรุณารัน start.ps1 ก่อน" }
$insideDump = "/tmp/bms-retail-local-$stamp.dump"
& docker exec $containerId pg_dump -U app -d $databaseName -Fc -f $insideDump
if ($LASTEXITCODE -ne 0) { throw "สำรองฐานข้อมูลไม่สำเร็จ" }
try {
  & docker cp "${containerId}:${insideDump}" (Join-Path $destinationPath "database.dump")
  if ($LASTEXITCODE -ne 0) { throw "คัดลอกไฟล์สำรองฐานข้อมูลไม่สำเร็จ" }
} finally {
  & docker exec $containerId rm -f $insideDump *> $null
}

$storageDir = Join-Path $localRoot "data\storage"
if (Test-Path -LiteralPath $storageDir) {
  Compress-Archive -Path $storageDir -DestinationPath (Join-Path $destinationPath "storage.zip") -Force
}
Copy-Item -LiteralPath $envFile -Destination (Join-Path $destinationPath "secrets.env")
$installationFile = Join-Path $localRoot "installation.json"
if (Test-Path -LiteralPath $installationFile -PathType Leaf) {
  Copy-Item -LiteralPath $installationFile -Destination (Join-Path $destinationPath "installation.json")
}
$releaseFile = Join-Path $localRoot "release.json"
if (Test-Path -LiteralPath $releaseFile -PathType Leaf) {
  Copy-Item -LiteralPath $releaseFile -Destination (Join-Path $destinationPath "release.json")
}
$manifest = @(
  "created_at=$((Get-Date).ToString('o'))",
  "database=database.dump",
  "storage=storage.zip",
  "secrets=secrets.env",
  "checksums=SHA256SUMS.txt",
  "warning=This directory contains credentials and must be encrypted at rest."
)
Set-Content -LiteralPath (Join-Path $destinationPath "manifest.txt") -Value $manifest -Encoding utf8NoBOM
$checksumLines = Get-ChildItem -LiteralPath $destinationPath -File |
  Where-Object { $_.Name -ne "SHA256SUMS.txt" } |
  Sort-Object Name |
  ForEach-Object { "$(($_ | Get-FileHash -Algorithm SHA256).Hash.ToLowerInvariant())  $($_.Name)" }
Set-Content -LiteralPath (Join-Path $destinationPath "SHA256SUMS.txt") -Value $checksumLines -Encoding ascii
Write-Host "Backup สำเร็จ: $destinationPath" -ForegroundColor Green
Write-Host "โฟลเดอร์นี้มี secrets ของร้าน ต้องเก็บในสื่อที่เข้ารหัส" -ForegroundColor Yellow

