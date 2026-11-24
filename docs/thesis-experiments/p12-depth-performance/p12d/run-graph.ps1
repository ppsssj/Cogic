param([Parameter(Mandatory=$true)][string]$Harness, [Parameter(Mandatory=$true)][string]$Workspace, [Parameter(Mandatory=$true)][string]$Extensions, [Parameter(Mandatory=$true)][string]$CodeExe, [Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
if (Test-Path $Output) { throw 'Output already exists' }
if (Test-Path (Join-Path $Workspace '.debug-dist')) { throw 'P13 helper would remove .debug-dist' }
New-Item -ItemType Directory -Path $Output | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'p13-p12d-graph.spec.ts') (Join-Path $Harness 'e2e\p13-p12d-graph.spec.ts')
$env:STUDY_WORKSPACE = $Workspace
$env:P4_EXTENSIONS_DIR = $Extensions
$env:VSCODE_EXE = $CodeExe
$env:P12D_OUTPUT = $Output
$env:COGIC_PIPELINE_PROFILE = Join-Path $Output 'pipeline.jsonl'
$env:RUN_ID = 'p12d-graph-' + [guid]::NewGuid().ToString('N')
Push-Location $Harness
try {
  $ErrorActionPreference = 'Continue'
  & npx.cmd playwright test -c playwright.p13.config.ts e2e/p13-p12d-graph.spec.ts 2>&1 | Tee-Object -FilePath (Join-Path $Output 'harness.log')
  exit $LASTEXITCODE
} finally { Pop-Location }
