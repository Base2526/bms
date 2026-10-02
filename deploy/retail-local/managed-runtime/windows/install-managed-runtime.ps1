[CmdletBinding()]
param(
  [string]$ManifestUri,
  [ValidateSet('server', 'server-pos')][string]$PackageType = 'server-pos',
  [string]$AgentPath = (Join-Path $PSScriptRoot "bms-runtime-agent.exe"),
  [string]$KeyringPath = (Join-Path $PSScriptRoot "trusted-release-keys.json"),
  [string]$InstallRoot = (Join-Path $env:ProgramData "BMS\RetailLocal"),
  [string]$ActivationUri,
  [string]$LicenseId,
  [string]$LicenseEvidenceUri,
  [string]$ResumeConfig,
  [string]$ErrorFile,
  [string]$InstallerVersion = 'unknown'
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$utf8 = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$global:OutputEncoding = $utf8
$script:BmsSetupStage = 'startup'
try { & "$env:SystemRoot\System32\chcp.com" 65001 *> $null } catch {}
trap {
  $failure = $_
  $message = $failure.Exception.Message
  try {
    . (Join-Path $PSScriptRoot 'setup-diagnostics.ps1')
    Write-Host 'Preparing installation error report...'
    $report = New-BmsSetupDiagnostics -Root $InstallRoot -Failure $failure -Product $PackageType `
      -InstallerVersion $InstallerVersion -Stage $script:BmsSetupStage
    if ($report) { $message += "`nSupport report (review before sending): $report" }
  } catch {}
  if (-not [string]::IsNullOrWhiteSpace($ErrorFile)) {
    try {
      [IO.File]::WriteAllText($ErrorFile, $message, [Text.UTF8Encoding]::new($false))
    } catch {}
  }
  Write-Host "`nBMS Retail Local Setup ยังไม่สำเร็จ" -ForegroundColor Red
  Write-Host $message -ForegroundColor Red
  Write-Host "แก้ไขตามข้อความด้านบนแล้วเปิด installer อีกครั้ง ระบบจะติดตั้งต่อจากข้อมูลที่ปลอดภัย" -ForegroundColor Yellow
  if ([Environment]::UserInteractive) { [void](Read-Host "กด Enter เพื่อปิดหน้าต่างนี้") }
  exit 1
}
$distroName = "BMSRuntime"
$runtimeData = "/var/lib/bms-retail-local"
$LicenseEvidenceToken = [Environment]::GetEnvironmentVariable("BMS_LICENSE_EVIDENCE_TOKEN", "Process")

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "BMS Retail Local Setup ต้องเปิดด้วยสิทธิ์ Administrator"
  }
}

function Assert-HttpsUri([string]$Value) {
  $parsed = $null
  if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$parsed) -or
      $parsed.Scheme -ne "https" -or -not [string]::IsNullOrEmpty($parsed.UserInfo)) {
    throw "Release manifest ต้องมาจาก HTTPS URL ที่ไม่มี credential"
  }
}

function New-HexSecret([int]$Bytes) {
  $buffer = New-Object byte[] $Bytes
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
  return ([BitConverter]::ToString($buffer) -replace '-', '').ToLowerInvariant()
}

function Write-Utf8NoBom([string]$Path, [string]$Contents) {
  $temporary = "$Path.pending"
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes($Contents)
  $stream = [IO.File]::Open($temporary, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
  } finally { $stream.Dispose() }
  if ([IO.File]::Exists($Path)) {
    [IO.File]::Replace($temporary, $Path, [NullString]::Value)
  } else {
    [IO.File]::Move($temporary, $Path)
  }
}

function Read-Utf8Text([string]$Path) {
  return [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)
}

function ConvertTo-PlainSecret([Security.SecureString]$Secret) {
  return [Net.NetworkCredential]::new("", $Secret).Password
}

function Read-MenuChoice([string]$Prompt, [array]$Options, [string]$DefaultValue) {
  Write-Host ""
  Write-Host $Prompt -ForegroundColor Cyan
  $defaultIndex = 1
  for ($index = 0; $index -lt $Options.Count; $index++) {
    Write-Host ("  {0}. {1}" -f ($index + 1), $Options[$index].Label)
    if ($Options[$index].Value -eq $DefaultValue) { $defaultIndex = $index + 1 }
  }
  while ($true) {
    $answer = Read-Host ("เลือกหมายเลข [{0}]" -f $defaultIndex)
    if (-not $answer) { return $DefaultValue }
    $number = 0
    if ([int]::TryParse($answer, [ref]$number) -and $number -ge 1 -and $number -le $Options.Count) {
      return [string]$Options[$number - 1].Value
    }
    Write-Host "กรุณาเลือกหมายเลข 1-$($Options.Count)" -ForegroundColor Yellow
  }
}

function Get-ShopArchetypeCatalog([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "ไม่พบ shop-archetypes manifest ของ release"
  }
  $manifest = Read-Utf8Text $Path | ConvertFrom-Json
  if ([int]$manifest.formatVersion -ne 1 -or -not $manifest.defaultArchetype) {
    throw "shop-archetypes manifest version ไม่รองรับ"
  }
  $seen = @{}
  $options = @()
  foreach ($entry in @($manifest.archetypes)) {
    $id = [string]$entry.id
    if ($id -notmatch '^[a-z][a-z0-9_]{1,63}$' -or $seen.ContainsKey($id)) {
      throw "shop-archetypes manifest มี id ไม่ถูกต้องหรือซ้ำ: $id"
    }
    $seen[$id] = $true
    if ($entry.enabledForNewInstall -eq $true -and $entry.deprecated -ne $true) {
      $label = if ($entry.labels.th) { [string]$entry.labels.th } else { [string]$entry.labels.en }
      if (-not $label) { throw "shop-archetypes manifest ขาด label: $id" }
      $options += [pscustomobject]@{
        Value = $id
        Label = $label
        StarterCatalog = ($entry.starterCatalog -eq $true)
      }
    }
  }
  if ($options.Count -eq 0) { throw "shop-archetypes manifest ไม่มีประเภทที่เปิดให้ติดตั้ง" }
  $defaultValue = [string]$manifest.defaultArchetype
  if ($defaultValue -notin @($options | ForEach-Object Value)) {
    throw "defaultArchetype ไม่ได้เปิดให้ติดตั้ง: $defaultValue"
  }
  return [pscustomobject]@{ Options = $options; DefaultValue = $defaultValue }
}

function Assert-NoLineBreak([string]$Name, [string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value -match '[\r\n]') { throw "$Name ไม่ถูกต้อง" }
}

function Test-CompletedSampleData($SampleData, [string]$BusinessArchetype) {
  if ($null -eq $SampleData -or
      -not ($SampleData.PSObject.Properties.Name -contains "status") -or
      -not ($SampleData.PSObject.Properties.Name -contains "completedSteps")) {
    return $false
  }
  $status = [string]$SampleData.status
  if ($status -notin @("COMPLETED", "ALREADY_COMPLETED")) { return $false }
  $steps = @($SampleData.completedSteps | ForEach-Object { [string]$_ })
  if ("products" -notin $steps) { return $false }
  if ($BusinessArchetype -eq "restaurant" -and "restaurant_layout" -notin $steps) { return $false }
  return $true
}

