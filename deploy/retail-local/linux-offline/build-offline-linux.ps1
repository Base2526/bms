[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$ServerZip,
  [string]$PosDeb,
  [string]$PosAppImage,
  [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
if ($Version -notmatch '^[A-Za-z0-9._+-]{1,64}$') { throw "Version is invalid" }

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot "..\..\.."))
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repoRoot "artifacts\retail-local" }
if (-not $ServerZip) { $ServerZip = Join-Path $OutputDirectory "BMS-Retail-Local-$Version.zip" }
if (-not $PosDeb) { $PosDeb = Join-Path $OutputDirectory "BMS-Retail-Local-POS-$Version-linux-x64.deb" }
if (-not $PosAppImage) { $PosAppImage = Join-Path $OutputDirectory "BMS-Retail-Local-POS-$Version-linux-x64.AppImage" }

$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
$serverZipPath = [IO.Path]::GetFullPath($ServerZip)
$posDebPath = [IO.Path]::GetFullPath($PosDeb)
$posAppImagePath = [IO.Path]::GetFullPath($PosAppImage)

foreach ($path in @($serverZipPath, "$serverZipPath.sha256", $posDebPath, $posAppImagePath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "File was not found: $path" }
}
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Linux engine is not ready" }

$expectedZipHash = ((Get-Content -LiteralPath "$serverZipPath.sha256" -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
$actualZipHash = (Get-FileHash -LiteralPath $serverZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($expectedZipHash -notmatch '^[a-f0-9]{64}$' -or $expectedZipHash -ne $actualZipHash) {
  throw "Server ZIP checksum mismatch"
}

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$stage = Join-Path $tempRoot "bms-retail-local-linux-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $stage | Out-Null

try {
  Write-Host "Extracting verified server payload..." -ForegroundColor Cyan
  & tar -xf $serverZipPath -C $stage
  if ($LASTEXITCODE -ne 0) { throw "Failed to extract the Server ZIP" }
  $bundleCandidates = @(Get-ChildItem -LiteralPath $stage -Directory)
  if ($bundleCandidates.Count -ne 1) { throw "Server ZIP must contain exactly one root directory" }
  $bundleRoot = $bundleCandidates[0].FullName
  $release = Get-Content -LiteralPath (Join-Path $bundleRoot "release.json") -Raw | ConvertFrom-Json
  if ([string]$release.version -ne $Version) { throw "Version in release.json does not match $Version" }
  $imagePath = Join-Path (Join-Path $bundleRoot "images") ([string]$release.imageArchive)
  if (-not (Test-Path -LiteralPath $imagePath -PathType Leaf)) { throw "Image archive was not found" }
  $imageHash = (Get-FileHash -LiteralPath $imagePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($imageHash -ne ([string]$release.imageSha256).ToLowerInvariant()) { throw "Docker image checksum mismatch" }

  # Git may materialize tracked shell files as CRLF on a Windows build host. Execute and package a
  # normalized temporary copy so the resulting DEB remains runnable on Linux regardless of the
  # developer's core.autocrlf setting.
  $linuxPackageSource = Join-Path $stage "linux-package-source"
  New-Item -ItemType Directory -Path $linuxPackageSource | Out-Null
  $linuxPackageFiles = @(
    "build-debs.sh", "common.sh", "bms-retail-local-setup", "bms-retail-local-start",
    "bms-retail-local-stop", "bms-retail-local-status", "bms-retail-local-doctor",
    "bms-retail-local-backup", "bms-retail-local.service"
  )
  $utf8NoBom = [Text.UTF8Encoding]::new($false)
  foreach ($name in $linuxPackageFiles) {
    $source = Join-Path $scriptRoot $name
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing Linux package file: $name" }
    $normalizedText = [IO.File]::ReadAllText($source).Replace("`r`n", "`n").Replace("`r", "`n")
    [IO.File]::WriteAllText((Join-Path $linuxPackageSource $name), $normalizedText, $utf8NoBom)
  }

  $linuxPackageSourceMount = $linuxPackageSource -replace '\\','/'
  $bundleMount = $bundleRoot -replace '\\','/'
  $posMount = $posDebPath -replace '\\','/'
  $outputMount = $outputRoot -replace '\\','/'
  docker run --rm `
    -v "${linuxPackageSourceMount}:/source/deploy/retail-local/linux-offline:ro" `
    -v "${bundleMount}:/bundle:ro" `
    -v "${posMount}:/input/BMS-POS.deb:ro" `
    -v "${outputMount}:/out" `
    ubuntu:24.04 bash /source/deploy/retail-local/linux-offline/build-debs.sh `
      $Version /bundle /input/BMS-POS.deb /out
  if ($LASTEXITCODE -ne 0) { throw "Failed to create the Linux DEB" }

  $artifacts = @(
    "BMS-Retail-Local-Server-POS-$Version-linux-x64.deb",
    "BMS-Retail-Local-Server-$Version-linux-x64.deb",
    "BMS-Retail-Local-POS-$Version-linux-x64.deb",
    "BMS-Retail-Local-POS-$Version-linux-x64.AppImage"
  )
  foreach ($name in $artifacts) {
    $artifact = Join-Path $outputRoot $name
    $hash = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath "$artifact.sha256" -Value "$hash  $name" -Encoding ascii
    Write-Host "Ready: $artifact" -ForegroundColor Green
    Write-Host "SHA-256: $hash"
  }

  $template = Get-Content -LiteralPath (Join-Path $scriptRoot "README.template.md") -Raw
  $readme = $template.Replace("{{VERSION}}", $Version)
  foreach ($item in @{
    "{{SERVER_POS_SHA256}}" = "BMS-Retail-Local-Server-POS-$Version-linux-x64.deb"
    "{{SERVER_SHA256}}" = "BMS-Retail-Local-Server-$Version-linux-x64.deb"
    "{{POS_DEB_SHA256}}" = "BMS-Retail-Local-POS-$Version-linux-x64.deb"
    "{{POS_APPIMAGE_SHA256}}" = "BMS-Retail-Local-POS-$Version-linux-x64.AppImage"
  }.GetEnumerator()) {
    $hash = (Get-FileHash -LiteralPath (Join-Path $outputRoot $item.Value) -Algorithm SHA256).Hash.ToLowerInvariant()
    $readme = $readme.Replace($item.Key, $hash)
  }
  Set-Content -LiteralPath (Join-Path $outputRoot "README-Linux.md") -Value $readme -Encoding utf8NoBOM
  Write-Host "Ready: $(Join-Path $outputRoot 'README-Linux.md')" -ForegroundColor Green
} finally {
  if (Test-Path -LiteralPath $stage) {
    $resolvedStage = [IO.Path]::GetFullPath($stage)
    if (-not $resolvedStage.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolvedStage) -notlike "bms-retail-local-linux-*") {
      throw "Refusing to clean up a temporary directory outside the allowed scope"
    }
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
  }
}
