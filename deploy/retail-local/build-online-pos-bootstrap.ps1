[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$Keyring,
  [Parameter(Mandatory = $true)][string]$WindowsManifestUri,
  [Parameter(Mandatory = $true)][string]$WindowsX86ManifestUri,
  [Parameter(Mandatory = $true)][string]$LinuxManifestUri,
  [ValidateSet("All", "Windows", "Linux")][string]$Target = "All",
  [string]$OutputDirectory,
  [string]$InnoCompiler,
  [string]$WslDistribution = "Ubuntu",
  [switch]$AllowTestEndpoints,
  [switch]$Force,
  [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-HttpsUri([string]$Name, [string]$Value) {
  $parsed = $null
  if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$parsed) -or
      $parsed.Scheme -ne "https" -or -not [string]::IsNullOrEmpty($parsed.UserInfo)) {
    throw "$Name ต้องเป็น HTTPS URL ที่ไม่มี credential"
  }
}

function Test-PlaceholderUri([string]$Value) {
  $hostName = ([Uri]$Value).Host
  return $hostName -in @("localhost", "127.0.0.1", "::1", "example.com") -or
    $hostName.EndsWith(".example.com", [StringComparison]::OrdinalIgnoreCase) -or
    $hostName.EndsWith(".example.invalid", [StringComparison]::OrdinalIgnoreCase) -or
    $hostName.EndsWith(".invalid", [StringComparison]::OrdinalIgnoreCase)
}

function Invoke-Checked([string]$Title, [scriptblock]$Action) {
  Write-Host "`n==> $Title" -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "$Title ไม่สำเร็จ (exit $LASTEXITCODE)" }
}

