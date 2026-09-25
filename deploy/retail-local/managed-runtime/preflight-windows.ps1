[CmdletBinding()]
param([switch]$Json)

$ErrorActionPreference = "Stop"
$failures = [Collections.Generic.List[string]]::new()
$warnings = [Collections.Generic.List[string]]::new()

function Add-Failure([string]$Message) { $script:failures.Add($Message) }
function Add-Warning([string]$Message) { $script:warnings.Add($Message) }

if (-not $IsWindows) {
  Add-Failure "preflight นี้ใช้สำหรับ Windows เท่านั้น"
  $os = $null
} else {
  $os = Get-CimInstance Win32_OperatingSystem
}

$architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
if ($architecture -ne "x64") { Add-Failure "รองรับเฉพาะ Windows x64 ใน milestone แรก (พบ $architecture)" }

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
    Add-Warning "Windows 10 22H2 ต้องมีหลักฐาน ESU ที่ยังใช้งานอยู่ก่อนรับรอง production"
  } else {
    Add-Failure "Windows build $build ไม่อยู่ใน support matrix ของ Managed Runtime"
  }

  $memoryGiB = [Math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
  if ($memoryGiB -lt 8) { Add-Failure "ต้องมี RAM อย่างน้อย 8 GiB (พบ $memoryGiB GiB)" }

  $systemDrive = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($os.SystemDrive)'"
  $freeGiB = [Math]::Round($systemDrive.FreeSpace / 1GB, 1)
  if ($freeGiB -lt 8) { Add-Failure "ต้องมีพื้นที่ว่างอย่างน้อย 8 GiB (พบ $freeGiB GiB)" }
  elseif ($freeGiB -lt 15) { Add-Warning "ควรมีพื้นที่ว่างอย่างน้อย 15 GiB สำหรับ update และ backup" }

  $processors = @(Get-CimInstance Win32_Processor)
  $firmwareValues = @($processors | ForEach-Object { $_.VirtualizationFirmwareEnabled } |
      Where-Object { $null -ne $_ })
  if ($firmwareValues.Count -eq 0) {
    Add-Warning "ตรวจ virtualization จาก firmware ไม่ได้; installer ขั้นถัดไปต้องตรวจ WSL2 จริง"
  } elseif ($true -notin $firmwareValues) {
    Add-Failure "ยังไม่ได้เปิด hardware virtualization ใน BIOS/UEFI"
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
    Write-Host "หมายเหตุ: candidate ยังไม่ใช่การรับรอง production จนกว่าจะผ่าน hardware/failure matrix"
  } else {
    Write-Host "result=unsupported" -ForegroundColor Red
  }
}

if (-not $result.ok) { exit 1 }