function Write-Step([int]$Number, [string]$Message) {
  $script:BmsSetupStage = "step-$Number-of-7"
  Write-Host "`n[BMS $Number/7] $Message" -ForegroundColor Cyan
}

function Read-RequiredText([string]$Prompt) {
  while ($true) {
    $value = Read-Host $Prompt
    if (-not [string]::IsNullOrWhiteSpace($value) -and $value -notmatch '[\r\n]') { return $value }
    Write-Warning "$Prompt ไม่ถูกต้อง กรุณากรอกใหม่"
  }
}

function Read-EmailAddress {
  while ($true) {
    $value = Read-Host "อีเมลผู้ดูแลร้าน"
    if ($value -match '^[^\s@]+@[^\s@]+\.[^\s@]+$') { return $value }
    Write-Warning "อีเมลไม่ถูกต้อง กรุณากรอกใหม่"
  }
}

function Read-ConfirmedSecret([string]$Prompt, [string]$ConfirmPrompt, [string]$Pattern, [string]$Failure) {
  while ($true) {
    $value = ConvertTo-PlainSecret (Read-Host $Prompt -AsSecureString)
    $confirmation = ConvertTo-PlainSecret (Read-Host $ConfirmPrompt -AsSecureString)
    if ($value -ceq $confirmation -and $value -match $Pattern) { return $value }
    Write-Warning $Failure
  }
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

function Invoke-AgentJson([string[]]$Arguments) {
  $output = New-Object System.Collections.Generic.List[string]
  Reset-AgentProgressState
  & $script:installedAgent @Arguments 2>&1 | ForEach-Object {
    $line = [string]$_
    if ($line.StartsWith("BMS_PROGRESS ")) {
      Show-AgentProgress ($line.Substring(13) | ConvertFrom-Json)
    } else {
      $output.Add($line)
    }
  }
  $exitCode = $LASTEXITCODE
  Write-Progress -Id 17 -Activity "BMS Retail Local Setup" -Completed
  if ($exitCode -ne 0) { throw ($output -join [Environment]::NewLine) }
  return (($output -join [Environment]::NewLine) | ConvertFrom-Json)
}

function Invoke-AgentProgress([string[]]$Arguments) {
  $output = New-Object System.Collections.Generic.List[string]
  Reset-AgentProgressState
  & $script:installedAgent @Arguments 2>&1 | ForEach-Object {
    $line = [string]$_
    if ($line.StartsWith("BMS_PROGRESS ")) {
      Show-AgentProgress ($line.Substring(13) | ConvertFrom-Json)
    } else {
      $output.Add($line)
    }
  }
  $exitCode = $LASTEXITCODE
  Write-Progress -Id 17 -Activity "BMS Retail Local Setup" -Completed
  if ($exitCode -ne 0) { throw ($output -join [Environment]::NewLine) }
  foreach ($line in $output) {
    if (-not [string]::IsNullOrWhiteSpace($line)) { Write-Host $line }
  }
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
    "connect" { "กำลังเชื่อมต่อเพื่อดาวน์โหลด $component (ครั้งที่ $attempt)" }
    "download" { "กำลังดาวน์โหลด $component" }
    "retry" { "การเชื่อมต่อหยุดชั่วคราว จะลอง $component ใหม่ใน $retryAfter วินาที" }
    "verify" { "กำลังตรวจ SHA-256 ของ $component" }
    "cached" { "ตรวจพบไฟล์ $component ที่ดาวน์โหลดครบแล้ว" }
    "staged" { "ดาวน์โหลดและตรวจสอบ release ครบแล้ว" }
    "load" { "กำลังโหลด $component เข้า private runtime" }
    "inspect" { "กำลังตรวจ image id ของ $component" }
    "loaded" { "โหลด $component สำเร็จ" }
    default { "กำลังดำเนินการ $component" }
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
    "ไฟล์ {0:N1}/{1:N1} MiB | รวม {2:N1}/{3:N1} MiB" -f `
      ($componentCompleted / 1MB), ($componentTotal / 1MB), ($completedBytes / 1MB), ($totalBytes / 1MB)
  } elseif ($totalBytes -gt 0) {
    "{0:N1}/{1:N1} MiB" -f ($completedBytes / 1MB), ($totalBytes / 1MB)
  } else { "กำลังทำงาน" }

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
    $telemetry = " | ยังทำงานอยู่ รอข้อมูลจากเครือข่าย"
  } elseif ($script:progressBytesPerSecond -gt 0 -and $totalBytes -gt $completedBytes) {
    $etaSeconds = [Math]::Min(359999, [Math]::Max(0, ($totalBytes - $completedBytes) / $script:progressBytesPerSecond))
    $eta = [TimeSpan]::FromSeconds($etaSeconds)
    $telemetry = " | {0:N1} MiB/s | เหลือประมาณ {1:hh\:mm\:ss}" -f `
      ($script:progressBytesPerSecond / 1MB), $eta
  }
  Write-Progress -Id 17 -Activity "BMS Retail Local Setup" `
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

function Invoke-WslCommand([string[]]$Arguments, [switch]$Quiet) {
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    # Windows PowerShell 5.1 promotes native stderr to a terminating error when this script uses
    # Stop. WSL can emit harmless systemd warnings while still returning a successful exit code.
    $ErrorActionPreference = "Continue"
    $output = @(& wsl.exe @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $lines = @($output | ForEach-Object { ([string]$_).Replace([string][char]0, '') })
  if (-not $Quiet) {
    foreach ($line in $lines) { Write-Host $line }
  }
  return [pscustomobject]@{ ExitCode = $exitCode; Output = $lines }
}

function Invoke-WslDocker([string[]]$Arguments) {
  $result = Invoke-WslCommand -Arguments (@("-d", $distroName, "-u", "root", "--", "docker") + $Arguments) -Quiet
  if ($result.ExitCode -ne 0) { throw ($result.Output -join [Environment]::NewLine) }
  return $result.Output
}

function Write-RuntimeText([string]$Destination, [string]$Contents, [string]$Mode = "0600") {
  $temporary = Join-Path $InstallRoot ".runtime-write-$([Guid]::NewGuid().ToString('N'))"
  try {
    Write-Utf8NoBom $temporary $Contents
    & $script:installedAgent runtime-write -engine windows-wsl -distro $distroName `
      -source $temporary -destination $Destination -mode $Mode
    if ($LASTEXITCODE -ne 0) { throw "เขียน $Destination เข้า private runtime ไม่สำเร็จ" }
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
}

function ConvertTo-ShellExport([string]$Name, [string]$Value) {
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Value))
  return "export $Name=`"`$(printf '%s' '$encoded' | base64 -d)`""
}

