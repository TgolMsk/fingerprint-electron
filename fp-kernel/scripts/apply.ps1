param(
  [Parameter(Mandatory=$true)][string]$Root,
  [string]$Lock,
  [string]$Reference,
  [string]$DepotTools,
  [string]$WindowsToolchain,
  [string]$WindowsSdk,
  [switch]$Resume
)
$ErrorActionPreference = 'Stop'
if (-not $Lock) { $Lock = Join-Path $PSScriptRoot '..\build\lock.json' }
$arguments = @((Join-Path $PSScriptRoot 'release.py'), '--lock', $Lock, 'prepare', '--workspace', $Root)
if ($Reference) { $arguments += @('--reference', $Reference) }
if ($DepotTools) { $arguments += @('--depot-tools', $DepotTools) }
if ($WindowsToolchain) { $arguments += @('--windows-toolchain', $WindowsToolchain) }
if ($WindowsSdk) { $arguments += @('--windows-sdk', $WindowsSdk) }
if ($Resume) { $arguments += '--resume' }
& python @arguments
exit $LASTEXITCODE
