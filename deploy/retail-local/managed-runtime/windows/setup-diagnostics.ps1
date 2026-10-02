function Protect-BmsDiagnosticText([string]$Text) {
  # Transcripts and command lines are never exported. Scrub the bounded exception text too.
  if ($Text.Length -gt 65536) { $Text = $Text.Substring(0, 65536) }
  $clean = [regex]::Replace($Text, '(?s)-----BEGIN [^-]*PRIVATE KEY-----.*?(-----END [^-]*PRIVATE KEY-----|\z)', '[private key removed]')
  $clean = [regex]::Replace($clean, '(?im)^.*private[_ -]?key.*(?:\r?\n|$)', "[sensitive line removed]`n")
  $clean = [regex]::Replace($clean, '(?im)^.*(?:password|passwd|pwd|\bpin\b|token|secret|authorization|cookie|credential|api[_-]?key|\u0e23\u0e2b\u0e31\u0e2a\u0e1c\u0e48\u0e32\u0e19|\u0e0a\u0e37\u0e48\u0e2d\u0e23\u0e49\u0e32\u0e19|\u0e1c\u0e39\u0e49\u0e14\u0e39\u0e41\u0e25|\u0e2d\u0e35\u0e40\u0e21\u0e25).*(?:\r?\n|$)', "[sensitive line removed]`n")
  $clean = [regex]::Replace($clean, '(?i)\b[a-z][a-z0-9+.-]*://[^\s<>"'']+', '[url removed]')
  $clean = [regex]::Replace($clean, '(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', '[email removed]')
  $clean = [regex]::Replace($clean, '(?i)[A-Z]:[\\/][^\r\n"''<>]*', '[local path removed]')
  $clean = [regex]::Replace($clean, '(?i)(?:\\\\|/home/|/Users/)[^\s"''<>]+', '[local path removed]')
  $clean = [regex]::Replace($clean, '\b[A-Za-z0-9_+/=-]{32,}\b', '[opaque value removed]')
  if ($clean.Length -gt 2048) { $clean = $clean.Substring(0, 2048) + ' [truncated]' }
  return $clean.Trim()
}

function Get-BmsSetupMachineInfo {
  param([ValidateRange(1, 15)][int]$TimeoutSeconds = 8)
  $job = $null
  try {
    # Run inventory out of process: broken WMI/AppX must not strand the failure screen.
    $job = Start-Job -ScriptBlock {
      $ErrorActionPreference = 'Stop'
      $info = [ordered]@{
        status = 'partial'; windows = $null; hardware = $null; systemDisk = $null
        wsl = $null; services = @(); powershellVersion = $PSVersionTable.PSVersion.ToString()
        architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
      }
      try {
        $os = Get-CimInstance Win32_OperatingSystem -OperationTimeoutSec 2
        $info.windows = [ordered]@{ name = $os.Caption; version = $os.Version; build = $os.BuildNumber; architecture = $os.OSArchitecture }
      } catch {}
      try {
        $system = Get-CimInstance Win32_ComputerSystem -OperationTimeoutSec 2
        $cpu = Get-CimInstance Win32_Processor -OperationTimeoutSec 2 | Select-Object -First 1
        $info.hardware = [ordered]@{
          ramBytes = $system.TotalPhysicalMemory; logicalProcessors = $system.NumberOfLogicalProcessors
          hypervisorPresent = $system.HypervisorPresent; virtualizationFirmwareEnabled = $cpu.VirtualizationFirmwareEnabled
        }
      } catch {}
      try {
        $disk = [IO.DriveInfo]::new($env:SystemDrive)
        $info.systemDisk = [ordered]@{ totalBytes = $disk.TotalSize; freeBytes = $disk.AvailableFreeSpace }
      } catch {}
      try {
        $package = Get-AppxPackage -Name MicrosoftCorporationII.WindowsSubsystemForLinux | Select-Object -First 1
        $registered = @(Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss' -ErrorAction SilentlyContinue |
          Get-ItemProperty | Where-Object { $_.DistributionName -eq 'BMSRuntime' })
        $info.wsl = [ordered]@{
          launcherPresent = (Test-Path -LiteralPath "$env:SystemRoot\System32\wsl.exe")
          packageVersion = if ($package) { [string]$package.Version } else { $null }
          bmsRuntimeRegisteredForCurrentUser = ($registered.Count -gt 0)
        }
      } catch {}
      foreach ($name in @('WslService', 'LxssManager', 'vmcompute', 'com.docker.service')) {
        $service = Get-Service -Name $name -ErrorAction SilentlyContinue
        if ($service) { $info.services += @{ name = $name; status = [string]$service.Status } }
      }
      $info.status = if ($null -ne $info.windows -and $null -ne $info.hardware -and $null -ne $info.wsl) { 'collected' } else { 'partial' }
      # Serialize only the allow-listed fields, never CIM objects or PS job metadata.
      $info | ConvertTo-Json -Depth 6 -Compress
    }
    if (-not (Wait-Job -Job $job -Timeout $TimeoutSeconds)) { return @{ status = 'timed-out' } }
    $result = @(Receive-Job -Job $job -ErrorAction Stop)
    if ($result.Count -ne 1) { return @{ status = 'unavailable' } }
    return ($result[0] | ConvertFrom-Json)
  } catch {
    return @{ status = 'unavailable' }
  } finally {
    if ($null -ne $job) { Remove-Job -Job $job -Force -ErrorAction SilentlyContinue }
  }
}

