$ErrorActionPreference = "Stop"
$localRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $localRoot "runtime.ps1")
$ctx = Get-RetailLocalContext -ScriptRoot $localRoot
if (-not (Test-Path -LiteralPath $ctx.EnvFile)) { throw "ยังไม่ได้ติดตั้ง กรุณารัน install.ps1 ก่อน" }
Assert-RetailLocalDocker
$composeArgs = Get-RetailLocalComposeArgs -Context $ctx
& docker @composeArgs stop
if ($LASTEXITCODE -ne 0) { throw "หยุดระบบไม่สำเร็จ" }
Write-Host "หยุด BMS Retail Local แล้ว ข้อมูลยังอยู่ใน local volumes" -ForegroundColor Yellow
