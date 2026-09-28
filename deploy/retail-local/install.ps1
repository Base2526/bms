[CmdletBinding()]
param(
  [string]$ShopName,
  [string]$ShopSlug = "local-shop",
  [string]$AdminName,
  [string]$AdminEmail,
  [Security.SecureString]$AdminPassword,
  [Security.SecureString]$AdminPin,
  [ValidateSet("mini_mart", "fashion", "home_kitchen", "beauty_personal_care", "food_beverage", "gadgets_accessories", "b2b_wholesale", "gifts_seasonal", "pharmacy", "pet_supply", "building_materials", "restaurant", "board_game_cafe", "other")]
  [string]$BusinessArchetype,
  [ValidateSet("NONE", "STARTER_CATALOG")]
  [string]$SampleMode
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

function Read-MenuChoice([string]$Prompt, [array]$Options, [string]$DefaultValue) {
  Write-Host ""
  Write-Host $Prompt -ForegroundColor Cyan
  for ($index = 0; $index -lt $Options.Count; $index++) {
    Write-Host ("  {0}. {1}" -f ($index + 1), $Options[$index].Label)
  }
  $defaultIndex = 1
  for ($index = 0; $index -lt $Options.Count; $index++) {
    if ($Options[$index].Value -eq $DefaultValue) { $defaultIndex = $index + 1; break }
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
if (-not $BusinessArchetype) {
  $BusinessArchetype = Read-MenuChoice "ประเภทร้าน (ใช้กำหนดค่าเริ่มต้นและตัวอย่างสินค้า)" @(
    [pscustomobject]@{ Value = "mini_mart"; Label = "Mini Mart / Grocery" },
    [pscustomobject]@{ Value = "fashion"; Label = "Fashion & Apparel" },
    [pscustomobject]@{ Value = "home_kitchen"; Label = "Home & Kitchen" },
    [pscustomobject]@{ Value = "beauty_personal_care"; Label = "Beauty & Personal Care" },
    [pscustomobject]@{ Value = "food_beverage"; Label = "Food & Beverage" },
    [pscustomobject]@{ Value = "gadgets_accessories"; Label = "Gadgets & Accessories" },
    [pscustomobject]@{ Value = "b2b_wholesale"; Label = "B2B / Wholesale" },
    [pscustomobject]@{ Value = "gifts_seasonal"; Label = "Gifts & Seasonal" },
    [pscustomobject]@{ Value = "pharmacy"; Label = "Pharmacy" },
    [pscustomobject]@{ Value = "pet_supply"; Label = "Pet Supply" },
    [pscustomobject]@{ Value = "building_materials"; Label = "Building Materials" },
    [pscustomobject]@{ Value = "restaurant"; Label = "Restaurant" },
    [pscustomobject]@{ Value = "board_game_cafe"; Label = "Board Game Cafe" },
    [pscustomobject]@{ Value = "other"; Label = "Other" }
  ) "mini_mart"
}
if (-not $SampleMode) {
  $SampleMode = Read-MenuChoice "ต้องการสร้าง Starter Catalog สำหรับทดลองใช้งานหรือไม่? (สินค้าเป็น Draft, สต็อก 0, ยังขายไม่ได้)" @(
    [pscustomobject]@{ Value = "STARTER_CATALOG"; Label = "สร้างข้อมูลตัวอย่างตามประเภทร้าน" },
    [pscustomobject]@{ Value = "NONE"; Label = "ไม่สร้างข้อมูลตัวอย่าง" }
  ) "STARTER_CATALOG"
}
if (-not $AdminName) { $AdminName = Read-Host "ชื่อผู้ดูแลร้าน" }
if (-not $AdminEmail) { $AdminEmail = Read-Host "อีเมลผู้ดูแลร้าน" }
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
$env:BMS_LOCAL_SAMPLE_MODE = $SampleMode
try {
  $provisionOutput = & docker @composeArgs --profile setup run --rm provision 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($provisionOutput -join [Environment]::NewLine) }
} finally {
  Remove-Item Env:BMS_LOCAL_SHOP_NAME, Env:BMS_LOCAL_SHOP_SLUG, Env:BMS_LOCAL_ADMIN_NAME,
    Env:BMS_LOCAL_ADMIN_EMAIL, Env:BMS_LOCAL_ADMIN_PASSWORD, Env:BMS_LOCAL_ADMIN_PIN,
    Env:BMS_LOCAL_BUSINESS_ARCHETYPE, Env:BMS_LOCAL_SAMPLE_MODE -ErrorAction SilentlyContinue
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
  businessArchetype = $result.businessArchetype
  sampleMode = $result.sample.mode
  sampleStatus = $result.sample.status
}
Set-Content -LiteralPath (Join-Path $localRoot "installation.json") -Value ($receipt | ConvertTo-Json) -Encoding utf8NoBOM

Write-Host ""
Write-Host "BMS Retail Local พร้อมใช้งาน: http://127.0.0.1:$webPort" -ForegroundColor Green
Write-Host "Admin: $AdminEmail"
Write-Host "ประเภทร้าน: $($result.businessArchetype)"
if ($result.sample.status -eq "FAILED") {
  Write-Host "สร้าง Starter Catalog ไม่สำเร็จ: $($result.sample.error)" -ForegroundColor Yellow
  Write-Host "ระบบหลักพร้อมใช้งาน และสามารถลองสร้างใหม่จาก Admin > เริ่มต้นใช้งาน"
} elseif ($result.sample.status -eq "ACTIVE") {
  Write-Host "สร้าง Starter Catalog แล้ว: $($result.sample.products) สินค้า (Draft, สต็อก 0)" -ForegroundColor Green
}
if ($result.deviceToken) {
  Write-Host "POS pairing token (แสดงครั้งเดียว):" -ForegroundColor Yellow
  Write-Host $result.deviceToken
  Write-Host "นำ token ไปจับคู่ใน BMS POS แล้วเก็บ/ทำลายบันทึกที่มี token อย่างปลอดภัย"
} else {
  Write-Host "ร้านนี้ provision แล้ว หากต้องการ token ใหม่ ให้ออกจากหน้า Admin > POS Devices" -ForegroundColor Yellow
}
Write-Host "รัน .\doctor.ps1 เพื่อตรวจระบบซ้ำได้ทุกเมื่อ"
