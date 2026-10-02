# Public download locations, independent from the BMS activation/control-plane API.
function Get-RetailLocalReleaseUrls {
  param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$BaseUri = 'https://releases.jachoei.com/retail-local'
  )
  if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { throw 'Invalid release version' }
  $parsed = $null
  if (-not [Uri]::TryCreate($BaseUri, [UriKind]::Absolute, [ref]$parsed) -or
      $parsed.Scheme -ne 'https' -or $parsed.UserInfo -or $parsed.Query -or $parsed.Fragment) {
    throw 'ReleaseBaseUri must be an HTTPS base URL without credentials, query or fragment'
  }
  $root = "$($BaseUri.TrimEnd('/'))/$Version"
  return @{
    WindowsManifestUri = "$root/windows-11-x64/release.jws.json"
    # Folder name is public hosting layout; signed platformTarget remains windows-10-x86-pos.
    WindowsX86ManifestUri = "$root/windows-10-x86/release.jws.json"
    LinuxManifestUri = "$root/ubuntu-24.04-lts-x64/release.jws.json"
    MacArm64ManifestUri = "$root/macos-15-arm64/release.jws.json"
    MacX64ManifestUri = "$root/macos-15-x64/release.jws.json"
  }
}
