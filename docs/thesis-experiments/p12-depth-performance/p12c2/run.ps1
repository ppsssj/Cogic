param([Parameter(Mandatory=$true)][string]$Harness, [Parameter(Mandatory=$true)][string]$Workspace, [Parameter(Mandatory=$true)][string]$Extensions, [Parameter(Mandatory=$true)][string]$CodeExe, [Parameter(Mandatory=$true)][string]$Output, [Parameter(Mandatory=$true)][string]$File, [ValidateSet('on','off')][string]$Cache = 'on')
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $Output) { throw 'Output already exists' }
if (Test-Path (Join-Path $Workspace '.debug-dist')) { throw 'P13 helper would remove .debug-dist' }
New-Item -ItemType Directory -Path $Output | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'p13-p12c2.spec.ts') (Join-Path $Harness 'e2e\p13-p12c2.spec.ts')
$env:STUDY_WORKSPACE=$Workspace
$env:P4_EXTENSIONS_DIR=$Extensions
$env:VSCODE_EXE=$CodeExe
$env:P12C2_OUTPUT=$Output
$env:P12C2_FILE=$File
$env:P12C2_CACHE=$Cache
$env:COGIC_PIPELINE_PROFILE=Join-Path $Output 'pipeline.jsonl'
$env:RUN_ID='p12c2-' + [guid]::NewGuid().ToString('N')
$monitor = Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -PassThru -ArgumentList @('-NoProfile','-File', ('"' + (Join-Path $PSScriptRoot 'memory-monitor.ps1') + '"'), '-Profile', $env:RUN_ID, '-Output', ('"' + $Output + '"'))
Push-Location $Harness
try { $ErrorActionPreference='Continue'; & npx.cmd playwright test -c playwright.p13.config.ts e2e/p13-p12c2.spec.ts 2>&1 | Tee-Object -FilePath (Join-Path $Output 'harness.log'); exit $LASTEXITCODE } finally { Set-Content -LiteralPath (Join-Path $Output 'monitor.stop') -Value 'stop'; Pop-Location }
