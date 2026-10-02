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
#ifndef ControlUri
  #define ControlUri ""
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
Source: "{#BuildRoot}\setup-diagnostics.ps1"; DestDir: "{tmp}\bms-pos-bootstrap"; Flags: ignoreversion deleteafterinstall

[Code]
var
  BootstrapFailed: Boolean;
  BootstrapError: String;
  DiagnosticsButton: TNewButton;

procedure OpenDiagnostics(Sender: TObject);
var
  ResultCode: Integer;
begin
  ShellExec('', ExpandConstant('{win}\explorer.exe'),
    AddQuotes(ExpandConstant('{localappdata}\BMS\POSBootstrap\diagnostics')),
    '', SW_SHOWNORMAL, ewNoWait, ResultCode);
  ShellExec('open', 'https://bms.jachoei.com/installer-report', '', '',
    SW_SHOWNORMAL, ewNoWait, ResultCode);
end;

procedure InitializeWizard();
begin
  DiagnosticsButton := TNewButton.Create(WizardForm);
  DiagnosticsButton.Parent := WizardForm;
  DiagnosticsButton.SetBounds(ScaleX(16), WizardForm.CancelButton.Top,
    ScaleX(170), WizardForm.CancelButton.Height);
  DiagnosticsButton.Caption := 'Send error report';
  DiagnosticsButton.OnClick := @OpenDiagnostics;
  DiagnosticsButton.Visible := False;
end;

procedure ReportBootstrapFailure(Message: String);
begin
  BootstrapError := Message;
  Log(Message);
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  DiagnosticsButton.Visible := (CurPageID = wpFinished) and BootstrapFailed and
    DirExists(ExpandConstant('{localappdata}\BMS\POSBootstrap\diagnostics'));
  if (CurPageID = wpFinished) and BootstrapFailed then
  begin
    WizardForm.FinishedHeadingLabel.Caption := 'BMS POS setup did not complete';
    WizardForm.FinishedLabel.Caption := BootstrapError + #13#10 + #13#10 +
      'Run this installer again to resume. Details: ' +
      ExpandConstant('{localappdata}\BMS\POSBootstrap\setup-error.txt');
  end;
end;

function GetCustomSetupExitCode(): Integer;
begin
  Result := 0;
  if BootstrapFailed then Result := 1;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  Parameters, ErrorPath: String;
  ErrorText: AnsiString;
begin
  if CurStep <> ssPostInstall then exit;
  BootstrapFailed := True;
  ErrorPath := ExpandConstant('{localappdata}\BMS\POSBootstrap\setup-error.txt');
  ForceDirectories(ExtractFileDir(ErrorPath));
  DeleteFile(ErrorPath);
  Parameters := '-NoProfile -ExecutionPolicy Bypass -File ' +
    AddQuotes(ExpandConstant('{tmp}\bms-pos-bootstrap\install-pos-online.ps1')) +
    ' -ManifestUri ' + AddQuotes('{#ManifestUri}') +
    ' -ControlUri ' + AddQuotes('{#ControlUri}') +
    ' -PlatformTarget ' + AddQuotes('{#PlatformTarget}') +
    ' -AgentPath ' + AddQuotes(ExpandConstant('{tmp}\bms-pos-bootstrap\bms-runtime-agent.exe')) +
    ' -KeyringPath ' + AddQuotes(ExpandConstant('{tmp}\bms-pos-bootstrap\trusted-release-keys.json')) +
    ' -ErrorFile ' + AddQuotes(ErrorPath) + ' -InstallerVersion ' + AddQuotes('{#ProductVersion}');
  WizardForm.StatusLabel.Caption := 'Downloading and verifying BMS POS...';
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    Parameters, '', SW_SHOW, ewWaitUntilTerminated, ResultCode) then
  begin
    ReportBootstrapFailure('Could not start BMS POS setup.');
    exit;
  end;
  if ResultCode <> 0 then
  begin
    ErrorText := '';
    if LoadStringFromFile(ErrorPath, ErrorText) and (Trim(ErrorText) <> '') then
      ReportBootstrapFailure('BMS POS setup did not complete:' + #13#10 + UTF8Decode(ErrorText))
    else
      ReportBootstrapFailure('BMS POS setup did not complete. Run this installer again to resume.');
    exit;
  end;
  BootstrapFailed := False;
end;
