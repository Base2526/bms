[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [ValidateSet("server", "server-pos", "all")][string]$PackageType = "all",
  [string]$ServerZip,
  [string]$PosInstaller,
  [string]$PosLegacyInstaller,
  [string]$OutputDirectory,
  [string]$InnoCompiler
)

$ErrorActionPreference = "Stop"
if ($Version -notmatch '^[A-Za-z0-9._-]{1,64}$') {
  throw "Version ใช้ได้เฉพาะ A-Z, a-z, 0-9, dot, underscore และ hyphen"
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot "..\..\.."))
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repoRoot "artifacts\retail-local" }
if (-not $ServerZip) { $ServerZip = Join-Path $OutputDirectory "BMS-Retail-Local-$Version.zip" }
if (-not $PosInstaller) { $PosInstaller = Join-Path $repoRoot "apps\desktop\dist\BMS-POS-Setup-$Version-x64.exe" }
if (-not $PosLegacyInstaller) { $PosLegacyInstaller = Join-Path $repoRoot "apps\desktop\dist\BMS-POS-Setup-$Version-ia32.exe" }

$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
$serverZipPath = [IO.Path]::GetFullPath($ServerZip)
$posInstallerPath = [IO.Path]::GetFullPath($PosInstaller)
$posLegacyInstallerPath = [IO.Path]::GetFullPath($PosLegacyInstaller)
$definitionPath = Join-Path $scriptRoot "BMSRetailLocalOffline.iss"
$iconPath = Join-Path $repoRoot "apps\web\public\icons\playstore-512.ico"

if (-not $InnoCompiler) {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"),
    (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe")
  )
  $InnoCompiler = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
    Select-Object -First 1
}

if (-not $InnoCompiler -or -not (Test-Path -LiteralPath $InnoCompiler -PathType Leaf)) {
  throw "ไม่พบ Inno Setup 6 compiler (ISCC.exe)"
}
if (-not (Test-Path -LiteralPath $serverZipPath -PathType Leaf)) {
  throw "ไม่พบ Server ZIP: $serverZipPath"
}
if (-not (Test-Path -LiteralPath "$serverZipPath.sha256" -PathType Leaf)) {
  throw "ไม่พบ checksum sidecar: $serverZipPath.sha256"
}
if ($PackageType -ne "server" -and -not (Test-Path -LiteralPath $posInstallerPath -PathType Leaf)) {
  throw "ไม่พบ POS x64 installer: $posInstallerPath"
}
if ($PackageType -eq "all" -and -not (Test-Path -LiteralPath $posLegacyInstallerPath -PathType Leaf)) {
  throw "ไม่พบ POS x86 Legacy installer: $posLegacyInstallerPath"
}
if (-not (Test-Path -LiteralPath $definitionPath -PathType Leaf)) { throw "ไม่พบ $definitionPath" }
if (-not (Test-Path -LiteralPath $iconPath -PathType Leaf)) { throw "ไม่พบ $iconPath" }

$expectedHash = ((Get-Content -LiteralPath "$serverZipPath.sha256" -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
$actualHash = (Get-FileHash -LiteralPath $serverZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($expectedHash -notmatch '^[a-f0-9]{64}$' -or $actualHash -ne $expectedHash) {
  throw "Server ZIP checksum ไม่ตรง ห้ามสร้าง installer จาก payload ที่อาจเสียหาย"
}

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$stage = Join-Path $tempRoot "bms-retail-local-offline-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $stage | Out-Null

try {
  Write-Host "Extracting verified server payload..." -ForegroundColor Cyan
  Expand-Archive -LiteralPath $serverZipPath -DestinationPath $stage
  $bundleCandidates = @(Get-ChildItem -LiteralPath $stage -Directory)
  if ($bundleCandidates.Count -ne 1) { throw "Server ZIP ต้องมี root directory เดียว" }
  $bundleRoot = $bundleCandidates[0].FullName
  $releasePath = Join-Path $bundleRoot "release.json"
  if (-not (Test-Path -LiteralPath $releasePath -PathType Leaf)) { throw "Server ZIP ไม่มี release.json" }
  $release = Get-Content -LiteralPath $releasePath -Raw | ConvertFrom-Json
  if ([string]$release.version -ne $Version) {
    throw "Server ZIP version '$($release.version)' ไม่ตรงกับ requested version '$Version'"
  }

  $targets = if ($PackageType -eq "all") { @("server", "server-pos") } else { @($PackageType) }
  foreach ($target in $targets) {
    $baseName = if ($target -eq "server") {
      "BMS-Retail-Local-Server-$Version-windows-x64"
    } else {
      "BMS-Retail-Local-Server-POS-$Version-windows-x64"
    }

    $arguments = @(
      "/DBundleRoot=$bundleRoot",
      "/DOutputRoot=$outputRoot",
      "/DProductVersion=$Version",
      "/DOutputBaseFilename=$baseName",
      "/DSetupIconFile=$iconPath"
    )
    if ($target -eq "server-pos") { $arguments += "/DPosInstaller=$posInstallerPath" }
    $arguments += $definitionPath

    Write-Host "Building $baseName.exe..." -ForegroundColor Cyan
    & $InnoCompiler @arguments
    if ($LASTEXITCODE -ne 0) { throw "Inno Setup build ไม่สำเร็จสำหรับ $target" }

    $artifact = Join-Path $outputRoot "$baseName.exe"
    if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) { throw "ไม่พบ artifact: $artifact" }
    $hash = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath "$artifact.sha256" -Value "$hash  $baseName.exe" -Encoding ascii
    Write-Host "Ready: $artifact" -ForegroundColor Green
    Write-Host "SHA-256: $hash"
  }

  if ($PackageType -eq "all") {
    $posArtifacts = @(
      [pscustomobject]@{
        Source = $posInstallerPath
        Name = "BMS-Retail-Local-POS-$Version-windows-x64.exe"
      },
      [pscustomobject]@{
        Source = $posLegacyInstallerPath
        Name = "BMS-Retail-Local-POS-$Version-windows-x86-legacy.exe"
      }
    )
    foreach ($posArtifact in $posArtifacts) {
      $destination = Join-Path $outputRoot $posArtifact.Name
      Copy-Item -LiteralPath $posArtifact.Source -Destination $destination -Force
      $hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
      Set-Content -LiteralPath "$destination.sha256" -Value "$hash  $($posArtifact.Name)" -Encoding ascii
      Write-Host "Ready: $destination" -ForegroundColor Green
      Write-Host "SHA-256: $hash"
    }
  }
} finally {
  if (Test-Path -LiteralPath $stage) {
    $resolvedStage = [IO.Path]::GetFullPath($stage)
    if (-not $resolvedStage.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolvedStage) -notlike "bms-retail-local-offline-*") {
      throw "ปฏิเสธการล้าง temporary directory ที่อยู่นอกขอบเขต"
    }
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
  }
}

