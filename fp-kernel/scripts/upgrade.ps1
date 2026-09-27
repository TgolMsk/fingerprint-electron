param(
  [Parameter(Mandatory=$true)][string]$To,
  [Parameter(Mandatory=$true)][string]$Root,
  [string]$Lock,
  [string]$Reference,
  [string]$DepotTools,
  [string]$WindowsToolchain,
  [string]$WindowsSdk,
  [switch]$Build,
  [switch]$Resume,
  [int]$Jobs = 12
)
$ErrorActionPreference = 'Stop'
if (-not $Lock) { $Lock = Join-Path $PSScriptRoot '..\build\lock.json' }
try {
  $locked = Get-Content -LiteralPath $Lock -Raw | ConvertFrom-Json
  if ($To.TrimStart('v') -ne $locked.runtime.electron) {
    throw 'The target version must match a reviewed lock. Use release.py upgrade-plan to resolve the new tag, adapt patches and create a candidate lock first.'
  }
  $arguments = @((Join-Path $PSScriptRoot 'release.py'), '--lock', $Lock, 'prepare', '--workspace', $Root)
  if ($Reference) { $arguments += @('--reference', $Reference) }
  if ($DepotTools) { $arguments += @('--depot-tools', $DepotTools) }
  if ($WindowsToolchain) { $arguments += @('--windows-toolchain', $WindowsToolchain) }
  if ($WindowsSdk) { $arguments += @('--windows-sdk', $WindowsSdk) }
  if ($Resume) { $arguments += '--resume' }
  & python @arguments
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  if ($Build) {
    $arguments = @((Join-Path $PSScriptRoot 'release.py'), '--lock', $Lock, 'build', '--workspace', $Root, '--jobs', $Jobs)
    if ($WindowsToolchain) { $arguments += @('--windows-toolchain', $WindowsToolchain) }
    if ($WindowsSdk) { $arguments += @('--windows-sdk', $WindowsSdk) }
    & python @arguments
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }
  Write-Host 'Candidate prepared. Existing source, VERSION and published runtime were not replaced. Complete acceptance before promotion.'
  exit 0
} catch { Write-Error $_; exit 1 }
