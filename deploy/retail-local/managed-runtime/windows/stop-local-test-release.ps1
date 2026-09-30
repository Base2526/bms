[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ReleaseDirectory
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$releaseRoot = [IO.Path]::GetFullPath($ReleaseDirectory)
$statePath = Join-Path $releaseRoot "local-test-state.json"
if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
  throw "ไม่พบ local-test-state.json: $statePath"
}
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json

$pidValue = [int]$state.serverPid
if ($pidValue -gt 0) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $pidValue" -ErrorAction SilentlyContinue
  if ($process) {
    $expectedScript = [IO.Path]::GetFullPath([string]$state.serverScript)
    if ([string]$process.Name -notmatch '^node(?:\.exe)?$' -or
        [string]$process.CommandLine -notlike "*$expectedScript*") {
      throw "PID $pidValue ไม่ใช่ local test release server ที่บันทึกไว้ จึงไม่หยุด process นี้"
    }
    Stop-Process -Id $pidValue -Force
    Write-Host "หยุด local HTTPS release server แล้ว (PID $pidValue)" -ForegroundColor Green
  }
}

$thumbprint = ([string]$state.certificateThumbprint).Replace(" ", "").ToUpperInvariant()
if ($thumbprint -match '^[A-F0-9]{40,128}$') {
  $store = [Security.Cryptography.X509Certificates.X509Store]::new(
    [Security.Cryptography.X509Certificates.StoreName]::Root,
    [Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
  )
  try {
    $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    $matches = $store.Certificates.Find(
      [Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
      $thumbprint,
      $false
    )
    foreach ($certificate in $matches) { $store.Remove($certificate) }
  } finally {
    $store.Close()
  }
  if ($matches.Count -gt 0) {
    Write-Host "ถอด local test TLS certificate ออกจาก CurrentUser Root แล้ว" -ForegroundColor Green
  }

  $certutil = Join-Path $env:SystemRoot "System32\certutil.exe"
  $process = Start-Process -FilePath $certutil -ArgumentList "-delstore Root $thumbprint" `
    -Verb RunAs -Wait -PassThru
  if ($process.ExitCode -eq 0) {
    Write-Host "ถอด local test TLS certificate ออกจาก LocalMachine Root แล้ว" -ForegroundColor Green
  } else {
    Write-Warning "ถอด local test TLS certificate จาก LocalMachine Root ไม่สำเร็จ (exit $($process.ExitCode))"
  }
}

Write-Host "เก็บ release files ไว้ที่ $releaseRoot (ไม่มีการลบ artifact หรือ private key)"
