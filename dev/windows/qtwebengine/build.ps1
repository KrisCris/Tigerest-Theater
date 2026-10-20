param(
  [Parameter(Mandatory=$true)][string]$SourceDirectory,
  [Parameter(Mandatory=$true)][string]$BuildDirectory,
  [Parameter(Mandatory=$true)][string]$QtRoot,
  [Parameter(Mandatory=$true)][string]$InstallDirectory,
  [Parameter(Mandatory=$true)][string]$PythonExecutable,
  [ValidateRange(1,64)][int]$Jobs = 8
)
$ErrorActionPreference = 'Stop'
# patches.txt lists the patches in application order; the runtime manifest
# records each one so packaging can reject a runtime built from another set.
$patches = @(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'patches.txt') |
  Where-Object { $_.Trim() } | ForEach-Object { Join-Path $PSScriptRoot $_.Trim() })
if ($patches.Count -eq 0) { throw 'patches.txt lists no patches.' }
$SourceDirectory = [IO.Path]::GetFullPath($SourceDirectory)
$BuildDirectory = [IO.Path]::GetFullPath($BuildDirectory)
$QtRoot = [IO.Path]::GetFullPath($QtRoot)
$InstallDirectory = [IO.Path]::GetFullPath($InstallDirectory)
$PythonExecutable = [IO.Path]::GetFullPath($PythonExecutable)
if ($SourceDirectory -eq $BuildDirectory -or $InstallDirectory -eq $SourceDirectory -or $InstallDirectory -eq $BuildDirectory) {
  throw 'Use separate source, build and install directories.'
}
if ((Get-Content (Join-Path $SourceDirectory '.cmake.conf') -Raw) -notmatch 'QT_REPO_MODULE_VERSION "6\.9\.3"') {
  throw 'This patch requires QtWebEngine source version 6.9.3.'
}
if ([Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $QtRoot 'bin\Qt6Core.dll')).FileVersion -ne '6.9.3.0') {
  throw 'Use the matching Qt 6.9.3 MSVC runtime.'
}
foreach ($command in @('git','cmake','node','bison','flex','gperf','perl')) {
  Get-Command $command -ErrorAction Stop | Out-Null
}
if (-not (Test-Path -LiteralPath $PythonExecutable)) { throw 'Python executable not found.' }
# Accept an already applied patch; do not duplicate it or silently ignore drift.
# Stacked patches that edit the same hunk cannot be reverse-checked one by one,
# so a completed series is recorded and rechecked through its last patch.
$seriesMarker = Join-Path $SourceDirectory '.tigerest-patches'
$series = @($patches | ForEach-Object { '{0} {1}' -f (Get-FileHash -Algorithm SHA256 -LiteralPath $_).Hash.ToLowerInvariant(), (Split-Path -Leaf $_) }) -join "`n"
$seriesApplied = $false
if ((Test-Path -LiteralPath $seriesMarker) -and ([IO.File]::ReadAllText($seriesMarker) -eq $series)) {
  $previousErrorPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    git -C $SourceDirectory apply --reverse --check $patches[-1] 2>$null
    $seriesApplied = $LASTEXITCODE -eq 0
  } finally { $ErrorActionPreference = $previousErrorPreference }
}
foreach ($patch in $(if ($seriesApplied) { @() } else { $patches })) {
  $previousErrorPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    git -C $SourceDirectory apply --reverse --check $patch 2>$null
    $alreadyApplied = $LASTEXITCODE -eq 0
  } finally { $ErrorActionPreference = $previousErrorPreference }
  if (-not $alreadyApplied) {
    git -C $SourceDirectory apply --check $patch
    if ($LASTEXITCODE -ne 0) { throw "Source does not match $(Split-Path -Leaf $patch)." }
    git -C $SourceDirectory apply $patch
    if ($LASTEXITCODE -ne 0) { throw "Could not apply $(Split-Path -Leaf $patch)." }
  }
}
[IO.File]::WriteAllText($seriesMarker, $series, [Text.UTF8Encoding]::new($false))
New-Item -ItemType Directory -Path $BuildDirectory -Force | Out-Null
$env:NINJAFLAGS = "-j$Jobs"
Push-Location $BuildDirectory
try {
  & (Join-Path $QtRoot 'bin\qt-configure-module.bat') $SourceDirectory -- -G Ninja `
    -DCMAKE_BUILD_TYPE=Release -DQT_BUILD_EXAMPLES=OFF -DQT_BUILD_TESTS=OFF `
    -DQT_FEATURE_qtpdf_build=OFF -DFEATURE_webengine_full_debug_info=OFF `
    -DQT_SHOW_EXTRA_IDE_SOURCES=OFF "-DCMAKE_INSTALL_PREFIX=$InstallDirectory" `
    "-DPython3_EXECUTABLE=$PythonExecutable"
  if ($LASTEXITCODE -ne 0) { throw 'QtWebEngine configure failed.' }
  cmake --build $BuildDirectory --parallel $Jobs
  if ($LASTEXITCODE -ne 0) { throw 'QtWebEngine build failed.' }
  cmake --install $BuildDirectory --prefix $InstallDirectory --config Release
  if ($LASTEXITCODE -ne 0) { throw 'QtWebEngine install failed.' }
} finally { Pop-Location }
function Get-Sha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $hash = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $hash.Dispose(); $stream.Dispose() }
}
$manifest = [pscustomobject]@{
  qtVersion = '6.9.3'
  patches = @($patches | ForEach-Object {
    [pscustomobject]@{ file = Split-Path -Leaf $_; sha256 = Get-Sha256 $_ } })
  coreSha256 = Get-Sha256 (Join-Path $InstallDirectory 'bin\Qt6WebEngineCore.dll')
} | ConvertTo-Json -Depth 3
[IO.File]::WriteAllText((Join-Path $InstallDirectory 'tigerest-webengine.json'),
                       $manifest, [Text.UTF8Encoding]::new($false))
