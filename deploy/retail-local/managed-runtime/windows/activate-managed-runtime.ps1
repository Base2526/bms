[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:ProgramData "BMS\RetailLocal"),
  [string]$ActivationUri,
  [switch]$Transfer
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$agent = Join-Path $InstallRoot "bootstrap\bms-runtime-agent.exe"
$receipt = Join-Path $InstallRoot "installation.json"
if (-not (Test-Path -LiteralPath $agent -PathType Leaf) -or
    -not (Test-Path -LiteralPath $receipt -PathType Leaf)) {
  throw "BMS Retail Local Managed Runtime is not installed"
}
if ([string]::IsNullOrWhiteSpace($ActivationUri)) { throw "The bootstrap has no Activation URL" }
$parsed = $null
if (-not [Uri]::TryCreate($ActivationUri, [UriKind]::Absolute, [ref]$parsed) -or
    $parsed.Scheme -ne "https" -or -not [string]::IsNullOrEmpty($parsed.UserInfo)) {
  throw "Activation URL must use HTTPS and contain no credentials"
}

# Read and validate the authoritative restored receipt before consuming the one-use activation code.
$runtimeReceipt = Join-Path $InstallRoot "activation-runtime-installation.json"
Remove-Item -LiteralPath $runtimeReceipt -Force -ErrorAction SilentlyContinue
try {
  & $agent runtime-read -engine windows-wsl -distro "BMSRuntime" `
    -source "/var/lib/bms-retail-local/installation.json" -destination $runtimeReceipt *> $null
  if ($LASTEXITCODE -ne 0) { throw "Failed to read the installation receipt from the private runtime" }
  $installed = Get-Content -LiteralPath $runtimeReceipt -Raw | ConvertFrom-Json
} finally {
  Remove-Item -LiteralPath $runtimeReceipt -Force -ErrorAction SilentlyContinue
}
$evidenceEndpoint = "$($parsed.GetLeftPart([UriPartial]::Authority))/api/bms/retail-local/license-evidence"
$hasStoredLicense = ($installed.PSObject.Properties.Name -contains "licenseCode") -and `
  (-not [string]::IsNullOrWhiteSpace([string]$installed.licenseCode))
$event = if ($Transfer -or $hasStoredLicense) {
  "TRANSFER_REQUESTED"
} else {
  "INSTALLATION_REGISTERED"
}

$secureCode = Read-Host "Activation Code" -AsSecureString
$activationCode = [Net.NetworkCredential]::new("", $secureCode).Password
if ([string]::IsNullOrWhiteSpace($activationCode)) { throw "Activation Code is empty" }
try {
  $body = @{ activationCode = $activationCode } | ConvertTo-Json -Compress
  $activation = Invoke-RestMethod -Uri $ActivationUri -Method Post -ContentType "application/json" `
    -Body $body -TimeoutSec 15
} finally {
  $activationCode = $null
  $secureCode.Dispose()
}

$arguments = @(
  "license-record", "-root", $InstallRoot, "-event", $event,
  "-license-id", [string]$activation.licenseCode, "-tenant-id", [string]$installed.tenantId,
  "-pos-device-id", [string]$installed.posDeviceId, "-target", [string]$installed.platformTarget,
  "-release-version", [string]$installed.version, "-endpoint", $evidenceEndpoint
)
$oldToken = [Environment]::GetEnvironmentVariable("BMS_LICENSE_EVIDENCE_TOKEN", "Process")
try {
  [Environment]::SetEnvironmentVariable("BMS_LICENSE_EVIDENCE_TOKEN", [string]$activation.ingestionToken, "Process")
  & $agent @arguments *> $null
  if ($LASTEXITCODE -ne 0) { throw "Code redeemed, but local evidence configuration failed; the shop can continue operating. Please contact Support" }
} finally {
  [Environment]::SetEnvironmentVariable("BMS_LICENSE_EVIDENCE_TOKEN", $oldToken, "Process")
}

if ($installed.PSObject.Properties.Name -contains "licenseCode") {
  $installed.licenseCode = [string]$activation.licenseCode
} else {
  $installed | Add-Member -NotePropertyName licenseCode -NotePropertyValue ([string]$activation.licenseCode)
}
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($receipt, ($installed | ConvertTo-Json), $utf8NoBom)
& $agent runtime-write -engine windows-wsl -distro "BMSRuntime" -source $receipt `
  -destination "/var/lib/bms-retail-local/installation.json" -mode "0600" *> $null
if ($LASTEXITCODE -ne 0) { Write-Warning "Activation succeeded, but installation receipt synchronization failed; please contact Support" }

try {
  $licenseAction = New-ScheduledTaskAction -Execute $agent `
    -Argument "license-pulse -root `"$InstallRoot`""
  $licenseTrigger = New-ScheduledTaskTrigger -Daily -At 3am
  $licenseSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
  $licensePrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  Register-ScheduledTask -TaskName "BMS Retail Local License Evidence" -Action $licenseAction `
    -Trigger $licenseTrigger -Principal $licensePrincipal -Settings $licenseSettings -Force | Out-Null
} catch {
  Write-Warning "Activation succeeded, but scheduling licensing evidence failed; the shop can continue operating: $($_.Exception.Message)"
}
Write-Host "Activation completed; the existing shop and data are unchanged" -ForegroundColor Green