function Start-ManagedRuntime {
  $taskName = "BMS Retail Local Runtime"
  $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\wsl.exe" `
    -Argument "-d $distroName -u root -- /usr/local/sbin/bms-wsl-keepalive"
  $triggers = @(
    (New-ScheduledTaskTrigger -AtStartup)
    (New-ScheduledTaskTrigger -AtLogOn)
  )
  # Over-the-shoulder UAC can register BMSRuntime under a separate administrator account that is not
  # interactively logged on. S4U keeps that user's WSL registration available without storing a password.
  $script:principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Force | Out-Null
  Start-ScheduledTask -TaskName $taskName

  $deadline = [DateTime]::UtcNow.AddMinutes(2)
  $dockerAttempt = 0
  do {
    $dockerAttempt++
    $dockerInfo = Invoke-WslCommand -Arguments @("-d", $distroName, "-u", "root", "--", "docker", "info") -Quiet
    if ($dockerInfo.ExitCode -eq 0) { break }
    $dockerPercent = [Math]::Min(99, [int](($dockerAttempt / 60) * 100))
    Write-Progress -Id 19 -Activity "กำลังเริ่ม private runtime" -Status "รอ Docker engine ($dockerPercent%)" -PercentComplete $dockerPercent
    if ($dockerAttempt % 5 -eq 0) { Write-Host "  ยังทำงานอยู่: กำลังรอ Docker engine ($($dockerAttempt * 2) วินาที)..." }
    Start-Sleep -Seconds 2
  } while ([DateTime]::UtcNow -lt $deadline)
  Write-Progress -Id 19 -Activity "กำลังเริ่ม private runtime" -Completed
  if ($dockerInfo.ExitCode -ne 0) { throw "BMS private Moby runtime ไม่พร้อม" }
}

