# Builds the portable Windows release, builds\floof-<version>-win-x64.zip, the way 0.19.0 was made by hand.
# No Node.js and no network: the Electron runtime comes from an unpacked build already in builds\, and
# claude-code-hook.exe is compiled with the C# compiler that ships with Windows.
#
#   .\tools\make-release.ps1                 build the version in package.json, from its tag if there is one, else HEAD
#   .\tools\make-release.ps1 -Bump minor     bump the version (package.json, README, CHANGELOG's "Unreleased"), commit, build
#   .\tools\make-release.ps1 -Tag            also tag the release v<version> (before building from it)
#   .\tools\make-release.ps1 -NoSmoke        skip the smoke test (it stops your floof for a few seconds)
#   .\tools\make-release.ps1 -Name test      a different zip name, for trying the script out (builds\test.zip)
#   .\tools\make-release.ps1 -Runtime <dir>  the unpacked build whose Electron runtime to use (default: the newest one)
[CmdletBinding(PositionalBinding = $false)]
param(
  [ValidateSet('patch', 'minor', 'major')][string]$Bump,
  [switch]$Tag,
  [switch]$NoSmoke,
  [string]$Name,
  [string]$Runtime
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$builds = Join-Path $root 'builds'
function Invoke-Git { $out = & git.exe -C $root @args; if ($LASTEXITCODE) { throw "git $args failed" }; $out }
$utf8 = New-Object System.Text.UTF8Encoding $false # no byte order mark
function Edit-Text($file, $pattern, $replacement) {
  $path = Join-Path $root $file
  $text = [IO.File]::ReadAllText($path)
  $new = [regex]::Replace($text, $pattern, $replacement)
  if ($new -ne $text) { [IO.File]::WriteAllText($path, $new, $utf8) }
}

# 1. a clean tree, so the zip is exactly a commit
if (Invoke-Git status --porcelain) { throw 'The working tree has uncommitted changes. Commit or stash them first.' }

# 2. the version, bumped if asked
$version = ([IO.File]::ReadAllText((Join-Path $root 'package.json')) | ConvertFrom-Json).version
if ($Bump) {
  $v = [version]$version
  $version = switch ($Bump) { 'major' { "$($v.Major + 1).0.0" } 'minor' { "$($v.Major).$($v.Minor + 1).0" } 'patch' { "$($v.Major).$($v.Minor).$($v.Build + 1)" } }
  Edit-Text 'package.json' '"version":\s*"[^"]+"' "`"version`": `"$version`""
  Edit-Text 'README.md' 'version-\d+\.\d+\.\d+-' "version-$version-"
  Edit-Text 'README.md' 'floof-\d+\.\d+\.\d+-win-x64\.zip' "floof-$version-win-x64.zip"
  $date = Get-Date -Format 'yyyy-MM-dd'
  $log = [IO.File]::ReadAllText((Join-Path $root 'CHANGELOG.md'))
  if ($log -match '(?m)^## Unreleased\s*$') { Edit-Text 'CHANGELOG.md' '(?m)^## Unreleased[ \t]*(?=\r?\n|\z)' "## $version ($date)" }
  else { Edit-Text 'CHANGELOG.md' '(?m)^(## \d+\.\d+\.\d+)' "## $version ($date)`r`n`r`n### Changed`r`n- (fill in)`r`n`r`n`$1" }
  Invoke-Git add package.json README.md CHANGELOG.md | Out-Null
  Invoke-Git commit -q -m "floof $version" | Out-Null
  Write-Host "Bumped to $version and committed. Fill in the CHANGELOG if it has a stub."
}
$tagName = "v$version"
if ($Tag -and -not (Invoke-Git tag -l $tagName)) {
  Invoke-Git tag -a $tagName -m "floof $version" | Out-Null
  Write-Host "Tagged $tagName"
}
$ref = if (Invoke-Git tag -l $tagName) { $tagName } else { 'HEAD' }
$commit = (Invoke-Git rev-parse --short "$ref^{commit}")
$zipName = if ($Name) { "$Name.zip" } else { "floof-$version-win-x64.zip" }
$zip = Join-Path $builds $zipName
if (Test-Path $zip) { throw "$zip already exists. Delete it or pass -Name." }

# 3. the Electron runtime: the newest unpacked build, unless one is named
if (-not $Runtime) {
  $newest = Get-ChildItem $builds -Directory -Filter 'floof-*' -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName 'floof-win32-x64\floof.exe') } |
    Sort-Object { try { [version]($_.Name -replace '^floof-', '') } catch { [version]'0.0' } } | Select-Object -Last 1
  if (-not $newest) { throw 'No unpacked build in builds\ to take the Electron runtime from. Pass -Runtime <folder with floof.exe>.' }
  $Runtime = Join-Path $newest.FullName 'floof-win32-x64'
}
if (-not (Test-Path (Join-Path $Runtime 'floof.exe'))) { throw "No floof.exe in $Runtime." }

