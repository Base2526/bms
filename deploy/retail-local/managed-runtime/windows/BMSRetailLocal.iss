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

[Setup]
AppId={{D6E7A532-27C1-4A69-A2B1-C73B23323431}
AppName=BMS Retail Local
AppVersion={#ProductVersion}
AppPublisher=BMS
DefaultDirName={autopf}\BMS Retail Local
DisableDirPage=yes
DisableProgramGroupPage=yes
OutputDir={#OutputRoot}
OutputBaseFilename=BMS-Retail-Local-Setup-{#ProductVersion}-x64
Compression=lzma2/max
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19044
Uninstallable=yes
WizardStyle=modern
SetupLogging=yes

[Files]
Source: "{#BuildRoot}\bms-runtime-agent.exe"; DestDir: "{tmp}\bms-retail-local"; Flags: ignoreversion
Source: "{#BuildRoot}\trusted-release-keys.json"; DestDir: "{tmp}\bms-retail-local"; Flags: ignoreversion
Source: "{#BuildRoot}\install-managed-runtime.ps1"; DestDir: "{tmp}\bms-retail-local"; Flags: ignoreversion
Source: "{#BuildRoot}\update-managed-runtime.ps1"; DestDir: "{tmp}\bms-retail-local"; Flags: ignoreversion
Source: "{#BuildRoot}\backup-managed-runtime.ps1"; DestDir: "{tmp}\bms-retail-local"; Flags: ignoreversion
Source: "{#BuildRoot}\restore-managed-runtime.ps1"; DestDir: "{tmp}\bms-retail-local"; Flags: ignoreversion
Source: "{#BuildRoot}\configure-offhost-backup.ps1"; DestDir: "{tmp}\bms-retail-local"; Flags: ignoreversion
Source: "{#BuildRoot}\run-offhost-backup.ps1"; DestDir: "{tmp}\bms-retail-local"; Flags: ignoreversion
Source: "{#BuildRoot}\offhost-backup-status.ps1"; DestDir: "{tmp}\bms-retail-local"; Flags: ignoreversion
Source: "{#BuildRoot}\uninstall-managed-runtime.ps1"; DestDir: "{tmp}\bms-retail-local"; Flags: ignoreversion
Source: "{#BuildRoot}\uninstall-managed-runtime.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#BuildRoot}\..\runtime-rootfs\bms-localctl"; DestDir: "{tmp}\bms-retail-local"; Flags: ignoreversion
Source: "{#BuildRoot}\..\runtime-rootfs\bms-update-transaction"; DestDir: "{tmp}\bms-retail-local"; Flags: ignoreversion

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{tmp}\bms-retail-local\install-managed-runtime.ps1"" -ManifestUri ""{#ManifestUri}"""; \
  StatusMsg: "กำลังติดตั้ง BMS Retail Local..."; Flags: waituntilterminated

[Icons]
Name: "{commondesktop}\BMS Retail Local Update"; \
  Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{commonappdata}\BMS\RetailLocal\bootstrap\update-managed-runtime.ps1"" -ManifestUri ""{#ManifestUri}"""
Name: "{commondesktop}\BMS Retail Local Backup"; \
  Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{commonappdata}\BMS\RetailLocal\bootstrap\backup-managed-runtime.ps1"" -Destination ""{userdocs}\BMS-Retail-Local-Backup.age"""
Name: "{commonprograms}\BMS Retail Local\Configure Off-host Backup"; \
  Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoExit -NoProfile -ExecutionPolicy Bypass -File ""{commonappdata}\BMS\RetailLocal\bootstrap\configure-offhost-backup.ps1"""
Name: "{commonprograms}\BMS Retail Local\Off-host Backup Status"; \
  Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoExit -NoProfile -ExecutionPolicy Bypass -File ""{commonappdata}\BMS\RetailLocal\bootstrap\offhost-backup-status.ps1"""; Flags: runmaximized

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\uninstall-managed-runtime.ps1"""; \
  Flags: runhidden waituntilterminated
