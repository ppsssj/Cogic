# One fresh VS Code session. Condition A (normal) or B (edge animations off). Same build (PR #40 CSS), virtualization ON.
param([Parameter(Mandatory=$true)][string]$Label,[Parameter(Mandatory=$true)][ValidateSet('A','B')][string]$Condition,[string]$OutputRoot='C:/dev/p13/p12e8-data',[string]$Workspace='C:/dev/p11/projects/vite',[string]$Harness='C:/dev/p13/p12e2-no-ts-harness',[string]$Extensions='C:/dev/p13/p12e6-on-K-extensions',[Parameter(Mandatory=$true)][string]$CodeExe,[string]$Research='C:/dev/Cogic-P4-restored/docs/thesis-experiments/p12-depth-performance')
$ErrorActionPreference='Stop'; $out="$OutputRoot/$Label"
if(Test-Path -LiteralPath $out){throw 'Output already exists'}; if(Test-Path "$Workspace/.debug-dist"){throw 'P13 helper would remove .debug-dist'}
New-Item -ItemType Directory -Force -Path $out | Out-Null
Copy-Item "$PSScriptRoot/p13-p12e8.spec.ts" "$Harness/e2e/p13-p12e8.spec.ts" -Force
Remove-Item Env:P12E4_GRAPH_ONLY,Env:P12E2_REACT_ONLY -ErrorAction SilentlyContinue
$env:STUDY_WORKSPACE=$Workspace; $env:P4_EXTENSIONS_DIR=$Extensions; $env:VSCODE_EXE=$CodeExe; $env:P12C2_OUTPUT=$out; $env:P12C2_FILE='packages/vite/src/node/server/index.ts'; $env:P12C2_CACHE='on'
$env:COGIC_PIPELINE_PROFILE="$out/pipeline.jsonl"; $env:RUN_ID='p12c2-'+[guid]::NewGuid().ToString('N')
$env:P12E2_NO_TS='1'; $env:P12E2_FIXTURE='0'; $env:P12E5_PICKER='index.ts'; $env:P12E5_EXPECT_SHA256='1cf5220cac8c97eb7c3d2379889fc45c01b8bb9c4a7d2b03d908b4dd62a2ab74'; $env:P12E5_VSCODE_VERSION='1.147.0'; $env:P12E5D_PAN_STEP_MS='125'
$env:P12E6_EXPECT_WC='{"renderer":"auto","viewport":"auto","edges":"auto","nodes":"auto"}'; $env:P12E6_COND=$Condition; $env:P12E5C_STATE='vite'; $env:P12E2_VARIANT='virtualization-on'
$m=Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList @('-NoProfile','-File',"`"$Research/p12c2/memory-monitor.ps1`"",'-Profile',$env:RUN_ID,'-Output',"`"$out`"")
Push-Location $Harness
try{$ErrorActionPreference='Continue'; & npx.cmd playwright test -c playwright.p13.config.ts e2e/p13-p12e8.spec.ts 2>&1 | Out-File "$out/harness.log" -Encoding utf8; "CELL $Label exit $LASTEXITCODE"}finally{Set-Content "$out/monitor.stop" 'stop'; Pop-Location}
