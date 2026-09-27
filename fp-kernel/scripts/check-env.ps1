param(
  [string]$Lock,
  [string]$WindowsToolchain,
  [string]$WindowsSdk,
  [string]$Output
)
$ErrorActionPreference = 'Stop'
if (-not $Lock) { $Lock = Join-Path $PSScriptRoot '..\build\lock.json' }
$arguments = @((Join-Path $PSScriptRoot 'release.py'), '--lock', $Lock, 'doctor')
if ($WindowsToolchain) { $arguments += @('--windows-toolchain', $WindowsToolchain) }
if ($WindowsSdk) { $arguments += @('--windows-sdk', $WindowsSdk) }
if ($Output) { $arguments += @('--output', $Output) }
& python @arguments
exit $LASTEXITCODE
