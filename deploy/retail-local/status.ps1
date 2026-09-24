$ErrorActionPreference = "Stop"
$localRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $localRoot "runtime.ps1")
$ctx = Get-RetailLocalContext -ScriptRoot $localRoot
if (-not (Test-Path -LiteralPath $ctx.EnvFile)) { throw "ยังไม่ได้ติดตั้ง กรุณารัน install.ps1 ก่อน" }
Assert-RetailLocalDocker
$composeArgs = Get-RetailLocalComposeArgs -Context $ctx
& docker @composeArgs ps
if ($LASTEXITCODE -ne 0) { throw "อ่านสถานะระบบไม่สำเร็จ" }
Write-Host ""
& (Join-Path $localRoot "doctor.ps1")
exit $LASTEXITCODE
