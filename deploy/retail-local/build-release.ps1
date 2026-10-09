[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [ValidateSet("Auto", "WindowsLinux", "MacOS")][string]$Target = "Auto",
  [ValidateSet("Online", "Offline")][string]$Distribution = "Online",
  [string]$Keyring,
  [string]$ReleaseBaseUri = "https://releases.jachoei.com/retail-local",
  [string]$WindowsManifestUri,
  [string]$WindowsX86ManifestUri,
  [string]$LinuxManifestUri,
  [string]$MacArm64ManifestUri,
  [string]$MacX64ManifestUri,
  [string]$ActivationUri = "",
  [string]$Architecture = "x64",
  [string]$InnoCompiler,
  [string]$WslDistribution = "Ubuntu",
  [switch]$UpdateVersion,
  [switch]$AllowOfflineRecovery,
  [switch]$AllowTestEndpoints,
  [switch]$Force,
  [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
  throw "Version must be a semantic version, such as 0.2.13 or 0.2.13-rc.1"
}
if ($PSVersionTable.PSVersion.Major -lt 7) {
  throw "Run this script with PowerShell 7: pwsh"
}
if ($Distribution -eq "Offline" -and -not $AllowOfflineRecovery) {
  throw "Offline recovery is restricted: normal builds must use Distribution Online. Only when the user explicitly requests offline, specify both -Distribution Offline -AllowOfflineRecovery"
}
if ($AllowOfflineRecovery -and $Distribution -ne "Offline") {
  throw "-AllowOfflineRecovery requires -Distribution Offline"
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot "..\.."))
$desktopRoot = Join-Path $repoRoot "apps\desktop"
$desktopPackagePath = Join-Path $desktopRoot "package.json"
$desktopLockPath = Join-Path $desktopRoot "package-lock.json"
$outputRoot = Join-Path $repoRoot "artifacts\retail-local"

if ($Distribution -eq "Online") {
  . (Join-Path $scriptRoot "release-urls.ps1")
  $releaseUrls = Get-RetailLocalReleaseUrls -Version $Version -BaseUri $ReleaseBaseUri
  foreach ($name in $releaseUrls.Keys) {
    if ([string]::IsNullOrWhiteSpace((Get-Variable -Name $name -ValueOnly))) {
      Set-Variable -Name $name -Value $releaseUrls[$name]
    }
  }
}

if ($Target -eq "Auto") {
  if ($IsWindows) {
    $Target = "WindowsLinux"
  } elseif ($IsMacOS) {
    $Target = "MacOS"
  } else {
    throw "Auto build supports only Windows and macOS"
  }
}
if ($Target -eq "WindowsLinux" -and -not $IsWindows) {
  throw "Target WindowsLinux must be built on Windows"
}
if ($Target -eq "MacOS") {
  if (-not $IsMacOS) { throw "Target MacOS must be built on macOS" }
  $machineArchitecture = (& uname -m).Trim()
  if ($LASTEXITCODE -ne 0 -or $machineArchitecture -notin @("arm64", "x86_64")) {
    throw "Retail Local Server for macOS must be built on an arm64 or x86_64 Mac"
  }
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][scriptblock]$Action
  )
  Write-Host "`n==> $Title" -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "$Title failed (exit $LASTEXITCODE)" }
}

function Assert-HttpsReleaseUri {
  param([Parameter(Mandatory = $true)][string]$Name, [string]$Value, [switch]$AllowEmpty)
  if ($AllowEmpty -and [string]::IsNullOrWhiteSpace($Value)) { return }
  $parsed = $null
  if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$parsed) -or
      $parsed.Scheme -ne "https" -or -not [string]::IsNullOrEmpty($parsed.UserInfo)) {
    throw "$Name must be an HTTPS URL without credentials"
  }
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
cp -a /source/apps/desktop/src /source/apps/desktop/renderer /source/apps/desktop/scripts /work/apps/desktop/
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
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm was not found" }
  Push-Location $desktopRoot
  try {
    Invoke-Checked "Update BMS POS version to $Version" {
      npm version $Version --no-git-tag-version
    }
  } finally {
    Pop-Location
  }
  Write-Host "`nVersion updated. Please commit before building:" -ForegroundColor Green
  Write-Host "  git add apps/desktop/package.json apps/desktop/package-lock.json"
  Write-Host "  git commit -m `"build: bump Retail Local to $Version`""
  Write-Host "  pwsh .\deploy\retail-local\build-release.ps1 -Version $Version"
  exit 0
}

$dirty = @(& git -C $repoRoot status --porcelain --untracked-files=normal)
if ($LASTEXITCODE -ne 0) { throw "Failed to read Git status" }
if ($dirty.Count -gt 0) {
  throw "The working tree must be clean before building so release.json references a verifiable source commit`n$($dirty -join "`n")"
}

