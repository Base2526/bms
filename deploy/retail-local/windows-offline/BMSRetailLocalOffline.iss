#ifndef BundleRoot
  #error BundleRoot preprocessor define is required
#endif
#ifndef OutputRoot
  #error OutputRoot preprocessor define is required
#endif
#ifndef ProductVersion
  #error ProductVersion preprocessor define is required
#endif
#ifndef OutputBaseFilename
  #error OutputBaseFilename preprocessor define is required
#endif
#ifndef SetupIconFile
  #error SetupIconFile preprocessor define is required
#endif

[Setup]
AppId={{5A25C92F-6EBB-4EA5-87F7-DCCBE6802C63}
AppName=BMS Retail Local
AppVersion={#ProductVersion}
AppPublisher=BMS
DefaultDirName={localappdata}\BMS\Retail Local
DefaultGroupName=BMS Retail Local
DisableProgramGroupPage=yes
OutputDir={#OutputRoot}
OutputBaseFilename={#OutputBaseFilename}
SetupIconFile={#SetupIconFile}
Compression=lzma2/max
SolidCompression=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
MinVersion=10.0.19044
Uninstallable=no
WizardStyle=modern
SetupLogging=yes
CloseApplications=no

[Files]
Source: "{#BundleRoot}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
#ifdef PosInstaller
Source: "{#PosInstaller}"; DestDir: "{tmp}\bms-retail-local"; DestName: "BMS-POS-Setup.exe"; Flags: ignoreversion deleteafterinstall
#endif

[Icons]
Name: "{group}\Install or repair BMS Retail Local"; Filename: "{app}\Install-BMS-Retail-Local.cmd"; WorkingDir: "{app}"
Name: "{group}\Check BMS Retail Local"; Filename: "{app}\Check-BMS-Retail-Local.cmd"; WorkingDir: "{app}"
Name: "{group}\Open BMS Retail Local"; Filename: "http://127.0.0.1:3100"

[Run]
Filename: "{app}\Install-BMS-Retail-Local.cmd"; WorkingDir: "{app}"; StatusMsg: "Installing the local BMS server..."; Flags: shellexec waituntilterminated
#ifdef PosInstaller
Filename: "{tmp}\bms-retail-local\BMS-POS-Setup.exe"; StatusMsg: "Installing BMS POS..."; Flags: waituntilterminated; Check: ServerInstallationCompleted
#endif

[Code]
function ServerInstallationCompleted(): Boolean;
begin
  Result := FileExists(ExpandConstant('{app}\installation.json'));
  if not Result then
    MsgBox(
      'The BMS Retail Local server did not finish installing. BMS POS was not installed. ' +
      'Run the Install or repair shortcut after correcting the reported prerequisite.',
      mbError,
      MB_OK
    );
end;

