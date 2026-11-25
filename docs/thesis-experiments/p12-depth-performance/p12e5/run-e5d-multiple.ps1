# Fixed-count crossed Multiple series. Every attempt is retained; validity is judged afterwards by the gates.
param([Parameter(Mandatory=$true)][int]$From,[Parameter(Mandatory=$true)][int]$To,[Parameter(Mandatory=$true)][int]$StepMs,[Parameter(Mandatory=$true)][string]$Tag,[Parameter(Mandatory=$true)][string]$Workspace,[Parameter(Mandatory=$true)][string]$Harness,[Parameter(Mandatory=$true)][string]$OnExtensions,[Parameter(Mandatory=$true)][string]$OffExtensions,[Parameter(Mandatory=$true)][string]$OriginalAnalyzer,[Parameter(Mandatory=$true)][string]$CodeExe,[Parameter(Mandatory=$true)][string]$ExpectedHash)
$ErrorActionPreference='Stop'
$env:P12E2_NO_TS='1'; $env:P12E2_FIXTURE='0'; $env:P12E5_PICKER='main.ts'; $env:P12E5_EXPECT_SHA256=$ExpectedHash; $env:P12E5_VSCODE_VERSION='1.147.0'; $env:P12E5C_STATE='multiple'; $env:P12E5D_PAN_STEP_MS=[string]$StepMs
Remove-Item Env:P12E4_GRAPH_ONLY,Env:P12E2_REACT_ONLY -ErrorAction SilentlyContinue
foreach($n in $From..$To){
 $order=if($n % 2 -eq 0){@('off','on')}else{@('on','off')}
 foreach($arm in $order){
  $output=Join-Path $PSScriptRoot "e5d-multiple-$arm-$Tag-r$n"; $ext=if($arm -eq 'on'){$OnExtensions}else{$OffExtensions}; $env:P12E2_VARIANT="virtualization-$arm"
  & powershell.exe -NoProfile -File (Join-Path $PSScriptRoot 'run-e5d.ps1') -Harness $Harness -Workspace $Workspace -Extensions $ext -CodeExe $CodeExe -Output $output -File src/main.ts | Out-Null
  $code=$LASTEXITCODE
  if(Test-Path (Join-Path $output 'interaction.json')){ node (Join-Path $PSScriptRoot 'manifest.cjs') $output $Workspace (Join-Path $ext 'ppsssj.cogic-0.0.6') $OriginalAnalyzer "virtual-$arm" 'ts-disabled' | Out-Null }
  Write-Host "$arm $Tag r$n exit $code"
  if(Test-Path (Join-Path $output 'memory-abort')){throw 'memory guard fired; series stopped'}
 }
}
