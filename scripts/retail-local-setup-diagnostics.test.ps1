param([string]$Helper, [string]$Root)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. $Helper
function Assert([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

$inventory = Get-BmsSetupMachineInfo
Assert ($inventory.status -in @('collected', 'partial', 'timed-out', 'unavailable')) 'Inventory status missing'
if ($inventory.status -in @('collected', 'partial')) {
  Assert ($null -ne $inventory.windows) 'Windows inventory did not return'
  Assert ($inventory.windows.build -match '^\d+$') 'Windows build missing'
}

# Make a hung inventory worker exercise the real Wait-Job timeout/cleanup path.
function Start-Job {
  param([scriptblock]$ScriptBlock)
  Microsoft.PowerShell.Core\Start-Job -ScriptBlock { Start-Sleep -Seconds 30 }
}
$clock = [Diagnostics.Stopwatch]::StartNew()
$timed = Get-BmsSetupMachineInfo -TimeoutSeconds 1
Assert ($timed.status -eq 'timed-out') 'Hung inventory did not time out'
Assert ($clock.Elapsed.TotalSeconds -lt 10) 'Inventory timeout took too long'
Assert (@(Get-Job).Count -eq 0) 'Inventory worker leaked'
Remove-Item Function:\Start-Job

function Get-BmsSetupMachineInfo { return @{ status = 'unavailable' } }
$raw = @'
compose failed: postgres is not running
password=canary-password
Authorization: Bearer canary-bearer
{"privateKey":"canary-key"}
PIN: 123456
https://user:canary-url@example.invalid/download?sig=canary-signature
postgres://user:canary-db@127.0.0.1/shop
C:\Users\canary-user\logs\setup.log
\\canary-host\shared\error.log
canary-email@example.invalid
-----BEGIN PRIVATE KEY-----
canary-pem
-----END PRIVATE KEY-----
'@
try { throw $raw } catch { $failure = $_ }
[IO.File]::WriteAllText((Join-Path $Root 'setup-transcript.log'), 'canary-transcript shop customer data')
[IO.File]::WriteAllText((Join-Path $Root '.env'), 'canary-env')
$zip = New-BmsSetupDiagnostics -Root $Root -Failure $failure -Product pos -InstallerVersion '1.2.3-test' -Stage 'download-desktop'
Assert ([IO.File]::Exists($zip)) 'Report was not created'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($zip)
try {
  Assert ($archive.Entries.Count -eq 2) 'Unexpected file included'
  $reader = [IO.StreamReader]::new($archive.GetEntry('diagnostics.json').Open())
  try { $json = $reader.ReadToEnd() } finally { $reader.Dispose() }
  Assert ($json -notmatch 'canary|123456') 'Sensitive value leaked into report'
  $report = $json | ConvertFrom-Json
  Assert ($report.failure.message -match 'postgres is not running') 'Actionable error was lost'
  Assert ($report.installerVersion -eq '1.2.3-test') 'Installer version missing'
  Assert ($report.stage -eq 'download-desktop') 'Failure stage missing'
  Assert ($report.machine.status -eq 'unavailable') 'Unavailable inventory was misreported'
} finally { $archive.Dispose() }
$second = New-BmsSetupDiagnostics -Root $Root -Failure $failure
Assert ($zip -ne $second -and [IO.File]::Exists($zip)) 'Retry overwrote prior report'
$blocked = Join-Path $Root 'blocked'
[IO.File]::WriteAllText($blocked, 'file, not directory')
$missing = New-BmsSetupDiagnostics -Root $blocked -Failure $failure
Assert ($null -eq $missing) 'Reporting failure was not contained'
Assert ((Protect-BmsDiagnosticText ('x ' * 2000)).Length -le 2061) 'Error text is unbounded'
'diagnostics checks passed'
