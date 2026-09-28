[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [switch]$UpdateVersion,
  [switch]$Force,
  [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
  throw "Version ต้องเป็น Semantic Version เช่น 0.2.13 หรือ 0.2.13-rc.1"
}
if ($PSVersionTable.PSVersion.Major -lt 7) {
  throw "ต้องรันด้วย PowerShell 7: pwsh"
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot "..\.."))
$desktopRoot = Join-Path $repoRoot "apps\desktop"
$desktopPackagePath = Join-Path $desktopRoot "package.json"
$desktopLockPath = Join-Path $desktopRoot "package-lock.json"
$outputRoot = Join-Path $repoRoot "artifacts\retail-local"

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][scriptblock]$Action
  )
  Write-Host "`n==> $Title" -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "$Title ไม่สำเร็จ (exit $LASTEXITCODE)" }
}

if ($UpdateVersion) {
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "ไม่พบ npm" }
  Push-Location $desktopRoot
  try {
    Invoke-Checked "Update BMS POS version เป็น $Version" {
      npm version $Version --no-git-tag-version
    }
  } finally {
    Pop-Location
  }
  Write-Host "`nอัปเดต version แล้ว กรุณา commit ก่อน build:" -ForegroundColor Green
  Write-Host "  git add apps/desktop/package.json apps/desktop/package-lock.json"
  Write-Host "  git commit -m `"build: bump Retail Local to $Version`""
  Write-Host "  pwsh .\deploy\retail-local\build-release.ps1 -Version $Version"
  exit 0
}

$dirty = @(& git -C $repoRoot status --porcelain --untracked-files=normal)
if ($LASTEXITCODE -ne 0) { throw "อ่านสถานะ Git ไม่สำเร็จ" }
if ($dirty.Count -gt 0) {
  throw "Working tree ต้องสะอาดก่อน build เพื่อให้ release.json อ้าง source commit ที่ตรวจสอบได้`n$($dirty -join "`n")"
}

$desktopPackage = Get-Content -LiteralPath $desktopPackagePath -Raw | ConvertFrom-Json
$desktopLock = Get-Content -LiteralPath $desktopLockPath -Raw | ConvertFrom-Json
$lockRoot = $desktopLock.packages.PSObject.Properties[""].Value
if ([string]$desktopPackage.version -ne $Version -or
    [string]$desktopLock.version -ne $Version -or
    [string]$lockRoot.version -ne $Version) {
  throw "POS version ยังไม่ใช่ $Version ให้รัน: pwsh .\deploy\retail-local\build-release.ps1 -Version $Version -UpdateVersion แล้ว commit ก่อน"
}

foreach ($command in @("git", "node", "npm", "docker")) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "ไม่พบ $command" }
}
& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine ยังไม่พร้อม กรุณาเปิด Docker Desktop" }

$drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($repoRoot))
if ($drive.AvailableFreeSpace -lt 20GB) {
  throw "พื้นที่ว่างไม่พอ: ต้องมีอย่างน้อย 20 GB (ปัจจุบัน $([math]::Round($drive.AvailableFreeSpace / 1GB, 1)) GB)"
}

