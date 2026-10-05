param(
    [string]$DependencyDirectory = 'D:\CodexDeps\TigerestTheater\android',
    [string]$AsciiWorkspace = 'C:\A\tigerest-android',
    [string[]]$Tasks = @('testDebugUnitTest','lintDebug','assembleDebug'),
    [switch]$Bootstrap
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$env:TIGEREST_ANDROID_DEPS = $DependencyDirectory
if($Bootstrap) { & python (Join-Path $PSScriptRoot 'tools\bootstrap.py'); if($LASTEXITCODE) { throw 'Dependency bootstrap failed' } }
$java = Get-ChildItem -LiteralPath (Join-Path $DependencyDirectory 'java') -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\java.exe') } | Select-Object -First 1
if(!$java) { throw 'Run build.ps1 -Bootstrap first, or set DependencyDirectory to the prepared dependency cache.' }
$env:JAVA_HOME = $java.FullName
$env:ANDROID_HOME = Join-Path $DependencyDirectory 'sdk'
if(Test-Path -LiteralPath $AsciiWorkspace) {
    $item = Get-Item -LiteralPath $AsciiWorkspace
    if(!$item.LinkType -or [IO.Path]::GetFullPath($item.Target).TrimEnd('\') -ne $repo.TrimEnd('\')) { throw 'AsciiWorkspace exists and does not point to this repository; choose another path.' }
} else {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $AsciiWorkspace) | Out-Null
    New-Item -ItemType Junction -Path $AsciiWorkspace -Target $repo | Out-Null
}
if($AsciiWorkspace -match '[^\x00-\x7F]') { throw 'AsciiWorkspace must contain ASCII characters only (Gradle JUnit class discovery on Windows).' }
& (Join-Path $DependencyDirectory 'gradle\gradle-8.13\bin\gradle.bat') -p (Join-Path $AsciiWorkspace 'android') @Tasks --console=plain
if($LASTEXITCODE) { throw "Android build failed ($LASTEXITCODE)" }
if(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'app\build\outputs\apk\debug\app-debug.apk')) {
    & python (Join-Path $PSScriptRoot 'tools\verify_apk.py') (Join-Path $PSScriptRoot 'app\build\outputs\apk\debug\app-debug.apk')
    if($LASTEXITCODE) { throw 'APK native alignment verification failed' }
}
