[CmdletBinding()]
param(
  [string]$ShopName,
  [string]$ShopSlug = "local-shop",
  [string]$AdminName,
  [string]$AdminEmail,
  [Security.SecureString]$AdminPassword,
  [Security.SecureString]$AdminPin,
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
    $answer = Read-Host ("Select a number [{0}]" -f $defaultIndex)
    if (-not $answer) { return $DefaultValue }
    $number = 0
    if ([int]::TryParse($answer, [ref]$number) -and $number -ge 1 -and $number -le $Options.Count) {
      return [string]$Options[$number - 1].Value
    }
    Write-Host "Enter a number from 1 to $($Options.Count)" -ForegroundColor Yellow
  }
}

function Get-ShopArchetypeCatalog([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "shop-archetypes manifest not found: $Path"
  }
  $manifest = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  if ([int]$manifest.formatVersion -ne 1 -or -not $manifest.defaultArchetype) {
    throw "Unsupported shop-archetypes manifest version"
  }
  $seen = @{}
  $options = @()
  foreach ($entry in @($manifest.archetypes)) {
    $id = [string]$entry.id
    if ($id -notmatch '^[a-z][a-z0-9_]{1,63}$' -or $seen.ContainsKey($id)) {
      throw "Invalid or duplicate shop-archetypes manifest ID: $id"
    }
    $seen[$id] = $true
    if ($entry.enabledForNewInstall -eq $true -and $entry.deprecated -ne $true) {
      $label = if (($entry.labels.PSObject.Properties.Name -contains 'en') -and
          -not [string]::IsNullOrWhiteSpace([string]$entry.labels.en)) { [string]$entry.labels.en } else { $id }
      $options += [pscustomobject]@{
        Value = $id
        Label = $label
        StarterCatalog = ($entry.starterCatalog -eq $true)
      }
    }
  }
  if ($options.Count -eq 0) { throw "The shop-archetypes manifest has no types enabled for installation" }
  $defaultValue = [string]$manifest.defaultArchetype
  if ($defaultValue -notin @($options | ForEach-Object Value)) {
    throw "defaultArchetype is not enabled for installation: $defaultValue"
  }
  return [pscustomobject]@{ Options = $options; DefaultValue = $defaultValue }
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
if ($webPort -lt 1 -or $wsPort -lt 1) { throw "Invalid BMS_LOCAL_WEB_PORT/BMS_LOCAL_WS_PORT" }
if ($release -and ($webPort -ne 3100 -or $wsPort -ne 3101)) {
  throw "This portable package was built for ports 3100/3101 only"
}

New-Item -ItemType Directory -Force -Path $ctx.StorageDirectory | Out-Null
$archetypeManifestPath = Join-Path $localRoot "shop-archetypes.json"
if (-not (Test-Path -LiteralPath $archetypeManifestPath -PathType Leaf)) {
  $archetypeManifestPath = Join-Path $localRoot "..\..\packages\retail-local-contract\shop-archetypes.json"
}
if ($release) {
  if ([string]$release.shopArchetypes.file -ne "shop-archetypes.json" -or
      [string]$release.shopArchetypes.sha256 -notmatch '^[a-f0-9]{64}$') {
    throw "release.json is missing the shop-archetypes contract"
  }
  $actualArchetypeHash = (Get-FileHash -LiteralPath $archetypeManifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualArchetypeHash -ne [string]$release.shopArchetypes.sha256) {
    throw "shop-archetypes manifest checksum does not match the release"
  }
}
$archetypeCatalog = Get-ShopArchetypeCatalog $archetypeManifestPath
if (-not $ShopName) { $ShopName = Read-Host "Shop name" }
if (-not $BusinessArchetype) {
  $BusinessArchetype = Read-MenuChoice "Shop type (used for defaults and sample products)" `
    $archetypeCatalog.Options $archetypeCatalog.DefaultValue
} elseif ($BusinessArchetype -notin @($archetypeCatalog.Options | ForEach-Object Value)) {
  throw "Shop type '$BusinessArchetype' is not enabled for installation in this release"
}
$selectedArchetype = @($archetypeCatalog.Options | Where-Object Value -eq $BusinessArchetype)[0]
if (-not $selectedArchetype.StarterCatalog) {
  if ($SampleMode -eq "STARTER_CATALOG") {
    throw "Shop type '$BusinessArchetype' has no Starter Catalog in this release"
  }
  $SampleMode = "NONE"
  Write-Host "This release has no Starter Catalog for this shop type; starting with an empty shop" -ForegroundColor Yellow
} elseif (-not $SampleMode) {
  $SampleMode = Read-MenuChoice "Create a Starter Catalog to try the system? (Draft products, zero stock, not ready for sale)" @(
    [pscustomobject]@{ Value = "STARTER_CATALOG"; Label = "Create sample data for this shop type" },
    [pscustomobject]@{ Value = "NONE"; Label = "Do not create sample data" }
  ) "STARTER_CATALOG"
}
if (-not $AdminName) { $AdminName = Read-Host "Shop administrator name" }
if (-not $AdminEmail) { $AdminEmail = Read-Host "Shop administrator email" }
$adminPasswordSecure = Read-RequiredSecureString "Administrator password (at least 8 characters)" $AdminPassword
$adminPinSecure = Read-RequiredSecureString "POS PIN (4-8 digits)" $AdminPin
$adminPasswordPlain = ConvertTo-PlainSecret $adminPasswordSecure
$adminPinPlain = ConvertTo-PlainSecret $adminPinSecure

$composeArgs = Get-RetailLocalComposeArgs -Context $ctx
if (-not $release) {
  Write-Host "Building from source (this may take several minutes)..." -ForegroundColor Cyan
  & docker @composeArgs build migrate ws
  if ($LASTEXITCODE -ne 0) { throw "BMS Retail Local build failed" }
}

& docker @composeArgs config --quiet
if ($LASTEXITCODE -ne 0) { throw "Invalid Docker Compose configuration" }

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
if (-not $resultLine) { throw "Provisioning completed but no readable result was found" }
$result = $resultLine | ConvertFrom-Json

& docker @composeArgs up -d
if ($LASTEXITCODE -ne 0) { throw "Failed to start BMS Retail Local" }
Wait-RetailLocalHealthy -ComposeArgs $composeArgs
Test-RetailLocalHttp -WebPort $webPort -WsPort $wsPort

Write-Host ""
Write-Host "BMS Retail Local is ready: http://127.0.0.1:$webPort" -ForegroundColor Green
Write-Host "Admin: $AdminEmail"
Write-Host "Shop type: $($result.businessArchetype)"
if ($result.deviceToken) {
  Write-Host "POS pairing token (shown once):" -ForegroundColor Yellow
  Write-Host $result.deviceToken
  Write-Host "Use the token to pair BMS POS, then securely store or destroy any record containing the token"
} else {
  Write-Host "This shop is already provisioned. Issue a new token from Admin > POS Devices" -ForegroundColor Yellow
}

# Run optional sample data only after the shop is healthy and the one-time token has been handed to
# the operator. An interruption here can never make the newly provisioned register unrecoverable.
if ($result.sampleData.status -eq "PENDING") {
  $sampleOutput = & docker @composeArgs --profile setup run --rm sample-data 2>&1
  $sampleLine = $sampleOutput | Where-Object { $_ -match '^\{"status"' } | Select-Object -Last 1
  if ($LASTEXITCODE -eq 0 -and $sampleLine) {
    $result.sampleData = $sampleLine | ConvertFrom-Json
    $result.sampleData | Add-Member -NotePropertyName mode -NotePropertyValue $SampleMode -Force
  } else {
    $result.sampleData.status = "FAILED"
  }
}
if ($result.sampleData.status -in @("COMPLETED", "ALREADY_COMPLETED")) {
  Write-Host "Sample data created for the selected shop type" -ForegroundColor Green
} elseif ($result.sampleData.status -eq "FAILED") {
  Write-Warning "Sample data setup is incomplete. The shop is usable; retry from the onboarding page"
}
$receipt = [ordered]@{
  product = "BMS Retail Local"
  version = if ($release) { $release.version } else { "source-dev" }
  installedAt = [DateTimeOffset]::Now.ToString("o")
  url = "http://127.0.0.1:$webPort"
  tenantId = $result.tenantId
  adminUserId = $result.adminUserId
  posDeviceId = $result.deviceId
  businessArchetype = $result.businessArchetype
  sampleMode = $result.sampleData.mode
  sampleStatus = $result.sampleData.status
}
Set-Content -LiteralPath (Join-Path $localRoot "installation.json") -Value ($receipt | ConvertTo-Json) -Encoding utf8NoBOM
Write-Host "Run .\doctor.ps1 to check the system at any time"
