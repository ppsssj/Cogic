param([Parameter(Mandatory=$true)][string]$Harness, [Parameter(Mandatory=$true)][string]$Workspace, [Parameter(Mandatory=$true)][string]$Extensions, [Parameter(Mandatory=$true)][string]$CodeExe, [Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
if (Test-Path $Output) { throw 'Output already exists' }
New-Item -ItemType Directory -Path $Output | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'p13-lifecycle-off.spec.ts') (Join-Path $Harness 'e2e\p13-lifecycle-off.spec.ts')
$env:STUDY_WORKSPACE = $Workspace
$env:P4_EXTENSIONS_DIR = $Extensions
$env:VSCODE_EXE = $CodeExe
$env:RUN_ID = 'p12d-off-' + [guid]::NewGuid().ToString('N')
Remove-Item Env:COGIC_PIPELINE_PROFILE -ErrorAction SilentlyContinue
Push-Location $Harness
try {
  $ErrorActionPreference = 'Continue'
  & npx.cmd playwright test -c playwright.p13.config.ts e2e/p13-lifecycle-off.spec.ts 2>&1 | Tee-Object -FilePath (Join-Path $Output 'harness.log')
  exit $LASTEXITCODE
} finally { Pop-Location }
