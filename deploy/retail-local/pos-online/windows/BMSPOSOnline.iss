#ifndef BuildRoot
  #error BuildRoot preprocessor define is required
#endif
#ifndef OutputRoot
  #error OutputRoot preprocessor define is required
#endif
#ifndef ProductVersion
  #error ProductVersion preprocessor define is required
#endif
#ifndef ManifestUri
  #error ManifestUri preprocessor define is required
#endif
#ifndef PlatformTarget
  #error PlatformTarget preprocessor define is required
#endif
#ifndef ArtifactBaseFilename
  #error ArtifactBaseFilename preprocessor define is required
#endif

[Setup]
AppId={{5E967E02-8865-44C8-8594-BC5990C7B552}
AppName=BMS POS Online Setup
AppVersion={#ProductVersion}
AppPublisher=BMS
DefaultDirName={tmp}\BMS POS Online Setup
DisableDirPage=yes
DisableProgramGroupPage=yes
OutputDir={#OutputRoot}
OutputBaseFilename={#ArtifactBaseFilename}
Compression=lzma2/max
SolidCompression=yes
PrivilegesRequired=lowest
Uninstallable=no
WizardStyle=modern
SetupLogging=yes
#if PlatformTarget == "windows-11-x64"
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
#endif

[Files]
Source: "{#BuildRoot}\bms-runtime-agent.exe"; DestDir: "{tmp}\bms-pos-bootstrap"; Flags: ignoreversion deleteafterinstall
Source: "{#BuildRoot}\trusted-release-keys.json"; DestDir: "{tmp}\bms-pos-bootstrap"; Flags: ignoreversion deleteafterinstall
Source: "{#BuildRoot}\install-pos-online.ps1"; DestDir: "{tmp}\bms-pos-bootstrap"; Flags: ignoreversion deleteafterinstall

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{tmp}\bms-pos-bootstrap\install-pos-online.ps1"" -ManifestUri ""{#ManifestUri}"" -PlatformTarget ""{#PlatformTarget}"" -AgentPath ""{tmp}\bms-pos-bootstrap\bms-runtime-agent.exe"" -KeyringPath ""{tmp}\bms-pos-bootstrap\trusted-release-keys.json"""; \
  StatusMsg: "Downloading and verifying BMS POS..."; Flags: waituntilterminated
