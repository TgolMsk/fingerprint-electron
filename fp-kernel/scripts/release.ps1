param(
  [Parameter(Mandatory=$true)][string]$Root,
  [Parameter(Mandatory=$true)][string]$ValidationRoot,
  [Parameter(Mandatory=$true)][string]$ArtifactDir,
  [Parameter(Mandatory=$true)][string]$ReleaseDir,
  [string]$Lock,
  [string]$Reference,
  [string]$DepotTools,
  [string]$WindowsToolchain,
  [string]$WindowsSdk,
  [switch]$Resume,
  [switch]$Prepared,
  [int]$Jobs = 12
)
$ErrorActionPreference = 'Stop'
if (-not $Lock) { $Lock = Join-Path $PSScriptRoot '..\build\lock.json' }
$releaseScript = Join-Path $PSScriptRoot 'release.py'
function Invoke-FpStep([string[]]$StepArguments) {
  & python $releaseScript --lock $Lock @StepArguments
  if ($LASTEXITCODE -ne 0) { throw "FP pipeline stopped at $($StepArguments[0]) (exit $LASTEXITCODE)." }
}
try {
  $locked = Get-Content -LiteralPath $Lock -Raw | ConvertFrom-Json
  if (-not $Prepared) {
    $step = @('prepare', '--workspace', $Root)
    if ($Reference) { $step += @('--reference', $Reference) }
    if ($DepotTools) { $step += @('--depot-tools', $DepotTools) }
    if ($WindowsToolchain) { $step += @('--windows-toolchain', $WindowsToolchain) }
    if ($WindowsSdk) { $step += @('--windows-sdk', $WindowsSdk) }
    if ($Resume) { $step += '--resume' }
    Invoke-FpStep $step
  }
  $step = @('build', '--workspace', $Root, '--jobs', "$Jobs")
  if ($WindowsToolchain) { $step += @('--windows-toolchain', $WindowsToolchain) }
  if ($WindowsSdk) { $step += @('--windows-sdk', $WindowsSdk) }
  Invoke-FpStep $step
  $buildDir = Join-Path $Root ('src\out\' + $locked.build.outDir)
  Invoke-FpStep @('package', '--build-dir', $buildDir, '--output', $ArtifactDir)
  $v = $locked.runtime
  $archiveName = "fp-electron-$($v.electron)-fp$($v.fpkernel)-$($v.platform)-$($v.arch)-$($locked.build.profile).zip"
  $archive = Join-Path $ArtifactDir $archiveName
  Invoke-FpStep @('validate-release', '--archive', $archive, '--workspace', $ValidationRoot)
  Invoke-FpStep @('release-set', '--archive', $archive, '--output', $ReleaseDir)
  Write-Host "Release files prepared in $ReleaseDir. Upload/publication is a separate action."
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
