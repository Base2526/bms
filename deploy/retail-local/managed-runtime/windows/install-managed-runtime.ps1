[CmdletBinding()]
param(
  [string]$ManifestUri,
  [string]$AgentPath = (Join-Path $PSScriptRoot "bms-runtime-agent.exe"),
  [string]$KeyringPath = (Join-Path $PSScriptRoot "trusted-release-keys.json"),
  [string]$InstallRoot = (Join-Path $env:ProgramData "BMS\RetailLocal"),
  [string]$ActivationUri,
  [string]$LicenseId,
  [string]$LicenseEvidenceUri,
  [string]$ResumeConfig
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
trap {
  Write-Host "`nBMS Retail Local Setup ยังไม่สำเร็จ" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
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
  [IO.File]::WriteAllText($Path, $Contents, [Text.UTF8Encoding]::new($false))
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
  $manifest = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
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

function Write-Step([int]$Number, [string]$Message) {
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

function Read-BusinessArchetype {
  $options = @(
    [pscustomobject]@{ Value = "mini_mart"; Label = "ร้านสะดวกซื้อ / ร้านขายของชำ" },
    [pscustomobject]@{ Value = "fashion"; Label = "แฟชั่นและเสื้อผ้า" },
    [pscustomobject]@{ Value = "home_kitchen"; Label = "บ้านและเครื่องครัว" },
    [pscustomobject]@{ Value = "beauty_personal_care"; Label = "ความงามและของใช้ส่วนตัว" },
    [pscustomobject]@{ Value = "food_beverage"; Label = "อาหารและเครื่องดื่มพร้อมขาย" },
    [pscustomobject]@{ Value = "gadgets_accessories"; Label = "อุปกรณ์ไอทีและแกดเจ็ต" },
    [pscustomobject]@{ Value = "b2b_wholesale"; Label = "ค้าส่ง / B2B" },
    [pscustomobject]@{ Value = "gifts_seasonal"; Label = "ของขวัญและสินค้าตามเทศกาล" },
    [pscustomobject]@{ Value = "pharmacy"; Label = "ร้านยา" },
    [pscustomobject]@{ Value = "pet_supply"; Label = "ร้านอุปกรณ์สัตว์เลี้ยง" },
    [pscustomobject]@{ Value = "building_materials"; Label = "ร้านวัสดุก่อสร้าง" },
    [pscustomobject]@{ Value = "restaurant"; Label = "ร้านอาหาร / ระบบครัว" },
    [pscustomobject]@{ Value = "board_game_cafe"; Label = "คาเฟ่บอร์ดเกม" },
    [pscustomobject]@{ Value = "other"; Label = "ร้านประเภทอื่น" }
  )
  Write-Host "`nประเภทร้าน (ใช้กำหนดหน้าจอ ความสามารถ และสินค้าในข้อมูลตัวอย่าง)"
  for ($index = 0; $index -lt $options.Count; $index++) {
    Write-Host ("{0,2}) {1}" -f ($index + 1), $options[$index].Label)
  }
  while ($true) {
    $choice = 0
    $raw = Read-Host "เลือกประเภทร้าน 1-$($options.Count)"
    if ([int]::TryParse($raw, [ref]$choice) -and $choice -ge 1 -and $choice -le $options.Count) {
      return [string]$options[$choice - 1].Value
    }
    Write-Warning "กรุณาเลือกหมายเลข 1-$($options.Count)"
  }
}

function Read-SampleDataChoice {
  while ($true) {
    $answer = (Read-Host "สร้างข้อมูลตัวอย่างตามประเภทร้านนี้หรือไม่? [y/N]").Trim()
    if ([string]::IsNullOrEmpty($answer) -or $answer -match '^(n|no)$') { return $false }
    if ($answer -match '^(y|yes)$') { return $true }
    Write-Warning "กรุณาตอบ y หรือ n"
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
  $output = & $script:installedAgent @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($output -join [Environment]::NewLine) }
  return (($output -join [Environment]::NewLine) | ConvertFrom-Json)
}

function Invoke-WslDocker([string[]]$Arguments) {
  $output = & wsl.exe -d $distroName -u root -- docker @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($output -join [Environment]::NewLine) }
  return $output
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

Assert-Administrator

if ($ResumeConfig) {
  $resume = Get-Content -LiteralPath $ResumeConfig -Raw | ConvertFrom-Json
  $ManifestUri = [string]$resume.manifestUri
  $InstallRoot = [string]$resume.installRoot
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
foreach ($controlName in @("bms-localctl", "bms-update-transaction")) {
  $controlSource = Join-Path $PSScriptRoot $controlName
  $controlDestination = Join-Path $bootstrapRoot $controlName
  if ((Test-Path -LiteralPath $controlSource -PathType Leaf) -and
      [IO.Path]::GetFullPath($controlSource) -ne [IO.Path]::GetFullPath($controlDestination)) {
    Copy-Item -LiteralPath $controlSource -Destination $controlDestination -Force
  }
}
& icacls $InstallRoot /inheritance:r /grant:r "Administrators:(OI)(CI)F" "SYSTEM:(OI)(CI)F" "${env:USERNAME}:(OI)(CI)F" *> $null
if ($LASTEXITCODE -ne 0) { throw "จำกัดสิทธิ์ installation directory ไม่สำเร็จ" }

if (-not $ResumeConfig -and (Test-Path -LiteralPath $installationReceipt -PathType Leaf)) {
  & $installedUpdateScript -ManifestUri $ManifestUri -InstallRoot $InstallRoot -ConfirmUpdate
  exit 0
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

# Activation is a one-time bootstrap only. Failure stays visible but never prevents setup or later
# shop operations; support can issue a new activation code after installation.
if (-not [string]::IsNullOrWhiteSpace($ActivationUri) -and [string]::IsNullOrWhiteSpace($LicenseId)) {
  $activationCode = ConvertTo-PlainSecret (Read-Host "Activation Code (เว้นว่างเพื่อติดตั้งและติดต่อ Support ภายหลัง)" -AsSecureString)
  if (-not [string]::IsNullOrWhiteSpace($activationCode)) {
    try {
      $activationBody = @{ activationCode = $activationCode } | ConvertTo-Json -Compress
      $activation = Invoke-RestMethod -Uri $ActivationUri -Method Post -ContentType "application/json" `
        -Body $activationBody -TimeoutSec 15
      $LicenseId = [string]$activation.licenseCode
      $activationUrl = [Uri]$ActivationUri
      $LicenseEvidenceUri = "$($activationUrl.GetLeftPart([UriPartial]::Authority))/api/bms/retail-local/license-evidence"
      $LicenseEvidenceToken = [string]$activation.ingestionToken
      Assert-NoLineBreak "License ID" $LicenseId
      Assert-HttpsUri $LicenseEvidenceUri
      Assert-NoLineBreak "License evidence token" $LicenseEvidenceToken
      Write-Host "Activation สำเร็จ" -ForegroundColor Green
    } catch {
      Write-Warning "Activation ยังไม่สำเร็จ แต่การติดตั้งและการใช้งานร้านจะดำเนินต่อ: $($_.Exception.Message)"
      $LicenseId = ""
      $LicenseEvidenceUri = ""
      $LicenseEvidenceToken = ""
    } finally {
      $activationCode = $null
      $activationBody = $null
    }
  }
}

if ($preflight.requiresReboot) {
  & dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "เปิด Windows Subsystem for Linux ไม่สำเร็จ" }
  & dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "เปิด Virtual Machine Platform ไม่สำเร็จ" }
  $resumePath = Join-Path $bootstrapRoot "resume.json"
  $resumeJson = [ordered]@{
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

Write-Step 2 "รับข้อมูลร้านและผู้ดูแล"
$provisionCheckpoint = "$runtimeData/provision-result.json"
$hasProvisionCheckpoint = $false
$knownDistros = @(& wsl.exe --list --quiet 2>$null | ForEach-Object { ([string]$_).Trim([char]0).Trim() })
if ($distroName -in $knownDistros) {
  & wsl.exe -d $distroName -u root -- test -f $provisionCheckpoint
  $hasProvisionCheckpoint = $LASTEXITCODE -eq 0
}
if ($hasProvisionCheckpoint) {
  Write-Host "พบข้อมูลร้านเดิม กำลังติดตั้งต่อจากจุดที่ค้าง" -ForegroundColor Yellow
  $shopName = $adminName = $adminEmail = $adminPassword = $adminPin = ""
  $businessArchetype = ""
  $createSampleData = $false
} else {
  $shopName = Read-RequiredText "ชื่อร้าน"
  $adminName = Read-RequiredText "ชื่อผู้ดูแลร้าน"
  $adminEmail = Read-EmailAddress
  $businessArchetype = Read-BusinessArchetype
  $createSampleData = Read-SampleDataChoice
  $adminPassword = Read-ConfirmedSecret "รหัสผ่านผู้ดูแล (อย่างน้อย 8 ตัวอักษร)" `
    "ยืนยันรหัสผ่านอีกครั้ง" '^.{8,}$' "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษรและตรงกัน กรุณากรอกใหม่"
  $adminPin = Read-ConfirmedSecret "PIN ขายหน้าร้าน (ตัวเลข 4-8 หลัก)" `
    "ยืนยัน PIN อีกครั้ง" '^\d{4,8}$' "PIN ต้องเป็นตัวเลข 4-8 หลักและตรงกัน กรุณากรอกใหม่"
}

Write-Step 3 "ติดตั้งหรืออัปเดต private WSL runtime"
& wsl.exe --update --web-download
if ($LASTEXITCODE -ne 0) { throw "ติดตั้ง/อัปเดต WSL ไม่สำเร็จ" }

$releaseRoot = Join-Path $InstallRoot "release"
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
$manifestPath = Join-Path $releaseRoot "release.jws.json"
Write-Step 4 "ดาวน์โหลดและตรวจสอบ release ที่ลงลายเซ็น"
Invoke-WebRequest -Uri $ManifestUri -OutFile $manifestPath -UseBasicParsing

$stage = Invoke-AgentJson @("stage-release", "-manifest", $manifestPath, "-keyring", $installedKeyring,
  "-target", [string]$preflight.target, "-root", $InstallRoot)
$release = Invoke-AgentJson @("verify-release", "-manifest", $manifestPath, "-keyring", $installedKeyring,
  "-target", [string]$preflight.target)
$releaseDirectory = [IO.Path]::GetFullPath([string]$stage.releaseDirectory)
$archetypeArtifact = Get-ArtifactPath $release "shop-archetypes"
$archetypeCatalog = Get-ShopArchetypeCatalog $archetypeArtifact.path

$runtime = Get-ArtifactPath $release "runtime"
$installedDistros = @(& wsl.exe --list --quiet | ForEach-Object { ([string]$_).Trim([char]0).Trim() })
if ($distroName -notin $installedDistros) {
  $wslRoot = Join-Path $InstallRoot "wsl"
  New-Item -ItemType Directory -Force -Path $wslRoot | Out-Null
  & wsl.exe --import $distroName $wslRoot $runtime.path --version 2
  if ($LASTEXITCODE -ne 0) { throw "Import private BMSRuntime WSL distribution ไม่สำเร็จ" }
}

$taskName = "BMS Retail Local Runtime"
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\wsl.exe" `
  -Argument "-d $distroName -u root -- /usr/local/sbin/bms-wsl-keepalive"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

$deadline = [DateTime]::UtcNow.AddMinutes(2)
do {
  & wsl.exe -d $distroName -u root -- docker info *> $null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Seconds 2
} while ([DateTime]::UtcNow -lt $deadline)
if ($LASTEXITCODE -ne 0) { throw "BMS private Moby runtime ไม่พร้อม" }

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
  & $installedAgent engine-load -engine windows-wsl -distro $distroName -artifact $artifact.path `
    -image-ref ([string]$component.imageRef) -digest ([string]$component.ociDigest)
  if ($LASTEXITCODE -ne 0) { throw "โหลด image $($component.name) ไม่สำเร็จ" }
}

$compose = Get-ArtifactPath $release "compose"
& $installedAgent runtime-write -engine windows-wsl -distro $distroName -source $compose.path `
  -destination "$runtimeData/compose.yml" -mode "0600"
if ($LASTEXITCODE -ne 0) { throw "ติดตั้ง Compose contract ไม่สำเร็จ" }

$byName = @{}
foreach ($component in $release.components) { $byName[[string]$component.name] = $component }
& wsl.exe -d $distroName -u root -- test -f "$runtimeData/.env"
$runtimeEnvExists = $LASTEXITCODE -eq 0
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

& wsl.exe -d $distroName -u root -- test -f $provisionCheckpoint
if ($LASTEXITCODE -eq 0) {
  $checkpointOutput = & wsl.exe -d $distroName -u root -- cat $provisionCheckpoint
  if ($LASTEXITCODE -ne 0) { throw "อ่าน checkpoint ของร้านไม่สำเร็จ" }
  $provisionResult = (($checkpointOutput -join [Environment]::NewLine) | ConvertFrom-Json)
  $businessArchetype = [string]$provisionResult.businessArchetype
  $sampleMode = if ($provisionResult.sampleData.mode) { [string]$provisionResult.sampleData.mode } else { "NONE" }
  Write-Host "พบข้อมูลร้านเดิม กำลังติดตั้งต่อจากจุดที่ค้าง" -ForegroundColor Yellow
} else {
  $shopName = Read-Host "ชื่อร้าน"
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
  $adminName = Read-Host "ชื่อผู้ดูแลร้าน"
  $adminEmail = Read-Host "อีเมลผู้ดูแลร้าน"
  $adminPassword = ConvertTo-PlainSecret (Read-Host "รหัสผ่านผู้ดูแล (อย่างน้อย 8 ตัวอักษร)" -AsSecureString)
  $adminPin = ConvertTo-PlainSecret (Read-Host "PIN ขายหน้าร้าน (ตัวเลข 4-8 หลัก)" -AsSecureString)
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
  $provisionOutput = & wsl.exe -d $distroName -u root -- "$runtimeData/provision-once.sh" 2>&1
  $provisionExit = $LASTEXITCODE
  & wsl.exe -d $distroName -u root -- rm -f "$runtimeData/provision-once.sh"
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
if ($sampleStatus -eq "PENDING") {
  # The protected checkpoint already contains the one-time token. Sample generation is therefore
  # safe to retry after an interrupted setup without recreating the shop or losing pairing.
  try {
    $sampleOutput = Invoke-WslDocker @("compose", "--env-file", "$runtimeData/.env", "-f",
      "$runtimeData/compose.yml", "--profile", "setup", "run", "--rm", "sample-data")
    $sampleLine = $sampleOutput | Where-Object { $_ -match '^\{"status"' } | Select-Object -Last 1
    if (-not $sampleLine) { throw "sample data process did not return a readable result" }
    $provisionResult.sampleData = $sampleLine | ConvertFrom-Json
    $provisionResult.sampleData | Add-Member -NotePropertyName mode -NotePropertyValue $sampleMode -Force
  } catch {
    $provisionResult.sampleData = [pscustomobject]@{
      status = "FAILED"
      requested = $true
      mode = $sampleMode
      message = "สร้างข้อมูลตัวอย่างยังไม่สำเร็จ สามารถลองใหม่จากหน้าเริ่มต้นใช้งาน"
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
do {
  try {
    $web = Invoke-WebRequest -Uri "http://127.0.0.1:3100/admin/login" -UseBasicParsing -TimeoutSec 5
    $ws = Invoke-WebRequest -Uri "http://127.0.0.1:3101/readyz" -UseBasicParsing -TimeoutSec 5
    if ($web.StatusCode -eq 200 -and $ws.StatusCode -eq 200) { break }
  } catch {}
  Start-Sleep -Seconds 3
} while ([DateTime]::UtcNow -lt $healthDeadline)
if (-not $web -or -not $ws -or $web.StatusCode -ne 200 -or $ws.StatusCode -ne 200) { throw "บริการไม่ผ่าน HTTP health check" }

$desktop = Get-ArtifactPath $release "desktop"
$desktopInstaller = Join-Path $releaseDirectory "BMS-POS-Setup.exe"
Copy-Item -LiteralPath $desktop.path -Destination $desktopInstaller -Force
$desktopProcess = Start-Process -FilePath $desktopInstaller -ArgumentList "/S" -Wait -PassThru
if ($desktopProcess.ExitCode -ne 0) { throw "ติดตั้ง BMS POS Desktop ไม่สำเร็จ" }
$desktopExecutable = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA "Programs") -Filter "BMS POS.exe" -File -Recurse |
  Select-Object -First 1 -ExpandProperty FullName
if (-not $desktopExecutable) { throw "ติดตั้งแล้วแต่ไม่พบ BMS POS.exe" }

if ($provisionResult.deviceToken) {
  $handoffPath = Join-Path $InstallRoot "pairing-handoff.json"
  [ordered]@{
    version = 1
    serverUrl = "http://127.0.0.1:3100"
    token = [string]$provisionResult.deviceToken
    expiresAt = [DateTimeOffset]::UtcNow.AddMinutes(10).ToString("o")
  } | ConvertTo-Json -Compress | ForEach-Object { Write-Utf8NoBom $handoffPath $_ }
  & icacls $handoffPath /inheritance:r /grant:r "${env:USERNAME}:(R,W)" *> $null
  if ($LASTEXITCODE -ne 0) { throw "จำกัดสิทธิ์ pairing handoff ไม่สำเร็จ" }
  Start-Process -FilePath $desktopExecutable -ArgumentList "--pairing-handoff=`"$handoffPath`""
} else {
  Start-Process -FilePath $desktopExecutable
}

[ordered]@{
  product = "BMS Retail Local"
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
  sampleMode = $provisionResult.sampleData.mode
  sampleStatus = $provisionResult.sampleData.status
  licenseCode = if ([string]::IsNullOrWhiteSpace($LicenseId)) { $null } else { $LicenseId }
} | ConvertTo-Json | ForEach-Object { Write-Utf8NoBom $installationReceipt $_ }
& $installedAgent runtime-write -engine windows-wsl -distro $distroName -source $installationReceipt `
  -destination "$runtimeData/installation.json" -mode "0600"
if ($LASTEXITCODE -ne 0) { throw "บันทึก installation receipt ใน private runtime ไม่สำเร็จ" }
& wsl.exe -d $distroName -u root -- rm -f $provisionCheckpoint

# License evidence is administrative telemetry only. It is intentionally best-effort and must not
# change installation success, runtime startup, sales, payment, data access, backup, or recovery.
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
    $licenseAction = New-ScheduledTaskAction -Execute $installedAgent `
      -Argument "license-pulse -root `"$InstallRoot`""
    $licenseTrigger = New-ScheduledTaskTrigger -Daily -At 3am
    $licenseSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
    Register-ScheduledTask -TaskName "BMS Retail Local License Evidence" -Action $licenseAction `
      -Trigger $licenseTrigger -Principal $principal -Settings $licenseSettings -Force | Out-Null
  } catch {
    Write-Warning "เก็บ/ตั้งเวลาหลักฐาน Licensing ไม่สำเร็จ แต่ร้านยังใช้งานต่อได้: $($_.Exception.Message)"
  }
}

if ($ResumeConfig -and (Test-Path -LiteralPath $ResumeConfig)) { Remove-Item -LiteralPath $ResumeConfig -Force }
Unregister-ScheduledTask -TaskName "BMS Retail Local Setup Resume" -Confirm:$false -ErrorAction SilentlyContinue
Write-Step 7 "ติดตั้งสำเร็จ"
Write-Host "BMS Retail Local พร้อมใช้งาน" -ForegroundColor Green
