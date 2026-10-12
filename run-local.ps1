# Copy the source in this folder into the unpacked Windows build and (re)start floof from it.
# Usage: .\run-local.ps1 [-Build <build folder>] [-NoRestart] [floof args...]
#   .\run-local.ps1 --demo --log-pets
# (no positional binding, so a floof arg like --log-pets isn't taken as -Build)
[CmdletBinding(PositionalBinding = $false)]
param(
  [string]$Build,
  [switch]$NoRestart,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$FloofArgs
)
$ErrorActionPreference = 'Stop'
# by default the newest unpacked build, builds\floof-<version>\floof-win32-x64 (Claude Code's hook may point into it)
if (-not $Build) {
  # PS 5.1 has no $PSScriptRoot in param defaults
  $newest = Get-ChildItem (Join-Path $PSScriptRoot 'builds') -Directory -Filter 'floof-*' -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName 'floof-win32-x64\floof.exe') } |
    Sort-Object { try { [version]($_.Name -replace '^floof-', '') } catch { [version]'0.0' } } | Select-Object -Last 1
  if (-not $newest) { throw 'No unpacked build in builds\. Unzip builds\floof-*-win-x64.zip into builds\floof-<version> first.' }
  $Build = Join-Path $newest.FullName 'floof-win32-x64'
}
$exe = Join-Path $Build 'floof.exe'
if (-not (Test-Path $exe)) { throw "No floof.exe in $Build." }

$app = Join-Path $Build 'resources\app'
foreach ($dir in 'assets', 'docs', 'list', 'renderer', 'settings', 'sprites', 'src', 'tools') {
  robocopy (Join-Path $PSScriptRoot $dir) (Join-Path $app $dir) /E /NJH /NJS /NFL /NDL /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed for $dir ($LASTEXITCODE)" }
}
foreach ($file in 'main.js', 'preload.js', 'package.json') { Copy-Item (Join-Path $PSScriptRoot $file) $app -Force }
Copy-Item (Join-Path $PSScriptRoot 'README.md') $Build -Force
Write-Host "Synced source into $app"

if ($NoRestart) { return }
# VS Code (and so Claude Code inside it) sets this, and floof.exe would then run as plain Node and quit
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Get-Process floof -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
$argList = @{}
if ($FloofArgs) { $argList.ArgumentList = $FloofArgs }
Start-Process $exe @argList -RedirectStandardOutput "$env:TEMP\floof-out.log" -RedirectStandardError "$env:TEMP\floof-err.log"
Write-Host "Started $(Split-Path $exe -Leaf) $FloofArgs (logs: $env:TEMP\floof-out.log, $env:TEMP\floof-err.log)"
