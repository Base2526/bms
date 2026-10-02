[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$Keyring,
  [string]$ReleaseBaseUri = "https://releases.jachoei.com/retail-local",
  [string]$WindowsManifestUri,
  [string]$LinuxManifestUri,
  [string]$ActivationUri = "",
  [ValidateSet("All", "Windows", "Linux")][string]$Target = "All",
  [ValidateSet("server", "server-pos", "all")][string]$PackageType = "all",
  [string]$Architecture = "x64",
  [string]$OutputDirectory,
  [string]$InnoCompiler,
  [string]$WslDistribution = "Ubuntu",
  [switch]$AllowTestEndpoints,
  [switch]$Force,
  [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($PSVersionTable.PSVersion.Major -lt 7) {
  throw "ต้องรันด้วย PowerShell 7: pwsh"
}
if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
  throw "Version ต้องเป็น Semantic Version เช่น 0.2.13 หรือ 0.2.13-rc.1"
}

function Assert-HttpsUri([string]$Name, [string]$Value, [bool]$AllowEmpty = $false) {
  if ($AllowEmpty -and [string]::IsNullOrWhiteSpace($Value)) { return }
  $parsed = $null
  if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$parsed) -or
      $parsed.Scheme -ne "https" -or -not [string]::IsNullOrEmpty($parsed.UserInfo)) {
    throw "$Name ต้องเป็น HTTPS URL ที่ไม่มี credential"
  }
}

function Test-PlaceholderUri([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return $false }
  $parsed = [Uri]$Value
  return $parsed.Host -eq "localhost" -or
    $parsed.Host -eq "127.0.0.1" -or
    $parsed.Host -eq "::1" -or
    $parsed.Host -eq "example.com" -or
    $parsed.Host.EndsWith(".example.com", [StringComparison]::OrdinalIgnoreCase) -or
    $parsed.Host.EndsWith(".example.invalid", [StringComparison]::OrdinalIgnoreCase) -or
    $parsed.Host.EndsWith(".invalid", [StringComparison]::OrdinalIgnoreCase)
}

function Invoke-Checked([string]$Title, [scriptblock]$Action) {
  Write-Host "`n==> $Title" -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "$Title ไม่สำเร็จ (exit $LASTEXITCODE)" }
}

function ConvertTo-WslPath([string]$WindowsPath) {
  $portablePath = $WindowsPath.Replace('\', '/')
  $converted = & wsl.exe -d $WslDistribution -- wslpath -a -u $portablePath 2>&1
  if ($LASTEXITCODE -ne 0 -or -not $converted) {
    throw "แปลง path สำหรับ WSL ไม่สำเร็จ: $WindowsPath ($converted)"
  }
  return ([string]$converted).Trim()
}

function Write-ChecksumAndMetadata(
  [string]$Path,
  [string]$Platform,
  [string]$PackageType,
  [string]$ManifestUri,
  [string]$SourceCommit
) {
  $item = Get-Item -LiteralPath $Path
  if ($item.Length -gt 25MB) {
    throw "online bootstrap ใหญ่เกิน 25 MiB: $($item.FullName) ($([math]::Round($item.Length / 1MB, 2)) MiB)"
  }
  $sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText(
    "$Path.sha256",
    "$sha256  $($item.Name)`n",
    [Text.UTF8Encoding]::new($false)
  )
  [ordered]@{
    artifact = $item.FullName
    version = $Version
    sourceCommit = $SourceCommit
    platform = $Platform
    architecture = "x64"
    packageType = $PackageType
    distribution = "online-bootstrap"
    testBuild = $testBuild
    manifestUri = $ManifestUri
    sizeBytes = $item.Length
    sha256 = $sha256
    signed = $false
  } | ConvertTo-Json | ForEach-Object {
    [IO.File]::WriteAllText("$Path.json", "$_`n", [Text.UTF8Encoding]::new($false))
  }
  [pscustomobject]@{
    File = $item.Name
    SizeMiB = [math]::Round($item.Length / 1MB, 2)
    SHA256 = $sha256
  }
}

. (Join-Path $PSScriptRoot "release-urls.ps1")
$releaseUrls = Get-RetailLocalReleaseUrls -Version $Version -BaseUri $ReleaseBaseUri
if ([string]::IsNullOrWhiteSpace($WindowsManifestUri)) { $WindowsManifestUri = $releaseUrls.WindowsManifestUri }
if ([string]::IsNullOrWhiteSpace($LinuxManifestUri)) { $LinuxManifestUri = $releaseUrls.LinuxManifestUri }
Assert-HttpsUri "WindowsManifestUri" $WindowsManifestUri
Assert-HttpsUri "LinuxManifestUri" $LinuxManifestUri
Assert-HttpsUri "ActivationUri" $ActivationUri $true
$testBuild = (Test-PlaceholderUri $WindowsManifestUri) -or
  (Test-PlaceholderUri $LinuxManifestUri) -or
  (Test-PlaceholderUri $ActivationUri)
if ($testBuild -and -not $AllowTestEndpoints) {
  throw "ปฏิเสธ example/invalid endpoint: production installer ต้องใช้ release channel จริง; ใช้ -AllowTestEndpoints ได้เฉพาะ smoke test"
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot "..\.."))
$agentRoot = Join-Path $repoRoot "apps\retail-local-agent"
$managedRoot = Join-Path $scriptRoot "managed-runtime"
$outputRoot = if ($OutputDirectory) {
  [IO.Path]::GetFullPath($OutputDirectory)
} else {
  Join-Path $repoRoot "artifacts\retail-local"
}
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

