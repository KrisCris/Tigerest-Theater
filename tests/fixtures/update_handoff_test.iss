; Minimal per-user installer around bundle/win/UpdateHandoff.iss for test_installer_handoff.py.
; Its own AppId, no uninstaller and an explicit /DIR keep it away from any installed player.
; ISCC /DHostExe=... /DHandoffIss=... /DOutputDir=... update_handoff_test.iss

#define MyAppExeName "installer_handoff_host.exe"

[Setup]
AppId={{6F1C2B7E-3D4A-4C59-9E21-7A0B5D8C1F42}
AppName=Tigerest Update Handoff Test
AppVersion=1.0
DefaultDirName={localappdata}\TigerestUpdateHandoffTest
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
Uninstallable=no
UsePreviousAppDir=no
OutputDir={#OutputDir}
OutputBaseFilename=update-handoff-test-setup
CloseApplications=yes
RestartApplications=no
Compression=none

[Files]
Source: "{#HostExe}"; DestDir: "{app}"; Flags: ignoreversion

[Run]
; Same entry as the real installer.
Filename: "{app}\{#MyAppExeName}"; Flags: nowait runasoriginaluser; Check: RelaunchRequested

[Code]
#include HandoffIss

// /FAILEARLY=1 stands in for a declined UAC prompt: Setup ends before it signals the client.
function InitializeSetup: Boolean;
begin
  Result := ExpandConstant('{param:FAILEARLY|0}') <> '1';
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  CloseUpdatingClient;
end;
