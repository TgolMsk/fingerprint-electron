# Shared helpers for .github/workflows/build-runtime.yml.
# Dot-source at the top of a step:  . "$env:GITHUB_WORKSPACE\.github\scripts\fp-ci.ps1"
# Must stay compatible with Windows PowerShell 5.1 and ASCII-only (the runner writes step
# scripts without guaranteeing a BOM, and PowerShell 5.1 reads BOM-less files as ANSI).

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$script:FpUtf8 = New-Object System.Text.UTF8Encoding $false
# release.py runs with PYTHONIOENCODING=utf-8; decode its piped output as UTF-8 as well.
try { [Console]::OutputEncoding = $script:FpUtf8 } catch { }

function Write-Annotation([string]$Level, [string]$Message) {
  $escaped = $Message.Replace('%', '%25').Replace("`r", '%0D').Replace("`n", '%0A')
  Write-Host "::${Level}::$escaped"
}

function Fail([string]$Message) {
  Write-Annotation 'error' $Message
  exit 1
}

function Add-Utf8Line([string]$Path, [string]$Line) {
  [System.IO.File]::AppendAllText($Path, $Line + "`n", $script:FpUtf8)
}

function Set-StepOutput([string]$Name, [string]$Value) {
  if ($Value -match "[`r`n]") { Fail "Output $Name must be a single line." }
  Add-Utf8Line $env:GITHUB_OUTPUT "$Name=$Value"
}

function Set-JobEnv([string]$Name, [string]$Value) {
  if ($Value -match "[`r`n]") { Fail "Environment value $Name must be a single line." }
  # Takes effect from the next step on (GitHub Actions semantics).
  Add-Utf8Line $env:GITHUB_ENV "$Name=$Value"
}

function Add-Summary([string]$Markdown) {
  Add-Utf8Line $env:GITHUB_STEP_SUMMARY $Markdown
}