function ConvertTo-WslPath([string]$WindowsPath) {
  $converted = & wsl.exe -d $WslDistribution -- wslpath -a -u $WindowsPath.Replace('\', '/') 2>&1
  if ($LASTEXITCODE -ne 0 -or -not $converted) { throw "แปลง WSL path ไม่สำเร็จ: $WindowsPath" }
  return ([string]$converted).Trim()
}

function Write-Metadata([string]$Path, [string]$Platform, [string]$ManifestUri, [string]$SourceCommit) {
  $item = Get-Item -LiteralPath $Path
  if ($item.Length -gt 25MB) { throw "POS online bootstrap ใหญ่เกิน 25 MiB: $Path" }
  $hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText("$Path.sha256", "$hash  $($item.Name)`n", [Text.UTF8Encoding]::new($false))
  $architecture = if ($Platform -eq "windows-x86-legacy") { "x86" } else { "x64" }
  $metadata = [ordered]@{
    artifact = $item.FullName
    version = $Version
    sourceCommit = $SourceCommit
    platform = $Platform
    architecture = $architecture
    packageType = "pos"
    distribution = "online-bootstrap"
    testBuild = $testBuild
    manifestUri = $ManifestUri
    sizeBytes = $item.Length
    sha256 = $hash
    signed = $false
  } | ConvertTo-Json
  [IO.File]::WriteAllText("$Path.json", "$metadata`n", [Text.UTF8Encoding]::new($false))
  [pscustomobject]@{ File = $item.Name; SizeMiB = [math]::Round($item.Length / 1MB, 2); SHA256 = $hash }
}

if ($PSVersionTable.PSVersion.Major -lt 7) { throw "ต้องรันด้วย PowerShell 7: pwsh" }
if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { throw "Version ต้องเป็น Semantic Version" }
foreach ($item in @{
  WindowsManifestUri = $WindowsManifestUri
  WindowsX86ManifestUri = $WindowsX86ManifestUri
  LinuxManifestUri = $LinuxManifestUri
}.GetEnumerator()) { Assert-HttpsUri $item.Key $item.Value }
$testBuild = (Test-PlaceholderUri $WindowsManifestUri) -or
  (Test-PlaceholderUri $WindowsX86ManifestUri) -or (Test-PlaceholderUri $LinuxManifestUri)
if ($testBuild -and -not $AllowTestEndpoints) { throw "production POS bootstrap ต้องใช้ release URL จริง" }

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot "..\.."))
$agentRoot = Join-Path $repoRoot "apps\retail-local-agent"
$sourceRoot = Join-Path $scriptRoot "pos-online"
$outputRoot = if ($OutputDirectory) { [IO.Path]::GetFullPath($OutputDirectory) } else { Join-Path $repoRoot "artifacts\retail-local" }
$keyringPath = [IO.Path]::GetFullPath($Keyring)
if (-not (Test-Path -LiteralPath $keyringPath -PathType Leaf)) { throw "ไม่พบ public keyring: $keyringPath" }
$keyringText = Get-Content -LiteralPath $keyringPath -Raw
if ($keyringText -match 'PRIVATE KEY' -or $keyringText -notmatch 'BEGIN PUBLIC KEY') { throw "keyring ต้องมี public key เท่านั้น" }
foreach ($command in @("git", "go")) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "ไม่พบ $command" }
}
if ($Target -in @("All", "Linux") -and -not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
  throw "การ build Linux POS bootstrap บน Windows ต้องมี WSL2"
}
if ($Target -in @("All", "Windows")) {
  if (-not $InnoCompiler) {
    $InnoCompiler = @(
      (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
      (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"),
      (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe")
    ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
  }
  if (-not $InnoCompiler) { throw "ไม่พบ Inno Setup 6 compiler" }
}

$qualifier = if ($testBuild) { "-SMOKE-ONLY" } else { "" }
$outputs = [ordered]@{
  windowsX64 = Join-Path $outputRoot "BMS-Retail-Local-POS-$Version-windows-x64$qualifier.exe"
  windowsX86 = Join-Path $outputRoot "BMS-Retail-Local-POS-$Version-windows-x86-legacy$qualifier.exe"
  linuxX64 = Join-Path $outputRoot "BMS-Retail-Local-POS-$Version-linux-x64$qualifier.deb"
}
$targetOutputs = @()
if ($Target -in @("All", "Windows")) { $targetOutputs += @($outputs.windowsX64, $outputs.windowsX86) }
if ($Target -in @("All", "Linux")) { $targetOutputs += $outputs.linuxX64 }
foreach ($path in $targetOutputs) {
  $existing = @(@($path, "$path.sha256", "$path.json") |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
  if ($existing.Count -gt 0 -and -not $Force) { throw "artifact มีอยู่แล้ว ใช้ -Force: $path" }
}

$workRoot = Join-Path ([IO.Path]::GetTempPath()) "bms-pos-online-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force -Path $workRoot, $outputRoot | Out-Null
$previousGoos = $env:GOOS
$previousGoarch = $env:GOARCH
$previousCgo = $env:CGO_ENABLED
try {
  if (-not $SkipTests) {
    Push-Location $agentRoot
    try { Invoke-Checked "Test POS download agent" { go test ./... } } finally { Pop-Location }
  }
  $sourceCommit = (& git -C $repoRoot rev-parse HEAD).Trim()
  if ($sourceCommit -notmatch '^[a-f0-9]{40}$') { throw "อ่าน source commit ไม่สำเร็จ" }
  $env:CGO_ENABLED = "0"
  $results = @()

  if ($Target -in @("All", "Windows")) {
    foreach ($spec in @(
    @{ Name = "windowsX64"; GoArch = "amd64"; Target = "windows-11-x64"; Uri = $WindowsManifestUri },
    @{ Name = "windowsX86"; GoArch = "386"; Target = "windows-10-x86-pos"; Uri = $WindowsX86ManifestUri }
    )) {
      $stage = Join-Path $workRoot $spec.Name
      $built = Join-Path $workRoot "$($spec.Name)-output"
      New-Item -ItemType Directory -Force -Path $stage, $built | Out-Null
      Copy-Item -LiteralPath (Join-Path $sourceRoot "windows\install-pos-online.ps1") -Destination $stage
      Copy-Item -LiteralPath (Join-Path $scriptRoot "managed-runtime\windows\setup-diagnostics.ps1") -Destination $stage
      Copy-Item -LiteralPath $keyringPath -Destination (Join-Path $stage "trusted-release-keys.json")
      $env:GOOS = "windows"
      $env:GOARCH = $spec.GoArch
      Push-Location $agentRoot
      try { Invoke-Checked "Build $($spec.Name) POS agent" { go build -trimpath '-ldflags=-s -w' -o (Join-Path $stage "bms-runtime-agent.exe") . } } finally { Pop-Location }
      $artifactBase = [IO.Path]::GetFileNameWithoutExtension($outputs[$spec.Name])
      Invoke-Checked "Build $($spec.Name) POS online bootstrap" {
        & $InnoCompiler "/DBuildRoot=$stage" "/DOutputRoot=$built" "/DProductVersion=$Version" `
          "/DManifestUri=$($spec.Uri)" "/DPlatformTarget=$($spec.Target)" `
          "/DArtifactBaseFilename=$artifactBase" (Join-Path $sourceRoot "windows\BMSPOSOnline.iss")
      }
      Copy-Item -LiteralPath (Join-Path $built "$artifactBase.exe") -Destination $outputs[$spec.Name] -Force
      $platform = if ($spec.Name -eq "windowsX86") { "windows-x86-legacy" } else { "windows-x64" }
      $results += Write-Metadata $outputs[$spec.Name] $platform $spec.Uri $sourceCommit
    }
  }

  if ($Target -in @("All", "Linux")) {
    $env:GOOS = "linux"
    $env:GOARCH = "amd64"
    $linuxAgent = Join-Path $workRoot "bms-runtime-agent-linux-amd64"
    Push-Location $agentRoot
    try { Invoke-Checked "Build Linux x64 POS agent" { go build -trimpath '-ldflags=-s -w' -o $linuxAgent . } } finally { Pop-Location }
    $linuxSource = Join-Path $workRoot "linux-source"
    New-Item -ItemType Directory -Force -Path $linuxSource | Out-Null
    foreach ($name in @("build-deb.sh", "bms-pos-online-setup")) {
      $text = [IO.File]::ReadAllText((Join-Path $sourceRoot "linux\$name")).Replace("`r`n", "`n").Replace("`r", "`n")
      [IO.File]::WriteAllText((Join-Path $linuxSource $name), $text, [Text.UTF8Encoding]::new($false))
    }
    $diagnosticsText = [IO.File]::ReadAllText((Join-Path $scriptRoot "managed-runtime\setup-diagnostics.sh")).Replace("`r`n", "`n")
    [IO.File]::WriteAllText((Join-Path $linuxSource "setup-diagnostics.sh"), $diagnosticsText, [Text.UTF8Encoding]::new($false))
    $linuxBuilt = Join-Path $workRoot "linux-output"
    New-Item -ItemType Directory -Force -Path $linuxBuilt | Out-Null
    Invoke-Checked "Build Linux x64 POS online bootstrap" {
      & wsl.exe -d $WslDistribution -- bash (ConvertTo-WslPath (Join-Path $linuxSource "build-deb.sh")) `
        $Version (ConvertTo-WslPath $linuxAgent) (ConvertTo-WslPath $keyringPath) $LinuxManifestUri `
        "ubuntu-24.04-lts-x64" (ConvertTo-WslPath $linuxBuilt)
    }
    Copy-Item -LiteralPath (Join-Path $linuxBuilt "bms-pos-online-bootstrap_${Version}_amd64.deb") -Destination $outputs.linuxX64 -Force
    $results += Write-Metadata $outputs.linuxX64 "ubuntu-x64" $LinuxManifestUri $sourceCommit
  }

  Write-Host "`nBuild POS online bootstrap สำเร็จ" -ForegroundColor Green
  $results | Format-Table -AutoSize
} finally {
  $env:GOOS = $previousGoos
  $env:GOARCH = $previousGoarch
  $env:CGO_ENABLED = $previousCgo
  if (Test-Path -LiteralPath $workRoot) { Remove-Item -LiteralPath $workRoot -Recurse -Force }
}
