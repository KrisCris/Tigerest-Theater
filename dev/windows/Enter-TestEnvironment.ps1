param([string]$BuildDirectory = (Join-Path $PSScriptRoot '..\..\build'))

# Dot-source this before CTest or individual native tests. Fail before launching
# an executable if its runtime or Qt platform plugins have not been prepared.
$taskBuild = (Resolve-Path -LiteralPath $BuildDirectory -ErrorAction Stop).Path
$taskCachePath = Join-Path $taskBuild 'CMakeCache.txt'
if (-not (Test-Path -LiteralPath $taskCachePath)) { throw "Configure CMake first: $taskCachePath" }
$taskCache = Get-Content -LiteralPath $taskCachePath
function Get-TestCacheValue([string]$Key) {
    $taskMatch = $taskCache | Select-String -Pattern ('^' + [regex]::Escape($Key) + ':[^=]+=(.*)$') | Select-Object -First 1
    if ($taskMatch) { return $taskMatch.Matches[0].Groups[1].Value }
    return ''
}
$taskQt = Get-TestCacheValue 'QTROOT'
$taskPlatforms = Join-Path $taskQt 'plugins\platforms'
foreach ($taskPlugin in @('qwindows.dll', 'qoffscreen.dll')) {
    if (-not (Test-Path -LiteralPath (Join-Path $taskPlatforms $taskPlugin))) {
        throw "Qt platform plugin missing: $taskPlatforms\$taskPlugin. Restore the configured Qt runtime before testing."
    }
}
$taskRuntimePaths = @(
    (Join-Path $taskBuild 'src\player\interpolation'),
    (Get-TestCacheValue 'TIGEREST_MPV_RUNTIME_DIR'),
    (Join-Path $taskBuild 'output'),
    (Join-Path $taskQt 'bin'),
    (Split-Path -Parent (Get-TestCacheValue 'MPV_LIBRARY')),
    (Split-Path -Parent (Get-TestCacheValue 'CMAKE_MAKE_PROGRAM'))
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) } | Select-Object -Unique
foreach ($taskDll in @('libmpv-2.dll', 'Qt6Core.dll', 'Qt6Gui.dll', 'Qt6Test.dll', 'tigerest-rife.dll')) {
    if (-not ($taskRuntimePaths | Where-Object { Test-Path -LiteralPath (Join-Path $_ $taskDll) })) {
        throw "Test dependency missing: $taskDll. Build the native targets and stage the configured runtime before testing."
    }
}
$env:PATH = ($taskRuntimePaths -join ';') + ';' + $env:PATH
$env:QT_PLUGIN_PATH = Join-Path $taskQt 'plugins'
$env:QT_QPA_PLATFORM_PLUGIN_PATH = $taskPlatforms
$env:QT_ASSUME_STDERR_HAS_CONSOLE = '1'
$env:QT_FORCE_STDERR_LOGGING = '1'
# Loader errors should be reported by the test process, not block in a system dialog.
if (-not ('TigerestTestErrorMode' -as [type])) {
    Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class TigerestTestErrorMode { [DllImport("kernel32.dll")] public static extern uint SetErrorMode(uint mode); }'
}
[TigerestTestErrorMode]::SetErrorMode(0x8003) | Out-Null
Write-Host "Native test runtime ready: $taskBuild"