$work = Join-Path ([IO.Path]::GetTempPath()) "floof-release-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
New-Item -ItemType Directory $work | Out-Null
try {
  Write-Host "Building floof $version from $ref ($commit), runtime from $Runtime"
  # 4. the source exactly as committed
  $src = Join-Path $work 'src'
  Invoke-Git archive --format=zip -o (Join-Path $work 'src.zip') $ref | Out-Null
  Expand-Archive (Join-Path $work 'src.zip') $src

  # 5. the runtime without its app, then the app: what run-local.ps1 copies, minus the docs' decision records
  $out = Join-Path $work 'floof-win32-x64'
  robocopy $Runtime $out /E /XD (Join-Path $Runtime 'resources\app') /NJH /NJS /NFL /NDL /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }
  $app = Join-Path $out 'resources\app'
  New-Item -ItemType Directory $app | Out-Null
  foreach ($dir in 'assets', 'docs', 'list', 'renderer', 'settings', 'sprites', 'src', 'tools') { Copy-Item (Join-Path $src $dir) $app -Recurse }
  Remove-Item (Join-Path $app 'docs\adr') -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $app 'tools\make-release.ps1') -Force -ErrorAction SilentlyContinue # dev only
  foreach ($file in 'main.js', 'preload.js', 'package.json') { Copy-Item (Join-Path $src $file) $app }
  Copy-Item (Join-Path $src 'README.md'), (Join-Path $src 'LICENSE') $out

  # 6. the Claude Code hook, compiled fresh (it isn't kept in git)
  & (Join-Path $app 'tools\build-hook.ps1') | Out-Null
  if (-not (Test-Path (Join-Path $app 'tools\claude-code-hook.exe'))) { throw 'claude-code-hook.exe was not built.' }

  # 7. the zip, and an unpacked copy in builds\ if there isn't one for this version yet (never over the one your hooks may use)
  Compress-Archive -Path $out -DestinationPath $zip -CompressionLevel Optimal
  $unpacked = Join-Path $builds "floof-$version"
  if (-not $Name -and -not (Test-Path $unpacked)) {
    New-Item -ItemType Directory $unpacked | Out-Null
    Copy-Item $out $unpacked -Recurse
  }
  $size = (Get-Item $zip).Length
  $hash = (Get-FileHash $zip -Algorithm SHA256).Hash
  Write-Host ''
  Write-Host "  $zip"
  Write-Host ("  {0:N0} bytes ({1:N1} MB)" -f $size, ($size / 1MB))
  Write-Host "  SHA-256 $hash"
  Write-Host "  from $ref ($commit)"

  # 8. smoke test: the unzipped copy starts, answers /health, and writes no errors
  if (-not $NoSmoke) {
    Write-Host ''
    Write-Host 'Smoke test (your floof stops for a few seconds)...'
    $test = Join-Path $work 'smoke'
    Expand-Archive $zip $test
    $running = Get-CimInstance Win32_Process -Filter "Name='floof.exe'" | Where-Object { $_.CommandLine -notmatch '--type=' } | Select-Object -First 1
    $previous = if ($running) { $running.ExecutablePath } else { $null }
    # VS Code (and so Claude Code inside it) sets this, and floof.exe would then run as plain Node and quit
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    Get-Process floof -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
    $err = Join-Path $work 'smoke-err.log'
    $proc = Start-Process (Join-Path $test 'floof-win32-x64\floof.exe') -PassThru -RedirectStandardOutput (Join-Path $work 'smoke-out.log') -RedirectStandardError $err
    $port = try { ([IO.File]::ReadAllText((Join-Path $env:APPDATA 'floof\settings.json')) | ConvertFrom-Json).port } catch { $null }
    if (-not $port) { $port = 4417 }
    $healthy = $false
    for ($i = 0; $i -lt 20 -and -not $healthy; $i++) {
      Start-Sleep -Seconds 1
      try { $healthy = (Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 2).ok } catch { }
    }
    Start-Sleep -Seconds 2
    $errors = (Get-Content $err -ErrorAction SilentlyContinue | Where-Object { $_ -and $_ -notmatch '^DevTools' }) -join "`n"
    Get-Process floof -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
    if ($previous) { Start-Process $previous; Write-Host "Restarted your floof ($previous)" }
    if (-not $healthy) { throw "Smoke test failed: /health didn't answer on port $port." }
    if ($errors) { throw "Smoke test failed: errors were written:`n$errors" }
    Write-Host 'Smoke test passed: it started, /health answered, no errors.'
  }
} finally {
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