function Register-LicenseEvidenceTask {
  # Register before activation as well: a missing profile is a harmless agent no-op.
  # Activating from Admin later must not depend on running the CLI shortcut.
  try {
    $licenseAction = New-ScheduledTaskAction -Execute $installedAgent `
      -Argument "license-pulse -root `"$InstallRoot`""
    $licenseTrigger = New-ScheduledTaskTrigger -Daily -At 3am
    $licenseSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
    $licensePrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName "BMS Retail Local License Evidence" -Action $licenseAction `
      -Trigger $licenseTrigger -Principal $licensePrincipal -Settings $licenseSettings -Force | Out-Null
  } catch { Write-Warning "ตั้งเวลาหลักฐาน Licensing ไม่สำเร็จ แต่ร้านยังใช้งานต่อได้" }
}

function Register-LicenseUIBridge {
  Register-LicenseEvidenceTask
  if ([string]::IsNullOrWhiteSpace($ActivationUri)) { return }
  try {
    $bridgeAction = New-ScheduledTaskAction -Execute $installedAgent -Argument `
      "license-ui -root `"$InstallRoot`" -engine windows-wsl -distro $distroName -activation-uri `"$ActivationUri`""
    $bridgeTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
    $bridgePrincipal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Highest
    $bridgeSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 55)
    Register-ScheduledTask -TaskName "BMS Retail Local License UI" -Action $bridgeAction -Trigger $bridgeTrigger `
      -Principal $bridgePrincipal -Settings $bridgeSettings -Force | Out-Null
    Start-ScheduledTask -TaskName "BMS Retail Local License UI"
  } catch { Write-Warning "ตั้งระบบลงทะเบียนผ่าน Admin ไม่สำเร็จ ร้านยังใช้งานได้" }
}

function Show-SetupCompletion {
  Write-Step 7 "ติดตั้งสำเร็จ"
  Write-Host "BMS Retail Local พร้อมใช้งาน ระบบทำงานเบื้องหลังและเริ่มอัตโนมัติหลังเปิดเครื่อง" -ForegroundColor Green
  Write-Host "เปิด Admin บนเครื่องนี้: http://127.0.0.1:3100/admin/login"
  Write-Host "เข้าสู่ระบบด้วยอีเมลและรหัสผ่านผู้ดูแลที่สร้างระหว่างติดตั้ง"
  Write-Host "เปิดครั้งต่อไป: Desktop > BMS Retail Local Admin หรือ Start > BMS Retail Local > Open Admin"
  Write-Host "ตั้งค่า backup: Start > BMS Retail Local > Configure Off-host Backup"
  Write-Host "ทดลองใช้งานได้ทันทีโดยไม่ต้องมี Activation Code"
  if (-not [string]::IsNullOrWhiteSpace($ActivationUri)) {
    Write-Host "ลงทะเบียนภายหลัง: Admin > License ของเครื่องนี้ (หรือ Start > BMS Retail Local > Activate or Transfer)"
  }
  if ($PackageType -eq 'server') {
    Write-Host "จับคู่ POS: Admin > POS Devices > ออก token"
    Write-Host "URL 127.0.0.1 ใช้บนเครื่อง Server เท่านั้น การเชื่อม POS เครื่องอื่นต้องตั้งค่าเครือข่ายกับผู้ดูแลระบบก่อน"
  }
  # After reboot there is no Inno wizard to return to. Keep the next steps visible
  # until the operator acknowledges them; a normal installer run uses its Finish page.
  if ($ResumeConfig -and [Environment]::UserInteractive) {
    [void](Read-Host "จด URL หรือเปิด BMS Retail Local Admin แล้วกด Enter เพื่อปิด Setup (ระบบยังทำงานต่อ)")
  }
}

Assert-Administrator

if ($ResumeConfig) {
  $resume = Get-Content -LiteralPath $ResumeConfig -Raw | ConvertFrom-Json
  $ManifestUri = [string]$resume.manifestUri
  $InstallRoot = [string]$resume.installRoot
  if ($resume.PSObject.Properties.Name -contains 'installerVersion') {
    $InstallerVersion = [string]$resume.installerVersion
  }
  if ($resume.PSObject.Properties.Name -contains 'packageType') {
    $PackageType = [string]$resume.packageType
  }
  $ActivationUri = if ($resume.PSObject.Properties.Name -contains "activationUri") {
    [string]$resume.activationUri
  } else { "" }
  $LicenseId = [string]$resume.licenseId
  $LicenseEvidenceUri = [string]$resume.licenseEvidenceUri
  $LicenseEvidenceToken = if ($resume.PSObject.Properties.Name -contains "licenseEvidenceToken") {
    [string]$resume.licenseEvidenceToken
  } else { "" }
  $AgentPath = Join-Path $InstallRoot "bootstrap\bms-runtime-agent.exe"
  $KeyringPath = Join-Path $InstallRoot "bootstrap\trusted-release-keys.json"
}
if ($PackageType -notin @('server', 'server-pos')) { throw "bootstrap packageType ไม่ถูกต้อง: $PackageType" }

Assert-HttpsUri $ManifestUri
if (-not [string]::IsNullOrWhiteSpace($ActivationUri)) { Assert-HttpsUri $ActivationUri }
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
if ($InstallRoot -eq [IO.Path]::GetPathRoot($InstallRoot)) { throw "InstallRoot ห้ามเป็น root drive" }
$bootstrapRoot = Join-Path $InstallRoot "bootstrap"
New-Item -ItemType Directory -Force -Path $bootstrapRoot | Out-Null
$installationReceipt = Join-Path $InstallRoot "installation.json"

$installedScript = Join-Path $bootstrapRoot "install-managed-runtime.ps1"
$installedUpdateScript = Join-Path $bootstrapRoot "update-managed-runtime.ps1"
$installedBackupScript = Join-Path $bootstrapRoot "backup-managed-runtime.ps1"
$installedRestoreScript = Join-Path $bootstrapRoot "restore-managed-runtime.ps1"
$installedConfigureBackupScript = Join-Path $bootstrapRoot "configure-offhost-backup.ps1"
$installedRunBackupScript = Join-Path $bootstrapRoot "run-offhost-backup.ps1"
$installedBackupStatusScript = Join-Path $bootstrapRoot "offhost-backup-status.ps1"
$installedActivationScript = Join-Path $bootstrapRoot "activate-managed-runtime.ps1"
$installedUninstallScript = Join-Path $bootstrapRoot "uninstall-managed-runtime.ps1"
$installedAgent = Join-Path $bootstrapRoot "bms-runtime-agent.exe"
$installedKeyring = Join-Path $bootstrapRoot "trusted-release-keys.json"
$installedLocalCtl = Join-Path $bootstrapRoot "bms-localctl"
$installedTransaction = Join-Path $bootstrapRoot "bms-update-transaction"
if ([IO.Path]::GetFullPath($PSCommandPath) -ne [IO.Path]::GetFullPath($installedScript)) {
  Copy-Item -LiteralPath $PSCommandPath -Destination $installedScript -Force
}
foreach ($scriptCopy in @(
  @{ Source = (Join-Path $PSScriptRoot "setup-diagnostics.ps1"); Destination = (Join-Path $bootstrapRoot "setup-diagnostics.ps1") },
  @{ Source = (Join-Path $PSScriptRoot "update-managed-runtime.ps1"); Destination = $installedUpdateScript },
  @{ Source = (Join-Path $PSScriptRoot "backup-managed-runtime.ps1"); Destination = $installedBackupScript },
  @{ Source = (Join-Path $PSScriptRoot "restore-managed-runtime.ps1"); Destination = $installedRestoreScript },
  @{ Source = (Join-Path $PSScriptRoot "configure-offhost-backup.ps1"); Destination = $installedConfigureBackupScript },
  @{ Source = (Join-Path $PSScriptRoot "run-offhost-backup.ps1"); Destination = $installedRunBackupScript },
  @{ Source = (Join-Path $PSScriptRoot "offhost-backup-status.ps1"); Destination = $installedBackupStatusScript },
  @{ Source = (Join-Path $PSScriptRoot "activate-managed-runtime.ps1"); Destination = $installedActivationScript },
  @{ Source = (Join-Path $PSScriptRoot "uninstall-managed-runtime.ps1"); Destination = $installedUninstallScript }
)) {
  if ((Test-Path -LiteralPath $scriptCopy.Source -PathType Leaf) -and
      [IO.Path]::GetFullPath($scriptCopy.Source) -ne [IO.Path]::GetFullPath($scriptCopy.Destination)) {
    Copy-Item -LiteralPath $scriptCopy.Source -Destination $scriptCopy.Destination -Force
  }
}
if ([IO.Path]::GetFullPath($AgentPath) -ne [IO.Path]::GetFullPath($installedAgent)) {
  Copy-Item -LiteralPath $AgentPath -Destination $installedAgent -Force
}
if ([IO.Path]::GetFullPath($KeyringPath) -ne [IO.Path]::GetFullPath($installedKeyring)) {
  Copy-Item -LiteralPath $KeyringPath -Destination $installedKeyring -Force
}
foreach ($controlName in @("bms-localctl", "bms-update-transaction", "bms-wsl-keepalive")) {
  $controlSource = Join-Path $PSScriptRoot $controlName
  $controlDestination = Join-Path $bootstrapRoot $controlName
  if ((Test-Path -LiteralPath $controlSource -PathType Leaf) -and
      [IO.Path]::GetFullPath($controlSource) -ne [IO.Path]::GetFullPath($controlDestination)) {
    Copy-Item -LiteralPath $controlSource -Destination $controlDestination -Force
  }
}
$interactiveUser = try { [string](Get-CimInstance Win32_ComputerSystem).UserName } catch { "" }
$installAclArguments = @(
  $InstallRoot,
  "/inheritance:r",
  "/grant:r",
  "Administrators:(OI)(CI)F",
  "SYSTEM:(OI)(CI)F",
  "${env:USERNAME}:(OI)(CI)F"
)
if (-not [string]::IsNullOrWhiteSpace($interactiveUser) -and $interactiveUser -ne $env:USERNAME) {
  $installAclArguments += "${interactiveUser}:(OI)(CI)RX"
}
& icacls @installAclArguments *> $null
if ($LASTEXITCODE -ne 0) { throw "จำกัดสิทธิ์ installation directory ไม่สำเร็จ" }

if (Test-Path -LiteralPath $installationReceipt -PathType Leaf) {
  $script:BmsSetupStage = 'repair-existing-install'
  $existingDistro = Invoke-WslCommand -Arguments @("--list", "--quiet") -Quiet
  if ($existingDistro.ExitCode -ne 0 -or $distroName -notin @($existingDistro.Output | ForEach-Object { ([string]$_).Trim() })) {
    throw "Existing shop runtime is unavailable. Preserve shop data and collect diagnostics."
  }
  Start-ManagedRuntime
  & $installedUpdateScript -ManifestUri $ManifestUri -InstallRoot $InstallRoot -ConfirmUpdate -RepairSameVersion
  Register-LicenseUIBridge
  Unregister-ScheduledTask -TaskName "BMS Retail Local Setup Resume" -Confirm:$false -ErrorAction SilentlyContinue
  Show-SetupCompletion
  return
}

Write-Step 1 "ตรวจสอบ Windows, CPU, RAM, WSL, Virtualization และพื้นที่ว่าง"
$preflightOutput = & $installedAgent preflight 2>&1
$preflightExit = $LASTEXITCODE
try {
  $preflight = (($preflightOutput -join [Environment]::NewLine) | ConvertFrom-Json)
} catch {
  throw "อ่านผล preflight ไม่ได้: $($preflightOutput -join ' ')"
}
foreach ($message in @($preflight.warnings)) { Write-Warning $message }
if ($preflightExit -ne 0 -or -not $preflight.ok) {
  $failureMessages = if ($null -ne $preflight.failures) { @($preflight.failures) } else { @("preflight ไม่ผ่าน") }
  throw (($failureMessages + "กรุณาแก้ไขรายการด้านบนแล้วเปิด Setup อีกครั้ง") -join [Environment]::NewLine)
}
if ([string]$preflight.target -eq "windows-10-22h2-esu-x64") {
  Write-Host "Windows 10 22H2 รองรับเฉพาะเครื่องที่มี Extended Security Updates (ESU) ปัจจุบัน" -ForegroundColor Yellow
  $esuAnswer = Read-Host "ตรวจหลักฐาน ESU แล้วให้พิมพ์ ESU-VERIFIED"
  if ($esuAnswer -cne "ESU-VERIFIED") { throw "ไม่ติดตั้งบน Windows 10 22H2 ที่ไม่มีหลักฐาน ESU" }
}

# Public setup never asks for or redeems an activation code. Keep any license
# already redeemed by an older reboot-resume flow; new registrations use Activate or Transfer.
Write-Host "ติดตั้งและทดลองใช้งานได้ทันทีโดยไม่ต้องมี Activation Code"

if ($preflight.requiresReboot) {
  & dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart | Out-Null
  if ($LASTEXITCODE -notin @(0, 3010)) { throw "เปิด Windows Subsystem for Linux ไม่สำเร็จ" }
  & dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart | Out-Null
  if ($LASTEXITCODE -notin @(0, 3010)) { throw "เปิด Virtual Machine Platform ไม่สำเร็จ" }
  $resumePath = Join-Path $bootstrapRoot "resume.json"
  $resumeJson = [ordered]@{
    installerVersion = $InstallerVersion
    packageType = $PackageType
    manifestUri = $ManifestUri
    installRoot = $InstallRoot
    activationUri = $ActivationUri
    licenseId = $LicenseId
    licenseEvidenceUri = $LicenseEvidenceUri
    licenseEvidenceToken = $LicenseEvidenceToken
  } | ConvertTo-Json
  Write-Utf8NoBom $resumePath $resumeJson
  $resumeAction = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$installedScript`" -ResumeConfig `"$resumePath`""
  $resumeTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $resumePrincipal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
  Register-ScheduledTask -TaskName "BMS Retail Local Setup Resume" -Action $resumeAction `
    -Trigger $resumeTrigger -Principal $resumePrincipal -Force | Out-Null
  Write-Host "ต้อง restart Windows หนึ่งครั้ง ระบบจะติดตั้งต่อให้อัตโนมัติ" -ForegroundColor Yellow
  $answer = Read-Host "พิมพ์ RESTART เพื่อ restart ตอนนี้"
  if ($answer -ceq "RESTART") { Restart-Computer -Force }
  exit 3010
}

