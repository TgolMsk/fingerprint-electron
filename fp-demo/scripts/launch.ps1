$ErrorActionPreference = 'Stop'
$testerAppDir = Split-Path -Parent $PSScriptRoot
$testerProjectDir = Split-Path -Parent $testerAppDir
$testerElectron = $env:FP_DEMO_ELECTRON
if (-not $testerElectron) {
    $runtimeConfig = Join-Path $testerProjectDir 'runtime\current.json'
    $localConfig = Join-Path $testerProjectDir '.fp-local.json'
    if (Test-Path -LiteralPath $runtimeConfig) {
        $testerElectron = (Get-Content -LiteralPath $runtimeConfig -Raw -Encoding UTF8 | ConvertFrom-Json).executable
    }
    if (-not $testerElectron -and (Test-Path -LiteralPath $localConfig)) {
        $testerElectron = (Get-Content -LiteralPath $localConfig -Raw -Encoding UTF8 | ConvertFrom-Json).electron
    }
    if (-not $testerElectron) { $testerElectron = 'runtime\electron.exe' }
}
if (-not [System.IO.Path]::IsPathRooted($testerElectron)) { $testerElectron = Join-Path $testerProjectDir $testerElectron }
try {
    if (-not (Test-Path -LiteralPath $testerElectron -PathType Leaf)) {
        throw "Custom Electron not found: $testerElectron. Set FP_DEMO_ELECTRON to your custom electron.exe."
    }
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    Start-Process -FilePath $testerElectron -ArgumentList ('"' + $testerAppDir + '"') -WorkingDirectory $testerAppDir | Out-Null
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'FP Lab - Startup error') | Out-Null
    exit 1
}
