# One condition per fresh VS Code session. Orders are fixed in advance; every attempt is retained.
param([Parameter(Mandatory=$true)][string]$Workspace,[Parameter(Mandatory=$true)][string]$Harness,[Parameter(Mandatory=$true)][string]$OnExtensions,[Parameter(Mandatory=$true)][string]$BExtensions,[Parameter(Mandatory=$true)][string]$OriginalAnalyzer,[Parameter(Mandatory=$true)][string]$CodeExe,[Parameter(Mandatory=$true)][string]$ExpectedHash,[string[]]$Blocks=@('ABC','CBA','BAC','CAB','BCA'),[string]$DExtensions='',[string]$Prefix='e5h',[int]$HideMs=1000)
$ErrorActionPreference='Stop'
$env:P12E2_NO_TS='1'; $env:P12E2_FIXTURE='0'; $env:P12E5_PICKER='main.ts'; $env:P12E5_EXPECT_SHA256=$ExpectedHash; $env:P12E5_VSCODE_VERSION='1.147.0'; $env:P12E5C_STATE='multiple'; $env:P12E5D_PAN_STEP_MS='125'; $env:P12E2_VARIANT='virtualization-on'
Remove-Item Env:P12E4_GRAPH_ONLY,Env:P12E2_REACT_ONLY -ErrorAction SilentlyContinue
$b=0
foreach($block in $Blocks){ $b++
 foreach($c in $block.ToCharArray()){
  $output=Join-Path $PSScriptRoot "$Prefix-b$b-$c"; $ext=if($c -eq 'B'){$BExtensions}elseif($c -eq 'D'){$DExtensions}else{$OnExtensions}; $env:P12E5H_COND=[string]$c; $env:P12E5H_HIDE_MS=[string]$HideMs
  & powershell.exe -NoProfile -File (Join-Path $PSScriptRoot 'run-e5h-layer.ps1') -Harness $Harness -Workspace $Workspace -Extensions $ext -CodeExe $CodeExe -Output $output -File src/main.ts | Out-Null
  $code=$LASTEXITCODE
  if(Test-Path (Join-Path $output 'interaction.json')){ node (Join-Path $PSScriptRoot 'manifest.cjs') $output $Workspace (Join-Path $ext 'ppsssj.cogic-0.0.6') $OriginalAnalyzer "virtual-on-$c" 'ts-disabled' | Out-Null }
  Write-Host "$Prefix b$b $c exit $code"
  if(Test-Path (Join-Path $output 'memory-abort')){throw 'memory guard fired; series stopped'}
 }
}
