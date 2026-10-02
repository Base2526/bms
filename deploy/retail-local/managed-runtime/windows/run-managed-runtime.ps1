[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InstallScript,
  [Parameter(Mandatory = $true)][string]$ManifestUri,
  [ValidateSet('server', 'server-pos')][string]$PackageType = 'server-pos',
  [string]$ActivationUri = "",
  [Parameter(Mandatory = $true)][string]$ErrorFile,
  [Parameter(Mandatory = $true)][string]$LogFile,
  [string]$InstallerVersion = 'unknown'
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$utf8 = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$global:OutputEncoding = $utf8
try { & "$env:SystemRoot\System32\chcp.com" 65001 *> $null } catch {}

$diagnosticRoot = Split-Path -Parent $LogFile
$pendingMessage = 'Setup started but did not return an installation result.'
try {
  New-Item -ItemType Directory -Force -Path $diagnosticRoot | Out-Null
  [IO.File]::WriteAllText(
    $ErrorFile,
    $pendingMessage,
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

  $global:LASTEXITCODE = 0
  & $InstallScript -ManifestUri $ManifestUri -PackageType $PackageType -ActivationUri $ActivationUri `
    -ErrorFile $ErrorFile -InstallerVersion $InstallerVersion
  $result = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
  if ($result -eq 0 -and (Test-Path -LiteralPath $ErrorFile)) {
    Remove-Item -LiteralPath $ErrorFile -Force
  } elseif ($result -ne 0 -and $result -ne 3010) {
    if (-not (Test-Path -LiteralPath $ErrorFile) -or
        [IO.File]::ReadAllText($ErrorFile, [Text.Encoding]::UTF8) -eq $pendingMessage) {
      [IO.File]::WriteAllText($ErrorFile,
        "Setup ended with exit code $result. See $LogFile for the last completed step.", $utf8)
    }
  }
  exit $result
} catch {
  $failure = $_
  $message = $_.Exception.Message
  try {
    . (Join-Path $PSScriptRoot 'setup-diagnostics.ps1')
    $report = New-BmsSetupDiagnostics -Root $diagnosticRoot -Failure $failure -Product $PackageType `
      -InstallerVersion $InstallerVersion -Stage 'runner-startup'
    if ($report) { $message += "`nSupport report (review before sending): $report" }
  } catch {}
  [IO.File]::WriteAllText($ErrorFile, $message, [Text.UTF8Encoding]::new($false))
  Write-Host $message -ForegroundColor Red
  exit 1
} finally {
  try { Stop-Transcript | Out-Null } catch {}
}