$provisionCheckpoint = "$runtimeData/provision-result.json"
Write-Step 2 "ติดตั้งหรืออัปเดต private WSL runtime"
$wslVersion = $null
for ($attempt = 1; $attempt -le 6; $attempt++) {
  $wslVersion = Invoke-WslCommand -Arguments @("--version") -Quiet
  if ($wslVersion.ExitCode -eq 0) { break }
  if (($wslVersion.Output -join " ") -notmatch 'finishing an upgrade|กำลัง.*อัปเกรด') { break }
  Write-Progress -Id 18 -Activity "กำลังรอ Windows Subsystem for Linux" `
    -Status "WSL กำลังปิดงานอัปเกรดเดิม ($attempt/6)" -PercentComplete ([int](($attempt / 6) * 100))
  Write-Host "  WSL กำลังปิดงานอัปเกรดเดิม รอ 10 วินาทีแล้วตรวจใหม่ ($attempt/6)..." -ForegroundColor Yellow
  Start-Sleep -Seconds 10
}
Write-Progress -Id 18 -Activity "กำลังรอ Windows Subsystem for Linux" -Completed
if ($wslVersion.ExitCode -eq 0) {
  $versionLine = @($wslVersion.Output | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -First 1)
  $versionSuffix = if ($versionLine.Count) { ": $([string]$versionLine[0])" } else { "" }
  Write-Host "  WSL พร้อมใช้งาน$versionSuffix" -ForegroundColor Green
} else {
  Write-Host "  กำลังติดตั้งหรืออัปเดต WSL อาจใช้เวลาหลายนาที..."
  $wslUpdate = Invoke-WslCommand -Arguments @("--update", "--web-download")
  if ($wslUpdate.ExitCode -ne 0) {
    throw "ติดตั้ง/อัปเดต WSL ไม่สำเร็จ: $($wslUpdate.Output -join ' ')"
  }
}

$releaseRoot = Join-Path $InstallRoot "release"
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
$manifestPath = Join-Path $releaseRoot "release.jws.json"
Write-Step 3 "ดาวน์โหลดและตรวจสอบ release ที่ลงลายเซ็น"
try {
  Invoke-WebRequest -Uri $ManifestUri -OutFile $manifestPath -UseBasicParsing -TimeoutSec 60
} catch {
  throw "ดาวน์โหลด signed release manifest ไม่สำเร็จจาก $ManifestUri : $($_.Exception.Message)"
}

$stageCommand = if ($PackageType -eq 'server') { 'stage-server' } else { 'stage-release' }
$stage = Invoke-AgentJson @($stageCommand, "-manifest", $manifestPath, "-keyring", $installedKeyring,
  "-target", [string]$preflight.target, "-root", $InstallRoot, "-progress")
$release = Invoke-AgentJson @("verify-release", "-manifest", $manifestPath, "-keyring", $installedKeyring,
  "-target", [string]$preflight.target)
$releaseDirectory = [IO.Path]::GetFullPath([string]$stage.releaseDirectory)
$archetypeArtifact = Get-ArtifactPath $release "shop-archetypes"
$archetypeCatalog = Get-ShopArchetypeCatalog $archetypeArtifact.path

Write-Step 4 "ติดตั้ง private WSL runtime"
$runtime = Get-ArtifactPath $release "runtime"
$installedDistroResult = Invoke-WslCommand -Arguments @("--list", "--quiet") -Quiet
if ($installedDistroResult.ExitCode -ne 0) { throw "อ่านรายชื่อ WSL ไม่สำเร็จ กรุณา restart Windows แล้วเปิด Setup อีกครั้ง; ระบบจะไม่ลบ runtime เดิม" }
$installedDistros = @($installedDistroResult.Output | ForEach-Object { ([string]$_).Trim([char]0).Trim() })
if ($distroName -notin $installedDistros) {
  # A cancelled import can leave an unregistered VHD. Preserve it and use a fresh directory.
  $wslRoot = Join-Path $InstallRoot ("wsl-import-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $wslRoot | Out-Null
  Write-Host "  กำลังแตก private runtime ลง WSL2 อาจใช้เวลา 1-3 นาที กรุณาอย่าปิดหน้าต่างนี้..."
  $wslImport = Invoke-WslCommand -Arguments @("--import", $distroName, $wslRoot, $runtime.path, "--version", "2")
  if ($wslImport.ExitCode -ne 0) { throw "Import private BMSRuntime WSL distribution ไม่สำเร็จ: $($wslImport.Output -join ' ')" }
}

Start-ManagedRuntime

foreach ($control in @(
  @{ Source = $installedLocalCtl; Name = "bms-localctl" },
  @{ Source = $installedTransaction; Name = "bms-update-transaction" }
)) {
  if (-not (Test-Path -LiteralPath $control.Source -PathType Leaf)) { throw "ไม่พบ runtime control $($control.Source)" }
  & $installedAgent runtime-install-control -engine windows-wsl -distro $distroName `
    -source $control.Source -name $control.Name
  if ($LASTEXITCODE -ne 0) { throw "ติดตั้ง runtime control $($control.Name) ไม่สำเร็จ" }
}

