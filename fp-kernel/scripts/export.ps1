param(
  [Parameter(Mandatory=$true)][string]$Source,
  [Parameter(Mandatory=$true)][string]$Output,
  [string]$Lock,
  [string]$ElectronBase,
  [string]$ChromiumBase
)
$ErrorActionPreference = 'Stop'
if (-not $Lock) { $Lock = Join-Path $PSScriptRoot '..\build\lock.json' }
$arguments = @((Join-Path $PSScriptRoot 'release.py'), '--lock', $Lock, 'export', '--source', $Source, '--output', $Output)
if ($ElectronBase) { $arguments += @('--electron-base', $ElectronBase) }
if ($ChromiumBase) { $arguments += @('--chromium-base', $ChromiumBase) }
& python @arguments
exit $LASTEXITCODE
