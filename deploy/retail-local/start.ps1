$ErrorActionPreference = "Stop"
$localRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $localRoot "runtime.ps1")
$ctx = Get-RetailLocalContext -ScriptRoot $localRoot
if (-not (Test-Path -LiteralPath $ctx.EnvFile)) { throw "Installation has not been completed. Run install.ps1 first" }
Assert-RetailLocalDocker
$composeArgs = Get-RetailLocalComposeArgs -Context $ctx
& docker @composeArgs run --rm migrate
if ($LASTEXITCODE -ne 0) { throw "Migration failed. The system will not start to prevent database corruption" }
& docker @composeArgs up -d web ws
if ($LASTEXITCODE -ne 0) { throw "Failed to start the system" }
Wait-RetailLocalHealthy -ComposeArgs $composeArgs
$webPort = [int](Get-RetailLocalEnvValue -EnvFile $ctx.EnvFile -Name "BMS_LOCAL_WEB_PORT")
$wsPort = [int](Get-RetailLocalEnvValue -EnvFile $ctx.EnvFile -Name "BMS_LOCAL_WS_PORT")
Test-RetailLocalHttp -WebPort $webPort -WsPort $wsPort
Write-Host "BMS Retail Local is ready: http://127.0.0.1:$webPort" -ForegroundColor Green