$script:loadingImagesShown = $false
foreach ($component in @($release.components | Where-Object kind -eq "oci-image")) {
  if (-not $script:loadingImagesShown) {
    Write-Step 5 "โหลด Web, WS, PostgreSQL และ Redis"
    $script:loadingImagesShown = $true
  }
  $artifact = Get-ArtifactPath $release ([string]$component.name)
  Invoke-AgentProgress @("engine-load", "-engine", "windows-wsl", "-distro", $distroName,
    "-artifact", $artifact.path, "-image-ref", [string]$component.imageRef,
    "-digest", [string]$component.ociDigest, "-progress")
}

$script:BmsSetupStage = 'configure-compose'
$compose = Get-ArtifactPath $release "compose"
& $installedAgent runtime-write -engine windows-wsl -distro $distroName -source $compose.path `
  -destination "$runtimeData/compose.yml" -mode "0600"
if ($LASTEXITCODE -ne 0) { throw "ติดตั้ง Compose contract ไม่สำเร็จ" }

$byName = @{}
foreach ($component in $release.components) { $byName[[string]$component.name] = $component }
$runtimeEnvTest = Invoke-WslCommand -Arguments @("-d", $distroName, "-u", "root", "--", "test", "-f", "$runtimeData/.env") -Quiet
$runtimeEnvExists = $runtimeEnvTest.ExitCode -eq 0
if (-not $runtimeEnvExists) {
  $envLines = @(
    "POSTGRES_DB=bms_local",
    "POSTGRES_PASSWORD=$(New-HexSecret 24)",
    "REDIS_PASSWORD=$(New-HexSecret 24)",
    "JWT_SECRET=$(New-HexSecret 48)",
    "BMS_SECRET_KEY=$(New-HexSecret 32)",
    "BMS_CHECKOUT_SECRET=$(New-HexSecret 48)",
    "BMS_CRON_SECRET=$(New-HexSecret 32)",
    "BMS_JOB_TOKEN=$(New-HexSecret 32)",
    "BMS_LOCAL_WEB_PORT=3100",
    "BMS_LOCAL_WS_PORT=3101",
    "BMS_WEB_IMAGE_REF=$($byName.web.imageRef)",
    "BMS_WS_IMAGE_REF=$($byName.ws.imageRef)",
    "BMS_POSTGRES_IMAGE_REF=$($byName.postgres.imageRef)",
    "BMS_REDIS_IMAGE_REF=$($byName.redis.imageRef)"
  )
  Write-RuntimeText "$runtimeData/.env" (($envLines -join "`n") + "`n")
}

$script:BmsSetupStage = 'provision-shop'
$checkpointTest = Invoke-WslCommand -Arguments @("-d", $distroName, "-u", "root", "--", "test", "-f", $provisionCheckpoint) -Quiet
if ($checkpointTest.ExitCode -eq 0) {
  $checkpointRead = Invoke-WslCommand -Arguments @("-d", $distroName, "-u", "root", "--", "cat", $provisionCheckpoint) -Quiet
  if ($checkpointRead.ExitCode -ne 0) { throw "อ่าน checkpoint ของร้านไม่สำเร็จ" }
  $provisionResult = (($checkpointRead.Output -join [Environment]::NewLine) | ConvertFrom-Json)
  $businessArchetype = [string]$provisionResult.businessArchetype
  $sampleMode = if (($provisionResult.PSObject.Properties.Name -contains "sampleData") -and
      $null -ne $provisionResult.sampleData -and
      ($provisionResult.sampleData.PSObject.Properties.Name -contains "mode") -and
      $provisionResult.sampleData.mode) { [string]$provisionResult.sampleData.mode } else { "NONE" }
  Write-Host "พบข้อมูลร้านเดิม กำลังติดตั้งต่อจากจุดที่ค้าง" -ForegroundColor Yellow
} else {
  $shopName = Read-RequiredText "ชื่อร้าน"
  $businessArchetype = Read-MenuChoice "ประเภทร้าน (ใช้กำหนดค่าเริ่มต้นและตัวอย่างสินค้า)" `
    $archetypeCatalog.Options $archetypeCatalog.DefaultValue
  $selectedArchetype = @($archetypeCatalog.Options | Where-Object Value -eq $businessArchetype)[0]
  if ($selectedArchetype.StarterCatalog) {
    $sampleMode = Read-MenuChoice "ต้องการสร้าง Starter Catalog หรือไม่? (Draft, สต็อก 0, ยังขายไม่ได้)" @(
      [pscustomobject]@{ Value = "STARTER_CATALOG"; Label = "สร้างข้อมูลตัวอย่างตามประเภทร้าน" },
      [pscustomobject]@{ Value = "NONE"; Label = "ไม่สร้างข้อมูลตัวอย่าง" }
    ) "STARTER_CATALOG"
  } else {
    $sampleMode = "NONE"
    Write-Host "ประเภทร้านนี้ไม่มี Starter Catalog ใน release ปัจจุบัน; เริ่มจากร้านเปล่า" -ForegroundColor Yellow
  }
  $adminName = Read-RequiredText "ชื่อผู้ดูแลร้าน"
  $adminEmail = Read-EmailAddress
  $adminPassword = Read-ConfirmedSecret "รหัสผ่านผู้ดูแล (อย่างน้อย 8 ตัวอักษร)" `
    "ยืนยันรหัสผ่านอีกครั้ง" '^.{8,}$' "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษรและตรงกัน กรุณากรอกใหม่"
  $adminPin = Read-ConfirmedSecret "PIN ขายหน้าร้าน (ตัวเลข 4-8 หลัก)" `
    "ยืนยัน PIN อีกครั้ง" '^\d{4,8}$' "PIN ต้องเป็นตัวเลข 4-8 หลักและตรงกัน กรุณากรอกใหม่"
  Assert-NoLineBreak "ชื่อร้าน" $shopName
  Assert-NoLineBreak "ชื่อผู้ดูแล" $adminName
  Assert-NoLineBreak "อีเมล" $adminEmail
  Assert-NoLineBreak "รหัสผ่าน" $adminPassword
  Assert-NoLineBreak "PIN" $adminPin

  $provisionScript = @(
    "#!/bin/sh",
    "set -eu",
    (ConvertTo-ShellExport "BMS_LOCAL_SHOP_NAME" $shopName),
    (ConvertTo-ShellExport "BMS_LOCAL_SHOP_SLUG" "local-shop"),
    (ConvertTo-ShellExport "BMS_LOCAL_ADMIN_NAME" $adminName),
    (ConvertTo-ShellExport "BMS_LOCAL_ADMIN_EMAIL" $adminEmail),
    (ConvertTo-ShellExport "BMS_LOCAL_ADMIN_PASSWORD" $adminPassword),
    (ConvertTo-ShellExport "BMS_LOCAL_ADMIN_PIN" $adminPin),
    (ConvertTo-ShellExport "BMS_LOCAL_BUSINESS_ARCHETYPE" $businessArchetype),
    (ConvertTo-ShellExport "BMS_LOCAL_SAMPLE_MODE" $sampleMode),
    "cd $runtimeData",
    "docker compose --env-file .env -f compose.yml --profile setup run --rm provision"
  ) -join "`n"
  Write-RuntimeText "$runtimeData/provision-once.sh" ($provisionScript + "`n") "0700"
  $adminPassword = $null
  $adminPin = $null
  $provisionRun = Invoke-WslCommand -Arguments @("-d", $distroName, "-u", "root", "--", "$runtimeData/provision-once.sh") -Quiet
  $provisionOutput = $provisionRun.Output
  $provisionExit = $provisionRun.ExitCode
  [void](Invoke-WslCommand -Arguments @("-d", $distroName, "-u", "root", "--", "rm", "-f", "$runtimeData/provision-once.sh") -Quiet)
  if ($provisionExit -ne 0) { throw ($provisionOutput -join [Environment]::NewLine) }
  $resultLine = $provisionOutput | Where-Object { $_ -match '^\{"status"' } | Select-Object -Last 1
  if (-not $resultLine) { throw "Provisioning สำเร็จแต่ไม่พบผลลัพธ์ที่อ่านได้" }
  $provisionResult = $resultLine | ConvertFrom-Json
  Write-RuntimeText $provisionCheckpoint ($resultLine + "`n") "0600"
}

