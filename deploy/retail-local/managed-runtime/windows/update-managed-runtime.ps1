[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ManifestUri,
  [string]$InstallRoot = (Join-Path $env:ProgramData "BMS\RetailLocal"),
  [switch]$CheckOnly,
  [switch]$RepairSameVersion,
  [switch]$ConfirmUpdate
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$utf8 = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$global:OutputEncoding = $utf8
try { & "$env:SystemRoot\System32\chcp.com" 65001 *> $null } catch {}
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
    throw "Run BMS Retail Local Update as Administrator"
  }
}

function Assert-HttpsUri([string]$Value) {
  $parsed = $null
  if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$parsed) -or
      $parsed.Scheme -ne "https" -or -not [string]::IsNullOrEmpty($parsed.UserInfo)) {
    throw "The release manifest must use an HTTPS URL without credentials"
  }
}

function Write-Utf8NoBom([string]$Path, [string]$Contents) {
  [IO.File]::WriteAllText($Path, $Contents, [Text.UTF8Encoding]::new($false))
}

function Invoke-AgentJson([string[]]$Arguments) {
  $output = New-Object System.Collections.Generic.List[string]
  Reset-AgentProgressState
  & $script:agent @Arguments 2>&1 | ForEach-Object {
    $line = [string]$_
    if ($line.StartsWith("BMS_PROGRESS ")) {
      Show-AgentProgress ($line.Substring(13) | ConvertFrom-Json)
    } else {
      $output.Add($line)
    }
  }
  $exitCode = $LASTEXITCODE
  Write-Progress -Id 17 -Activity "BMS Retail Local Update" -Completed
  if ($exitCode -ne 0) { throw ($output -join [Environment]::NewLine) }
  return (($output -join [Environment]::NewLine) | ConvertFrom-Json)
}

function Invoke-AgentProgress([string[]]$Arguments) {
  $output = New-Object System.Collections.Generic.List[string]
  Reset-AgentProgressState
  & $script:agent @Arguments 2>&1 | ForEach-Object {
    $line = [string]$_
    if ($line.StartsWith("BMS_PROGRESS ")) {
      Show-AgentProgress ($line.Substring(13) | ConvertFrom-Json)
    } else {
      $output.Add($line)
    }
  }
  $exitCode = $LASTEXITCODE
  Write-Progress -Id 17 -Activity "BMS Retail Local Update" -Completed
  if ($exitCode -ne 0) { throw ($output -join [Environment]::NewLine) }
}

function Reset-AgentProgressState {
  $script:progressLastPercent = -1
  $script:progressLastComponent = ""
  $script:progressLastPrintedAt = [DateTime]::MinValue
  $script:progressSampleAt = [DateTime]::MinValue
  $script:progressSampleBytes = 0L
  $script:progressBytesPerSecond = 0.0
}

