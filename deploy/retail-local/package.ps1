[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$OutputDirectory,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
if ($Version -notmatch '^[A-Za-z0-9._-]{1,64}$') { throw "Version ใช้ได้เฉพาะ A-Z, a-z, 0-9, dot, underscore และ hyphen" }
$localRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [IO.Path]::GetFullPath((Join-Path $localRoot "..\.."))
. (Join-Path $localRoot "runtime.ps1")
Assert-RetailLocalDocker

if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repoRoot "artifacts\retail-local" }
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
$zipPath = Join-Path $outputRoot "BMS-Retail-Local-$Version.zip"
if ((Test-Path -LiteralPath $zipPath) -and -not $Force) { throw "มี package นี้แล้ว: $zipPath (ใช้ -Force เมื่อตั้งใจแทนที่)" }

$stageBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$stage = Join-Path $stageBase "bms-retail-local-package-$([Guid]::NewGuid().ToString('N'))"
$bundle = Join-Path $stage "BMS-Retail-Local-$Version"
$imagesDir = Join-Path $bundle "images"
New-Item -ItemType Directory -Force -Path $imagesDir | Out-Null

try {
  $env:POSTGRES_DB = "bms_local"
  $env:POSTGRES_PASSWORD = "package-build-only"
  $env:REDIS_PASSWORD = "package-build-only"
  $env:JWT_SECRET = "package-build-only-0123456789abcdef0123456789abcdef"
  $env:BMS_SECRET_KEY = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  $env:BMS_CHECKOUT_SECRET = "package-build-only-0123456789abcdef0123456789abcdef"
  $env:BMS_CRON_SECRET = "package-build-only"
  $env:BMS_JOB_TOKEN = "package-build-only"
  $env:BMS_LOCAL_IMAGE_TAG = $Version

  $composeFile = Join-Path $localRoot "compose.yml"
  & docker compose -f $composeFile build migrate ws
  if ($LASTEXITCODE -ne 0) { throw "Build application images ไม่สำเร็จ" }
  & docker pull postgres:16-alpine
  if ($LASTEXITCODE -ne 0) { throw "Pull postgres:16-alpine ไม่สำเร็จ" }
  & docker pull redis:7-alpine
  if ($LASTEXITCODE -ne 0) { throw "Pull redis:7-alpine ไม่สำเร็จ" }

  $imageNames = @(
    "bms-retail-local-web:$Version",
    "bms-retail-local-ws:$Version",
    "postgres:16-alpine",
    "redis:7-alpine"
  )
  foreach ($imageName in $imageNames) {
    & docker image inspect $imageName *> $null
    if ($LASTEXITCODE -ne 0) { throw "ไม่พบ image หลัง build: $imageName" }
  }

  $archiveName = "bms-retail-local-images-$Version.tar"
  $archivePath = Join-Path $imagesDir $archiveName
  & docker image save --output $archivePath @imageNames
  if ($LASTEXITCODE -ne 0) { throw "สร้าง Docker image archive ไม่สำเร็จ" }
  $archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()

  $runtimeFiles = @(
    ".env.example", "compose.yml", "runtime.ps1", "preflight.ps1", "install.ps1",
    "start.ps1", "stop.ps1", "status.ps1", "doctor.ps1", "backup.ps1", "restore.ps1",
    "update.ps1", "uninstall.ps1", "Install-BMS-Retail-Local.cmd", "Check-BMS-Retail-Local.cmd",
    "TEST-INSTALL.md"
  )
  foreach ($name in $runtimeFiles) {
    $source = Join-Path $localRoot $name
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "ขาดไฟล์ใน package: $name" }
    Copy-Item -LiteralPath $source -Destination (Join-Path $bundle $name)
  }

  $commit = (& git -C $repoRoot rev-parse HEAD).Trim()
  $workingTreeStatus = (& git -C $repoRoot status --porcelain --untracked-files=normal)
  if ($workingTreeStatus) { $commit = "$commit-dirty" }
  $release = [ordered]@{
    formatVersion = 1
    product = "BMS Retail Local"
    version = $Version
    imageTag = $Version
    imageArchive = $archiveName
    imageSha256 = $archiveHash
    createdAt = [DateTimeOffset]::Now.ToString("o")
    sourceCommit = $commit
    images = $imageNames
  }
  Set-Content -LiteralPath (Join-Path $bundle "release.json") -Value ($release | ConvertTo-Json -Depth 4) -Encoding utf8NoBOM

  if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
  Compress-Archive -LiteralPath $bundle -DestinationPath $zipPath -CompressionLevel Optimal
  $zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  Set-Content -LiteralPath "$zipPath.sha256" -Value "$zipHash  $([IO.Path]::GetFileName($zipPath))" -Encoding ascii
  Write-Host "Package พร้อมทดสอบ: $zipPath" -ForegroundColor Green
  Write-Host "SHA-256: $zipHash"
} finally {
  if (Test-Path -LiteralPath $stage) {
    $resolvedStage = [IO.Path]::GetFullPath($stage)
    if (-not $resolvedStage.StartsWith($stageBase, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolvedStage) -notlike "bms-retail-local-package-*") {
      throw "ปฏิเสธการล้าง temporary directory ที่อยู่นอกขอบเขต"
    }
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
  }
}