$sampleStatus = "SKIPPED"
if ($provisionResult.PSObject.Properties.Name -contains "sampleData" -and $null -ne $provisionResult.sampleData) {
  $sampleStatus = [string]$provisionResult.sampleData.status
}
if ($sampleMode -eq "STARTER_CATALOG" -and $sampleStatus -notin @("COMPLETED", "ALREADY_COMPLETED")) {
  # The protected checkpoint already contains the one-time token. Sample generation is therefore
  # safe to retry after an interrupted setup without recreating the shop or losing pairing.
  if ($sampleStatus -ne "PENDING") {
    Write-Warning "ผล provisioning ไม่มีสถานะข้อมูลตัวอย่างที่สำเร็จ กำลังลองสร้างตามตัวเลือกของผู้ใช้"
  }
  try {
    $sampleOutput = Invoke-WslDocker @("compose", "--env-file", "$runtimeData/.env", "-f",
      "$runtimeData/compose.yml", "--profile", "setup", "run", "--rm", "sample-data")
    $sampleLine = $sampleOutput | Where-Object { $_ -match '^\{"status"' } | Select-Object -Last 1
    if (-not $sampleLine) { throw "sample data process did not return a readable result" }
    $parsedSampleData = $sampleLine | ConvertFrom-Json
    if ($provisionResult.PSObject.Properties.Name -contains "sampleData") {
      $provisionResult.sampleData = $parsedSampleData
    } else {
      $provisionResult | Add-Member -NotePropertyName sampleData -NotePropertyValue $parsedSampleData
    }
    if (($provisionResult.sampleData.status -in @("COMPLETED", "ALREADY_COMPLETED")) -and
        -not (Test-CompletedSampleData $provisionResult.sampleData $businessArchetype)) {
      throw "sample data result is incomplete"
    }
    $provisionResult.sampleData | Add-Member -NotePropertyName mode -NotePropertyValue $sampleMode -Force
  } catch {
    $failedSampleData = [pscustomobject]@{
      status = "FAILED"
      requested = $true
      mode = $sampleMode
      message = "สร้างข้อมูลตัวอย่างยังไม่สำเร็จ สามารถลองใหม่จากหน้าเริ่มต้นใช้งาน"
    }
    if ($provisionResult.PSObject.Properties.Name -contains "sampleData") {
      $provisionResult.sampleData = $failedSampleData
    } else {
      $provisionResult | Add-Member -NotePropertyName sampleData -NotePropertyValue $failedSampleData
    }
  }
  $sampleStatus = [string]$provisionResult.sampleData.status
  Write-RuntimeText $provisionCheckpoint (($provisionResult | ConvertTo-Json -Compress -Depth 10) + "`n") "0600"
}
if ($sampleStatus -in @("COMPLETED", "ALREADY_COMPLETED")) {
  Write-Host "สร้างข้อมูลตัวอย่างตามประเภทร้านแล้ว" -ForegroundColor Green
} elseif ($sampleStatus -eq "FAILED") {
  Write-Warning "ข้อมูลตัวอย่างยังสร้างไม่ครบ ร้านยังใช้งานได้ และลองใหม่จากหน้าเริ่มต้นใช้งานได้"
}

