[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ManifestUri,
  [string]$InstallRoot = (Join-Path $env:ProgramData "BMS\RetailLocal")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$distroName = "BMSRuntime"
$runtimeData = "/var/lib/bms-retail-local"
$bootstrapRoot = Join-Path $InstallRoot "bootstrap"
$agent = Join-Path $bootstrapRoot "bms-runtime-agent.exe"
$keyring = Join-Path $bootstrapRoot "trusted-release-keys.json"
$hostReceipt = Join-Path $InstallRoot "installation.json"

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "BMS Retail Local Update ต้องเปิดด้วยสิทธิ์ Administrator"
  }
}

function Assert-HttpsUri([string]$Value) {
  $parsed = $null
  if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$parsed) -or
      $parsed.Scheme -ne "https" -or -not [string]::IsNullOrEmpty($parsed.UserInfo)) {
    throw "Release manifest ต้องมาจาก HTTPS URL ที่ไม่มี credential"
  }
}

function Write-Utf8NoBom([string]$Path, [string]$Contents) {
  [IO.File]::WriteAllText($Path, $Contents, [Text.UTF8Encoding]::new($false))
}

function Invoke-AgentJson([string[]]$Arguments) {
  $output = & $script:agent @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($output -join [Environment]::NewLine) }
  return (($output -join [Environment]::NewLine) | ConvertFrom-Json)
}

