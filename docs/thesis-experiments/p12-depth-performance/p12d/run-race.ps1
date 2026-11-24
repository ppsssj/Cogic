param([Parameter(Mandatory=$true)][string]$Harness, [Parameter(Mandatory=$true)][string]$Workspace, [Parameter(Mandatory=$true)][string]$Extensions, [Parameter(Mandatory=$true)][string]$CodeExe, [Parameter(Mandatory=$true)][string]$Output, [ValidateSet('open','show','analysis','analysis-generate','failure','replay','debug','interactions','expand','expand-cancel','expand-pending','trace','late-activation','late-activation-off')][string]$Mode)
$ErrorActionPreference = 'Stop'
if (Test-Path $Output) { throw 'Output already exists' }
if (Test-Path (Join-Path $Workspace '.debug-dist')) { throw 'P13 helper would remove .debug-dist' }
New-Item -ItemType Directory -Path $Output | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'p13-p12d-race.spec.ts') (Join-Path $Harness 'e2e\p13-p12d-race.spec.ts')
$env:STUDY_WORKSPACE = $Workspace
$env:P4_EXTENSIONS_DIR = $Extensions
$env:VSCODE_EXE = $CodeExe
$env:P12D_GATE_DIR = $Output
$env:P12D_GATE_KIND = if ($Mode -in @('failure','debug','analysis-generate')) { 'analysis' } elseif ($Mode -in @('expand','expand-cancel')) { 'expansion' } elseif ($Mode -eq 'expand-pending') { 'expansion-both' } elseif ($Mode -eq 'late-activation-off') { 'late-activation' } else { $Mode }
$env:P12D_FAIL_TARGET = if ($Mode -eq 'failure') { '1' } else { '0' }
$env:P12D_TEST_MODE = $Mode
$env:COGIC_PIPELINE_PROFILE = Join-Path $Output 'pipeline.jsonl'
$env:RUN_ID = 'p12d-race-' + [guid]::NewGuid().ToString('N')
Push-Location $Harness
try {
  $ErrorActionPreference = 'Continue'
  & npx.cmd playwright test -c playwright.p13.config.ts e2e/p13-p12d-race.spec.ts 2>&1 | Tee-Object -FilePath (Join-Path $Output 'harness.log')
  exit $LASTEXITCODE
} finally { Pop-Location }
