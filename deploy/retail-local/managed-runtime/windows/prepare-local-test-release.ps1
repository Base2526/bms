[CmdletBinding()]
param(
  [string]$Version = "0.2.13-localtest.1",
  [string]$SourceImageVersion = "0.2.13",
  [int]$Port = 8443,
  [string]$OutputDirectory,
  [string]$PosInstaller,
  [string]$InnoCompiler
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($PSVersionTable.PSVersion.Major -lt 7) { throw "Run this script with PowerShell 7: pwsh" }
if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { throw "Version must be a semantic version" }
if ($SourceImageVersion -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { throw "SourceImageVersion must be a semantic version" }
if ($Port -lt 1 -or $Port -gt 65535) { throw "Port is invalid" }

function Invoke-Checked([string]$Title, [scriptblock]$Action) {
  Write-Host "`n==> $Title" -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "$Title failed (exit $LASTEXITCODE)" }
}

function Write-Utf8NoBom([string]$Path, [string]$Contents) {
  [IO.File]::WriteAllText($Path, $Contents, [Text.UTF8Encoding]::new($false))
}

function Add-LocalMachineRootCertificate([string]$CertificatePath) {
  $arguments = "-addstore -f Root `"$CertificatePath`""
  $process = Start-Process -FilePath (Join-Path $env:SystemRoot "System32\certutil.exe") `
    -ArgumentList $arguments -Verb RunAs -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "Failed to add the local test TLS certificate to LocalMachine Root (exit $($process.ExitCode))"
  }
}

function Remove-LocalMachineRootCertificate([string]$Thumbprint) {
  if ($Thumbprint -notmatch '^[A-Fa-f0-9]{40,128}$') { return }
  $process = Start-Process -FilePath (Join-Path $env:SystemRoot "System32\certutil.exe") `
    -ArgumentList "-delstore Root $Thumbprint" -Verb RunAs -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    Write-Warning "Failed to remove the local test TLS certificate from LocalMachine Root (exit $($process.ExitCode))"
  }
}

function New-LocalhostCertificate([string]$CertificatePath, [string]$PrivateKeyPath) {
  $rsa = [Security.Cryptography.RSA]::Create(2048)
  try {
    $request = [Security.Cryptography.X509Certificates.CertificateRequest]::new(
      "CN=BMS Retail Local Test Release",
      $rsa,
      [Security.Cryptography.HashAlgorithmName]::SHA256,
      [Security.Cryptography.RSASignaturePadding]::Pkcs1
    )
    $request.CertificateExtensions.Add(
      [Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true)
    )
    $request.CertificateExtensions.Add(
      [Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
        [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor
          [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment,
        $true
      )
    )
    $oids = [Security.Cryptography.OidCollection]::new()
    [void]$oids.Add([Security.Cryptography.Oid]::new("1.3.6.1.5.5.7.3.1", "Server Authentication"))
    $request.CertificateExtensions.Add(
      [Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids, $false)
    )
    $san = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $san.AddDnsName("localhost")
    $san.AddIpAddress([Net.IPAddress]::Loopback)
    $request.CertificateExtensions.Add($san.Build())
    $certificate = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5), [DateTimeOffset]::UtcNow.AddDays(7))
    try {
      $certificatePem = [Security.Cryptography.PemEncoding]::WriteString(
        "CERTIFICATE", $certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert)
      )
      $privateKeyPem = [Security.Cryptography.PemEncoding]::WriteString("PRIVATE KEY", $rsa.ExportPkcs8PrivateKey())
      Write-Utf8NoBom $CertificatePath $certificatePem
      Write-Utf8NoBom $PrivateKeyPath $privateKeyPem

      $publicCertificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new(
        $certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert)
      )
      $store = [Security.Cryptography.X509Certificates.X509Store]::new(
        [Security.Cryptography.X509Certificates.StoreName]::Root,
        [Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
      )
      try {
        $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
        $store.Add($publicCertificate)
      } finally {
        $store.Close()
      }
      Add-LocalMachineRootCertificate $CertificatePath
      return $publicCertificate.Thumbprint
    } finally {
      $certificate.Dispose()
    }
  } finally {
    $rsa.Dispose()
  }
}

function Remove-LocalhostCertificate([string]$Thumbprint) {
  if ($Thumbprint -notmatch '^[A-Fa-f0-9]{40,128}$') { return }
  $store = [Security.Cryptography.X509Certificates.X509Store]::new(
    [Security.Cryptography.X509Certificates.StoreName]::Root,
    [Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
  )
  try {
    $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    $matches = $store.Certificates.Find(
      [Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
      $Thumbprint,
      $false
    )
    foreach ($certificate in $matches) { $store.Remove($certificate) }
  } finally {
    $store.Close()
  }
  Remove-LocalMachineRootCertificate $Thumbprint
}

function Start-LocalReleaseServer(
  [string]$NodePath,
  [string]$ServerScript,
  [string]$PublicRoot,
  [string]$CertificatePath,
  [string]$PrivateKeyPath,
  [string]$LogPath,
  [int]$ListenPort
) {
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $NodePath
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  foreach ($argument in @(
    $ServerScript, "--root", $PublicRoot, "--cert", $CertificatePath,
    "--key", $PrivateKeyPath, "--log", $LogPath, "--port", [string]$ListenPort
  )) {
    [void]$startInfo.ArgumentList.Add($argument)
  }
  $process = [Diagnostics.Process]::Start($startInfo)
  if (-not $process) { throw "Failed to start the local HTTPS release server" }
  return $process
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$managedRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot ".."))
$repoRoot = [IO.Path]::GetFullPath((Join-Path $managedRoot "..\..\.."))
$dirty = @(& git -C $repoRoot status --porcelain --untracked-files=normal)
if ($LASTEXITCODE -ne 0) { throw "Failed to read Git status" }
if ($dirty.Count -gt 0) {
  throw "The working tree must be clean before building a signed test release`n$($dirty -join "`n")"
}
$outputRoot = if ($OutputDirectory) {
  [IO.Path]::GetFullPath($OutputDirectory)
} else {
  Join-Path $repoRoot "artifacts\retail-local\local-test-release\$Version"
}
if (Test-Path -LiteralPath $outputRoot) {
  throw "Output directory already exists. Use a new Version or OutputDirectory to avoid overwriting existing keys or releases: $outputRoot"
}

