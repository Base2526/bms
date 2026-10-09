$ErrorActionPreference = "Stop"
$localRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $localRoot "runtime.ps1")
$ctx = Get-RetailLocalContext -ScriptRoot $localRoot
if (-not (Test-Path -LiteralPath $ctx.EnvFile)) { throw "Installation has not been completed. Run install.ps1 first" }
Assert-RetailLocalDocker
$composeArgs = Get-RetailLocalComposeArgs -Context $ctx
& docker @composeArgs stop
if ($LASTEXITCODE -ne 0) { throw "Failed to stop the system" }
Write-Host "BMS Retail Local stopped. Data is retained in local volumes" -ForegroundColor Yellow