$artifactNames = @(
  "BMS-Retail-Local-$Version.zip",
  "BMS-Retail-Local-Server-POS-$Version-windows-x64.exe",
  "BMS-Retail-Local-Server-$Version-windows-x64.exe",
  "BMS-Retail-Local-POS-$Version-windows-x64.exe",
  "BMS-Retail-Local-POS-$Version-windows-x86-legacy.exe",
  "BMS-Retail-Local-Server-POS-$Version-linux-x64.deb",
  "BMS-Retail-Local-Server-$Version-linux-x64.deb",
  "BMS-Retail-Local-POS-$Version-linux-x64.deb",
  "BMS-Retail-Local-POS-$Version-linux-x64.AppImage"
)
$existing = @($artifactNames | Where-Object { Test-Path -LiteralPath (Join-Path $outputRoot $_) })
if ($existing.Count -gt 0 -and -not $Force) {
  throw "มี artifact version $Version อยู่แล้ว ใช้ -Force เมื่อตั้งใจ build ทับ:`n$($existing -join "`n")"
}

Push-Location $desktopRoot
try {
  Invoke-Checked "Install desktop dependencies" { npm ci }
  if (-not $SkipTests) {
    Invoke-Checked "Test BMS POS" { npm test }
    Invoke-Checked "Lint BMS POS" { npm run lint }
  }
  Invoke-Checked "Build Windows POS x64" { npm run pack:win }
  Invoke-Checked "Build Windows POS x86 Legacy" { npm run pack:win32 }
  Invoke-Checked "Build Linux POS x64 (DEB + AppImage)" { npm run pack:linux }
} finally {
  Pop-Location
}

$packageArgs = @{
  Version = $Version
  OutputDirectory = $outputRoot
}
if ($Force) { $packageArgs.Force = $true }
Write-Host "`n==> Build verified Server ZIP" -ForegroundColor Cyan
& (Join-Path $scriptRoot "package.ps1") @packageArgs
if ($LASTEXITCODE -ne 0) { throw "Build Server ZIP ไม่สำเร็จ" }

Write-Host "`n==> Build Windows installers" -ForegroundColor Cyan
& (Join-Path $scriptRoot "windows-offline\build-offline-exe.ps1") `
  -Version $Version `
  -PackageType all `
  -OutputDirectory $outputRoot
if ($LASTEXITCODE -ne 0) { throw "Build Windows installers ไม่สำเร็จ" }

$linuxPosDeb = Join-Path $desktopRoot "dist\BMS-POS-$Version-amd64.deb"
$linuxPosAppImage = Join-Path $desktopRoot "dist\BMS-POS-$Version-x86_64.AppImage"
$releasePosDeb = Join-Path $outputRoot "BMS-Retail-Local-POS-$Version-linux-x64.deb"
$releasePosAppImage = Join-Path $outputRoot "BMS-Retail-Local-POS-$Version-linux-x64.AppImage"
Copy-Item -LiteralPath $linuxPosDeb -Destination $releasePosDeb -Force
Copy-Item -LiteralPath $linuxPosAppImage -Destination $releasePosAppImage -Force

# Build Linux after Windows. Running both large packagers together can exceed Docker Desktop's
# memory while dpkg-deb and Inno Setup each hold a ~1 GB server payload.
Write-Host "`n==> Build Linux installers" -ForegroundColor Cyan
& (Join-Path $scriptRoot "linux-offline\build-offline-linux.ps1") `
  -Version $Version `
  -OutputDirectory $outputRoot
if ($LASTEXITCODE -ne 0) { throw "Build Linux installers ไม่สำเร็จ" }

$head = (& git -C $repoRoot rev-parse HEAD).Trim()
$zipPath = Join-Path $outputRoot "BMS-Retail-Local-$Version.zip"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $releaseEntry = $archive.Entries | Where-Object { $_.FullName -like "*/release.json" } | Select-Object -First 1
  if (-not $releaseEntry) { throw "Server ZIP ไม่มี release.json" }
  $reader = [IO.StreamReader]::new($releaseEntry.Open())
  try { $release = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
} finally {
  $archive.Dispose()
}
if ([string]$release.version -ne $Version -or [string]$release.sourceCommit -ne $head) {
  throw "Server ZIP version/sourceCommit ไม่ตรงกับ build ปัจจุบัน"
}

$verified = foreach ($name in $artifactNames) {
  $path = Join-Path $outputRoot $name
  $sidecar = "$path.sha256"
  if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or
      -not (Test-Path -LiteralPath $sidecar -PathType Leaf)) {
    throw "ขาด artifact หรือ checksum: $name"
  }
  $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  $expected = ((Get-Content -LiteralPath $sidecar -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
  if ($actual -ne $expected) { throw "SHA-256 ไม่ตรง: $name" }
  [pscustomobject]@{
    File = $name
    SizeMiB = [math]::Round((Get-Item -LiteralPath $path).Length / 1MB, 1)
    SHA256 = $actual
  }
}

foreach ($readmeName in @("README.md", "README-Linux.md")) {
  $readmePath = Join-Path $outputRoot $readmeName
  if (-not (Test-Path -LiteralPath $readmePath -PathType Leaf)) { throw "ขาด $readmeName" }
  if ((Get-Content -LiteralPath $readmePath -Raw) -match '\{\{[^}]+\}\}') {
    throw "$readmeName ยังมี template placeholder"
  }
}

Write-Host "`nBuild สำเร็จ: BMS Retail Local $Version" -ForegroundColor Green
Write-Host "Source commit: $head"
$verified | Format-Table -AutoSize
Write-Host "Output: $outputRoot"
