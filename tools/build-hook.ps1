# Builds tools/claude-code-hook.exe from claude-code-hook.cs with the C# compiler that ships with
# Windows (.NET Framework 4), so nothing needs installing. The exe isn't kept in git; run this after cloning.
$ErrorActionPreference = 'Stop'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'No .NET Framework 4 C# compiler found (csc.exe).' }
$src = Join-Path $PSScriptRoot 'claude-code-hook.cs'
$out = Join-Path $PSScriptRoot 'claude-code-hook.exe'
& $csc /nologo /optimize+ /target:exe "/out:$out" $src
if ($LASTEXITCODE -ne 0) { throw "csc failed ($LASTEXITCODE)" }
Write-Host "Built $out"