$keyringPath = [IO.Path]::GetFullPath($Keyring)
if (-not (Test-Path -LiteralPath $keyringPath -PathType Leaf)) {
  throw "ไม่พบ public keyring: $keyringPath"
}
$keyringText = Get-Content -LiteralPath $keyringPath -Raw
if ($keyringText -match 'PRIVATE KEY') {
  throw "public keyring ต้องไม่มี private key"
}
$keyringJson = $keyringText | ConvertFrom-Json -AsHashtable
if ([int]$keyringJson.formatVersion -ne 1 -or
    -not $keyringJson.ContainsKey("keys") -or
    $keyringJson.keys.Count -lt 1) {
  throw "public keyring ต้องเป็น formatVersion 1 และมี trusted public key อย่างน้อยหนึ่ง key"
}
foreach ($entry in $keyringJson.keys.GetEnumerator()) {
  if ([string]$entry.Value -notmatch 'BEGIN PUBLIC KEY') {
    throw "keyring entry '$($entry.Key)' ไม่ใช่ PEM public key"
  }
}

$normalizedArchitecture = $Architecture.Trim().ToLowerInvariant()
if ($normalizedArchitecture -ne "x64") {
  throw "Retail Local Server build รองรับเฉพาะ x64 (ได้รับ $Architecture)"
}

foreach ($command in @("git", "go")) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "ไม่พบ $command" }
}
if ($Target -in @("All", "Linux") -and -not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
  throw "การ build Linux bootstrap บน Windows ต้องมี WSL2"
}