function Show-AgentProgress($Event) {
  $properties = @($Event.PSObject.Properties.Name)
  $percent = if ($properties -contains "percent") {
    [Math]::Max(0, [Math]::Min(100, [int]$Event.percent))
  } else { 0 }
  $component = if ($properties -contains "component") { [string]$Event.component } else { "" }
  $phase = if ($properties -contains "phase") { [string]$Event.phase } else { "working" }
  $attempt = if ($properties -contains "attempt") { [int]$Event.attempt } else { 0 }
  $retryAfter = if ($properties -contains "retryAfterSeconds") { [int]$Event.retryAfterSeconds } else { 0 }
  $heartbeat = ($properties -contains "heartbeat") -and [bool]$Event.heartbeat
  $status = switch ($phase) {
    "connect" { "Connecting to download $component (attempt $attempt)" }
    "download" { "Downloading $component" }
    "retry" { "Connection interrupted. Retrying $component in $retryAfter seconds" }
    "verify" { "Verifying SHA-256 for $component" }
    "cached" { "Found a complete cached download for $component" }
    "staged" { "Release download and verification complete" }
    "load" { "Loading $component into the private runtime" }
    "inspect" { "Checking the image ID for $component" }
    "loaded" { "Loaded $component" }
    default { "Processing $component" }
  }
  $completedBytes = if ($properties -contains "completedBytes") { [long]$Event.completedBytes } else { 0L }
  $totalBytes = if ($properties -contains "totalBytes") { [long]$Event.totalBytes } else { 0L }
  $componentCompleted = if ($properties -contains "componentCompletedBytes") {
    [long]$Event.componentCompletedBytes
  } else { 0L }
  $componentTotal = if ($properties -contains "componentTotalBytes") {
    [long]$Event.componentTotalBytes
  } else { 0L }
  $size = if ($componentTotal -gt 0) {
    "File {0:N1}/{1:N1} MiB | Total {2:N1}/{3:N1} MiB" -f `
      ($componentCompleted / 1MB), ($componentTotal / 1MB), ($completedBytes / 1MB), ($totalBytes / 1MB)
  } elseif ($totalBytes -gt 0) {
    "{0:N1}/{1:N1} MiB" -f ($completedBytes / 1MB), ($totalBytes / 1MB)
  } else { "Working" }

  $now = [DateTime]::UtcNow
  if ($script:progressSampleAt -ne [DateTime]::MinValue -and $completedBytes -gt $script:progressSampleBytes) {
    $seconds = ($now - $script:progressSampleAt).TotalSeconds
    if ($seconds -gt 0.1) {
      $currentSpeed = ($completedBytes - $script:progressSampleBytes) / $seconds
      $script:progressBytesPerSecond = if ($script:progressBytesPerSecond -le 0) {
        $currentSpeed
      } else { ($script:progressBytesPerSecond * 0.7) + ($currentSpeed * 0.3) }
    }
  }
  if ($completedBytes -ne $script:progressSampleBytes) {
    $script:progressSampleBytes = $completedBytes
    $script:progressSampleAt = $now
  } elseif ($script:progressSampleAt -eq [DateTime]::MinValue) {
    $script:progressSampleAt = $now
  }
  $telemetry = ""
  if ($heartbeat) {
    $telemetry = " | Still working; waiting for network data"
  } elseif ($script:progressBytesPerSecond -gt 0 -and $totalBytes -gt $completedBytes) {
    $etaSeconds = [Math]::Min(359999, [Math]::Max(0, ($totalBytes - $completedBytes) / $script:progressBytesPerSecond))
    $eta = [TimeSpan]::FromSeconds($etaSeconds)
    $telemetry = " | {0:N1} MiB/s | About {1:hh\:mm\:ss} remaining" -f `
      ($script:progressBytesPerSecond / 1MB), $eta
  }
  Write-Progress -Id 17 -Activity "BMS Retail Local Update" `
    -Status "$status - $size$telemetry ($percent%)" -PercentComplete $percent

  $terminalPhase = $phase -in @("retry", "verify", "cached", "staged", "inspect", "loaded")
  $printDue = $script:progressLastPrintedAt -eq [DateTime]::MinValue -or
    ($now - $script:progressLastPrintedAt).TotalSeconds -ge 5
  if ($component -ne $script:progressLastComponent -or $percent -gt $script:progressLastPercent -or
      $terminalPhase -or $printDue) {
    Write-Host ("  [{0,3}%] {1} - {2}{3} - {4}" -f `
      $percent, $status, $size, $telemetry, $now.ToLocalTime().ToString("HH:mm:ss"))
    $script:progressLastPercent = $percent
    $script:progressLastComponent = $component
    $script:progressLastPrintedAt = $now
  }
}

