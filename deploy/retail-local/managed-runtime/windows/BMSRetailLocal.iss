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
#ifndef ActivationUri
  #define ActivationUri ""
#endif
#ifndef PackageType
  #define PackageType "server-pos"
#endif
#ifndef ArtifactBaseFilename
  #define ArtifactBaseFilename "BMS-Retail-Local-Setup-" + ProductVersion + "-x64"
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
OutputBaseFilename={#ArtifactBaseFilename}
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
Source: "{#BuildRoot}\run-managed-runtime.ps1"; DestDir: "{tmp}\bms-retail-local"; Flags: ignoreversion
Source: "{#BuildRoot}\setup-diagnostics.ps1"; DestDir: "{tmp}\bms-retail-local"; Flags: ignoreversion
Source: "{#BuildRoot}\update-managed-runtime.ps1"; DestDir: "{tmp}\bms-retail-local"; Flags: ignoreversion
Source: "{#BuildRoot}\backup-managed-runtime.ps1"; DestDir: "{tmp}\bms-retail-local"; Flags: ignoreversion
Source: "{#BuildRoot}\restore-managed-runtime.ps1"; DestDir: "{tmp}\bms-retail-local"; Flags: ignoreversion
Source: "{#BuildRoot}\configure-offhost-backup.ps1"; DestDir: "{tmp}\bms-retail-local"; Flags: ignoreversion
Source: "{#BuildRoot}\run-offhost-backup.ps1"; DestDir: "{tmp}\bms-retail-local"; Flags: ignoreversion
Source: "{#BuildRoot}\offhost-backup-status.ps1"; DestDir: "{tmp}\bms-retail-local"; Flags: ignoreversion
Source: "{#BuildRoot}\activate-managed-runtime.ps1"; DestDir: "{tmp}\bms-retail-local"; Flags: ignoreversion
Source: "{#BuildRoot}\uninstall-managed-runtime.ps1"; DestDir: "{tmp}\bms-retail-local"; Flags: ignoreversion
Source: "{#BuildRoot}\uninstall-managed-runtime.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#BuildRoot}\..\runtime-rootfs\bms-localctl"; DestDir: "{tmp}\bms-retail-local"; Flags: ignoreversion
Source: "{#BuildRoot}\..\runtime-rootfs\bms-update-transaction"; DestDir: "{tmp}\bms-retail-local"; Flags: ignoreversion
Source: "{#BuildRoot}\..\runtime-rootfs\bms-wsl-keepalive"; DestDir: "{tmp}\bms-retail-local"; Flags: ignoreversion

[Icons]
Name: "{commondesktop}\BMS Retail Local Admin"; \
  Filename: "http://127.0.0.1:3100/admin/login"
Name: "{commonprograms}\BMS Retail Local\Open Admin"; \
  Filename: "http://127.0.0.1:3100/admin/login"
Name: "{commondesktop}\BMS Retail Local Check for Updates"; \
  Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoExit -NoProfile -ExecutionPolicy Bypass -File ""{commonappdata}\BMS\RetailLocal\bootstrap\update-managed-runtime.ps1"" -ManifestUri ""{#ManifestUri}"" -CheckOnly"
Name: "{commondesktop}\BMS Retail Local Update"; \
  Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoExit -NoProfile -ExecutionPolicy Bypass -File ""{commonappdata}\BMS\RetailLocal\bootstrap\update-managed-runtime.ps1"" -ManifestUri ""{#ManifestUri}"""
Name: "{commondesktop}\BMS Retail Local Backup"; \
  Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{commonappdata}\BMS\RetailLocal\bootstrap\backup-managed-runtime.ps1"" -Destination ""{userdocs}\BMS-Retail-Local-Backup.age"""
Name: "{commonprograms}\BMS Retail Local\Configure Off-host Backup"; \
  Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoExit -NoProfile -ExecutionPolicy Bypass -File ""{commonappdata}\BMS\RetailLocal\bootstrap\configure-offhost-backup.ps1"""
Name: "{commonprograms}\BMS Retail Local\Off-host Backup Status"; \
  Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoExit -NoProfile -ExecutionPolicy Bypass -File ""{commonappdata}\BMS\RetailLocal\bootstrap\offhost-backup-status.ps1"""; Flags: runmaximized
Name: "{commonprograms}\BMS Retail Local\Activate or Transfer"; \
  Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoExit -NoProfile -ExecutionPolicy Bypass -File ""{commonappdata}\BMS\RetailLocal\bootstrap\activate-managed-runtime.ps1"" -ActivationUri ""{#ActivationUri}"""; Flags: runmaximized
Name: "{commonprograms}\BMS Retail Local\Uninstall BMS Retail Local"; \
  Filename: "{uninstallexe}"

[Run]
Filename: "http://127.0.0.1:3100/admin/login"; \
  Description: "เปิด BMS Retail Local Admin"; \
  Flags: postinstall shellexec runasoriginaluser skipifsilent nowait; Check: CanOpenAdmin

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\uninstall-managed-runtime.ps1"""; \
  Flags: runhidden waituntilterminated; RunOnceId: "BMSManagedRuntimeCleanup"

[Code]
var
  ManagedRuntimeNeedsRestart: Boolean;
  BootstrapFailed: Boolean;
  BootstrapError: String;
  DiagnosticsButton: TNewButton;
  CompletionText: TNewMemo;

function CanOpenAdmin(): Boolean;
begin
  Result := ('{#PackageType}' = 'server') and (not BootstrapFailed) and
    (not ManagedRuntimeNeedsRestart) and
    FileExists(ExpandConstant('{commonappdata}\BMS\RetailLocal\installation.json'));
end;

procedure OpenDiagnostics(Sender: TObject);
var
  ResultCode: Integer;
begin
  ShellExec('', ExpandConstant('{win}\explorer.exe'),
    AddQuotes(ExpandConstant('{commonappdata}\BMS\RetailLocal\diagnostics')),
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
    DirExists(ExpandConstant('{commonappdata}\BMS\RetailLocal\diagnostics'));
  if (CurPageID = wpFinished) and BootstrapFailed then
  begin
    WizardForm.FinishedHeadingLabel.Caption := 'BMS Retail Local setup did not complete';
    WizardForm.FinishedLabel.Caption := BootstrapError + #13#10 + #13#10 +
      'Run this installer again to resume. Details: ' +
      ExpandConstant('{commonappdata}\BMS\RetailLocal\setup-transcript.log');
  end
  else if (CurPageID = wpFinished) and ManagedRuntimeNeedsRestart then
  begin
    WizardForm.FinishedHeadingLabel.Caption := 'ต้อง restart Windows เพื่อติดตั้งต่อ';
    WizardForm.FinishedLabel.Caption :=
      'การติดตั้งยังไม่เสร็จ กรุณา restart แล้วเข้าสู่ระบบ Windows ด้วยบัญชีเดิม' + #13#10 + #13#10 +
      'Setup จะทำงานต่อให้อัตโนมัติ เมื่อเสร็จแล้วจะแสดงวิธีเปิด BMS Retail Local Admin';
  end
  else if (CurPageID = wpFinished) and ('{#PackageType}' = 'server') then
  begin
    WizardForm.FinishedHeadingLabel.Caption := 'ติดตั้ง BMS Retail Local Server สำเร็จ';
    { A scrollable summary keeps all next steps readable at large font sizes. }
    if CompletionText = nil then
    begin
      CompletionText := TNewMemo.Create(WizardForm);
      CompletionText.Parent := WizardForm.FinishedLabel.Parent;
      CompletionText.ReadOnly := True;
      CompletionText.ScrollBars := ssVertical;
      CompletionText.WordWrap := True;
      WizardForm.RunList.Top := WizardForm.FinishedPage.ClientHeight - ScaleY(40);
      WizardForm.RunList.Height := ScaleY(36);
      CompletionText.SetBounds(WizardForm.FinishedLabel.Left, WizardForm.FinishedLabel.Top,
        WizardForm.FinishedLabel.Width,
        WizardForm.RunList.Top - WizardForm.FinishedLabel.Top - ScaleY(8));
    end;
    WizardForm.FinishedLabel.Visible := False;
    CompletionText.Text :=
      'ระบบทำงานเบื้องหลัง ปิดหน้าต่างนี้ได้ และระบบจะเริ่มอัตโนมัติหลังเปิดเครื่อง' + #13#10 + #13#10 +
      '1. เปิด Admin: http://127.0.0.1:3100/admin/login' + #13#10 +
      '   เข้าสู่ระบบด้วยอีเมลและรหัสผ่านผู้ดูแลที่สร้างระหว่างติดตั้ง' + #13#10 +
      '2. ตั้งค่า backup: Start > BMS Retail Local > Configure Off-host Backup' + #13#10 +
      '3. จับคู่ POS: Admin > POS Devices > ออก token' + #13#10 + #13#10 +
      'เปิดอีกครั้งได้จาก Desktop: BMS Retail Local Admin' + #13#10 +
      'URL นี้ใช้บนเครื่อง Server เท่านั้น การเชื่อม POS เครื่องอื่นต้องตั้งค่าเครือข่ายกับผู้ดูแลระบบก่อน';
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
  PowerShellPath: String;
  ScriptPath: String;
  InstallScriptPath: String;
  Parameters: String;
  ErrorPath: String;
  LogPath: String;
  ErrorText: AnsiString;
begin
  if CurStep <> ssPostInstall then
    exit;

  BootstrapFailed := True;
  PowerShellPath := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
  ScriptPath := ExpandConstant('{tmp}\bms-retail-local\run-managed-runtime.ps1');
  InstallScriptPath := ExpandConstant('{tmp}\bms-retail-local\install-managed-runtime.ps1');
  ErrorPath := ExpandConstant('{commonappdata}\BMS\RetailLocal\setup-error.txt');
  LogPath := ExpandConstant('{commonappdata}\BMS\RetailLocal\setup-transcript.log');
  ForceDirectories(ExtractFileDir(ErrorPath));
  DeleteFile(ErrorPath);
  Parameters := '-NoProfile -ExecutionPolicy Bypass -File ' + AddQuotes(ScriptPath) +
    ' -InstallScript ' + AddQuotes(InstallScriptPath) +
    ' -ManifestUri ' + AddQuotes('{#ManifestUri}') +
    ' -PackageType ' + AddQuotes('{#PackageType}');
  if '{#ActivationUri}' <> '' then
    Parameters := Parameters + ' -ActivationUri ' + AddQuotes('{#ActivationUri}');
  Parameters := Parameters + ' -ErrorFile ' + AddQuotes(ErrorPath) +
    ' -LogFile ' + AddQuotes(LogPath) + ' -InstallerVersion ' + AddQuotes('{#ProductVersion}');
  WizardForm.StatusLabel.Caption := 'กำลังเปิดหน้าต่างตั้งค่าร้าน...';
  WizardForm.Hide;
  try
    if not Exec(PowerShellPath, Parameters, '', SW_SHOWMAXIMIZED, ewWaitUntilTerminated, ResultCode) then
    begin
      ReportBootstrapFailure('เปิด BMS Retail Local Setup ไม่สำเร็จ');
      exit;
    end;
  finally
    WizardForm.Show;
  end;
  if ResultCode = 3010 then
  begin
    ManagedRuntimeNeedsRestart := True;
    SuppressibleMsgBox('ต้อง restart Windows หนึ่งครั้ง ระบบจะติดตั้งต่อให้อัตโนมัติ',
      mbInformation, MB_OK, IDOK);
  end
  else if ResultCode <> 0 then
  begin
    ErrorText := '';
    if LoadStringFromFile(ErrorPath, ErrorText) and (Trim(ErrorText) <> '') then
      ReportBootstrapFailure('BMS Retail Local Setup ยังไม่สำเร็จ:' + #13#10 + UTF8Decode(ErrorText))
    else
      ReportBootstrapFailure('BMS Retail Local Setup ยังไม่สำเร็จ กรุณาตรวจ ' + LogPath + ' แล้วลองใหม่');
    exit;
  end;
  BootstrapFailed := False;
end;

function NeedRestart(): Boolean;
begin
  Result := ManagedRuntimeNeedsRestart;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    UninstallProgressForm.StatusLabel.Caption :=
      'กำลังหยุดบริการและยกเลิกรายการเปิดอัตโนมัติ (ปกติไม่เกิน 15 วินาที)...'
  else if CurUninstallStep = usPostUninstall then
    { Inno has already destroyed UninstallProgressForm at usPostUninstall. }
    Log('BMS Retail Local uninstall file cleanup completed.');
end;