function Get-ArtifactPath($Release, [string]$Name) {
  $component = @($Release.components | Where-Object name -eq $Name)
  if ($component.Count -ne 1) { throw "Release ต้องมี component $Name exactly once" }
  $fileName = "$($Name.Replace('.', '-')).artifact"
  $path = [IO.Path]::GetFullPath((Join-Path $script:releaseDirectory $fileName))
  if (-not $path.StartsWith($script:releaseDirectory + [IO.Path]::DirectorySeparatorChar,
      [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "ไม่พบ staged artifact: $Name"
  }
  return [pscustomobject]@{ component = $component[0]; path = $path }
}

function Invoke-Transaction([string[]]$Arguments) {
  $output = & wsl.exe -d $distroName -u root -- /usr/local/sbin/bms-update-transaction @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($output -join [Environment]::NewLine) }
}

function Sync-HostReceipt {
  $temporary = Join-Path $InstallRoot ".installation-$([Guid]::NewGuid().ToString('N')).json"
  try {
    & $script:agent runtime-read -engine windows-wsl -distro $distroName `
      -source "$runtimeData/installation.json" -destination $temporary
    if ($LASTEXITCODE -eq 0) {
      $parsed = Get-Content -LiteralPath $temporary -Raw | ConvertFrom-Json
      if ([string]$parsed.product -ne "BMS Retail Local") { throw "runtime installation receipt ไม่ถูกต้อง" }
      Move-Item -LiteralPath $temporary -Destination $hostReceipt -Force
    }
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
}

Assert-Administrator
Assert-HttpsUri $ManifestUri
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
if (-not (Test-Path -LiteralPath $hostReceipt -PathType Leaf)) { throw "ยังไม่ได้ติดตั้ง BMS Retail Local" }
foreach ($required in @($agent, $keyring, (Join-Path $bootstrapRoot "bms-localctl"),
    (Join-Path $bootstrapRoot "bms-update-transaction"))) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "bootstrap updater ไม่ครบ: $required" }
}

foreach ($controlName in @("bms-localctl", "bms-update-transaction")) {
  & $agent runtime-install-control -engine windows-wsl -distro $distroName `
    -source (Join-Path $bootstrapRoot $controlName) -name $controlName
  if ($LASTEXITCODE -ne 0) { throw "ติดตั้ง runtime control $controlName ไม่สำเร็จ" }
}
Sync-HostReceipt
$current = Get-Content -LiteralPath $hostReceipt -Raw | ConvertFrom-Json
$currentVersion = [string]$current.version
$target = [string]$current.platformTarget
$oldDesktop = Join-Path (Join-Path (Join-Path $InstallRoot "releases") $currentVersion) "desktop.artifact"
if (-not (Test-Path -LiteralPath $oldDesktop -PathType Leaf)) {
  throw "ไม่พบ Desktop artifact เวอร์ชันเดิมสำหรับ rollback"
}

$releaseRoot = Join-Path $InstallRoot "release"
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
$manifestPath = Join-Path $releaseRoot "update-release.jws.json"
Invoke-WebRequest -Uri $ManifestUri -OutFile "$manifestPath.tmp" -UseBasicParsing
Move-Item -LiteralPath "$manifestPath.tmp" -Destination $manifestPath -Force

$release = Invoke-AgentJson @("verify-update", "-manifest", $manifestPath, "-keyring", $keyring,
  "-target", $target, "-current-version", $currentVersion)
$stage = Invoke-AgentJson @("stage-release", "-manifest", $manifestPath, "-keyring", $keyring,
  "-target", $target, "-root", $InstallRoot)
$releaseDirectory = [IO.Path]::GetFullPath([string]$stage.releaseDirectory)
$version = [string]$release.releaseVersion

foreach ($component in @($release.components | Where-Object kind -eq "oci-image")) {
  $artifact = Get-ArtifactPath $release ([string]$component.name)
  & $agent engine-load -engine windows-wsl -distro $distroName -artifact $artifact.path `
    -image-ref ([string]$component.imageRef) -digest ([string]$component.ociDigest)
  if ($LASTEXITCODE -ne 0) { throw "โหลด image $($component.name) ไม่สำเร็จ" }
}

$transactionPath = "$runtimeData/updates/$version"
$compose = Get-ArtifactPath $release "compose"
& $agent runtime-write -engine windows-wsl -distro $distroName -source $compose.path `
  -destination "$transactionPath/compose.next.yml" -mode "0600"
if ($LASTEXITCODE -ne 0) { throw "stage compose update ไม่สำเร็จ" }

$nextReceiptPath = Join-Path $InstallRoot ".installation-next-$([Guid]::NewGuid().ToString('N')).json"
try {
  $current | Add-Member -NotePropertyName version -NotePropertyValue $version -Force
  $current | Add-Member -NotePropertyName updatedAt -NotePropertyValue ([DateTimeOffset]::UtcNow.ToString("o")) -Force
  $current | Add-Member -NotePropertyName sourceCommit -NotePropertyValue ([string]$release.sourceCommit) -Force
  $current | Add-Member -NotePropertyName schemaVersion -NotePropertyValue ([string]$release.schemaVersion) -Force
  Write-Utf8NoBom $nextReceiptPath ($current | ConvertTo-Json)
  & $agent runtime-write -engine windows-wsl -distro $distroName -source $nextReceiptPath `
    -destination "$transactionPath/installation.next.json" -mode "0600"
  if ($LASTEXITCODE -ne 0) { throw "stage installation receipt ไม่สำเร็จ" }

  $byName = @{}
  foreach ($component in $release.components) { $byName[[string]$component.name] = $component }
  $rollbackSafe = if ([bool]$release.rollbackSafe) { "1" } else { "0" }
  Invoke-Transaction @("begin", $version, $rollbackSafe, [string]$byName.web.imageRef,
    [string]$byName.ws.imageRef, [string]$byName.postgres.imageRef, [string]$byName.redis.imageRef)

  $desktop = Get-ArtifactPath $release "desktop"
  $desktopInstaller = Join-Path $releaseDirectory "BMS-POS-Update.exe"
  Copy-Item -LiteralPath $desktop.path -Destination $desktopInstaller -Force
  $desktopProcess = Start-Process -FilePath $desktopInstaller -ArgumentList "/S" -Wait -PassThru
  if ($desktopProcess.ExitCode -ne 0) {
    try { Invoke-Transaction @("rollback", $version) } catch {}
    try {
      $oldDesktopInstaller = Join-Path (Split-Path -Parent $oldDesktop) "BMS-POS-Rollback.exe"
      Copy-Item -LiteralPath $oldDesktop -Destination $oldDesktopInstaller -Force
      Start-Process -FilePath $oldDesktopInstaller -ArgumentList "/S" -Wait | Out-Null
    } catch {}
    throw "Desktop update ไม่สำเร็จ; runtime ถูก rollback"
  }
  Invoke-Transaction @("commit", $version)
  Move-Item -LiteralPath $nextReceiptPath -Destination $hostReceipt -Force
} finally {
  if (Test-Path -LiteralPath $nextReceiptPath) { Remove-Item -LiteralPath $nextReceiptPath -Force }
}

$profilePath = Join-Path $InstallRoot "license-evidence\profile.json"
if (Test-Path -LiteralPath $profilePath -PathType Leaf) {
  try {
    $profile = Get-Content -LiteralPath $profilePath -Raw | ConvertFrom-Json
    $licenseArguments = @(
      "license-record", "-root", $InstallRoot, "-event", "UPDATE_INSTALLED",
      "-license-id", [string]$profile.licenseId, "-tenant-id", [string]$profile.tenantId,
      "-pos-device-id", [string]$profile.posDeviceId, "-target", $target, "-release-version", $version
    )
    $profileEvidenceToken = if ($profile.PSObject.Properties.Name -contains "evidenceToken") {
      [string]$profile.evidenceToken
    } else { "" }
    if (-not [string]::IsNullOrWhiteSpace([string]$profile.evidenceEndpoint) -and
        -not [string]::IsNullOrWhiteSpace($profileEvidenceToken)) {
      $licenseArguments += @("-endpoint", [string]$profile.evidenceEndpoint)
    }
    $previousEvidenceToken = [Environment]::GetEnvironmentVariable("BMS_LICENSE_EVIDENCE_TOKEN", "Process")
    try {
      [Environment]::SetEnvironmentVariable("BMS_LICENSE_EVIDENCE_TOKEN", $profileEvidenceToken, "Process")
      & $agent @licenseArguments *> $null
    } finally {
      [Environment]::SetEnvironmentVariable("BMS_LICENSE_EVIDENCE_TOKEN", $previousEvidenceToken, "Process")
    }
  } catch {
    Write-Warning "บันทึก license update evidence ไม่สำเร็จ แต่ร้านยังใช้งานต่อได้: $($_.Exception.Message)"
  }
}

Write-Host "BMS Retail Local update สำเร็จ: $currentVersion -> $version" -ForegroundColor Green