function Invoke-WslCommand([string[]]$Arguments, [switch]$ShowOutput) {
  $previousPreference = $ErrorActionPreference
  try {
    # Windows PowerShell 5.1 promotes native stderr to a terminating error under Stop even when
    # WSL exits successfully. The process exit code remains the authority for this boundary.
    $ErrorActionPreference = "Continue"
    $output = @(& wsl.exe @Arguments 2>&1 | ForEach-Object {
      $line = [string]$_
      if ($ShowOutput) { Write-Host $line }
      $line
    })
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  return [pscustomobject]@{ Output = @($output); ExitCode = $exitCode }
}

function Get-ArtifactPath($Release, [string]$Name) {
  $component = @($Release.components | Where-Object name -eq $Name)
  if ($component.Count -ne 1) { throw "The release must contain component $Name exactly once" }
  $fileName = "$($Name.Replace('.', '-')).artifact"
  $path = [IO.Path]::GetFullPath((Join-Path $script:releaseDirectory $fileName))
  if (-not $path.StartsWith($script:releaseDirectory + [IO.Path]::DirectorySeparatorChar,
      [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Staged artifact not found: $Name"
  }
  return [pscustomobject]@{ component = $component[0]; path = $path }
}

function Invoke-Transaction([string[]]$Arguments) {
  $result = Invoke-WslCommand -Arguments (@(
    "-d", $distroName, "-u", "root", "--exec", "/usr/local/sbin/bms-update-transaction"
  ) + $Arguments) -ShowOutput
  if ($result.ExitCode -ne 0) { throw ($result.Output -join [Environment]::NewLine) }
}

function Sync-HostReceipt {
  $temporary = Join-Path $InstallRoot ".installation-$([Guid]::NewGuid().ToString('N')).json"
  try {
    & $script:agent runtime-read -engine windows-wsl -distro $distroName `
      -source "$runtimeData/installation.json" -destination $temporary
    if ($LASTEXITCODE -eq 0) {
      $parsed = Get-Content -LiteralPath $temporary -Raw | ConvertFrom-Json
      if ([string]$parsed.product -ne "BMS Retail Local") { throw "Invalid runtime installation receipt" }
      Move-Item -LiteralPath $temporary -Destination $hostReceipt -Force
    }
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
}

Assert-Administrator
Assert-HttpsUri $ManifestUri
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
if (-not (Test-Path -LiteralPath $hostReceipt -PathType Leaf)) { throw "BMS Retail Local is not installed" }
foreach ($required in @($agent, $keyring, (Join-Path $bootstrapRoot "bms-localctl"),
    (Join-Path $bootstrapRoot "bms-update-transaction"), (Join-Path $bootstrapRoot "bms-wsl-keepalive"))) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Bootstrap updater is incomplete: $required" }
}
$null = Invoke-AgentJson @("preflight")

Sync-HostReceipt
$current = Get-Content -LiteralPath $hostReceipt -Raw | ConvertFrom-Json
$currentVersion = [string]$current.version
$target = [string]$current.platformTarget
$packageType = if ($current.PSObject.Properties.Name -contains 'packageType') {
  [string]$current.packageType
} else {
  'server-pos'
}
if ($packageType -notin @('server', 'server-pos')) { throw "Invalid installation packageType: $packageType" }
$oldDesktop = Join-Path (Join-Path (Join-Path $InstallRoot "releases") $currentVersion) "desktop.artifact"

$releaseRoot = Join-Path $InstallRoot "release"
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
$manifestPath = Join-Path $releaseRoot "update-release.jws.json"
Invoke-WebRequest -Uri $ManifestUri -OutFile "$manifestPath.tmp" -UseBasicParsing -TimeoutSec 60
Move-Item -LiteralPath "$manifestPath.tmp" -Destination $manifestPath -Force

$verifyCommand = if ($CheckOnly -or $RepairSameVersion) { "check-update" } else { "verify-update" }
$release = Invoke-AgentJson @($verifyCommand, "-manifest", $manifestPath, "-keyring", $keyring,
  "-target", $target, "-current-version", $currentVersion)
if ($CheckOnly) {
  if (-not [bool]$release.updateAvailable) {
    Write-Host "BMS Retail Local is up to date: $currentVersion" -ForegroundColor Green
    return
  }
}
if ($RepairSameVersion -and -not $CheckOnly -and -not [bool]$release.updateAvailable) {
  Write-Host "Repairing the existing BMS Retail Local installation: $currentVersion" -ForegroundColor Cyan
  foreach ($controlName in @("bms-localctl", "bms-update-transaction", "bms-wsl-keepalive")) {
    & $agent runtime-install-control -engine windows-wsl -distro $distroName `
      -source (Join-Path $bootstrapRoot $controlName) -name $controlName
    if ($LASTEXITCODE -ne 0) { throw "Could not install runtime control: $controlName" }
  }
  if ($packageType -eq 'server-pos') {
    Invoke-Transaction @("prepare")
    $stage = Invoke-AgentJson @("stage-desktop", "-manifest", $manifestPath, "-keyring", $keyring,
      "-target", $target, "-root", $InstallRoot, "-progress")
    $releaseDirectory = [IO.Path]::GetFullPath([string]$stage.releaseDirectory)
    $desktop = Get-ArtifactPath $release "desktop"
    $desktopInstaller = Join-Path $releaseDirectory "BMS-POS-Repair.exe"
    Copy-Item -LiteralPath $desktop.path -Destination $desktopInstaller -Force
    $desktopProcess = Start-Process -FilePath $desktopInstaller -ArgumentList "/S", "/allusers" -WindowStyle Hidden -Wait -PassThru
    if ($desktopProcess.ExitCode -ne 0) { throw "BMS POS repair failed; run Setup again." }
  } else {
    $null = Invoke-AgentJson @("stage-server", "-manifest", $manifestPath, "-keyring", $keyring,
      "-target", $target, "-root", $InstallRoot, "-progress")
  }
  Write-Host "BMS Retail Local repair completed. Existing shop data was preserved." -ForegroundColor Green
  return
}
$downloadComponents = if ($packageType -eq 'server') {
  @($release.components | Where-Object name -ne 'desktop')
} else {
  @($release.components)
}
$totalBytes = [long](($downloadComponents | Measure-Object -Property sizeBytes -Sum).Sum)
$rollbackMode = if ([bool]$release.rollbackSafe) { "image-only" } else { "full database/files/secrets restore" }
Write-Host "A signature-verified BMS Retail Local update is available" -ForegroundColor Cyan
Write-Host "  version: $currentVersion -> $($release.releaseVersion)"
Write-Host "  channel: $($release.channel)"
Write-Host "  schema: $($release.schemaVersion)"
Write-Host "  download: $totalBytes bytes"
Write-Host "  rollback: $rollbackMode"
Write-Host "  published: $($release.createdAt)"
if ($CheckOnly) {
  Write-Host "No components have been downloaded and no update has been installed" -ForegroundColor Green
  return
}
if (-not $ConfirmUpdate) {
  $confirmation = Read-Host "Type UPDATE to create a backup and begin installation"
  if ($confirmation -cne "UPDATE") { throw "Update cancelled" }
}
if ($packageType -eq 'server-pos' -and -not (Test-Path -LiteralPath $oldDesktop -PathType Leaf)) {
  throw "Previous Desktop artifact was not found for rollback"
}
foreach ($controlName in @("bms-localctl", "bms-update-transaction", "bms-wsl-keepalive")) {
  & $agent runtime-install-control -engine windows-wsl -distro $distroName `
    -source (Join-Path $bootstrapRoot $controlName) -name $controlName
  if ($LASTEXITCODE -ne 0) { throw "Failed to install runtime control $controlName" }
}
Invoke-Transaction @("prepare")
$stageCommand = if ($packageType -eq 'server') { 'stage-server' } else { 'stage-release' }
$stage = Invoke-AgentJson @($stageCommand, "-manifest", $manifestPath, "-keyring", $keyring,
  "-target", $target, "-root", $InstallRoot, "-progress")
$releaseDirectory = [IO.Path]::GetFullPath([string]$stage.releaseDirectory)
$version = [string]$release.releaseVersion

foreach ($component in @($release.components | Where-Object kind -eq "oci-image")) {
  $artifact = Get-ArtifactPath $release ([string]$component.name)
  Invoke-AgentProgress @("engine-load", "-engine", "windows-wsl", "-distro", $distroName,
    "-artifact", $artifact.path, "-image-ref", [string]$component.imageRef,
    "-digest", [string]$component.ociDigest, "-progress")
}

$transactionPath = "$runtimeData/updates/$version"
$compose = Get-ArtifactPath $release "compose"
& $agent runtime-write -engine windows-wsl -distro $distroName -source $compose.path `
  -destination "$transactionPath/compose.next.yml" -mode "0600"
if ($LASTEXITCODE -ne 0) { throw "Failed to stage Compose update" }

$nextReceiptPath = Join-Path $InstallRoot ".installation-next-$([Guid]::NewGuid().ToString('N')).json"
try {
  $byName = @{}
  foreach ($component in $release.components) { $byName[[string]$component.name] = $component }
  $rollbackSafe = if ([bool]$release.rollbackSafe) { "1" } else { "0" }
  Invoke-Transaction @("begin", $version, $rollbackSafe, [string]$byName.web.imageRef,
    [string]$byName.ws.imageRef, [string]$byName.postgres.imageRef, [string]$byName.redis.imageRef)

  # begin owns the receipt snapshot and update-active now excludes registration.
  # Do not reuse the pre-download receipt: its license may have changed meanwhile.
  & $agent runtime-read -engine windows-wsl -distro $distroName `
    -source "$runtimeData/installation.json" -destination $nextReceiptPath
  if ($LASTEXITCODE -ne 0) { throw "Could not read the current installation receipt." }
  $current = Get-Content -LiteralPath $nextReceiptPath -Raw | ConvertFrom-Json
  $current | Add-Member -NotePropertyName version -NotePropertyValue $version -Force
  $current | Add-Member -NotePropertyName updatedAt -NotePropertyValue ([DateTimeOffset]::UtcNow.ToString("o")) -Force
  $current | Add-Member -NotePropertyName sourceCommit -NotePropertyValue ([string]$release.sourceCommit) -Force
  $current | Add-Member -NotePropertyName schemaVersion -NotePropertyValue ([string]$release.schemaVersion) -Force
  Write-Utf8NoBom $nextReceiptPath ($current | ConvertTo-Json)
  & $agent runtime-write -engine windows-wsl -distro $distroName -source $nextReceiptPath `
    -destination "$transactionPath/installation.next.json" -mode "0600"
  if ($LASTEXITCODE -ne 0) { throw "Failed to stage installation receipt" }

  if ($packageType -eq 'server-pos') {
    $desktop = Get-ArtifactPath $release "desktop"
    $desktopInstaller = Join-Path $releaseDirectory "BMS-POS-Update.exe"
    Copy-Item -LiteralPath $desktop.path -Destination $desktopInstaller -Force
    $desktopProcess = Start-Process -FilePath $desktopInstaller -ArgumentList "/S", "/allusers" -WindowStyle Hidden -Wait -PassThru
    if ($desktopProcess.ExitCode -ne 0) {
      try { Invoke-Transaction @("rollback", $version) } catch {}
      try {
        $oldDesktopInstaller = Join-Path (Split-Path -Parent $oldDesktop) "BMS-POS-Rollback.exe"
        Copy-Item -LiteralPath $oldDesktop -Destination $oldDesktopInstaller -Force
        Start-Process -FilePath $oldDesktopInstaller -ArgumentList "/S", "/allusers" -WindowStyle Hidden -Wait | Out-Null
      } catch {}
      throw "Desktop update failed; runtime was rolled back"
    }
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
    Write-Warning "Could not record license update evidence. The shop can continue operating: $($_.Exception.Message)"
  }
}

Write-Host "BMS Retail Local update complete: $currentVersion -> $version" -ForegroundColor Green