if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
  $goCandidate = Join-Path $env:ProgramFiles "Go\bin\go.exe"
  if (Test-Path -LiteralPath $goCandidate -PathType Leaf) {
    $env:PATH = "$(Split-Path -Parent $goCandidate)$([IO.Path]::PathSeparator)$env:PATH"
  }
}
foreach ($command in @("docker", "git", "node", "go", "curl.exe")) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Command was not found: $command" }
}
Invoke-Checked "Check Docker engine" { docker info *> $null }

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listener) { throw "Port $Port is already in use" }

$publicRoot = Join-Path $outputRoot "public"
$secretRoot = Join-Path $outputRoot "secrets"
$metadataRoot = Join-Path $outputRoot "metadata"
New-Item -ItemType Directory -Path $publicRoot, $secretRoot, $metadataRoot | Out-Null

$posPath = if ($PosInstaller) {
  [IO.Path]::GetFullPath($PosInstaller)
} else {
  Join-Path $repoRoot "artifacts\retail-local\BMS-Retail-Local-POS-$SourceImageVersion-windows-x64.exe"
}
if (-not (Test-Path -LiteralPath $posPath -PathType Leaf)) { throw "Windows x64 POS installer was not found: $posPath" }

$sourceCommit = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch '^[a-f0-9]{40}$') { throw "Failed to read the source commit" }

