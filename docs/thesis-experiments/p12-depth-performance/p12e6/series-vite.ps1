# Runs a fixed list of cells, each in a fresh VS Code session. Cell: <label>|<state>|<virt>|<style>|<extensions dir>. Every attempt is retained.
param([Parameter(Mandatory=$true)][string]$CellsFile,[Parameter(Mandatory=$true)][string]$OutputRoot,[Parameter(Mandatory=$true)][string]$Workspace,[Parameter(Mandatory=$true)][string]$Harness,[Parameter(Mandatory=$true)][string]$OriginalAnalyzer,[Parameter(Mandatory=$true)][string]$CodeExe,[Parameter(Mandatory=$true)][string]$ExpectedHash,[string]$RootFile='src/main.ts',[string]$Picker='main.ts')
$ErrorActionPreference='Stop'
$env:P12E2_NO_TS='1'; $env:P12E2_FIXTURE='0'; $env:P12E5_PICKER=$Picker; $env:P12E5_EXPECT_SHA256=$ExpectedHash; $env:P12E5_VSCODE_VERSION='1.147.0'; $env:P12E5D_PAN_STEP_MS='125'
Remove-Item Env:P12E4_GRAPH_ONLY,Env:P12E2_REACT_ONLY -ErrorAction SilentlyContinue
$auto=@{A=@();D=@('renderer','viewport','edges','nodes');R=@('renderer','edges','nodes');V=@('viewport','edges','nodes');W=@('viewport');X=@('renderer','viewport');K=@('renderer','viewport','edges','nodes')}
$p5=Join-Path $PSScriptRoot '../p12e5'
foreach($line in Get-Content -LiteralPath $CellsFile){ if(-not $line.Trim()){continue}
 $label,$state,$virt,$style,$ext=$line.Trim().Split('|')
 $exp=[ordered]@{}; foreach($k in 'renderer','viewport','edges','nodes'){ $exp[$k]=if($auto[$style] -contains $k){'auto'}else{'transform'} }
 $env:P12E6_EXPECT_WC=($exp|ConvertTo-Json -Compress); $env:P12E6_COND=$style; $env:P12E5C_STATE=$state; $env:P12E2_VARIANT="virtualization-$virt"
 $output=Join-Path $OutputRoot $label
 & powershell.exe -NoProfile -File (Join-Path $PSScriptRoot 'run-vite.ps1') -Harness $Harness -Workspace $Workspace -Extensions $ext -CodeExe $CodeExe -Output $output -File $RootFile | Out-Null
 $code=$LASTEXITCODE
 if(Test-Path (Join-Path $output 'interaction.json')){ node (Join-Path $p5 'manifest.cjs') $output $Workspace (Join-Path $ext 'ppsssj.cogic-0.0.6') $OriginalAnalyzer "virtual-$virt" 'ts-disabled' | Out-Null }
 Write-Host "CELL $label exit $code"
 if(Test-Path (Join-Path $output 'memory-abort')){throw 'memory guard fired; series stopped'}
}
