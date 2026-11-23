param([Parameter(Mandatory=$true)][string]$Harness, [Parameter(Mandatory=$true)][string]$Workspace, [Parameter(Mandatory=$true)][string]$Extensions, [Parameter(Mandatory=$true)][string]$CodeExe, [Parameter(Mandatory=$true)][string]$Output, [string]$RunId = ('p12c-' + [guid]::NewGuid().ToString('N')))
$ErrorActionPreference = 'Stop'
if (Test-Path $Output) { throw 'Output directory already exists; choose a new path.' }
if (Test-Path (Join-Path $Harness ('.e2e-profiles\' + $RunId))) { throw 'Profile already exists; choose a new RunId.' }
New-Item -ItemType Directory -Force -Path $Output | Out-Null
if (Test-Path (Join-Path $Workspace '.debug-dist')) { throw 'P13 helper would remove .debug-dist; preserve it before running.' }
Copy-Item (Join-Path $PSScriptRoot 'p13-p12c.spec.ts') (Join-Path $Harness 'e2e\p13-p12c.spec.ts')
$env:STUDY_WORKSPACE = $Workspace
$env:P4_EXTENSIONS_DIR = $Extensions
$env:VSCODE_EXE = $CodeExe
$env:COGIC_PIPELINE_PROFILE = Join-Path $Output 'pipeline.jsonl'
$env:RUN_ID = $RunId
Push-Location $Harness
try {
  & npx.cmd playwright test -c playwright.p13.config.ts e2e/p13-p12c.spec.ts 2>&1 | Tee-Object -FilePath (Join-Path $Output 'harness.log')
  exit $LASTEXITCODE
} finally { Pop-Location }
