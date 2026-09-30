[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InstallScript,
  [Parameter(Mandatory = $true)][string]$ManifestUri,
  [string]$ActivationUri = "",
  [Parameter(Mandatory = $true)][string]$ErrorFile,
  [Parameter(Mandatory = $true)][string]$LogFile
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$utf8 = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$global:OutputEncoding = $utf8
try { & "$env:SystemRoot\System32\chcp.com" 65001 *> $null } catch {}

$diagnosticRoot = Split-Path -Parent $LogFile
try {
  New-Item -ItemType Directory -Force -Path $diagnosticRoot | Out-Null
  [IO.File]::WriteAllText(
    $ErrorFile,
    "Managed Runtime runner เริ่มแล้ว แต่ยังไม่ได้รับผลจาก install script",
    [Text.UTF8Encoding]::new($false)
  )
  Start-Transcript -LiteralPath $LogFile -Append -Force | Out-Null
  $interactiveUser = try { [string](Get-CimInstance Win32_ComputerSystem).UserName } catch { "" }
  $aclArguments = @(
    $diagnosticRoot,
    "/inheritance:r",
    "/grant:r",
    "Administrators:(OI)(CI)F",
    "SYSTEM:(OI)(CI)F",
    "${env:USERNAME}:(OI)(CI)F"
  )
  if (-not [string]::IsNullOrWhiteSpace($interactiveUser) -and $interactiveUser -ne $env:USERNAME) {
    $aclArguments += "${interactiveUser}:(OI)(CI)RX"
  }
  & icacls @aclArguments *> $null
  if ($LASTEXITCODE -ne 0) { throw "จำกัดสิทธิ์ setup diagnostics ไม่สำเร็จ" }

  & $InstallScript -ManifestUri $ManifestUri -ActivationUri $ActivationUri -ErrorFile $ErrorFile
  $result = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
  if ($result -eq 0 -and (Test-Path -LiteralPath $ErrorFile)) {
    Remove-Item -LiteralPath $ErrorFile -Force
  }
  exit $result
} catch {
  $message = $_.Exception.Message
  [IO.File]::WriteAllText($ErrorFile, $message, [Text.UTF8Encoding]::new($false))
  Write-Error $message
  exit 1
} finally {
  try { Stop-Transcript | Out-Null } catch {}
}
