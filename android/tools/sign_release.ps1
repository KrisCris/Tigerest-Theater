param(
    [string]$DependencyDirectory = 'D:\CodexDeps\TigerestTheater\android',
    [string]$SigningDirectory = 'D:\CodexDeps\TigerestTheater\android\signing',
    [string]$Output = (Join-Path $PSScriptRoot '..\dist\TigerestTheater-2.4.1-android.apk')
)
$ErrorActionPreference = 'Stop'
$java = Get-ChildItem -LiteralPath (Join-Path $DependencyDirectory 'java') -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\java.exe') } | Select-Object -First 1
if(!$java) { throw 'Prepared JDK not found; run build.ps1 -Bootstrap.' }
$env:JAVA_HOME = $java.FullName
$key = Join-Path $SigningDirectory 'tigerest-android.p12'
$password = Join-Path $SigningDirectory 'password.txt'
if(!(Test-Path -LiteralPath $key)) {
    if(Test-Path -LiteralPath $password) { throw 'Incomplete signing state; preserve and inspect existing password file.' }
    New-Item -ItemType Directory -Force -Path $SigningDirectory | Out-Null
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls $SigningDirectory /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    if($LASTEXITCODE) { throw 'Unable to protect signing directory.' }
    $bytes = [byte[]]::new(48); [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    [IO.File]::WriteAllText($password,[Convert]::ToBase64String($bytes),[Text.UTF8Encoding]::new($false))
    & (Join-Path $java.FullName 'bin\keytool.exe') -genkeypair -keystore $key -storetype PKCS12 -storepass:file $password -keypass:file $password -alias tigerest-android -keyalg RSA -keysize 4096 -validity 10000 -dname 'CN=Tigerest Local Android, OU=Development, O=Tigerest'
    if($LASTEXITCODE) { throw 'Signing key generation failed.' }
}
if(!(Test-Path -LiteralPath $password)) { throw 'Signing password file missing; restore the paired signing backup.' }
$unsigned = Join-Path $PSScriptRoot '..\app\build\outputs\apk\release\app-release-unsigned.apk'
if(!(Test-Path -LiteralPath $unsigned)) { throw 'Build assembleRelease before signing.' }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Output) | Out-Null
$signer = Join-Path $DependencyDirectory 'sdk\build-tools\36.0.0\apksigner.bat'
& $signer sign --ks $key --ks-pass "file:$password" --ks-key-alias tigerest-android --out $Output $unsigned
if($LASTEXITCODE) { throw 'APK signing failed.' }
& $signer verify --verbose --print-certs $Output
if($LASTEXITCODE) { throw 'APK signature verification failed.' }
& python (Join-Path $PSScriptRoot 'verify_apk.py') $Output
if($LASTEXITCODE) { throw 'Signed APK native verification failed.' }
