[CmdletBinding()]
param([switch]$Json)

$ErrorActionPreference = "Stop"
$failures = [Collections.Generic.List[string]]::new()
$warnings = [Collections.Generic.List[string]]::new()

function Add-Failure([string]$Message) { $script:failures.Add($Message) }
function Add-Warning([string]$Message) { $script:warnings.Add($Message) }

if (-not $IsWindows) {
  Add-Failure "This preflight check runs on Windows only"
  $os = $null
} else {
  $os = Get-CimInstance Win32_OperatingSystem
}

$architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
if ($architecture -ne "x64") { Add-Failure "Only Windows x64 is supported in this milestone (detected $architecture)" }

$target = "unsupported"
$requiresEsuEvidence = $false
if ($os) {
  $build = [int]$os.BuildNumber
  $caption = [string]$os.Caption
  if ($build -ge 22000) {
    $target = "windows-11-x64"
  } elseif ($build -eq 19044 -and $caption -match "Windows 10 IoT Enterprise LTSC 2021") {
    $target = "windows-10-iot-enterprise-ltsc-2021-x64"
  } elseif ($build -eq 19045) {
    $target = "windows-10-22h2-esu-x64"
    $requiresEsuEvidence = $true
    Add-Warning "Windows 10 22H2 requires evidence of current ESU coverage before production approval"
  } else {
    Add-Failure "Windows build $build is not in the Managed Runtime support matrix"
  }

  $memoryGiB = [Math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
  if ($memoryGiB -lt 8) { Add-Failure "At least 8 GiB of RAM is required (detected $memoryGiB GiB)" }

  $systemDrive = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($os.SystemDrive)'"
  $freeGiB = [Math]::Round($systemDrive.FreeSpace / 1GB, 1)
  if ($freeGiB -lt 8) { Add-Failure "At least 8 GiB of free disk space is required (detected $freeGiB GiB)" }
  elseif ($freeGiB -lt 15) { Add-Warning "At least 15 GiB of free disk space is recommended for updates and backups" }

  $processors = @(Get-CimInstance Win32_Processor)
  $firmwareValues = @($processors | ForEach-Object { $_.VirtualizationFirmwareEnabled } |
      Where-Object { $null -ne $_ })
  if ($firmwareValues.Count -eq 0) {
    Add-Warning "Could not detect firmware virtualization; setup must verify WSL2 in the next step"
  } elseif ($true -notin $firmwareValues) {
    Add-Failure "Hardware virtualization is not enabled in BIOS/UEFI"
  }
}

$result = [pscustomobject]@{
  ok = $failures.Count -eq 0
  target = $target
  architecture = $architecture
  build = if ($os) { [int]$os.BuildNumber } else { $null }
  caption = if ($os) { [string]$os.Caption } else { $null }
  requiresEsuEvidence = $requiresEsuEvidence
  failures = @($failures)
  warnings = @($warnings)
}

if ($Json) {
  $result | ConvertTo-Json -Depth 4
} else {
  Write-Host "BMS Retail Local Managed Runtime preflight"
  Write-Host "target=$($result.target) architecture=$($result.architecture) build=$($result.build)"
  foreach ($message in $warnings) { Write-Host "[WARN] $message" -ForegroundColor Yellow }
  foreach ($message in $failures) { Write-Host "[FAIL] $message" -ForegroundColor Red }
  if ($result.ok) {
    Write-Host "result=candidate" -ForegroundColor Green
    Write-Host "A candidate result is not production approval; hardware and failure testing must also pass"
  } else {
    Write-Host "result=unsupported" -ForegroundColor Red
  }
}

if (-not $result.ok) { exit 1 }
