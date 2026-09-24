$ErrorActionPreference = "Stop"
$localRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $localRoot "runtime.ps1")
$ctx = Get-RetailLocalContext -ScriptRoot $localRoot
if (-not (Test-Path -LiteralPath $ctx.EnvFile)) { throw "ยังไม่ได้ติดตั้ง กรุณารัน install.ps1 ก่อน" }
Assert-RetailLocalDocker

& (Join-Path $localRoot "backup.ps1")
if ($LASTEXITCODE -ne 0) { throw "ยกเลิก update เพราะ backup ไม่สำเร็จ" }

$release = Get-RetailLocalRelease -ReleaseFile $ctx.ReleaseFile
$composeArgs = Get-RetailLocalComposeArgs -Context $ctx
if ($release) {
  Import-RetailLocalReleaseImages -Root $localRoot -Release $release
  Set-RetailLocalEnvValue -EnvFile $ctx.EnvFile -Name "BMS_LOCAL_IMAGE_TAG" -Value ([string]$release.imageTag)
  Protect-RetailLocalSecretFile -Path $ctx.EnvFile
} else {
  & docker @composeArgs build migrate ws
  if ($LASTEXITCODE -ne 0) { throw "Build เวอร์ชันใหม่ไม่สำเร็จ ระบบเดิมยังไม่ถูกแทนที่" }
}

& docker @composeArgs run --rm migrate
if ($LASTEXITCODE -ne 0) { throw "Migration ไม่สำเร็จ ระบบเดิมจะไม่ถูก restart" }
& docker @composeArgs up -d --force-recreate web ws
if ($LASTEXITCODE -ne 0) { throw "Restart หลัง update ไม่สำเร็จ ใช้ backup ล่าสุดเพื่อกู้คืน" }
Wait-RetailLocalHealthy -ComposeArgs $composeArgs
$webPort = [int](Get-RetailLocalEnvValue -EnvFile $ctx.EnvFile -Name "BMS_LOCAL_WEB_PORT")
$wsPort = [int](Get-RetailLocalEnvValue -EnvFile $ctx.EnvFile -Name "BMS_LOCAL_WS_PORT")
Test-RetailLocalHttp -WebPort $webPort -WsPort $wsPort

$installationFile = Join-Path $localRoot "installation.json"
if ($release -and (Test-Path -LiteralPath $installationFile -PathType Leaf)) {
  $receipt = Get-Content -LiteralPath $installationFile -Raw | ConvertFrom-Json
  $receipt.version = $release.version
  $receipt | Add-Member -NotePropertyName updatedAt -NotePropertyValue ([DateTimeOffset]::Now.ToString("o")) -Force
  Set-Content -LiteralPath $installationFile -Value ($receipt | ConvertTo-Json) -Encoding utf8NoBOM
}
Write-Host "Update สำเร็จ" -ForegroundColor Green
