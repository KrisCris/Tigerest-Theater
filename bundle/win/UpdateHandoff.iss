// In-app update handoff, #included inside [Code] (see src/system/InstallerHandoff.cpp).
// The client starts Setup with /SILENT /TIGERESTRELAUNCH=1 /TIGERESTPID=<pid> and keeps
// running until Setup, already past any UAC prompt, signals Local\TigerestTheaterUpdate-<pid>.
// If the prompt is declined the client simply stays open.

const
  SYNCHRONIZE = $00100000;
  EVENT_MODIFY_STATE = $0002;
  WAIT_TIMEOUT = $00000102;
  ClientExitTimeout = 60000;

function OpenProcess(DesiredAccess: DWord; InheritHandle: BOOL; ProcessId: DWord): THandle;
  external 'OpenProcess@kernel32.dll stdcall';
function OpenEvent(DesiredAccess: DWord; InheritHandle: BOOL; Name: String): THandle;
  external 'OpenEventW@kernel32.dll stdcall';
function SetEvent(Handle: THandle): BOOL;
  external 'SetEvent@kernel32.dll stdcall';
function WaitForSingleObject(Handle: THandle; Milliseconds: DWord): DWord;
  external 'WaitForSingleObject@kernel32.dll stdcall';
function CloseHandle(Handle: THandle): BOOL;
  external 'CloseHandle@kernel32.dll stdcall';

function UpdatingClientPid: DWord;
begin
  Result := StrToIntDef(ExpandConstant('{param:TIGERESTPID|0}'), 0);
end;

// [Run] check for starting the new version after an in-app update.
function RelaunchRequested: Boolean;
begin
  Result := ExpandConstant('{param:TIGERESTRELAUNCH|0}') = '1';
end;

// Asks the updating client to quit and waits for it, so its files are free to replace.
// A client that does not exit in time is left to Restart Manager (/CLOSEAPPLICATIONS).
procedure CloseUpdatingClient;
var
  Pid: DWord;
  Process, Event: THandle;
begin
  Pid := UpdatingClientPid;
  if Pid = 0 then Exit;
  Process := OpenProcess(SYNCHRONIZE, False, Pid);
  Event := OpenEvent(EVENT_MODIFY_STATE, False, 'Local\TigerestTheaterUpdate-' + IntToStr(Pid));
  if Event <> 0 then
  begin
    SetEvent(Event);
    CloseHandle(Event);
    Log('Asked the updating client to quit');
  end
  else
    Log('Updating client event not found');
  if Process <> 0 then
  begin
    if WaitForSingleObject(Process, ClientExitTimeout) = WAIT_TIMEOUT then
      Log('Updating client is still running; Restart Manager will close it');
    CloseHandle(Process);
  end;
end;