$imageRefs = [ordered]@{
  web = "bms-retail-local-web:$SourceImageVersion"
  ws = "bms-retail-local-ws:$SourceImageVersion"
  postgres = "postgres:16-alpine"
  redis = "redis:7-alpine"
}
$nextBuildCpus = if ([string]::IsNullOrWhiteSpace($env:NEXT_BUILD_CPUS)) { "2" } else { $env:NEXT_BUILD_CPUS }
$nodeBuildHeap = if ([string]::IsNullOrWhiteSpace($env:NODE_BUILD_MAX_OLD_SPACE_SIZE)) { "4096" } else { $env:NODE_BUILD_MAX_OLD_SPACE_SIZE }
Invoke-Checked "Build Web image from source commit $sourceCommit" {
  docker buildx build --platform linux/amd64 --provenance=false --load `
    --build-arg "BMS_SOURCE_COMMIT=$sourceCommit" `
    --build-arg "NEXT_BUILD_CPUS=$nextBuildCpus" `
    --build-arg "NODE_BUILD_MAX_OLD_SPACE_SIZE=$nodeBuildHeap" `
    --build-arg "NEXT_PUBLIC_BASE_URL=http://127.0.0.1:3100" `
    --build-arg "NEXT_PUBLIC_GRAPHQL_HTTP=http://127.0.0.1:3100/api/graphql" `
    --build-arg "NEXT_PUBLIC_GRAPHQL_WS=ws://127.0.0.1:3101/graphql" `
    --build-arg "COOKIE_SECURE=0" --build-arg "WEB_NAME=BMS Retail Local" `
    -f (Join-Path $repoRoot "apps\web\Dockerfile") -t $imageRefs.web $repoRoot
}
Invoke-Checked "Build WS image from source commit $sourceCommit" {
  docker buildx build --platform linux/amd64 --provenance=false --load `
    --build-arg "BMS_SOURCE_COMMIT=$sourceCommit" `
    -f (Join-Path $repoRoot "apps\ws\Dockerfile") -t $imageRefs.ws $repoRoot
}
foreach ($entry in $imageRefs.GetEnumerator()) {
  Invoke-Checked "Check image $($entry.Key)" { docker image inspect $entry.Value *> $null }
  $platform = (& docker image inspect --format '{{.Os}}/{{.Architecture}}' $entry.Value).Trim()
  if ($LASTEXITCODE -ne 0 -or $platform -ne "linux/amd64") {
    throw "Image $($entry.Value) must be linux/amd64 (found $platform)"
  }
}
foreach ($name in @("web", "ws")) {
  $revision = (& docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' $imageRefs[$name]).Trim()
  if ($LASTEXITCODE -ne 0 -or $revision -ne $sourceCommit) {
    throw "Image $($imageRefs[$name]) does not match source commit $sourceCommit (found $revision)"
  }
}
Invoke-Checked "Check the runtime for provisioning and sample data" {
  docker run --rm --entrypoint sh $imageRefs.web -lc `
    'test -f scripts/retail-local-provision.mts && test -f scripts/retail-local-sample-data.mts && node --conditions=react-server --input-type=module -e "await import(''server-only'')"'
}
$createdAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
$keyId = "local-test-$($Version.Replace('.', '-'))"
$manifestUrl = "https://localhost:$Port/release.jws.json"
$privateSigningKey = Join-Path $secretRoot "release-signing-private.pem"
$publicSigningKey = Join-Path $metadataRoot "release-signing-public.pem"
$keyringPath = Join-Path $metadataRoot "trusted-release-keys.json"

Invoke-Checked "Create an Ed25519 local test keyring" {
  node (Join-Path $managedRoot "create-local-test-signing-key.mjs") `
    $keyId $privateSigningKey $publicSigningKey $keyringPath
}

$runtimeTag = "bms-retail-local-runtime-rootfs-localtest:$($Version.ToLowerInvariant())"
$runtimeContainer = "bms-runtime-rootfs-export-$([Guid]::NewGuid().ToString('N'))"
try {
  foreach ($entry in $imageRefs.GetEnumerator()) {
    Invoke-Checked "Save the $($entry.Key) OCI artifact" {
      docker image save --output (Join-Path $publicRoot "$($entry.Key).artifact") $entry.Value
    }
  }

  Invoke-Checked "Pull the Ubuntu 24.04 base for the private WSL runtime" { docker pull ubuntu:24.04 }
  $ubuntuDigest = (& docker image inspect --format '{{index .RepoDigests 0}}' ubuntu:24.04).Trim()
  if ($LASTEXITCODE -ne 0 -or $ubuntuDigest -notmatch '^ubuntu@sha256:[a-f0-9]{64}$') {
    throw "Failed to resolve the immutable Ubuntu digest: $ubuntuDigest"
  }
  Invoke-Checked "Create the private WSL runtime rootfs" {
    docker build --pull --build-arg "UBUNTU_IMAGE=$ubuntuDigest" -t $runtimeTag `
      -f (Join-Path $managedRoot "runtime-rootfs\Dockerfile") (Join-Path $managedRoot "runtime-rootfs")
  }
  Invoke-Checked "Export the private WSL runtime rootfs" {
    docker create --name $runtimeContainer $runtimeTag *> $null
    docker export --output (Join-Path $publicRoot "runtime.artifact") $runtimeContainer
  }
} finally {
  docker rm -f $runtimeContainer *> $null
  docker image rm $runtimeTag *> $null
}

Copy-Item -LiteralPath (Join-Path $managedRoot "compose.managed.yml") -Destination (Join-Path $publicRoot "compose.artifact")
Copy-Item -LiteralPath $posPath -Destination (Join-Path $publicRoot "desktop.artifact")
Copy-Item -LiteralPath (Join-Path $repoRoot "packages\retail-local-contract\shop-archetypes.json") `
  -Destination (Join-Path $publicRoot "shop-archetypes.artifact")

$digests = @{}
foreach ($entry in $imageRefs.GetEnumerator()) {
  $digest = (& docker image inspect --format '{{.Id}}' $entry.Value).Trim()
  if ($LASTEXITCODE -ne 0 -or $digest -notmatch '^sha256:[a-f0-9]{64}$') { throw "Failed to read the digest of $($entry.Key)" }
  $digests[$entry.Key] = $digest
}

function New-Component([string]$Name, [string]$Kind, [hashtable]$Extra = @{}) {
  $component = [ordered]@{
    name = $Name
    kind = $Kind
    path = (Join-Path $publicRoot "$Name.artifact")
    url = "https://localhost:$Port/$Name.artifact"
  }
  foreach ($entry in $Extra.GetEnumerator()) { $component[$entry.Key] = $entry.Value }
  return $component
}

$descriptor = [ordered]@{
  releaseVersion = $Version
  channel = "pilot"
  platformTarget = "windows-11-x64"
  minimumAgentVersion = "0.5.6"
  schemaVersion = "10.36"
  rollbackSafe = $false
  createdAt = $createdAt
  sourceCommit = $sourceCommit
  keyId = $keyId
  components = @(
    (New-Component "web" "oci-image" @{ imageRef = $imageRefs.web; ociDigest = $digests.web }),
    (New-Component "ws" "oci-image" @{ imageRef = $imageRefs.ws; ociDigest = $digests.ws }),
    (New-Component "postgres" "oci-image" @{ imageRef = $imageRefs.postgres; ociDigest = $digests.postgres }),
    (New-Component "redis" "oci-image" @{ imageRef = $imageRefs.redis; ociDigest = $digests.redis }),
    (New-Component "runtime" "runtime"),
    (New-Component "compose" "support-file"),
    (New-Component "desktop" "desktop"),
    (New-Component "shop-archetypes" "support-file")
  )
}
$descriptorPath = Join-Path $metadataRoot "release-descriptor.json"
Write-Utf8NoBom $descriptorPath (($descriptor | ConvertTo-Json -Depth 8) + "`n")

$previousSigningFlag = $env:BMS_ALLOW_LOCAL_RELEASE_SIGNING
try {
  $env:BMS_ALLOW_LOCAL_RELEASE_SIGNING = "1"
  Invoke-Checked "Sign the release manifest" {
    node (Join-Path $managedRoot "sign-release.mjs") $descriptorPath $privateSigningKey `
      (Join-Path $publicRoot "release.jws.json")
  }
} finally {
  $env:BMS_ALLOW_LOCAL_RELEASE_SIGNING = $previousSigningFlag
}
Invoke-Checked "Verify the Ed25519 signature and release target" {
  node (Join-Path $managedRoot "verify-release.mjs") --manifest (Join-Path $publicRoot "release.jws.json") `
    --public-key $publicSigningKey --key-id $keyId --target "windows-11-x64"
}

$tlsCertificate = Join-Path $metadataRoot "localhost-certificate.pem"
$tlsPrivateKey = Join-Path $secretRoot "localhost-private-key.pem"
$certificateThumbprint = ""
$serverProcess = $null
try {
  Write-Host "`n==> Create and trust an HTTPS certificate for localhost (CurrentUser + LocalMachine)" -ForegroundColor Cyan
  $certificateThumbprint = New-LocalhostCertificate $tlsCertificate $tlsPrivateKey

  $serverScript = Join-Path $managedRoot "serve-local-test-release.mjs"
  $serverLog = Join-Path $metadataRoot "release-server.log"
  $nodePath = (Get-Command node).Source
  $serverProcess = Start-LocalReleaseServer $nodePath $serverScript $publicRoot $tlsCertificate $tlsPrivateKey $serverLog $Port

  $state = [ordered]@{
    formatVersion = 1
    releaseVersion = $Version
    manifestUrl = $manifestUrl
    keyId = $keyId
    keyringPath = $keyringPath
    serverPid = $serverProcess.Id
    serverScript = $serverScript
    certificateThumbprint = $certificateThumbprint
    certificateStores = @("CurrentUser/Root", "LocalMachine/Root")
    createdAt = $createdAt
  }
  Write-Utf8NoBom (Join-Path $outputRoot "local-test-state.json") (($state | ConvertTo-Json -Depth 4) + "`n")

  $ready = $false
  Start-Sleep -Seconds 1
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    if ($serverProcess.HasExited) { throw "The local HTTPS release server stopped before it was ready. Check the log: $serverLog" }
    & curl.exe --fail --silent --show-error --head --max-time 5 --output NUL $manifestUrl
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw "The local HTTPS release server is not ready: $manifestUrl" }
  $rangeProbe = Join-Path $metadataRoot "range-probe.bin"
  try {
    $rangeStatus = & curl.exe --fail --silent --show-error --max-time 5 --range 0-31 `
      --output $rangeProbe --write-out '%{http_code}' "https://localhost:$Port/compose.artifact"
    if ($LASTEXITCODE -ne 0 -or $rangeStatus -ne "206" -or (Get-Item -LiteralPath $rangeProbe).Length -ne 32) {
      throw "The local release server does not support the required resumable range downloads"
    }
  } finally {
    if (Test-Path -LiteralPath $rangeProbe) { Remove-Item -LiteralPath $rangeProbe -Force }
  }

  $bootstrapOutput = Join-Path $outputRoot "bootstrap"
  & (Join-Path $repoRoot "deploy\retail-local\build-online-bootstrap.ps1") -Version $Version `
    -Keyring $keyringPath -WindowsManifestUri $manifestUrl -LinuxManifestUri $manifestUrl `
    -Target Windows -PackageType server-pos -Architecture x64 -OutputDirectory $bootstrapOutput -InnoCompiler $InnoCompiler `
    -AllowTestEndpoints -SkipTests
  if ($LASTEXITCODE -ne 0) { throw "Failed to build the Windows x64 local-test bootstrap" }

  $installer = Get-ChildItem -LiteralPath $bootstrapOutput -Filter '*.exe' -File | Select-Object -First 1
  if (-not $installer) { throw "The built Windows local-test bootstrap was not found" }
  $state["installerPath"] = $installer.FullName
  $state["installerSha256"] = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Utf8NoBom (Join-Path $outputRoot "local-test-state.json") (($state | ConvertTo-Json -Depth 4) + "`n")

  Write-Host "`nLocal test release is ready" -ForegroundColor Green
  Write-Host "Manifest URL : $manifestUrl"
  Write-Host "Public keyring: $keyringPath"
  Write-Host "Installer     : $($installer.FullName)"
  Write-Host "Server PID    : $($serverProcess.Id)"
  Write-Host "Stop the server and remove the certificate: pwsh -File `"$(Join-Path $scriptRoot 'stop-local-test-release.ps1')`" -ReleaseDirectory `"$outputRoot`""
} catch {
  if ($serverProcess -and -not $serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue }
  if ($certificateThumbprint) {
    Remove-LocalhostCertificate $certificateThumbprint
  }
  throw
}
