param([Parameter(Mandatory=$true)][int]$Run, [Parameter(Mandatory=$true)][string]$Workspace, [Parameter(Mandatory=$true)][string]$Harness, [Parameter(Mandatory=$true)][string]$OnExtensions, [Parameter(Mandatory=$true)][string]$OffExtensions, [Parameter(Mandatory=$true)][string]$OriginalAnalyzer, [Parameter(Mandatory=$true)][string]$CodeExe, [Parameter(Mandatory=$true)][string]$OutputRoot, [Parameter(Mandatory=$true)][string]$ExpectedHash, [Parameter(Mandatory=$true)][string]$RootFile, [Parameter(Mandatory=$true)][string]$Picker, [string]$ReferenceRun = "e5d-single-on-r1")
$ErrorActionPreference='Stop'
$env:P12E2_NO_TS='1'; $env:P12E2_FIXTURE='0'; $env:P12E5_PICKER=$Picker; $env:P12E5_EXPECT_SHA256=$ExpectedHash; $env:P12E5_VSCODE_VERSION='1.147.0'; $env:P12E5C_STATE='single'
Remove-Item Env:P12E4_GRAPH_ONLY,Env:P12E2_REACT_ONLY -ErrorAction SilentlyContinue
$order=if($Run % 2 -eq 0){@('off','on')}else{@('on','off')}
$invalid=0
foreach($arm in $order){
 $output=Join-Path $OutputRoot ('e5d-single-'+$arm+'-r'+$Run)
 $ext=if($arm -eq 'on'){$OnExtensions}else{$OffExtensions}
 $env:P12E2_VARIANT='virtualization-'+$arm
 & powershell.exe -NoProfile -File (Join-Path $PSScriptRoot 'run-e5d.ps1') -Harness $Harness -Workspace $Workspace -Extensions $ext -CodeExe $CodeExe -Output $output -File $RootFile
 if($LASTEXITCODE -ne 0){Write-Host "INVALID $arm $Run (exit $LASTEXITCODE); pair stopped"; $invalid++; break}
 node (Join-Path $PSScriptRoot 'manifest.cjs') $output $Workspace (Join-Path $ext 'ppsssj.cogic-0.0.6') $OriginalAnalyzer ('virtual-'+$arm) 'ts-disabled'
 if($LASTEXITCODE -ne 0){Write-Host "INVALID manifest $arm $Run"; $invalid++; break}
 if($Run -eq 1 -and $arm -eq 'on' -and $ReferenceRun -eq 'e5d-single-on-r1'){Write-Host 'REFERENCE on 1'; continue}
 $base=Join-Path $OutputRoot $ReferenceRun
 if(!(Test-Path -LiteralPath (Join-Path $base 'manifest.json'))){throw 'Run 1 ON reference must exist and be valid'}
 node (Join-Path $PSScriptRoot 'compare-manifests.cjs') (Join-Path $base 'manifest.json') (Join-Path $output 'manifest.json') | Set-Content -Encoding UTF8 (Join-Path $output 'manifest-comparison.json')
 if($LASTEXITCODE -ne 0){Write-Host "INVALID manifest comparison $arm $Run"; $invalid++; break}
 node (Join-Path $PSScriptRoot 'compare-e5d.cjs') (Join-Path $base 'interaction.json') (Join-Path $output 'interaction.json') | Set-Content -Encoding UTF8 (Join-Path $output 'state-comparison.json')
 if($LASTEXITCODE -ne 0){Write-Host "INVALID state $arm $Run"; $invalid++; break}
 Write-Host "VALID $arm $Run"
}
if($invalid -gt 0){exit 1}
