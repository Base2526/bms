$ErrorActionPreference = "Stop"
$localRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $localRoot "runtime.ps1")
$ctx = Get-RetailLocalContext -ScriptRoot $localRoot
if (-not (Test-Path -LiteralPath $ctx.EnvFile)) { throw "ยังไม่ได้ติดตั้ง กรุณารัน install.ps1 ก่อน" }
Assert-RetailLocalDocker
$composeArgs = Get-RetailLocalComposeArgs -Context $ctx
& docker @composeArgs run --rm migrate
if ($LASTEXITCODE -ne 0) { throw "Migration ไม่สำเร็จ ระบบจะไม่เริ่มเพื่อป้องกันฐานข้อมูลเสีย" }
& docker @composeArgs up -d web ws
if ($LASTEXITCODE -ne 0) { throw "เริ่มระบบไม่สำเร็จ" }
Wait-RetailLocalHealthy -ComposeArgs $composeArgs
$webPort = [int](Get-RetailLocalEnvValue -EnvFile $ctx.EnvFile -Name "BMS_LOCAL_WEB_PORT")
$wsPort = [int](Get-RetailLocalEnvValue -EnvFile $ctx.EnvFile -Name "BMS_LOCAL_WS_PORT")
Test-RetailLocalHttp -WebPort $webPort -WsPort $wsPort
Write-Host "BMS Retail Local พร้อมใช้งาน: http://127.0.0.1:$webPort" -ForegroundColor Green