$desktopPackage = Get-Content -LiteralPath $desktopPackagePath -Raw | ConvertFrom-Json
$desktopLock = Get-Content -LiteralPath $desktopLockPath -Raw | ConvertFrom-Json -AsHashtable
$lockRoot = $desktopLock["packages"][""]
if ([string]$desktopPackage.version -ne $Version -or
    [string]$desktopLock["version"] -ne $Version -or
    [string]$lockRoot["version"] -ne $Version) {
  throw "POS version is not $Version. Run: pwsh .\deploy\retail-local\build-release.ps1 -Version $Version -UpdateVersion, then commit before building"
}

if ($Distribution -eq "Online") {
  Write-Host "Distribution: Online bootstrap (downloads the signed payload during initial installation)" -ForegroundColor Cyan
  $onlineRequired = if ($Target -eq "MacOS") {
    @(
      @{ Name = "Keyring"; Value = $Keyring },
      @{ Name = "MacArm64ManifestUri"; Value = $MacArm64ManifestUri },
      @{ Name = "MacX64ManifestUri"; Value = $MacX64ManifestUri }
    )
  } else {
    @(
      @{ Name = "Keyring"; Value = $Keyring },
      @{ Name = "WindowsManifestUri"; Value = $WindowsManifestUri },
      @{ Name = "WindowsX86ManifestUri"; Value = $WindowsX86ManifestUri },
      @{ Name = "LinuxManifestUri"; Value = $LinuxManifestUri }
    )
  }
  foreach ($required in $onlineRequired) {
    if ([string]::IsNullOrWhiteSpace([string]$required.Value)) {
      throw "Distribution Online requires -$($required.Name)"
    }
  }
  if ($Target -eq "MacOS") {
    Assert-HttpsReleaseUri "MacArm64ManifestUri" $MacArm64ManifestUri
    Assert-HttpsReleaseUri "MacX64ManifestUri" $MacX64ManifestUri
    Assert-HttpsReleaseUri "ActivationUri" $ActivationUri -AllowEmpty
    $macKeyring = [IO.Path]::GetFullPath($Keyring)
    if (-not (Test-Path -LiteralPath $macKeyring -PathType Leaf)) {
      throw "Public keyring was not found: $macKeyring"
    }
    $macKeyringText = Get-Content -LiteralPath $macKeyring -Raw
    if ($macKeyringText -notmatch 'BEGIN PUBLIC KEY' -or $macKeyringText -match 'PRIVATE KEY') {
      throw "The keyring must contain public keys and must not contain private keys"
    }
    foreach ($command in @("bash", "git", "go")) {
      if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Command was not found: $command" }
    }
    New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
    $macServerBuilder = Join-Path $scriptRoot "managed-runtime/macos/build-bootstrap-pkg.sh"
    $macPosBuilder = Join-Path $scriptRoot "managed-runtime/macos/build-pos-bootstrap-dmg.sh"
    $manifestByArchitecture = @{
      arm64 = $MacArm64ManifestUri
      x64 = $MacX64ManifestUri
    }
    foreach ($macArchitecture in @("arm64", "x64")) {
      $commonBuilderArgs = @(
        "--version", $Version,
        "--architecture", $macArchitecture,
        "--manifest-url", $manifestByArchitecture[$macArchitecture],
        "--keyring", $macKeyring,
        "--output-dir", $outputRoot
      )
      $posBuilderArgs = @($macPosBuilder) + $commonBuilderArgs
      if (-not [string]::IsNullOrWhiteSpace($ActivationUri)) {
        $posBuilderArgs += @("--control-url", $ActivationUri)
      }
      if ($AllowTestEndpoints) { $posBuilderArgs += "--allow-test-endpoints" }
      if ($Force) { $posBuilderArgs += "--force" }
      if ($SkipTests) { $posBuilderArgs += "--skip-tests" }
      Invoke-Checked "Build macOS $macArchitecture POS online bootstrap" {
        & bash @posBuilderArgs
      }

      $builderArgs = @($macServerBuilder) + $commonBuilderArgs
      if (-not [string]::IsNullOrWhiteSpace($ActivationUri)) {
        $builderArgs += @("--activation-url", $ActivationUri)
      }
      if ($AllowTestEndpoints) { $builderArgs += "--allow-test-endpoints" }
      if ($Force) { $builderArgs += "--force" }
      if ($SkipTests) { $builderArgs += "--skip-tests" }
      Invoke-Checked "Build macOS $macArchitecture Server + POS online bootstrap" {
        & bash @builderArgs
      }
    }
    exit 0
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
  if ($AllowTestEndpoints) { $onlineArgs.AllowTestEndpoints = $true }
  if ($SkipTests) { $onlineArgs.SkipTests = $true }
  & (Join-Path $scriptRoot "build-online-bootstrap.ps1") @onlineArgs
  if ($LASTEXITCODE -ne 0) { throw "Failed to build the online bootstrap" }
  $posOnlineArgs = @{
    Version = $Version
    Keyring = $Keyring
    WindowsManifestUri = $WindowsManifestUri
    WindowsX86ManifestUri = $WindowsX86ManifestUri
    LinuxManifestUri = $LinuxManifestUri
    ControlUri = $ActivationUri
    OutputDirectory = $outputRoot
    WslDistribution = $WslDistribution
  }
  if ($InnoCompiler) { $posOnlineArgs.InnoCompiler = $InnoCompiler }
  if ($Force) { $posOnlineArgs.Force = $true }
  if ($AllowTestEndpoints) { $posOnlineArgs.AllowTestEndpoints = $true }
  if ($SkipTests) { $posOnlineArgs.SkipTests = $true }
  & (Join-Path $scriptRoot "build-online-pos-bootstrap.ps1") @posOnlineArgs
  if ($LASTEXITCODE -ne 0) { throw "Failed to build the POS online bootstrap" }
  exit 0
}

Write-Warning "Distribution: OFFLINE RECOVERY as explicitly requested; artifacts will embed the full payload and will be large"

$requiredCommands = @("git", "node", "npm", "docker")
if ($Target -eq "MacOS") { $requiredCommands += @("bash", "go") }
foreach ($command in $requiredCommands) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Command was not found: $command" }
}
& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not ready. Please start Docker Desktop" }

$drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($repoRoot))
$minimumBuildSpace = if ($Target -eq "MacOS") { 40GB } else { 20GB }
if ($drive.AvailableFreeSpace -lt $minimumBuildSpace) {
  throw "Insufficient free space: at least $([math]::Round($minimumBuildSpace / 1GB)) GB is required (currently $([math]::Round($drive.AvailableFreeSpace / 1GB, 1)) GB)"
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
  throw "Artifacts for version $Version already exist. Use -Force to rebuild and overwrite them intentionally:`n$($existing -join "`n")"
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
      throw "macOS POS was not found after the build: $source"
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
  if ($LASTEXITCODE -ne 0) { throw "Failed to build the Server ZIP" }

  Write-Host "`n==> Build Windows installers" -ForegroundColor Cyan
  & (Join-Path $scriptRoot "windows-offline\build-offline-exe.ps1") `
    -Version $Version `
    -PackageType all `
    -OutputDirectory $outputRoot
  if ($LASTEXITCODE -ne 0) { throw "Failed to build Windows installers" }

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
  if ($LASTEXITCODE -ne 0) { throw "Failed to build Linux installers" }
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
        throw "macOS $architecture $packageType metadata version/sourceCommit does not match the current build"
      }
    }
  }
} else {
  $zipPath = Join-Path $outputRoot "BMS-Retail-Local-$Version.zip"
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    $releaseEntry = $archive.Entries | Where-Object { $_.FullName -like "*/release.json" } | Select-Object -First 1
    if (-not $releaseEntry) { throw "Server ZIP does not contain release.json" }
    $reader = [IO.StreamReader]::new($releaseEntry.Open())
    try { $release = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
  } finally {
    $archive.Dispose()
  }
  if ([string]$release.version -ne $Version -or [string]$release.sourceCommit -ne $head) {
    throw "Server ZIP version/sourceCommit does not match the current build"
  }
}

$verified = foreach ($name in $artifactNames) {
  $path = Join-Path $outputRoot $name
  $sidecar = "$path.sha256"
  if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or
      -not (Test-Path -LiteralPath $sidecar -PathType Leaf)) {
    throw "Missing artifact or checksum: $name"
  }
  $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  $expected = ((Get-Content -LiteralPath $sidecar -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
  if ($actual -ne $expected) { throw "SHA-256 mismatch: $name" }
  [pscustomobject]@{
    File = $name
    SizeMiB = [math]::Round((Get-Item -LiteralPath $path).Length / 1MB, 1)
    SHA256 = $actual
  }
}

if ($Target -eq "WindowsLinux") {
  foreach ($readmeName in @("README.md", "README-Linux.md")) {
    $readmePath = Join-Path $outputRoot $readmeName
    if (-not (Test-Path -LiteralPath $readmePath -PathType Leaf)) { throw "Missing $readmeName" }
    if ((Get-Content -LiteralPath $readmePath -Raw) -match '\{\{[^}]+\}\}') {
      throw "$readmeName still contains template placeholders"
    }
  }
}

Write-Host "`nBuild completed: BMS Retail Local $Version ($Target)" -ForegroundColor Green
Write-Host "Source commit: $head"
$verified | Format-Table -AutoSize
Write-Host "Output: $outputRoot"
