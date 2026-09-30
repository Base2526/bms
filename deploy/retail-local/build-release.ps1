[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [ValidateSet("Auto", "WindowsLinux", "MacOS")][string]$Target = "Auto",
  [ValidateSet("Online", "Offline")][string]$Distribution = "Online",
  [string]$Keyring,
  [string]$WindowsManifestUri,
  [string]$LinuxManifestUri,
  [string]$ActivationUri = "",
  [string]$Architecture = "x64",
  [string]$InnoCompiler,
  [string]$WslDistribution = "Ubuntu",
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

if ($Target -eq "Auto") {
  if ($IsWindows) {
    $Target = "WindowsLinux"
  } elseif ($IsMacOS) {
    $Target = "MacOS"
  } else {
    throw "Auto build รองรับ Windows และ macOS เท่านั้น"
  }
}
if ($Target -eq "WindowsLinux" -and -not $IsWindows) {
  throw "Target WindowsLinux ต้อง build บน Windows"
}
if ($Target -eq "MacOS") {
  if (-not $IsMacOS) { throw "Target MacOS ต้อง build บน macOS" }
  $machineArchitecture = (& uname -m).Trim()
  if ($LASTEXITCODE -ne 0 -or $machineArchitecture -notin @("arm64", "x86_64")) {
    throw "Retail Local Server สำหรับ macOS ต้อง build บน Mac arm64 หรือ x86_64"
  }
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][scriptblock]$Action
  )
  Write-Host "`n==> $Title" -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "$Title ไม่สำเร็จ (exit $LASTEXITCODE)" }
}

function Invoke-LinuxDesktopBuild {
  # electron-builder creates symbolic links while assembling AppImage. Native Windows Node cannot
  # create those links reliably, so build the Linux desktop artifacts in a pinned Linux container
  # and copy only the two finished regular files back to the host.
  $builderImage = "electronuserland/builder@sha256:b76a82a6c6a8a1dea1abbc93e394f54316744824b64e6a50d959f1e3ba8951a9"
  $desktopDist = Join-Path $desktopRoot "dist"
  New-Item -ItemType Directory -Force -Path $desktopDist | Out-Null
  $repoMount = $repoRoot -replace '\\','/'
  $outputMount = $desktopDist -replace '\\','/'
  $buildCommand = @'
set -euo pipefail
mkdir -p /work/apps/desktop /work/apps/web/public/icons
cp /source/apps/desktop/package.json /source/apps/desktop/package-lock.json /work/apps/desktop/
cp -a /source/apps/desktop/src /source/apps/desktop/renderer /work/apps/desktop/
cp /source/apps/web/public/icons/playstore-512.png /work/apps/web/public/icons/
cd /work/apps/desktop
npm ci
npm run pack:linux
cp "dist/BMS-POS-${BMS_RELEASE_VERSION}-amd64.deb" \
  "dist/BMS-POS-${BMS_RELEASE_VERSION}-x86_64.AppImage" /out/
'@
  $buildCommand = $buildCommand.Replace("`r`n", "`n").Replace("`r", "`n")
  & docker run --rm `
    -e "BMS_RELEASE_VERSION=$Version" `
    -v "${repoMount}:/source:ro" `
    -v "${outputMount}:/out" `
    $builderImage bash -lc $buildCommand
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
$desktopLock = Get-Content -LiteralPath $desktopLockPath -Raw | ConvertFrom-Json -AsHashtable
$lockRoot = $desktopLock["packages"][""]
if ([string]$desktopPackage.version -ne $Version -or
    [string]$desktopLock["version"] -ne $Version -or
    [string]$lockRoot["version"] -ne $Version) {
  throw "POS version ยังไม่ใช่ $Version ให้รัน: pwsh .\deploy\retail-local\build-release.ps1 -Version $Version -UpdateVersion แล้ว commit ก่อน"
}

if ($Distribution -eq "Online") {
  if ($Target -ne "WindowsLinux") {
    throw "Online bootstrap หลักรองรับ Windows และ Ubuntu x64; macOS ยังเป็น offline technical-pilot package"
  }
  foreach ($required in @(
      @{ Name = "Keyring"; Value = $Keyring },
      @{ Name = "WindowsManifestUri"; Value = $WindowsManifestUri },
      @{ Name = "LinuxManifestUri"; Value = $LinuxManifestUri }
    )) {
    if ([string]::IsNullOrWhiteSpace([string]$required.Value)) {
      throw "Distribution Online ต้องระบุ -$($required.Name)"
    }
  }
  $onlineArgs = @{
    Version = $Version
    Keyring = $Keyring
    WindowsManifestUri = $WindowsManifestUri
    LinuxManifestUri = $LinuxManifestUri
    ActivationUri = $ActivationUri
    Target = "All"
    Architecture = $Architecture
    OutputDirectory = $outputRoot
    WslDistribution = $WslDistribution
  }
  if ($InnoCompiler) { $onlineArgs.InnoCompiler = $InnoCompiler }
  if ($Force) { $onlineArgs.Force = $true }
  if ($SkipTests) { $onlineArgs.SkipTests = $true }
  & (Join-Path $scriptRoot "build-online-bootstrap.ps1") @onlineArgs
  if ($LASTEXITCODE -ne 0) { throw "Build online bootstrap ไม่สำเร็จ" }
  exit 0
}

$requiredCommands = @("git", "node", "npm", "docker")
if ($Target -eq "MacOS") { $requiredCommands += @("bash", "go") }
foreach ($command in $requiredCommands) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "ไม่พบ $command" }
}
& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine ยังไม่พร้อม กรุณาเปิด Docker Desktop" }

$drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($repoRoot))
$minimumBuildSpace = if ($Target -eq "MacOS") { 40GB } else { 20GB }
if ($drive.AvailableFreeSpace -lt $minimumBuildSpace) {
  throw "พื้นที่ว่างไม่พอ: ต้องมีอย่างน้อย $([math]::Round($minimumBuildSpace / 1GB)) GB (ปัจจุบัน $([math]::Round($drive.AvailableFreeSpace / 1GB, 1)) GB)"
}

$artifactNames = if ($Target -eq "MacOS") {
  @(
    "BMS-Retail-Local-Server-POS-$Version-arm64.pkg",
    "BMS-Retail-Local-Server-POS-$Version-x64.pkg",
    "BMS-Retail-Local-Server-$Version-arm64.pkg",
    "BMS-Retail-Local-Server-$Version-x64.pkg",
    "BMS-Retail-Local-POS-$Version-macos-arm64.dmg",
    "BMS-Retail-Local-POS-$Version-macos-x64.dmg"
  )
} else {
  @(
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
}
$existing = @($artifactNames | Where-Object { Test-Path -LiteralPath (Join-Path $outputRoot $_) })
if ($existing.Count -gt 0 -and -not $Force) {
  throw "มี artifact version $Version อยู่แล้ว ใช้ -Force เมื่อตั้งใจ build ทับ:`n$($existing -join "`n")"
}
if ($Target -eq "MacOS" -and $Force) {
  foreach ($name in $artifactNames) {
    foreach ($suffix in @("", ".sha256", ".json")) {
      $replacePath = Join-Path $outputRoot "$name$suffix"
      if (Test-Path -LiteralPath $replacePath -PathType Leaf) {
        Remove-Item -LiteralPath $replacePath -Force
      }
    }
  }
}

Push-Location $desktopRoot
try {
  Invoke-Checked "Install desktop dependencies" { npm ci }
  if (-not $SkipTests) {
    Invoke-Checked "Test BMS POS" { npm test }
    Invoke-Checked "Lint BMS POS" { npm run lint }
  }
  if ($Target -eq "MacOS") {
    Invoke-Checked "Build macOS POS (Apple Silicon + Intel)" { npm run pack:mac }
  } else {
    Invoke-Checked "Build Windows POS x64" { npm run pack:win }
    Invoke-Checked "Build Windows POS x86 Legacy" { npm run pack:win32 }
    Invoke-Checked "Build Linux POS x64 (DEB + AppImage)" { Invoke-LinuxDesktopBuild }
  }
} finally {
  Pop-Location
}

if ($Target -eq "MacOS") {
  $macBuilder = Join-Path $scriptRoot "managed-runtime/macos/build-pkg.sh"
  foreach ($architecture in @("arm64", "x64")) {
    Invoke-Checked "Build macOS Server ($architecture)" {
      & bash $macBuilder --version $Version --architecture $architecture --package-type server --output-dir $outputRoot
    }
    Invoke-Checked "Build macOS Server + POS ($architecture)" {
      & bash $macBuilder --version $Version --architecture $architecture --package-type server-pos --reuse-images --output-dir $outputRoot
    }
  }

  $macPosSources = @{
    "arm64" = Join-Path $desktopRoot "dist/BMS-POS-$Version-arm64.dmg"
    "x64" = Join-Path $desktopRoot "dist/BMS-POS-$Version-x64.dmg"
  }
  foreach ($architecture in $macPosSources.Keys) {
    $source = $macPosSources[$architecture]
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
      throw "ไม่พบ macOS POS หลัง build: $source"
    }
    $destination = Join-Path $outputRoot "BMS-Retail-Local-POS-$Version-macos-$architecture.dmg"
    Copy-Item -LiteralPath $source -Destination $destination -Force
    $sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath "$destination.sha256" -Value "$sha256  $([IO.Path]::GetFileName($destination))" -Encoding utf8NoBOM
  }
} else {
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
}

$head = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($Target -eq "MacOS") {
  foreach ($architecture in @("arm64", "x64")) {
    foreach ($packageType in @("server", "server-pos")) {
      $packageName = if ($packageType -eq "server") {
        "BMS-Retail-Local-Server-$Version-$architecture.pkg"
      } else {
        "BMS-Retail-Local-Server-POS-$Version-$architecture.pkg"
      }
      $metadata = Get-Content -LiteralPath (Join-Path $outputRoot "$packageName.json") -Raw | ConvertFrom-Json
      if ([string]$metadata.version -ne $Version -or
          [string]$metadata.platform -ne "macos-$architecture" -or
          [string]$metadata.packageType -ne $packageType -or
          [string]$metadata.sourceCommit -ne $head) {
        throw "macOS $architecture $packageType metadata version/sourceCommit ไม่ตรงกับ build ปัจจุบัน"
      }
    }
  }
} else {
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

if ($Target -eq "WindowsLinux") {
  foreach ($readmeName in @("README.md", "README-Linux.md")) {
    $readmePath = Join-Path $outputRoot $readmeName
    if (-not (Test-Path -LiteralPath $readmePath -PathType Leaf)) { throw "ขาด $readmeName" }
    if ((Get-Content -LiteralPath $readmePath -Raw) -match '\{\{[^}]+\}\}') {
      throw "$readmeName ยังมี template placeholder"
    }
  }
}

Write-Host "`nBuild สำเร็จ: BMS Retail Local $Version ($Target)" -ForegroundColor Green
Write-Host "Source commit: $head"
$verified | Format-Table -AutoSize
Write-Host "Output: $outputRoot"
