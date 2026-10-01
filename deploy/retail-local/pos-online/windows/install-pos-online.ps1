[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ManifestUri,
  [Parameter(Mandatory = $true)][string]$PlatformTarget,
  [Parameter(Mandatory = $true)][string]$AgentPath,
  [Parameter(Mandatory = $true)][string]$KeyringPath
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-HttpsUri([string]$Value) {
  $parsed = $null
  if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$parsed) -or
      $parsed.Scheme -ne "https" -or -not [string]::IsNullOrEmpty($parsed.UserInfo)) {
    throw "Release manifest URL must use HTTPS and must not contain credentials."
  }
}

function Invoke-AgentJson([string[]]$Arguments) {
  $output = @(& $AgentPath @Arguments 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "BMS release verification failed: $($output -join ' ')" }
  return (($output -join "`n") | ConvertFrom-Json)
}

Assert-HttpsUri $ManifestUri
foreach ($path in @($AgentPath, $KeyringPath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Bootstrap file is missing: $path" }
}

$stateRoot = Join-Path $env:LOCALAPPDATA "BMS\POSBootstrap"
$manifestRoot = Join-Path $stateRoot "manifest"
New-Item -ItemType Directory -Force -Path $manifestRoot | Out-Null
$manifestPath = Join-Path $manifestRoot "release.jws.json"

Write-Host "BMS POS Online Setup"
Write-Host "An internet connection is required for the first installation."
Write-Host "Downloading the signed release manifest..."
try {
  Invoke-WebRequest -Uri $ManifestUri -OutFile "$manifestPath.part" -UseBasicParsing
  Move-Item -LiteralPath "$manifestPath.part" -Destination $manifestPath -Force
} catch {
  throw "Cannot download the signed release manifest. Check the internet connection and try again: $($_.Exception.Message)"
}

$release = Invoke-AgentJson @(
  "verify-release", "-manifest", $manifestPath, "-keyring", $KeyringPath, "-target", $PlatformTarget
)
$lastPercent = -1
$lastPrintedAt = [DateTime]::MinValue
Write-Host "Downloading BMS POS. Completed bytes are kept for resume..."
& $AgentPath stage-desktop -manifest $manifestPath -keyring $KeyringPath `
  -target $PlatformTarget -root $stateRoot -progress 2>&1 | ForEach-Object {
    $line = [string]$_
    try {
      if (-not $line.StartsWith("BMS_PROGRESS ")) { throw "not a progress event" }
      $event = $line.Substring(13) | ConvertFrom-Json
      if ($null -ne $event.percent) {
        $properties = @($event.PSObject.Properties.Name)
        $percent = [Math]::Max(0, [Math]::Min(100, [int]$event.percent))
        $component = if ($properties -contains "component" -and $event.component) {
          [string]$event.component
        } else { "desktop" }
        $phase = [string]$event.phase
        $status = switch ($phase) {
          "connect" { "Connecting to download $component" }
          "retry" { "Connection paused; retrying $component in $([int]$event.retryAfterSeconds) seconds" }
          "verify" { "Verifying $component" }
          "staged" { "Download verified" }
          default { "Downloading $component" }
        }
        $componentTotal = if ($properties -contains "componentTotalBytes") {
          [long]$event.componentTotalBytes
        } else { 0L }
        $details = if ($componentTotal -gt 0) {
          "{0:N1}/{1:N1} MiB" -f `
            ([long]$event.componentCompletedBytes / 1MB), ($componentTotal / 1MB)
        } else { "{0:N1}/{1:N1} MiB" -f ([long]$event.completedBytes / 1MB), ([long]$event.totalBytes / 1MB) }
        $heartbeat = ($properties -contains "heartbeat") -and [bool]$event.heartbeat
        if ($heartbeat) { $details += " - still working; waiting for network data" }
        Write-Progress -Id 31 -Activity "BMS POS download" `
          -Status "$status - $details ($percent%)" -PercentComplete $percent
        $now = [DateTime]::UtcNow
        if ($percent -gt $lastPercent -or $phase -in @("connect", "retry", "verify", "staged") -or
            $lastPrintedAt -eq [DateTime]::MinValue -or ($now - $lastPrintedAt).TotalSeconds -ge 5) {
          Write-Host ("  [{0,3}%] {1} - {2} - {3}" -f `
            $percent, $status, $details, $now.ToLocalTime().ToString("HH:mm:ss"))
          $lastPercent = $percent
          $lastPrintedAt = $now
        }
      }
    } catch {
      if (-not [string]::IsNullOrWhiteSpace($line)) { Write-Host $line }
    }
  }
$stageExit = $LASTEXITCODE
Write-Progress -Id 31 -Activity "BMS POS download" -Completed
if ($stageExit -ne 0) { throw "BMS POS download or signature verification failed (exit $stageExit)." }

$version = [string]$release.releaseVersion
if ($version -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') { throw "Release version is invalid." }
$desktopInstaller = Join-Path $stateRoot "releases\$version\desktop.artifact"
if (-not (Test-Path -LiteralPath $desktopInstaller -PathType Leaf)) {
  throw "The signed release does not contain a complete BMS POS installer."
}

Write-Host "Opening the verified BMS POS installer..."
$executableInstaller = Join-Path $stateRoot "releases\$version\BMS-POS-Setup.exe"
Copy-Item -LiteralPath $desktopInstaller -Destination $executableInstaller -Force
$process = Start-Process -FilePath $executableInstaller -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "BMS POS installer failed (exit $($process.ExitCode))." }

Remove-Item -LiteralPath (Join-Path $stateRoot "releases\$version") -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "BMS POS installation completed."
