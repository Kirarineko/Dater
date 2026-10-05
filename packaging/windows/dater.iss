; Compile with /DVersion=<package-or-tag-version>, /DFileVersion=<numeric-version>,
; /DStagingDirectory=<payload> and /DOutputDirectory=<installer-output>.
; The payload contains dater.exe,
; assets, LICENSE and third-party license notices.
#ifndef Version
  #error "Version must be supplied with /DVersion."
#endif
#ifndef FileVersion
  #define FileVersion Version
#endif
#ifndef StagingDirectory
  #define StagingDirectory "..\..\release\windows-x64"
#endif
#ifndef OutputDirectory
  #define OutputDirectory "..\..\release"
#endif

[Setup]
AppId={{AF6C9D23-8C94-4C91-BE1C-D75EF3C16C18}
AppName=Dater
AppVersion={#Version}
VersionInfoVersion={#FileVersion}
AppPublisher=Dater
DefaultDirName={localappdata}\Programs\Dater
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes
LicenseFile={#StagingDirectory}\LICENSE
OutputDir={#OutputDirectory}
OutputBaseFilename=dater-{#Version}-windows-x64-setup
UninstallDisplayIcon={app}\dater.exe
Compression=lzma2
SolidCompression=yes
CloseApplications=no
SetupLogging=yes
; Inno Setup broadcasts WM_SETTINGCHANGE for Environment after installation
; and uninstallation, so newly opened terminals receive the updated PATH.
ChangesEnvironment=yes

[Files]
Source: "{#StagingDirectory}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Code]
const
  EnvironmentKey = 'Environment';
  InstallerKey = 'Software\Dater\Installer\AF6C9D23-8C94-4C91-BE1C-D75EF3C16C18';
  OwnedEntryName = 'OwnedPathEntry';
  RegistryString = 1;
  RegistryExpandString = 2;
  // Accept only string types; query the 64-bit view without expanding values.
  QueryStringFlags = $10010006;

// Inno Setup 6 uses a 32-bit installer process, including 64-bit install mode.
// lpData is NULL here; only the value type and required size are queried.
function QueryRegistryValue(RootKey: Integer; SubKey, ValueName: String;
  Flags: Cardinal; var ValueType: Cardinal; Data: Integer;
  var DataSize: Cardinal): Integer;
  external 'RegGetValueW@advapi32.dll stdcall';

function ReadUserPath(var Value: String; var ValueType: Cardinal): Boolean;
var
  Status: Integer;
  DataSize: Cardinal;
begin
  Value := '';
  ValueType := RegistryExpandString;
  DataSize := 0;
  Status := QueryRegistryValue(HKCU, EnvironmentKey, 'Path', QueryStringFlags,
    ValueType, 0, DataSize);
  if (Status = 2) or (Status = 3) then
  begin
    ValueType := RegistryExpandString;
    Result := True;
    Exit;
  end;
  if Status <> 0 then
  begin
    Log('Dater: reading PATH type failed with Windows error ' + IntToStr(Status) +
      '; an inaccessible or unsupported registry value will not be overwritten.');
    Result := False;
    Exit;
  end;
  if (ValueType <> RegistryString) and (ValueType <> RegistryExpandString) then
  begin
    Log('Dater: unsupported PATH registry type ' + IntToStr(ValueType) + '.');
    Result := False;
    Exit;
  end;
  Result := RegQueryStringValue(HKCU, EnvironmentKey, 'Path', Value);
end;

function WriteUserPath(const Value: String; ValueType: Cardinal): Boolean;
begin
  if ValueType = RegistryString then
    Result := RegWriteStringValue(HKCU, EnvironmentKey, 'Path', Value)
  else if ValueType = RegistryExpandString then
    Result := RegWriteExpandStringValue(HKCU, EnvironmentKey, 'Path', Value)
  else
    Result := False;
end;

function ExpandPathVariables(const Value: String): String;
var
  Position, ClosingPosition: Integer;
  Name, ExpandedValue: String;
begin
  Result := '';
  Position := 1;
  while Position <= Length(Value) do
  begin
    if Value[Position] = '%' then
    begin
      ClosingPosition := Position + 1;
      while ClosingPosition <= Length(Value) do
      begin
        if Value[ClosingPosition] = '%' then
          Break;
        ClosingPosition := ClosingPosition + 1;
      end;
      if ClosingPosition <= Length(Value) then
      begin
        Name := Copy(Value, Position + 1, ClosingPosition - Position - 1);
        ExpandedValue := GetEnv(Name);
        if ExpandedValue <> '' then
          Result := Result + ExpandedValue
        else
          Result := Result + Copy(Value, Position, ClosingPosition - Position + 1);
        Position := ClosingPosition + 1;
      end
      else
      begin
        Result := Result + Copy(Value, Position, Length(Value) - Position + 1);
        Position := Length(Value) + 1;
      end;
    end
    else
    begin
      Result := Result + Value[Position];
      Position := Position + 1;
    end;
  end;
end;

function NormalizePathEntry(const Value: String): String;
begin
  Result := Trim(Value);
  if Length(Result) >= 2 then
    if (Result[1] = '"') and (Result[Length(Result)] = '"') then
      Result := Copy(Result, 2, Length(Result) - 2);
  Result := ExpandPathVariables(Result);
  StringChangeEx(Result, '/', '\', True);
  while Length(Result) > 3 do
  begin
    if Result[Length(Result)] <> '\' then
      Break;
    Delete(Result, Length(Result), 1);
  end;
  Result := Lowercase(Result);
end;

function HasPathEntry(const Value, Entry: String): Boolean;
var
  Position, SegmentStart: Integer;
  Target: String;
begin
  Result := False;
  Target := NormalizePathEntry(Entry);
  SegmentStart := 1;
  for Position := 1 to Length(Value) + 1 do
  begin
    if Position <= Length(Value) then
      if Value[Position] <> ';' then
        Continue;
    if NormalizePathEntry(Copy(Value, SegmentStart, Position - SegmentStart)) = Target then
    begin
      Result := True;
      Exit;
    end;
    SegmentStart := Position + 1;
  end;
end;

function OwnedDirectory(const Entry: String): String;
begin
  Result := Entry;
  if Length(Result) > 0 then
    if Result[1] = ';' then
      Delete(Result, 1, 1);
end;

function RemoveOwnedPathEntry(const Value, Entry: String): String;
var
  Position, SegmentStart, MatchStart, MatchEnd: Integer;
  Directory: String;
  OwnsSeparator: Boolean;
begin
  Result := Value;
  if Entry = '' then
    Exit;
  Directory := OwnedDirectory(Entry);
  OwnsSeparator := Entry[1] = ';';
  SegmentStart := 1;
  MatchStart := 0;
  MatchEnd := 0;
  for Position := 1 to Length(Value) + 1 do
  begin
    if Position <= Length(Value) then
      if Value[Position] <> ';' then
        Continue;
    // Only remove the exact string (including any added separator), once.
    // If the user edited it, leave the edited entry untouched.
    if Copy(Value, SegmentStart, Position - SegmentStart) = Directory then
    begin
      if (not OwnsSeparator) or (SegmentStart > 1) then
      begin
        MatchStart := SegmentStart;
        MatchEnd := Position;
      end;
    end;
    SegmentStart := Position + 1;
  end;
  if MatchStart = 0 then
    Exit;
  if OwnsSeparator then
    Delete(Result, MatchStart - 1, MatchEnd - MatchStart + 1)
  else
    Delete(Result, MatchStart, MatchEnd - MatchStart);
end;

procedure ReportPathFailure(const Operation: String);
begin
  Log('Dater: could not ' + Operation + ' the current user PATH.');
  SuppressibleMsgBox(
    'Dater could not ' + Operation + ' the current user PATH.' + #13#10 +
    'The application files are installed in ' + ExpandConstant('{app}') + '.' + #13#10 +
    'Manage this directory in your user PATH manually, then open a new terminal.',
    mbError, MB_OK, IDOK);
end;

procedure InstallPathEntry;
var
  OriginalPath, UpdatedPath, PreviousOwnedEntry, InstallDirectory, NewOwnedEntry: String;
  ShouldOwnEntry, MarkerSaved: Boolean;
  PathValueType: Cardinal;
begin
  if not ReadUserPath(OriginalPath, PathValueType) then
  begin
    ReportPathFailure('read');
    Exit;
  end;
  PreviousOwnedEntry := '';
  RegQueryStringValue(HKCU, InstallerKey, OwnedEntryName, PreviousOwnedEntry);
  InstallDirectory := ExpandConstant('{app}');
  UpdatedPath := OriginalPath;
  if (PreviousOwnedEntry <> '') and (OwnedDirectory(PreviousOwnedEntry) <> InstallDirectory) then
    UpdatedPath := RemoveOwnedPathEntry(UpdatedPath, PreviousOwnedEntry);
  NewOwnedEntry := PreviousOwnedEntry;
  ShouldOwnEntry := (OwnedDirectory(PreviousOwnedEntry) = InstallDirectory) and
    (RemoveOwnedPathEntry(UpdatedPath, PreviousOwnedEntry) <> UpdatedPath);
  if not HasPathEntry(UpdatedPath, InstallDirectory) then
  begin
    NewOwnedEntry := InstallDirectory;
    if UpdatedPath <> '' then
      if UpdatedPath[Length(UpdatedPath)] <> ';' then
        NewOwnedEntry := ';' + NewOwnedEntry;
    UpdatedPath := UpdatedPath + NewOwnedEntry;
    ShouldOwnEntry := True;
  end;
  if UpdatedPath <> OriginalPath then
    if not WriteUserPath(UpdatedPath, PathValueType) then
    begin
      ReportPathFailure('update');
      Exit;
    end;
  if ShouldOwnEntry then
    MarkerSaved := RegWriteStringValue(HKCU, InstallerKey, OwnedEntryName, NewOwnedEntry)
  else if PreviousOwnedEntry <> '' then
    MarkerSaved := RegDeleteValue(HKCU, InstallerKey, OwnedEntryName)
  else
    MarkerSaved := True;
  if not MarkerSaved then
  begin
    // Roll back PATH if ownership cannot be recorded for safe uninstallation.
    if UpdatedPath <> OriginalPath then
      if not WriteUserPath(OriginalPath, PathValueType) then
        Log('Dater: could not roll back PATH after an ownership-record failure.');
    ReportPathFailure('record ownership of');
  end;
  RegDeleteKeyIfEmpty(HKCU, InstallerKey);
end;

procedure UninstallPathEntry;
var
  OriginalPath, UpdatedPath, OwnedEntry: String;
  PathValueType: Cardinal;
begin
  OwnedEntry := '';
  if not RegQueryStringValue(HKCU, InstallerKey, OwnedEntryName, OwnedEntry) then
    Exit;
  // Ignore a marker for a different installation directory.
  if OwnedDirectory(OwnedEntry) <> ExpandConstant('{app}') then
    Exit;
  if not ReadUserPath(OriginalPath, PathValueType) then
  begin
    ReportPathFailure('read');
    Exit;
  end;
  UpdatedPath := RemoveOwnedPathEntry(OriginalPath, OwnedEntry);
  if UpdatedPath <> OriginalPath then
    if not WriteUserPath(UpdatedPath, PathValueType) then
    begin
      ReportPathFailure('remove Dater from');
      Exit;
    end;
  RegDeleteValue(HKCU, InstallerKey, OwnedEntryName);
  RegDeleteKeyIfEmpty(HKCU, InstallerKey);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    InstallPathEntry;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    UninstallPathEntry;
end;
