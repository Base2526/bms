$ErrorActionPreference = "Stop"
$localRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $localRoot "runtime.ps1")
$ctx = Get-RetailLocalContext -ScriptRoot $localRoot
if (-not (Test-Path -LiteralPath $ctx.EnvFile)) { throw "Installation has not been completed. Run install.ps1 first" }
Assert-RetailLocalDocker
$composeArgs = Get-RetailLocalComposeArgs -Context $ctx
& docker @composeArgs ps
if ($LASTEXITCODE -ne 0) { throw "Failed to read system status" }
Write-Host ""
& (Join-Path $localRoot "doctor.ps1")
exit $LASTEXITCODE
