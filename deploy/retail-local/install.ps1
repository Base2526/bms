[CmdletBinding()]
param(
  [string]$ShopName,
  [string]$ShopSlug = "local-shop",
  [string]$AdminName,
  [string]$AdminEmail,
  [Security.SecureString]$AdminPassword,
  [Security.SecureString]$AdminPin,
  [ValidateSet("mini_mart", "fashion", "home_kitchen", "beauty_personal_care", "food_beverage",
    "gadgets_accessories", "b2b_wholesale", "gifts_seasonal", "pharmacy", "pet_supply",
    "building_materials", "restaurant", "board_game_cafe", "other")]
  [string]$BusinessArchetype,
  [Nullable[bool]]$CreateSampleData
)

$ErrorActionPreference = "Stop"
$localRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $localRoot "runtime.ps1")
$ctx = Get-RetailLocalContext -ScriptRoot $localRoot

function New-HexSecret([int]$Bytes) {
  $buffer = New-Object byte[] $Bytes
  [Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
  return [Convert]::ToHexString($buffer).ToLowerInvariant()
}

function Read-RequiredSecureString([string]$Prompt, [Security.SecureString]$Provided) {
  if ($Provided) { return $Provided }
  return Read-Host $Prompt -AsSecureString
}

function ConvertTo-PlainSecret([Security.SecureString]$Secret) {
  return [Net.NetworkCredential]::new("", $Secret).Password
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

& (Join-Path $localRoot "preflight.ps1")

$release = Get-RetailLocalRelease -ReleaseFile $ctx.ReleaseFile
$imageTag = if ($release) { [string]$release.imageTag } else { "dev" }
if ($release) { Import-RetailLocalReleaseImages -Root $localRoot -Release $release }

if (-not (Test-Path -LiteralPath $ctx.EnvFile)) {
  $lines = @(
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
    "BMS_LOCAL_IMAGE_TAG=$imageTag"
  )
  Set-Content -LiteralPath $ctx.EnvFile -Value $lines -Encoding utf8NoBOM
} else {
  Set-RetailLocalEnvValue -EnvFile $ctx.EnvFile -Name "BMS_LOCAL_IMAGE_TAG" -Value $imageTag
}
Protect-RetailLocalSecretFile -Path $ctx.EnvFile
$webPort = [int](Get-RetailLocalEnvValue -EnvFile $ctx.EnvFile -Name "BMS_LOCAL_WEB_PORT")
$wsPort = [int](Get-RetailLocalEnvValue -EnvFile $ctx.EnvFile -Name "BMS_LOCAL_WS_PORT")
if ($webPort -lt 1 -or $wsPort -lt 1) { throw "ค่า BMS_LOCAL_WEB_PORT/BMS_LOCAL_WS_PORT ไม่ถูกต้อง" }
if ($release -and ($webPort -ne 3100 -or $wsPort -ne 3101)) {
  throw "portable package นี้ build สำหรับพอร์ต 3100/3101 เท่านั้น"
}

New-Item -ItemType Directory -Force -Path $ctx.StorageDirectory | Out-Null
if (-not $ShopName) { $ShopName = Read-Host "ชื่อร้าน" }
if (-not $AdminName) { $AdminName = Read-Host "ชื่อผู้ดูแลร้าน" }
if (-not $AdminEmail) { $AdminEmail = Read-Host "อีเมลผู้ดูแลร้าน" }
if (-not $BusinessArchetype) { $BusinessArchetype = Read-BusinessArchetype }
if ($null -eq $CreateSampleData) { $CreateSampleData = Read-SampleDataChoice }
$adminPasswordSecure = Read-RequiredSecureString "รหัสผ่านผู้ดูแล (อย่างน้อย 8 ตัวอักษร)" $AdminPassword
$adminPinSecure = Read-RequiredSecureString "PIN ขายหน้าร้าน (ตัวเลข 4-8 หลัก)" $AdminPin
$adminPasswordPlain = ConvertTo-PlainSecret $adminPasswordSecure
$adminPinPlain = ConvertTo-PlainSecret $adminPinSecure

$composeArgs = Get-RetailLocalComposeArgs -Context $ctx
if (-not $release) {
  Write-Host "กำลัง build จาก source (อาจใช้เวลาหลายนาที)..." -ForegroundColor Cyan
  & docker @composeArgs build migrate ws
  if ($LASTEXITCODE -ne 0) { throw "Build BMS Retail Local ไม่สำเร็จ" }
}

& docker @composeArgs config --quiet
if ($LASTEXITCODE -ne 0) { throw "Docker Compose configuration ไม่ถูกต้อง" }

$env:BMS_LOCAL_SHOP_NAME = $ShopName
$env:BMS_LOCAL_SHOP_SLUG = $ShopSlug
$env:BMS_LOCAL_ADMIN_NAME = $AdminName
$env:BMS_LOCAL_ADMIN_EMAIL = $AdminEmail
$env:BMS_LOCAL_ADMIN_PASSWORD = $adminPasswordPlain
$env:BMS_LOCAL_ADMIN_PIN = $adminPinPlain
$env:BMS_LOCAL_BUSINESS_ARCHETYPE = $BusinessArchetype
$env:BMS_LOCAL_CREATE_SAMPLE_DATA = if ($CreateSampleData) { "1" } else { "0" }
try {
  $provisionOutput = & docker @composeArgs --profile setup run --rm provision 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($provisionOutput -join [Environment]::NewLine) }
} finally {
  Remove-Item Env:BMS_LOCAL_SHOP_NAME, Env:BMS_LOCAL_SHOP_SLUG, Env:BMS_LOCAL_ADMIN_NAME,
    Env:BMS_LOCAL_ADMIN_EMAIL, Env:BMS_LOCAL_ADMIN_PASSWORD, Env:BMS_LOCAL_ADMIN_PIN,
    Env:BMS_LOCAL_BUSINESS_ARCHETYPE, Env:BMS_LOCAL_CREATE_SAMPLE_DATA -ErrorAction SilentlyContinue
  $adminPasswordPlain = $null
  $adminPinPlain = $null
  $adminPasswordSecure = $null
  $adminPinSecure = $null
}

$resultLine = $provisionOutput | Where-Object { $_ -match '^\{"status"' } | Select-Object -Last 1
if (-not $resultLine) { throw "Provisioning สำเร็จแต่ไม่พบผลลัพธ์ที่อ่านได้" }
$result = $resultLine | ConvertFrom-Json

& docker @composeArgs up -d
if ($LASTEXITCODE -ne 0) { throw "เริ่ม BMS Retail Local ไม่สำเร็จ" }
Wait-RetailLocalHealthy -ComposeArgs $composeArgs
Test-RetailLocalHttp -WebPort $webPort -WsPort $wsPort

$receipt = [ordered]@{
  product = "BMS Retail Local"
  version = if ($release) { $release.version } else { "source-dev" }
  installedAt = [DateTimeOffset]::Now.ToString("o")
  url = "http://127.0.0.1:$webPort"
  tenantId = $result.tenantId
  adminUserId = $result.adminUserId
  posDeviceId = $result.deviceId
}
Set-Content -LiteralPath (Join-Path $localRoot "installation.json") -Value ($receipt | ConvertTo-Json) -Encoding utf8NoBOM

Write-Host ""
Write-Host "BMS Retail Local พร้อมใช้งาน: http://127.0.0.1:$webPort" -ForegroundColor Green
Write-Host "Admin: $AdminEmail"
if ($result.deviceToken) {
  Write-Host "POS pairing token (แสดงครั้งเดียว):" -ForegroundColor Yellow
  Write-Host $result.deviceToken
  Write-Host "นำ token ไปจับคู่ใน BMS POS แล้วเก็บ/ทำลายบันทึกที่มี token อย่างปลอดภัย"
} else {
  Write-Host "ร้านนี้ provision แล้ว หากต้องการ token ใหม่ ให้ออกจากหน้า Admin > POS Devices" -ForegroundColor Yellow
}

# Run optional sample data only after the shop is healthy and the one-time token has been handed to
# the operator. An interruption here can never make the newly provisioned register unrecoverable.
if ($result.sampleData.status -eq "PENDING") {
  $sampleOutput = & docker @composeArgs --profile setup run --rm sample-data 2>&1
  $sampleLine = $sampleOutput | Where-Object { $_ -match '^\{"status"' } | Select-Object -Last 1
  if ($LASTEXITCODE -eq 0 -and $sampleLine) {
    $result.sampleData = $sampleLine | ConvertFrom-Json
  } else {
    $result.sampleData.status = "FAILED"
  }
}
if ($result.sampleData.status -in @("COMPLETED", "ALREADY_COMPLETED")) {
  Write-Host "สร้างข้อมูลตัวอย่างตามประเภทร้านแล้ว" -ForegroundColor Green
} elseif ($result.sampleData.status -eq "FAILED") {
  Write-Warning "ข้อมูลตัวอย่างยังสร้างไม่ครบ ร้านยังใช้งานได้ และลองใหม่จากหน้าเริ่มต้นใช้งานได้"
}
Write-Host "รัน .\doctor.ps1 เพื่อตรวจระบบซ้ำได้ทุกเมื่อ"