function Read-JsonFile([string]$Path) {
  return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Test-PathInside([string]$Child, [string]$Parent) {
  $c = $Child.TrimEnd('\') + '\'
  $p = $Parent.TrimEnd('\') + '\'
  return $c.StartsWith($p, [System.StringComparison]::OrdinalIgnoreCase)
}

# Resolves an executable on the runner account's PATH, failing with guidance instead of a
# generic CommandNotFoundException (which would also leave a stale $LASTEXITCODE behind).
function Resolve-Tool([string]$Name, [string]$Hint, [switch]$RejectStoreAlias) {
  $cmd = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $cmd) { Fail "'$Name' was not found on the PATH of the runner account. $Hint" }
  if ($RejectStoreAlias -and $cmd.Path -like '*\WindowsApps\*') {
    Fail "'$Name' resolves to the Microsoft Store app alias $($cmd.Path). $Hint"
  }
  return $cmd.Path
}

# Runs a native command, streaming stdout+stderr as plain text, and returns its exit code.
# Windows PowerShell 5.1 turns redirected native stderr into ErrorRecords; with
# $ErrorActionPreference='Stop' the first stderr line would abort the step before the exit
# code could be checked, so the preference is relaxed to 'Continue' inside this function only.
function Invoke-Native {
  param([Parameter(Mandatory = $true)][string]$FilePath, [string[]]$ArgumentList = @())
  $ErrorActionPreference = 'Continue'
  $global:LASTEXITCODE = 0
  & $FilePath @ArgumentList 2>&1 | ForEach-Object {
    if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { "$_" }
  } | Out-Host
  return $LASTEXITCODE
}

# Like Invoke-Native, but returns stdout lines (stderr is echoed to the log).
function Invoke-Capture {
  param([Parameter(Mandatory = $true)][string]$FilePath, [string[]]$ArgumentList = @())
  $ErrorActionPreference = 'Continue'
  $global:LASTEXITCODE = 0
  $lines = New-Object System.Collections.Generic.List[string]
  & $FilePath @ArgumentList 2>&1 | ForEach-Object {
    if ($_ -is [System.Management.Automation.ErrorRecord]) { Write-Host $_.Exception.Message } else { $lines.Add("$_") }
  }
  $code = $LASTEXITCODE
  return [pscustomobject]@{ ExitCode = $code; Output = $lines.ToArray() }
}

function Get-Python {
  return (Resolve-Tool 'python' 'Install the Python version from lock.json toolchain.hostPython for all users (python.org installer), put it on the PATH the runner uses (<runner>\.path) and restart the runner service.' -RejectStoreAlias)
}

# python fp-kernel/scripts/release.py --lock <lock> <action> <arguments...>
# release.py prints "FAILED: ..." to stderr and exits 1 on any failure.
function Invoke-Release {
  param([Parameter(Mandatory = $true)][string]$Action, [string[]]$Arguments = @())
  $python = Get-Python
  $all = @($env:FP_CI_RELEASE_PY, '--lock', $env:FP_CI_LOCK, $Action) + $Arguments
  Write-Host ('> python ' + ($all -join ' '))
  $code = Invoke-Native -FilePath $python -ArgumentList $all
  if ($code -ne 0) { Fail "release.py $Action failed with exit code $code (see the FAILED: line above)." }
}

# Validates a release_tag input against lock.json: v<electron>-fp<fpkernel>[-suffix], e.g. v44.4.5-fp0.1.0-testing.2
# (same convention as the published v44.4.5-fp0.1.0-testing.1).
# ASCII digits only ([0-9], not \d, which also matches other Unicode digits) and \z (not $,
# which also matches before a trailing newline).
function Assert-ReleaseTagFormat([string]$Tag, $Lock) {
  $rt = $Lock.runtime
  $expected = "v$($rt.electron)-fp$($rt.fpkernel)"
  if (-not ($Tag -cmatch '^v([0-9]+\.[0-9]+\.[0-9]+)-fp([0-9]+\.[0-9]+\.[0-9]+)(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?\z')) {
    Fail "release_tag '$Tag' must look like $expected, optionally followed by a suffix such as -testing.2."
  }
  if ($Matches[1] -ne $rt.electron -or $Matches[2] -ne $rt.fpkernel) {
    Fail "release_tag '$Tag' does not match lock.json (Electron $($rt.electron), FP Kernel $($rt.fpkernel)). Expected $expected[-suffix]."
  }
}

function Get-GitHubCli {
  return (Resolve-Tool 'gh' 'GitHub CLI is preinstalled only on GitHub-hosted runners. Install it on the build machine for all users (winget install --id GitHub.cli -e --scope machine, or the MSI from https://cli.github.com), add it to <runner>\.path, restart the runner service, and re-run; or dispatch with draft_release=false.')
}

# Refuses when a tag or a (draft or published) release named $Tag already exists.
# Draft releases are only listed for tokens with push access, so the calling job needs
# contents: write (only the short check-tag and release jobs have it).
function Assert-ReleaseTagUnused([string]$Tag) {
  $gh = Get-GitHubCli
  $repo = $env:GITHUB_REPOSITORY
  $refs = Invoke-Capture -FilePath $gh -ArgumentList @('api', "repos/$repo/git/matching-refs/tags/$Tag", '--jq', '.[].ref')
  if ($refs.ExitCode -ne 0) { Fail "Could not list tags of $repo (gh api exit $($refs.ExitCode))." }
  if ($refs.Output -contains "refs/tags/$Tag") { Fail "Tag $Tag already exists in $repo. Choose a new release_tag (for example bump the suffix to -testing.2)." }
  $releases = Invoke-Capture -FilePath $gh -ArgumentList @('api', '--paginate', "repos/$repo/releases?per_page=100", '--jq', '.[].tag_name')
  if ($releases.ExitCode -ne 0) { Fail "Could not list releases of $repo (gh api exit $($releases.ExitCode))." }
  if ($releases.Output -contains $Tag) { Fail "A release (published or draft) already uses tag $Tag in $repo. Delete that draft or choose a new release_tag." }
  Write-Host "Tag $Tag is unused in $repo."
}

function Assert-SameRunner([string]$Expected) {
  if (-not $Expected) { Fail 'The build job did not report its runner name.' }
  if ($env:RUNNER_NAME -ne $Expected) {
    Fail "This job runs on '$($env:RUNNER_NAME)' but the build ran on '$Expected'; its files exist only there. Keep a single runner with the fp-kernel-builder label (or give each build machine its own label) and re-run failed jobs."
  }
}

# Checks <dir>\SHA256SUMS against every other file in <dir> (release-set output layout).
function Assert-ReleaseSet([string]$Dir) {
  if (-not (Test-Path -LiteralPath $Dir -PathType Container)) { Fail "Release set directory is missing: $Dir" }
  $sumsFile = Join-Path $Dir 'SHA256SUMS'
  if (-not (Test-Path -LiteralPath $sumsFile -PathType Leaf)) { Fail "SHA256SUMS is missing in $Dir" }
  $listed = @{}
  foreach ($line in (Get-Content -LiteralPath $sumsFile -Encoding UTF8)) {
    if (-not $line.Trim()) { continue }
    if ($line -match '^([0-9a-f]{64})  (\S.*)$') { $listed[$Matches[2]] = $Matches[1] }
    else { Fail "Malformed SHA256SUMS line: $line" }
  }
  $files = @(Get-ChildItem -LiteralPath $Dir -File | Where-Object { $_.Name -ne 'SHA256SUMS' })
  if ($files.Count -ne $listed.Count) { Fail "SHA256SUMS lists $($listed.Count) files but $Dir contains $($files.Count) other files." }
  foreach ($file in $files) {
    if (-not $listed.ContainsKey($file.Name)) { Fail "$($file.Name) is not listed in SHA256SUMS." }
    $actual = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $listed[$file.Name]) { Fail "SHA256 mismatch for $($file.Name): SHA256SUMS $($listed[$file.Name]), file $actual." }
  }
  Write-Host "SHA256SUMS verified for $($files.Count) files in $Dir."
  return $files
}