function New-BmsSetupDiagnostics {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][System.Management.Automation.ErrorRecord]$Failure,
    [ValidateSet('server-pos', 'server', 'pos')][string]$Product = 'server-pos',
    [string]$InstallerVersion = 'unknown',
    [string]$Stage = 'startup'
  )
  $archive = $null
  $stream = $null
  $path = $null
  try {
    $folder = Join-Path $Root 'diagnostics'
    New-Item -ItemType Directory -Path $folder -Force | Out-Null
    $id = [Guid]::NewGuid().ToString('N')
    $report = [ordered]@{
      formatVersion = 1; reportId = $id; createdAt = [DateTime]::UtcNow.ToString('o')
      product = $Product; installerVersion = (Protect-BmsDiagnosticText $InstallerVersion)
      stage = (Protect-BmsDiagnosticText $Stage)
      failure = [ordered]@{
        message = (Protect-BmsDiagnosticText $Failure.Exception.Message)
        exceptionType = $Failure.Exception.GetType().FullName
        hresult = $Failure.Exception.HResult
        scriptLine = $Failure.InvocationInfo.ScriptLineNumber
      }
      machine = (Get-BmsSetupMachineInfo)
    }
    Add-Type -AssemblyName System.IO.Compression
    $path = Join-Path $folder ("bms-install-error-{0}-{1}.zip" -f [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'), $id)
    $stream = [IO.File]::Open($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $true)
    $files = [ordered]@{
      'diagnostics.json' = ($report | ConvertTo-Json -Depth 8)
      'README.txt' = @'
BMS installation failure report
Review diagnostics.json before sharing this ZIP with BMS support.
Contains: installer version, failed stage, redacted exception, Windows build,
architecture, RAM, disk space, virtualization and selected service/WSL status.
Inventory is time-limited; partial/unavailable fields are not a successful check.
No transcript, database, shop files, environment files, credentials, serial numbers,
machine name, user name or full command line is collected. No automatic upload occurs.
Raw setup logs remain on the computer and are not included in this ZIP.
Submit this ZIP after reviewing it: https://bms.jachoei.com/installer-report
Submission requires consent. Keep this file and retry if the network is unavailable.
'@
    }
    foreach ($entry in $files.GetEnumerator()) {
      $writer = [IO.StreamWriter]::new($archive.CreateEntry($entry.Key).Open(), [Text.UTF8Encoding]::new($false))
      try { $writer.Write([string]$entry.Value) } finally { $writer.Dispose() }
    }
    $archive.Dispose(); $archive = $null
    $stream.Dispose(); $stream = $null
    return $path
  } catch {
    # Reporting must never replace the original installation failure.
    try { if ($null -ne $archive) { $archive.Dispose() } } catch {}
    $archive = $null
    try { if ($null -ne $stream) { $stream.Dispose() } } catch {}
    $stream = $null
    try { if ($path -and [IO.File]::Exists($path)) { [IO.File]::Delete($path) } } catch {}
    return $null
  } finally {
    if ($null -ne $archive) { $archive.Dispose() }
    if ($null -ne $stream) { $stream.Dispose() }
  }
}