$artifactQualifier = if ($testBuild) { "-SMOKE-ONLY" } else { "" }
$packageTypes = if ($PackageType -eq "all") { @("server", "server-pos") } else { @($PackageType) }
$packageSpecs = @($packageTypes | ForEach-Object {
  $label = if ($_ -eq "server") { "Server" } else { "Server-POS" }
  [pscustomobject]@{
    PackageType = $_
    WindowsArtifact = Join-Path $outputRoot "BMS-Retail-Local-$label-$Version-windows-x64$artifactQualifier.exe"
    LinuxArtifact = Join-Path $outputRoot "BMS-Retail-Local-$label-$Version-linux-x64$artifactQualifier.deb"
  }
})
$artifacts = @()
if ($Target -in @("All", "Windows")) { $artifacts += @($packageSpecs.WindowsArtifact) }
if ($Target -in @("All", "Linux")) { $artifacts += @($packageSpecs.LinuxArtifact) }
foreach ($path in $artifacts) {
  $existing = @(@($path, "$path.sha256", "$path.json") |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
  if ($existing.Count -gt 0 -and -not $Force) {
    throw "มี artifact อยู่แล้ว ใช้ -Force เมื่อตั้งใจ build ทับ: $path"
  }
}

if ($Target -in @("All", "Windows")) {
  if (-not $InnoCompiler) {
    $isccCommand = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    $candidates = @(
      $(if ($isccCommand) { $isccCommand.Source }),
      (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
      (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"),
      (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe")
    ) | Where-Object { $_ }
    $InnoCompiler = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
  }
  if (-not $InnoCompiler -or -not (Test-Path -LiteralPath $InnoCompiler -PathType Leaf)) {
    throw "ไม่พบ Inno Setup 6 compiler (ISCC.exe)"
  }
}

$workRoot = Join-Path ([IO.Path]::GetTempPath()) ("bms-online-bootstrap-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $workRoot | Out-Null
$previousGoos = $env:GOOS
$previousGoarch = $env:GOARCH
$previousCgo = $env:CGO_ENABLED
try {
  if (-not $SkipTests) {
    Push-Location $agentRoot
    try { Invoke-Checked "Test managed-runtime agent" { go test ./... } } finally { Pop-Location }
  }

  $sourceCommit = (& git -C $repoRoot rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch '^[a-f0-9]{40}$') {
    throw "อ่าน source commit ไม่สำเร็จ"
  }

  $env:CGO_ENABLED = "0"
  $results = @()

  if ($Target -in @("All", "Windows")) {
    $windowsStage = Join-Path $workRoot "managed-runtime\windows"
    $runtimeStage = Join-Path $workRoot "managed-runtime\runtime-rootfs"
    $windowsOutput = Join-Path $workRoot "windows-output"
    New-Item -ItemType Directory -Force -Path $windowsStage, $runtimeStage, $windowsOutput | Out-Null
    Copy-Item -Path (Join-Path $managedRoot "windows\*") -Destination $windowsStage -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $managedRoot "runtime-rootfs\bms-localctl") -Destination $runtimeStage -Force
    Copy-Item -LiteralPath (Join-Path $managedRoot "runtime-rootfs\bms-update-transaction") -Destination $runtimeStage -Force
    Copy-Item -LiteralPath (Join-Path $managedRoot "runtime-rootfs\bms-wsl-keepalive") -Destination $runtimeStage -Force
    Copy-Item -LiteralPath $keyringPath -Destination (Join-Path $windowsStage "trusted-release-keys.json") -Force

    $env:GOOS = "windows"
    $env:GOARCH = "amd64"
    Push-Location $agentRoot
    try {
      Invoke-Checked "Build Windows x64 runtime agent" {
        go build -trimpath '-ldflags=-s -w' -o (Join-Path $windowsStage "bms-runtime-agent.exe") .
      }
    } finally { Pop-Location }

    foreach ($spec in $packageSpecs) {
      $artifactBase = [IO.Path]::GetFileNameWithoutExtension($spec.WindowsArtifact)
      Invoke-Checked "Build Windows x64 $($spec.PackageType) online bootstrap" {
        & $InnoCompiler "/DBuildRoot=$windowsStage" "/DOutputRoot=$windowsOutput" `
          "/DProductVersion=$Version" "/DManifestUri=$WindowsManifestUri" `
          "/DActivationUri=$ActivationUri" "/DPackageType=$($spec.PackageType)" `
          "/DArtifactBaseFilename=$artifactBase" `
          (Join-Path $managedRoot "windows\BMSRetailLocal.iss")
      }
      $builtWindows = Join-Path $windowsOutput "$artifactBase.exe"
      if (-not (Test-Path -LiteralPath $builtWindows -PathType Leaf)) {
        throw "Inno Setup สำเร็จแต่ไม่พบ artifact: $builtWindows"
      }
      Copy-Item -LiteralPath $builtWindows -Destination $spec.WindowsArtifact -Force
      $results += Write-ChecksumAndMetadata $spec.WindowsArtifact "windows-x64" $spec.PackageType `
        $WindowsManifestUri $sourceCommit
    }
  }

  if ($Target -in @("All", "Linux")) {
    $linuxStage = Join-Path $workRoot "linux-output"
    $linuxRepoStage = Join-Path $workRoot "linux-repo"
    $linuxManagedStage = Join-Path $linuxRepoStage "deploy\retail-local\managed-runtime"
    New-Item -ItemType Directory -Force -Path $linuxStage | Out-Null
    New-Item -ItemType Directory -Force -Path $linuxManagedStage | Out-Null
    Copy-Item -Path (Join-Path $managedRoot "*") -Destination $linuxManagedStage -Recurse -Force
    Get-ChildItem -LiteralPath $linuxManagedStage -Recurse -File | Where-Object {
      $_.Extension -in @("", ".sh", ".service", ".timer", ".yml", ".json", ".txt")
    } | ForEach-Object {
      $contents = [IO.File]::ReadAllText($_.FullName).Replace("`r`n", "`n").Replace("`r", "`n")
      [IO.File]::WriteAllText($_.FullName, $contents, [Text.UTF8Encoding]::new($false))
    }
    $linuxAgent = Join-Path $workRoot "bms-runtime-agent-linux-amd64"
    $env:GOOS = "linux"
    $env:GOARCH = "amd64"
    Push-Location $agentRoot
    try {
      Invoke-Checked "Build Linux x64 runtime agent" {
        go build -trimpath '-ldflags=-s -w' -o $linuxAgent .
      }
    } finally { Pop-Location }

    $linuxBuilder = Join-Path $linuxManagedStage "linux\build-deb.sh"
    $builderWsl = ConvertTo-WslPath $linuxBuilder
    $keyringWsl = ConvertTo-WslPath $keyringPath
    $agentWsl = ConvertTo-WslPath $linuxAgent
    $outputWsl = ConvertTo-WslPath $linuxStage
    foreach ($mapped in @($builderWsl, $keyringWsl, $agentWsl, $outputWsl)) {
      if ([string]::IsNullOrWhiteSpace($mapped)) { throw "แปลง path สำหรับ WSL ไม่สำเร็จ" }
    }
    foreach ($spec in $packageSpecs) {
      Invoke-Checked "Build Ubuntu x64 $($spec.PackageType) online bootstrap" {
        & wsl.exe -d $WslDistribution -- bash $builderWsl `
          --keyring $keyringWsl --agent $agentWsl --manifest-url $LinuxManifestUri `
          --activation-url $ActivationUri --package-type $spec.PackageType `
          --version $Version --output-dir $outputWsl
      }
      $packageSlug = if ($spec.PackageType -eq "server") {
        "bms-retail-local-server-bootstrap"
      } else {
        "bms-retail-local-server-pos-bootstrap"
      }
      $builtLinux = Join-Path $linuxStage "${packageSlug}_${Version}_amd64.deb"
      if (-not (Test-Path -LiteralPath $builtLinux -PathType Leaf)) {
        throw "Linux builder สำเร็จแต่ไม่พบ artifact: $builtLinux"
      }
      Copy-Item -LiteralPath $builtLinux -Destination $spec.LinuxArtifact -Force
      $results += Write-ChecksumAndMetadata $spec.LinuxArtifact "ubuntu-x64" $spec.PackageType `
        $LinuxManifestUri $sourceCommit
    }
  }

  Write-Host "`nBuild online bootstrap สำเร็จ" -ForegroundColor Green
  $results | Format-Table -AutoSize
  Write-Host "Output: $outputRoot"
} finally {
  $env:GOOS = $previousGoos
  $env:GOARCH = $previousGoarch
  $env:CGO_ENABLED = $previousCgo
  if (Test-Path -LiteralPath $workRoot) { Remove-Item -LiteralPath $workRoot -Recurse -Force }
}