Write-Step 6 "เริ่มบริการและตรวจสุขภาพระบบ"
Invoke-WslDocker @("compose", "--env-file", "$runtimeData/.env", "-f", "$runtimeData/compose.yml", "up", "-d") | Out-Null
$healthDeadline = [DateTime]::UtcNow.AddMinutes(4)
$web = $null
$ws = $null
$healthAttempt = 0
do {
  $healthAttempt++
  try {
    $web = Invoke-WebRequest -Uri "http://127.0.0.1:3100/admin/login" -UseBasicParsing -TimeoutSec 5
    $ws = Invoke-WebRequest -Uri "http://127.0.0.1:3101/readyz" -UseBasicParsing -TimeoutSec 5
    if ($web.StatusCode -eq 200 -and $ws.StatusCode -eq 200) { break }
  } catch {}
  $healthPercent = [Math]::Min(99, [int](($healthAttempt / 80) * 100))
  Write-Progress -Id 20 -Activity "กำลังตรวจสุขภาพ BMS Retail Local" `
    -Status "รอ Web และ Realtime service ($healthPercent%)" -PercentComplete $healthPercent
  if ($healthAttempt % 5 -eq 0) { Write-Host "  ยังทำงานอยู่: กำลังรอ Web และ Realtime service ($($healthAttempt * 3) วินาที)..." }
  Start-Sleep -Seconds 3
} while ([DateTime]::UtcNow -lt $healthDeadline)
Write-Progress -Id 20 -Activity "กำลังตรวจสุขภาพ BMS Retail Local" -Completed
if (-not $web -or -not $ws -or $web.StatusCode -ne 200 -or $ws.StatusCode -ne 200) { throw "บริการไม่ผ่าน HTTP health check" }

if ($PackageType -eq 'server-pos') {
  $desktop = Get-ArtifactPath $release "desktop"
  $desktopInstaller = Join-Path $releaseDirectory "BMS-POS-Setup.exe"
  Copy-Item -LiteralPath $desktop.path -Destination $desktopInstaller -Force
  $script:BmsSetupStage = 'install-desktop'
  $desktopProcess = Start-Process -FilePath $desktopInstaller -ArgumentList "/S", "/allusers" -Wait -PassThru
  if ($desktopProcess.ExitCode -ne 0) { throw "ติดตั้ง BMS POS Desktop ไม่สำเร็จ" }
  $desktopExecutable = @(
    (Join-Path $env:ProgramFiles "BMS POS\BMS POS.exe")
    $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} "BMS POS\BMS POS.exe" })
    (Join-Path $env:LOCALAPPDATA "Programs\BMS POS\BMS POS.exe")
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
  if (-not $desktopExecutable) { throw "ติดตั้งแล้วแต่ไม่พบ BMS POS.exe" }

  $desktopArguments = ""
  if ($provisionResult.deviceToken -and -not [string]::IsNullOrWhiteSpace($interactiveUser)) {
    $handoffPath = Join-Path $InstallRoot "pairing-handoff.json"
    [ordered]@{
      version = 1
      serverUrl = "http://127.0.0.1:3100"
      token = [string]$provisionResult.deviceToken
      expiresAt = [DateTimeOffset]::UtcNow.AddMinutes(10).ToString("o")
    } | ConvertTo-Json -Compress | ForEach-Object { Write-Utf8NoBom $handoffPath $_ }
    & icacls $handoffPath /inheritance:r /grant:r "Administrators:F" "SYSTEM:F" "${interactiveUser}:F" *> $null
    if ($LASTEXITCODE -ne 0) { throw "จำกัดสิทธิ์ pairing handoff ไม่สำเร็จ" }
    $desktopArguments = "--pairing-handoff=`"$handoffPath`""
  } elseif ($provisionResult.deviceToken) {
    Write-Warning "ไม่พบผู้ใช้ Windows ที่ล็อกอินอยู่; ไม่เขียน pairing token ลงดิสก์"
  }

  if ([string]::IsNullOrWhiteSpace($interactiveUser)) {
    Write-Warning "ไม่พบผู้ใช้ Windows ที่ล็อกอินอยู่; เปิด BMS POS จาก Public Desktop เพื่อจับคู่ภายหลัง"
  } else {
    $pairingTaskName = "BMS Retail Local POS Pairing"
    $pairingAction = if ([string]::IsNullOrWhiteSpace($desktopArguments)) {
      New-ScheduledTaskAction -Execute $desktopExecutable
    } else {
      New-ScheduledTaskAction -Execute $desktopExecutable -Argument $desktopArguments
    }
    $pairingTrigger = New-ScheduledTaskTrigger -Once -At ([DateTime]::Now.AddHours(1))
    $pairingPrincipal = New-ScheduledTaskPrincipal -UserId $interactiveUser -LogonType Interactive -RunLevel Limited
    $pairingSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
    Register-ScheduledTask -TaskName $pairingTaskName -Action $pairingAction -Trigger $pairingTrigger `
      -Principal $pairingPrincipal -Settings $pairingSettings -Force | Out-Null
    try {
      Start-ScheduledTask -TaskName $pairingTaskName
      Start-Sleep -Seconds 5
    } finally {
      Unregister-ScheduledTask -TaskName $pairingTaskName -Confirm:$false -ErrorAction SilentlyContinue
    }
  }
}

[ordered]@{
  product = "BMS Retail Local"
  packageType = $PackageType
  version = [string]$release.releaseVersion
  platformTarget = [string]$release.platformTarget
  installedAt = [DateTimeOffset]::Now.ToString("o")
  updatedAt = [DateTimeOffset]::Now.ToString("o")
  sourceCommit = [string]$release.sourceCommit
  schemaVersion = [string]$release.schemaVersion
  url = "http://127.0.0.1:3100"
  tenantId = $provisionResult.tenantId
  adminUserId = $provisionResult.adminUserId
  posDeviceId = $provisionResult.deviceId
  businessArchetype = $provisionResult.businessArchetype
  sampleMode = $sampleMode
  sampleStatus = $sampleStatus
  licenseCode = if ([string]::IsNullOrWhiteSpace($LicenseId)) { $null } else { $LicenseId }
} | ConvertTo-Json | ForEach-Object { Write-Utf8NoBom "$installationReceipt.prepared" $_ }
& $installedAgent runtime-write -engine windows-wsl -distro $distroName -source "$installationReceipt.prepared" `
  -destination "$runtimeData/installation.json" -mode "0600"
if ($LASTEXITCODE -ne 0) { throw "บันทึก installation receipt ใน private runtime ไม่สำเร็จ" }
Write-Utf8NoBom $installationReceipt (Read-Utf8Text "$installationReceipt.prepared")
Remove-Item -LiteralPath "$installationReceipt.prepared" -Force
[void](Invoke-WslCommand -Arguments @("-d", $distroName, "-u", "root", "--", "rm", "-f", $provisionCheckpoint) -Quiet)

# Anonymous successful-install inventory. Random local identity only: no serial,
# MAC address, customer data, or business transactions. Never fail setup on it.
if (-not [string]::IsNullOrWhiteSpace($ActivationUri)) {
  try {
    & $installedAgent installation-report -root $InstallRoot -control-uri $ActivationUri `
      -event INSTALLED -package-type $PackageType -target ([string]$release.platformTarget) `
      -release-version ([string]$release.releaseVersion) -tenant-reference ([string]$provisionResult.tenantId) `
      -license-reference $LicenseId -force *> $null
    if ($LASTEXITCODE -ne 0) { throw "installation registry unavailable" }
  } catch { Write-Warning "ส่งข้อมูลการติดตั้งขั้นต่ำไม่สำเร็จ; การติดตั้งยังสำเร็จและจะลองใหม่ภายหลัง" }
}

# License evidence is administrative telemetry only. It is intentionally best-effort and must not
# change installation success, runtime startup, sales, payment, data access, backup, or recovery.
Register-LicenseUIBridge
if (-not [string]::IsNullOrWhiteSpace($LicenseId)) {
  try {
    $licenseArguments = @(
      "license-record", "-root", $InstallRoot, "-event", "INSTALLATION_REGISTERED",
      "-license-id", $LicenseId, "-tenant-id", [string]$provisionResult.tenantId,
      "-pos-device-id", [string]$provisionResult.deviceId, "-target", [string]$release.platformTarget,
      "-release-version", [string]$release.releaseVersion
    )
    if (-not [string]::IsNullOrWhiteSpace($LicenseEvidenceUri) -and
        -not [string]::IsNullOrWhiteSpace($LicenseEvidenceToken)) {
      $licenseArguments += @("-endpoint", $LicenseEvidenceUri)
    } elseif (-not [string]::IsNullOrWhiteSpace($LicenseEvidenceUri)) {
      Write-Warning "มี Licensing endpoint แต่ไม่มี ingestion token; เก็บหลักฐานไว้ในเครื่องเท่านั้น"
    }
    $previousEvidenceToken = [Environment]::GetEnvironmentVariable("BMS_LICENSE_EVIDENCE_TOKEN", "Process")
    try {
      [Environment]::SetEnvironmentVariable("BMS_LICENSE_EVIDENCE_TOKEN", $LicenseEvidenceToken, "Process")
      $licenseOutput = & $installedAgent @licenseArguments 2>&1
      if ($LASTEXITCODE -ne 0) { throw ($licenseOutput -join ' ') }
    } finally {
      [Environment]::SetEnvironmentVariable("BMS_LICENSE_EVIDENCE_TOKEN", $previousEvidenceToken, "Process")
    }
  } catch {
    Write-Warning "เก็บ/ตั้งเวลาหลักฐาน Licensing ไม่สำเร็จ แต่ร้านยังใช้งานต่อได้: $($_.Exception.Message)"
  }
}

if ($ResumeConfig -and (Test-Path -LiteralPath $ResumeConfig)) { Remove-Item -LiteralPath $ResumeConfig -Force }
Unregister-ScheduledTask -TaskName "BMS Retail Local Setup Resume" -Confirm:$false -ErrorAction SilentlyContinue
Show-SetupCompletion
